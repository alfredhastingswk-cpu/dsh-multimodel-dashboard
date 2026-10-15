/**
 * 本地功能验收（**不发起任何模型调用**）：
 *  1. 单路停止：AbortController 能让流真的中止，并落成 `cancelled`；
 *  2. 失败隔离：一路失败不影响另一路（模拟适配器失败）；
 *  3. 历史保存 / 读取 / 删除 / 导出（markdown + json）；
 *  4. 导出物里不含任何凭证字段；
 *  5. 材料清单如实申报（含未纳入的格式）。
 *
 * 用法：node verify-local.mjs
 */
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const lib = (name) => resolve(`lib/${name}`)
const { buildMaterial, renderManifest, runLane } = await import(pathToFileURL(lib('lanes.js')).href)

const results = []
const check = (label, ok, detail) => results.push({ label, ok, detail })

/** 假 llm：按脚本产块，用来在不联网的前提下验证编排逻辑。 */
function fakeLlm(script) {
  return {
    stream: () =>
      (async function* () {
        for (const step of script) {
          if (typeof step === 'function') {
            // 允许脚本里插入一个「等待取消」的挂起点。
            await step()
            continue
          }
          yield step
        }
      })(),
  }
}

const material = buildMaterial({ question: 'Q', materials: [{ id: 'a', name: 'A.txt', format: 'text', text: '内容', hash: 'fnv1a:aaaa' }] })

// ---- 1. 单路停止 ----
{
  const controller = new AbortController()
  const ctx = {
    llm: fakeLlm([
      { type: 'text-delta', text: '开头' },
      () =>
        new Promise((_, reject) => {
          // 中止后模拟底层抛错；runLane 应识别 signal.aborted 并落为 cancelled。
          setTimeout(() => {
            controller.abort()
            reject(new Error('aborted by caller'))
          }, 10)
        }),
      { type: 'finish', reason: { kind: 'stop' } },
    ]),
  }
  const events = []
  for await (const event of runLane(ctx, { provider: 'p', model: 'm', laneId: 'l1' }, material, controller.signal)) {
    events.push(event)
  }
  const final = events[events.length - 1]
  check('单路停止落成 cancelled', final.status === 'cancelled', `status=${final.status}`)
  check('停止前已收到的正文被保留', final.text === '开头', `text=${JSON.stringify(final.text)}`)
}

// ---- 2. 失败隔离：一路 error，一路正常 ----
{
  const failing = fakeLlm([
    { type: 'finish', reason: { kind: 'error', failure: { code: 'X', message: '模拟适配器失败' } } },
  ])
  const okLlm = fakeLlm([{ type: 'text-delta', text: '正常' }, { type: 'finish', reason: { kind: 'stop' } }])
  const run = async (llm) => {
    const events = []
    for await (const event of runLane({ llm }, { provider: 'p', model: 'm', laneId: 'x' }, material, new AbortController().signal)) {
      events.push(event)
    }
    return events[events.length - 1]
  }
  const bad = await run(failing)
  const good = await run(okLlm)
  check('失败路落成 failed 且带原因', bad.status === 'failed' && bad.finish.failure?.code === 'X', `status=${bad.status} code=${bad.finish.failure?.code}`)
  check('另一路不受影响，照常完成', good.status === 'completed' && good.text === '正常', `status=${good.status}`)
}

// ---- 3. 材料清单如实申报 ----
{
  const mixed = buildMaterial({
    question: '问题',
    materials: [
      { id: 'a', name: '好.txt', format: 'text', text: '可读', hash: 'fnv1a:1111' },
      { id: 'b', name: '坏.docx', format: 'docx', text: '', hash: '' },
    ],
  })
  const manifest = renderManifest(mixed, [])
  check('清单标注未纳入的格式', manifest.includes('[未纳入]') && manifest.includes('坏.docx'), manifest.split('\n').find((l) => l.includes('未纳入')) ?? '')
  check('清单标注已纳入资料', manifest.includes('[纳入]') && manifest.includes('好.txt'), '')
}

// ---- 4. 历史保存 / 读取 / 导出 ----
{
  // store 的函数都收「轮次目录」；这里指向一个临时目录，避免污染真实 profile 数据。
  const dir = mkdtempSync(join(tmpdir(), 'mmd-verify-'))
  const store = await import(pathToFileURL(lib('store.js')).href)
  const record = {
    roundId: 'round-verify-1',
    savedAt: new Date().toISOString(),
    title: '验证轮次',
    question: 'Q',
    manifest: '清单',
    lanes: [
      { laneId: 'l1', provider: 'wokey-text', model: 'deepseek-flash', status: 'completed', text: '答案一', elapsedMs: 1200, usage: { totalTokens: 30 } },
      { laneId: 'l2', provider: 'wokey-text', model: 'glm-5.3-flash', status: 'failed', text: '', elapsedMs: 40 },
    ],
    summary: '总结文字',
    review: '互评文字',
  }
  await store.writeRound(dir, record)
  check('历史可保存', existsSync(join(dir, 'round-verify-1.json')), join(dir, 'round-verify-1.json'))
  const listed = await store.listRounds(dir)
  check('历史可列出', listed.length === 1, `count=${listed.length}`)
  const loaded = await store.readRound(dir, 'round-verify-1')
  check('历史可读回', loaded?.lanes?.length === 2, `lanes=${loaded?.lanes?.length}`)

  const markdown = store.renderExport(loaded, 'markdown')
  const json = store.renderExport(loaded, 'json')
  check('可导出 markdown', typeof markdown === 'string' && markdown.includes('答案一'), `len=${markdown.length}`)
  check('可导出 json', typeof json === 'string' && json.includes('deepseek-flash'), `len=${json.length}`)
  check('导出物不含凭证字段', !/apiKey|api_key|WOKEY_API_KEY|sk-|Bearer|password/i.test(markdown + json), '')
  check('导出物保留失败栏与空回答实情', markdown.includes('failed') || markdown.includes('失败'), '')

  await store.deleteRound(dir, 'round-verify-1')
  const after = await store.listRounds(dir)
  check('历史可删除', after.length === 0, `count=${after.length}`)
  if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('mmd-verify-')) {
    throw new Error('临时测试目录不在预期范围，拒绝清理')
  }
  rmSync(dir, { recursive: true, force: true })
}

// ---- 5. 产物不含密钥 ----
{
  const clientCode = readFileSync('lib/client.js', 'utf8')
  const hostCode = ['index.js', 'lanes.js', 'store.js'].map((file) => readFileSync(`lib/${file}`, 'utf8')).join('\n')
  check('客户端产物不含密钥字段', !/apiKey|api_key|WOKEY_API_KEY|sk-|Bearer|password|secret/i.test(clientCode), '')
  check('宿主产物不含密钥值', !/WOKEY_API_KEY|sk-[A-Za-z0-9]/.test(hostCode), '（只有引用名，没有值）')
  check('客户端产物含空回答状态', clientCode.includes('空回答'), '')
}

for (const result of results) {
  process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'}  ${result.label}${result.detail ? `\n      ${result.detail}` : ''}\n`)
}
const failed = results.filter((r) => !r.ok).length
process.stdout.write(`\n${results.length - failed}/${results.length} 通过（本次未发起任何模型调用）\n`)
process.exitCode = failed === 0 ? 0 : 1
process.exit(process.exitCode)
