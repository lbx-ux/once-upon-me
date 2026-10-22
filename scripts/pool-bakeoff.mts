/**
 * pool-bakeoff.mts —— 并发池值不值（2026-10-21，工单 D-03 判据②③）
 *
 * ```bash
 * node scripts/pool-bakeoff.mts                 # 20 页、每次出图 1.5s、每档 3 轮
 * node scripts/pool-bakeoff.mts --pages=8 --latency=800 --rounds=3
 * ```
 *
 * ── 这一支量的是池子，不是供应商 ─────────────────────────────────────────────
 *
 * "出图要多久"在这一支里是一个**参数**（`--latency`），不是读数。所以它量出来的
 * 是**并发池把这一段时间压到了几分之一**，而不是"这本书要跑多久"。
 * 后一个数只能由真跑测给（盘上五本真书 12.5 / 19.1 / 174.2 / 60.6 / 70.1 分钟，
 * `docs/business.md` §1.2；单次出图尝试 ≈154 s）。两个数在报告里必须分开写：
 * 把这一支的秒数当成"上线后有多快"，就是把我们自己造的那 1.5 秒当成了供应商的脾气。
 *
 * 换算那一步是明写的（两个真读数：17 s/次与 154 s/次，见 `REAL_LATENCY_MEASURED_S` 那段）：
 * 串行 = 页数 × 每次；并发 = ⌈页数 ÷ 上限⌉ × 每次（每页出一次图、没有重画时）。
 *
 * ── 为什么用真引擎而不是"数一数开了几个 worker" ───────────────────────────
 *
 * 走的是 `runBook` 那条**真路由**（规划 → 逐页画 → 封面 → 装订），只有供应商是替身
 * （固定耗时 + 固定分数），存储是内存。这样量到的挂钟时间里含引擎自己的开销
 * （prompt 现算、落盘、事件），而不只是 `setTimeout` 的堆叠。
 *
 * ── 判据③那一半：一致性分与重画率不许退化 ──────────────────────────────────
 *
 * 剧本里第 4 页第 1 次判"不像"（0.30 < 0.75），其余页一次过。于是两个档都必须
 * 产出同一组东西：每页几次尝试、每页的分、首次通过数、重画数、总账。
 * 这些**逐字段比**，不比"看起来差不多"。
 *
 * ★ 另外留了两个数做自证：`在飞峰值`（替身自己数的，1 档必须是 1、3 档必须是 3）
 *   与 `每页事件子序列是否与串行档逐条相同`。少了前一个，"池子没生效"与
 *   "池子生效了但机器慢"在挂钟上分不出来。
 *
 * ★ **页数太少时这一支会判不过，而那不是池子的问题**：封面不在池子里（`runBook` 把它排在
 *   页图之后），所以"页图 + 重画 + 封面"里那一次固定的封面调用，在页数少时占的比例很大。
 *   实测的临界点是 **5 页**（4 页时往下取整成"串行 6 次、池里 3 次"，比值正好 0.50，
 *   过不了 `< 0.50`）。要跑小规模就用 `--pages=5` 以上，别拿 4 页那一档去读池子。
 */

import { performance } from 'node:perf_hooks'

import { runBook } from '../src/lib/engine/index.ts'
import { createMemoryStore } from '../src/lib/engine/providers/stores.ts'
import { ensureStubCard, STUB_CHILD } from '../src/lib/stub-fixture.ts'
import type { EngineEvent, Book } from '../src/lib/engine/domain.ts'
import type { EngineEventPayload } from '../src/lib/engine/events.ts'
import type {
  ImageGenerator,
  ImageRequest,
  PictureReviewer,
  ProviderBundle,
  VisionComparator,
} from '../src/lib/engine/providers/types.ts'

const args: Record<string, string> = {}
for (const item of process.argv.slice(2)) {
  const hit = /^--([^=]+)(?:=(.*))?$/.exec(item)
  if (hit) args[hit[1] as string] = hit[2] ?? '1'
}
const PAGES = Number(args['pages'] ?? 20)
const LATENCY_MS = Number(args['latency'] ?? 1500)
const ROUNDS = Number(args['rounds'] ?? 3)
/** 只用来把秒数换算成"真供应商下一次出图 ≈154 s"那一档，不参与计时 */
/** 一致性阈值（`illustrate.ts` 的 `DEFAULT_THRESHOLD`），剧本按它写 */
const THRESHOLD = 0.75
/** 哪一页、第几次不像 */
const MISS_PAGE = 4

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 一份 N 页的规划表（形状照 `scripts/fixtures/demo-plan.json`，`planStory` 认的就是它） */
function planJson(pages: number): string {
  const nodes = Array.from({ length: pages }, (_, index) => ({
    scene: `第 ${index + 1} 页的场景`,
    body: [`第 ${index + 1} 页的第一句。`, `第 ${index + 1} 页的第二句。`],
    imagePrompt: `第 ${index + 1} 页的画面：孩子与一朵云`,
    mood: 'wonder',
  }))
  return JSON.stringify({ title: `并发池横评（${pages} 页）`, nodes })
}

/**
 * 定长替身。它在**每次出图**里睡 `LATENCY_MS`——这一支唯一的自变量。
 * 同时自己数在飞峰值：那是"并发上限真的生效"唯一的物证。
 */
function latencyImage(latencyMs: number): { image: ImageGenerator; peak: () => number } {
  let inFlight = 0
  let peak = 0
  const image: ImageGenerator = {
    id: 'latency-stub',
    modelId: `latency-stub@${latencyMs}ms`,
    supportedRatios: ['1:1', '3:2'],
    supportsReference: false,
    async generate(req: ImageRequest) {
      const pageNo = Number(/第 (\d+) 页/.exec(req.prompt)?.[1] ?? 0)
      const attempt = (attempts.get(pageNo) ?? 0) + 1
      attempts.set(pageNo, attempt)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try {
        await sleep(latencyMs)
        // 字节里编着「第几页的第几次」：比对器只拿得到这张图，靠它才知道该给几分
        return {
          bytes: new Uint8Array([pageNo, attempt]),
          mime: 'image/png',
          modelId: `latency-stub@${latencyMs}ms`,
          referenceApplied: false,
          costCny: 0.2,
        }
      } finally {
        inFlight -= 1
      }
    },
  }
  const attempts = new Map<number, number>()
  return { image, peak: () => peak }
}

/** 剧本：第 4 页第 1 次不像，其余一次过。分数从图上的字节里读（见 `latencyImage`） */
function scriptedVision(): VisionComparator & PictureReviewer {
  return {
    id: 'scripted-vision',
    modelId: 'scripted-vision',
    async compare({ pageDataUrl }) {
      const bytes = Buffer.from(pageDataUrl.slice(pageDataUrl.indexOf(',') + 1), 'base64')
      const pageNo = bytes[0] ?? 0
      const attempt = bytes[1] ?? 0
      const score = pageNo === MISS_PAGE && attempt === 1 ? 0.3 : 0.95
      return {
        score,
        missed: score < THRESHOLD ? ['eyes'] : [],
        reason: score < THRESHOLD ? '不像' : '像',
        modelId: 'scripted-vision',
      }
    },
    // 画面审核这一档不给（`null` 走"没审过"），横评量的是池子，不是审核
    async reviewPicture() {
      return { findings: null, reason: '横评不跑画面审核' }
    },
  }
}

type Arm = {
  concurrency: number
  ms: number
  stats: Book['stats']
  pages: { pageNo: number; attempt: number; score: number | null }[]
  events: EngineEventPayload[]
  peak: number
  bookId: string
}

async function oneRun(concurrency: number): Promise<Arm> {
  const store = createMemoryStore()
  const card = await ensureStubCard(store, { now: 0 })
  const scripted = latencyImage(LATENCY_MS)
  const providers: ProviderBundle = {
    mode: 'offline',
    text: {
      id: 'stub-text',
      modelId: 'stub-plan@v1',
      async complete() {
        return { text: planJson(PAGES), modelId: 'stub-plan@v1' }
      },
      async stream(_req, _budget, onDelta) {
        const text = planJson(PAGES)
        onDelta({ text, streamed: false })
        return { text, modelId: 'stub-plan@v1' }
      },
    },
    image: scripted.image,
    vision: scriptedVision(),
    voice: null,
    store,
  }
  const events: EngineEventPayload[] = []
  const started = performance.now()
  const book = await runBook(
    {
      child: STUB_CHILD,
      card,
      theme: '并发池横评',
      // 独读版：这一支不需要选择点，而共读版**必须**有一个（`planStory` 会当场判"树形不合法"）。
      //   写 shared 的那一版实测被拒了三次规划重试——那次错误消息本身是对的，是我选错了形态
      form: 'solo',
      pages: PAGES,
      illustrationConcurrency: concurrency,
    },
    {
      providers,
      onEvent: (event: EngineEvent) => {
        events.push(event)
      },
      now: () => Date.now(),
    },
  )
  const ms = performance.now() - started
  return {
    concurrency,
    ms,
    stats: book.stats,
    pages: book.illustrations
      .map((item) => ({
        pageNo: item.pageNo,
        attempt: item.attempt,
        score: item.consistency?.score ?? null,
      }))
      .sort((a, b) => a.pageNo - b.pageNo),
    events,
    peak: scripted.peak(),
    bookId: book.bookId,
  }
}

/**
 * 一个页号上的事件子序列（判据①：并发只许改页与页的穿插，不许改一页自己的一生）。
 *
 * ★ 比之前要**把 `seq` 与 `at` 摘掉**。这两个数是全局的：并发之下第 3 页那条事件的
 *   `seq` 当然与串行档不一样（它前面多插了第 2 页的两条），`at` 更是挂钟。
 *   拿整条事件去比，量到的是"穿插变了没有"——而那正是应该变的东西。
 */
function eventsOf(events: EngineEventPayload[], pageNo: number): string[] {
  return events
    .filter((event) => 'pageNo' in event && event.pageNo === pageNo)
    .map((event) => JSON.stringify(strip(event)))
}

/**
 * 摘掉全局序号与时刻（见 `eventsOf` 那段）；`wholeStreamEqual` 也要用它才对得上口径。
 *
 * ★ 这里是 `delete` 而不是解构丢弃（`const { seq, at, ...rest }`）：后者在 eslint 那边
 *   报三条 `no-unused-vars` 警告（这个仓库的配置不认下划线前缀），而那三条警告会一直
 *   挂在 `pnpm lint` 上——一条"已知的、没人打算修的警告"比没有警告更坏。
 */
function strip(event: EngineEventPayload): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(event as Record<string, unknown>) }
  delete out['seq']
  delete out['at']
  return out
}

/** 统计里除了挂钟那一项，其余都不许因为并发而变（挂钟当然会变，它是这一支的自变量） */
function statsWithoutClock(stats: Book['stats']): Record<string, number> {
  const out: Record<string, number> = { ...(stats as unknown as Record<string, number>) }
  delete out['elapsedMs']
  return out
}

const median = (list: number[]): number => {
  const sorted = [...list].sort((a, b) => a - b)
  const half = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[half] as number)
    : ((sorted[half - 1] as number) + (sorted[half] as number)) / 2
}

const secs = (ms: number): string => (ms / 1000).toFixed(1)

/**
 * 换算用的两个"真供应商每次出图"的数——**都是换算，不是这一支量出来的**。
 *
 * ★ 两个都要印出来，因为今天这两条**对不上**，而对不上这件事本身要留在报告里：
 *
 * | 数 | 来处 | 它是什么 |
 * | --- | --- | --- |
 * | **17 s** | `scripts/probe-image-concurrency.mts`，2026-10-21：1024² 六次 15.2–17.7 s；**页图那个尺寸（1536×1024）三次 16.7–18.4 s** | 干净的一次 `generate`（含下字节），3 路同发 |
 * | **154 s** | `illustrate.ts` 里那条"20 页 ≥51.4 分钟"的下界 | 从一次**网络中断**（约 36 分钟、18 页 fetch failed）里按 mtime 反推的"每次尝试" |
 *
 * 两个不是同一件事：154 s 那次含重试与等待，而并发是 1。在真页图那个尺寸上量到的
 * 17 s 与它差了约 9 倍——所以下面两个换算都要印出来，而不是挑一个。
 */
const REAL_LATENCY_MEASURED_S = 17
const REAL_LATENCY_COMMENT_S = 154

/**
 * 把实测的调用次数换成整本用时。
 *
 * 用的调用次数是**实测那一轮的真数**（`stats.imageCalls`，含重画），不是"页数"：
 * 这一支的剧本里第 4 页重画过一次，所以 20 页那一档是 21 次页图 + 1 次封面 = 22 次。
 * ★ 封面**不在池子里**（`runBook` 刻意排在页图之后，见那一段的理由），所以它按一整次算。
 */
function projectMinutes(imageCalls: number, latencyS: number, concurrency: number): number {
  const pageCalls = Math.max(0, imageCalls - 1)
  const coverCalls = imageCalls - pageCalls
  const waves = concurrency === 1 ? pageCalls : Math.ceil(pageCalls / concurrency)
  return ((waves + coverCalls) * latencyS) / 60
}

async function main(): Promise<void> {
  process.stdout.write(
    `并发池横评：${PAGES} 页 · 每次出图 ${LATENCY_MS} ms（替身，不是供应商）· 每档 ${ROUNDS} 轮\n` +
      `剧本：第 ${MISS_PAGE} 页第 1 次判"不像"（0.30 < ${THRESHOLD}），重画一次\n` +
      `路由：runBook（规划 → 逐页画 → 封面 → 装订）· 存储：内存\n\n`,
  )

  const arms: Arm[][] = []
  for (const concurrency of [1, 3]) {
    const runs: Arm[] = []
    for (let round = 1; round <= ROUNDS; round += 1) {
      const run = await oneRun(concurrency)
      runs.push(run)
      process.stdout.write(
        `  上限 ${concurrency} · 第 ${round} 轮 — 挂钟 ${secs(run.ms)}s · ` +
          `在飞峰值 ${run.peak} · 出图 ${run.stats.imageCalls} 次 · ` +
          `首次通过 ${run.stats.firstPassCount} · 重画 ${run.stats.redrawCount} · ` +
          `账 ${run.stats.totalCostCny.toFixed(2)} 元\n`,
      )
    }
    arms.push(runs)
  }

  const serialRun = (arms[0] as Arm[])[0] as Arm
  const pooledRun = (arms[1] as Arm[])[0] as Arm
  const serial = arms[0] as Arm[]
  const pooled = arms[1] as Arm[]
  const serialMs = serial.map((run) => run.ms)
  const pooledMs = pooled.map((run) => run.ms)
  const serialMed = median(serialMs)
  const pooledMed = median(pooledMs)
  const ratio = pooledMed / serialMed

  process.stdout.write(
    `\n── 判据②：用时 ──────────────────────────────────────────\n` +
      `  上限 1（串行）  中位 ${secs(serialMed)}s  ${serialMs.map(secs).join(' / ')}\n` +
      `  上限 3         中位 ${secs(pooledMed)}s  ${pooledMs.map(secs).join(' / ')}\n` +
      `  比值 ${ratio.toFixed(2)}（判据要求 < 0.50）→ ${ratio < 0.5 ? '过' : '★ 不过'}\n` +
      `  ★ 上面两行量的是**池子**（供应商是替身）。把 ${serialRun.stats.imageCalls} 次出图\n` +
      `    （页图含重画 + 封面一次）按两个**真读数**各换算一遍：\n` +
      `     · 按今天探针量到的 ${REAL_LATENCY_MEASURED_S}s/次（页图那个尺寸三次 16.7–18.4 s）：串行 ≈ ` +
      `${projectMinutes(serialRun.stats.imageCalls, REAL_LATENCY_MEASURED_S, 1).toFixed(1)} 分钟 · ` +
      `上限 3 ≈ ${projectMinutes(serialRun.stats.imageCalls, REAL_LATENCY_MEASURED_S, 3).toFixed(1)} 分钟\n` +
      `     · 按 ` +
      `\`illustrate.ts\` 里那条 ${REAL_LATENCY_COMMENT_S}s/次的下界：串行 ≈ ` +
      `${projectMinutes(serialRun.stats.imageCalls, REAL_LATENCY_COMMENT_S, 1).toFixed(1)} 分钟 · ` +
      `上限 3 ≈ ${projectMinutes(serialRun.stats.imageCalls, REAL_LATENCY_COMMENT_S, 3).toFixed(1)} 分钟\n` +
      `     ★ 两条都对不上"上线后要跑多久"：换算是乘法，而真跑还有抖动、限流退避、\n` +
      `       审核与配音；比值（约 1/3）才是这一支真正量到的东西\n`,
  )

  const sameScores = JSON.stringify(serialRun.pages) === JSON.stringify(pooledRun.pages)
  const sameStats =
    JSON.stringify(statsWithoutClock(serialRun.stats)) ===
    JSON.stringify(statsWithoutClock(pooledRun.stats))
  const perPageEqual = Array.from({ length: PAGES }, (_, index) => index + 1).every(
    (pageNo) =>
      JSON.stringify(eventsOf(pooledRun.events, pageNo)) ===
      JSON.stringify(eventsOf(serialRun.events, pageNo)),
  )
  const wholeStreamEqual =
    JSON.stringify(serialRun.events.map((event) => strip(event))) ===
    JSON.stringify(pooledRun.events.map((event) => strip(event)))

  process.stdout.write(
    `\n── 判据①③：一页自己的次序没变、分与重画率不退化 ────────────\n` +
      `  逐页事件子序列与串行档逐条相同：${perPageEqual ? '是' : '★ 不是'}\n` +
      `  整串事件流相同：${wholeStreamEqual ? '★ 相同（那说明并发根本没生效）' : '否（对：页与页的穿插变了）'}\n` +
      `  每页（页号 / 第几次 / 分）逐条相同：${sameScores ? '是' : '★ 不是'}\n` +
      `  统计（imageCalls / 首次通过 / 重画 / 账）逐字段相同：${sameStats ? '是' : '★ 不是'}\n` +
      `  在飞峰值：串行 ${serialRun.peak} · 上限 3 ${pooledRun.peak}（应为 1 与 3）\n` +
      `  第 ${MISS_PAGE} 页：${JSON.stringify(pooledRun.pages[MISS_PAGE - 1])}\n`,
  )

  const ok =
    ratio < 0.5 &&
    perPageEqual &&
    !wholeStreamEqual &&
    sameScores &&
    sameStats &&
    serialRun.peak === 1 &&
    pooledRun.peak === 3 &&
    serial.every((run) => run.peak === 1) &&
    pooled.every((run) => run.peak === 3)
  process.stdout.write(`\n${ok ? '全部判据通过' : '★ 有判据不过'}\n`)
  process.exit(ok ? 0 : 1)
}

await main()
