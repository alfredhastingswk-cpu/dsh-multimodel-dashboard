window.__ModuleLoader__.load({
	id: "dsh-multimodel-dashboard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const jsxRuntime = require("react/jsx-runtime");
		const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = react;
		const jsx = jsxRuntime.jsx;
		const jsxs = jsxRuntime.jsxs;
		const Fragment = react.Fragment;
		/**
		 * 浏览器半入口：注册多模型 Dashboard 页面。
		 *
		 * 页面挂载方式：
		 * - `main` 是 root 作用域的 **keyed** slot，`conversation` 是会话界面保留的 key；
		 *   插件可以自带 key 新增一个全局面板，由 `ctx.layout.selectPanel(id)` 切换。
		 * - 通过 `ctx.slots.inject("main", () => ctx.slots.register(...))` 贡献：
		 *   inject 会等声明真正出现，声明崩塌时自动撤销，并随插件 fiber 卸载。
		 *
		 * 插件使用独立面板 key，避免占用宿主的 conversation 面板。
		 */
		// ---- inlined: src/client/format.js ----
		/**
		 * 浏览器侧的纯函数工具：哈希、快照冻结、Markdown 渲染、导出文本。
		 *
		 * 这些函数都不接触网络，也不接触密钥；渲染只处理模型返回的文本。
		 */

		/**
		 * 功能开关。默认值即"当前认为可交付的功能集"。
		 *
		 * `peerReview`（一轮互评）默认**关闭**：实测在低输出上限下，参与互评的模型
		 * 可能把 token 预算全用在推理上、正文为空。功能本身
		 * 未损坏（编排逻辑本地测通），只是现阶段不可靠，因此界面上不暴露。
		 *
		 * 想恢复：把对应项改成 `true` 并重新构建；同时建议把该栏输出上限提到 ≥1024。
		 */
		const FEATURES = {
		  peerReview: false,
		}

		/**
		 * 计算文本的 sha256 短哈希（用于给问题与每份资料一个可复核的版本标识）。
		 *
		 * 为什么不用 `crypto.subtle`：那是异步的，且只在安全上下文可用。这里用一个
		 * 同步的 FNV-1a 变体 + 长度前缀，强度足以识别"同一份材料是否变过"，
		 * 并在界面与导出里如实标注为 `fnv1a` 而不是伪装成 sha256。
		 * @param text - 任意文本。
		 * @returns 形如 `fnv1a:1a2b3c4d` 的标识。
		 */
		function contentHash(text) {
		  const value = String(text ?? '')
		  let hash = 0x811c9dc5
		  for (let index = 0; index < value.length; index += 1) {
		    hash ^= value.charCodeAt(index)
		    hash = Math.imul(hash, 0x01000193) >>> 0
		  }
		  return `fnv1a:${hash.toString(16).padStart(8, '0')}`
		}

		/** 支持的资料格式（UTF-8 文本、Markdown、CSV）。 */
		const SUPPORTED_FORMATS = ['text', 'markdown', 'csv']
		/** 单个资料正文上限（字符）。 */
		const MAX_MATERIAL_CHARS = 200000
		/** 单次提交资料总字符上限（字符）。 */
		const MAX_TOTAL_MATERIAL_CHARS = 400000

		/**
		 * 按文件名后缀判断格式。不支持的后缀返回 `undefined`，由调用方给出明确提示。
		 * @param name - 文件名。
		 * @returns 'text' | 'markdown' | 'csv' | undefined。
		 */
		function detectFormat(name) {
		  const lower = String(name ?? '').toLowerCase()
		  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
		  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv'
		  if (lower.endsWith('.txt') || lower.endsWith('.log') || lower.endsWith('.json') || lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'text'
		  return undefined
		}

		/**
		 * 冻结本轮快照：一次提交只产生一份 question 文本与一份资料清单，
		 * 所有路共用。返回的 `snapshot` 是所有路真正收到的用户消息正文。
		 * @param question - 用户问题。
		 * @param materials - 资料数组（已通过校验）。
		 * @returns {{ question, materials, snapshot, questionHash, snapshotHash, manifest }}
		 */
		function freezeSnapshot(question, materials) {
		  const list = materials.map((material, index) => ({
		    id: material.id ?? `m${index + 1}`,
		    name: material.name,
		    format: material.format,
		    text: material.text,
		    hash: contentHash(material.text),
		  }))
		  const manifestLines = ['本轮材料范围（如实申报，不得省略）：']
		  manifestLines.push(`[纳入] 问题原文（完整，${question.length} 字，${contentHash(question)}）`)
		  for (const material of list) {
		    manifestLines.push(`[纳入] 资料《${material.name}》全文（${material.text.length} 字，${material.hash}）`)
		  }
		  const manifest = manifestLines.join('\n')
		  const body = [
		    `## 问题\n${question}`,
		    `## 材料清单\n${manifest}`,
		    list.length > 0
		      ? `## 资料正文\n${list.map((material) => `### 资料：${material.name}（${material.format}）\n${material.text}`).join('\n\n')}`
		      : '',
		  ]
		    .filter((part) => part.length > 0)
		    .join('\n\n')
		  return {
		    question,
		    materials: list,
		    snapshot: body,
		    questionHash: contentHash(question),
		    snapshotHash: contentHash(body),
		    manifest,
		  }
		}

		/** HTML 转义。 */
		function escapeHtml(text) {
		  return String(text)
		    .replace(/&/g, '&amp;')
		    .replace(/</g, '&lt;')
		    .replace(/>/g, '&gt;')
		    .replace(/"/g, '&quot;')
		}

		/**
		 * 极简 Markdown → HTML。
		 *
		 * 只覆盖模型回答里真正会出现的结构（标题、列表、代码块、强调、表格、引用），
		 * 并且先整体转义再按行重组，因此模型返回的 HTML 不会被当作标签执行。
		 * @param text - 模型返回的 Markdown 文本。
		 * @returns 可直接放进 dangerouslySetInnerHTML 的 HTML 字符串。
		 */
		function renderMarkdown(text) {
		  const lines = escapeHtml(text).split('\n')
		  const out = []
		  let inCode = false
		  let listType = null
		  let inTable = false
		  let tableHeaderDone = false

		  const closeList = () => {
		    if (listType !== null) {
		      out.push(`</${listType}>`)
		      listType = null
		    }
		  }
		  const closeTable = () => {
		    if (inTable) {
		      out.push('</tbody></table>')
		      inTable = false
		      tableHeaderDone = false
		    }
		  }

		  const inline = (value) =>
		    value
		      .replace(/`([^`]+)`/g, '<code>$1</code>')
		      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
		      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')

		  for (const raw of lines) {
		    const line = raw.replace(/\s+$/, '')
		    const fence = /^\s*```/
		    if (fence.test(line)) {
		      if (inCode) {
		        out.push('</code></pre>')
		        inCode = false
		      } else {
		        closeList()
		        closeTable()
		        out.push('<pre><code>')
		        inCode = true
		      }
		      continue
		    }
		    if (inCode) {
		      out.push(`${line}\n`)
		      continue
		    }
		    if (line.trim().length === 0) {
		      closeList()
		      closeTable()
		      continue
		    }
		    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
		    if (heading !== null) {
		      closeList()
		      closeTable()
		      const level = Math.min(heading[1].length, 4)
		      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
		      continue
		    }
		    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
		      closeList()
		      closeTable()
		      out.push('<hr />')
		      continue
		    }
		    const quote = /^&gt;\s?(.*)$/.exec(line)
		    if (quote !== null) {
		      closeList()
		      closeTable()
		      out.push(`<blockquote>${inline(quote[1])}</blockquote>`)
		      continue
		    }
		    const tableRow = /^\s*\|(.+)\|\s*$/.exec(line)
		    if (tableRow !== null) {
		      closeList()
		      const cells = tableRow[1].split('|').map((cell) => cell.trim())
		      if (/^[\s:|-]+$/.test(tableRow[1])) {
		        tableHeaderDone = true
		        continue
		      }
		      if (!inTable) {
		        out.push('<table><thead><tr>')
		        out.push(cells.map((cell) => `<th>${inline(cell)}</th>`).join(''))
		        out.push('</tr></thead><tbody>')
		        inTable = true
		        tableHeaderDone = false
		        continue
		      }
		      out.push(`<tr>${cells.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
		      void tableHeaderDone
		      continue
		    }
		    closeTable()
		    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
		    if (bullet !== null) {
		      if (listType !== 'ul') {
		        closeList()
		        out.push('<ul>')
		        listType = 'ul'
		      }
		      out.push(`<li>${inline(bullet[1])}</li>`)
		      continue
		    }
		    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
		    if (ordered !== null) {
		      if (listType !== 'ol') {
		        closeList()
		        out.push('<ol>')
		        listType = 'ol'
		      }
		      out.push(`<li>${inline(ordered[1])}</li>`)
		      continue
		    }
		    closeList()
		    out.push(`<p>${inline(line)}</p>`)
		  }
		  if (inCode) out.push('</code></pre>')
		  closeList()
		  closeTable()
		  return out.join('\n')
		}

		/** 生成一个轮次 id（时间戳 + 随机后缀，可读且不冲突）。 */
		function newRoundId() {
		  const now = new Date()
		  const pad = (value) => String(value).padStart(2, '0')
		  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
		  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
		}

		/** 字节数的人类可读形式。 */
		function humanSize(chars) {
		  if (chars < 1000) return `${chars} 字`
		  if (chars < 1000000) return `${(chars / 1000).toFixed(1)}k 字`
		  return `${(chars / 1000000).toFixed(2)}M 字`
		}

		/** 毫秒的人类可读形式。 */
		function humanMs(ms) {
		  if (!Number.isFinite(ms) || ms < 0) return '—'
		  if (ms < 1000) return `${Math.round(ms)} ms`
		  return `${(ms / 1000).toFixed(1)} s`
		}

		/** token 用量摘要。 */
		function usageText(usage) {
		  if (usage === undefined || usage === null) return ''
		  const input = usage.inputTokens ?? usage.promptTokens
		  const output = usage.outputTokens ?? usage.completionTokens
		  const parts = []
		  if (input !== undefined) parts.push(`入 ${input}`)
		  if (output !== undefined) parts.push(`出 ${output}`)
		  if (parts.length === 0) return ''
		  return parts.join(' · ')
		}

		/** 状态的中文标签。 */
		const STATUS_LABEL = {
		  idle: '待运行',
		  running: '流式中',
		  completed: '已完成',
		  failed: '失败',
		  cancelled: '已取消',
		  truncated: '被截断',
		  empty: '空回答',
		  pending: '排队中',
		}

		/** 状态对应的圆点样式类。 */
		const STATUS_DOT = {
		  idle: 'mmd-dot',
		  running: 'mmd-dot mmd-dot-run',
		  completed: 'mmd-dot mmd-dot-ok',
		  failed: 'mmd-dot mmd-dot-err',
		  cancelled: 'mmd-dot mmd-dot-warn',
		  truncated: 'mmd-dot mmd-dot-warn',
		  empty: 'mmd-dot mmd-dot-warn',
		  pending: 'mmd-dot',
		}

		// ---- inlined: src/client/remote.js ----
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
		function describeRemoteError(error) {
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
		function createRemoteAccess(_ctx) {
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
		async function consumeStream(iterable, onEvent) {
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

		// ---- inlined: src/client/store.js ----
		/**
		 * 面板状态容器。
		 *
		 * 官方约定：跨条目或跨重挂载存活的状态放进 `slots.register` 声明的 store，
		 * 而不是模块级单例。这里的容器由 `slots.register(..., { store })` 提供，
		 * 组件通过 props 拿到它，因此热重载/切面板不会丢状态。
		 *
		 * 容器刻意做成"可变对象 + 版本号"：面板里的流式更新每秒可能上百次，
		 * 用不可变重建会产生大量垃圾；显式 `update()` 在需要重渲染时提交一次。
		 */

		/**
		 * 创建面板状态容器。
		 * @returns 容器工厂（每次调用给一份新状态，符合 slot store 契约）。
		 */
		function createDashboardStore() {
		  return {
		    /** 当前状态对象；组件首渲染时惰性初始化。 */
		    current: null,
		    /** 订阅者（由组件注册）。 */
		    listeners: new Set(),
		    /** 变更计数，用于触发 React 重渲染。 */
		    version: 0,
		  }
		}

		/** 初始状态。 */
		function initialState() {
		  return {
		    routes: [],
		    routesError: undefined,
		    lanes: [],
		    question: '',
		    materials: [],
		    title: '',
		    notice: undefined,
		    noticeKind: 'info',
		    running: false,
		    roundId: undefined,
		    snapshot: undefined,
		    lastRound: undefined,
		    lastManifest: undefined,
		    reviewEnabled: false,
		    reviewLanes: {},
		    summaryEnabled: false,
		    summaryProvider: '',
		    summaryModel: '',
		    summaryText: '',
		    summaryStatus: 'idle',
		    summaryFailure: undefined,
		    history: [],
		    historyOpen: false,
		    mock: false,
		    health: undefined,
		    narrowIndex: 0,
		  }
		}

		// ---- inlined: src/client/state.js ----
		/**
		 * Dashboard 主面板：把 model 栏、总结区、输入区与历史组装成整页。
		 *
		 * 这一层只做编排与状态流转；网络调用走 `remote.js`，渲染走 `lanes-ui.js`，
		 * 纯函数走 `format.js`。
		 */

		/**
		 * 状态机的运行时容器：用一个 ref 存可变数据，用 tick 触发重渲染。
		 *
		 * 注意：签名不接参数。早期版本写成 `useDashboard(runtime)`，但调用方
		 * `DashboardPanel` 是无参调用，且面板需要的一切都来自 props —— 参数纯属
		 * 误导，这里去掉以免读者以为运行时是从这里注入的。
		 */
		function useDashboard() {
		  const [version, setVersion] = useState(0)
		  const stateRef = useRef(null)
		  if (stateRef.current === null) {
		    stateRef.current = {
		      routes: [],
		      routesError: undefined,
		      lanes: DEFAULT_LANES.map((route) => blankLane(route.provider, route.model)),
		      question: '',
		      materials: [],
		      title: '',
		      notice: undefined,
		      noticeKind: 'info',
		      running: false,
		      roundId: undefined,
		      snapshot: undefined,
		      lastRound: undefined,
		      reviewEnabled: false,
		      reviewLanes: {},
		      summaryEnabled: false,
		      summaryProvider: '',
		      summaryModel: '',
		      summaryText: '',
		      summaryStatus: 'idle',
		      summaryFailure: undefined,
		      history: [],
		      historyOpen: false,
		      mock: false,
		      health: undefined,
		      narrowIndex: 0,
		    }
		  }
		  const state = stateRef.current
		  const update = useCallback(() => setVersion((value) => value + 1), [])
		  return { state, update, version }
		}

		/** 设置一条提示信息。 */
		function setNotice(state, kind, text) {
		  state.notice = text
		  state.noticeKind = kind
		}

		/** 从一条 lane 事件更新栏状态。 */
		function applyLaneEvent(lane, event) {
		  switch (event.kind) {
		    case 'lane-start':
		      lane.status = 'running'
		      lane.text = ''
		      lane.reviewText = ''
		      lane.failure = undefined
		      lane.usage = undefined
		      lane.elapsedMs = undefined
		      lane.firstTokenMs = undefined
		      lane.note = undefined
		      lane.reasoningChars = 0
		      break
		    case 'thinking':
		      lane.reasoningChars = event.reasoningChars
		      break
		    case 'delta':
		      lane.text += event.text
		      break
		    case 'lane-final':
		      lane.text = typeof event.text === 'string' && event.text.length > 0 ? event.text : lane.text
		      lane.status = event.status ?? 'completed'
		      lane.usage = event.usage
		      lane.elapsedMs = event.elapsedMs
		      lane.firstTokenMs = event.firstTokenMs
		      lane.manifest = event.manifest
		      // 后端对「空回答」给出的成因说明，界面要如实转达（不要吞掉）。
		      lane.note = event.note
		      lane.reasoningChars = event.reasoningChars
		      lane.finish = event.finish
		      if (event.finish?.kind === 'unknown') lane.failure = event.finish.failure
		      if (event.finish?.kind === 'error' || event.finish?.kind === 'aborted') {
		        lane.failure = event.finish.failure ?? { code: event.finish.kind.toUpperCase(), message: '请求未正常完成' }
		      }
		      break
		    case 'lane-failed':
		      lane.status = 'failed'
		      lane.failure = { code: event.code ?? 'dashboard/lane-failed', message: event.message ?? '未知失败' }
		      break
		    default:
		      break
		  }
		}

		// ---- inlined: src/client/lanes-ui.js ----
		/**
		 * 浏览器半的入口与 Dashboard 主组件。
		 *
		 * 面板结构：
		 * - 顶部：标题「多模型工作台」+ 副标题 + 真实渠道状态 + 设置入口
		 * - 第二行：讨论标题、参与模型数量、「+ 添加模型」
		 * - 主体：等宽并排模型栏（可增减、各自选模型、独立滚动、状态可见、可切独立回答/互评）
		 * - 卡片下方：全宽可展开「总结评价」区（含总结模型选择、材料范围清单）
		 * - 底部：全宽统一输入框 + 工具栏（添加资料 / 一轮互评 / 总结评价 / 发送给所选模型）
		 * - 历史：本地保存轮次与原文，可恢复、可导出 JSON 或 Markdown
		 *
		 * 组件不接触 `ctx`：所有数据经 `apply` 注入的 props 传入（官方 UI 插件约定）。
		 */
		// ---- inlined: src/client/format.js ----

		// ---- inlined: src/client/remote.js ----

		// ---- inlined: src/client/styles.js ----
		/**
		 * 样式：一次注入到 document.head。
		 *
		 * 官方 UI 插件约定样式用 CSS Modules + `--dsw-*` 语义 token。本插件是仓外
		 * 独立包、没有 CSS Modules 构建步骤，因此用**同一个注入协议**（`data-plugin-css`
		 * 标记 + `<style>` 标签）承载普通 CSS，并全部走 `--dsw-*` token，
		 * 在 token 缺失时回退到预设浅色值（暖白/白卡片/细灰边框/
		 * 12px 圆角/绿色主按钮）。这样既不引入组件库，也不写"假"主题。
		 */
		const CSS = `
		.mmd-root {
		  --mmd-bg: var(--dsw-alias-bg-base, #faf9f7);
		  --mmd-card: var(--dsw-alias-bg-layer-1, #ffffff);
		  --mmd-border: var(--dsw-alias-border-l1, #e5e3df);
		  --mmd-border-strong: var(--dsw-alias-border-l2, #d6d3ce);
		  --mmd-text: var(--dsw-alias-label-primary, #1f1e1c);
		  --mmd-text-2: var(--dsw-alias-label-secondary, #5c5a56);
		  --mmd-text-3: var(--dsw-alias-label-tertiary, #8a8782);
		  --mmd-fill: var(--dsw-alias-fill-l2, #f3f1ee);
		  --mmd-primary: var(--dsw-alias-brand-primary, #1f9d55);
		  --mmd-primary-text: #ffffff;
		  --mmd-danger: var(--dsw-alias-state-error-primary, #c0392b);
		  --mmd-warn: var(--dsw-alias-state-warning-primary, #b7791f);
		  --mmd-ok: var(--dsw-alias-state-success-primary, #1f9d55);
		  --mmd-radius: 12px;
		  --mmd-radius-sm: 8px;
		  --mmd-shadow: 0 1px 2px rgba(0,0,0,.04), 0 2px 8px rgba(0,0,0,.04);

		  box-sizing: border-box;
		  height: 100%;
		  width: 100%;
		  min-width: 0;
		  overflow: hidden auto;
		  background: var(--mmd-bg);
		  color: var(--mmd-text);
		  font-size: 14px;
		  line-height: 1.6;
		  padding: 16px 18px 24px;
		  display: flex;
		  flex-direction: column;
		  gap: 12px;
		}
		.mmd-root *, .mmd-root *::before, .mmd-root *::after { box-sizing: border-box; }

		/* ---------- 顶部 ---------- */
		.mmd-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex: none; }
		.mmd-title { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: .01em; }
		.mmd-subtitle { margin: 2px 0 0; color: var(--mmd-text-2); font-size: 13px; }
		.mmd-headerRight { display: flex; align-items: center; gap: 8px; flex: none; }

		.mmd-statusPill {
		  display: inline-flex; align-items: center; gap: 6px;
		  padding: 4px 10px; border-radius: 999px;
		  border: 1px solid var(--mmd-border); background: var(--mmd-card);
		  font-size: 12px; color: var(--mmd-text-2);
		}
		.mmd-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--mmd-text-3); }
		.mmd-dot-ok { background: var(--mmd-ok); }
		.mmd-dot-warn { background: var(--mmd-warn); }
		.mmd-dot-err { background: var(--mmd-danger); }
		.mmd-dot-run { background: var(--mmd-primary); animation: mmd-pulse 1.1s ease-in-out infinite; }
		@keyframes mmd-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

		/* ---------- 第二行 ---------- */
		.mmd-bar {
		  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
		  background: var(--mmd-card); border: 1px solid var(--mmd-border);
		  border-radius: var(--mmd-radius); padding: 10px 12px; box-shadow: var(--mmd-shadow);
		  flex: none;
		}
		.mmd-barLabel { font-size: 12px; color: var(--mmd-text-3); }
		.mmd-topic {
		  flex: 1 1 220px; min-width: 160px;
		  border: 1px solid var(--mmd-border); border-radius: var(--mmd-radius-sm);
		  background: var(--mmd-bg); color: var(--mmd-text);
		  padding: 6px 10px; font: inherit; font-size: 13px;
		}
		.mmd-topic:focus { outline: 2px solid color-mix(in srgb, var(--mmd-primary) 40%, transparent); outline-offset: -1px; }

		/* ---------- 按钮 ---------- */
		.mmd-btn {
		  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
		  border: 1px solid var(--mmd-border-strong); background: var(--mmd-card); color: var(--mmd-text);
		  border-radius: var(--mmd-radius-sm); padding: 6px 12px; font: inherit; font-size: 13px;
		  cursor: pointer; white-space: nowrap; transition: background .12s, border-color .12s, opacity .12s;
		}
		.mmd-btn:hover:not(:disabled) { background: var(--mmd-fill); }
		.mmd-btn:disabled { opacity: .45; cursor: not-allowed; }
		.mmd-btnPrimary {
		  background: var(--mmd-primary); border-color: var(--mmd-primary); color: var(--mmd-primary-text); font-weight: 550;
		}
		.mmd-btnPrimary:hover:not(:disabled) { filter: brightness(1.06); background: var(--mmd-primary); }
		.mmd-btnGhost { border-color: transparent; background: transparent; color: var(--mmd-text-2); padding: 5px 8px; }
		.mmd-btnGhost:hover:not(:disabled) { background: var(--mmd-fill); color: var(--mmd-text); }
		.mmd-btnDanger { color: var(--mmd-danger); border-color: color-mix(in srgb, var(--mmd-danger) 35%, var(--mmd-border)); }
		.mmd-btnSm { padding: 3px 8px; font-size: 12px; }
		.mmd-btnOn { border-color: var(--mmd-primary); color: var(--mmd-primary); background: color-mix(in srgb, var(--mmd-primary) 8%, var(--mmd-card)); }

		/* ---------- 并排模型栏 ---------- */
		.mmd-lanes {
		  display: flex; gap: 12px; align-items: stretch;
		  overflow-x: auto; overflow-y: hidden;
		  padding-bottom: 6px; flex: 1 1 auto; min-height: 340px;
		}
		.mmd-laneWrapper {
		  display: flex; flex: 1 0 320px; min-width: 320px;
		}
		.mmd-lane {
		  display: flex; flex-direction: column; min-width: 0; width: 100%;
		  flex: 1 1 auto;
		  background: var(--mmd-card); border: 1px solid var(--mmd-border);
		  border-radius: var(--mmd-radius); box-shadow: var(--mmd-shadow); overflow: hidden;
		}
		.mmd-laneFailed { border-color: color-mix(in srgb, var(--mmd-danger) 45%, var(--mmd-border)); }
		.mmd-laneCancelled { border-color: color-mix(in srgb, var(--mmd-warn) 45%, var(--mmd-border)); }
		.mmd-laneHead {
		  display: flex; flex-direction: column; gap: 6px;
		  padding: 10px 12px; border-bottom: 1px solid var(--mmd-border); flex: none;
		}
		.mmd-laneHeadRow { display: flex; align-items: center; gap: 8px; }
		.mmd-laneHeadRow > .mmd-select { flex: 1 1 0; width: 0; }
		.mmd-laneHeadRow > .mmd-btn { flex: none; }
		.mmd-select {
		  flex: 1 1 auto; min-width: 0;
		  border: 1px solid var(--mmd-border); border-radius: var(--mmd-radius-sm);
		  background: var(--mmd-bg); color: var(--mmd-text); padding: 5px 8px; font: inherit; font-size: 13px;
		}
		.mmd-laneMeta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--mmd-text-3); }
		.mmd-stateBadge {
		  display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px;
		  border: 1px solid var(--mmd-border); background: var(--mmd-fill); font-size: 12px; color: var(--mmd-text-2);
		}
		.mmd-state-running { color: var(--mmd-primary); border-color: color-mix(in srgb, var(--mmd-primary) 40%, var(--mmd-border)); }
		.mmd-state-completed { color: var(--mmd-ok); border-color: color-mix(in srgb, var(--mmd-ok) 40%, var(--mmd-border)); }
		.mmd-state-failed { color: var(--mmd-danger); border-color: color-mix(in srgb, var(--mmd-danger) 40%, var(--mmd-border)); }
		.mmd-state-cancelled, .mmd-state-truncated { color: var(--mmd-warn); border-color: color-mix(in srgb, var(--mmd-warn) 40%, var(--mmd-border)); }

		.mmd-tabs { display: inline-flex; gap: 2px; background: var(--mmd-fill); border-radius: 999px; padding: 2px; }
		.mmd-tab {
		  border: 0; background: transparent; color: var(--mmd-text-2); font: inherit; font-size: 12px;
		  padding: 3px 10px; border-radius: 999px; cursor: pointer;
		}
		.mmd-tabOn { background: var(--mmd-card); color: var(--mmd-text); box-shadow: var(--mmd-shadow); }
		.mmd-tab:disabled { opacity: .4; cursor: not-allowed; }

		.mmd-laneBody {
		  flex: 1 1 auto; overflow-y: auto; padding: 12px;
		  white-space: pre-wrap; word-break: break-word; min-height: 160px;
		}
		.mmd-laneBodyMuted { color: var(--mmd-text-3); font-style: normal; }
		.mmd-md { white-space: normal; }
		.mmd-md h1, .mmd-md h2, .mmd-md h3, .mmd-md h4 { margin: .7em 0 .35em; font-size: 1em; font-weight: 650; }
		.mmd-md h1 { font-size: 1.18em } .mmd-md h2 { font-size: 1.1em } .mmd-md h3 { font-size: 1.02em }
		.mmd-md p { margin: .45em 0 }
		.mmd-md ul, .mmd-md ol { margin: .45em 0; padding-left: 1.4em }
		.mmd-md li { margin: .15em 0 }
		.mmd-md code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: .9em;
		  background: var(--mmd-fill); border-radius: 4px; padding: 1px 4px; }
		.mmd-md pre { background: var(--mmd-fill); border: 1px solid var(--mmd-border); border-radius: var(--mmd-radius-sm);
		  padding: 8px 10px; overflow-x: auto; margin: .5em 0 }
		.mmd-md pre code { background: none; padding: 0 }
		.mmd-md blockquote { margin: .5em 0; padding-left: 10px; border-left: 3px solid var(--mmd-border-strong); color: var(--mmd-text-2) }
		.mmd-md table { border-collapse: collapse; margin: .5em 0; font-size: .95em }
		.mmd-md th, .mmd-md td { border: 1px solid var(--mmd-border); padding: 4px 8px; text-align: left }
		.mmd-md th { background: var(--mmd-fill) }
		.mmd-md a { color: var(--mmd-primary) }
		.mmd-md hr { border: 0; border-top: 1px solid var(--mmd-border); margin: .8em 0 }

		.mmd-caret { display: inline-block; width: 7px; height: 1em; vertical-align: -2px;
		  background: var(--mmd-primary); animation: mmd-pulse 1s steps(2) infinite; margin-left: 2px; border-radius: 1px }

		.mmd-failure {
		  margin: 0 12px 12px; padding: 8px 10px; border-radius: var(--mmd-radius-sm);
		  background: color-mix(in srgb, var(--mmd-danger) 7%, var(--mmd-card));
		  border: 1px solid color-mix(in srgb, var(--mmd-danger) 30%, var(--mmd-border));
		  color: var(--mmd-danger); font-size: 12px; white-space: pre-wrap; word-break: break-word;
		}
		.mmd-laneFoot {
		  display: flex; align-items: center; gap: 6px; padding: 8px 10px;
		  border-top: 1px solid var(--mmd-border); flex: none; flex-wrap: wrap;
		}

		/* ---------- 总结区 ---------- */
		.mmd-card {
		  background: var(--mmd-card); border: 1px solid var(--mmd-border);
		  border-radius: var(--mmd-radius); box-shadow: var(--mmd-shadow); flex: none;
		}
		.mmd-cardHead {
		  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
		  border-bottom: 1px solid var(--mmd-border); flex-wrap: wrap;
		}
		.mmd-cardHeadPlain { border-bottom: 0; }
		.mmd-cardTitle { font-weight: 600; font-size: 14px; }
		.mmd-cardBody { padding: 12px; }
		.mmd-spacer { flex: 1 1 auto }

		.mmd-manifest {
		  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		  font-size: 11.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-word;
		  background: var(--mmd-fill); border: 1px solid var(--mmd-border);
		  border-radius: var(--mmd-radius-sm); padding: 8px 10px; color: var(--mmd-text-2);
		  max-height: 220px; overflow: auto; margin: 0;
		}
		.mmd-hint { color: var(--mmd-text-3); font-size: 12px; }

		/* ---------- 输入区 ---------- */
		.mmd-composer { display: flex; flex-direction: column; gap: 8px; flex: none; }
		.mmd-textarea {
		  width: 100%; min-height: 74px; max-height: 260px; resize: vertical;
		  border: 1px solid var(--mmd-border); border-radius: var(--mmd-radius-sm);
		  background: var(--mmd-bg); color: var(--mmd-text); padding: 9px 11px; font: inherit; font-size: 14px;
		}
		.mmd-textarea:focus { outline: 2px solid color-mix(in srgb, var(--mmd-primary) 40%, transparent); outline-offset: -1px; }
		.mmd-attachments { display: flex; flex-wrap: wrap; gap: 6px; }
		.mmd-chip {
		  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
		  border: 1px solid var(--mmd-border); background: var(--mmd-fill);
		  border-radius: 999px; padding: 3px 6px 3px 10px; font-size: 12px; color: var(--mmd-text-2);
		}
		.mmd-chipName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px }
		.mmd-chipBad { border-color: color-mix(in srgb, var(--mmd-danger) 40%, var(--mmd-border)); color: var(--mmd-danger); }
		.mmd-chipX { border: 0; background: transparent; cursor: pointer; color: inherit; font-size: 14px; line-height: 1; padding: 0 4px }
		.mmd-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
		.mmd-notice {
		  padding: 8px 10px; border-radius: var(--mmd-radius-sm); font-size: 12.5px;
		  border: 1px solid var(--mmd-border); background: var(--mmd-fill); color: var(--mmd-text-2);
		  white-space: pre-wrap; word-break: break-word;
		}
		.mmd-noticeErr { border-color: color-mix(in srgb, var(--mmd-danger) 35%, var(--mmd-border));
		  background: color-mix(in srgb, var(--mmd-danger) 6%, var(--mmd-card)); color: var(--mmd-danger) }
		.mmd-noticeWarn { border-color: color-mix(in srgb, var(--mmd-warn) 35%, var(--mmd-border));
		  background: color-mix(in srgb, var(--mmd-warn) 8%, var(--mmd-card)); color: var(--mmd-warn) }
		.mmd-noticeOk { border-color: color-mix(in srgb, var(--mmd-ok) 35%, var(--mmd-border));
		  background: color-mix(in srgb, var(--mmd-ok) 7%, var(--mmd-card)); color: var(--mmd-ok) }

		/* ---------- 历史 ---------- */
		.mmd-historyList { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow: auto }
		.mmd-historyRow {
		  display: flex; align-items: center; gap: 8px; padding: 7px 9px;
		  border: 1px solid var(--mmd-border); border-radius: var(--mmd-radius-sm); background: var(--mmd-bg);
		}
		.mmd-historyMain { flex: 1 1 auto; min-width: 0 }
		.mmd-historyQ { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
		.mmd-historyMeta { font-size: 11.5px; color: var(--mmd-text-3) }

		.mmd-empty { color: var(--mmd-text-3); font-size: 13px; padding: 12px; text-align: center }

		/* 窄屏：并排改为可切换栏位 */
		@media (max-width: 860px) {
		  .mmd-lanes { flex-direction: column; overflow-x: hidden; }
		  .mmd-laneWrapper { flex: 1 1 auto; width: 100%; min-width: 0; max-width: none; }
		  .mmd-lane { max-width: none; min-width: 0; }
		  .mmd-laneHidden { display: none }
		}
		`

		const TAG_ID = 'dsh-multimodel-dashboard/dashboard.css'

		/** 注入样式；热更新时替换已有内容，避免保留旧布局。 */
		function installStyles() {
		  if (typeof document === 'undefined') return
		  const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(TAG_ID)}]`)
		  if (existing !== null) {
		    if (existing.textContent !== CSS) existing.textContent = CSS
		    return
		  }
		  const tag = document.createElement('style')
		  tag.dataset.plugin = 'dsh-multimodel-dashboard'
		  tag.dataset.pluginCss = TAG_ID
		  tag.textContent = CSS
		  document.head.appendChild(tag)
		}


		/** 默认两栏：DeepSeek + GLM。 */
		const DEFAULT_LANES = [
		  { provider: 'wokey-text', model: 'deepseek-flash' },
		  { provider: 'wokey-text', model: 'glm-5.3-flash' },
		]

		/** 每个模型的默认最大输出（用户日常设置，与测试上限无关）。 */
		const DEFAULT_MAX_TOKENS = 8192

		function defaultOutputTokens(model) {
		  return /^glm-/i.test(model ?? '') ? 16384 : DEFAULT_MAX_TOKENS
		}

		let laneSeq = 0
		/** 生成稳定的 lane 标识。 */
		function newLaneId() {
		  laneSeq += 1
		  return `lane-${Date.now().toString(36)}-${laneSeq}`
		}

		/** 新建一个空栏状态。 */
		function blankLane(provider, model) {
		  return {
		    laneId: newLaneId(),
		    provider: provider ?? '',
		    model: model ?? '',
		    maxTokens: defaultOutputTokens(model),
		    status: 'idle',
		    text: '',
		    reviewText: '',
		    tab: 'answer',
		    usage: undefined,
		    elapsedMs: undefined,
		    firstTokenMs: undefined,
		    failure: undefined,
		    manifest: undefined,
		    // 该栏自己的对话记忆（旧 -> 新）。每栏一份，互不相通。
		    turns: [],
		  }
		}

		let materialSeq = 0

		/**
		 * 读取一个文件并判断格式。不支持的格式返回明确错误，不做静默忽略。
		 *
		 * 提示语原则（用户要求）：**一句话说清"这个文件不能用、你能用什么"**。
		 * 不要长篇解释，不要只说"格式错误"也不给替代方案——用户看完必须知道下一步做什么。
		 * @param file - File 对象。
		 * @returns `{ material }` 或 `{ error }`。
		 */
		async function readMaterialFile(file) {
		  const format = detectFormat(file.name)
		  if (format === undefined) {
		    const ext = (String(file.name).match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()
		    return {
		      error: `《${file.name}》${ext.length > 0 ? `（.${ext}）` : ''}这种格式读不了。请改用 .txt / .md / .csv 文件。`,
		    }
		  }
		  if (file.size > MAX_MATERIAL_CHARS * 4) {
		    return {
		      error: `《${file.name}》太大了（${Math.round(file.size / 1024)} KB）。单个文件请控制在 ${Math.round(MAX_MATERIAL_CHARS / 1000)} 千字以内。`,
		    }
		  }
		  let text
		  try {
		    text = await file.text()
		  } catch (error) {
		    return { error: `《${file.name}》读不出来：${String(error?.message ?? error)}` }
		  }
		  if (text.length > MAX_MATERIAL_CHARS) {
		    return {
		      error: `《${file.name}》内容太长（${text.length} 字）。请拆成几个小文件，每个 ${Math.round(MAX_MATERIAL_CHARS / 1000)} 千字以内。`,
		    }
		  }
		  materialSeq += 1
		  return {
		    material: { id: `material-${materialSeq}`, name: file.name, format, text, hash: contentHash(text) },
		  }
		}

		/** 触发浏览器下载。 */
		function downloadText(filename, text) {
		  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
		  const url = URL.createObjectURL(blob)
		  const anchor = document.createElement('a')
		  anchor.href = url
		  anchor.download = filename
		  document.body.appendChild(anchor)
		  anchor.click()
		  document.body.removeChild(anchor)
		  setTimeout(() => URL.revokeObjectURL(url), 5000)
		}

		/** 复制到剪贴板（失败返回 false，由界面如实提示）。 */
		async function copyText(text) {
		  try {
		    await navigator.clipboard.writeText(text)
		    return true
		  } catch {
		    return false
		  }
		}

		/**
		 * 模型下拉框：按渠道分组列出真实模型。
		 * @param props - routes、当前值、变更回调。
		 */
		function ModelSelect({ routes, provider, model, disabled, onChange }) {
		  const usable = routes.filter((route) => route.models.length > 0)
		  const currentValue = provider.length > 0 && model.length > 0 ? `${provider}::${model}` : ''
		  return jsx('select', {
		    className: 'mmd-select',
		    value: currentValue,
		    disabled: disabled === true || usable.length === 0,
		    'aria-label': '选择模型',
		    onChange: (event) => {
		      const parts = String(event.target.value).split('::')
		      onChange({ provider: parts[0] ?? '', model: parts[1] ?? '' })
		    },
		    children: [
		      jsx('option', { value: '', children: usable.length === 0 ? '无可用模型' : '选择模型…' }, '__none'),
		      ...usable.flatMap((route) =>
		        route.models.map((entry) =>
		          jsx(
		            'option',
		            {
		              value: `${route.id}::${entry.id}`,
		              children: `${route.name} · ${entry.name}`,
		            },
		            `${route.id}::${entry.id}`,
		          ),
		        ),
		      ),
		    ],
		  })
		}

		/**
		 * 单栏卡片。
		 * @param props - 栏状态与全部回调。
		 */
		function LaneCard({ lane, index, routes, laneCount, locked, onRoute, onBudget, onRemove, onStop, onRetry, onTab, onCopy }) {
		  const isRunning = lane.status === 'running'
		  const bodyText = lane.tab === 'review' ? lane.reviewText : lane.text
		  const hasReview = lane.reviewText.length > 0
		  const routeReady = lane.provider.length > 0 && lane.model.length > 0
		  const classes = ['mmd-lane']
		  if (lane.status === 'failed') classes.push('mmd-laneFailed')
		  if (lane.status === 'cancelled' || lane.status === 'truncated') classes.push('mmd-laneCancelled')

		  // 注意：`react/jsx-runtime` 的签名是 `jsx(type, props, key)` —— key 是**第三个
		  // 参数**，不能塞进 props 对象。塞进 props 时 React 18 会打印 "key prop is being
		  // spread" 警告（React 19 更严），因此这里一律走三参数形式。
		  const meta = [
		    jsxs(
		      'span',
		      {
		        className: `mmd-stateBadge mmd-state-${lane.status}`,
		        children: [
		          jsx('span', { className: STATUS_DOT[lane.status] ?? 'mmd-dot' }),
		          STATUS_LABEL[lane.status] ?? lane.status,
		        ],
		      },
		      'state',
		    ),
		  ]
		  if (lane.firstTokenMs !== undefined) meta.push(jsx('span', { children: `首字 ${humanMs(lane.firstTokenMs)}` }, 'ttft'))
		  if (lane.elapsedMs !== undefined) meta.push(jsx('span', { children: `耗时 ${humanMs(lane.elapsedMs)}` }, 'ms'))
		  if (usageText(lane.usage).length > 0) meta.push(jsx('span', { children: usageText(lane.usage) }, 'usage'))
		  if (isRunning && lane.reasoningChars > 0) meta.push(jsx('span', { children: `正在思考 · 已收到 ${lane.reasoningChars} 字推理` }, 'thinking'))
		  // 该栏自己记得几轮 —— 这是"独立上下文"最直接的可见证据。
		  // 各栏数字可以不同（某栏某轮失败就不记入历史）。
		  const memory = Array.isArray(lane.turns) ? lane.turns.length : 0
		  if (memory > 0) meta.push(jsx('span', { className: 'mmd-hint', title: '该栏自己记得的历史轮数（各栏互不相通）', children: `记忆 ${memory} 轮` }, 'memory'))
		  if (!routeReady && !isRunning) meta.push(jsx('span', { className: 'mmd-hint', children: '未选择模型' }, 'none'))

		  const tabs = hasReview
		    ? jsxs('div', {
		        className: 'mmd-tabs',
		        children: [
		          jsx('button', {
		            type: 'button',
		            className: lane.tab === 'answer' ? 'mmd-tab mmd-tabOn' : 'mmd-tab',
		            onClick: () => onTab(index, 'answer'),
		            children: '独立回答',
		          }),
		          jsx('button', {
		            type: 'button',
		            className: lane.tab === 'review' ? 'mmd-tab mmd-tabOn' : 'mmd-tab',
		            onClick: () => onTab(index, 'review'),
		            children: '互评',
		          }),
		        ],
		      })
		    : null

		  const foot = [
		    jsx('select', {
		      className: 'mmd-select',
		      'aria-label': '回答输出额度',
		      title: '推理和正文共用输出额度；长回答可提高额度',
		      value: lane.maxTokens ?? defaultOutputTokens(lane.model),
		      disabled: isRunning,
		      onChange: (event) => onBudget?.(index, Number(event.target.value)),
		      children: [8192, 16384, 32768].map((value) => jsx('option', { value, children: `输出 ${value / 1024}k` }, String(value))),
		    }, 'budget'),
		    jsx(
		      'button',
		      {
		        type: 'button',
		        className: 'mmd-btn mmd-btnSm mmd-btnGhost',
		        disabled: bodyText.length === 0,
		        onClick: () => onCopy(bodyText),
		        children: '复制',
		      },
		      'copy',
		    ),
		  ]
		  if (isRunning) {
		    foot.push(
		      jsx(
		        'button',
		        {
		          type: 'button',
		          className: 'mmd-btn mmd-btnSm mmd-btnDanger',
		          onClick: () => onStop(lane.laneId),
		          children: '停止',
		        },
		        'stop',
		      ),
		    )
		  } else {
		    foot.push(
		      jsx(
		        'button',
		        {
		          type: 'button',
		          className: 'mmd-btn mmd-btnSm',
		          disabled: locked || !routeReady,
		          title: locked ? '本轮运行中' : '只重跑这一栏',
		          onClick: () => onRetry(lane.laneId),
		          children: '重试',
		        },
		        'retry',
		      ),
		    )
		  }

		  return jsxs('div', {
		    className: classes.join(' '),
		    children: [
		      jsxs('div', {
		        className: 'mmd-laneHead',
		        children: [
		          jsxs('div', {
		            className: 'mmd-laneHeadRow',
		            children: [
		              jsx(ModelSelect, {
		                routes,
		                provider: lane.provider,
		                model: lane.model,
		                disabled: isRunning,
		                onChange: (next) => onRoute(index, next),
		              }),
		              jsx('button', {
		                type: 'button',
		                className: 'mmd-btn mmd-btnGhost mmd-btnSm',
		                title: laneCount <= 1 ? '至少保留一栏' : '移除该栏',
		                disabled: laneCount <= 1 || isRunning,
		                onClick: () => onRemove(index),
		                children: '移除',
		              }),
		            ],
		          }),
		          jsxs('div', { className: 'mmd-laneMeta', children: meta }),
		          tabs,
		        ].filter(Boolean),
		      }),
		      jsx('div', {
		        className: 'mmd-laneBody',
		        children:
		          bodyText.length === 0
		            ? jsx('span', {
		                className: 'mmd-laneBodyMuted',
		                children: isRunning
		                  ? lane.reasoningChars > 0 ? '模型正在思考，等待正文…' : '等待模型输出…'
		                  : lane.status === 'idle' ? '尚未运行。填写下方输入框后点击「发送给所选模型」。' : '本次请求尚未返回正文，请查看下方提示。',
		              })
		            : jsxs(Fragment, {
		                children: [
		                  jsx('div', {
		                    className: 'mmd-md',
		                    dangerouslySetInnerHTML: { __html: renderMarkdown(bodyText) },
		                  }),
		                  isRunning ? jsx('span', { className: 'mmd-caret' }) : null,
		                ],
		              }),
		      }),
		      lane.failure !== undefined
		        ? jsx('div', {
		            className: 'mmd-failure',
		            children: `${lane.failure.code ?? 'ERROR'}：${lane.failure.message ?? ''}`,
		          })
		        : null,
		      // 「空回答」不是失败，但也不能悄悄留白：把成因如实写在栏里。
		      lane.failure === undefined && lane.note !== undefined
		        ? jsx('div', { className: 'mmd-failure mmd-failureNote', children: lane.note })
		        : null,
		      jsxs('div', { className: 'mmd-laneFoot', children: foot }),
		    ].filter(Boolean),
		  })
		}

		// ---- inlined: src/client/components.js ----
		/**
		 * Dashboard 主面板：把模型栏、总结区、输入区与历史组装成整页。
		 *
		 * 这一层只做编排与状态流转：网络调用走 `remote.js`，渲染走 `lanes-ui.js`，
		 * 纯函数走 `format.js`，状态容器走 `state.js`。
		 */

		/** 顶部：标题 + 真实渠道状态 + 设置入口。 */
		function Header({ health, routes, onOpenSettings, onToggleHistory, historyCount, onRefreshModels, running }) {
		  const status = health === undefined
		    ? { dot: 'mmd-dot', text: '正在检查后端…' }
		    : health.ready !== true
		      ? { dot: 'mmd-dot mmd-dot-err', text: '后端未就绪' }
		      : routes.length === 0
		        ? { dot: 'mmd-dot mmd-dot-warn', text: '后端已就绪 · 无已配置渠道' }
		        : { dot: 'mmd-dot mmd-dot-ok', text: `后端已就绪 · ${routes.reduce((sum, route) => sum + route.models.length, 0)} 个模型` }

		  return jsxs('div', {
		    className: 'mmd-header',
		    children: [
		      jsxs('div', {
		        children: [
		          jsx('button', { type: 'button', className: 'mmd-btn mmd-btnSm', disabled: running, onClick: onRefreshModels, children: '同步模型' }),
		          jsx('h1', { className: 'mmd-title', children: '多模型工作台' }),
		          jsx('p', { className: 'mmd-subtitle', children: '同一问题 · 多方回答 · 汇总决策' }),
		        ],
		      }),
		      jsxs('div', {
		        className: 'mmd-headerRight',
		        children: [
		          jsxs('span', {
		            className: 'mmd-statusPill',
		            // 提示语只用后端返回的**非敏感**信息。刻意不显示宿主的文件路径
		            // （后端已不再返回 `roundsDir`，界面也从未需要它）。
		            title:
		              health === undefined
		                ? ''
		                : health.historyAvailable === true
		                  ? '历史记录保存在本机'
		                  : '历史记录不可用',
		            children: [jsx('span', { className: status.dot }), status.text],
		          }),
		          jsx('button', {
		            type: 'button',
		            className: historyCount > 0 ? 'mmd-btn mmd-btnSm mmd-btnOn' : 'mmd-btn mmd-btnSm',
		            onClick: onToggleHistory,
		            children: `历史${historyCount > 0 ? ` (${historyCount})` : ''}`,
		          }),
		          jsx('button', {
		            type: 'button',
		            className: 'mmd-btn mmd-btnSm mmd-btnGhost',
		            title: '打开 Harness 设置',
		            onClick: onOpenSettings,
		            children: '设置',
		          }),
		        ],
		      }),
		    ],
		  })
		}

		/** 第二行：讨论标题、参与模型数量、添加模型。 */
		function Toolbar({ title, laneCount, onTitle, onAddLane, narrow, narrowIndex, onNarrowIndex }) {
		  return jsxs('div', {
		    className: 'mmd-bar',
		    children: [
		      jsx('span', { className: 'mmd-barLabel', children: '讨论标题' }),
		      jsx('input', {
		        className: 'mmd-topic',
		        value: title,
		        placeholder: '可留空，保存时用问题首行',
		        'aria-label': '讨论标题',
		        onChange: (event) => onTitle(event.target.value),
		      }),
		      jsx('span', { className: 'mmd-barLabel', children: `参与模型 ${laneCount} 个` }),
		      narrow && laneCount > 1
		        ? jsxs('div', {
		            className: 'mmd-tabs',
		            children: [
		              jsx('button', {
		                type: 'button',
		                className: 'mmd-tab',
		                disabled: narrowIndex <= 0,
		                onClick: () => onNarrowIndex(narrowIndex - 1),
		                children: '◀',
		              }),
		              jsx('span', { className: 'mmd-barLabel', children: `第 ${narrowIndex + 1} / ${laneCount} 栏` }),
		              jsx('button', {
		                type: 'button',
		                className: 'mmd-tab',
		                disabled: narrowIndex >= laneCount - 1,
		                onClick: () => onNarrowIndex(narrowIndex + 1),
		                children: '▶',
		              }),
		            ],
		          })
		        : null,
		      jsx('button', {
		        type: 'button',
		        className: 'mmd-btn mmd-btnSm',
		        onClick: onAddLane,
		        children: '+ 添加模型',
		      }),
		    ].filter(Boolean),
		  })
		}

		/** 总结评价区：总结模型选择 + 结果 + 材料范围清单。 */
		function SummarySection({
		  enabled,
		  onToggle,
		  routes,
		  provider,
		  model,
		  onRoute,
		  status,
		  text,
		  failure,
		  manifest,
		  included,
		  onRun,
		  canRun,
		  onCopy,
		}) {
		  return jsxs('div', {
		    className: 'mmd-card',
		    children: [
		      jsxs('div', {
		        className: 'mmd-cardHead',
		        children: [
		          jsx('span', { className: 'mmd-cardTitle', children: '总结评价' }),
		          jsxs('span', {
		            className: `mmd-stateBadge mmd-state-${status}`,
		            children: [jsx('span', { className: STATUS_DOT[status] ?? 'mmd-dot' }), STATUS_LABEL[status] ?? status],
		          }),
		          jsx('span', { className: 'mmd-spacer' }),
		          jsx('button', {
		            type: 'button',
		            className: enabled ? 'mmd-btn mmd-btnSm mmd-btnOn' : 'mmd-btn mmd-btnSm',
		            onClick: onToggle,
		            children: enabled ? '收起' : '展开',
		          }),
		        ],
		      }),
		      enabled
		        ? jsxs('div', {
		            className: 'mmd-cardBody',
		            children: [
		              jsxs('div', {
		                className: 'mmd-toolbar',
		                style: { marginBottom: '10px' },
		                children: [
		                  jsx('span', { className: 'mmd-barLabel', children: '总结模型' }),
		                  jsx(ModelSelect, { routes, provider, model, disabled: status === 'running', onChange: onRoute }),
		                  jsx('button', {
		                    type: 'button',
		                    className: 'mmd-btn mmd-btnSm mmd-btnPrimary',
		                    disabled: !canRun || status === 'running',
		                    title: canRun ? '把问题、资料、各栏原文与互评一起交给所选模型' : '请先选择总结模型并完成至少一轮回答',
		                    onClick: onRun,
		                    children: status === 'running' ? '总结中…' : '开始总结',
		                  }),
		                  text.length > 0
		                    ? jsx('button', {
		                        type: 'button',
		                        className: 'mmd-btn mmd-btnSm mmd-btnGhost',
		                        onClick: () => onCopy(text),
		                        children: '复制',
		                      })
		                    : null,
		                ].filter(Boolean),
		              }),
		              jsx('div', {
		                className: 'mmd-hint',
		                style: { marginBottom: '8px' },
		                children: '模型共识不等于事实证据。总结输出区分「共识」与「证据强度」，并列出缺失或被截断的材料。',
		              }),
		              text.length > 0
		                ? jsx('div', {
		                    className: 'mmd-md',
		                    dangerouslySetInnerHTML: { __html: renderMarkdown(text) },
		                  })
		                : jsx('div', {
		                    className: 'mmd-empty',
		                    children: status === 'running' ? '正在生成总结…' : '尚未生成总结。',
		                  }),
		              failure !== undefined
		                ? jsx('div', { className: 'mmd-failure', style: { margin: '10px 0 0' }, children: `${failure.code}：${failure.message}` })
		                : null,
		              included !== undefined
		                ? jsxs('div', {
		                    style: { marginTop: '12px' },
		                    children: [
		                      jsx('div', { className: 'mmd-cardTitle', style: { fontSize: '12.5px', marginBottom: '6px' }, children: '本轮已纳入的材料范围' }),
		                      jsx('pre', { className: 'mmd-manifest', children: included }),
		                    ],
		                  })
		                : null,
		              manifest !== undefined && manifest !== included
		                ? jsxs('div', {
		                    style: { marginTop: '10px' },
		                    children: [
		                      jsx('div', { className: 'mmd-cardTitle', style: { fontSize: '12.5px', marginBottom: '6px' }, children: '发送给总结模型的材料清单' }),
		                      jsx('pre', { className: 'mmd-manifest', children: manifest }),
		                    ],
		                  })
		                : null,
		            ].filter(Boolean),
		          })
		        : null,
		    ].filter(Boolean),
		  })
		}

		/** 历史列表。 */
		function HistorySection({ open, items, onToggle, onLoad, onDelete, onExport, onExportAll }) {
		  if (!open) return null
		  return jsxs('div', {
		    className: 'mmd-card',
		    children: [
		      jsxs('div', {
		        className: 'mmd-cardHead',
		        children: [
		          jsx('span', { className: 'mmd-cardTitle', children: '本地历史' }),
		          jsx('span', { className: 'mmd-hint', children: `${items.length} 轮 · 原文存在本机 profile 目录` }),
		          jsx('span', { className: 'mmd-spacer' }),
		          jsx('button', { type: 'button', className: 'mmd-btn mmd-btnSm mmd-btnGhost', onClick: onExportAll, children: '导出全部索引' }),
		          jsx('button', { type: 'button', className: 'mmd-btn mmd-btnSm mmd-btnGhost', onClick: onToggle, children: '收起' }),
		        ],
		      }),
		      jsx('div', {
		        className: 'mmd-cardBody',
		        children:
		          items.length === 0
		            ? jsx('div', { className: 'mmd-empty', children: '暂无历史。完成一轮后会自动保存。' })
		            : jsx('div', {
		                className: 'mmd-historyList',
		                children: items.map((item) =>
		                  jsxs(
		                    'div',
		                    {
		                      className: 'mmd-historyRow',
		                      children: [
		                        jsxs('div', {
		                          className: 'mmd-historyMain',
		                          children: [
		                            jsx('div', { className: 'mmd-historyQ', title: item.question, children: item.title || item.question || '(无标题)' }),
		                            jsx('div', {
		                              className: 'mmd-historyMeta',
		                              children: [
		                                item.savedAt,
		                                ` · ${item.laneCount} 栏`,
		                                item.hasReview ? ' · 含互评' : '',
		                                item.hasSummary ? ' · 含总结' : '',
		                                item.mock ? ' · MOCK' : '',
		                              ].join(''),
		                            }),
		                          ],
		                        }),
		                        jsx('button', { type: 'button', className: 'mmd-btn mmd-btnSm', onClick: () => onLoad(item.roundId), children: '打开' }),
		                        jsx('button', { type: 'button', className: 'mmd-btn mmd-btnSm mmd-btnGhost', onClick: () => onExport(item.roundId), children: '导出' }),
		                        jsx('button', { type: 'button', className: 'mmd-btn mmd-btnSm mmd-btnGhost mmd-btnDanger', onClick: () => onDelete(item.roundId), children: '删除' }),
		                      ],
		                    },
		                    item.roundId,
		                  ),
		                ),
		              }),
		      }),
		    ],
		  })
		}

		/** 底部统一输入框与工具栏。 */
		function Composer({
		  question,
		  onQuestion,
		  materials,
		  onRemoveMaterial,
		  onAddFiles,
		  onClearMaterials,
		  reviewEnabled,
		  onToggleReview,
		  onToggleSummary,
		  running,
		  onSend,
		  onStopAll,
		  materialError,
		  totalChars,
		  historyCount,
		  onClearHistory,
		}) {
		  const fileRef = useRef(null)
		  const overLimit = totalChars > MAX_TOTAL_MATERIAL_CHARS
		  return jsxs('div', {
		    className: 'mmd-card',
		    children: [
		      jsxs('div', {
		        className: 'mmd-cardHead',
		        children: [
		          jsx('span', { className: 'mmd-cardTitle', children: '统一输入' }),
		          jsx('span', {
		            className: 'mmd-hint',
		            children: '一次提交冻结同一份问题与资料快照，扇出给所选模型',
		          }),
		        ],
		      }),
		      jsxs('div', {
		        className: 'mmd-cardBody',
		        style: { display: 'flex', flexDirection: 'column', gap: '8px' },
		        children: [
		          jsx('textarea', {
		            className: 'mmd-textarea',
		            value: question,
		            placeholder: '输入本轮问题。资料请在下方「添加资料」里附上，一次提交后所有栏收到完全相同的快照。',
		            'aria-label': '问题输入',
		            onChange: (event) => onQuestion(event.target.value),
		          }),
		          materials.length > 0
		            ? jsxs('div', {
		                className: 'mmd-attachments',
		                children: [
		                  ...materials.map((material) =>
		                    jsxs(
		                      'span',
		                      {
		                        className: 'mmd-chip',
		                        title: `${material.format} · ${material.text.length} 字 · ${material.hash}`,
		                        children: [
		                          jsx('span', {
		                            className: 'mmd-chipName',
		                            children: `${material.name} · ${humanSize(material.text.length)}`,
		                          }),
		                          jsx('button', {
		                            type: 'button',
		                            className: 'mmd-chipX',
		                            title: '移除该资料',
		                            onClick: () => onRemoveMaterial(material.id),
		                            children: '×',
		                          }),
		                        ],
		                      },
		                      material.id,
		                    ),
		                  ),
		                  jsx('button', {
		                    type: 'button',
		                    className: 'mmd-btn mmd-btnSm mmd-btnGhost',
		                    onClick: onClearMaterials,
		                    children: '清空资料',
		                  }),
		                ],
		              })
		            : null,
		          materialError !== undefined
		            ? jsx('div', { className: 'mmd-notice mmd-noticeErr', children: materialError })
		            : null,
		          overLimit
		            ? jsx('div', {
		                className: 'mmd-notice mmd-noticeErr',
		                children: `资料合计 ${totalChars} 字，超过单轮上限 ${MAX_TOTAL_MATERIAL_CHARS} 字。请减少资料后再发送。`,
		              })
		            : null,
		          jsxs('div', {
		            className: 'mmd-toolbar',
		            children: [
		              jsx('input', {
		                ref: fileRef,
		                type: 'file',
		                multiple: true,
		                accept: '.txt,.md,.markdown,.csv,.tsv,.log,.json,.yml,.yaml',
		                style: { display: 'none' },
		                onChange: (event) => {
		                  onAddFiles(event.target.files)
		                  event.target.value = ''
		                },
		              }),
		              jsx('button', {
		                type: 'button',
		                className: 'mmd-btn mmd-btnSm',
		                onClick: () => fileRef.current?.click(),
		                children: '添加资料',
		              }),
		              jsx('span', {
		                className: 'mmd-hint',
		                title: '首版只读纯文本类文件；其他格式（PDF、Word、Excel、图片）暂时读不了。',
		                children: '支持 .txt / .md / .csv',
		              }),
		              // 互评按钮默认隐藏。
		              //
		              // 原因：在低输出上限下，参与互评的模型会把预算全用在思维链上、
		              // 正文可能为空，输出触顶时应明确显示状态。
		              // 功能本身没坏（编排逻辑本地测通），只是现阶段不好用；
		              // 所以选择"藏起来"而不是"删掉"，保留恢复的可能。
		              // 想启用：把 FEATURES.peerReview 改成 true 重新构建即可。
		              FEATURES.peerReview
		                ? jsx('button', {
		                    type: 'button',
		                    className: reviewEnabled ? 'mmd-btn mmd-btnSm mmd-btnOn' : 'mmd-btn mmd-btnSm',
		                    title: '把本轮原始问题、资料和各模型原文共享给参与模型',
		                    onClick: onToggleReview,
		                    children: reviewEnabled ? '✓ 一轮互评' : '一轮互评',
		                  })
		                : null,
		              jsx('button', {
		                type: 'button',
		                className: 'mmd-btn mmd-btnSm',
		                onClick: onToggleSummary,
		                children: '总结评价',
		              }),
		              // 多轮对话的"重置"入口：清空各栏历史，下一轮从零开始。
		              // 只在确实有历史时才显示，避免首轮就出现一个无意义的按钮。
		              historyCount > 0
		                ? jsx('button', {
		                    type: 'button',
		                    className: 'mmd-btn mmd-btnSm',
		                    title: '清空所有栏的对话历史，下一轮从零开始（不会删除已保存的历史记录）',
		                    onClick: onClearHistory,
		                    children: `新话题（已有 ${historyCount} 轮记忆）`,
		                  })
		                : null,
		              jsx('span', { className: 'mmd-spacer' }),
		              running
		                ? jsx('button', {
		                    type: 'button',
		                    className: 'mmd-btn mmd-btnSm mmd-btnDanger',
		                    onClick: onStopAll,
		                    children: '全部停止',
		                  })
		                : null,
		              jsx('button', {
		                type: 'button',
		                className: 'mmd-btn mmd-btnPrimary',
		                disabled: running || question.trim().length === 0 || overLimit,
		                onClick: onSend,
		                children: running ? '运行中…' : '发送给所选模型',
		              }),
		            ].filter(Boolean),
		          }),
		        ],
		      }),
		    ],
		  })
		}

		// ---- inlined: src/client/styles.js ----

		// ---- inlined: src/client/panel.js ----
		/**
		 * Dashboard 主面板：状态编排 + 运行逻辑。
		 *
		 * 运行模型：
		 * - `send`（发送给所选模型）：一次冻结快照，扇出给所有栏；每栏一条独立流。
		 * - `retry`（单路重试）：只重跑该栏，其他栏内容与计费不受影响。
		 * - `stop`（单路停止）：调用 `stopLane`，取消作用到真实请求。
		 * - 多轮对话：每栏各带**自己的**历史（`lane.turns`），互不相通。
		 * - 总结评价：单独选择总结模型，把问题、资料、各独立回答一起交给它。
		 */

		/**
		 * 组装一次 lane 调用的参数（公共快照部分）。
		 *
		 * `history` 只取**该栏自己**的历史：这是"每栏独立上下文"的落点。
		 * 其他栏说过什么，这一栏永远看不到。
		 */
		function laneParams(state, lane, mode) {
		  return {
		    laneId: lane.laneId,
		    provider: lane.provider,
		    model: lane.model,
		    question: state.question,
		    materials: state.materials,
		    snapshot: state.snapshot?.snapshot ?? '',
		    snapshotHash: state.snapshot?.snapshotHash ?? '',
		    mode: mode ?? 'independent',
		    maxTokens: lane.maxTokens ?? defaultOutputTokens(lane.model),
		    // 该栏自己的历史轮次（旧 -> 新）。空数组即首轮。
		    history: Array.isArray(lane.turns) ? lane.turns : [],
		  }
		}

		/**
		 * 把本轮问答写进**每栏各自的**历史。
		 *
		 * 只记录真正产出正文的栏：失败、取消、空回答都不进历史——模型下一轮若看到
		 * 一条空的"自己说过的话"，会以为当时没回答，反而更容易跑偏。
		 *
		 * 历史里存的是**当时的问题与清单**（不是完整资料正文）：资料正文已经在那一轮
		 * 发过一次，每轮重发会让上下文随轮数快速膨胀（见 lanes.js buildHistoryMessages）。
		 * @param state - 面板状态。
		 */
		function appendHistory(state) {
		  const question = state.question
		  const manifest = state.lastManifest
		  for (const lane of state.lanes) {
		    if (lane.status !== 'completed') continue
		    const answer = String(lane.text ?? '').trim()
		    if (answer.length === 0) continue
		    if (!Array.isArray(lane.turns)) lane.turns = []
		    lane.turns.push({ question, answer, manifest })
		  }
		}

		/** 从 state 的所有栏拼出完整轮次记录（用于保存与总结）。 */
		function buildRecord(state, roundId) {
		  const lanes = state.lanes.map((lane) => ({
		    laneId: lane.laneId,
		    provider: lane.provider,
		    model: lane.model,
		    modelName: state.routes.find((route) => route.id === lane.provider)?.models.find((entry) => entry.id === lane.model)?.name ?? lane.model,
		    status: lane.status,
		    text: lane.text,
		    usage: lane.usage,
		    elapsedMs: lane.elapsedMs,
		    firstTokenMs: lane.firstTokenMs,
		    failure: lane.failure,
		    note: lane.note,
		    finish: lane.finish,
		    maxTokens: lane.maxTokens,
		    reasoningChars: lane.reasoningChars,
		    manifest: lane.manifest,
		    // 该栏的对话记忆（供保存后读回继续多轮）。只存问题与当时的清单，
		    // 不重复存资料正文——正文在 `materials` 里已经存了一份。
		    turns: Array.isArray(lane.turns) ? lane.turns : [],
		  }))
		  const review = Object.entries(state.reviewLanes).map(([laneId, entry]) => {
		    const lane = state.lanes.find((candidate) => candidate.laneId === laneId)
		    return {
		      laneId,
		      provider: entry.provider,
		      model: entry.model,
		      modelName:
		        state.routes.find((route) => route.id === entry.provider)?.models.find((item) => item.id === entry.model)?.name ?? entry.model,
		      status: entry.status,
		      text: lane?.reviewText ?? '',
		      failure: entry.failure,
		    }
		  })
		  return {
		    roundId,
		    title: state.title.trim().length > 0 ? state.title.trim() : state.question.slice(0, 40),
		    question: state.question,
		    materials: state.materials.map((material) => ({
		      id: material.id,
		      name: material.name,
		      format: material.format,
		      hash: material.hash,
		      text: material.text,
		    })),
		    snapshotHash: state.snapshot?.snapshotHash,
		    questionHash: state.snapshot?.questionHash,
		    mode: state.reviewEnabled ? 'peer-review' : 'independent',
		    lanes,
		    review,
		    summary: state.summaryText,
		    summaryProvider: state.summaryProvider,
		    summaryModel: state.summaryModel,
		    summaryFailure: state.summaryFailure,
		    manifest: state.lastManifest,
		    mock: state.mock === true,
		  }
		}

		/** 汇总「本轮已纳入的材料范围」，如实标注失败/取消/未完成。 */
		function buildIncluded(state) {
		  const lines = ['本轮材料范围（如实申报）：']
		  if (state.snapshot === undefined) return undefined
		  lines.push(`[纳入] 问题原文（完整，${state.question.length} 字，${state.snapshot.questionHash}）`)
		  for (const material of state.materials) {
		    lines.push(`[纳入] 资料《${material.name}》全文（${material.text.length} 字，${material.hash}）`)
		  }
		  lines.push(`[标识] 快照哈希 ${state.snapshot.snapshotHash}`)
		  for (const lane of state.lanes) {
		    const label = `${lane.provider}/${lane.model}`
		    if (lane.status === 'completed') lines.push(`[纳入] ${label} 独立回答（完整，${lane.text.length} 字）`)
		    else if (lane.status === 'failed') lines.push(`[未纳入] ${label}（失败：${lane.failure?.code ?? ''}）`)
		    else if (lane.status === 'cancelled') lines.push(`[未纳入] ${label}（已取消）`)
		    else if (lane.status === 'truncated') lines.push(`[截断] ${label}（达到输出上限，${lane.text.length} 字）`)
		    else lines.push(`[未纳入] ${label}（${STATUS_LABEL[lane.status] ?? lane.status}）`)
		  }
		  const reviewEntries = Object.values(state.reviewLanes)
		  if (reviewEntries.length === 0) {
		    lines.push(state.reviewEnabled ? '[未纳入] 互评（未运行或未完成）' : '[未纳入] 互评（本轮未启用）')
		  } else {
		    for (const entry of reviewEntries) {
		      const label = `${entry.provider}/${entry.model} 互评`
		      if (entry.status === 'completed') lines.push(`[纳入] ${label}（完整）`)
		      else lines.push(`[未纳入] ${label}（${STATUS_LABEL[entry.status] ?? entry.status}）`)
		    }
		  }
		  return lines.join('\n')
		}

		/**
		 * 主面板组件。
		 * @param props - apply 注入的 props（含 remote 访问器与若干宿主能力）。
		 */
		function DashboardPanel(props) {
		  const { state, update } = useDashboard()
		  const remote = props.remote ?? createRemoteAccess({})
		  const routesRef = useRef(remote)

		  // 首屏：读一次真实后端状态与渠道清单。失败就如实显示失败，不伪造"已连接"。
		  useEffect(() => {
		    let cancelled = false
		    const load = async () => {
		      try {
		        const health = await routesRef.current.health()
		        const routes = await routesRef.current.listRoutes()
		        if (cancelled) return
		        state.health = health
		        state.routes = routes
		        state.routesError = undefined
		        const catalogWarning = routes.find((route) => route.catalogError)?.catalogError
		        if (catalogWarning) setNotice(state, 'warn', catalogWarning)
		        // 默认两栏：只在用户尚未改动过、且默认路由确实存在时套用。
		        const hasRoute = (provider, model) =>
		          routes.some((route) => route.id === provider && route.models.some((entry) => entry.id === model))
		        state.lanes = state.lanes.map((lane, index) => {
		          if (lane.provider.length > 0 && hasRoute(lane.provider, lane.model)) return lane
		          const fallback = DEFAULT_LANES[index]
		          if (fallback !== undefined && hasRoute(fallback.provider, fallback.model)) {
		            return { ...blankLane(fallback.provider, fallback.model), laneId: lane.laneId, text: lane.text, status: lane.status }
		          }
		          const first = routes.find((route) => route.models.length > 0)
		          if (first !== undefined && lane.provider.length === 0) {
		            return { ...blankLane(first.id, first.models[0].id), laneId: lane.laneId }
		          }
		          return lane
		        })
		        if (state.summaryProvider.length === 0) {
		          const first = routes.find((route) => route.models.length > 0)
		          if (first !== undefined) {
		            state.summaryProvider = first.id
		            state.summaryModel = first.models[0].id
		          }
		        }
		        const history = await routesRef.current.listRounds()
		        if (cancelled) return
		        state.history = history
		      } catch (error) {
		        if (cancelled) return
		        state.routesError = String(error?.message ?? error)
		      }
		      update()
		    }
		    void load()
		    return () => {
		      cancelled = true
		    }
		  }, [])

		  const patchLane = (laneId, patch) => {
		    const lane = state.lanes.find((candidate) => candidate.laneId === laneId)
		    if (lane === undefined) return
		    Object.assign(lane, patch)
		    update()
		  }

		  /** 跑一路，返回最终事件；所有状态更新都在这里收口。 */
		  const runOneLane = useCallback(
		    async (lane, mode) => {
		      const target = state.lanes.find((candidate) => candidate.laneId === lane.laneId)
		      if (target === undefined) return undefined
		      if (mode === 'peer-review') target.reviewText = ''
		      else target.text = ''
		      target.status = 'running'
		      target.failure = undefined
		      update()
		      let last
		      try {
		        const iterable = await routesRef.current.runLane(laneParams(state, target, mode))
		        last = await consumeStream(iterable, (event) => {
		          if (mode === 'peer-review') {
		            if (event.kind === 'delta') target.reviewText += event.text
		            else if (event.kind === 'lane-start') {
		              target.reviewStatus = 'running'
		            } else if (event.kind === 'lane-final') {
		              target.reviewText = typeof event.text === 'string' && event.text.length > 0 ? event.text : target.reviewText
		              state.reviewLanes[target.laneId] = {
		                provider: target.provider,
		                model: target.model,
		                status: event.status ?? 'completed',
		                failure: event.finish?.kind === 'error' ? event.finish.failure : undefined,
		              }
		            } else if (event.kind === 'lane-failed') {
		              state.reviewLanes[target.laneId] = {
		                provider: target.provider,
		                model: target.model,
		                status: 'failed',
		                failure: { code: event.code ?? 'dashboard/lane-failed', message: event.message },
		              }
		            }
		          } else applyLaneEvent(target, event)
		          update()
		        })
		      } catch (error) {
		        // 该路失败只影响这一路：标成失败并保留真实错误文本，绝不显示为完成。
		        const failure = { code: 'dashboard/lane-error', message: String(error?.message ?? error) }
		        if (mode === 'peer-review') {
		          state.reviewLanes[target.laneId] = { provider: target.provider, model: target.model, status: 'failed', failure }
		        } else {
		          target.status = 'failed'
		          target.failure = failure
		        }
		        update()
		      }
		      return last
		    },
		    [state, update],
		  )

		  /** 发送：冻结快照 → 扇出 N 路 → （可选）互评 → 保存。 */
		  const send = useCallback(async () => {
		    const question = state.question.trim()
		    if (question.length === 0) return
		    const ready = state.lanes.filter((lane) => lane.provider.length > 0 && lane.model.length > 0)
		    if (ready.length === 0) {
		      setNotice(state, 'error', '没有任何一栏选择了模型，未发出请求。')
		      update()
		      return
		    }
		    state.question = question
		    state.snapshot = freezeSnapshot(question, state.materials)
		    state.running = true
		    state.roundId = newRoundId()
		    state.reviewLanes = {}
		    state.summaryText = ''
		    state.summaryStatus = 'idle'
		    state.summaryFailure = undefined
		    state.lastManifest = undefined
		    setNotice(state, 'info', `本轮快照 ${state.snapshot.snapshotHash}，已冻结；扇出 ${ready.length} 路。`)
		    update()

		    // 每栏一条独立流，互不等待；allSettled 语义由各自的 try 保证。
		    await Promise.allSettled(state.lanes.map((lane) => runOneLane(lane, 'independent')))

		    // 互评阶段：仅在功能开启时才跑（FEATURES.peerReview 关闭时直接跳过，
		    // 避免在一个已知会返回空正文的阶段上浪费调用）。
		    if (FEATURES.peerReview && state.reviewEnabled) {
		      // 互评材料 = 本轮原始问题 + 资料 + 各模型原文。全部放进同一条消息，参与模型收到的完全一致。
		      const answers = state.lanes
		        .filter((lane) => lane.text.length > 0)
		        .map((lane) => `### ${lane.provider} / ${lane.model}\n${lane.text}`)
		        .join('\n\n')
		      const originalQuestion = state.question
		      const originalMaterials = state.materials
		      state.question = [
		        originalQuestion,
		        '',
		        '## 各模型独立回答原文（完整）',
		        answers.length > 0 ? answers : '（本轮没有任何一路产生回答）',
		      ].join('\n')
		      state.materials = originalMaterials
		      setNotice(state, 'info', '正在把本轮问题、资料与各模型原文共享给参与模型做一轮互评。')
		      update()
		      await Promise.allSettled(state.lanes.map((lane) => runOneLane(lane, 'peer-review')))
		      state.question = originalQuestion
		      update()
		    }

		    // 把本轮写入**每栏各自的**历史，供下一轮续聊。
		    //
		    // 只记成功产出正文的轮次：失败/取消/空回答不进入历史，否则模型下一轮会
		    // 看到一条空的"自己说过的话"，反而更容易跑偏（与 lanes.js 的过滤口径一致）。
		    // 注意先算清单：`persist` 里也会算，但它在 appendHistory 之后才跑。
		    state.lastManifest = buildIncluded(state)
		    appendHistory(state)

		    state.running = false
		    await persist(false)
		  }, [state, update, runOneLane])

		  /** 清空全部栏的对话记忆（开始新话题）。 */
		  const clearHistory = useCallback(() => {
		    for (const lane of state.lanes) {
		      lane.turns = []
		    }
		    setNotice(state, 'ok', '已清空所有栏的对话记忆，下一轮将从零开始。')
		    update()
		  }, [state, update])

		  /** 保存（含自动保存）。 */
		  const persist = useCallback(
		    async (silent) => {
		      if (state.snapshot === undefined) {
		        if (!silent) setNotice(state, 'error', '还没有可保存的内容。')
		        update()
		        return
		      }
		      state.lastManifest = buildIncluded(state)
		      const record = buildRecord(state, state.roundId ?? newRoundId())
		      record.manifest = state.lastManifest
		      state.lastRound = record
		      try {
		        await routesRef.current.saveRound(record)
		        state.history = await routesRef.current.listRounds()
		        if (!silent) setNotice(state, 'ok', `已保存到本地历史（${record.roundId}）。`)
		      } catch (error) {
		        setNotice(state, 'error', `保存失败：${String(error?.message ?? error)}`)
		      }
		      update()
		    },
		    [state, update],
		  )

		  /** 单路重试：只重跑这一栏。 */
		  const retryLane = useCallback(
		    async (laneId) => {
		      const lane = state.lanes.find((candidate) => candidate.laneId === laneId)
		      if (lane === undefined) return
		      if (state.snapshot === undefined) {
		        setNotice(state, 'error', '请先发送一轮，再对该栏重试。')
		        update()
		        return
		      }
		      state.running = true
		      update()
		      await runOneLane(lane, 'independent')
		      state.running = false
		      await persist(true)
		    },
		    [state, update, runOneLane, persist],
		  )

		  /** 单路停止。 */
		  const stopLane = useCallback(
		    async (laneId) => {
		      try {
		        const result = await routesRef.current.stopLane(laneId)
		        const lane = state.lanes.find((candidate) => candidate.laneId === laneId)
		        if (result?.stopped !== true) {
		          setNotice(state, 'warn', '该栏当前没有在运行的请求，停止无操作。')
		        } else if (lane !== undefined && lane.status === 'running') {
		          // 后端已受理取消；最终状态由该路自己的 finish(aborted) 落地。
		          setNotice(state, 'warn', '已请求停止该栏；等待该路返回取消结果。')
		        }
		        update()
		      } catch (error) {
		        setNotice(state, 'error', `停止失败：${String(error?.message ?? error)}`)
		        update()
		      }
		    },
		    [state, update],
		  )

		  /** 全部停止。 */
		  const stopAll = useCallback(async () => {
		    await Promise.allSettled(state.lanes.map((lane) => routesRef.current.stopLane(lane.laneId)))
		    setNotice(state, 'warn', '已请求停止全部栏。')
		    update()
		  }, [state, update])

		  /** 总结评价：只调用所选总结模型，并把材料清单显式注入。 */
		  const runSummary = useCallback(async () => {
		    if (state.summaryProvider.length === 0 || state.summaryModel.length === 0) {
		      setNotice(state, 'error', '请先选择总结模型。')
		      update()
		      return
		    }
		    if (state.snapshot === undefined) {
		      setNotice(state, 'error', '还没有可总结的内容，请先发送一轮。')
		      update()
		      return
		    }
		    const included = buildIncluded(state)
		    state.lastManifest = included
		    const answers = state.lanes
		      .filter((lane) => lane.text.length > 0)
		      .map((lane) => `### ${lane.provider} / ${lane.model}\n${lane.text}`)
		      .join('\n\n')
		    const reviews = Object.entries(state.reviewLanes)
		      .map(([laneId, entry]) => {
		        const lane = state.lanes.find((candidate) => candidate.laneId === laneId)
		        return `### ${entry.provider} / ${entry.model} 的互评\n${lane?.reviewText ?? ''}`
		      })
		      .join('\n\n')

		    const originalQuestion = state.question
		    state.question = [
		      originalQuestion,
		      '',
		      '## 本轮材料范围（如实申报，不得省略）',
		      included,
		      '',
		      '## 各模型独立回答原文（完整）',
		      answers.length > 0 ? answers : '（无）',
		      reviews.length > 0 ? `\n## 已有互评\n${reviews}` : '\n## 已有互评\n（本轮未运行互评）',
		      '',
		      '请输出四部分：共识 / 分歧 / 证据强度评价 / 建议。若材料不完整，必须明确指出缺失或被截断的内容。',
		    ].join('\n')

		    const summaryLane = {
		      laneId: 'summary',
		      provider: state.summaryProvider,
		      model: state.summaryModel,
		      text: '',
		      reviewText: '',
		      status: 'idle',
		      tab: 'answer',
		    }
		    state.summaryStatus = 'running'
		    state.summaryText = ''
		    state.summaryFailure = undefined
		    state.running = true
		    update()

		    try {
		      const iterable = await routesRef.current.runLane(laneParams(state, summaryLane, 'summary'))
		      await consumeStream(iterable, (event) => {
		        if (event.kind === 'delta') state.summaryText += event.text
		        else if (event.kind === 'lane-final') {
		          state.summaryText = typeof event.text === 'string' && event.text.length > 0 ? event.text : state.summaryText
		          state.summaryStatus = event.status ?? 'completed'
		          if (event.finish?.kind === 'error' || event.finish?.kind === 'aborted') {
		            state.summaryFailure = event.finish.failure ?? { code: String(event.finish.kind).toUpperCase(), message: '总结未正常完成' }
		          }
		        } else if (event.kind === 'lane-failed') {
		          state.summaryStatus = 'failed'
		          state.summaryFailure = { code: event.code ?? 'dashboard/lane-failed', message: event.message }
		        }
		        update()
		      })
		    } catch (error) {
		      state.summaryStatus = 'failed'
		      state.summaryFailure = { code: 'dashboard/summary-error', message: String(error?.message ?? error) }
		    }
		    state.question = originalQuestion
		    state.running = false
		    update()
		    await persist(true)
		  }, [state, update, persist])

		  // ---- 输入区与资料 ----
		  const addFiles = useCallback(
		    async (files) => {
		      const list = Array.from(files ?? [])
		      if (list.length === 0) return
		      const errors = []
		      let added = 0
		      for (const file of list) {
		        const result = await readMaterialFile(file)
		        if (result.error !== undefined) errors.push(result.error)
		        else if (result.material !== undefined) {
		          state.materials.push(result.material)
		          added += 1
		        }
		      }
		      // 提示策略：只要有文件被拒，就把**原因逐条说清**；
		      // 全部成功时也给一句正反馈，避免用户不确定到底传上去没有。
		      if (errors.length > 0) {
		        const okPart = added > 0 ? `已加入 ${added} 份；另有 ${errors.length} 份没加进来：\n` : ''
		        state.notice = `${okPart}${errors.join('\n')}`
		        state.noticeKind = 'error'
		      } else {
		        state.notice = `已加入 ${added} 份资料。`
		        state.noticeKind = 'ok'
		      }
		      update()
		    },
		    [state, update],
		  )

		  const totalChars = state.materials.reduce((sum, material) => sum + material.text.length, 0)

		  return jsxs('div', {
		    className: 'mmd-root',
		    children: [
		      jsx(Header, {
		        health: state.health,
		        routes: state.routes,
		        historyCount: state.history.length,
		        onOpenSettings: () => props.openSettings?.(),
		        onRefreshModels: async () => {
		          setNotice(state, 'info', '正在同步中转站模型目录…')
		          update()
		          try {
		            state.routes = await routesRef.current.listRoutes({ refresh: true })
		            const warning = state.routes.find((route) => route.catalogError)?.catalogError
		            setNotice(state, warning ? 'warn' : 'ok', warning ?? `已同步 ${state.routes.reduce((sum, route) => sum + route.models.length, 0)} 个模型。`)
		          } catch (error) { setNotice(state, 'error', `同步失败：${String(error?.message ?? error)}`) }
		          update()
		        },
		        running: state.running,
		        onToggleHistory: () => {
		          state.historyOpen = !state.historyOpen
		          update()
		        },
		      }),
		      props.buildError !== undefined
		        ? jsx('div', { className: 'mmd-notice mmd-noticeErr', children: `面板初始化失败：${props.buildError}` })
		        : null,
		      state.routesError !== undefined
		        ? jsx('div', { className: 'mmd-notice mmd-noticeErr', children: `后端调用失败：${state.routesError}` })
		        : null,
		      jsx(Toolbar, {
		        title: state.title,
		        laneCount: state.lanes.length,
		        narrow: props.narrow === true,
		        narrowIndex: Math.min(state.narrowIndex, Math.max(0, state.lanes.length - 1)),
		        onNarrowIndex: (value) => {
		          state.narrowIndex = value
		          update()
		        },
		        onTitle: (value) => {
		          state.title = value
		          update()
		        },
		        onAddLane: () => {
		          const first = state.routes.find((route) => route.models.length > 0)
		          const lane = blankLane(first?.id ?? '', first?.models[0]?.id ?? '')
		          if (props.narrow === true) state.narrowIndex = state.lanes.length
		          state.lanes.push(lane)
		          update()
		        },
		      }),
		      state.notice !== undefined
		        ? jsx('div', {
		            className:
		              state.noticeKind === 'error'
		                ? 'mmd-notice mmd-noticeErr'
		                : state.noticeKind === 'warn'
		                  ? 'mmd-notice mmd-noticeWarn'
		                  : state.noticeKind === 'ok'
		                    ? 'mmd-notice mmd-noticeOk'
		                    : 'mmd-notice',
		            children: state.notice,
		          })
		        : null,
		      jsxs('div', {
		        className: 'mmd-lanes',
		        role: 'region',
		        'aria-label': '模型回答栏，可左右滚动',
		        tabIndex: 0,
		        children: [
		          ...state.lanes.map((lane, index) =>
		            jsx(
		              'div',
		              {
		                className:
		                  props.narrow === true && index !== Math.min(state.narrowIndex, state.lanes.length - 1)
		                    ? 'mmd-laneWrapper mmd-laneHidden'
		                    : 'mmd-laneWrapper',
		                children: jsx(LaneCard, {
		                  lane,
		                  index,
		                  routes: state.routes,
		                  laneCount: state.lanes.length,
		                  locked: state.running,
		                  onRoute: (target, next) => {
		                    const laneTarget = state.lanes[target]
		                    if (laneTarget === undefined) return
		                    laneTarget.provider = next.provider
		                    laneTarget.model = next.model
		                    laneTarget.maxTokens = defaultOutputTokens(next.model)
		                    update()
		                  },
		                  onBudget: (target, maxTokens) => {
		                    if (state.lanes[target]) state.lanes[target].maxTokens = maxTokens
		                    update()
		                  },
		                  onRemove: (target) => {
		                    if (state.lanes.length <= 1) return
		                    state.lanes.splice(target, 1)
		                    state.narrowIndex = Math.min(state.narrowIndex, state.lanes.length - 1)
		                    update()
		                  },
		                  onStop: (laneId) => void stopLane(laneId),
		                  onRetry: (laneId) => void retryLane(laneId),
		                  onTab: (target, tab) => {
		                    const laneTarget = state.lanes[target]
		                    if (laneTarget !== undefined) laneTarget.tab = tab
		                    update()
		                  },
		                  onCopy: async (text) => {
		                    const ok = await copyText(text)
		                    setNotice(state, ok ? 'ok' : 'error', ok ? '已复制到剪贴板。' : '复制失败：浏览器未授予剪贴板权限。')
		                    update()
		                  },
		                }),
		              },
		              lane.laneId,
		            ),
		          ),
		        ],
		      }),
		      jsx(SummarySection, {
		        enabled: state.summaryEnabled,
		        onToggle: () => {
		          state.summaryEnabled = !state.summaryEnabled
		          update()
		        },
		        routes: state.routes,
		        provider: state.summaryProvider,
		        model: state.summaryModel,
		        onRoute: (next) => {
		          state.summaryProvider = next.provider
		          state.summaryModel = next.model
		          update()
		        },
		        status: state.summaryStatus,
		        text: state.summaryText,
		        failure: state.summaryFailure,
		        manifest: state.lastManifest,
		        included: state.snapshot === undefined ? undefined : buildIncluded(state),
		        canRun: state.snapshot !== undefined && state.lanes.some((lane) => lane.text.length > 0),
		        onRun: () => void runSummary(),
		        onCopy: async (text) => {
		          const ok = await copyText(text)
		          setNotice(state, ok ? 'ok' : 'error', ok ? '已复制总结。' : '复制失败：浏览器未授予剪贴板权限。')
		          update()
		        },
		      }),
		      jsx(HistorySection, {
		        open: state.historyOpen,
		        items: state.history,
		        onToggle: () => {
		          state.historyOpen = false
		          update()
		        },
		        onLoad: async (roundId) => {
		          try {
		            const record = await routesRef.current.loadRound(roundId)
		            state.title = record.title ?? ''
		            state.question = record.question ?? ''
		            state.materials = (record.materials ?? []).map((material) => ({ ...material }))
		            state.roundId = record.roundId
		            state.summaryText = record.summary ?? ''
		            state.summaryProvider = record.summaryProvider ?? state.summaryProvider
		            state.summaryModel = record.summaryModel ?? state.summaryModel
		            state.summaryStatus = record.summary ? 'completed' : 'idle'
		            state.lastManifest = record.manifest
		            state.lanes = (record.lanes ?? []).map((lane) => ({
		              laneId: lane.laneId ?? newLaneId(),
		              provider: lane.provider,
		              model: lane.model,
		              status: lane.status ?? 'completed',
		              text: lane.text ?? '',
		              reviewText: (record.review ?? []).find((entry) => entry.laneId === lane.laneId)?.text ?? '',
		              tab: 'answer',
		              usage: lane.usage,
		              elapsedMs: lane.elapsedMs,
		              firstTokenMs: lane.firstTokenMs,
		              failure: lane.failure,
		              manifest: lane.manifest,
		              // 恢复该栏的对话记忆，使"读回历史后继续追问"也能带上下文。
		              // 旧记录没有该字段时退回空数组（向后兼容）。
		              turns: Array.isArray(lane.turns) ? lane.turns.map((turn) => ({ ...turn })) : [],
		            }))
		            if (state.lanes.length === 0) state.lanes = [blankLane('', '')]
		            state.reviewLanes = {}
		            for (const entry of record.review ?? []) {
		              state.reviewLanes[entry.laneId] = {
		                provider: entry.provider,
		                model: entry.model,
		                status: entry.status,
		                failure: entry.failure,
		              }
		            }
		            state.snapshot = { questionHash: record.questionHash, snapshotHash: record.snapshotHash }
		            state.historyOpen = false
		            setNotice(state, 'ok', `已恢复轮次 ${roundId}（含原文）。`)
		          } catch (error) {
		            setNotice(state, 'error', `读取失败：${String(error?.message ?? error)}`)
		          }
		          update()
		        },
		        onDelete: async (roundId) => {
		          try {
		            await routesRef.current.deleteRound(roundId)
		            state.history = await routesRef.current.listRounds()
		            setNotice(state, 'ok', `已删除 ${roundId}。`)
		          } catch (error) {
		            setNotice(state, 'error', `删除失败：${String(error?.message ?? error)}`)
		          }
		          update()
		        },
		        onExport: async (roundId) => {
		          try {
		            const record = await routesRef.current.loadRound(roundId)
		            const result = await routesRef.current.exportRound(record, 'markdown')
		            downloadText(`多模型讨论-${roundId}.md`, result.text)
		            setNotice(state, 'ok', `已导出 Markdown：多模型讨论-${roundId}.md`)
		          } catch (error) {
		            setNotice(state, 'error', `导出失败：${String(error?.message ?? error)}`)
		          }
		          update()
		        },
		        onExportAll: () => {
		          downloadText('多模型讨论-历史索引.json', JSON.stringify(state.history, null, 2))
		          setNotice(state, 'ok', '已导出历史索引 JSON。')
		          update()
		        },
		      }),
		      jsx(Composer, {
		        question: state.question,
		        onQuestion: (value) => {
		          state.question = value
		          update()
		        },
		        materials: state.materials,
		        onRemoveMaterial: (id) => {
		          state.materials = state.materials.filter((material) => material.id !== id)
		          update()
		        },
		        onClearMaterials: () => {
		          state.materials = []
		          update()
		        },
		        onAddFiles: (files) => void addFiles(files),
		        reviewEnabled: state.reviewEnabled,
		        onToggleReview: () => {
		          // 互评当前停用（FEATURES.peerReview === false，按钮也不渲染）。
		          // 这里再加一道闸：即使有人从别处调用，也不会打开一个已知不可靠的功能。
		          if (!FEATURES.peerReview) {
		            setNotice(state, 'warn', '互评功能暂时停用。')
		            update()
		            return
		          }
		          state.reviewEnabled = !state.reviewEnabled
		          update()
		        },
		        onToggleSummary: () => {
		          state.summaryEnabled = true
		          update()
		        },
		        running: state.running,
		        onSend: () => void send(),
		        onStopAll: () => void stopAll(),
		        // 多轮对话：显示"最少历史轮数"而不是最大值。
		        // 各栏历史长度可能不同（某栏某轮失败就不记录），用最小值表示
		        // "所有栏都还记得的轮数"，不会夸大记忆深度。
		        historyCount:
		          state.lanes.length === 0
		            ? 0
		            : Math.min(...state.lanes.map((lane) => (Array.isArray(lane.turns) ? lane.turns.length : 0))),
		        onClearHistory: () => clearHistory(),
		        materialError: undefined,
		        totalChars,
		      }),
		    ].filter(Boolean),
		  })
		}


		/** 页面在 main slot 里使用的 key。 */
		const PANEL_KEY = 'multimodel-dashboard'

		/**
		 * 需要的服务。
		 *
		 * ⚠️ **不要声明 `remote.<命名空间>`**，也不要依赖官方的 Typert Remote 通道。
		 *
		 * 官方客户端（`dsh-api-remotes/lib/client.js`）挂载的是一份**编译期写死的清单**，
		 * 只含 15 个第一方包的 Remote 描述符，**没有动态注册入口**——第三方插件的命名空间
		 * 永远进不去。
		 *
		 * 更危险的是：一旦在这里写了 `remote.dashboard`，cordis 会永远等一个不会出现的
		 * 服务，**插件不激活**，浏览器直接报 "failed to load plugins"（整页坏掉）。
		 * 这个故障极难查，因为宿主侧一切正常。
		 *
		 * 实际通道：本插件的 HTTP 路由（宿主半 `http.js` 注册），客户端 `fetch` 直连，
		 * 不需要任何 ctx 服务。详见 `client/remote.js`。
		 */
		const inject = ['slots', 'layout']

		/**
		 * 面板渲染器工厂：把客户端 context 通过**闭包**交给面板。
		 *
		 * 关键（踩过的坑）：`main` 是 root 作用域的 keyed slot，官方只注入
		 * `standardProps`（`useResource` / `usePanelInfo` / `useSessions` …），
		 * **不支持自定义 inject face**。早期版本在 register 的 options 里写了
		 * `inject: () => ({ ctx })`，该字段不会被调用，于是 `props.ctx` 是
		 * `undefined`，`createRemoteAccess(undefined)` 直接抛错、组件挂载失败，
		 * 表现就是点进去**整页空白**。
		 *
		 * 正确做法：在 `apply(ctx)` 里用闭包捕获 ctx，再交给组件。
		 * @param ctx - 客户端根 context（apply 的入参）。
		 * @param prebuilt - `apply` 里已构造好的 `{ remote }`。
		 * @returns 面板组件。
		 */
		function createDashboardSurface(ctx, prebuilt) {
		  return function DashboardSurface(props) {
		    // 构造访问器理论上不会失败（纯 fetch，不依赖任何 ctx 服务）；
		    // 但仍然兜一层：任何异常都变成面板上的一行提示，而不是整页白屏。
		    let remote = prebuilt?.remote
		    let buildError = prebuilt?.buildError
		    if (remote === undefined) {
		      try {
		        remote = createRemoteAccess(ctx)
		      } catch (error) {
		        buildError = String(error?.message ?? error)
		        remote = createRemoteAccess(undefined)
		      }
		    }
		    return jsx(DashboardPanel, {
		      remote,
		      buildError,
		      narrow: typeof window !== 'undefined' && window.innerWidth <= 860,
		      openSettings: () => {
		        // 设置入口：走官方的 settings.open（存在时），否则不假装能打开。
		        try {
		          props?.openSettings?.()
		        } catch {
		          // 打不开就保持原样：不伪造"已打开设置"的反馈。
		        }
		      },
		    })
		  }
		}

		/**
		 * 客户端插件主体。
		 * @param ctx - 客户端根 context。
		 */
		function apply(ctx) {
		  installStyles()

		  // 后端访问器现在是纯 HTTP：不需要任何 ctx 服务，因此构造本身不会失败。
		  // 真正的连通性由面板挂载后的第一次 health 探测确认（失败会显示在面板上）。
		  const remote = createRemoteAccess(ctx)

		  // 注册面板本身。key 让它可以被 layout.selectPanel 选中。
		  //
		  // 注意：**不要**在这里写 `inject: () => ({ ctx })`。`main` 只提供
		  // standardProps，自定义注入面不会被调用；ctx 必须靠闭包传入。
		  const surface = createDashboardSurface(ctx, { remote, buildError: undefined })
		  ctx.slots.inject('main', () =>
		    ctx.slots.register(
		      {
		        name: 'main',
		        key: PANEL_KEY,
		      },
		      surface,
		    ),
		  )

		  // 在侧边栏「全局面板」列表里加一行，让用户能真的点进这个页面。
		  ctx.slots.inject('sidebar.panellist', () =>
		    ctx.slots.register({
		      name: 'sidebar.panellist',
		      id: PANEL_KEY,
		      order: 20,
		      label: '多模型工作台',
		    }, () => null),
		  )

		  // 注册后把用户带到这个页面一次（只在还没有选中该面板时）。
		  try {
		    ctx.layout?.selectPanel?.(PANEL_KEY)
		  } catch {
		    // selectPanel 在面板尚未登记时会抛错；此时保持当前页面即可，
		    // 用户仍可从侧边栏进入。不重试、不伪造成功。
		  }
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
