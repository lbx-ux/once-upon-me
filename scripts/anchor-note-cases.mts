/**
 * anchor-note-cases.mts —— 「把比对结论喂回重画」到底有没有用（2026-10-20，计划表 B7）
 *
 * ```bash
 * node scripts/anchor-note-cases.mts                       # 全部：2 页 × 2 组 × 12 张
 * node scripts/anchor-note-cases.mts --n=2 --pages=8      # 先试一小批（4 张，验管道）
 * node scripts/anchor-note-cases.mts --pilot=0            # 跳过"这一页现在还失不失败"那一张
 * ```
 *
 * ★ 这个脚本回答的**只有一个问题**：同一个页面、同一份页面描述、同一张角色卡，
 *   重画那一次的提示词里**多一句"上一版哪几条锚点不像"**，画出来的东西
 *   **通过核对的比例会不会变高**。
 *   在那之前（`image-page@v3` 及更早），自动重画用的是与上一轮**逐字节相同**的
 *   提示词——锚点级的结论只进了 `retry` 事件（给家长看）。于是"自己判断像不像 →
 *   自己重画"这半截闭环里，诊断没有回到执行器，闭环是靠**人**合上的。
 *
 * ── 设计：两个**常量**提示词，A 组是空对照 ────────────────────────────────────
 *
 * | 组 | 提示词 | 是什么 |
 * |---|---|---|
 * | A（对照） | `pagePrompt({card, page, scene, mood})` | **今天的行为**：一模一样地再抽一次签 |
 * | B（处理） | 上面那一份 + `anchorNote` | 书上真实记录下来的那句"哪几条不像" |
 *
 * ★ A 组就是**空对照**（`w1-bakeoff-measurement-discipline` 第六条：永远配一个空对照）。
 *   没有它，"B 组通过率 50%"这句话没有分母——画图这件事本身就在随机漂，
 *   而那正是要量掉的东西。
 * ★ 两个提示词在整个跑测里是**常量**：`anchorNote` 取的是书上**真实记录**的那份
 *   `missedAnchors`（`events.jsonl` 里那次失败的原文），不是每一轮现算的。
 *   这一条要说清楚：真实流水线里那句话是从**紧挨着的那一张**来的，而这里把它固定住了。
 *   换来的是干净得多的因果——被检验的只有"提示词里有没有这一句"这一个变量，
 *   这是**简化**，不是等价（理由与代价都写在这里，别让读者自己猜）。
 * ★ 页级三行（画面/情节/情绪）**从 `book.json` 的 `tree.nodes` 读**，不在这里重抄：
 *   重抄一份的话，书上那两页改了、脚本不会跟着改，量出来的就是另一页。
 *
 * ── 三栏分开报，绝不合并 ────────────────────────────────────────────────────
 *
 * | 栏 | 是什么 |
 * |---|---|
 * | 通过率 | `compare` 的分 ≥ 产品自己的阈值（`DEFAULT_THRESHOLD`，**不重新标定**） |
 * | 分数分布 | 均值/中位/极值。它是**连续量**，判别力比二分高，两栏都要看 |
 * | 点名的锚点还在不在 | 上一次点名的那几条，这一次还被点名了吗（更贴题的一格） |
 *
 * 出图失败/比对没跑成的格子记成「**没测成**」，**不并进任何分子分母**
 * （量法纪律第四条：限流会把全称否定灌水）。只要还剩一格没测成，
 * 末行就不下全称结论。
 *
 * ★ **仪器自身的噪声底**：`--pilot=1` 那张图会被**同一个 `compare` 连打 3 次**。
 *   它是量具的重复性读数（同一份输入、同一个提示词、`temperature: 0`）——
 *   没有它，A/B 差 1 张就没法解释：那是提示词的功劳，还是尺子在抖。
 *   （`picture-review-cases.mts` 的 `--repeat=N` 是同一条纪律的另一次应用。）
 *
 * ★ 单价与花费**不打印**（10/13 定的口径，见 `scripts/env.mts` 文件头）。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { arg, readEnv } from './env.mts'
import { createCardStore } from '../src/lib/engine/character-card/store.ts'
import { checklistOf } from '../src/lib/engine/character-card/card.ts'
import { toDataUrl } from '../src/lib/engine/providers/http.ts'
import { createProviders } from '../src/lib/engine/providers/registry.ts'
import { createFsStore, extensionOf } from '../src/lib/engine/providers/stores.ts'
import { DEFAULT_IMAGE_SIZE, pagePrompt, anchorNoteOf } from '../src/lib/prompts/image.ts'
import { DEFAULT_THRESHOLD } from '../src/lib/engine/illustrate.ts'
import { ANCHOR_LABELS, type StoryNode } from '../src/lib/engine/domain.ts'
import type { Book } from '../src/lib/engine/index.ts'

/* ── 参数 ──────────────────────────────────────────────────────────────────── */

const USER = arg('user', '1')
const BOOK = arg('book', 'xiaoman-r1-638df001b4e9')
/** ★ 这两页是**那本书里真实失败过的**两页（见下面 `PAGES` 那段），不是随便挑的 */
const PAGES = arg('pages', '8,10')
  .split(',')
  .map((item) => Number(item.trim()))
  .filter((n) => Number.isFinite(n))
const N = Math.max(1, Number(arg('n', '12')))
/** 在飞几张图。★ 不要贪：这个网关对连打敏感（量法纪律第四条） */
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '2')))
/** 出图那一步的重试次数（退避）。比对**不重试**——与生产同一条：它一次要送两张 1440² */
const ATTEMPTS = Math.max(1, Number(arg('attempts', '4')))
const PILOT = arg('pilot', '1') !== '0'
/**
 * 只把两个提示词打出来就退出，**一张图都不出**。
 *
 * ★ 加它是为了先看清"B 组到底多了一句什么"，再决定要不要花一小时去跑。
 *   那一句是这一整个改动唯一的产物，值得在人按下回车之前先读一遍。
 */
const DRY = arg('dry', '0') === '1'
const OUT = resolve(arg('out', '.out/anchor-note'))
const ASSET_ROOT = resolve(arg('assets', `.out/web/u/${USER}`))

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
const stamp = () => new Date().toISOString().slice(11, 19)
const say = (line: string) => console.log(`${stamp()} ${line}`)

/* ── 输入：真卡、真参考图、真页面 ──────────────────────────────────────────── */

const store = await createFsStore(ASSET_ROOT)
const book = await store.readJson<Book>(`books/${BOOK}/book.json`)
if (!book) {
  console.error(`找不到 ${ASSET_ROOT}/books/${BOOK}/book.json`)
  process.exit(1)
}
const card = await createCardStore(store).latest(book.cardId)
if (!card) {
  console.error(`找不到角色卡 ${book.cardId}（latest）`)
  process.exit(1)
}
const refBytes = await store.read(card.reference.path)
if (!refBytes) {
  console.error(`角色卡的参考图不在盘上：${card.reference.path}`)
  process.exit(1)
}
const referenceDataUrl = toDataUrl(refBytes, card.reference.mime)

/**
 * 上一次那条**真实的失败记录**——这个脚本的"处理"就是它。
 *
 * ★ 从 `events.jsonl` 读，不从 `book.json` 的 `consistency` 读：清单里留下的是
 *   **最后一次**的结论（那可能是重画之后通过的、`missedAnchors` 为空的那一次），
 *   而这一档要的是**第 1 次没过时的原文**。那正是真实流水线里会喂回去的那一句。
 */
const eventBytes = await store.read(`books/${BOOK}/events.jsonl`)
const events = (eventBytes ? new TextDecoder().decode(eventBytes) : '')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as Record<string, unknown>)
  .filter((event) => event['kind'] === 'consistency')

const nodes = new Map((book.tree?.nodes ?? []).map((node: StoryNode) => [node.pageNo, node]))

type Case = {
  pageNo: number
  node: StoryNode
  /** 当时点名的那几条（原文，可能带「是否一致」这种尾巴） */
  missed: string[]
  /** A 组：今天的行为 */
  promptA: string
  /** B 组：多一句结论 */
  promptB: string
  /** 拼出来的那一句（`undefined` = 拼不出来，那 B 组就与 A 组**逐字节相同**） */
  note: string | undefined
  /**
   * 驾驶席那一张（无提示重画一次）的读数。`undefined` = 这一轮没跑（`--pilot=0`），
   * `null` = 跑了但没测成。
   */
  pilot?: { score: number; missed: string[]; seconds: number; repeat: number[] } | null
}

const cases: Case[] = []
for (const pageNo of PAGES) {
  const node = nodes.get(pageNo)
  if (!node) {
    console.error(`书里没有第 ${pageNo} 页`)
    process.exit(1)
  }
  const firstFail = (events ?? []).find(
    (event) =>
      event['pageNo'] === pageNo &&
      event['verdict'] === 'fail' &&
      Array.isArray(event['missedAnchors']) &&
      (event['missedAnchors'] as string[]).length > 0,
  )
  const missed = (firstFail?.['missedAnchors'] as string[] | undefined) ?? []
  const base = { card, page: node.imagePrompt, scene: node.scene, mood: node.mood }
  const note = anchorNoteOf(card, missed)
  cases.push({
    pageNo,
    node,
    missed,
    note,
    promptA: pagePrompt(base),
    promptB: note ? pagePrompt({ ...base, anchorNote: note }) : pagePrompt(base),
  })
}

/* ── `--dry=1`：只读不算 ───────────────────────────────────────────────────── */

if (DRY) {
  for (const item of cases) {
    console.log(`══ 第 ${item.pageNo} 页 ══════════════════════════════════`)
    console.log(`书上那次点名的是：${item.missed.join('、') || '（没有）'}`)
    console.log(
      `拼回提示词的那一句：${item.note ?? '（拼不出来 —— 这一页 B 组与 A 组逐字节相同）'}`,
    )
    console.log('')
    console.log('── A 组（今天的行为）' + '─'.repeat(40))
    console.log(item.promptA)
    console.log('')
    console.log('── B 组（只多了中间那一行）' + '─'.repeat(32))
    console.log(item.promptB)
    console.log('')
    const diff = item.promptB.split('\n').filter((line) => !item.promptA.split('\n').includes(line))
    console.log(`两组的差别（${diff.length} 行）：${diff.join(' ｜ ') || '（没有差别）'}`)
    console.log('')
  }
  console.log(`（--dry=1：一张图都没出。去掉它才会真跑 ${cases.length} 页 × 2 组 × ${N} 张）`)
  process.exit(0)
}

/* ── 量具 ──────────────────────────────────────────────────────────────────── */

/** `.env.local` + 进程环境（与别的跑测脚本同一个读法，见 `scripts/env.mts`） */
const env = await readEnv()

await mkdir(OUT, { recursive: true })
// ★ 走**生产同一个工厂**（`probe-vision-budget.mts` 开头那条）：跑测的配置必须就是
//   要上线的那个配置，否则量的是另一套东西
const { image, vision } = await createProviders({ env, mode: 'live', store })
if (!vision) {
  console.error('没有视觉模型（VISION_MODEL / VISION_API_KEY）——这一档判不了，退出')
  process.exit(1)
}
const checklist = checklistOf(card)

type Judgement = { score: number; missed: string[]; reason?: string }
type Produced = { score: number; missed: string[]; seconds: number; dataUrl: string }

/**
 * 一次核对。**不重试**：与生产一致（比对一次要送两张 1440² 的图，
 * 而它的产物是一个"没核对"的标记，重试的收益抵不上那次调用的代价）。
 */
async function judge(pageDataUrl: string): Promise<Judgement | null> {
  try {
    const out = await vision!.compare({ referenceDataUrl, pageDataUrl, checklist })
    if (out.score === null) return null
    return {
      score: out.score,
      missed: [...out.missed],
      ...(out.reason ? { reason: out.reason } : {}),
    }
  } catch (err) {
    say(`  ！比对调用失败：${(err as Error).message}`)
    return null
  }
}

/** 出一张图 + 核一次。任何一跳没跑成 → `null`（记「没测成」，绝不记成 fail） */
async function produce(prompt: string, tag: string): Promise<Produced | null> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const started = Date.now()
    try {
      const response = await image.generate({ prompt, size: DEFAULT_IMAGE_SIZE })
      const pageDataUrl = toDataUrl(response.bytes, response.mime)
      // ★ 落盘是为了**给人看**（判据最终要落到人能判的东西上）——也让报告里
      //   那张"尺子自己连打 3 次"用的是**同一份字节**（从内存里传，不从盘上读回来：
      //   读回来就要猜扩展名，猜错会在跑到一半时炸掉整轮）
      await writeFile(join(OUT, `${tag}${extensionOf(response.mime)}`), response.bytes)
      const judged = await judge(pageDataUrl)
      if (!judged) return null
      return {
        score: judged.score,
        missed: judged.missed,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        dataUrl: pageDataUrl,
      }
    } catch (err) {
      say(`  ！出图没跑成（第 ${attempt}/${ATTEMPTS} 次）${tag}：${(err as Error).message}`)
      if (attempt < ATTEMPTS) await sleep(3000 * attempt * 2)
    }
  }
  return null
}

/**
 * 点名的那几条锚点里，还有几条被点名（贴题的那一格）。
 *
 * ★ 两边的字符串形状不一样：记录里是「头身比是否一致」，而这一次可能回「头身比」。
 *   所以按 `ANCHOR_LABELS` 的**槽位名**归一，认不出的就用原文比。
 */
function labelsOf(missed: readonly string[]): string[] {
  return missed.map((text) => {
    const hit = card!.anchors.find((anchor) => text.includes(ANCHOR_LABELS[anchor.slot]))
    return hit ? ANCHOR_LABELS[hit.slot] : text.trim()
  })
}

/* ── 开工 ──────────────────────────────────────────────────────────────────── */

console.log(`锚点回灌 · 图像 ${image.modelId} · 视觉 ${vision.modelId}`)
console.log(`  书 ${BOOK} · 卡 ${book.cardId}（第 ${card.revision} 版）· 阈值 ${DEFAULT_THRESHOLD}`)
console.log(`  页 ${PAGES.join('、')} · 每组 ${N} 张 · 并发 ${CONCURRENCY}\n`)

for (const item of cases) {
  console.log(`── 第 ${item.pageNo} 页 ──────────────────────────────`)
  console.log(`  书上那次点名的是：${item.missed.join('、') || '（没有）'}`)
  console.log(`  拼回提示词的那一句：${item.note ?? '（拼不出来 —— B 组与 A 组逐字节相同）'}`)
  console.log(`  画面：${item.node.imagePrompt}`)
  console.log(`  情节：${item.node.scene} · 情绪：${item.node.mood}`)
  console.log(
    `  两组的提示词除了那一行，其余逐字节相同：${new Set([item.promptA, item.promptB]).size === 1 ? '★ 是（这一页没有可回灌的结论）' : '是'}`,
  )

  /**
   * 驾驶席上那一张：**无提示**重画一次，看这一页现在还是不是"不过"。
   *
   * ★ 两个用途，都不是装饰：
   *   ① 它回答"这一页现在还失不失败"——书上的记录是 10-18 的事，而画图会漂；
   *   ② 它给的是一张**固定的图**，用来量**尺子自己**（同一张图连打 3 次）。
   */
  if (PILOT) {
    const pilot = await produce(item.promptA, `p${item.pageNo}-pilot`)
    if (!pilot) {
      console.log('  ⚠ 驾驶席那一张没测成（这一页的读数这一轮都不作数）')
      item.pilot = null
    } else {
      const scores: number[] = [pilot.score]
      for (let round = 2; round <= 3; round += 1) {
        // ★ 用的是**同一份字节**（内存里那一份），不是从盘上读回来的
        const again = await judge(pilot.dataUrl)
        if (again) scores.push(again.score)
      }
      item.pilot = {
        score: pilot.score,
        missed: pilot.missed,
        seconds: pilot.seconds,
        repeat: scores,
      }
      console.log(
        `  驾驶席（无提示）：${pilot.score} · ${pass(pilot.score) ? '通过' : '不通过'}` +
          ` · ${pilot.seconds}s · 点名 ${pilot.missed.join('、') || '无'}`,
      )
      console.log(
        `  ★ 尺子自己（同一张图连打 ${scores.length} 次）：${scores.join(' / ')}` +
          `${new Set(scores).size > 1 ? '（**翻边**：读数的差里有一部分是尺子在抖）' : '（一致）'}`,
      )
    }
  }
  console.log('')
}

type Run = {
  pageNo: number
  arm: 'A' | 'B'
  index: number
  /** `null` = 没测成 */
  result: { score: number; missed: string[] } | null
  seconds?: number
}

const jobs: { pageNo: number; arm: 'A' | 'B'; index: number }[] = []
for (const item of cases) {
  for (let index = 1; index <= N; index += 1) {
    jobs.push({ pageNo: item.pageNo, arm: 'A', index })
    jobs.push({ pageNo: item.pageNo, arm: 'B', index })
  }
}
say(`开始：${jobs.length} 张（${cases.length} 页 × 2 组 × ${N}）\n`)

const runs: Run[] = []
let done = 0
let next = 0
const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
  for (;;) {
    const index = next
    next += 1
    const job = jobs[index]
    if (!job) return
    const item = cases.find((entry) => entry.pageNo === job.pageNo) as Case
    const prompt = job.arm === 'A' ? item.promptA : item.promptB
    const produced = await produce(prompt, `p${job.pageNo}-${job.arm}${job.index}`)
    runs.push({
      pageNo: job.pageNo,
      arm: job.arm,
      index: job.index,
      result: produced ? { score: produced.score, missed: produced.missed } : null,
      ...(produced ? { seconds: produced.seconds } : {}),
    })
    done += 1
    say(
      `[${done}/${jobs.length}] 第 ${job.pageNo} 页 · ${job.arm} 组 #${job.index} → ` +
        (produced
          ? `${produced.score} ${pass(produced.score) ? '✓通过' : '✗没过'} · ${produced.seconds}s`
          : '**没测成**'),
    )
  }
})
await Promise.all(workers)

function pass(score: number): boolean {
  return score >= DEFAULT_THRESHOLD
}

/* ── 汇总 ──────────────────────────────────────────────────────────────────── */

/** Wilson 区间（小样本下比正态近似诚实；n=12 这种量级正态近似会给出越界的上界） */
function wilson(hits: number, total: number): [number, number] {
  if (total === 0) return [0, 0]
  const z = 1.96
  const p = hits / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
  return [
    Math.max(0, (centre - spread) / denominator),
    Math.min(1, (centre + spread) / denominator),
  ]
}

/**
 * 这个 N 下的**最小可检测效应**（MDE）。
 *
 * ★ 它是这一整份读数里最容易被跳过、却最该写出来的一格：没有它，
 *   "两组都在 40% 上下、看不出差别"会被读成"这个改动没用"，
 *   而正确的读法是"**这个规模看不见比 X 个百分点更小的东西**"。
 *   公式是两独立比例检验的常规样本量式反解（α=0.05 双侧、power=80%）。
 */
function mde(n: number, p1: number): number | null {
  if (n === 0) return null
  for (let delta = 0.01; delta <= 1; delta += 0.005) {
    const p2 = Math.min(0.999, p1 + delta)
    const needed = ((1.96 + 0.8416) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (p2 - p1) ** 2
    if (needed <= n) return delta
  }
  return null
}

const measured = (arm: 'A' | 'B', pageNo: number) =>
  runs.filter((run) => run.arm === arm && run.pageNo === pageNo && run.result !== null)

const lines: string[] = []
lines.push(`# 锚点回灌 · A/B 读数（${new Date().toISOString()}）`)
lines.push('')
lines.push(
  `- 书 \`${BOOK}\` · 卡 \`${book.cardId}\` rev ${card.revision} · 图像 \`${image.modelId}\` · 视觉 \`${vision.modelId}\``,
)
lines.push(`- 阈值 \`${DEFAULT_THRESHOLD}\`（产品自己的那个，**没有**为这次跑测重新标定）`)
lines.push(`- 每组每页 ${N} 张 · 并发 ${CONCURRENCY}`)
lines.push('')
lines.push('| 页 | 组 | 提示词 | 测成 | 通过 | 通过率（Wilson 95%） | 分数 |')
lines.push('|---|---|---|---|---|---|---|')

for (const item of cases) {
  for (const arm of ['A', 'B'] as const) {
    const list = measured(arm, item.pageNo)
    const hits = list.filter((run) => pass(run.result!.score)).length
    const [lo, hi] = wilson(hits, list.length)
    const scores = list.map((run) => run.result!.score)
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    lines.push(
      `| ${item.pageNo} | ${arm}${arm === 'A' ? '（空对照）' : ''} | ${
        arm === 'A' ? '今天的提示词' : `+「${item.note ?? '（拼不出来）'}」`
      } | ${list.length} | ${hits} | ${
        list.length
          ? `${((hits / list.length) * 100).toFixed(0)}%（${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%）`
          : '——'
      } | ${scores.length ? `均 ${mean.toFixed(2)} · ${scores.map((s) => s.toFixed(1)).join('/')}` : '——'} |`,
    )
  }
  const a = measured('A', item.pageNo)
  const b = measured('B', item.pageNo)
  const aHits = a.filter((run) => pass(run.result!.score)).length
  const bHits = b.filter((run) => pass(run.result!.score)).length
  const detect = mde(Math.min(a.length, b.length), a.length ? aHits / a.length : 0.2)
  lines.push(
    `| ${item.pageNo} | **差** | B − A | — | — | ${
      a.length && b.length
        ? `${((bHits / b.length - aHits / a.length) * 100).toFixed(0)} pp · 这个 N 下能看见的最小差 ≈ ${detect === null ? '——' : `${(detect * 100).toFixed(0)} pp`}`
        : '——'
    } | — |`,
  )
}

// 贴题的那一格：上一次点名的那几条，这一次还被点名了吗
lines.push('')
lines.push('## 上一次点名的那几条，这一次还被点名了吗')
lines.push('')
lines.push('| 页 | 点名 | 组 | 还错着的张数 / 测成 |')
lines.push('|---|---|---|---|')
for (const item of cases) {
  const targets = labelsOf(item.missed)
  for (const arm of ['A', 'B'] as const) {
    const list = measured(arm, item.pageNo)
    const still = list.filter((run) =>
      labelsOf(run.result!.missed).some((label) => targets.includes(label)),
    ).length
    lines.push(
      `| ${item.pageNo} | ${targets.join('、') || '（没有）'} | ${arm} | ${still} / ${list.length} |`,
    )
  }
}

const unmeasured = runs.filter((run) => run.result === null).length
lines.push('')
lines.push('## 没测成')
lines.push('')
lines.push(`- 出图/比对没跑成的格子：**${unmeasured} / ${runs.length}**`)
for (const item of cases) {
  if (item.pilot === undefined) continue
  lines.push(
    `- 第 ${item.pageNo} 页驾驶席（无提示）：${item.pilot === null ? '没测成' : `${item.pilot.score} · ${item.pilot.seconds}s · 点名 ${item.pilot.missed.join('、') || '无'}`}`,
  )
  if (item.pilot) {
    lines.push(
      `  - 尺子自己（同一张图连打 ${item.pilot.repeat.length} 次）：${item.pilot.repeat.join(' / ')}`,
    )
  }
}
lines.push('')
lines.push('## 两组的提示词')
lines.push('')
for (const item of cases) {
  lines.push(`### 第 ${item.pageNo} 页 · A 组（今天的行为）`)
  lines.push('')
  lines.push('```')
  lines.push(item.promptA)
  lines.push('```')
  if (item.note) {
    lines.push('')
    lines.push(`### 第 ${item.pageNo} 页 · B 组（多出来的就是这一行）`)
    lines.push('')
    lines.push('```')
    lines.push(item.promptB)
    lines.push('```')
  }
}

await writeFile(join(OUT, 'report.md'), lines.join('\n'), 'utf8')
await writeFile(
  join(OUT, 'raw.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      book: BOOK,
      cardId: book.cardId,
      threshold: DEFAULT_THRESHOLD,
      n: N,
      cases: cases.map((item) => ({
        pageNo: item.pageNo,
        missed: item.missed,
        note: item.note,
        pilot: item.pilot ?? null,
      })),
      runs,
    },
    null,
    2,
  ),
  'utf8',
)

/** 屏幕上只打「每一页 × 每一组」那张表（提示词全文在报告里，屏幕上打不下） */
const head = lines.slice(0, lines.indexOf('## 上一次点名的那几条，这一次还被点名了吗'))
console.log(`\n${head.join('\n')}`)
console.log(`\n报告：${join(OUT, 'report.md')} · 原始读数：${join(OUT, 'raw.json')}`)

/**
 * ★ 判词只在**一格都没落下**时才给：有任何一张没测成，末行就一句结论都不下。
 *   与 `picture-review-cases.mts` 同一条口径（量法纪律第四条）。
 */
if (unmeasured > 0) {
  console.log(
    `\n★ 有 ${unmeasured} 格没测成：这一轮**不下结论**——把 --concurrency 调小、隔一会儿重跑`,
  )
  process.exit(1)
}
console.log(
  '\n★ 读法：看**区间交不交叠**，不要看那两个百分数谁大。交叠就别下结论（那正是 MDE 的用处）。',
)
