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
