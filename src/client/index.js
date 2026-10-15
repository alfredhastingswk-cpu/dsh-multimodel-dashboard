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
// @inline ../client/format.js
// @inline ../client/remote.js
// @inline ../client/store.js
// @inline ../client/state.js
// @inline ../client/lanes-ui.js
// @inline ../client/components.js
// @inline ../client/styles.js
// @inline ../client/panel.js

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
export const inject = ['slots', 'layout']

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
export function apply(ctx) {
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
