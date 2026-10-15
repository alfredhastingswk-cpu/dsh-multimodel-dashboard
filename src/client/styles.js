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
export function installStyles() {
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
