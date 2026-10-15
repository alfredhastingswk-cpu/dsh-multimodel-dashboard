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
export const FEATURES = {
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
export function contentHash(text) {
  const value = String(text ?? '')
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a:${hash.toString(16).padStart(8, '0')}`
}

/** 支持的资料格式（UTF-8 文本、Markdown、CSV）。 */
export const SUPPORTED_FORMATS = ['text', 'markdown', 'csv']
/** 单个资料正文上限（字符）。 */
export const MAX_MATERIAL_CHARS = 200000
/** 单次提交资料总字符上限（字符）。 */
export const MAX_TOTAL_MATERIAL_CHARS = 400000

/**
 * 按文件名后缀判断格式。不支持的后缀返回 `undefined`，由调用方给出明确提示。
 * @param name - 文件名。
 * @returns 'text' | 'markdown' | 'csv' | undefined。
 */
export function detectFormat(name) {
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
export function freezeSnapshot(question, materials) {
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
export function renderMarkdown(text) {
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
export function newRoundId() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

/** 字节数的人类可读形式。 */
export function humanSize(chars) {
  if (chars < 1000) return `${chars} 字`
  if (chars < 1000000) return `${(chars / 1000).toFixed(1)}k 字`
  return `${(chars / 1000000).toFixed(2)}M 字`
}

/** 毫秒的人类可读形式。 */
export function humanMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

/** token 用量摘要。 */
export function usageText(usage) {
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
export const STATUS_LABEL = {
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
export const STATUS_DOT = {
  idle: 'mmd-dot',
  running: 'mmd-dot mmd-dot-run',
  completed: 'mmd-dot mmd-dot-ok',
  failed: 'mmd-dot mmd-dot-err',
  cancelled: 'mmd-dot mmd-dot-warn',
  truncated: 'mmd-dot mmd-dot-warn',
  empty: 'mmd-dot mmd-dot-warn',
  pending: 'mmd-dot',
}
