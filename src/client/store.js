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
export function createDashboardStore() {
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
export function initialState() {
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
