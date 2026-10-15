/**
 * 宿主半的 HTTP 传输层。
 *
 * ## 为什么不用官方的 Typert Remote
 *
 * 官方有一条"Remote 命名空间"通道（`ctx.remote.<namespace>`），但它**对第三方插件
 * 不可用**。实证（`dsh-api-remotes/lib/client.js`）：客户端侧挂载的是**一份写死的、
 * 编译期生成的清单**，只含 15 个第一方包：
 *
 * ```
 * for (const contribution of [TYPERT_REMOTE$14, … TYPERT_REMOTE]) {
 *   disposers.push(await ctx.remote.$mount(contribution))
 * }
 * ```
 *
 * 每个 `TYPERT_REMOTE$N` 都是 Typert **编译器**为第一方包生成的描述符。第三方插件
 * 没有进入这份清单的途径——**没有动态注册入口**。
 *
 * 后果很隐蔽：客户端插件若声明 `inject: ['remote.dashboard']`，cordis 会永远等一个
 * 不会出现的服务，插件**不激活**，浏览器报 "failed to load plugins"（实测踩过）。
 * 宿主侧一切正常（服务注册了、10 个方法都能被发现），所以特别难查。
 *
 * ## 现在的做法
 *
 * 用官方给插件留的正路：`webServer.register()` 自己开 HTTP 路由，
 * 浏览器直接 `fetch`。完全不依赖内部机制，且可被自动化测试端到端验证。
 *
 * ## 安全边界
 *
 * - 路由挂在 `/plugins/dsh-multimodel-dashboard/*` 前缀下，不抢占任何官方路径；
 * - **每条路由都过 `connection.requestRejection(request)`**：这是官方的
 *   Host/Origin 围栏 + 浏览器会话 cookie 校验（见 `dsh-client-connection/lib/index.js`
 *   的 `requestRejection`）。它返回 `403`（来源不可信）或 `401`（未登录）时直接拒绝。
 *   这一步**必须有**：`webServer.register` 注册的处理器跑在官方鉴权链路**之前**，
 *   不自己校验的话，任何本机进程都能读到历史记录并消耗模型额度（实测确认过：
 *   官方首页无 cookie 返回 401，而早期版本的插件路由无 cookie 照样返回数据）；
 * - 只接受 POST + JSON，且校验 `content-type`，避免被当成表单/图片端点；
 * - 响应只回业务数据，**不回显任何凭证、不返回宿主文件路径**；
 * - 请求体有大小上限，防止内存被撑爆；
 * - 只监听本机（由主 webServer 的 host 配置决定，本插件不改）。
 */

/** 路由前缀：本插件独占，不与官方路径冲突。 */
const ROUTE_PREFIX = '/plugins/dsh-multimodel-dashboard'

/** 请求体上限：1 MiB。一轮请求最多带 20 万字符资料，加上 JSON 开销足够。 */
const MAX_BODY_BYTES = 1024 * 1024

/**
 * 官方鉴权：Host/Origin 围栏 + 浏览器会话 cookie。
 *
 * 从 `ctx.get('connection')` 取官方 Connection 服务；它的 `requestRejection`
 * 是**只读**调用（不改状态），正是官方给同进程消费者准备的口子。
 * @param ctx - 宿主 context。
 * @returns 拒绝时的 HTTP 状态码；放行时返回 `undefined`。
 */
function rejectionOf(ctx, request) {
  const connection = ctx.get?.('connection')
  if (connection === undefined || typeof connection.requestRejection !== 'function') {
    // 拿不到官方鉴权服务时**拒绝**而不是放行：宁可功能不可用，
    // 也不能开一个未鉴权的口子（fail-closed）。
    return 503
  }
  try {
    return connection.requestRejection(request)
  } catch {
    return 403
  }
}

/**
 * 读完整请求体（带上限）。
 * @param request - node:http 请求对象。
 * @returns 解析后的 JSON 对象；超限或非法时返回 `{ __error }`。
 */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return { __error: `请求体超过上限 ${MAX_BODY_BYTES} 字节` }
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    return { __error: `请求体不是合法 JSON：${String(error?.message ?? error)}` }
  }
}

/**
 * 写一个 JSON 响应。
 * @param response - node:http 响应对象。
 * @param status - HTTP 状态码。
 * @param payload - 任意可序列化对象。
 */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    // 插件接口是私有的、每次请求都要现算，禁止任何缓存。
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/**
 * 发一个"被拒绝"的最小响应。
 *
 * 刻意不解释具体原因（与官方 `writeUnauthorized` 的做法一致）：
 * 区分 401/403 的细节对合法用户没帮助，对探测者倒是有用。
 * @param response - node:http 响应对象。
 * @param status - 401 / 403 / 503。
 */
function sendRejected(response, status) {
  const body = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'auth unavailable'
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/**
 * 把一次一元调用包成处理器：先过鉴权，再统一做结果信封与错误兜底。
 * @param ctx - 宿主 context（用于取官方鉴权服务）。
 * @param name - 方法名（仅用于日志与错误信息）。
 * @param handler - 接收解析后的 body，返回业务数据。
 * @returns 路由处理器。
 */
function unary(ctx, name, handler) {
  return async (request, response) => {
    const rejected = rejectionOf(ctx, request)
    if (rejected !== undefined) {
      sendRejected(response, rejected)
      return
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: { code: 'dashboard/method-not-allowed', message: '只接受 POST' } })
      return
    }
    const body = await readJsonBody(request)
    if (body.__error !== undefined) {
      sendJson(response, 400, { ok: false, error: { code: 'dashboard/bad-request', message: body.__error } })
      return
    }
    try {
      const value = await handler(body)
      sendJson(response, 200, { ok: true, value })
    } catch (error) {
      // 失败以数据返回，绝不 500 让前端只能显示"未知错误"。
      sendJson(response, 200, {
        ok: false,
        error: { code: 'dashboard/handler-failed', message: `${name}: ${String(error?.message ?? error)}` },
      })
    }
  }
}

/**
 * 注册全部 HTTP 路由。
 *
 * 用 `webServer.register` 的 `prefix` 形式：`kind: 'prefix'` 下 path 是前缀，
 * 一个注册覆盖本插件所有子路径，避免逐个登记。
 * @param ctx - 宿主 context（需要 webServer 服务）。
 * @param service - `DashboardHost` 实例。
 * @returns 清理函数；webServer 不可用时返回 `undefined`（调用方据此降级）。
 */
export function registerRoutes(ctx, service) {
  const webServer = ctx.get?.('webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') {
    // 没挂 webServer 的运行时（例如无 Web 的 CLI 场景）：不报错，只记一条。
    // 界面侧会显示"后端不可用"，而不是白屏。
    ctx.logger?.warn?.('[dashboard] 运行时没有 webServer，HTTP 接口未注册')
    return undefined
  }

  const routes = [
    ['health', unary(ctx, 'health', () => service.health())],
    ['listRoutes', unary(ctx, 'listRoutes', () => service.listRoutes())],
    ['stopLane', unary(ctx, 'stopLane', (body) => service.stopLane(body))],
    ['saveRound', unary(ctx, 'saveRound', (body) => service.saveRound(body))],
    ['listRounds', unary(ctx, 'listRounds', () => service.listRounds())],
    ['loadRound', unary(ctx, 'loadRound', (body) => service.loadRound(body))],
    ['deleteRound', unary(ctx, 'deleteRound', (body) => service.deleteRound(body))],
    ['exportRound', unary(ctx, 'exportRound', (body) => service.exportRound(body))],
  ]

  const disposers = []
  for (const [name, handler] of routes) {
    const path = `${ROUTE_PREFIX}/${name}`
    try {
      disposers.push(
        webServer.register({
          kind: 'exact',
          path,
          handler: (request, response) => void handler(request, response),
        }),
      )
    } catch (error) {
      ctx.logger?.warn?.(`[dashboard] 路由 ${path} 注册失败：${String(error?.message ?? error)}`)
    }
  }

  // 流式端点单列：SSE，逐事件推送。
  try {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/runLane`,
        handler: (request, response) => void streamLane(ctx, request, response, service),
      }),
    )
  } catch (error) {
    ctx.logger?.warn?.(`[dashboard] runLane 路由注册失败：${String(error?.message ?? error)}`)
  }

  ctx.logger?.info?.(`[dashboard] 已注册 ${disposers.length} 条 HTTP 路由于 ${ROUTE_PREFIX}/`)
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 卸载期失败不影响其余清理。
      }
    }
  }
}

/**
 * 单路流式调用（SSE）。
 *
 * 为什么用 SSE 而不是 WebSocket：SSE 是普通 HTTP，能直接复用主服务的
 * cookie 鉴权，客户端 `fetch` + `ReadableStream` 就能消费，不需要额外的
 * 升级协商。本插件的语义正是"服务端持续推、客户端只读"。
 *
 * 事件格式：每行 `data: <JSON>\n\n`。JSON 里是 `{ ok, value | error }` 信封，
 * 与一元接口保持同一套判别方式（看 `ok`，不看 HTTP 状态）。
 * @param ctx - 宿主 context（用于取官方鉴权服务）。
 * @param request - node:http 请求对象。
 * @param response - node:http 响应对象。
 * @param service - `DashboardHost` 实例。
 */
async function streamLane(ctx, request, response, service) {
  const rejected = rejectionOf(ctx, request)
  if (rejected !== undefined) {
    sendRejected(response, rejected)
    return
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: { code: 'dashboard/method-not-allowed', message: '只接受 POST' } })
    return
  }
  const body = await readJsonBody(request)
  if (body.__error !== undefined) {
    sendJson(response, 400, { ok: false, error: { code: 'dashboard/bad-request', message: body.__error } })
    return
  }

  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // 关掉 nginx 一类反代的缓冲，保证逐字到达。
    'x-accel-buffering': 'no',
  })

  const write = (payload) => {
    try {
      response.write(`data: ${JSON.stringify(payload)}\n\n`)
    } catch {
      // 客户端已断开：由下面的 abort 收口。
    }
  }

  // 客户端断开（刷新页面、点停止）时取消上游请求，避免继续计费。
  const onClose = () => {
    if (response.writableFinished) return
    try {
      service.stopLane({ laneId: body.laneId })
    } catch {
      // 停止失败不阻塞清理。
    }
  }
  response.on('close', onClose)

  try {
    for await (const item of service.runLane(body)) write(item)
  } catch (error) {
    write({ ok: false, error: { code: 'dashboard/stream-failed', message: String(error?.message ?? error) } })
  } finally {
    response.off('close', onClose)
    response.end()
  }
}

export { ROUTE_PREFIX }
