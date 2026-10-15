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
