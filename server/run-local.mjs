/**
 * run-local.mjs —— 在本机起后端（`mvn spring-boot:run`）的那件事，只有这一处
 *
 * 入口仍然是 `server\run-local.cmd`（README §3 与大家的手感都在那儿），
 * 但**读 `.env.local` 的活儿搬到了这里**。为什么搬，见下面第 1 条。
 *
 * 1. ★ **cmd 的 `for /f` 会吞行**（2026-10-19 实测）。原来那一行
 *    `for /f "usebackq eol=# ..." %%A in (.env.local)` 在
 *    「LF 行尾 + 中文注释」这份文件上，会把紧跟某条注释的那一行**当成注释的一部分**
 *    一起吃掉。实测：文件里 21 个 `KEY=` 行，cmd 只设了 **19** 个，
 *    漏的是 `APP_SMS_ENABLED` 与 `BACKEND_URL` —— 而漏哪一行**跟着位置走**，
 *    加删一行注释就可能换另一行遭殃。这里的解析没有这个性质。
 *    （文档在 docs/known-tradeoffs.md「cmd 读 .env.local 会吞行」那一节。）
 *
 * 2. ★ **`APP_H2_PATH` 钉成绝对路径**：不钉的话"用哪个库"由进程的工作目录决定，
 *    2026-10-17 就是这么在仓库根上长出过一个空库、让管理员登不进去。
 *
 * 3. ★ **`.env.local` 压过继承来的环境变量**（与原来 `set "%%A=%%B"` 的行为一致）。
 *    理由不是习惯而是症状：`APP_JWT_SECRET` 一旦被别处的值顶掉，
 *    表现是"登录 200、之后每个请求 401"，与"鉴权写错了"长得一模一样。
 *    单一来源比"谁覆盖谁"少一类要查的东西。
 *
 * 4. 附加参数原样转给 maven。例如临时按真发短信起一次（不改任何文件）：
 *    `server\run-local.cmd -Dspring-boot.run.arguments=--app.sms.enabled=true`
 *
 * 用法：`server\run-local.cmd`（或 `node server/run-local.mjs`）。Ctrl-C 停。
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

/** `.env.local` → 一个对象。跳过空行与 `#` 注释；值两侧的空白去掉（`X= y ` 那种手滑） */
function loadEnvFile(path) {
  const out = new Map()
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    // 没有 .env.local 不是错：Java 那边会自己生成一把随机 JWT 密钥（本地可跑，代价是每次重启都要重登）
    return out
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const at = line.indexOf('=')
    if (at <= 0) continue
    out.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  return out
}

const fromFile = loadEnvFile(join(repo, '.env.local'))
const env = { ...process.env }
for (const [key, value] of fromFile) env[key] = value
env.APP_H2_PATH = join(here, '.local-db', 'xiaozhujue')

const mavenArgs = ['-o', 'spring-boot:run', ...process.argv.slice(2)]
const quote = (arg) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg)
const line = ['mvn', ...mavenArgs].map(quote).join(' ')

console.log(`[run-local] .env.local 读进 ${fromFile.size} 个键 · 库 ${env.APP_H2_PATH}`)
console.log(`[run-local] ${line}`)

const child = spawn(line, { cwd: here, env, stdio: 'inherit', shell: true })
child.on('exit', (code, signal) => {
  if (signal) process.exit(0)
  process.exit(code ?? 0)
})
