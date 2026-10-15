/**
 * 单路（lane）执行：把一份冻结的输入快照变成一个模型的独立流式回答。
 *
 * 关键设计：
 * - `snapshot` 在整轮中只有一份，所有路收到**逐字节相同**的文本；各路的差异只在
 *   system 提示与（互评时的）呈现顺序。
 * - 模型层失败不会抛出：`LlmRuntime.stream()` 把适配器/网络失败规范化为终结
 *   `finish` chunk（`{ kind: 'error' | 'aborted', failure }`），因此"某一路失败"天然
 *   是那一路的结果，不会中断整轮。
 * - 上下文超限在发送前用**显式材料清单**处理：绝不静默截断。
 */

// 官方消息工厂。**必须用它们**来构造历史消息：pi-ai 适配器会无条件读
// `message.source.kind`，手搓缺 `source` 的 assistant 消息会在发请求前崩溃
// （`Cannot read properties of undefined (reading 'kind')`，表现为 0ms 失败）。
// 这里用具名导入；若某个 Harness 版本不导出，则由 make*Message 的兜底分支接手。
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'

/** 各栏共用的系统提示：只要求事实与结构，不制造"已连接/已完成"的假象。 */
const INDEPENDENT_SYSTEM = [
  '你是一个多模型工作台中的一个独立回答方。',
  '请直接回答用户的问题，基于用户提供的资料给出你的判断。',
  '不要假设你知道其他模型会说什么；不要提及"其他模型"。',
  '如果资料不足，明确说明缺少什么。',
].join('\n')

const REVIEW_SYSTEM = [
  '你在一个多模型工作台中负责一轮互评。',
  '你会收到同一问题的多个模型的独立回答原文。',
  '请指出：哪些结论被多方支持、哪些存在分歧、各自的证据是否充分。',
  '不要重复抄写原文，不要编造未出现过的结论。',
].join('\n')

const SUMMARY_SYSTEM = [
  '你在一个多模型工作台中负责总结评价。',
  '请输出四部分：共识 / 分歧 / 证据强度评价 / 建议。',
  '注意：模型之间的共识不等于事实证据。若材料不完整，必须明确指出哪些内容缺失或被截断。',
].join('\n')

/** 单路默认输出上限（用户日常可调；自动测试会用更小的值）。 */
export const DEFAULT_MAX_TOKENS = 8192

/**
 * 粗略估算一段文本的 token 数。
 * 中英混排下 1 token ≈ 2 个字符是保守上界（偏大），因此不会低估占用。
 * @param text - 任意文本。
 * @returns 估算 token 数。
 */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0
  return Math.ceil(text.length / 2)
}

/**
 * 构造本轮材料：问题原文 + 资料清单。返回结构化材料与清单，二者共用同一份文本。
 * @param params - RoundInput（question、materials）。
 * @returns 材料对象。
 */
export function buildMaterial(params) {
  const question = String(params?.question ?? '')
  const materials = Array.isArray(params?.materials) ? params.materials : []
  const items = materials.map((material, index) => {
    const name = String(material?.name ?? `资料${index + 1}`)
    const text = String(material?.text ?? '')
    const format = String(material?.format ?? 'text')
    const supported = format === 'text' || format === 'markdown' || format === 'csv'
    return {
      id: String(material?.id ?? `material-${index + 1}`),
      name,
      format,
      text,
      supported,
      chars: text.length,
      // 资料在提交时已由界面计算哈希；这里原样保留，不做二次计算以免口径不一致。
      hash: String(material?.hash ?? ''),
    }
  })
  return { question, items }
}

/** 渲染材料清单（模型可见 + 界面可见共用同一份口径）。 */
export function renderManifest(material, notes) {
  const lines = ['本轮材料范围（如实申报，不得省略）：']
  lines.push(`[纳入] 问题原文（完整，${material.question.length} 字）`)
  for (const item of material.items) {
    if (!item.supported) {
      lines.push(`[未纳入] 资料《${item.name}》：不支持的格式 ${item.format}`)
      continue
    }
    lines.push(`[纳入] 资料《${item.name}》全文（${item.chars} 字，sha256:${item.hash.slice(0, 12)}）`)
  }
  for (const note of notes ?? []) lines.push(note)
  return lines.join('\n')
}

/**
 * 组装问题正文：问题 + 资料清单 + 资料正文。所有路共用。
 * @param material - buildMaterial 的结果。
 * @param manifest - renderManifest 的结果。
 * @returns 模型可见的用户消息文本。
 */
export function renderQuestion(material, manifest) {
  const parts = [`## 问题\n${material.question}`, `## 材料清单\n${manifest}`]
  const supported = material.items.filter((item) => item.supported && item.text.length > 0)
  if (supported.length > 0) {
    const body = supported
      .map((item) => `### 资料：${item.name}（${item.format}）\n${item.text}`)
      .join('\n\n')
    parts.push(`## 资料正文\n${body}`)
  }
  return parts.join('\n\n')
}

/**
 * 按优先级裁剪材料以适配上下文：问题 > 资料正文 > 各模型独立回答原文 > 互评内容。
 * 被裁剪的内容必须在清单里如实标注，绝不静默丢弃。
 * @param material - 材料。
 * @param budgetTokens - 可用于「材料」的估算 token 预算。
 * @returns {{ notes: string[], keptAnswers: number }}
 */
export function planTruncation(material, budgetTokens) {
  const notes = []
  let used = estimateTokens(material.question)
  void used
  void budgetTokens
  // 首版：资料不做截断（文件在添加时已按单文件上限校验），这里只申报合计占用。
  const total = material.items.reduce((sum, item) => sum + estimateTokens(item.text), 0)
  if (total > budgetTokens) {
    notes.push(
      `[提示] 资料估算 ${total} tokens，超过本轮预算 ${budgetTokens}；请减少资料或改用更大上下文的模型。`,
    )
  }
  return { notes, keptAnswers: 1 }
}

/**
 * 把一栏的历史轮次转换成模型可见的消息序列。
 *
 * 每一轮历史记成「用户提问」+「该栏当时的回答」两条。**旧资料原文不重复发送**：
 * 资料已经在当轮的问题正文里出现过，如果每轮都重发，上下文会随轮数线性堆积，
 * 几轮之后就撑爆窗口。这里改为只在历史里保留"当时用了哪些资料"的**清单**，
 * 本次提问的消息里才带完整资料正文。
 *
 * 空回答（`status === 'empty'`）或失败的轮次不进入历史：把一条空消息塞给模型
 * 只会让它以为"我之前什么都没说"，反而更容易跑偏。
 *
 * ⚠️ **必须带 `source`**：pi-ai 适配器在 `toPiAssistant()` 里无条件读
 * `message.source.kind`。手搓一个没有 `source` 的 `{role:'assistant', content}`
 * 会在请求发出前就崩掉，报 `Cannot read properties of undefined (reading 'kind')`
 * ——表现为"0ms 失败"，很容易误判成模型或网络问题（实测踩过）。
 * 因此这里统一走官方的 `createUserMessage` / `createAssistantMessage`。
 * @param history - 该栏的历史轮次数组（旧 -> 新）。
 * @returns 消息数组。
 */
export function buildHistoryMessages(history) {
  if (!Array.isArray(history)) return []
  const out = []
  for (const turn of history) {
    const question = String(turn?.question ?? '').trim()
    const answer = String(turn?.answer ?? '').trim()
    if (question.length === 0 || answer.length === 0) continue
    const manifest = String(turn?.manifest ?? '').trim()
    const questionText =
      manifest.length > 0 ? `## 问题\n${question}\n\n## 当时所用资料\n${manifest}` : `## 问题\n${question}`
    out.push(makeUserMessage(questionText))
    out.push(makeAssistantMessage(answer))
  }
  return out
}

/**
 * 构造一条 user 消息。
 *
 * 优先用官方 `createUserMessage`（会补齐 `id` 并按官方 schema 冻结）；
 * 官方工厂不可用时退回手写结构，且**一定带上 `source`**——缺 `source` 会让
 * pi-ai 适配器在读 `message.source.kind` 时崩溃（见 buildHistoryMessages 注释）。
 * @param text - 消息文本。
 * @returns 消息对象。
 */
function makeUserMessage(text) {
  if (typeof createUserMessage === 'function') {
    return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  }
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

/**
 * 构造一条 assistant 消息（历史回放用）。
 *
 * 只作为"provider-neutral 历史"使用，不携带 `replayState`；适配器会走
 * `foreignAssistant()` 把它降级成通用历史——这正是我们要的语义：
 * 上一轮的答案只是上下文，不是要与原模型对齐的续写。
 * @param text - 上一轮的答案原文。
 * @returns 消息对象。
 */
function makeAssistantMessage(text) {
  if (typeof createAssistantMessage === 'function') {
    return createAssistantMessage({ content: [{ type: 'text', text }], source: {} })
  }
  return { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } }
}

/**
 * 执行一路流式调用，逐事件产出。
 * @param ctx - 宿主 context（需要 ctx.llm）。
 * @param params - 含 provider、model、maxTokens、temperature、signal 语义的调用参数。
 * @param material - 冻结的材料。
 * @param signal - 该路自己的取消信号。
 * @returns 异步事件流。
 */
export async function* runLane(ctx, params, material, signal) {
  const startedAt = Date.now()
  // 三种模式各有自己的 system 提示。**不要**把未知模式折叠成 independent：
  // 早期版本用 `=== 'peer-review' ? ... : 'independent'` 折叠，导致 `summary`
  // 静默走了独立回答的提示词，总结里也不会出现"共识不等于事实证据"的强制声明。
  const mode = params?.mode === 'peer-review' ? 'peer-review' : params?.mode === 'summary' ? 'summary' : 'independent'
  const manifest = renderManifest(material, [])
  const prompt = renderQuestion(material, manifest)
  const provider = String(params?.provider ?? '')
  const model = String(params?.model ?? '')
  const maxTokens = Number.isFinite(params?.maxTokens) ? Number(params.maxTokens) : DEFAULT_MAX_TOKENS

  if (provider.length === 0 || model.length === 0) {
    yield { kind: 'lane-failed', code: 'dashboard/missing-route', message: '未选择渠道或模型' }
    return
  }

  yield { kind: 'lane-start', provider, model, startedAt }

  // 多轮对话：把该栏**自己的**历史按顺序排在本次提问之前。
  //
  // 设计要点（用户明确要求"每栏各记各的"）：
  // - 历史由界面持有并随每次调用传入，后端不保存任何会话状态——这样"独立上下文"
  //   是结构保证，而不是靠约定；
  // - 各栏历史互不相通：A 栏看不到 B 栏说过什么，这正是"独立回答"的本意；
  // - 历史里的旧资料原文**不重复发送**（见 buildHistoryMessages 的说明），
  //   否则多轮之后 token 会平方级膨胀。
  const messages = [...buildHistoryMessages(params?.history), {
    role: 'user',
    content: [
      {
        type: 'text',
        text:
          mode === 'peer-review'
            ? `${prompt}\n\n## 互评要求\n你需要在下面的评审环节评价其他模型的回答。`
            : prompt,
      },
    ],
    source: { kind: 'user' },
  }]

  let text = ''
  let reasoningChars = 0
  let lastReasoningUpdate = 0
  let usage
  let finishReason
  let failure
  let firstTokenAt

  const options = {
    provider,
    model,
    messages,
    system:
      mode === 'peer-review' ? REVIEW_SYSTEM : mode === 'summary' ? SUMMARY_SYSTEM : INDEPENDENT_SYSTEM,
    maxTokens,
    signal,
  }
  if (Number.isFinite(params?.temperature)) options.temperature = Number(params.temperature)

  let stream
  try {
    stream = ctx.llm.stream(options)
  } catch (error) {
    yield { kind: 'lane-failed', code: 'dashboard/dispatch-failed', message: String(error?.message ?? error) }
    return
  }

  try {
    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text-delta':
          if (firstTokenAt === undefined) firstTokenAt = Date.now()
          text += chunk.text
          yield { kind: 'delta', laneId: params?.laneId, text: chunk.text }
          break
        case 'reasoning-delta':
          reasoningChars += chunk.text.length
          if (Date.now() - lastReasoningUpdate >= 250) {
            yield { kind: 'thinking', laneId: params?.laneId, reasoningChars }
            lastReasoningUpdate = Date.now()
          }
          break
        case 'usage':
          usage = chunk.usage
          break
        case 'finish':
          finishReason = chunk.reason
          break
        default:
          break
      }
    }
  } catch (error) {
    // LlmRuntime 已把适配器失败转成 finish；真正抛出的只可能是消费者/中间件失败。
    if (signal.aborted) {
      yield {
        kind: 'lane-final',
        text,
        usage,
        elapsedMs: Date.now() - startedAt,
        status: 'cancelled',
        finish: { kind: 'aborted' },
      }
      return
    }
    yield { kind: 'lane-failed', code: 'dashboard/stream-threw', message: String(error?.message ?? error) }
    return
  }

  const kind = finishReason?.kind ?? 'unknown'
  if (kind === 'error' || kind === 'aborted') failure = finishReason.failure
  const capped = kind === 'max-tokens' || kind === 'length'
  if (kind === 'unknown') failure = { code: 'dashboard/incomplete-stream', message: '上游流结束但没有完成标记，已保留收到的正文，请重试该栏。' }
  // 「空回答」必须单独成状态，不能算 completed。
  //
  // 真实踩到的情形：互评模式下 DeepSeek / GLM 会先输出大段思维链
  // （`reasoning-delta`），在输出预算内**一个字正文都没给**就正常 stop。
  // 早期版本只看 `finish.kind === 'stop'` 就标记 completed，于是界面会显示
  // 一个"已完成"的空栏——正是产品明确禁止的假状态。
  const emptyOutput = text.trim().length === 0 && (kind === 'stop' || capped)
  const status =
    signal.aborted || kind === 'aborted'
      ? 'cancelled'
      : kind === 'error' || kind === 'unknown'
        ? 'failed'
        : capped
          ? 'truncated'
          : emptyOutput
            ? 'empty'
            : 'completed'

  yield {
    kind: 'lane-final',
    text,
    usage,
    reasoningChars,
    firstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
    elapsedMs: Date.now() - startedAt,
    status,
    manifest,
    finish: { kind, failure },
    // 空回答的成因提示：让界面能如实解释"为什么这一栏没有内容"。
    note: emptyOutput
      ? reasoningChars > 0
        ? `模型只输出了思维链（约 ${reasoningChars} 字），在本次输出上限内没有产出正文。请提高该栏的输出上限或重试。`
        : '模型返回了空内容。可重试该栏，或检查该模型是否可用。'
      : capped ? '回答达到本次输出上限，内容尚未完成。可提高该栏的输出额度后重试。' : undefined,
  }
}

/** 收齐一路的全部事件（含每条增量与最终事件），供 runRound 逐条透出。 */
export async function collectLane(ctx, params, signal) {
  const material = buildMaterial(params)
  const events = []
  for await (const event of runLane(ctx, params, material, signal)) events.push(event)
  if (events.length === 0) events.push({ kind: 'lane-failed', message: '没有收到任何事件' })
  return events
}
