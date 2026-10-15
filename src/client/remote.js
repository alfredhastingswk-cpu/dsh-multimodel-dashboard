/**
 * 浏览器半的传输层：直接调本插件的 HTTP 接口。
 *
 * ## 为什么不用官方的 Typert Remote
 *
 * 官方有 `ctx.remote.<namespace>` 通道，但**第三方插件用不了**：客户端挂载的是
 * 一份编译期写死的 15 个第一方包的清单（`dsh-api-remotes/lib/client.js`），
 * 没有动态注册入口。更糟的是，若在这里声明 `inject: ['remote.dashboard']`，
 * cordis 会永远等一个不会出现的服务，插件不激活、整页报 "failed to load plugins"。
 *
 * 所以改成直接 `fetch` 宿主的 HTTP 路由（由宿主半的 `http.js` 注册）。
 *
 * ## 响应约定
 *
 * 所有接口返回 `{ ok: true, value }` 或 `{ ok: false, error }`。
 * 判别一律看 `ok`，**不看 HTTP 状态码**——网络层的 4xx/5xx 与业务失败是两回事，
 * 前者由 `fetch` 的 status 反映，后者由信封反映，两者都如实上报。
 */

/** 本插件的路由前缀，与宿主半 `http.js` 的 `ROUTE_PREFIX` 必须一致。 */
const ROUTE_PREFIX = '/plugins/dsh-multimodel-dashboard'

/** 把错误对象转成可展示的中文说明（不泄露任何内部细节）。 */
export function describeRemoteError(error) {
  if (error === undefined || error === null) return '未知错误'
  const code = typeof error.code === 'string' ? error.code : ''
  const message = typeof error.message === 'string' ? error.message : String(error)
  if (message.length === 0) return code.length > 0 ? code : '未知错误'
  return code.length > 0 ? `${code}：${message}` : message
}

/**
 * 发一个 POST 请求并解析结果信封。
 * @param path - 相对路由路径，如 `health`。
 * @param body - 请求体（会被 JSON 序列化）。
 * @returns 解析后的 `value`；失败时抛出带中文说明的错误。
 */
async function postJson(path, body) {
  let response
  try {
    response = await fetch(`${ROUTE_PREFIX}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // 带上会话 cookie，否则会被主服务的鉴权拦下。
      credentials: 'same-origin',
      body: JSON.stringify(body ?? {}),
    })
  } catch (error) {
    // 网络层失败（服务没起、连接断了）：这是真实故障，如实上报。
    throw new Error(`无法连接工作台后端：${String(error?.message ?? error)}`)
  }

  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    // 返回的不是 JSON：多半是被主服务/代理拦截了（例如鉴权失败返回 HTML 登录页）。
    // 只报状态码和一小段提示，不把整页 HTML 铺到界面上。
    throw new Error(
      response.status === 401 || response.status === 403
        ? `后端拒绝访问（HTTP ${response.status}），请刷新页面重新登录后再试。`
        : `后端返回了非预期内容（HTTP ${response.status}）：${text.slice(0, 120)}`,
    )
  }

  if (parsed?.ok === false) throw new Error(describeRemoteError(parsed.error))
  if (parsed?.ok !== true) throw new Error(`后端返回格式不正确（HTTP ${response.status}）`)
  return parsed.value
}

/**
 * 创建后端访问器。
 *
 * 这里**不再依赖 ctx**：路由是固定路径，任何页面都能直接调。
 * 保留 `ctx` 参数只为兼容既有调用方与未来可能的探测。
 * @param _ctx - 客户端 context（当前未使用）。
 * @returns 访问器。
 */
export function createRemoteAccess(_ctx) {
  return {
    available: true,
    health: () => postJson('health'),
    listRoutes: (options) => postJson('listRoutes', options),
    stopLane: (laneId) => postJson('stopLane', { laneId }),
    runLane: (params) => openStream('runLane', params),
    // `runRound` 保留：宿主侧仍提供该方法，供将来"一次跑完整轮"的调用方使用。
    runRound: (params) => openStream('runRound', params),
    saveRound: (record) => postJson('saveRound', record),
    listRounds: () => postJson('listRounds'),
    loadRound: (roundId) => postJson('loadRound', { roundId }),
    deleteRound: (roundId) => postJson('deleteRound', { roundId }),
    exportRound: (record, format) => postJson('exportRound', { record, format }),
  }
}

/**
 * 打开一条 SSE 流，返回异步迭代器。
 *
 * 不用 EventSource：它只支持 GET、不能带请求体、也不能取消一条已开的流。
 * 这里用 `fetch` + `ReadableStream` 手工解析 SSE，语义正好合适——
 * 服务端持续推、客户端只读，随时可以 abort。
 * @param path - 路由路径。
 * @param body - 请求体。
 * @returns 产出结果为 `{ ok, value | error }` 信封的异步迭代器。
 */
async function* openStream(path, body) {
  let response
  try {
    response = await fetch(`${ROUTE_PREFIX}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      credentials: 'same-origin',
      body: JSON.stringify(body ?? {}),
    })
  } catch (error) {
    yield { ok: false, error: { code: 'dashboard/unreachable', message: String(error?.message ?? error) } }
    return
  }

  if (!response.ok || response.body === null) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 160)
    } catch {
      detail = ''
    }
    yield {
      ok: false,
      error: {
        code: `dashboard/http-${response.status}`,
        message:
          response.status === 401 || response.status === 403
            ? `后端拒绝访问（HTTP ${response.status}），请刷新页面重新登录后再试。`
            : `流失效（HTTP ${response.status}）${detail}`,
      },
    }
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines = []
  const acceptLine = (raw) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line === '') {
      const payload = dataLines.join('\n')
      dataLines = []
      return payload || undefined
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
    return undefined
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const payload = acceptLine(line)
        if (payload !== undefined) yield JSON.parse(payload)
        newline = buffer.indexOf('\n')
      }
      if (done) break
    }
    // An EOF can follow the final data line without a trailing blank line.
    if (buffer.length > 0) acceptLine(buffer)
    const tail = acceptLine('')
    if (tail !== undefined) yield JSON.parse(tail)
  } catch (error) {
    yield { ok: false, error: { code: 'dashboard/stream-broken', message: String(error?.message ?? error) } }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // 已释放则忽略。
    }
  }
}

/**
 * 消费一条流，把每个产出项交给 handler。
 *
 * 产出项可能是 `{ ok: true, value }`（业务事件）或 `{ ok: false, error }`（该流失败）。
 * 该流失败只影响这一条流，调用方据此把该路标成失败——绝不显示成已完成。
 * @param iterable - 异步迭代器。
 * @param onEvent - 收到业务事件时调用。
 * @returns 流结束后的最终事件或 undefined。
 */
export async function consumeStream(iterable, onEvent) {
  let last
  for await (const item of iterable) {
    if (item !== undefined && item.ok === false) {
      throw new Error(describeRemoteError(item.error))
    }
    const event = item?.value ?? item
    if (event === undefined) continue
    last = event
    onEvent(event)
  }
  if (!['lane-final', 'lane-failed', 'round-final'].includes(last?.kind)) {
    throw new Error('连接提前结束，未收到完成标记；已保留部分内容，请重试该栏。')
  }
  return last
}

export { ROUTE_PREFIX }
