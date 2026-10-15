/**
 * 本地历史：一轮讨论的完整记录（问题、资料、各栏原文、互评、总结）写成一个 JSON 文件。
 *
 * 为什么不复用会话日志：会话日志是"模型可见 ⟺ 已记录"的严格契约，把纯展示数据
 * 塞进去会污染会话语义，还要背上会话格式版本迁移负担。这里用独立目录 + 应用层索引。
 *
 * 目录位置：`<profile>/dashboard-rounds/`，与该 profile 的其它私人数据同级。
 */
import { mkdir, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'

/** 单份资料正文上限（字符）：超过则在添加时就明确拒绝，不做静默截断。 */
export const MAX_MATERIAL_CHARS = 200000
/** 归档结果上限：超过则拒绝保存并在界面提示。 */
export const MAX_ROUND_BYTES = 8 * 1024 * 1024

/**
 * 优先使用当前宿主 profile；缺少宿主信息时使用用户自己的专用目录。
 * @param ctx - 宿主 context。
 * @returns 绝对路径。
 */
export function roundsDir(ctx) {
  const candidates = [
    () => ctx.app?.profileDir,
    () => ctx.get?.('app')?.profileDir,
    () => {
      const settings = ctx.get?.('settings') ?? ctx.settings
      const documentPath = settings?.documentPath
      if (typeof documentPath !== 'string' || !isAbsolute(documentPath)) return undefined
      const directory = dirname(documentPath)
      return /[/\\]profiles[/\\][^/\\]+$/.test(directory) ? directory : undefined
    },
    () => typeof ctx.baseDir === 'string' && /[/\\]profiles[/\\][^/\\]+$/.test(ctx.baseDir)
      ? ctx.baseDir : undefined,
  ]
  for (const read of candidates) {
    try {
      const value = read()
      if (typeof value === 'string' && isAbsolute(value)) return join(value, 'dashboard-rounds')
    } catch {
      // 读取失败即换下一候选；这里刻意不抛出，避免插件加载被归档路径问题阻断。
    }
  }
  const home = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
  const configured = process.env.DSH_PROFILE
  const profile = typeof configured === 'string' && /^[A-Za-z0-9._-]+$/.test(configured)
    && configured !== '.' && configured !== '..' ? configured : 'multimodel-dashboard'
  return join(home, 'profiles', profile, 'dashboard-rounds')
}

/** 只允许安全字符作为文件名，避免路径穿越。 */
function safeId(id) {
  const cleaned = String(id).replace(/[^0-9A-Za-z._-]/g, '')
  if (cleaned.length === 0) throw new Error('轮次 id 非法')
  return cleaned
}

/** 原子写入：先写临时文件再改名，避免半截 JSON 被读到。 */
async function atomicWrite(path, text) {
  const temp = `${path}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

/**
 * 写入一轮完整记录。
 * @param dir - 轮次目录。
 * @param record - 完整轮次记录（含原文）。
 */
export async function writeRound(dir, record) {
  await mkdir(dir, { recursive: true })
  const text = JSON.stringify(record, null, 2)
  if (Buffer.byteLength(text, 'utf8') > MAX_ROUND_BYTES) {
    throw new Error(`本轮记录 ${Buffer.byteLength(text, 'utf8')} 字节，超过 ${MAX_ROUND_BYTES} 字节上限，未保存`)
  }
  await atomicWrite(join(dir, `${safeId(record.roundId)}.json`), text)
}

/**
 * 列出历史轮次摘要（按时间倒序）。
 * @param dir - 轮次目录。
 * @returns 摘要数组。
 */
export async function listRounds(dir) {
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = await readFile(join(dir, name), 'utf8')
      const record = JSON.parse(raw)
      out.push({
        roundId: String(record.roundId ?? name.replace(/\.json$/, '')),
        title: String(record.title ?? ''),
        question: String(record.question ?? '').slice(0, 160),
        savedAt: String(record.savedAt ?? ''),
        laneCount: Array.isArray(record.lanes) ? record.lanes.length : 0,
        hasReview: record.review !== undefined && record.review !== null,
        hasSummary: typeof record.summary === 'string' && record.summary.length > 0,
        mock: record.mock === true,
      })
    } catch {
      // 单个坏文件不影响其余历史；跳过并在结果里不出现，属于可见的"缺失"而非静默改写。
    }
  }
  out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  return out
}

/**
 * 读取一轮完整记录。
 * @param dir - 轮次目录。
 * @param roundId - 轮次 id。
 * @returns 完整记录。
 */
export async function readRound(dir, roundId) {
  const raw = await readFile(join(dir, `${safeId(roundId)}.json`), 'utf8')
  return JSON.parse(raw)
}

/**
 * 删除一轮记录。
 * @param dir - 轮次目录。
 * @param roundId - 轮次 id。
 */
export async function deleteRound(dir, roundId) {
  await rm(join(dir, `${safeId(roundId)}.json`), { force: true })
}

/** 渲染成 Markdown 导出文本（不含任何密钥，只有渠道/模型 id 与正文）。 */
export function renderMarkdown(record) {
  const lines = []
  lines.push(`# ${record.title || record.question || '多模型讨论'}`)
  lines.push('')
  lines.push(`- 时间：${record.savedAt ?? ''}`)
  lines.push(`- 模式：${record.mode === 'peer-review' ? '独立回答 + 一轮互评' : '独立回答'}`)
  if (record.mock === true) lines.push('- **标注：本轮为 Mock 模式，内容由本地假数据产生，不是真实模型返回。**')
  lines.push('')
  lines.push('## 问题原文')
  lines.push('')
  lines.push(String(record.question ?? ''))
  lines.push('')
  const materials = Array.isArray(record.materials) ? record.materials : []
  if (materials.length > 0) {
    lines.push('## 资料')
    lines.push('')
    for (const material of materials) {
      lines.push(`### ${material.name}（${material.format}，sha256:${String(material.hash ?? '').slice(0, 16)}）`)
      lines.push('')
      lines.push('```')
      lines.push(String(material.text ?? ''))
      lines.push('```')
      lines.push('')
    }
  }
  lines.push('## 独立回答')
  lines.push('')
  for (const lane of Array.isArray(record.lanes) ? record.lanes : []) {
    lines.push(`### ${lane.modelName ?? lane.model}（${lane.provider} / ${lane.model}）`)
    lines.push('')
    lines.push(`- 状态：${lane.status}`)
    lines.push(`- 耗时：${lane.elapsedMs ?? 0} ms`)
    if (lane.usage !== undefined && lane.usage !== null) {
      lines.push(`- tokens：${JSON.stringify(lane.usage)}`)
    }
    if (lane.failure !== undefined && lane.failure !== null) {
      lines.push(`- 失败：${lane.failure.code ?? ''} ${lane.failure.message ?? ''}`)
    }
    lines.push('')
    lines.push(String(lane.text ?? ''))
    lines.push('')
  }
  if (record.review !== undefined && record.review !== null) {
    lines.push('## 一轮互评')
    lines.push('')
    for (const lane of Array.isArray(record.review) ? record.review : []) {
      lines.push(`### ${lane.modelName ?? lane.model}（${lane.provider} / ${lane.model}）`)
      lines.push('')
      lines.push(`- 状态：${lane.status}`)
      lines.push('')
      lines.push(String(lane.text ?? ''))
      lines.push('')
    }
  }
  if (typeof record.summary === 'string' && record.summary.length > 0) {
    lines.push('## 总结评价')
    lines.push('')
    lines.push(`- 总结模型：${record.summaryProvider ?? ''} / ${record.summaryModel ?? ''}`)
    lines.push('')
    lines.push(record.summary)
    lines.push('')
  }
  if (typeof record.manifest === 'string' && record.manifest.length > 0) {
    lines.push('## 最终材料清单')
    lines.push('')
    lines.push('```')
    lines.push(record.manifest)
    lines.push('```')
    lines.push('')
  }
  lines.push('> 模型共识不等于事实证据。')
  lines.push('')
  return lines.join('\n')
}

/**
 * 导出本轮：Markdown 或 JSON。
 * @param record - 完整记录。
 * @param format - 'markdown' | 'json'。
 * @returns 文本。
 */
export function renderExport(record, format) {
  if (format === 'json') return JSON.stringify(record, null, 2)
  return renderMarkdown(record)
}
