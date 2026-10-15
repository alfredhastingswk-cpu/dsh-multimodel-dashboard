import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLane, buildMaterial, DEFAULT_MAX_TOKENS } from './src/lanes.js'
import { syncGatewayModels } from './src/catalog.js'
import { createRemoteAccess, consumeStream } from './src/client/remote.js'

const material = buildMaterial({ question: '回归检查', materials: [] })
async function replay(chunks) {
  const ctx = { llm: { async *stream() { yield* chunks } } }
  const events = []
  for await (const event of runLane(ctx, { provider: 'test', model: 'test' }, material, new AbortController().signal)) events.push(event)
  return events
}
let count = 0
const passed = (name) => { count++; process.stdout.write(`PASS ${name}\n`) }
let events = await replay([{ type: 'text-delta', text: '部分回答' }, { type: 'finish', reason: { kind: 'max-tokens' } }])
assert.equal(events.at(-1).status, 'truncated')
assert.equal(events.at(-1).text, '部分回答')
assert.match(events.at(-1).note, /尚未完成/)
passed('Harness max-tokens preserves partial text and reports truncation')
events = await replay([{ type: 'reasoning-delta', text: '思考'.repeat(100) }, { type: 'finish', reason: { kind: 'max-tokens' } }])
assert.equal(events.at(-1).status, 'truncated')
assert.equal(events.at(-1).text, '')
assert.match(events.at(-1).note, /没有产出正文/)
assert.ok(events.some((event) => event.kind === 'thinking'))
passed('Reasoning-only capped output is visible and never completed')
events = await replay([{ type: 'text-delta', text: '断线前内容' }])
assert.equal(events.at(-1).status, 'failed')
assert.equal(events.at(-1).text, '断线前内容')
assert.equal(events.at(-1).finish.failure.code, 'dashboard/incomplete-stream')
passed('Missing upstream finish is a failure with retained text')
assert.ok(DEFAULT_MAX_TOKENS >= 8192)

const originalFetch = globalThis.fetch
async function consumeWire(wire, chunkSize = 1) {
  const bytes = new TextEncoder().encode(wire)
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += chunkSize) controller.enqueue(bytes.slice(index, index + chunkSize))
      controller.close()
    },
  }), { status: 200 })
  const seen = []
  const last = await consumeStream(createRemoteAccess({}).runLane({}), (event) => seen.push(event))
  return { seen, last }
}
try {
  const result = await consumeWire(': heartbeat\r\n\r\ndata: {"ok":true,"value":{"kind":"delta","text":"中文分片"}}\r\n\r\ndata: {"ok":true,"value":{"kind":"lane-final","status":"completed","text":"中文分片"}}')
  assert.equal(result.seen[0].text, '中文分片')
  assert.equal(result.last.kind, 'lane-final')
  passed('Fragmented UTF-8, CRLF, heartbeat and final event without newline')
  await assert.rejects(consumeWire('data: {"ok":true,"value":{"kind":"delta","text":"保留"}}\n\n'), /提前结束/)
  passed('Transport EOF without terminal event is not silently accepted')
  await assert.rejects(consumeWire('data: {broken}\n\n'), /stream-broken/)
  passed('Malformed framed SSE is reported instead of buffered forever')
} finally { globalThis.fetch = originalFetch }

let probes = 0
let mutations = 0
const initial = {
  providers: {
    text: { baseURL: 'https://api.wokey.ai/v1', api: 'openai-completions', apiKeyEnv: 'WOKEY_API_KEY', models: [{ id: 'deepseek-flash', maxTokens: 8192, compat: { thinkingFormat: 'deepseek' } }] },
    claude: { baseURL: 'https://api.wokey.ai', api: 'anthropic-messages', apiKeyEnv: 'WOKEY_API_KEY', models: [{ id: 'claude-sonnet', maxTokens: 1600 }] },
  },
}
const modelIds = ['deepseek-flash', 'glm-5.3-flash', 'kimi-test', 'gpt-test', 'claude-sonnet', 'claude-new']
const ctx = {
  settings: {
    describe(options) { assert.equal(options.redactSecrets, true); return [{ ns: 'llm-pi-ai', value: initial, revision: 1 }] },
    async mutate(ns, ops, revision) {
      mutations++
      assert.equal(ns, 'llm-pi-ai')
      assert.equal(revision, 1)
      for (const op of ops) {
        assert.equal(op.op, 'set')
        assert.deepEqual(op.path.slice(0, 1), ['providers'])
        assert.equal(op.path.at(-1), 'models')
        initial.providers[op.path[1]].models = op.value
      }
    },
  },
  llm: {
    listConfigurableProviders: () => ['text', 'claude'].map((provider) => ({ provider, settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider] })),
    async discoverModels(ns, draft) {
      probes++
      assert.equal(draft.apiKey, undefined)
      return modelIds.map((id) => ({ id }))
    },
  },
}
let result = await syncGatewayModels(ctx)
assert.equal(result.advertisedCount, modelIds.length)
assert.deepEqual(initial.providers.text.models.map((model) => model.id), modelIds.filter((id) => !id.startsWith('claude-')))
assert.deepEqual(initial.providers.claude.models.map((model) => model.id), modelIds.filter((id) => id.startsWith('claude-')))
assert.equal(initial.providers.text.models[0].compat.thinkingFormat, 'deepseek')
assert.equal(initial.providers.claude.models[0].maxTokens, undefined)
assert.equal(initial.providers.claude.apiKeyEnv, 'WOKEY_API_KEY')
assert.equal(mutations, 1)
passed('Full gateway catalog routes every model, preserves compat and only mutates models')
await syncGatewayModels(ctx)
assert.equal(probes, 1)
await syncGatewayModels(ctx, true)
assert.equal(probes, 2)
passed('Catalog cache and explicit refresh')
const shared = { ...ctx, settings: { ...ctx.settings, documentPath: join(tmpdir(), 'dashboard-test-home', 'settings.yaml') } }
result = await syncGatewayModels(shared)
assert.match(result.error, /未改动全局/)
passed('Shared settings are never modified by model synchronization')
process.stdout.write(`\n${count} regression groups passed; no paid model calls.\n`)
