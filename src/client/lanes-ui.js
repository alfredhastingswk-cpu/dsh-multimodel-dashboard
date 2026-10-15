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
// @inline format.js
// @inline remote.js
// @inline styles.js

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
