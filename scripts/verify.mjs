/**
 * verify.mjs —— 把三条闸门与两条颜色量具合成一句 `pnpm verify`（2026-10-21，工单 D-39）
 *
 * 评分报告 §2.12 为这件事扣了 −4，原话是：这一族浏览器探针
 * **只能人工跑，没有 CI**，于是"这一栏的所有读数随时可能过期而没人知道"。
 * 这一支脚本补的是**最省的那一层**（不是真 CI）：
 *
 * - `pnpm verify` 一次跑完七条能离线跑的判据，**全部跑完再报**（不是第一条红就退，
 *   那样每次改要一轮一轮试）；
 * - 需要 dev server 才能跑的那一族（`scripts/chk-*.mjs`）它**不跑**，
 *   只把它们列出来提醒 —— 因为在这一支脚本里起服务器 = 每条判据都要为它让一步，
 *   而那些判据本来就该由人带着 dev server 跑（`chk-run-motion.mjs --book=` 那一族
 *   要登录票、`chk-shared-reader.mjs` 要先造夹具）。**列出来**这件事本身就是收益：
 *   原来"有哪些探针、谁跑过"只存在于记忆里。
 * - 一条 `pre-push` 的钩子（`.githooks/pre-push`）在 push 之前调它。
 *
 * ★ 三条实现上的讲究：
 *
 * 1. **命令串只有一个来源**：逐条从 `package.json` 的 `scripts` 里读。
 *    在这里抄一份"pnpm lint = eslint ."，第二天 lint 换了参数，这一支脚本
 *    验的就不是 `pnpm lint` 了——而它看起来完全一样。
 * 2. **失败要能指认**：每一条留最后 12 行输出。闸门红了读不出为什么，
 *    人就会去猜，而猜的第一步通常是"大概是我刚才那一刀"。
 * 3. **退出码只说一件事**：有任何一条红就 1。钩子与 CI 都只读这个数。
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts

/**
 * 七条离线判据。`why` 是给读的那一句——红了要知道丢了什么，
 * 而不是只知道"有一道闸没过"。
 *
 * ★ 2026-10-21（工单 D-28）加的那条 `check:family` 与前六条不是一类：
 *   前六条看的是**代码的形状**，它看的是**盘上有没有不该有的字节**——
 *   它自己真跑一遍照片那条路与录音那条路，再去搜整个工作区。
 *   放在这一族里的理由与 `check:scrim` 同源：一句承诺要么有一条会红的判据撑着，
 *   要么它就是注释；而"照片不落盘"这句承诺，红起来的样子必须是有人真跑了一次。
 */
const GATES = [
  { key: 'format:check', why: '排版与 .gitattributes 那一条（红了就是真格式问题）' },
  { key: 'lint', why: '含引擎层的依赖禁令（engine 不许 import React）' },
  { key: 'typecheck', why: '两个 config 各一遍：全局 + 引擎那一档的 noUncheckedIndexedAccess' },
  { key: 'check:colors', why: '「面与墨」位置上不许有写死的颜色' },
  { key: 'check:scrim', why: '那把对比度量具：全部分面 × 全部墨色 ≥ 4.5:1' },
  { key: 'check:family', why: '照片原图与录音样本不在盘上（真跑一遍再满盘搜，含两条对照针）' },
  { key: 'test', why: '纯函数与路由的那一族单测' },
]

const only = process.argv
  .slice(2)
  .filter((a) => a.startsWith('--only='))
  .map((a) => a.slice('--only='.length).split(','))
  .flat()

console.log('pnpm verify —— 七条离线判据\n')

const results = []
for (const gate of GATES) {
  if (only.length > 0 && !only.includes(gate.key)) continue
  const command = scripts[gate.key]
  if (!command) {
    results.push({ ...gate, ok: false, tail: ['package.json 里没有这条 script'] })
    continue
  }
  const started = Date.now()
  const run = spawnSync(command, { cwd: ROOT, shell: true, encoding: 'utf8' })
  const out = (run.stdout ?? '') + (run.stderr ?? '')
  const tail = out
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(-12)
  const ok = run.status === 0
  results.push({ ...gate, ok, tail, ms: Date.now() - started })
  console.log(
    `  ${ok ? '✓' : '★'} ${gate.key.padEnd(14)} ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
  if (!ok) for (const line of tail) console.log('      │ ' + line)
}

const failed = results.filter((result) => !result.ok)
for (const result of failed) console.log(`\n${result.key} 为什么要在乎：${result.why}`)

/**
 * 需要 dev server 的那一族：列出来，不跑。
 *
 * ★ 这个清单是从盘上现数的（`scripts/chk-*.mjs`），不是手抄的一份——
 *   手抄的那份从第二支探针起就开始漂，而漂了的症状恰好是本单要修的那件事
 *   （"读数过期而没人知道"）。
 */
const probes = readdirSync(join(ROOT, 'scripts'))
  .filter((name) => name.startsWith('chk-') && name.endsWith('.mjs'))
  .sort()

console.log('')
console.log(
  `浏览器探针（${probes.length} 支，**这一条命令不跑**——它们要一个起着 dev server 的本站）：`,
)
for (const name of probes) console.log('   · ' + name)
console.log('   跑法都是 `node scripts/<名字> http://127.0.0.1:<端口>`；')
console.log('   要登录那一屏的先看它们头上的 `--user=` / 夹具说明。')

if (failed.length > 0) {
  console.log(
    `\n★ ${failed.length} / ${results.length} 条红：${failed.map((f) => f.key).join(' · ')}`,
  )
  process.exit(1)
}
console.log(`\n✓ ${results.length} 条全过`)
