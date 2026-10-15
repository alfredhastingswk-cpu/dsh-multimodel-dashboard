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
