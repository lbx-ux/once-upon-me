/**
 * mcp-session.mts —— 按 MCP 协议驱动 server，并把判据逐条打出来
 *
 * 这个脚本**就是那个客户端**：它起 `mcp/server.mts` 子进程，往 stdin 写一行行
 * JSON-RPC、从 stdout 读回来。所以它验的不是"我们的函数对不对"，
 * 而是**"一个客户端能不能真的用它"**——而后者是 `.scratch/mcp/spec.md` 的判据 1/3/4/5。
 *
 * ## 四条判据（跑完逐条打印「过 / 不过」）
 *
 * | # | 判据 | 怎么算过 |
 * | - | ---- | -------- |
 * | 2 | 走 MCP 那条路与 `engine-run --mode=stub` 是**同一本书、同一串事件** | `book.json` 去掉时间字段后逐字节相同；事件流语义相同（全局按序、页级按页归并——并发池会打乱页与页的交错） |
 * | 3 | 进度通知**给 token 才发** | 给 `progressToken` → 每条事件一条 progress；**不给 → 0 条**（一对判别对照） |
 * | 4 | 空态与负例说得清 | 未知方法 → `-32601`；不存在的书号 → `isError: true` + 一句人话 |
 * | 5 | 会话记录可重跑 | `.out/mcp-session/transcript.jsonl`（双向）+ `summary.json` |
 *
 * ★ 判据 2 的对照臂是**这个脚本自己跑出来的**（它顺手起一次 `engine-run`），
 *   不是"你要先手动跑一次"——手动的东西过两天就没人跑了。
 * ★ 判据 2 之所以能成立，是因为两边用的是**同一份固定替身**
 *   （`src/lib/stub-fixture.ts`）：造卡、孩子的标签、固定剧本、那 5 张成图全在一处。
 *   分成两份"恰好一样"的代码，这条判据当天就失去意义。
 *
 * ```bash
 * node scripts/mcp-session.mts
 * node scripts/mcp-session.mts --keep     # 保留两次跑出来的资产根，方便手工对照
 * ```
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { flag } from './env.mts'

/** 两次跑的落点。★ MCP 那一侧是**按人分片的**（`u/<id>/`），所以两者不同名是对的 */
const MCP_ROOT = '.out/mcp-session'
const RUN_ROOT = '.out/engine-run'
/** 与 `server.mts` 的 `--user=` 同一个值；也是这一片资产的目录名 */
const USER = '1'
/** 与 `engine-run.mts` 的缺省主题一致——判据 2 要求两边**输入相同** */
const THEME = '第一次离开家也不怕'
/** 第二条 plan_book 用另一个主题：判据 3 的对照组不能与第一条抢同一个书号 */
const THEME_QUIET = '第二次编故事（不要求进度）'

const OUT = resolve('.out/mcp-session')
const TRANSCRIPT = `${OUT}/transcript.jsonl`
const SUMMARY = `${OUT}/summary.json`

/**
 * 时间类的字段名。判据 2 要比的是**结构**，而两次跑的时刻不可能一样。
 *
 * ★ 名单是**按名字**列的，不是"删掉看起来像时间的"：漏一个就会让判据 2 变成
 *   一条永远不过的判据（而人只会以为"这两条路本来就不一样"）；
 *   多删一个又会让判据 2 变成一条永远能过的判据（**那更坏**）。
 *   所以每加一项都要说得出"它是哪来的时间"。
 */
const TIME_KEYS = new Set([
  'at', // 事件的发射时刻
  'elapsedMs', // 这一次跑了多久（`stats.elapsedMs`、`BookStats`）
  'createdAt', // 这本书是什么时候开始做的
  'generatedAt', // 卡 / 插画是什么时候生成的
  'updatedAt', // 档案什么时候改过
  'editedAt', // 家长什么时候改过故事
  'expiresAt', // 供应商媒体地址的失效时刻
  'originExpiresAt',
])

/** 把值里的时间字段全部摘掉，只留结构与内容。数组顺序**保留**（顺序是判据的一部分） */
function stripTime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTime)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (TIME_KEYS.has(key)) continue
    out[key] = stripTime(item)
  }
  return out
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item
    const record = item as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    )
  })
}

/**
 * 判据 2 的归一化：**页级事件按页归并，全局事件保持原序。**
 *
 * ★ 2026-10-21 出图加了上限 3 的并发池之后，页与页的完成顺序不再确定
 *   （实测同一份替身两次跑，第 13 条事件一次是 page 3、一次是 page 2）。
 *   那不是"两条路不一样"，是并发本来就会打乱**页与页之间**的交错。
 *   所以这里只放松这一层：
 *   - 全局事件（`retrieved` / `plan-ready` / `book-ready` / 无页号的 `stage`…）顺序照旧；
 *   - 页级事件按 `pageNo` 稳定归并，**同一页内部的先后照旧**（出图 → 核对）；
 *   - `seq` 是全局序号，并发之后它必然不同，比之前摘掉。
 *   如果哪天页内顺序真的错了，这一条仍然会红。
 */
function normalizeEvents(value: unknown[]): unknown {
  const strip = (one: unknown): Record<string, unknown> => {
    const rest = { ...(stripTime(one) as Record<string, unknown>) }
    // `seq` 是全局序号：并发之后同一页拿到第几个号也会变，它不是语义
    delete rest['seq']
    return rest
  }
  const events = value.map(strip)
  const isPage = (one: Record<string, unknown>): boolean => typeof one['pageNo'] === 'number'
  const global = events.filter((one) => !isPage(one))
  const byPage = events
    .filter(isPage)
    .sort((a, b) => (a['pageNo'] as number) - (b['pageNo'] as number))
  return { global, page: byPage }
}

/* ───────────────────────── 一个很小的 MCP 客户端 ───────────────────────── */

type Json = Record<string, unknown>
type Received = {
  id: number | string | null
  method?: string
  params?: Json
  result?: Json
  error?: Json
}

class Client {
  private readonly child
  private buffer = ''
  private nextId = 1
  private readonly waiting = new Map<number, (message: Received) => void>()
  readonly notifications: Received[] = []
  readonly log: { dir: 'out' | 'in'; message: unknown }[] = []

  constructor(command: string, args: string[]) {
    this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      // 子进程的诊断照原样透出来（前面加个前缀，免得与这一层的输出混在一起）
      for (const line of chunk.split('\n')) {
        if (line.trim() !== '') process.stdout.write(`  [server] ${line}\n`)
      }
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    for (let index = this.buffer.indexOf('\n'); index >= 0; index = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      if (line.trim() === '') continue
      const message = JSON.parse(line) as Received
      this.log.push({ dir: 'in', message })
      if (message.id !== null && message.id !== undefined && this.waiting.has(Number(message.id))) {
        this.waiting.get(Number(message.id))?.(message)
        this.waiting.delete(Number(message.id))
      } else {
        this.notifications.push(message)
      }
    }
  }

  private write(message: unknown): void {
    this.log.push({ dir: 'out', message })
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /** 发一条**原始**消息（负例要用它：未知方法、非法 JSON 都要能发出去） */
  raw(message: unknown): void {
    this.write(message)
  }

  notify(method: string, params: Json = {}): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  request(method: string, params: Json = {}, timeoutMs = 120_000): Promise<Received> {
    const id = this.nextId
    this.nextId += 1
    return new Promise<Received>((done, fail) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        fail(new Error(`${method} 在 ${timeoutMs}ms 内没有回话`))
      }, timeoutMs)
      this.waiting.set(id, (message) => {
        clearTimeout(timer)
        done(message)
      })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  /** 等一小会儿再取通知，避免"发完立刻数"数到 0 条（那是竞态，不是读数） */
  settle(ms = 400): Promise<void> {
    return new Promise((done) => setTimeout(done, ms))
  }

  stop(): void {
    this.child.stdin.end()
    this.child.kill()
  }
}

/* ───────────────────────── 判据的记账 ───────────────────────── */

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail })
  process.stdout.write(`  ${ok ? '✅' : '❌'} ${name}：${detail}\n`)
}

async function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise<number>((done) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'] })
    child.on('exit', (code) => done(code ?? 1))
  })
}

/* ───────────────────────── 主体 ───────────────────────── */

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true })
  await rm(resolve(RUN_ROOT), { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  /* ── 对照臂：`engine-run --mode=stub` 先跑一遍 ── */
  // ★ 对照臂要带 `--retrieve`。理由是**哪一边才是"产品那条路"**：
  //   MCP 的 `plan_book` 每次都带检索器（与 `/api/books` 那条一样），
  //   而 `engine-run` 的检索是**可选开关**（它文件头写着"默认不开——这一条命令是架构验收"）。
  //   不带上它，两串事件会差出检索那两条（`stage:retrieving` + `retrieved`），
  //   于是判据 2 变成一条永远不过的判据——而真正的原因是**两边做的不是同一件事**，
  //   不是"哪一边写错了"。实测第一次跑就是差这两条（21 vs 23）。
  process.stdout.write('① 对照臂：node scripts/engine-run.mts --mode=stub --retrieve\n')
  const code = await runCommand('node', [
    'scripts/engine-run.mts',
    '--mode=stub',
    '--retrieve',
    `--out=${RUN_ROOT}`,
  ])
  if (code !== 0) {
    process.stdout.write(`对照臂退出码 ${code}，后面没法比\n`)
    process.exitCode = 1
    return
  }

  /* ── 被测臂：起 MCP server，按协议走一遍 ── */
  process.stdout.write('\n② 被测臂：起 mcp/server.mts，按 MCP 协议驱动它\n')
  const client = new Client('node', [
    'mcp/server.mts',
    `--user=${USER}`,
    '--mode=stub',
    `--asset-root=${MCP_ROOT}`,
  ])

  const init = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'mcp-session.mts', version: '1.0.0' },
  })
  client.notify('notifications/initialized')
  check(
    '握手',
    (init.result?.['protocolVersion'] as string) === '2025-06-18',
    `协议版本 ${String(init.result?.['protocolVersion'])}，能力 ${Object.keys(
      (init.result?.['capabilities'] as Json) ?? {},
    ).join('+')}`,
  )

  const listed = await client.request('tools/list')
  const tools = ((listed.result?.['tools'] as Json[]) ?? []).map((one) => one['name'])
  check('tools/list', tools.length === 7, `${tools.length} 条：${tools.join(' / ')}`)

  const children = await client.request('tools/call', { name: 'list_children', arguments: {} })
  const childrenText = textOf(children)
  check(
    'list_children 真的读了盘',
    childrenText.includes('xiaolu'),
    childrenText.split('\n')[0] ?? '',
  )

  /* ── 判据 1：带 progressToken 调 plan_book ── */
  process.stdout.write('\n③ 判据 1（进度通知）：带 progressToken 调 plan_book\n')
  const before = client.notifications.length
  const planned = await client.request(
    'tools/call',
    {
      name: 'plan_book',
      arguments: { child: 'xiaolu', theme: THEME },
      _meta: { progressToken: 'tok-1' },
    },
    300_000,
  )
  await client.settle()
  const progress = client.notifications
    .slice(before)
    .filter((one) => one.method === 'notifications/progress')
  check(
    'progressToken 给了 → 收到 progress',
    progress.length > 0,
    `${progress.length} 条，最后一条：「${String((progress.at(-1)?.params as Json)?.['message'] ?? '')}」`,
  )

  /* ── 判据 3（负例那一半）：不给 token ── */
  const beforeQuiet = client.notifications.length
  await client.request(
    'tools/call',
    { name: 'plan_book', arguments: { child: 'xiaolu', theme: THEME_QUIET } },
    300_000,
  )
  await client.settle()
  const quiet = client.notifications
    .slice(beforeQuiet)
    .filter((one) => one.method === 'notifications/progress')
  check(
    '★ 不给 progressToken → 一条 progress 都没有',
    quiet.length === 0,
    `${quiet.length} 条（这一格是判别对照：只测上面那一半的话，` +
      '一个"无条件发通知"的实现会全绿）',
  )

  /* ── 出图（异步那条） ── */
  process.stdout.write('\n④ illustrate_book（异步，立刻返回）\n')
  const bookId = /书号 (\S+?)，/.exec(textOf(planned))?.[1] ?? ''
  const started = await client.request('tools/call', {
    name: 'illustrate_book',
    arguments: { bookId },
  })
  check(
    'illustrate_book 立刻返回「开工了」',
    textOf(started).includes('开工了'),
    textOf(started).split('\n')[0] ?? '',
  )

  // 等它画完：判据 2 要比的是成品，所以这里必须等到盘上有 book.json。
  // ★ 这一档是替身（不联网、不出图），所以是秒级，不是实测那 154 s/页。
  const deadline = Date.now() + 120_000
  let status = ''
  while (Date.now() < deadline) {
    const one = await client.request('tools/call', { name: 'book_status', arguments: { bookId } })
    status = textOf(one)
    if (status.includes('已经画完')) break
    await new Promise((done) => setTimeout(done, 500))
  }
  check('等到画完（book_status 说「已经画完」）', status.includes('已经画完'), firstLine(status))

  /* ── 判据 4：负例 ── */
  process.stdout.write('\n⑤ 判据 4（空态与负例）\n')
  const unknown = await client.request('resources/list')
  check(
    '未知方法 → -32601',
    (unknown.error?.['code'] as number) === -32601,
    `${String(unknown.error?.['code'])} · ${String(unknown.error?.['message'])}`,
  )
  const missing = await client.request('tools/call', {
    name: 'read_book',
    arguments: { bookId: 'no-such-book' },
  })
  check(
    '不存在的书号 → isError + 一句人话',
    (missing.result?.['isError'] as boolean) === true,
    firstLine(textOf(missing)),
  )
  const badArgs = await client.request('tools/call', {
    name: 'plan_book',
    arguments: { child: 'xiaolu', theme: '恐龙', form: '睡前版' },
  })
  check(
    '参数写错 → isError 并列出合法值',
    (badArgs.result?.['isError'] as boolean) === true && textOf(badArgs).includes('solo'),
    firstLine(textOf(badArgs)),
  )

  await client.settle(200)
  client.stop()

  /* ── 判据 2：同一本书、同一串事件 ── */
  process.stdout.write('\n⑥ 判据 2（与 engine-run --mode=stub 等价）\n')
  const mine = resolve(MCP_ROOT, 'u', USER)
  const a = await readJson(`${RUN_ROOT}/books/${bookId}/book.json`)
  const b = await readJson(`${mine}/books/${bookId}/book.json`)
  check('两边的书号相同', a !== null && b !== null, bookId)
  if (a !== null && b !== null) {
    check(
      'book.json 去掉时间字段后逐字节相同',
      stable(stripTime(a)) === stable(stripTime(b)),
      firstDifference(stripTime(a), stripTime(b)),
    )
  }
  // ★ 两边的事件**来源不同名**，这是它们各自的身份决定的：
  //   对照臂（`engine-run.mts`）是一次跑完的脚本，它不写 `events.jsonl`——
  //   原始事件在它落盘的 `summary.json` 的 `eventsRaw` 里（那段注释解释过为什么留）
  //   ；MCP 这一侧走的是**产品那条路**（事件落 `books/<id>/events.jsonl`）。
  //   拿 MCP 的日志去比 engine-run 的日志文件，只会读到 0 条——实测就是这么发现的。
  const summaryA = (await readJson(`${RUN_ROOT}/summary.json`)) as Json | null
  const eventsA = (summaryA?.['eventsRaw'] as unknown[]) ?? []
  const eventsB = await readEvents(`${mine}/books/${bookId}/events.jsonl`)
  check(
    `事件流语义相同（${eventsB.length} 条；全局按序、页级按页归并）`,
    stable(normalizeEvents(eventsA)) === stable(normalizeEvents(eventsB)),
    eventsA.length === eventsB.length
      ? firstDifference(stable(normalizeEvents(eventsA)), stable(normalizeEvents(eventsB)))
      : `条数就不同：对照臂 ${eventsA.length} 条，MCP ${eventsB.length} 条`,
  )

  // ★ 更锋利的一条：插画事件里的资产路径**真的在盘上**。
  //   少了它，"同一串事件"可以靠两串**都指向空气**的事件流满足。
  const illustrationPaths = eventsB
    .filter((one) => (one as Json)['kind'] === 'illustration')
    .map((one) => (one as Json)['assetPath'] as string)
  let onDisk = 0
  for (const path of illustrationPaths) {
    if (await exists(`${mine}/${path}`)) onDisk += 1
  }
  check(
    `插画事件指的 ${illustrationPaths.length} 个文件真的在盘上`,
    illustrationPaths.length > 0 && onDisk === illustrationPaths.length,
    `${onDisk}/${illustrationPaths.length}`,
  )

  /* ── 判据 5：会话记录 ── */
  await writeFile(
    TRANSCRIPT,
    client.log.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  )
  const passed = checks.filter((one) => one.ok).length
  await writeFile(
    SUMMARY,
    JSON.stringify({ bookId, passed, total: checks.length, checks }, null, 2),
    'utf8',
  )

  process.stdout.write('\n' + '─'.repeat(70) + '\n')
  for (const one of checks) process.stdout.write(`${one.ok ? '✅' : '❌'} ${one.name}\n`)
  process.stdout.write(
    `\n${passed}/${checks.length} 条过 · 会话记录 ${TRANSCRIPT}（${client.log.length} 条双向消息）\n`,
  )
  if (!flag('keep')) {
    process.stdout.write('（资产根留在 .out/mcp-session 与 .out/engine-run，看完可以自己删）\n')
  }
  if (passed !== checks.length) process.exitCode = 1
}

/* ───────────────────────── 小工具 ───────────────────────── */

function textOf(message: Received): string {
  const content = message.result?.['content']
  if (!Array.isArray(content)) return String(message.error?.['message'] ?? '')
  return content
    .map((part) => (part as Json)['text'])
    .filter((text): text is string => typeof text === 'string')
    .join('\n')
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').slice(0, 120)
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'))
  } catch {
    return null
  }
}

async function readEvents(path: string): Promise<unknown[]> {
  try {
    return (await readFile(resolve(path), 'utf8'))
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(resolve(path))
    return true
  } catch {
    return false
  }
}

/** 第一条不一样的地方。★ 只说"不同"的话，下一个人得自己从头 diff */
function firstDifference(a: unknown, b: unknown): string {
  const left = stable(a).split('\n')
  const right = stable(b).split('\n')
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      return `第 ${index + 1} 行不同：对照臂 ${String(left[index]).slice(0, 60)}… / MCP ${String(right[index]).slice(0, 60)}…`
    }
  }
  return '相同'
}

main().catch((err: unknown) => {
  process.stderr.write(
    `\n失败：${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  )
  process.exitCode = 1
})
