/** Gateway discovery stays on the host; credentials are resolved by Harness. */
const cache = new WeakMap()
const CACHE_MS = 5 * 60 * 1000

function profileAt(value, path) {
  return path.reduce((entry, key) => entry?.[key], value)
}

function isWokey(profile) {
  try { return new URL(profile?.baseURL).hostname === 'api.wokey.ai' } catch { return false }
}

/** Synchronize advertised text models through the adapter's discovery seam.
 * Only model definitions are mutated; credential fields are never read or rewritten.
 */
export async function syncGatewayModels(ctx, refresh = false) {
  const previous = cache.get(ctx)
  if (!refresh && previous && Date.now() - previous.at < CACHE_MS) return previous.promise
  const promise = synchronize(ctx).catch((error) => ({ error: String(error?.message ?? error) }))
  cache.set(ctx, { at: Date.now(), promise })
  return promise
}

async function synchronize(ctx) {
  const settings = ctx.get?.('settings') ?? ctx.settings
  const llm = ctx.llm
  if (typeof settings?.describe !== 'function' || typeof settings?.mutate !== 'function'
      || typeof llm.discoverModels !== 'function') return { error: '模型配置服务尚未就绪，暂时显示预设目录。' }
  if (typeof settings.documentPath === 'string' && !/[/\\]profiles[/\\][^/\\]+[/\\]/.test(settings.documentPath)) {
    return { error: '模型同步需要使用 Dashboard 专用 profile 的 settings 文件，未改动全局配置。' }
  }
  const descriptors = settings.describe({ redactSecrets: true })
  const directory = llm.listConfigurableProviders?.() ?? []
  const gateways = directory.map((entry) => {
    const descriptor = descriptors.find((item) => item.ns === entry.settingsNs)
    const profile = profileAt(descriptor?.value, entry.settingsPath)
    return { entry, descriptor, profile }
  }).filter(({ profile }) => isWokey(profile))
  if (!gateways.length) return {}

  const probe = gateways.find(({ profile }) => profile.api === 'openai-completions') ?? gateways[0]
  const advertised = await llm.discoverModels(probe.entry.settingsNs, {
    provider: probe.entry.provider,
    baseURL: probe.profile.baseURL,
    api: probe.profile.api,
  }, AbortSignal.timeout(15000))
  if (!advertised.length) throw new Error('中转站返回空模型目录，保留原有配置。')

  const nativeClaude = gateways.find(({ profile }) => profile.api === 'anthropic-messages')
  const textRoute = gateways.find(({ profile }) => profile.api === 'openai-completions')
  const changes = new Map()
  for (const { entry, descriptor, profile } of gateways) {
    const models = advertised.filter((model) => {
      const claude = /^claude-/i.test(model.id)
      if (profile.api === 'anthropic-messages') return claude
      return !claude || !nativeClaude
    })
    if (!models.length || (!textRoute && profile.api !== 'anthropic-messages')) continue
    const existing = new Map((profile.models ?? []).map((model) => [model.id, model]))
    const next = models.map((model) => {
      const old = existing.get(model.id) ?? {}
      const definition = { ...old, id: model.id, name: model.name ?? old.name ?? model.id }
      if (Number.isFinite(model.contextWindow) && model.contextWindow > 0) definition.contextWindow = model.contextWindow
      if (Number.isFinite(model.maxTokens) && model.maxTokens > 0) definition.maxTokens = model.maxTokens
      // The prototype's 1600/1800/8192 values were test budgets, not vendor capabilities.
      else if (Number.isFinite(definition.maxTokens) && definition.maxTokens < 16384) delete definition.maxTokens
      return definition
    })
    if (JSON.stringify(next) === JSON.stringify(profile.models)) continue
    const pending = changes.get(entry.settingsNs) ?? { revision: descriptor.revision, ops: [] }
    pending.ops.push({ op: 'set', path: [...entry.settingsPath, 'models'], value: next })
    changes.set(entry.settingsNs, pending)
  }
  for (const [ns, { ops, revision }] of changes) await settings.mutate(ns, ops, revision)
  return { source: 'gateway', providerIds: gateways.map(({ entry }) => entry.provider), advertisedCount: advertised.length, syncedAt: new Date().toISOString() }
}
