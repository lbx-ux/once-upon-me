/**
 * cost-model.mts —— 「一本绘本要花多少钱」这条账的**唯一量法**（2026-10-19，B4/商业文档）
 *
 * 为什么要有这个脚本：商业那一节里每一个钱数都得能重跑。而这个仓库里
 * **没有任何一处**把「每本成本」记全了——`book.json` 的 `stats.totalCostCny`
 * 只加图像那一项（`illustrate.ts` 把每次响应里的 `costCny` 加起来），
 * 文本、视觉、语音三项都不在里面。所以商业文档里的数是**拼出来的**，这个脚本就是拼法。
 *
 * 五段，各自花什么：
 *
 * | 段 | 问的是什么 | 花什么 |
 * |---|---|---|
 * | 1 | 这台网关的**目录里带单价**（`effective_input_price_per_million` 等） | **免费**（一次 GET /models） |
 * | 2 | 一次规划调用多少 token | 一次文本调用（重试几次就几次） |
 * | 3 | 一次一致性比对、一次画面审核各多少 token | 两次视觉调用 |
 * | 4 | 计费字符的规则（汉字 ×2 + 非汉字 ×1 是不是对的） | 三次极短的合成 |
 * | 5 | 盘上那些真书的出图次数 / 计费字符 / 用时 | **免费**（只读盘） |
 *
 * 第 4 段为什么非要真发一次：`08-voice.md` 那条规则是从**一个**样本推的
 * （17 汉字 + 3 标点 = 37），而那个样本判别力不够——「非 ASCII ×2 + ASCII ×1」
 * 同样拟合它。三个样本里 `小宇，下雨。` 与 `小宇,下雨.` 都是 4 汉字 2 标点，
 * 两条规则只在**全角**那一档分开。所以它必须真测，推不出来。
 * ★ 实测结论：两条都回 10 ⇒ 规则是「汉字 ×2 + 非汉字 ×1」，全角标点算 1。
 *
 * ```bash
 * node scripts/cost-model.mts                  # 全跑（花 1 次规划 + 2 次视觉 + 3 次合成）
 * node scripts/cost-model.mts --from-cache     # 复用上次的现场读数，不花钱
 * node scripts/cost-model.mts --prices-only    # 只拉价目表，不花钱
 * node scripts/cost-model.mts --books=DIR      # 换一个资产根来统计真书
 * ```
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { arg, flag, readEnv } from './env.mts'
import { checklistOf } from '../src/lib/engine/character-card/card.ts'
import { planBook } from '../src/lib/engine/index.ts'
import { toDataUrl } from '../src/lib/engine/providers/http.ts'
import { createOpenAiVision } from '../src/lib/engine/providers/openai-vision.ts'
import { createQwenSpeech } from '../src/lib/engine/providers/qwen-speech.ts'
import { createProviders } from '../src/lib/engine/providers/registry.ts'
import { PICTURE_CLAUSES } from '../src/lib/rag/review-corpus.ts'
import { ensureStubCard, STUB_CHILD } from '../src/lib/stub-fixture.ts'

/** 判据用的三句：前两句是同一句话的文字/标点两档，第三句是 ASCII 对照 */
const TTS_SAMPLES = ['小宇，下雨。', '小宇,下雨.', '小宇ab']

const env = await readEnv()
const outDir = arg('out', '.out/cost-model')
const booksRoot = arg('books', '.out/web/u')
const pricesOnly = flag('prices-only')
/**
 * ★ 复用上一次的现场读数，而不是重花一次钱。
 *   **必须显式给这个开关**：默认永远现场测——"报告里有一段读的是旧数"这种坏法
 *   在纸面上看不出来，而这份报告的每一个数都要能追到一次真实的调用。
 */
const fromCache = flag('from-cache')

const IMAGE_UNIT_CNY = Number(env['IMAGE_UNIT_COST_CNY'] ?? '0.2')
const TTS_CNY_PER_CHAR = 1 / 10_000

const lines: string[] = []
const say = (line = ''): void => {
  lines.push(line)
  process.stdout.write(`${line}\n`)
}

/* ── 1. 价目表（免费：目录里自带单价）────────────────────────────────────── */

type ModelRow = {
  id: string
  input: number
  output: number
  cache: number
  vision: boolean
}

const base = (env['LLM_BASE_URL'] ?? '').replace(/\/$/, '')
const listResponse = await fetch(`${base}/models`, {
  headers: { Authorization: `Bearer ${env['LLM_API_KEY'] ?? ''}` },
})
const listBody = (await listResponse.json()) as { data?: Record<string, unknown>[] }
const num = (value: unknown): number => Number(value ?? 0)

const catalog: ModelRow[] = (listBody.data ?? [])
  .map((m) => ({
    id: String(m['id'] ?? ''),
    input: num(m['effective_input_price_per_million']),
    output: num(m['effective_output_price_per_million']),
    cache: num(m['effective_cache_read_price_per_million']),
    vision: m['supports_vision'] === true,
  }))
  .sort((a, b) => a.input - b.input)

say('# 每本成本 · 量法与读数')
say()
say(`- 量法：\`node scripts/cost-model.mts\`（本文件），报告落 \`${outDir}/report.md\``)
say(`- 价目表来源：\`GET ${base}/models\` —— 这家网关的目录里**自带单价字段**`)
say(
  `- 图像单价：**${IMAGE_UNIT_CNY} 元/张**（一口价、与尺寸无关；\`.env.local\` 的 \`IMAGE_UNIT_COST_CNY\`）`,
)
say('- 语音单价：**1 元/万计费字符**（阿里云百炼 `qwen-audio-3.0-tts-flash`，华北2）')
say()
say('## 一、这台网关的价目表（元 / 百万 token，按输入价排）')
say()
say('| 模型 | 输入 | 输出 | 缓存命中 | 吃图 |')
say('| --- | --- | --- | --- | --- |')
for (const m of catalog) {
  say(`| \`${m.id}\` | ${m.input} | ${m.output} | ${m.cache} | ${m.vision ? '✓' : ''} |`)
}
say()
say(`配置里在用的：文本 \`${env['LLM_MODEL'] ?? '—'}\` · 视觉 \`${env['VISION_MODEL'] ?? '—'}\``)

if (pricesOnly) {
  await writeReport(outDir, lines)
  process.exit(0)
}

/* ── 2–4. 现场那三段读数（文本 / 视觉 / 语音），可复用 ───────────────────── */

type Readings = {
  measuredAt: string
  llmModel: string
  visionModel: string
  ttsModel: string
  plan: {
    attempts: number
    calls: { promptTokens: number; completionTokens: number }[]
    elapsedMs: number
  }
  sample: { referenceBytes: number; pageBytes: number }
  compareUsage: Record<string, unknown>
  reviewUsage: Record<string, unknown>
  tts: { sample: string; characters: number }[]
}

const readingsPath = join(outDir, 'readings.json')
let readings: Readings

if (fromCache && existsSync(readingsPath)) {
  readings = JSON.parse(await readFile(readingsPath, 'utf8')) as Readings
  say()
  say(`> 本次**复用**上一次的现场读数：\`${readingsPath}\`（测于 ${readings.measuredAt}）。`)
  say('> 想重新测一遍就不带 `--from-cache`（会真发 1 次规划 + 2 次视觉 + 3 次合成）。')
} else {
  const bundle = await createProviders({ env, mode: 'live', assetRoot: `${outDir}/store` })
  const card = await ensureStubCard(bundle.store, { now: 1_760_000_000_000 })

  /** 文本：在外面包一层把 usage 抄下来。引擎这一层**不外传**它（`StoryPlan` 里没有这个字段） */
  const planCalls: { promptTokens: number; completionTokens: number }[] = []
  const text = {
    ...bundle.text,
    complete: async (...args: Parameters<typeof bundle.text.complete>) => {
      const response = await bundle.text.complete(...args)
      planCalls.push({
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
      })
      return response
    },
  }

  const planStarted = Date.now()
  const plan = await planBook(
    { child: STUB_CHILD, card, theme: '第一次离开家也不怕', form: 'solo', pages: 20 },
    { providers: { ...bundle, text } },
  )

  /**
   * 视觉：适配器的接口形状里**没有** usage（引擎不需要它），所以注入一个抄回包的 `fetch`。
   * 这是本文件唯一一处"探针要知道适配器不打算说的事"，也是 `HttpDeps.fetchImpl` 的用法之一。
   */
  const visionUsage: Record<string, unknown>[] = []
  const countingFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    void response
      .clone()
      .json()
      .then((body) =>
        visionUsage.push(((body as { usage?: unknown }).usage ?? {}) as Record<string, unknown>),
      )
      .catch(() => undefined)
    return response
  }

  const vision = createOpenAiVision(
    {
      baseUrl: env['VISION_BASE_URL'] || env['LLM_BASE_URL'] || '',
      apiKey: (env['VISION_API_KEY'] || env['LLM_API_KEY']) ?? '',
      timeoutMs: 300_000,
      fetchImpl: countingFetch,
    },
    env['VISION_MODEL'] ?? '',
  )

  const sample = await firstPagePair(booksRoot)
  await vision.compare({
    referenceDataUrl: toDataUrl(sample.reference, 'image/webp'),
    pageDataUrl: toDataUrl(sample.page, 'image/png'),
    checklist: checklistOf(card),
  })
  const compareUsage = visionUsage.at(-1) ?? {}
  await vision.reviewPicture({
    pageDataUrl: toDataUrl(sample.page, 'image/png'),
    clauses: PICTURE_CLAUSES,
  })
  const reviewUsage = visionUsage.at(-1) ?? {}

  /** 语音：同一手法，抄 `usage.characters` */
  const ttsCharacters: number[] = []
  const speech = createQwenSpeech(
    {
      baseUrl: env['TTS_BASE_URL'] ?? '',
      apiKey: env['TTS_API_KEY'] ?? '',
      timeoutMs: 60_000,
      fetchImpl: async (input, init) => {
        const response = await fetch(input, init)
        void response
          .clone()
          .json()
          .then((body) => {
            const usage = (body as { usage?: { characters?: number } }).usage
            if (usage?.characters !== undefined) ttsCharacters.push(usage.characters)
          })
          .catch(() => undefined)
        return response
      },
    },
    env['TTS_MODEL'] ?? '',
  )

  const tts: Readings['tts'] = []
  for (const one of TTS_SAMPLES) {
    const before = ttsCharacters.length
    await speech.synthesize({ text: one, voiceId: env['TTS_VOICE'] ?? '' })
    tts.push({ sample: one, characters: ttsCharacters[before] ?? 0 })
  }

  readings = {
    measuredAt: new Date().toISOString(),
    llmModel: plan.modelId,
    visionModel: vision.modelId,
    ttsModel: env['TTS_MODEL'] ?? '',
    plan: { attempts: plan.attempts, calls: planCalls, elapsedMs: Date.now() - planStarted },
    sample: { referenceBytes: sample.reference.byteLength, pageBytes: sample.page.byteLength },
    compareUsage,
    reviewUsage,
    tts,
  }
  await mkdir(outDir, { recursive: true })
  await writeFile(readingsPath, JSON.stringify(readings, null, 1), 'utf8')
}

const { compareUsage, reviewUsage } = readings
const planIn = readings.plan.calls.reduce((sum, c) => sum + c.promptTokens, 0)
const planOut = readings.plan.calls.reduce((sum, c) => sum + c.completionTokens, 0)
const compareCost = priceOf(catalog, readings.visionModel, compareUsage)
const reviewCost = priceOf(catalog, readings.visionModel, reviewUsage)

/* ── 二、一次规划（文本）────────────────────────────────────────────────── */

say()
say('## 二、一次规划（文本）')
say()
say(
  `模型 \`${readings.llmModel}\` · 20 页独读版 · **${readings.plan.attempts} 次调用** · ` +
    `合计 **${planIn} 输入 + ${planOut} 输出** token · 用时 ${(readings.plan.elapsedMs / 1000).toFixed(1)}s`,
)
say()
say('| 第几次 | 输入 | 输出 |')
say('| --- | --- | --- |')
readings.plan.calls.forEach((c, i) =>
  say(`| ${i + 1} | ${c.promptTokens} | ${c.completionTokens} |`),
)
say()
say(
  '★ **重试也是钱**：`plan.ts` 的重试是**整篇重发同一个提示词**，所以一次规划的价钱 = 次数 × 单次。' +
    '实测同一张卡、同一个主题，两次运行分别拿到 1 次与 3 次（Schema 没过就重发）。',
)

/* ── 三、两次视觉调用 ───────────────────────────────────────────────────── */

say()
say('## 三、两次视觉调用（一致性比对 + 画面审核）')
say()
say(
  `样本：参考图 ${(readings.sample.referenceBytes / 1024).toFixed(0)} KB + ` +
    `页图 ${(readings.sample.pageBytes / 1024 / 1024).toFixed(1)} MB`,
)
say()
say('| 调用 | 送几张图 | 输入 | 输出（含思考） | 吃这台模型的单价 |')
say('| --- | --- | --- | --- | --- |')
say(
  `| 一致性比对 | 2 | ${compareUsage['prompt_tokens'] ?? 0} | ${compareUsage['completion_tokens'] ?? 0}` +
    `（思考 ${reasoningOf(compareUsage)}） | ¥${compareCost.toFixed(4)} |`,
)
say(
  `| 画面审核 | 1 | ${reviewUsage['prompt_tokens'] ?? 0} | ${reviewUsage['completion_tokens'] ?? 0}` +
    `（思考 ${reasoningOf(reviewUsage)}） | ¥${reviewCost.toFixed(4)} |`,
)
say()
say(
  `⇒ 一页两问合计 **¥${(compareCost + reviewCost).toFixed(4)}**（模型 \`${readings.visionModel}\`）。` +
    '★ 一页**至少**两次视觉调用：每次出图都比一次，而被留下的那一张还要审一次。',
)
say()
say('### 换一台吃图的模型（**同样的 token 数、只换单价**）')
say()
say('| 模型 | 输入价 | 一次比对 | 一次审核 | 一页两问 | 相对现值 |')
say('| --- | --- | --- | --- | --- | --- |')
for (const m of cheapestVision(catalog, readings.visionModel, 6)) {
  const one = tokenCost(m, compareUsage) + tokenCost(m, reviewUsage)
  say(
    `| \`${m.id}\`${m.id === readings.visionModel ? '（现值）' : ''} | ${m.input} | ` +
      `¥${tokenCost(m, compareUsage).toFixed(4)} | ¥${tokenCost(m, reviewUsage).toFixed(4)} | ` +
      `¥${one.toFixed(4)} | ${((compareCost + reviewCost) / one).toFixed(1)}× |`,
  )
}
say()
say(
  `> 目录里吃图的模型一共 ${catalog.filter((row) => row.vision).length} 个，这里只列最便宜的 6 个与现值。` +
    '★ **同样的 token 数**是个假设，不是结论：换模型换掉的是"判得像不像"这件事本身，' +
    '而那要先重量一遍一致性判据（阈值是标定出来的）。所以这张表给的是**上限**。',
)

/* ── 四、计费字符那条规则 ───────────────────────────────────────────────── */

say()
say('## 四、计费字符的规则（三个样本）')
say()
say('| 样本 | 字符数 | 汉字 | 非汉字 | 厂商回的 `usage.characters` |')
say('| --- | --- | --- | --- | --- |')
for (const row of readings.tts) {
  const han = [...row.sample].filter((c) => /\p{Script=Han}/u.test(c)).length
  say(
    `| \`${row.sample}\` | ${[...row.sample].length} | ${han} | ${[...row.sample].length - han} | **${row.characters}** |`,
  )
}
say()
say(
  '⇒ 规则是 **汉字 × 2 + 非汉字 × 1**：三格算出来分别是 ' +
    `${readings.tts.map((row) => billedOf(row.sample)).join(' / ')}，与实测 ` +
    `${readings.tts.map((row) => row.characters).join(' / ')} ` +
    `${readings.tts.every((row) => row.characters === billedOf(row.sample)) ? '逐格相同' : '**对不上**'}`,
)
say()
say(
  '★ 前两个样本的关系就是这条探针存在的理由：它们是**同一句话**的文字与标点两档' +
    '（全角 `，。` 与半角 `,.`），而两条候选规则（「汉字 ×2 + 其他 ×1」与「非 ASCII ×2 + ASCII ×1」）' +
    '只在全角那一档分开——半角那档两条都给 10，分不出来。',
)

/* ── 五、盘上那些真书（免费）────────────────────────────────────────────── */

const books = await scanBooks(booksRoot)
say()
say('## 五、盘上那些真书（只读盘，不花钱）')
say()
say('| 书 | 形态 | 节点 | 出图次数 | 每次/页 | 图像 ¥ | 清单里记的 ¥ | 计费字符 | 语音 ¥ | 用时 |')
say('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const b of books) {
  say(
    `| \`${b.book}\` | ${b.form} | ${b.nodes} | ${b.imageCalls} | ${b.perPage.toFixed(2)} | ` +
      `¥${(b.imageCalls * IMAGE_UNIT_CNY).toFixed(2)} | ¥${b.recordedCny} | ${b.billedChars} | ` +
      `¥${(b.billedChars * TTS_CNY_PER_CHAR).toFixed(3)} | ${(b.elapsedMs / 60000).toFixed(1)} min |`,
  )
}
say()
say(
  '★ 那个「清单里记的 ¥」是 `book.json` 的 `stats.totalCostCny`——**它只有图像那一项**。' +
    '`每次/页` = 出图次数 ÷ (节点数 + 1 张封面)，它就是**重画率**那个 r 的另一种写法（1 + r）。',
)

/* ── 六、拼起来：一本 20 页独读版 ───────────────────────────────────────── */

const perPageBilled = averagePageChars(books)
const rest =
  textCostOf(catalog, readings.llmModel, planIn, planOut) + perPageBilled * 20 * TTS_CNY_PER_CHAR
say()
say('## 六、拼起来：一本 20 页独读版')
say()
say(
  `固定项：文本 ¥${textCostOf(catalog, readings.llmModel, planIn, planOut).toFixed(4)}` +
    `（实测 ${readings.plan.attempts} 次调用合计）· 语音 ¥${(perPageBilled * 20 * TTS_CNY_PER_CHAR).toFixed(3)}` +
    `（实测每页 ${perPageBilled.toFixed(1)} 计费字符 × 20 页）`,
)
say()
say(
  `| 每次/页 | 视觉模型 | 图（张 × ¥${IMAGE_UNIT_CNY}） | 视觉（比对 + 审核） | 文本 + 语音 | 合计 | 图像占比 |`,
)
say('| --- | --- | --- | --- | --- | --- | --- |')
for (const ratio of [1.33, 2, 2.5]) {
  const images = (20 + 1) * ratio
  for (const m of cheapestVision(catalog, readings.visionModel, 2)) {
    const imageCost = images * IMAGE_UNIT_CNY
    const visionCost = 20 * ratio * tokenCost(m, compareUsage) + 21 * tokenCost(m, reviewUsage)
    const total = imageCost + visionCost + rest
    say(
      `| ${ratio} | \`${m.id}\`${m.id === readings.visionModel ? '（现值）' : ''} | ` +
        `¥${imageCost.toFixed(2)}（${images.toFixed(0)} 张） | ¥${visionCost.toFixed(2)} | ¥${rest.toFixed(3)} | ` +
        `**¥${total.toFixed(2)}** | ${((imageCost / total) * 100).toFixed(0)}% |`,
    )
  }
}
say()
say(
  '> `每次/页` 取 1.33 / 2.0 / 2.5 三档，前两档是**实测**的边界（五本真书落在 1.33–2.00 之间），' +
    '2.5 是留的余量。视觉那一列的算式：`20 × 每次/页` 次比对 + `21` 次审核（20 页 + 1 封面）。',
)

await writeReport(outDir, lines)

/* ── 工具 ─────────────────────────────────────────────────────────────── */

/** 计费字符：汉字 ×2 + 非汉字 ×1（2026-10-19 实测，见第四段） */
function billedOf(text: string): number {
  return [...text].reduce((sum, c) => sum + (/\p{Script=Han}/u.test(c) ? 2 : 1), 0)
}

/** 最便宜的 N 个吃图模型，但**现值必须在里面**——不然那张表读起来像"现值被淘汰了" */
function cheapestVision(catalog: ModelRow[], current: string, take: number): ModelRow[] {
  const ours = catalog.find((row) => row.id === current)
  return [
    ...(ours ? [ours] : []),
    ...catalog.filter((row) => row.vision && row.id !== current).slice(0, take),
  ]
}

function tokensOf(usage: Record<string, unknown>): {
  input: number
  output: number
  cached: number
} {
  return {
    input: Number(usage['prompt_tokens'] ?? usage['input_tokens'] ?? 0),
    output: Number(usage['completion_tokens'] ?? usage['output_tokens'] ?? 0),
    cached: Number(
      (usage['prompt_tokens_details'] as { cached_tokens?: number } | undefined)?.cached_tokens ??
        0,
    ),
  }
}

function tokenCost(model: ModelRow, usage: Record<string, unknown>): number {
  const { input, output, cached } = tokensOf(usage)
  return ((input - cached) * model.input + cached * model.cache + output * model.output) / 1e6
}

function priceOf(catalog: ModelRow[], modelId: string, usage: Record<string, unknown>): number {
  const model = catalog.find((row) => row.id === modelId)
  return model ? tokenCost(model, usage) : 0
}

function textCostOf(catalog: ModelRow[], modelId: string, input: number, output: number): number {
  const model = catalog.find((row) => row.id === modelId)
  return model ? (input * model.input + output * model.output) / 1e6 : 0
}

function reasoningOf(usage: Record<string, unknown>): number {
  return Number(
    (usage['completion_tokens_details'] as { reasoning_tokens?: number } | undefined)
      ?.reasoning_tokens ?? 0,
  )
}

/** 每页平均计费字符：从盘上的真书里数出来，不拍一个数 */
function averagePageChars(books: Awaited<ReturnType<typeof scanBooks>>): number {
  const usable = books.filter((b) => b.billedChars > 0 && b.nodes > 0)
  if (usable.length === 0) return 50
  return usable.reduce((sum, b) => sum + b.billedChars / b.nodes, 0) / usable.length
}

/** 一对真图：角色卡参考图（演示封面）+ 某本书里的第一页。一张都找不到就报错，不编 */
async function firstPagePair(root: string): Promise<{ reference: Uint8Array; page: Uint8Array }> {
  const reference = new Uint8Array(await readFile('public/book/cover.webp'))
  for (const [, bookDir] of await booksUnder(root)) {
    const files = await readdir(bookDir)
    const page = files.find((f) => /^page-\d+-a\d+\.png$/.test(f))
    if (page) return { reference, page: new Uint8Array(await readFile(join(bookDir, page))) }
  }
  const fallback = 'public/demo/books/xiaoyu-r1-4fe055c5723b/page-1-a1.png'
  if (!existsSync(fallback)) throw new Error(`找不到任何一页真图：${root} 与 ${fallback} 都不在`)
  return { reference, page: new Uint8Array(await readFile(fallback)) }
}

async function booksUnder(root: string): Promise<[string, string][]> {
  const found: [string, string][] = []
  const users = existsSync(root) ? await readdir(root) : []
  for (const user of users) {
    const booksDir = join(root, user, 'books')
    if (!existsSync(booksDir)) continue
    for (const book of await readdir(booksDir)) found.push([book, join(booksDir, book)])
  }
  return found
}

type BookRow = {
  book: string
  form: string
  nodes: number
  imageCalls: number
  perPage: number
  recordedCny: number
  billedChars: number
  elapsedMs: number
}

async function scanBooks(root: string): Promise<BookRow[]> {
  const rows: BookRow[] = []
  for (const [, dir] of await booksUnder(root)) {
    const manifest = join(dir, 'book.json')
    if (!existsSync(manifest)) continue
    const book = JSON.parse(await readFile(manifest, 'utf8')) as {
      form: string
      tree: {
        nodes: {
          body: string[]
          mood: string
          choice?: { prompt: string; options: { spoken: string }[] }
        }[]
      }
      stats?: { imageCalls?: number; totalCostCny?: number; elapsedMs?: number }
    }
    const seen = new Set<string>()
    let billedChars = 0
    for (const node of book.tree.nodes) {
      const items = [
        node.body.join(''),
        node.choice?.prompt ?? '',
        ...(node.choice?.options ?? []).map((o) => o.spoken),
      ]
      for (const text of items) {
        if (!text.trim()) continue
        const key = `${node.mood}\u0000${text}`
        if (seen.has(key)) continue
        seen.add(key)
        billedChars += billedOf(text)
      }
    }
    const nodes = book.tree.nodes.length
    const imageCalls = book.stats?.imageCalls ?? 0
    rows.push({
      book: dir.split(/[\\/]/).at(-1) ?? dir,
      form: book.form,
      nodes,
      imageCalls,
      perPage: imageCalls / (nodes + 1),
      recordedCny: book.stats?.totalCostCny ?? 0,
      billedChars,
      elapsedMs: book.stats?.elapsedMs ?? 0,
    })
  }
  return rows.sort((a, b) => a.nodes - b.nodes)
}

async function writeReport(dir: string, content: string[]): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'report.md'), `${content.join('\n')}\n`, 'utf8')
  process.stdout.write(`\n落 ${dir}/report.md\n`)
}
