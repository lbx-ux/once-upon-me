/**
 * web-run.mts —— 走 HTTP 真跑一本，并把**线上那条流**与**落盘那份日志**对起来
 *
 * 用法（先起一个 dev server）：
 *
 * ```bash
 * node scripts/dev-preview.mjs --dist=.next-w2 --port=1950
 * node scripts/web-run.mts --base=http://localhost:1950 --pages=3
 * node scripts/web-run.mts --base=http://localhost:1950 --pages=3 --probe-env=1   # 验 per-request Env
 * ```
 *
 * 它是工单 02 的验收脚本，做四件事，每一件都对应工单里的一条判据：
 *
 * 1. **消费那条 SSE**：用的是与浏览器**同一个解码器**（`src/lib/engine/sse.ts` +
 *    `src/lib/book-stream.ts`），不是脚本另写一个松一点的解析。
 *    横评那一轮的教训（README §五 第一类）：测量脚本自己搭一条流水线，
 *    量出来的就不是产品的数。
 * 2. **按顺序打事件**：用引擎的 `describeEvent` 打人话——同一个函数也是界面要用的那个，
 *    所以这份终端输出就是"界面上会出现什么"的可离线证据（演示视频的素材也是它）。
 * 3. **对账**：线上收到的 engine 帧 与 `events.jsonl` 里的事件**逐条相等**，
 *    且 delta 帧一条都不在日志里（工单 02 验收第 2 条）。
 * 4. **验 per-request Env 真的生效**（ADR-0008，`--probe-env=1`）：脚本在请求体里把
 *    `VISION_MODEL` 送成**空串**（`.env.local` 里是有值的）。空 = 没有比对能力，
 *    所以这一轮的每一页都该是"未核对"。
 *    ★ 上一版探针是拿 `IMAGE_UNIT_COST_CNY` 与 `BookStats.totalCostCny` 对照的，
 *    那是**错的**：引擎从来没有把每张图的实付金额回填进 `Illustration`
 *    （`illustrate.ts` 的返回值里没有 `costCny`），所以那个和恒为 0 ——
 *    拿一个恒零的量当判据，等于拿更弱的事实回答更强的问题。
 *    换成"送空值 → 看行为变不变"，送真值、看回值。
 *
 * 另外顺手验两件不属于"跑通"但属于"不许撒谎"的事：
 *   · 日志里出现半行时，重放接口要**跳过并报数**（不是崩，也不是静默吞掉）
 *   · 请求体里的密钥**不得出现在**线上流与落盘日志的任何位置
 *
 * ★ 不打印任何金额：脚本里出现的货币口径只有"跟着 `.env.local` 的那个常量"，
 *   而它不进输出（口径见 scripts/env.mts 文件头）。
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describeEvent } from '../src/lib/engine/events.ts'
import { decodeBookFrame, type BookStreamFrame } from '../src/lib/book-stream.ts'
import { parseEventLog } from '../src/lib/event-log.ts'
import { createSseDecoder } from '../src/lib/engine/sse.ts'
import type { EngineEvent } from '../src/lib/engine/index.ts'
import { arg, readEnv } from './env.mts'

/** 白名单：只把我们认得的供应商变量送过去。per-request Env 的语义就是"这一张表说了算" */
const PROVIDER_KEYS = [
  'LLM_MODEL',
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MAX_TOKENS',
  'LLM_THINKING',
  'LLM_JSON_MODE',
  'IMAGE_MODEL',
  'IMAGE_API_KEY',
  'IMAGE_BASE_URL',
  'VISION_MODEL',
  'VISION_API_KEY',
  'VISION_BASE_URL',
  'VISION_TIMEOUT_MS',
] as const

const PROBE_ENV = arg('probe-env', '0') === '1'

async function main(): Promise<void> {
  const base = arg('base', 'http://localhost:3100').replace(/\/+$/, '')
  const pages = Number(arg('pages', '2'))
  const theme = arg('theme', '第一次离开家也不怕')
  const cardId = arg('card', 'xiaoyu-r1')
  const outDir = resolve(arg('out', `.out/web-run/${Date.now()}`))
  const assetRoot = resolve(arg('assets', '.out/web'))

  const env = await readEnv()
  const providers: Record<string, string> = {}
  const missing: string[] = []
  for (const key of PROVIDER_KEYS) {
    const value = env[key]?.trim()
    if (value) providers[key] = value
    else if (key.endsWith('_API_KEY') && !key.startsWith('VISION')) missing.push(key)
    else if (key.endsWith('_MODEL') && !key.startsWith('VISION')) missing.push(key)
  }
  if (missing.length > 0) {
    throw new Error(`.env.local 缺这些必填项：${missing.join(' / ')}（本脚本不打印它们的值）`)
  }
  // 探针：把视觉比对**关掉**（送空串）。服务端的 process.env 里它有值，
  // 所以"这一轮的每一页都未核对"只可能来自请求体那张表
  if (PROBE_ENV) providers['VISION_MODEL'] = ''

  const body = {
    child: {
      childId: 'xiaoyu',
      name: '小宇',
      nameReading: 'yǔ',
      ageBand: '4-6',
      lookTags: ['圆脸', '短发'],
      interestTags: ['云', '恐龙', '船'],
    },
    cardId,
    theme,
    form: 'solo',
    pages,
    mode: 'live',
    env: providers,
  }

  await mkdir(outDir, { recursive: true })
  process.stdout.write(`web-run · POST ${base}/api/books · pages=${pages} · 输出 ${outDir}\n\n`)

  const response = await fetch(`${base}/api/books`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok || !response.body) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}：${text}`)
  }
  process.stdout.write(`HTTP ${response.status} · ${response.headers.get('content-type')}\n\n`)

  const decoder = createSseDecoder()
  const reader = response.body.getReader()
  const textDecoder = new TextDecoder()
  const frames: BookStreamFrame[] = []
  let raw = ''
  let bookId: string | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = textDecoder.decode(value, { stream: true })
    raw += chunk
    for (const sse of decoder.push(chunk)) {
      const frame = decodeBookFrame(sse)
      if (!frame) {
        process.stdout.write(`⚠ 解不出来的帧：event=${sse.event} data=${sse.data.slice(0, 120)}\n`)
        continue
      }
      frames.push(frame)
      if (frame.kind === 'engine') {
        const event: EngineEvent = frame.event
        process.stdout.write(`[${String(event.seq).padStart(2, '0')}] ${describeEvent(event)}\n`)
        if (event.kind === 'book-ready') bookId = event.bookId
      } else if (frame.kind === 'fatal') {
        process.stdout.write(`✗ fatal ${frame.code}：${frame.message}\n`)
      } else {
        process.stdout.write(`· ${frame.kind} ${JSON.stringify(frame)}\n`)
      }
    }
  }
  await writeFile(join(outDir, 'stream.sse'), raw, 'utf8')

  if (!bookId) throw new Error('整条流里没有 book-ready，这一轮没跑出成品（上面有原因）')

  /* ── 对账 ───────────────────────────────────────────────────────────── */

  const logText = await readFile(join(assetRoot, 'books', bookId, 'events.jsonl'), 'utf8')
  const log = parseEventLog(logText)
  const streamEvents = frames.flatMap((f) => (f.kind === 'engine' ? [f.event] : []))
  const streamDeltas = frames.filter((f) => f.kind === 'delta')

  const sameCount = streamEvents.length === log.events.length
  const sameJson =
    sameCount && streamEvents.every((e, i) => JSON.stringify(e) === JSON.stringify(log.events[i]))

  process.stdout.write(
    `\n对账：线上 engine 帧 ${streamEvents.length} 条 · 日志 ${log.events.length} 条` +
      `（坏行 ${log.skipped}）· ${sameJson ? '逐条相等 ✓' : '★ 不一致 ✗'}\n` +
      `　　　delta 帧 ${streamDeltas.length} 条，日志里 ${log.events.some((e) => e.kind === 'delta') ? '有 ★' : '没有 ✓'}\n` +
      `　　　日志里是 delta 的帧：${logText.includes('"kind":"delta"') ? '有 ★' : '没有 ✓'}\n`,
  )

  /* ── per-request Env 生效判定（ADR-0008，只在 --probe-env=1 时下结论） ── */

  const illustration = streamEvents.filter((e) => e.kind === 'illustration')
  if (PROBE_ENV) {
    // 送空 VISION_MODEL → 引擎该走"未核对"路径（不是"通过"，也不是"不通过"）
    const judged = streamEvents.filter((e) => e.kind === 'consistency')
    const unavailable = judged.filter(
      (e) => e.kind === 'consistency' && e.verdict === 'unavailable',
    )
    const modelId =
      illustration[0]?.kind === 'illustration' ? illustration[0].modelId : '（没出图）'
    const pass = judged.length > 0 && unavailable.length === judged.length
    process.stdout.write(
      `per-request Env（请求体里 VISION_MODEL 送空串，.env.local 里有值）：` +
        `核对事件 ${judged.length} 条，其中"未核对" ${unavailable.length} 条 → ` +
        `${pass ? '请求体那张表生效了 ✓' : '★ 没生效（服务端的 process.env 赢了）'}\n` +
        `　　　出图模型 id（也来自请求体）：${modelId}\n`,
    )
  } else {
    const modelId =
      illustration[0]?.kind === 'illustration' ? illustration[0].modelId : '（没出图）'
    process.stdout.write(`模型 id 来自请求体那张表：${modelId}（--probe-env=1 可验它的优先级）\n`)
  }

  /* ── 密钥不许出现在两个地方 ─────────────────────────────────────────── */

  const secrets = ['LLM_API_KEY', 'IMAGE_API_KEY', 'VISION_API_KEY']
    .map((key) => providers[key])
    .filter((value): value is string => Boolean(value))
  const leak = (haystack: string, label: string): string[] =>
    secrets.flatMap((secret) =>
      [secret, secret.slice(0, 8)].some((needle) => needle.length >= 6 && haystack.includes(needle))
        ? [`${label} 里出现了密钥片段`]
        : [],
    )
  const leaks = [...leak(raw, '线上流'), ...leak(logText, 'events.jsonl')]
  process.stdout.write(
    `密钥检查：${leaks.length === 0 ? '线上流与日志里都没有 ✓' : `★ ${leaks.join('；')}`}\n`,
  )

  /* ── 重放接口：含半行时跳过并报数 ───────────────────────────────────── */

  const probeId = `__probe-${Date.now()}`
  const probeDir = join(assetRoot, 'books', probeId)
  await mkdir(probeDir, { recursive: true })
  await writeFile(
    join(probeDir, 'events.jsonl'),
    `{"seq":1,"at":1,"stage":"planning","kind":"stage","phase":"begin"}\n{"seq":2,"at":2,"stag`,
    'utf8',
  )
  const replay = await fetch(`${base}/api/books/${probeId}/events`)
  const replayFrames = createSseDecoder()
    .push(await replay.text())
    .map((sse) => decodeBookFrame(sse))
    .filter((frame): frame is BookStreamFrame => frame !== null)
  const status = replayFrames.find((frame) => frame.kind === 'status')
  const replayed = replayFrames.filter((frame) => frame.kind === 'engine').length
  process.stdout.write(
    `重放接口（喂了 1 条好的 + 1 条半行）：解出 ${replayed} 条 · ` +
      `status=${JSON.stringify(status)}` +
      ` → ${replayed === 1 && status?.kind === 'status' && status.skippedLines === 1 ? '跳过并报数 ✓' : '★ 不对'}\n`,
  )
  await rm(probeDir, { recursive: true, force: true })

  /* ── 汇总 ───────────────────────────────────────────────────────────── */

  const fatal = frames.find((f) => f.kind === 'fatal')
  // ★ 页级失败与非页级 error 分开数：引擎那条"配音未接入"是**没有页号**的非致命事件，
  //   把它算进"页级失败"会让汇总行虚报一页。同一个教训在 engine-run.mts 的汇总行里
  //   已经付过一次学费（README §五 第四类：三档分类漏一档，读的人只能猜）。
  const pageFailures = streamEvents.filter(
    (e) => e.kind === 'error' && e.pageNo !== undefined,
  ).length
  const otherErrors = streamEvents.filter(
    (e) => e.kind === 'error' && e.pageNo === undefined,
  ).length
  process.stdout.write(
    `\n完成：bookId=${bookId} · 事件 ${log.events.length} 条 · 页级失败 ${pageFailures} 条 · ` +
      `非页级提示 ${otherErrors} 条` +
      `${fatal ? ` · ✗ 这一轮以 fatal 结束：${fatal.message}` : ''}\n` +
      `原始流：${join(outDir, 'stream.sse')}\n`,
  )
  process.exitCode = fatal ? 1 : 0
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
