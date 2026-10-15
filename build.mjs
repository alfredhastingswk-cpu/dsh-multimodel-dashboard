/**
 * 构建脚本：把 src/ 下的源码同步到 lib/。
 *
 * 为什么不用 tsc / tsdown：
 * 本插件刻意保持"零构建依赖"——宿主半源码就是可直接被 Node ESM 执行的 JS，
 * 浏览器半只需包上一层 `window.__ModuleLoader__.load`。因此构建不做转译，
 * 只做复制、拼接与语法自检，不需要从包仓库安装任何工具链，
 * 也不会改写 Harness 已有的缓存安装。
 *
 * - 宿主半：`src/*.js`（除 client/）→ `lib/*.js`（Node ESM，由 Harness Loader 加载）
 * - 浏览器半：`src/client/index.js` + 同目录被 `// @inline` 标记的子模块
 *   → `lib/client.js`（单文件 bundle）
 *
 * 用法：node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'
import { spawn } from 'node:child_process'

const root = dirname(fileURLToPath(import.meta.url))
const srcDir = join(root, 'src')
const clientSrcDir = join(srcDir, 'client')
const libDir = join(root, 'lib')

/**
 * 语法自检：用 `node --check` 让 Node 自己的解析器校验模块语法。
 *
 * 为什么不用 `new Function`：它只解析脚本语法，`export` / `import` 一律报错，
 * 而这里要校验的正是模块。为什么不用 `import()`：那会真的执行模块副作用。
 * `node --check` 只解析、不执行，是这里唯一合适的工具。
 */
async function assertSyntax(code, label) {
  const probe = join(root, `.syntax-probe-${Math.random().toString(36).slice(2)}.mjs`)
  try {
    writeFileSync(probe, code, 'utf8')
    const { status, stderr } = await runNodeCheck(probe)
    if (status !== 0) throw new Error(`${label} 语法检查失败：\n${stderr.trim()}`)
  } finally {
    rmSync(probe, { force: true })
  }
}

/** 调用 `node --check <file>`，返回退出码与 stderr。 */
function runNodeCheck(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (status) => resolve({ status, stderr }))
    child.on('error', (error) => resolve({ status: 1, stderr: String(error?.message ?? error) }))
  })
}

/** 宿主半：逐文件复制 + 语法自检。 */
async function buildHost() {
  const outputs = []
  for (const name of readdirSync(srcDir)) {
    if (name === 'client') continue
    if (!name.endsWith('.js')) continue
    const code = readFileSync(join(srcDir, name), 'utf8')
    await assertSyntax(code, `src/${name}`)
    writeFileSync(join(libDir, name), code, 'utf8')
    outputs.push(`lib/${name}`)
  }
  return outputs
}

/**
 * 单个子模块的转写：去掉模块边界，保留顶层声明。
 * 子模块之间也会互相引用（panel 用 components，components 用 lanes-ui），
 * 因此内联必须递归展开并整体去重。
 */
function inlineModule(text) {
  return text
    .replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+/gm, 'const __default_unused = ')
    .replace(/^\s*export\s+(?=(const|let|var|function|class|async))/gm, '')
}

/**
 * 递归展开 `// @inline <path>` 标记。
 *
 * 标记路径相对**当前文件所在目录**解析，因此 `src/client/index.js` 里的
 * `// @inline ../client/panel.js` 与 `// @inline format.js` 都能成立。
 * 用 `seen` 集合保证同一文件只展开一次（子模块之间互相引用时不会重复定义）。
 * @param file - 当前文件绝对路径。
 * @param seen - 已展开文件的集合。
 * @returns 展开后的源码。
 */
function expand(file, seen = new Set()) {
  const absolute = resolve(file)
  // 归一化：不同写法（`./x.js` 与 `x.js`）指向同一文件时只展开一次。
  const key = absolute.toLowerCase()
  if (seen.has(key)) return ''
  seen.add(key)
  const source = readFileSync(absolute, 'utf8')
  const lines = source.split('\n')
  const out = []
  const marker = /^[ \t]*\/\/[ \t]*@inline[ \t]+(\S+)[ \t]*$/
  for (const line of lines) {
    const match = marker.exec(line)
    if (match === null) {
      out.push(line)
      continue
    }
    const target = resolve(dirname(absolute), match[1])
    out.push(`// ---- inlined: ${relative(root, target).replace(/\\/g, '/')} ----`)
    // 子模块先递归展开，再交给 inlineModule 去掉它自己的 import/export。
    // 注意顺序：必须先展开标记，再去模块边界，否则标记会被 import 清理规则一起吃掉。
    out.push(inlineModule(expand(target, seen)))
  }
  return inlineModule(out.join('\n'))
}

/** 浏览器半：单文件 bundle，包在 ModuleLoader 协议里。 */
async function buildClient() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const body = expand(join(clientSrcDir, 'index.js'))
  await assertSyntax(body, 'src/client/index.js')

  const indented = body
    .split('\n')
    .map((line) => (line.length > 0 ? `\t\t${line}` : line))
    .join('\n')

  const wrapped = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\tconst react = require("react");
\t\tconst jsxRuntime = require("react/jsx-runtime");
\t\tconst { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = react;
\t\tconst jsx = jsxRuntime.jsx;
\t\tconst jsxs = jsxRuntime.jsxs;
\t\tconst Fragment = react.Fragment;
${indented}
\t\texports.apply = apply;
\t\texports.inject = inject;
\t\treturn module.exports;
\t}
});
`
  writeFileSync(join(libDir, 'client.js'), wrapped, 'utf8')
  return ['lib/client.js']
}

if (!existsSync(srcDir)) throw new Error('缺少 src/ 目录')
rmSync(libDir, { recursive: true, force: true })
mkdirSync(libDir, { recursive: true })

const outputs = [...(await buildHost()), ...(await buildClient())]
process.stdout.write(`built: ${outputs.join(', ')}\n`)
