/**
 * 宿主半（Node 侧）：多模型 Dashboard 的 Remote API。
 *
 * 本文件用**裸说明符**导入，依赖 Harness 的 `$DSH_HOME/profiles/node_modules`
 * 回退链路解析安装依赖闭包（`healProfilesModuleFallback` 维护）。这条链路已在
 * 运行时通过宿主的共享依赖链路解析。
 *
 * 关于 `@Remote` 装饰器：本机 Node 24 **不解析装饰器语法**（无转译步骤），
 * 因此这里手工调用 Typert 的装饰器函数。要点（源码实测）：
 * - 装饰器必须在 `addInitializer` 回调里把标记写到 **prototype** 上；
 * - `remoteMethods()` 接收的是**服务实例**（内部再 `getPrototypeOf` 一次），
 *   传 prototype 只会得到空数组；
 * - 所以手工绑定时必须真的执行收集到的 initializer。
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import * as rounds from './store.js'
import { registerRoutes } from './http.js'
import { runLane as runLanes, collectLane, buildMaterial } from './lanes.js'
import { syncGatewayModels } from './catalog.js'

export const name = 'dashboard'
/**
 * 需要的宿主服务。
 *
 * - `llm`：模型调用；
 * - `webServer`：注册本插件的 HTTP 路由（浏览器侧的通道）；
 * - `connection`：官方的 Host/Origin 围栏 + 会话 cookie 校验。
 *   路由处理器跑在官方鉴权链路**之前**，所以必须自己调用
 *   `connection.requestRejection(request)`；不声明就拿不到它，
 *   会退化成"未鉴权接口"（早期版本正是如此）。
 */
export const inject = ['llm', 'webServer', 'connection', 'settings']

/**
 * 手工施加一个 Typert Remote 装饰器（等价于 `@Remote(...)` 语法）。
 * @param type - 目标类。
 * @param method - 方法名。
 * @param option - 导出名（字符串）或 `{ mode: 'stream' }`。
 */
function decorate(type, method, option) {
  const decorator = option === undefined ? Remote : Remote(option)
  const initializers = []
  decorator(type.prototype[method], {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    addInitializer(fn) {
      initializers.push(fn)
    },
    access: {
      has: (target) => method in target,
      get: (target) => target[method],
    },
  })
  // 装饰期语义是「延迟到实例初始化时写 prototype」；这里立刻在 prototype 上兑现。
  const anchor = Object.create(type.prototype)
  for (const initialize of initializers) initialize.call(anchor)
}

class DashboardHost extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'dashboard', { namespace: 'dashboard' })
    this.lanes = new Map()
    this.roundsDir = rounds.roundsDir(ctx)
  }

  /**
   * 列出已配置的渠道与模型。
   *
   * 只返回 provider/model 的 id 与显示名——`listProviders()` / `listModels()`
   * 本身就不含密钥，因此"前端不含密钥"是结构保证。
   * 模型清单优先用适配器目录（真实探测），失败或为空时回退到 profile 配置里
   * 声明的 models，避免把"未探测到"误报成"没有可用模型"。
   * @returns 渠道数组。
   */
  async listRoutes(params) {
    const discovery = await syncGatewayModels(this.ctx, params?.refresh === true)
    const llm = this.ctx.llm
    const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
    const configured = this.configuredModels()
    const out = []
    for (const provider of providers) {
      const id = String(provider.id)
      let models = []
      let catalogError
      try {
        const listed = await llm.listModels(id)
        models = listed.map((model) => ({
          id: String(model.id),
          name: String(model.name ?? model.id),
          contextWindow: model.context?.contextWindow,
        }))
      } catch (error) {
        catalogError = String(error?.message ?? error)
      }
      if (models.length === 0 && Array.isArray(configured[id])) {
        models = configured[id].map((model) => ({ id: model.id, name: model.name, contextWindow: model.contextWindow }))
      }
      out.push({
        id,
        name: String(provider.name ?? id),
        models,
        catalogSource: discovery.providerIds?.includes(id) ? 'gateway' : 'configured',
        syncedAt: discovery.providerIds?.includes(id) ? discovery.syncedAt : undefined,
        ...(discovery.error ? { catalogError: `中转站目录同步失败，使用本地清单：${discovery.error}` } : {}),
        ...(catalogError === undefined ? {} : { catalogError }),
      })
    }
    return out
  }

  /**
   * 从 profile 配置里读出声明的模型（脱敏：只有 id/name/容量）。
   * 这是 listModels() 不可用时的诚实回退，而不是编造模型 ID。
   * @returns providerId -> 模型数组。
   */
  configuredModels() {
    const out = {}
    try {
      const runtime = this.ctx.get?.('llm')
      const directory = typeof runtime?.listConfigurableProviders === 'function'
        ? runtime.listConfigurableProviders()
        : []
      for (const entry of directory) {
        if (!Array.isArray(entry.models)) continue
        out[String(entry.provider)] = entry.models.map((model) => ({
          id: String(model.id),
          name: String(model.name ?? model.id),
          contextWindow: model.contextWindow,
        }))
      }
    } catch {
      // 读不到就返回空表：界面会显示真实的"未发现模型"，而不是伪造清单。
    }
    return out
  }

  /**
   * 一个模型栏的一次独立流式调用。
   *
   * 每个产出项都是「结果信封」`{ ok: true, value }` 或 `{ ok: false, error }`。
   * 失败以数据返回而非抛出；多条产出项各自独立校验，因此单路失败不会变成
   * 整条流的失败——这正是"失败不能显示为完成"所需的语义。
   * @param params - RoundInput + lane 路由。
   */
  async *runLane(params) {
    const key = String(params?.laneId ?? '')
    const controller = new AbortController()
    // 注意：`this.lanes` 是 **laneId -> controller** 的映射，不是全局单例。
    // 早期版本用 `laneControllers.set(this, controller)`（WeakMap 以实例为键），
    // 结果是多路同时跑时互相覆盖，`stopLane` 只能停到最后一路——单路停止失效。
    const previous = this.lanes.get(key)
    if (previous !== undefined) previous.abort()
    this.lanes.set(key, controller)
    try {
      const material = buildMaterial(params)
      for await (const chunk of runLanes(this.ctx, params, material, controller.signal)) {
        yield { ok: true, value: chunk }
      }
    } catch (error) {
      yield {
        ok: false,
        error: { code: 'dashboard/lane-failed', message: String(error?.message ?? error) },
      }
    } finally {
      if (this.lanes.get(key) === controller) this.lanes.delete(key)
    }
  }

  /**
   * 停止单路：取消作用到真实请求。该路没在跑时是无操作。
   * @param params - 含 laneId。
   */
  stopLane(params) {
    const key = String(params?.laneId ?? '')
    const controller = this.lanes.get(key)
    if (controller === undefined) return { stopped: false }
    controller.abort()
    this.lanes.delete(key)
    return { stopped: true }
  }

  /**
   * 运行一轮：一次提交冻结同一份问题与资料快照，扇出给所选模型。
   *
   * 每一路都在自己的 try 里跑完（`Promise.allSettled`），任何一路失败都不影响其他路；
   * 整轮不会因单路失败而抛出。
   * @param params - RoundInput。
   */
  async *runRound(params) {
    const roundId = String(params?.roundId ?? '')
    const lanes = Array.isArray(params?.lanes) ? params.lanes : []
    const material = buildMaterial(params)
    const snapshot = String(params?.snapshot ?? '')
    yield {
      ok: true,
      value: {
        kind: 'round-start',
        roundId,
        mode: params?.mode === 'peer-review' ? 'peer-review' : 'independent',
        questionChars: material.question.length,
        snapshotChars: snapshot.length,
        snapshotHash: String(params?.snapshotHash ?? ''),
        lanes: lanes.map((lane) => ({
          laneId: String(lane?.laneId ?? ''),
          provider: String(lane?.provider ?? ''),
          model: String(lane?.model ?? ''),
        })),
      },
    }

    const results = await Promise.allSettled(
      lanes.map(async (lane) => {
        const key = String(lane?.laneId ?? '')
        const controller = new AbortController()
        const previous = this.lanes.get(key)
        if (previous !== undefined) previous.abort()
        this.lanes.set(key, controller)
        try {
          const chunks = []
          for await (const event of collectLane(this.ctx, { ...params, lane }, controller.signal)) chunks.push(event)
          // collectLane 每次只保留最后一个事件；这里改为逐事件聚合，保证 delta 不丢。
          return chunks
        } finally {
          if (this.lanes.get(key) === controller) this.lanes.delete(key)
        }
      }),
    )

    for (let index = 0; index < results.length; index += 1) {
      const laneId = String(lanes[index]?.laneId ?? '')
      const result = results[index]
      if (result.status === 'fulfilled') {
        const final = result.value[result.value.length - 1] ?? { kind: 'lane-failed', message: '没有收到任何事件' }
        // 逐条透出该路的流式增量，再透出最终事件；每路各自成段。
        for (const event of result.value) {
          if (event === final) continue
          yield { ok: true, value: { ...event, laneId } }
        }
        yield { ok: true, value: { ...final, laneId, kind: final.kind ?? 'lane-final' } }
      } else {
        yield {
          ok: true,
          value: {
            kind: 'lane-failed',
            laneId,
            code: 'dashboard/lane-rejected',
            message: String(result.reason?.message ?? result.reason),
          },
        }
      }
    }
  }

  /**
   * 保存一轮完整记录（问题、资料、各栏原文、互评、总结）。
   * @param params - 完整轮次记录。
   */
  async saveRound(params) {
    const record = { ...params, savedAt: new Date().toISOString() }
    await rounds.writeRound(this.roundsDir, record)
    return { id: String(record.roundId ?? ''), savedAt: record.savedAt }
  }

  /** 列出本地历史轮次（不含正文，只有摘要）。 */
  async listRounds() {
    return await rounds.listRounds(this.roundsDir)
  }

  /** 读取一轮完整记录。 */
  async loadRound(params) {
    return await rounds.readRound(this.roundsDir, String(params?.roundId ?? ''))
  }

  /** 删除一轮记录。 */
  async deleteRound(params) {
    const id = String(params?.roundId ?? '')
    await rounds.deleteRound(this.roundsDir, id)
    return { deleted: true, id }
  }

  /** 导出本轮为 Markdown 或 JSON 文本。 */
  exportRound(params) {
    return { text: rounds.renderExport(params?.record, params?.format ?? 'markdown') }
  }

  /** 后端自检：供页面显示真实的就绪状态，而不是假"已连接"。 */
  health() {
    const llm = this.ctx.llm
    const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
    return {
      ready: true,
      providerCount: providers.length,
      providers: providers.map((provider) => ({ id: String(provider.id), name: String(provider.name ?? provider.id) })),
      // **不返回 `roundsDir`**：那是宿主的绝对文件路径，会经由 HTTP 暴露给浏览器。
      // 界面不需要它（只需要知道"历史存在本地"），因此只回一个布尔值。
      // 早期版本直接把路径发出去了，属于不必要的信息暴露，已移除。
      historyAvailable: typeof this.roundsDir === 'string' && this.roundsDir.length > 0,
      mock: false,
    }
  }
}

decorate(DashboardHost, 'listRoutes', 'listRoutes')
decorate(DashboardHost, 'health', 'health')
decorate(DashboardHost, 'stopLane', 'stopLane')
decorate(DashboardHost, 'saveRound', 'saveRound')
decorate(DashboardHost, 'listRounds', 'listRounds')
decorate(DashboardHost, 'loadRound', 'loadRound')
decorate(DashboardHost, 'deleteRound', 'deleteRound')
decorate(DashboardHost, 'exportRound', 'exportRound')
decorate(DashboardHost, 'runLane', { mode: 'stream' })
decorate(DashboardHost, 'runRound', { mode: 'stream' })

/**
 * cordis 插件入口。
 *
 * 同时做两件事：
 * 1. 注册 `DashboardHost` 服务（保留 Typert 绑定，便于宿主侧自检与未来可能的
 *    第一方通道）；
 * 2. **注册 HTTP 路由**——这才是浏览器实际走的通道。
 *
 * 为什么不靠 Typert Remote：客户端只挂载一份编译期写死的 15 个第一方包的清单，
 * 第三方命名空间永远进不去（详见 `http.js` 顶部说明）。
 * @param ctx - 宿主根 context。
 */
export function apply(ctx) {
  const service = new DashboardHost(ctx)
  ctx.logger?.info?.(
    `[dashboard] 多模型 Dashboard 后端已就绪：namespace=${service.typertRemote?.namespace ?? 'dashboard'}`,
  )
  // webServer 可能还没就绪（插件加载顺序）；用 ctx.inject 等它出现再注册，
  // 而不是假设它一定在。这样在无 Web 的运行时也不会报错。
  ctx.inject?.(['webServer'], (scope) => {
    try {
      registerRoutes(scope, service)
    } catch (error) {
      ctx.logger?.error?.(`[dashboard] HTTP 路由注册失败：${String(error?.message ?? error)}`)
    }
  })
}

export { DashboardHost }
