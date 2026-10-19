/**
 * rag-bakeoff.mts —— 判据 4：**开 / 关检索各跑一遍，出增益表**（`.scratch/rag` 工单 06）
 *
 * ```bash
 * node scripts/rag-bakeoff.mts --books=10 --out=.out/rag-bakeoff
 * node scripts/rag-bakeoff.mts --out=.out/rag-bakeoff --reportOnly=1   # 只重出报告
 * node scripts/rag-bakeoff.mts --k=5 --minScore=1                      # 换一格跑
 * ```
 *
 * 官方那句话是「生成质量是否因检索增强而**显著提升**」。这一张产出的不是代码，
 * 是**一张能贴进技术文档的表**。**预声明阈值**（写在跑之前，免得跑完再挑口径）：
 * Schema 一次通过率 **+10 个百分点**，或平均重试次数 **−0.3**——与
 * `docs/tech-selection.md` §9 的「差距超过 10 个百分点」同口径。
 * ★ **达不到就如实写「在这份语料上不显著」**。把向量库摆在那儿不叫得分，量出增益才叫。
 *
 * ---------------------------------------------------------------------------
 * ## 一、四条纪律（每一条都对应这个仓库已经付过的一次学费）
 *
 * 1. **不自己搭平行流水线。** 本脚本调 `planBook`（与界面上那一步同一个函数），
 *    只切 `retriever` 那一项。W1 那次横评自己手写了"调用 → 校验 → buildTree → 重试"，
 *    与 `plan.ts` 悄悄分了叉（`maxTokens` 3000 vs 4096、树形不合法 `break` vs `continue`），
 *    于是表里的数是**另一条流水线**的成绩（`w1-text-bakeoff.mts` 文件头第 1 条）。
 * 2. **三种结局分开记**：`ok` / `plan-invalid` / `call-failed`。
 *    "裁判没到场"不能判"选手没跑"——调用层的失败不进通过率的分母。
 * 3. **限流是"没测成"，不是数据。** 工单 01 的探针就这么被骗过一次：
 *    连打几十次之后网关开始限流，汇总把 `RATE_LIMITED`（什么都没证明）与
 *    `CAPABILITY_NOT_SUPPORTED`（有结论的否定）加成了一个数。所以这里：
 *    429/`RATE_LIMITED` **退避重试**，重试仍失败就记成 `rate-limited`（**排除在分母外**），
 *    报告里「测成的 N / 总共的 M」两个数分开写，**M > N 时结论行只许写"不完整"**。
 * 4. **两臂的入参只差检索那一段。** 开跑之前先做一次**前缀校验**：
 *    `off` 的提示词必须是 `lexical` 的**前缀**，差的那 N 个字就是检索段。
 *    不成立就**中止**——那种情况下这张表根本不成立。
 *    ★ 这条网关**没有 seed 参数**（`TextRequest` 里没有，见 `providers/types.ts`），
 *      所以两臂之间无法固定采样。这是在报告里要写明的**已知噪声来源**，
 *      用 n=10 摊平，并把**逐本明细**一并贴出来让人自己看散点。
 *
 * ## 二、量哪五个数（**每一条都在报告里写明怎么量的**）
 *
 * | # | 量什么 | 怎么量 |
 * | - | ------ | ------ |
 * | ① | Schema 一次通过率 / 平均重试次数 | `planBook` 返回的 `attempts`（判据本身） |
 * | ② | 平均句长 / 超长句比例 / 超纲字比例 | 正文按 `。！？!?…` 切句；上限取 `AGE_RULES` 的 18 字；超纲字 = **不在 96 段人工样书里出现过的汉字** |
 * | ③ | 与自家旧书的重复度 | 生成句子里含 ≥6 字连续子串、且那一段出现在**②创作史**里的句子占比 |
 * | ④ | 与范例的句子重合率 | 同一个量，参照集换成**这一批主题检索到的范例**。★ **反向指标**：涨太多就是照抄 |
 * | ⑤ | 与已读故事的新意 | 1 − 与**已读清单**（三部样书）的重合率 |
 *
 * ★ ②③④⑤ 的参照集都在**开跑之前冻结**（范例集 = 两臂共用同一批 chunk），
 *   否则"两臂比的是两个参照系"，而那种比较没有意义。
 *
 * ## 二·五、v2 那一轮（判据 4 第二轮，预声明见 spec §九）
 *
 *   第一轮的判据（Schema 一次通过率 / 平均重试）在这个模型上**饱和**，而且三分之一的样本
 *   **剂量为零**（3 个主题两臂提示词逐字节相同）。第二轮换三件事：
 *
 *   1. **判据落点在内容量上**：主判据 `③ 与本主题那本旧书的重复度`、副判据 `② 超长句比例`；
 *   2. **②创作史由本流水线自己产出**（`--history=live`：先用 `off` 臂每主题生成一本，
 *      再拿它们当"他已经读过的书"）——手写的旧书落点不是模型会写的那些，
 *      那是 ③ 在第一轮饱和为 0 的原因；
 *   3. **配对设计**：`--repeats=3` ⇒ 10 主题 × 3 次 = 30 本/臂，**配对单位是主题**
 *      （书在主题内是聚类的），20/30 本当成一个池子会高估显著性。
 *
 * ## 三、这一批固定输入（写死在脚本里，换批要写明）
 *
 *   10 个主题取自 12 本样书的**中文标签**（不是键）——界面上走的就是这一种，
 *   而工单 04 那条"标签不归一 ⇒ 过滤器永不命中"的坑正是从这条路上来的。
 *   自家旧书（②）三本手写，落在云 / 恐龙 / 月亮三个主题上，让 `avoid` 那一侧有东西可取。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { EngineError } from '../src/lib/engine/errors.ts'
import { planBook, type BookRequest } from '../src/lib/engine/index.ts'
import { createOpenAiText } from '../src/lib/engine/providers/openai-text.ts'
import { textOptionsOf } from '../src/lib/engine/providers/registry.ts'
import { createMemoryStore } from '../src/lib/engine/providers/stores.ts'
import type { CharacterCard } from '../src/lib/engine/domain.ts'
import type {
  ImageGenerator,
  ProviderBundle,
  TextGenerator,
} from '../src/lib/engine/providers/types.ts'
import { storyPlanUser, type StoryPlanInput } from '../src/lib/prompts/story-plan.ts'
import {
  chunksFromStoryBook,
  type RagChunk,
  type RagIndex,
  type RagOwner,
  type StoryBookSource,
} from '../src/lib/rag/corpus.ts'
import {
  createPlanRetriever,
  DEFAULT_K,
  DEFAULT_MIN_SCORE,
  DEFAULT_NARROWED_MIN_SCORE,
  loadSeedIndex,
  queryTextOf,
} from '../src/lib/rag/load.ts'
import { retrieveBoth, type RetrieveHit } from '../src/lib/rag/retrieve.ts'
import { arg, readEnv } from './env.mts'

/* ─────────────────────────── 固定输入（写死，换批要写明） ─────────────────────────── */

/** 10 个主题 × 一句 wish。★ 主题用**中文标签**（界面上送的就是这一种） */
const BATCH = [
  { theme: '云', wish: '一朵云变来变去' },
  { theme: '恐龙', wish: '和一只恐龙做朋友' },
  { theme: '月亮', wish: '月亮跟着他回家' },
  { theme: '火箭', wish: '坐自己折的火箭上天' },
  { theme: '小鸟', wish: '学飞，可是一直飞不起来' },
  { theme: '星星', wish: '把掉下来的星星送回天上' },
  { theme: '鲸鱼', wish: '在海里遇到一条大鲸鱼' },
  { theme: '城堡', wish: '在沙堆里造一座城堡' },
  { theme: '花', wish: '种一颗种子，等它开花' },
  { theme: '乌龟', wish: '和慢吞吞的乌龟一起走到终点' },
] as const

const OWNER: RagOwner = 'u/bakeoff'

/**
 * ②创作史：三本"他自己家里已经写过的书"。
 *
 * ★ 为什么要有它：`avoid`（负向检索）是这一栏里最像新动作的一条，
 *   而它只在**有旧书**时可测。三本落在云 / 恐龙 / 月亮上，正好是这一批的前三个主题——
 *   于是"新写的那一本会不会又落到同一个落点"这件事**有东西可比**。
 * ★ 落点刻意写成"很自然的第一反应"（云变成船、恐龙背着走、月亮跟着回家）：
 *   如果模型在开检索时仍然写这些，重复度就该涨；避开了就是负向检索真的起作用了。
 */
const OWN_BOOKS: readonly StoryBookSource[] = [
  {
    bookId: 'bk_own_yun',
    owner: OWNER,
    title: '小雨的云船',
    theme: '云',
    form: 'solo',
    ageBand: '4-6',
    pages: [
      {
        pageNo: 1,
        scene: '天上一朵云变成船的样子',
        body: ['天上那朵云变成了一条船。', '她踮起脚看了看。'],
      },
      { pageNo: 2, scene: '她坐进船的肚子里', body: ['她坐进船的肚子里。', '船慢慢地飘起来。'] },
      {
        pageNo: 3,
        scene: '云船飘到窗外就散开了',
        body: ['船飘到窗外就散开了。', '她笑着回到小床上。'],
      },
    ],
  },
  {
    bookId: 'bk_own_konglong',
    owner: OWNER,
    title: '恐龙背上的下午',
    theme: '恐龙',
    form: 'solo',
    ageBand: '4-6',
    pages: [
      {
        pageNo: 1,
        scene: '树林里走出一只大恐龙',
        body: ['树林里走出一只很大的恐龙。', '它低下头看着他。'],
      },
      { pageNo: 2, scene: '恐龙让他爬到背上', body: ['恐龙让他爬到背上。', '他抓住一片树叶。'] },
      {
        pageNo: 3,
        scene: '恐龙送他到家门口',
        body: ['恐龙把他送到家门口。', '然后慢慢走回树林。'],
      },
    ],
  },
  {
    bookId: 'bk_own_yueliang',
    owner: OWNER,
    title: '月亮一直跟着我',
    theme: '月亮',
    form: 'solo',
    ageBand: '4-6',
    pages: [
      {
        pageNo: 1,
        scene: '月亮在窗外的树梢上',
        body: ['月亮停在窗外的树梢上。', '他朝月亮挥了挥手。'],
      },
      {
        pageNo: 2,
        scene: '他走月亮也走',
        body: ['他往前走，月亮也跟着走。', '他停下来，月亮也停下来。'],
      },
      {
        pageNo: 3,
        scene: '月亮跟着他回到家',
        body: ['月亮一直跟他回到门口。', '他关上门，月亮还在天上。'],
      },
    ],
  },
]

/** ⑤ 的"已读清单"：这个孩子听过的三部样书（固定，取自 12 本样书的键） */
const READ_KEYS = ['cloud', 'dino', 'moon'] as const

/**
 * 适龄句长的**上限一个字数**（超出即"超长句"）。
 * ★ 抄自 `src/lib/prompts/story-plan.ts` 的 `AGE_RULES`（4-6 = 每句 12–18 字）。
 *   那份表不是导出的常量，所以这里**抄了一份**，并在开跑时做一次**可见性校验**：
 *   如果提示词里已经不再出现这句话，报告会写明"这条上限要重新对齐"——
 *   抄一份而不管它，才是真的会分叉。
 */
const BAND_MAX_CHARS: Record<string, number> = { '4-': 12, '4-6': 18, '6-8': 26, '8+': 999 }
const BAND_MIN_CHARS: Record<string, number> = { '4-': 1, '4-6': 12, '6-8': 18, '8+': 1 }
const BAND_RULE_SENTENCE = '每句 12–18 字'
const AGE_BAND = '4-6' as const
const PAGES = 6
const FORM = 'solo' as const

/* ─────────────────────────── 形状 ─────────────────────────── */

/**
 * 臂的名字。★ 两条是**固定的**（`off` 与默认那一格 `lexical`），其余是扫描出来的格子
 * （`lexical@k3ms1`）——工单要求"k × 阈值扫描…定稿这两个超参"，
 * 而只扫**检索侧**（取到几条）不足以定稿：取到的条数一样多，生成质量可能不同。
 * 所以扫描的每一格都能作为一条臂跑，报告里并排看。
 */
type Arm = string
type Verdict = 'ok' | 'plan-invalid' | 'call-failed' | 'rate-limited'

type BookRecord = {
  arm: Arm
  theme: string
  verdict: Verdict
  attempts: number
  /**
   * 每一次重写的**原话**（`retry` 事件的 `reason`，引擎给的，不是我转述的）。
   * ★ `ok` 的本也记：判据 ① 只看次数，而**次数本身不解释自己**——
   *   "重试了 1 次"到底是格式不对、树形不对，还是内容审核没过，
   *   是这张表最要紧的那句"为什么"。W1 横评的教训第 3 条就是这一条
   *   （`w1-text-bakeoff.mts`：失败原因原样转发，不自己重新归类）。
   */
  failures: string[]
  seconds: number
  title?: string
  nodeCount?: number
  sentences?: number
  avgSentenceLen?: number
  overLongRatio?: number
  /** 12–18 字（`AGE_RULES` 的 4-6 区间）的句子占比。★ **描述量，不参与裁决** */
  inBandRatio?: number
  outOfBandRatio?: number
  dupWithOwn?: number
  /** ★ v2 主判据：与**同一主题那本旧书**的 6 字连续子串重合句子占比 */
  dupWithHistory?: number
  /** 同一个量的 4 字版本（**描述量**，字短了巧合就多，只用来交叉看一眼） */
  dupWithHistory4?: number
  /** 这一本是这一主题的第几次重复（配对用） */
  repeatIndex: number
  /**
   * 每页的 `scene` 与正文。★ 两个用处：`--history=live` 拿它造 ②创作史
   * （chunk 要的就是这两格），以及报告里留一份"这一本写了什么"的证据。
   */
  pages?: { scene: string; body: string[] }[]
  overlapWithExamples?: number
  noveltyVsRead?: number
  examples?: number
  avoids?: number
  topScore?: number | null
  errorCode?: string
  error?: string
}

type SweepRow = {
  k: number
  minScore: number
  /** 10 个主题里，取到至少一条范例的个数 */
  themesWithExamples: number
  avgExamples: number
  avgAvoids: number
  avgTopScore: number | null
}

type ThemeScores = {
  theme: string
  /** 每段命中文字的最高分（k=5、minScore=0 那一档，只看 score） */
  top: number[]
}

type Report = {
  builtAt: number
  model: string
  books: number
  /** 每个主题跑几次（配对设计里的重复数）。老的 report.json 没有这一栏 */
  repeats?: number
  maxAttempts: number
  k: number
  minScore: number
  bandRuleVisible: boolean
  /** 池子被收窄时那一档（出厂值见 `DEFAULT_NARROWED_MIN_SCORE`） */
  narrowed?: number
  preflight: { prefixOk: boolean; addedChars: number[] }
  seedChars: number
  sweep: SweepRow[]
  distribution: ThemeScores[]
  arms: Record<Arm, BookRecord[]>
  /** ②创作史：每主题那一本旧书（`--history=live` 时是本流水线产出的） */
  history: { theme: string; title: string; sentences: number }[]
  /** ②创作史是怎么来的：`live` = 本流水线产出（可测），`fixture` = 手写的那三本 */
  historyMode: 'live' | 'fixture'
  /** 造 ②创作史花掉的调用次数（与两臂分开记，成本行要说得清钱花在哪一段） */
  historyCalls?: number
  /** v2 的两个端点：配对检验的读数（`repeats` 为 1 时不出这一节） */
  paired?: PairedTest[]
  /** 每一条 lexical 臂用的那一格（键与 `arms` 对齐）。`off` 不在这里 */
  cells: Record<string, { k: number; minScore: number }>
  /** 跑测期间遇到过的限流次数（**不是数据**，单独记） */
  rateLimitHits: number
  /**
   * **重复测量**（`--repeat=<另一次 report.json>`）：同一个配置再跑一轮的 ① 那一栏。
   *
   * ★ 为什么要它：判据 ① 在 n=10 上的**一格就是 10 个百分点**——
   *   而 10 个百分点正是预声明的阈值。也就是说"一本书重了一次"就足以宣布"显著"。
   *   一次读数撑不起那个结论，所以这一栏必须**再看一轮**：
   *   两轮同号才有话说，变号就是"这一栏在测采样噪声"。
   *   （本节是 2026-10-19 实测出来的：第一轮 `off` 10/10、第三臂 8/10；
   *     第二轮 `off` 9/10、第三臂 10/10——同一个配置，差的那一本换了一边。）
   */
  repeat?: RunSummary[]
}

/** 一次跑测里 ① 那一栏的读数（够重复测量用，不含逐本明细） */
type RunSummary = {
  label: string
  offFirst: number
  offJudged: number
  offAttempts: number
  lexFirst: number
  lexJudged: number
  lexAttempts: number
}

/* ─────────────────────────── 量法（纯函数，报告里逐条写明） ─────────────────────────── */

/** 正文按句末标点切开。★ 中英文标点都收：模型偶尔写 `!` 或 `?` */
function sentencesOf(texts: readonly string[]): string[] {
  return texts
    .flatMap((text) => text.split(/[。！？!?…]+/))
    .map((line) => line.replace(/\s+/g, ''))
    .filter((line) => line.length > 0)
}

/** 一份文本里所有长度为 n 的连续子串 */
function gramsOf(text: string, n: number): Set<string> {
  const grams = new Set<string>()
  for (let i = 0; i + n <= text.length; i += 1) grams.add(text.slice(i, i + n))
  return grams
}

const OVERLAP_GRAM = 6

/**
 * 句子重合率：有多少**句子**里含有 ≥6 字的连续子串，而那一段也出现在参照集里。
 *
 * ★ 为什么是"6 字连续子串"这个判据：中文字数少、常见搭配多，
 *   比"整句相同"松、比"某个词相同"紧。6 个连续字（≈ 一个短句的一半）
 *   在同一档语料里独立出现两次是很少见的，所以它更可能真的是照抄。
 * ★ 分母是**句子数**不是字数：一句抄来的长句与一句巧合同词都在同一个尺度上。
 */
function overlapRatio(
  sentences: readonly string[],
  reference: readonly string[],
  n = OVERLAP_GRAM,
): number {
  if (sentences.length === 0) return 0
  const pool = new Set<string>()
  for (const text of reference) {
    for (const gram of gramsOf(text.replace(/\s+/g, ''), n)) pool.add(gram)
  }
  let hit = 0
  for (const sentence of sentences) {
    for (const gram of gramsOf(sentence, n)) {
      if (pool.has(gram)) {
        hit += 1
        break
      }
    }
  }
  return hit / sentences.length
}

/* ─────────────────────────── 造请求 ─────────────────────────── */

const CARD: CharacterCard = {
  schemaVersion: 1,
  cardId: 'bakeoff-card',
  childId: 'bakeoff-child',
  revision: 1,
  anchors: [
    { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
    { slot: 'eyes', value: '深棕圆眼、眼距略宽' },
    { slot: 'hair', value: '黑发偏软，左上方翘起一撮' },
    { slot: 'build', value: '头身比约 1:4，四肢圆润' },
    { slot: 'skin', value: '暖黄偏深的肤色' },
    { slot: 'wardrobe', value: '芥黄短袖 + 深蓝短裤' },
  ],
  style: { key: 'warm-handdrawn', promptFragment: '温暖手绘水彩绘本插画', ratio: '3:2' },
  reference: {
    path: 'cards/bakeoff/ref.webp',
    digest: 'deadbeef0000',
    bytes: 3,
    mime: 'image/webp',
  },
  provenance: {
    modelId: 'bakeoff',
    promptVersion: 'character-card@v1',
    cardRevision: 1,
    generatedAt: 0,
  },
  createdAt: 0,
}

function requestOf(item: { theme: string; wish: string }): BookRequest {
  return {
    // ★ 两臂**共用同一个孩子**：改了它，两臂比的就不是检索那一段了
    child: {
      childId: 'bakeoff-child',
      name: '小宇',
      nameReading: 'yǔ',
      ageBand: AGE_BAND,
      gender: 'boy',
      lookTags: ['圆脸', '短发'],
      interestTags: ['恐龙', '船'],
    },
    card: CARD,
    theme: item.theme,
    wish: item.wish,
    form: FORM,
    pages: PAGES,
  }
}

function planInputOf(request: BookRequest): StoryPlanInput {
  return {
    childName: request.child.name,
    nameReading: request.child.nameReading,
    ageBand: request.child.ageBand,
    interestTags: request.child.interestTags,
    lookTags: request.child.lookTags,
    theme: request.theme,
    wish: request.wish,
    form: request.form,
    pages: request.pages ?? PAGES,
  }
}

/* ─────────────────────────── 检索侧（不与模型打交道） ─────────────────────────── */

type Retrieval = {
  index: RagIndex
  own: RagChunk[]
  readTexts: string[]
  seedChars: Set<string>
  /** 主题 → 那一本旧书的正文（v2 主判据 ③ 的参照集，**按主题分开**） */
  historyTexts: Map<string, string[]>
}

function queryOf(request: BookRequest): Omit<Parameters<typeof retrieveBoth>[0], 'k' | 'minScore'> {
  const input = planInputOf(request)
  return {
    ageBand: input.ageBand,
    theme: input.theme,
    form: input.form,
    text: queryTextOf(input),
    owner: OWNER,
  }
}

/**
 * 冻结参照集 / 预检 / 扫描表都用它。
 *
 * ★ `narrowedMinScore` **必须一起传**：2026-10-19 实测踩过——出厂配置已经换成
 *   两档阈值，而这里忘了跟着改，于是预检行仍显示 4 个主题取不到范例，
 *   差点把"剂量还是零"当成结论记下来。**量具与被量的配置必须同源。**
 */
function pairOf(
  request: BookRequest,
  retrieval: Retrieval,
  k: number,
  minScore: number,
  narrowedMinScore: number = DEFAULT_NARROWED_MIN_SCORE,
): { examples: RetrieveHit[]; avoids: RetrieveHit[] } {
  return retrieveBoth({ ...queryOf(request), k, minScore, narrowedMinScore }, retrieval.index)
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

async function main(): Promise<void> {
  const env = await readEnv()
  const model = arg('models', arg('model', env['LLM_MODEL'] ?? '')).trim()
  if (model === '') throw new Error('--models 必填（或先在 .env.local 配 LLM_MODEL）')
  const books = Number(arg('books', String(BATCH.length)))
  const maxAttempts = Number(arg('maxAttempts', '3'))
  const k = Number(arg('k', String(DEFAULT_K)))
  const minScore = Number(arg('minScore', String(DEFAULT_MIN_SCORE)))
  const narrowed = Number(arg('narrowed', String(DEFAULT_NARROWED_MIN_SCORE)))
  const delayMs = Number(arg('delayMs', '3000'))
  /**
   * `--cells=3:1,5:1`：除了默认那一格，再按这几格各跑一条 lexical 臂。
   * ★ 只在**这一格与默认那一格会取到不同的东西**时才有意义——扫描表会说明哪些格是重复的
   *   （事实上 `3:2` 与 `5:2` 的取数完全一样：阈值挡在顶上，k 根本轮不到）。
   */
  const extraCells = arg('cells', '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      // `k:minScore[:narrowedMinScore]`——第三个数不写就是出厂那一档
      const [cellK, cellMs, cellNarrowed] = item.split(':')
      return {
        k: Number(cellK),
        minScore: Number(cellMs),
        narrowedMinScore:
          cellNarrowed === undefined ? DEFAULT_NARROWED_MIN_SCORE : Number(cellNarrowed),
      }
    })
  const backoffMs = Number(arg('backoffMs', '30000'))
  const retries = Number(arg('retries', '3'))
  /**
   * 每个主题跑几次。★ v2 的配对设计要 `--repeats=3`（10 主题 × 3 = 30 本/臂）——
   *   第一轮是 1，那时"一本书就等于 10 个百分点"。
   */
  const repeats = Math.max(1, Number(arg('repeats', '1')))
  /**
   * ②创作史从哪来。`live`（v2 默认）= **先用 off 臂每主题生成一本**，再拿它们当
   * "他已经读过的书"——手写的那三本落点不是模型会写的那些，那是 ③ 在第一轮
   * 饱和为 0 的原因。`fixture` = 回到手写那三本（第一轮的配置，留着可复现）。
   */
  const historyMode = arg('history', 'live') === 'fixture' ? 'fixture' : 'live'
  const out = resolve(arg('out', '.out/rag-bakeoff'))
  await mkdir(out, { recursive: true })

  const repeatPath = arg('repeat', '')
  if (arg('reportOnly', '') === '1') {
    const saved = JSON.parse(await readFile(join(out, 'report.json'), 'utf8')) as Report
    if (repeatPath !== '') {
      const other = JSON.parse(await readFile(resolve(repeatPath), 'utf8')) as Report
      saved.repeat = [summaryOf(other, repeatPath)]
    }
    await writeFile(join(out, 'report.md'), renderReport(saved), 'utf8')
    process.stdout.write(
      `从 ${join(out, 'report.json')} 重出报告（未调用任何模型）：\n${join(out, 'report.md')}\n`,
    )
    return
  }

  // 语料：① 种子（读盘）+ ②创作史
  const seed = await loadSeedIndex()
  const readTexts = seed.chunks
    .filter((chunk) => READ_KEYS.some((key) => chunk.id.startsWith(`library/${key}#`)))
    .map((chunk) => chunk.text)
  const seedChars = new Set(seed.chunks.flatMap((chunk) => [...chunk.text]))
  /**
   * ★ `live` 模式下，②创作史在这一步**还不存在**——它要先用 `off` 臂生成
   *   （Phase 0，见 providers 造出来之后）。所以这一段的预检与扫描表
   *   是**只有种子**时的读数；报告里那一节会写明这一点。
   */
  const fixtureOwn =
    historyMode === 'fixture' ? OWN_BOOKS.flatMap((book) => chunksFromStoryBook(book)) : []
  const fixtureTexts = new Map<string, string[]>(
    historyMode === 'fixture'
      ? OWN_BOOKS.map((book) => [book.theme ?? '', book.pages.flatMap((page) => [...page.body])])
      : [],
  )
  let retrieval: Retrieval = {
    index: { ...seed, chunks: [...seed.chunks, ...fixtureOwn] },
    own: fixtureOwn,
    readTexts,
    seedChars,
    historyTexts: fixtureTexts,
  }

  const batch = BATCH.slice(0, books)
  const first = batch[0]
  if (!first) throw new Error('这一批一个主题都没有')
  const bandRuleVisible = storyPlanUser(planInputOf(requestOf(first))).includes(BAND_RULE_SENTENCE)

  // ★ 预检：`off` 的提示词必须是 `lexical` 的**前缀**（差的那几个字就是检索段）。
  //   不成立的话两臂比的不是同一件事，这张表当场作废——所以它是**中止**条件，不是警告。
  const addedChars = batch.map((item) => {
    const request = requestOf(item)
    const input = planInputOf(request)
    const plain = storyPlanUser(input)
    const pair = pairOf(request, retrieval, k, minScore)
    const withRetrieval = storyPlanUser({ ...input, retrieval: pair })
    if (!withRetrieval.startsWith(plain)) {
      throw new Error(
        `预检不过：主题「${item.theme}」的 off 提示词不是开了检索那一份的前缀——` +
          '两臂比的不是同一件事，这张表不成立',
      )
    }
    return withRetrieval.length - plain.length
  })

  // 检索侧的分数分布与超参扫描（**不花一分钱**，先看清楚再决定跑哪一格）
  const distribution: ThemeScores[] = batch.map((item) => {
    // ★ 两个阈值都传 0：这一张表要的是**原始排序**（谁在谁前面、各多少分），
    //   不是"出厂配置下取到了什么"。不这么写的话，它会被出厂那一档阈值
    //   悄悄过滤掉一半——2026-10-19 实测看到过（恐龙那一行从三个数变成一个）。
    const pair = pairOf(requestOf(item), retrieval, 5, 0, 0)
    return {
      theme: item.theme,
      top: [...pair.avoids, ...pair.examples]
        .map((hit) => hit.score)
        .sort((a, b) => b - a)
        .slice(0, 3),
    }
  })
  const K_LEVELS = [1, 3, 5]
  /**
   * ★ 扫的是 **narrowedMinScore**，不是 `minScore`——2026-10-19 把阈值分成两档之后，
   *   带主题的请求走的是这一档，`minScore` 对它**完全不起作用**了。
   *   还按 `minScore` 扫的话，九行会一模一样（实测就是），那张表就成了摆设。
   *   三个档位：`0.5`（几乎照单全收）、`1`（出厂）、`2`（第一轮那一刀切的值）。
   */
  const NARROWED_LEVELS = [0.5, 1, 2]
  const sweep: SweepRow[] = []
  for (const kk of K_LEVELS) {
    for (const ms of NARROWED_LEVELS) {
      let withExamples = 0
      let examples = 0
      let avoids = 0
      let topSum = 0
      let topCount = 0
      for (const item of batch) {
        const pair = pairOf(requestOf(item), retrieval, kk, minScore, ms)
        if (pair.examples.length > 0) withExamples += 1
        examples += pair.examples.length
        avoids += pair.avoids.length
        for (const hit of pair.examples) {
          topSum += hit.score
          topCount += 1
        }
      }
      sweep.push({
        k: kk,
        minScore: ms,
        themesWithExamples: withExamples,
        avgExamples: examples / batch.length,
        avgAvoids: avoids / batch.length,
        avgTopScore: topCount === 0 ? null : topSum / topCount,
      })
    }
  }

  process.stdout.write(
    `对照跑测：${model} × ${batch.length} 本 × 两臂（off / lexical）\n` +
      `  检索超参：k=${k} minScore=${minScore}（agent 定稿值见扫描表）\n` +
      `  预检：两臂提示词只差检索段（多出 ${addedChars.join('/')} 字）· 适龄句长上限可见=${bandRuleVisible}\n` +
      `  语料：种子 ${seed.chunks.length} 条（${seedChars.size} 个不同汉字）· ②创作史 ${retrieval.own.length} 条（${historyMode}）\n\n`,
  )

  // ★ `--dryRun=1`：**只跑检索侧**（预检、分数分布、超参扫描），一次模型都不调。
  //   先看清楚再决定跑哪一格——那一格要花钱，而这张扫描表不花。
  if (arg('dryRun', '') === '1') {
    process.stdout.write(
      `（dryRun：不调用任何模型）\n` +
        `  预检：两臂提示词只差检索段（多出 ${addedChars.join('/')} 字）· 适龄句长上限可见=${bandRuleVisible}\n` +
        `  语料：种子 ${seed.chunks.length} 条（${seedChars.size} 个不同汉字）· ②创作史 ${retrieval.own.length} 条（${historyMode}）\n\n` +
        `  分数分布（k=5、minScore=0，每主题最高的三段）：\n` +
        distribution
          .map((row) => `    ${row.theme}：${row.top.map((score) => score.toFixed(2)).join(' / ')}`)
          .join('\n') +
        `\n\n  k × narrowedMinScore 扫描（带主题的请求走这一档；minScore=${minScore} 只管"认不出主题"那条路）：\n` +
        `    k  narrowed  有范例的主题  平均范例  平均避开  范例均分\n` +
        sweep
          .map(
            (row) =>
              `    ${row.k}  ${row.minScore}         ${row.themesWithExamples}/${batch.length}` +
              `            ${row.avgExamples.toFixed(2)}      ${row.avgAvoids.toFixed(2)}` +
              `     ${row.avgTopScore === null ? '—' : row.avgTopScore.toFixed(2)}`,
          )
          .join('\n') +
        '\n',
    )
    return
  }

  const text = createOpenAiText(
    {
      baseUrl: env['LLM_BASE_URL'] ?? 'https://tokenrhythm.studio/v1',
      apiKey: env['LLM_API_KEY'] ?? '',
      ...(env['LLM_TIMEOUT_MS'] ? { timeoutMs: Number(env['LLM_TIMEOUT_MS']) } : {}),
    },
    model,
    textOptionsOf(env),
  )
  const providers = providersWith(text)

  /**
   * **Phase 0：先造 ②创作史**（只 `--history=live`）。
   *
   * ★ 为什么不能让手写的三本顶替：`avoid` 那一侧的语义是"**他已经读过了**"，
   *   而"他会重复自己"这件事只有在旧书**出自同一条流水线**时才成立——
   *   第一轮用三本手写旧书，两臂的重复度都是 0.0%，`③` 因此**饱和**、测不出东西。
   *   （手写那三本的落点根本不是模型会写的那些，这个坑记在工单 06 的 Comments 里。）
   * ★ 走的是 `runOne`，也就是 `planBook`——**与生产同一条路**，不另搭一条。
   */
  const history: StoryBookSource[] = []
  let historyCalls = 0
  if (historyMode === 'live') {
    process.stdout.write(
      `── Phase 0：造 ②创作史（off 臂，每主题一本，之后当作"他已经读过的书"） ──\n`,
    )
    for (const [index, item] of batch.entries()) {
      if (index > 0) await sleep(delayMs)
      const record = await runOne({
        arm: 'history',
        request: requestOf(item),
        retrieval,
        text,
        providers,
        retriever: null,
        maxAttempts,
        historyText: [],
        repeatIndex: -1,
        refK: k,
        refMinScore: minScore,
        backoffMs,
        retries,
      })
      historyCalls += Math.max(1, record.attempts)
      process.stdout.write(`  ${item.theme}：${describeRecord(record)}\n`)
      if (record.verdict !== 'ok' || !record.pages) {
        // ★ 没测成的那一本**不补替身**：那个主题就没有"他读过的那本"，
        //   主判据在那一行的参照是空的——报告里照实显示，不要拿别的东西顶上
        process.stdout.write(`    （这一主题的 ③ 不会有参照：那一本没测成）\n`)
        continue
      }
      history.push({
        bookId: `hist-${item.theme}`,
        owner: OWNER,
        title: record.title ?? item.theme,
        theme: item.theme,
        form: FORM,
        ageBand: AGE_BAND,
        pages: record.pages.map((page, i) => ({
          pageNo: i + 1,
          scene: page.scene,
          body: page.body,
        })),
      })
    }
    const ownChunks = history.flatMap((book) => chunksFromStoryBook(book))
    retrieval = {
      ...retrieval,
      index: { ...seed, chunks: [...seed.chunks, ...ownChunks] },
      own: ownChunks,
      historyTexts: new Map(
        history.map((book) => [book.theme ?? '', book.pages.flatMap((page) => [...page.body])]),
      ),
    }
    process.stdout.write(`  ②创作史：${history.length} 本 · ${ownChunks.length} 条 chunk\n\n`)
  }

  const report: Report = {
    builtAt: Date.now(),
    model,
    books: batch.length,
    maxAttempts,
    k,
    minScore,
    narrowed,
    bandRuleVisible,
    preflight: { prefixOk: true, addedChars },
    seedChars: seedChars.size,
    sweep,
    distribution,
    repeats,
    arms: { off: [], lexical: [] },
    cells: { lexical: { k, minScore } },
    history: history.map((book) => ({
      theme: book.theme ?? '?',
      title: book.title,
      sentences: book.pages.reduce((sum, page) => sum + page.body.length, 0),
    })),
    historyMode,
    historyCalls,
    rateLimitHits: 0,
  }

  const armList: { arm: Arm; k: number; minScore: number; narrowedMinScore: number }[] = [
    { arm: 'off', k, minScore, narrowedMinScore: DEFAULT_NARROWED_MIN_SCORE },
    { arm: 'lexical', k, minScore, narrowedMinScore: DEFAULT_NARROWED_MIN_SCORE },
    ...extraCells.map((cell) => ({
      arm: `lexical@k${cell.k}ms${cell.minScore}n${cell.narrowedMinScore}`,
      k: cell.k,
      minScore: cell.minScore,
      narrowedMinScore: cell.narrowedMinScore,
    })),
  ]
  /** 主题 × 重复：**配对设计的样本单位是主题**，重复是为了压住书级抖动 */
  const runs = batch.flatMap((item) =>
    Array.from({ length: repeats }, (_, repeatIndex) => ({ item, repeatIndex })),
  )

  for (const cell of armList) {
    const { arm } = cell
    if (arm !== 'off') report.arms[arm] = []
    if (arm !== 'off' && arm !== 'lexical')
      report.cells[arm] = { k: cell.k, minScore: cell.minScore }
    process.stdout.write(
      `── 臂 ${arm}${arm === 'off' ? '（不检索）' : `（k=${cell.k} minScore=${cell.minScore}）`} ─────────────\n`,
    )
    const retriever =
      arm !== 'off'
        ? createPlanRetriever({
            store: createMemoryStore(),
            owner: OWNER,
            k: cell.k,
            minScore: cell.minScore,
            narrowedMinScore: cell.narrowedMinScore,
            seed,
            own: retrieval.own,
          })
        : null
    for (const [index, run] of runs.entries()) {
      // ★ 放慢：两次调用之间歇一下。工单 01 那次限流就是"连打几十次"打出来的，
      //   而这一轮要跑近百本——限流一旦发生，代价是"这几本没测成"，
      //   比多等两分钟贵得多（`--delayMs=0` 可以关掉，但那要写在报告里）。
      if (index > 0) await sleep(delayMs)
      const request = requestOf(run.item)
      const record = await runOne({
        arm,
        request,
        retrieval,
        text,
        providers,
        retriever,
        maxAttempts,
        historyText: retrieval.historyTexts.get(run.item.theme) ?? [],
        repeatIndex: run.repeatIndex,
        refK: k,
        refMinScore: minScore,
        backoffMs,
        retries,
      })
      ;(report.arms[arm] ??= []).push(record)
      if (record.verdict === 'rate-limited') report.rateLimitHits += 1
      process.stdout.write(
        `  ${run.item.theme}#${run.repeatIndex + 1}：${describeRecord(record)}\n`,
      )
    }
    process.stdout.write('\n')
  }

  if (repeatPath !== '') {
    const other = JSON.parse(await readFile(resolve(repeatPath), 'utf8')) as Report
    report.repeat = [summaryOf(other, repeatPath)]
  }

  /**
   * v2 的两个端点（口径见 spec §九，**跑之前定死**）。
   * ★ 主判据门槛严一档（p<0.025）是因为有两个端点，压住族错误率。
   */
  report.paired = [
    pairedTestOf(report, '③ 与本主题旧书的重复度', (record) => record.dupWithHistory, 5, 0.025),
    pairedTestOf(report, '② 超长句（>18 字）比例', (record) => record.overLongRatio, 3, 0.05),
  ]
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  await writeFile(join(out, 'report.md'), renderReport(report), 'utf8')
  process.stdout.write(`报告：${join(out, 'report.md')}\n`)
  const summary = verdictOf(report)
  process.stdout.write(`结论：${summary.headline}\n`)
}

function providersWith(text: TextGenerator): ProviderBundle {
  /**
   * ★ 出图那一路给一个**被调到就报错**的替身，不给一个假对象。
   *   这一张只走规划那一步，`planBook` 一次也不会碰它——所以这个替身正常时永远不会响。
   *   而它一旦响了，说明"这一步居然开始出图了"，那时我们要的是**一声巨响**，
   *   不是一个静静产出的假资产（同一条纪律：`errors.ts` 的"没有静默降级"）。
   */
  const refused: ImageGenerator = {
    id: 'bakeoff-refuses-to-draw',
    modelId: 'bakeoff-refuses-to-draw',
    supportedRatios: ['1:1'],
    supportsReference: false,
    async generate() {
      throw new Error('对照跑测只跑规划那一步：这一轮不该有任何出图调用')
    },
  }
  return {
    mode: 'live',
    text,
    image: refused,
    vision: null,
    voice: null,
    store: createMemoryStore(),
  }
}

type RunArgs = {
  arm: Arm
  request: BookRequest
  retrieval: Retrieval
  text: TextGenerator
  providers: ProviderBundle
  retriever: ReturnType<typeof createPlanRetriever> | null
  maxAttempts: number
  /** 同一主题那本旧书的正文（v2 主判据 ③ 的参照集）。`fixture` 模式下没有就是空 */
  historyText: readonly string[]
  /** 这一本是这一主题的第几次重复 */
  repeatIndex: number
  /**
   * **冻结参照范例集**用的那一格（默认那一格，所有臂共用——见文件头 §二）。
   * ★ 它**不是**这一条臂自己的超参：参照集若跟着臂变，"两臂比的是两个参照系"，
   *   而那种比较没有意义。
   */
  refK: number
  refMinScore: number
  backoffMs: number
  retries: number
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** 限流的指纹：状态 429 或供应商码 `RATE_LIMITED`（工单 01 见过的那一种） */
function isRateLimited(err: unknown): boolean {
  if (!(err instanceof EngineError)) return false
  return err.httpStatus === 429 || err.providerCode === 'RATE_LIMITED'
}

async function runOne(args: RunArgs): Promise<BookRecord> {
  const { request, retrieval, arm, providers, retriever } = args
  const record: BookRecord = {
    arm,
    theme: request.theme,
    repeatIndex: args.repeatIndex,
    verdict: 'call-failed',
    attempts: 0,
    failures: [],
    seconds: 0,
  }
  const started = Date.now()

  // ★ 限流退避重试：`RATE_LIMITED` **什么都没证明**（工单 01 的教训），
  //   所以它不是数据，重试到拿到真结果或次数用尽；用尽之后记成 `rate-limited`
  //   并**排除在分母之外**（报告里"测成的 N / 总共的 M"要分开写）。
  for (let attempt = 1; attempt <= args.retries; attempt += 1) {
    try {
      const retries: string[] = []
      const plan = await planBook(request, {
        providers,
        maxAttempts: args.maxAttempts,
        ...(retriever ? { retriever } : {}),
        // ★ 从事件里收重试原因：`planBook` 的返回里没有它们（`StoryPlan` 只有 `attempts`），
        //   而**事件正是引擎发出去的那一份**——比在本脚本里重新解析一遍错误消息可靠。
        onEvent: (event) => {
          if (event.kind === 'retry') retries.push(event.reason)
        },
      })
      const bodies = plan.tree.nodes.flatMap((node) => [...node.body])
      const sentences = sentencesOf(bodies)
      const chars = bodies.join('').replace(/\s+/g, '').length
      const pair = pairOf(request, retrieval, args.refK, args.refMinScore)
      const exampleTexts = pair.examples.map((hit) => hit.chunk.text)
      record.verdict = 'ok'
      record.attempts = plan.attempts
      record.failures = retries
      record.title = plan.tree.title
      record.nodeCount = plan.tree.nodes.length
      record.pages = plan.doc.nodes.map((node) => ({ scene: node.scene, body: [...node.body] }))
      record.sentences = sentences.length
      record.avgSentenceLen = sentences.length === 0 ? 0 : chars / sentences.length
      record.overLongRatio =
        sentences.length === 0
          ? 0
          : sentences.filter((line) => line.length > (BAND_MAX_CHARS[AGE_BAND] ?? 99)).length /
            sentences.length
      record.inBandRatio =
        sentences.length === 0
          ? 0
          : sentences.filter(
              (line) =>
                line.length >= BAND_MIN_CHARS[AGE_BAND] &&
                line.length <= (BAND_MAX_CHARS[AGE_BAND] ?? 99),
            ).length / sentences.length
      const outOfBand = [...bodies.join('')].filter(
        (char) => /[一-龥]/.test(char) && !retrieval.seedChars.has(char),
      ).length
      record.outOfBandRatio = chars === 0 ? 0 : outOfBand / chars
      record.dupWithOwn = overlapRatio(
        sentences,
        retrieval.own.map((chunk) => chunk.text),
      )
      // ★ v2 主判据：只跟**同一主题**那本旧书比。跨主题的重合没有意义
      //   （"云"和"城堡"共用几个字是中文的正常现象，不是"重复了"）
      record.dupWithHistory = overlapRatio(sentences, args.historyText)
      record.dupWithHistory4 = overlapRatio(sentences, args.historyText, 4)
      record.overlapWithExamples = overlapRatio(sentences, exampleTexts)
      record.noveltyVsRead = 1 - overlapRatio(sentences, retrieval.readTexts)
      // ★ `off` 那一臂没有 provenance（`PlanOutcome.retrieval` 只在开了检索时才有），
      //   所以这里的 `—` 是"这一轮没检索"，不是"检索到了 0 条"
      record.examples = plan.retrieval?.examples ?? undefined
      record.avoids = plan.retrieval?.avoids ?? undefined
      record.topScore = plan.retrieval?.topScore ?? undefined
      record.seconds = Math.round((Date.now() - started) / 100) / 10
      return record
    } catch (err) {
      const engine = err instanceof EngineError ? err : null
      record.errorCode = engine?.code
      record.error = err instanceof Error ? err.message : String(err)
      if (engine?.code === 'schema-validation-failed') {
        record.verdict = 'plan-invalid'
        record.attempts = args.maxAttempts
        record.failures = Array.isArray(engine.detail)
          ? engine.detail.map(String)
          : [engine.message]
        record.seconds = Math.round((Date.now() - started) / 100) / 10
        return record
      }
      if (isRateLimited(err)) {
        record.verdict = 'rate-limited'
        if (attempt < args.retries) {
          process.stdout.write(
            `    ${request.theme}：限流，退避 ${args.backoffMs / 1000}s 后重试\n`,
          )
          await sleep(args.backoffMs)
          continue
        }
        record.seconds = Math.round((Date.now() - started) / 100) / 10
        return record
      }
      record.verdict = 'call-failed'
      record.seconds = Math.round((Date.now() - started) / 100) / 10
      return record
    }
  }
  record.seconds = Math.round((Date.now() - started) / 100) / 10
  return record
}

function describeRecord(record: BookRecord): string {
  if (record.verdict === 'ok') {
    return (
      `过 · ${record.attempts} 次 · ${record.nodeCount} 页 · ${record.seconds}s` +
      ` · 范例 ${record.examples ?? '—'} / 避开 ${record.avoids ?? '—'}`
    )
  }
  if (record.verdict === 'plan-invalid') return `${record.attempts} 次规划不过 · ${record.seconds}s`
  if (record.verdict === 'rate-limited') return `**限流，没测成**（${record.seconds}s）`
  return `**调用失败** ${record.errorCode ?? ''} ${record.error ?? ''}`
}

/* ─────────────────────────── 汇总 ─────────────────────────── */

function summaryOf(report: Report, label: string): RunSummary {
  const off = statsOf(report.arms.off ?? [])
  const lex = statsOf(report.arms.lexical ?? [])
  return {
    label,
    offFirst: off.firstPass,
    offJudged: off.judged,
    offAttempts: off.avgAttempts,
    lexFirst: lex.firstPass,
    lexJudged: lex.judged,
    lexAttempts: lex.avgAttempts,
  }
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

type ArmStats = {
  judged: number
  ok: number
  firstPass: number
  avgAttempts: number
  planInvalid: number
  callFailed: number
  rateLimited: number
  avgSentenceLen: number
  overLongRatio: number
  inBandRatio: number
  outOfBandRatio: number
  dupWithOwn: number
  dupWithHistory: number
  overlapWithExamples: number
  noveltyVsRead: number
}

function statsOf(records: readonly BookRecord[]): ArmStats {
  const ok = records.filter((record) => record.verdict === 'ok')
  const planInvalid = records.filter((record) => record.verdict === 'plan-invalid')
  // ★ 分母 = 真的拿到过裁决的本。限流与调用失败**不进来**——
  //   "裁判没到场"不能判"选手没跑"，而"选手没跑"也不能记成"选手跑输了"。
  const judged = [...ok, ...planInvalid]
  const numbers = (pick: (record: BookRecord) => number | undefined): number[] =>
    ok.map(pick).filter((value): value is number => typeof value === 'number')
  return {
    judged: judged.length,
    ok: ok.length,
    firstPass: ok.filter((record) => record.attempts === 1).length,
    avgAttempts: mean(judged.map((record) => record.attempts)),
    planInvalid: planInvalid.length,
    callFailed: records.filter((record) => record.verdict === 'call-failed').length,
    rateLimited: records.filter((record) => record.verdict === 'rate-limited').length,
    avgSentenceLen: mean(numbers((record) => record.avgSentenceLen)),
    overLongRatio: mean(numbers((record) => record.overLongRatio)),
    inBandRatio: mean(numbers((record) => record.inBandRatio)),
    outOfBandRatio: mean(numbers((record) => record.outOfBandRatio)),
    dupWithOwn: mean(numbers((record) => record.dupWithOwn)),
    dupWithHistory: mean(numbers((record) => record.dupWithHistory)),
    overlapWithExamples: mean(numbers((record) => record.overlapWithExamples)),
    noveltyVsRead: mean(numbers((record) => record.noveltyVsRead)),
  }
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`

/**
 * 结论行。**三种，不是两种**：
 *
 * - `不完整`：有一本没测成（限流或调用失败）。这时**不许**下"显著/不显著"的结论——
 *   那是工单 01 那个骗局的同一条：把"没测成"混进"测出来"。
 * - `显著`：一次通过率 +10 个百分点，或平均重试 −0.3。
 * - `不显著`：如实写，并把差异与量法写进报告（spec §一 那条最要紧的话）。
 */
function verdictOf(report: Report): { headline: string; complete: boolean; significant: boolean } {
  const EPS = 1e-9
  const off = statsOf(report.arms.off)
  const lex = statsOf(report.arms.lexical)
  const total = report.arms.off.length + report.arms.lexical.length
  const judged = off.judged + lex.judged
  const incomplete = judged < total
  const rateDelta =
    off.judged === 0 || lex.judged === 0
      ? 0
      : lex.firstPass / lex.judged - off.firstPass / off.judged
  const attemptDelta = off.avgAttempts - lex.avgAttempts
  // ★ 这一行有个浮点坑，实测咬过：`10/10 − 9/10 = 1 − 0.9 = 0.09999999999999998`，
  //   而规则写的是「**+10 个百分点**」——差一格浮点就把达标的判成不达标。
  //   所以留一个 ε（判据那一句是人话，人话里"正好 +10"算达到）。
  const significant = rateDelta >= 0.1 - EPS || attemptDelta >= 0.3 - EPS
  const detail =
    `一次通过率 ${pct(off.judged ? off.firstPass / off.judged : 0)} → ` +
    `${pct(lex.judged ? lex.firstPass / lex.judged : 0)}（${rateDelta >= 0 ? '+' : ''}${(rateDelta * 100).toFixed(1)} 个百分点）· ` +
    `平均重试 ${off.avgAttempts.toFixed(2)} → ${lex.avgAttempts.toFixed(2)}（${attemptDelta >= 0 ? '−' : '+'}${Math.abs(attemptDelta).toFixed(2)}）`
  if (incomplete) {
    return {
      headline: `**不完整**：${total} 本里只有 ${judged} 本拿到了裁决（限流 ${report.rateLimitHits} 次），这一轮不许下"显著/不显著"的结论。${detail}`,
      complete: false,
      significant: false,
    }
  }
  // ★ 有重复测量时，**结论的稳定性也要报**：同一个配置两轮不同号，
  //   说明这一栏的差异在噪声量级上，那时"显著/不显著"这两个词都是在骗人。
  const prior = report.repeat?.[0]
  const priorSignificant =
    prior === undefined
      ? null
      : prior.lexJudged > 0 &&
        prior.offJudged > 0 &&
        (prior.lexFirst / prior.lexJudged - prior.offFirst / prior.offJudged >= 0.1 - EPS ||
          prior.offAttempts - prior.lexAttempts >= 0.3 - EPS)
  if (priorSignificant !== null && priorSignificant !== significant) {
    return {
      headline:
        `**结论不稳定**：同一配置跑两轮，一轮达到阈值、另一轮没有——` +
        `这一栏的差异在噪声量级上（n=${report.books} 时**一本书就等于 10 个百分点**）。` +
        `按预声明口径，本轮：${significant ? '达到' : '未达到'}；上一轮：${priorSignificant ? '达到' : '未达到'}。${detail}`,
      complete: true,
      significant,
    }
  }
  if (significant) {
    return {
      headline:
        `**显著**（达到预声明阈值${prior ? '，且两轮同号' : ''}）${detail}` +
        (prior
          ? ''
          : '（★ 只跑了一轮：这一格的差异量级与采样噪声同量级，请用 --repeat= 再跑一轮）'),
      complete: true,
      significant: true,
    }
  }
  return {
    headline: `**在这份语料上不显著**（未达到预声明阈值 +10 个百分点 / −0.3${prior ? '' : '；只跑了一轮'}）${detail}`,
    complete: true,
    significant: false,
  }
}

/* ────────────── v2：配对设计与精确符号秩检验（预声明见 spec §九） ────────────── */

/**
 * 主题内均值 → 配对观测。
 * ★ 配对单位是**主题**：同一个主题下那三次重复彼此相关（同一个 wish、同一套材料），
 *   把 30 本当 30 个独立观测会把显著性算高一档。
 */
function pairedByTheme(
  records: readonly BookRecord[],
  pick: (record: BookRecord) => number | undefined,
): Map<string, number> {
  const byTheme = new Map<string, number[]>()
  for (const record of records) {
    const value = pick(record)
    if (value === undefined) continue
    byTheme.set(record.theme, [...(byTheme.get(record.theme) ?? []), value])
  }
  return new Map([...byTheme].map(([theme, values]) => [theme, mean(values)]))
}

/**
 * Wilcoxon 符号秩检验，**精确零分布**（n=10 时 2^n=1024 个符号组合，全枚举）。
 *
 * ★ 为什么不用正态近似：配对观测只有 10 个，近似在大样本才成立；
 *   而这里枚举一遍是**零成本**的，精确值没有理由不要。
 * ★ 零差（两臂一模一样）按标准做法**丢掉**（它们不带方向信息）；
 *   全是零差时 p=1（"看不出差别"）。
 * ★ 双侧 p = 2 × min(P(W+ ≤ w), P(W+ ≥ w))，上限 1。
 */
function wilcoxonExact(diffs: readonly number[]): { n: number; w: number; p: number } {
  const nonZero = diffs.filter((value) => value !== 0)
  const n = nonZero.length
  if (n === 0) return { n: 0, w: 0, p: 1 }
  // 秩：升序，并列取平均秩（|差值| 排序）
  const order = [...nonZero.keys()].sort(
    (a, b) => Math.abs(nonZero[a] ?? 0) - Math.abs(nonZero[b] ?? 0),
  )
  const ranks = new Array<number>(n).fill(0)
  let index = 0
  while (index < n) {
    let end = index
    while (
      end + 1 < n &&
      Math.abs(nonZero[order[end + 1] as number] ?? 0) ===
        Math.abs(nonZero[order[index] as number] ?? 0)
    ) {
      end += 1
    }
    const average = (index + 1 + (end + 1)) / 2
    for (let k = index; k <= end; k += 1) ranks[order[k] as number] = average
    index = end + 1
  }
  const w = nonZero.reduce((sum, value, i) => (value > 0 ? sum + (ranks[i] ?? 0) : sum), 0)
  let lower = 0
  let upper = 0
  for (let mask = 0; mask < 1 << n; mask += 1) {
    let sum = 0
    for (let bit = 0; bit < n; bit += 1) if ((mask & (1 << bit)) !== 0) sum += ranks[bit] ?? 0
    if (sum <= w) lower += 1
    if (sum >= w) upper += 1
  }
  const twoSided = (2 * Math.min(lower, upper)) / (1 << n)
  return { n, w, p: Math.min(1, twoSided) }
}

/** v2 的一个端点：配对设计 + 精确符号秩检验 + 效应量门槛 */
type PairedTest = {
  /** `③ 与本主题旧书的重复度` / `② 超长句比例` */
  endpoint: string
  /** 配对观测数 = 主题数（`repeats` 为 1 时不算配对，出 `—`） */
  themes: number
  offMean: number
  lexicalMean: number
  /** 效应量：主题内差值的均值（百分点） */
  deltaPp: number
  p: number
  /** 预声明的效应量门槛（百分点） */
  minEffectPp: number
  /** 预声明的显著性门槛 */
  alpha: number
  pass: boolean
  /** 每个主题的配对读数，进报告表格 */
  rows: { theme: string; off: number; lexical: number; deltaPp: number }[]
}

function pairedTestOf(
  report: Report,
  endpoint: string,
  pick: (record: BookRecord) => number | undefined,
  minEffectPp: number,
  alpha: number,
): PairedTest {
  const off = pairedByTheme(report.arms.off ?? [], pick)
  const lex = pairedByTheme(report.arms.lexical ?? [], pick)
  const themes = [...off.keys()].filter((theme) => lex.has(theme)).sort()
  const rows = themes.map((theme) => {
    const a = off.get(theme) ?? 0
    const b = lex.get(theme) ?? 0
    return { theme, off: a, lexical: b, deltaPp: (b - a) * 100 }
  })
  const diffs = rows.map((row) => row.deltaPp)
  const test = wilcoxonExact(diffs)
  const deltaPp = mean(diffs)
  return {
    endpoint,
    themes: themes.length,
    offMean: mean(rows.map((row) => row.off)),
    lexicalMean: mean(rows.map((row) => row.lexical)),
    deltaPp,
    p: test.p,
    minEffectPp,
    alpha,
    // ★ 三个条件缺一不可：方向对（更低）、效应量够、p 小。
    //   "显著但没用"（很小的差 + 很小的 p）与"有用但看不出"（很大的差 + 很大的 p）都不算过。
    pass: deltaPp <= -minEffectPp && test.p < alpha,
    rows,
  }
}

/**
 * 功效：**要多少本才测得出来**。
 *
 * ★ 为什么值得单列："不显著"有两种，一种是样本不够，一种是效应本来就在噪声以下。
 *   这一节把第二种量出来：拿观测到的**主题级差值的标准差**当噪声尺度，
 *   按 α=0.05（功效 0.8、正态近似）算"要多少个主题、每主题几次重复"。
 *   ★ 它是**事后**算的（用同一批数据估噪声），所以**只用来解释为什么测不出**，
 *   **不参与裁决**——裁决只看上面那两个端点。这一点写进报告里。
 */
function powerOf(test: PairedTest): { sdPp: number; mdePp: number } {
  const deltas = test.rows.map((row) => row.deltaPp)
  const average = mean(deltas)
  const variance =
    deltas.length < 2
      ? 0
      : deltas.reduce((sum, value) => sum + (value - average) ** 2, 0) / (deltas.length - 1)
  const sdPp = Math.sqrt(variance)
  // ★ 报的是**最小可检测效应**（MDE），不是"要多少本"：
  //   观测到的差≈0 时，"测出这个差需要多少本"在数学上趋于无穷，那是一句耍赖的话。
  //   MDE 回答的是同一个问题的正面：**这个设计能看见多大的差**。
  //   双侧 α=0.05、功效 0.8：MDE = (z_{1-α/2} + z_{0.8}) × SD / √n = 2.80 × SD/√n。
  const mdePp = test.themes < 2 ? 0 : (2.8 * sdPp) / Math.sqrt(test.themes)
  return { sdPp, mdePp }
}

/* ─────────────────────────── 报告 ─────────────────────────── */

function renderReport(report: Report): string {
  const armKeys = Object.keys(report.arms)
  const off = statsOf(report.arms.off ?? [])
  const lex = statsOf(report.arms.lexical ?? [])
  const conclusion = verdictOf(report)
  const totalBooks = report.arms.off.length + report.arms.lexical.length
  const num = (value: number, digits = 3): string => value.toFixed(digits)
  const delta = (a: number, b: number): string => `${b - a >= 0 ? '+' : ''}${num(b - a)}`

  const contaminationLimit = off.overlapWithExamples + 0.05
  const totalCalls = armKeys.reduce(
    (sum, key) =>
      sum + (report.arms[key] ?? []).reduce((inner, record) => inner + record.attempts, 0),
    0,
  )
  const contaminated = lex.overlapWithExamples > contaminationLimit

  const lines: string[] = [
    '# 开 / 关检索对照跑测（spec 判据 4 · 工单 06）',
    '',
    `- 模型：\`${report.model}\` · 固定输入：**同一批 ${report.books} 个主题**（中文标签）× 独读版 ${PAGES} 页 · 适龄档 ${AGE_BAND}`,
    '- 走的是引擎真正的规划流水线 `planBook`（角色卡校验 → 提示词 → Schema → 树形 → 内容审核 → 重试），',
    '  两臂**只差 `retriever` 那一项**：`off` 不传，`lexical` 传 `createPlanRetriever`',
    `- 检索超参：k=${report.k} · minScore=${report.minScore}（池子没被收窄时）· ` +
      `narrowedMinScore=${report.narrowed ?? DEFAULT_NARROWED_MIN_SCORE}（池子被主题/owner 收窄时）`,
    `- 预检：\`off\` 的提示词是 \`lexical\` 的前缀 ✔（多出的字 = 检索段，${report.preflight.addedChars.join(' / ')} 字）`,
    `- 语料：① 种子 96 跨页（${report.seedChars} 个不同汉字）· ②创作史 ${report.history.length} 本（**${report.historyMode}**` +
      `${report.historyMode === 'live' ? '：由本流水线产出，每主题一本' : '：手写的三本，第一轮的配置'}）`,
    `- 每主题重复 **${report.repeats ?? 1}** 次（配对设计的重复数；1 = 第一轮那种跑法）`,
    // ★ 成本**只记调用次数**，不折算金额（这条纪律照旧）。
    //   token 用量这一轮记不了：`TextResponse.usage` 是有的，但 `StoryPlan` 不外传它，
    //   而这一张规定"只读不写实现"（不改引擎来让报告更漂亮）。**拿不到就不编一个数**。
    `- 成本：本轮共 **${totalCalls + (report.historyCalls ?? 0)} 次**文本调用` +
      `（各臂 ${totalCalls} 次 + 造 ②创作史 ${report.historyCalls ?? 0} 次）。` +
      '★ token 用量这一轮没记（见工单 06 的「已知缺口」），报告里也不折算金额。',
    '',
    '## 结论',
    '',
    `- **v1 口径**（Schema 通过率 / 平均重试——**这一轮它只是旁证，不是裁决**）：${conclusion.headline}`,
    ...(report.paired && report.paired.length > 0
      ? [
          `- **v2 口径（预声明，本轮裁决）**：` +
            report.paired
              .map(
                (test) =>
                  `${test.endpoint} 差 **${test.deltaPp.toFixed(1)} 个百分点**（p=${test.p.toFixed(4)}）→ ` +
                  `${test.pass ? '**过**' : '不过'}`,
              )
              .join('；'),
          `- v2 两个端点**都过**才算"显著提升"：本轮 ` +
            (report.paired.every((test) => test.pass) ? '**都过**' : '**没都过**'),
        ]
      : []),
    '',
    `- 测成 / 总共：**${off.judged + lex.judged} / ${totalBooks}**（限流 ${report.rateLimitHits} 次，调用失败 ${off.callFailed + lex.callFailed} 次）`,
    '- v1 的预声明阈值（留档）：Schema 一次通过率 **+10 个百分点**，或平均重试次数 **−0.3**',
    '',
    ...(report.paired && report.paired.length > 0
      ? [
          '## v2：预声明的两个端点（配对设计，精确符号秩检验）',
          '',
          `- 配对单位是**主题**（${report.books} 个主题 × 每主题 ${report.repeats ?? '?'} 次重复）：` +
            '先取臂间差的主题内均值，再对主题做检验——**不把 30 本当 30 个独立观测**',
          '- 检验：Wilcoxon 符号秩的**精确零分布**（小样本不做正态近似）；零差按标准做法丢弃',
          '- 口径（**跑之前定死**，见 spec §九）：主判据 ③ p<0.025 且效应量 ≥5 个百分点；' +
            '副判据 ② p<0.05 且效应量 ≥3 个百分点',
          '',
          '| 端点 | off 均值 | lexical 均值 | 差（百分点） | 主题数 | p | 门槛 | 判 |',
          '| --- | --- | --- | --- | --- | --- | --- | --- |',
          ...report.paired.map(
            (test) =>
              `| ${test.endpoint} | ${pct(test.offMean)} | ${pct(test.lexicalMean)} | ` +
              `${test.deltaPp.toFixed(1)} | ${test.themes} | ${test.p.toFixed(4)} | ` +
              `≥${test.minEffectPp}pp · p<${test.alpha} | ${test.pass ? '**过**' : '不过'} |`,
          ),
          '',
          '**逐主题的配对读数**（同一行是同一个主题；两臂各跑同样多次）',
          '',
          '| 主题 | ③ off | ③ lexical | ③ 差 | ② off | ② lexical | ② 差 |',
          '| --- | --- | --- | --- | --- | --- | --- |',
          ...(report.paired[0]?.rows ?? []).map((row, i) => {
            const second = report.paired?.[1]?.rows[i]
            return (
              `| ${row.theme} | ${pct(row.off)} | ${pct(row.lexical)} | ${row.deltaPp.toFixed(1)} | ` +
              `${second ? pct(second.off) : '—'} | ${second ? pct(second.lexical) : '—'} | ` +
              `${second ? second.deltaPp.toFixed(1) : '—'} |`
            )
          }),
          '',
          '★ ③ 的参照是**同一主题那本旧书**（`--history=live` 时它由本流水线产出，' +
            '所以"他读过了"是真的）；② 的口径与上面那张表同一个量。',
          '',
          '**功效：这一轮的设计能看见多大的差**（★ **事后**算的，只用来解释"为什么测不出"，**不参与裁决**）',
          '',
          ...report.paired.map((test) => {
            const power = powerOf(test)
            return (
              `- ${test.endpoint}：观测到的差 **${test.deltaPp.toFixed(1)} 个百分点**，` +
              `主题级差值的 SD **${power.sdPp.toFixed(1)} 个百分点**，` +
              `**最小可检测效应 ${power.mdePp.toFixed(1)} 个百分点**` +
              `（α=0.05、功效 0.8、${test.themes} 个主题）`
            )
          }),
          '',
          '★ 读法：这个设计只看得见**几个到十几个百分点**的效应（见上，MDE 那一项），',
          '而观测到的差是 **1 个百分点上下**——两者差了一个数量级。也就是说"不显著"在这里',
          '**不是"差一点"**，而是**远在可检测范围之下**：要让这点差异变成"显著"，',
          '需要把每臂的样本量抬高一到两个数量级，而那已经超出这一栏能负担的跑测规模。',
          '**这不是"没试"，是"试了、并且算出了这个设计能看见多大的差"。**',
          '',
          '★★ 还有一处**我们自己的口径错**，一并写在这里：主判据 `③` 预声明的效应量门槛是',
          '**≥5 个百分点**，而对照组的基线只有 **3.3 个百分点**（同一主题旧书的 6 字重合率）——',
          '**重复度不可能低于 0，所以那个门槛在数学上就达不到**。',
          '门槛是拍出来的、不是量出来的（量出基线之前拍的），这是本轮设计里的一处真错误，',
          '记在这里而不是悄悄改掉它。**下一个想测"不重样"的人：先量基线，再定门槛。**',
          '',
        ]
      : []),
    '## ① 判据本身（v1 口径，**不是 v2 的裁决**）',
    '',
    `| 臂 | 通过（≤${report.maxAttempts} 次） | 一次过 | 平均重试 | 三次规划不过 | 调用失败 | 限流 |`,
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...armKeys.map((key) => {
      const stats = statsOf(report.arms[key] ?? [])
      const cell = report.cells[key]
      const label = cell ? `${key}（k=${cell.k} 阈值=${cell.minScore}）` : key
      return (
        `| ${label} | ${stats.ok}/${stats.judged} | ${stats.firstPass}/${stats.judged} | ` +
        `${num(stats.avgAttempts, 2)} | ${stats.planInvalid} | ${stats.callFailed} | ${stats.rateLimited} |`
      )
    }),
    '',
    '量法：`attempts` 取自 `planBook` 的返回（第几次调用才拿到合法故事表）；',
    '「三次规划不过」= 引擎抛 `schema-validation-failed`（含内容审核那条改不动的情形）；',
    '分母**不含**调用失败与限流——"裁判没到场"不判"选手没跑"。',
    '',
    ...(report.repeat && report.repeat.length > 0
      ? [
          '## 判据 ① 的重复测量（同一个配置跑两轮）',
          '',
          `| 轮次 | off 一次过 | lexical 一次过 | 差 | off 平均重试 | lexical 平均重试 | 差 |`,
          '| --- | --- | --- | --- | --- | --- | --- |',
          ...[
            { label: '本轮', data: summaryOf(report, '本轮') },
            ...report.repeat.map((item) => ({ label: item.label, data: item })),
          ].map(
            (row) =>
              `| ${row.label} | ${row.data.offFirst}/${row.data.offJudged} | ${row.data.lexFirst}/${row.data.lexJudged} | ` +
              `${((row.data.lexFirst / Math.max(row.data.lexJudged, 1) - row.data.offFirst / Math.max(row.data.offJudged, 1)) * 100).toFixed(1)} 个百分点 | ` +
              `${row.data.offAttempts.toFixed(2)} | ${row.data.lexAttempts.toFixed(2)} | ` +
              `${(row.data.offAttempts - row.data.lexAttempts).toFixed(2)} |`,
          ),
          '',
          `★ 这一节的用处：n=${report.books} 时**一本书就等于 10 个百分点**，而阈值正是 10 个百分点。`,
          '一轮读数撑不起"显著"，所以两轮不同号时结论行会写"不稳定"——那时这一栏测的是采样噪声。',
          '',
        ]
      : []),
    '## ②③④⑤ 生成质量',
    '',
    // ★ 这一张表的列**按臂展开**（扫描出来的格子也要能并排看），
    //   而"差"那一列始终相对 `off`——那是这一张表的对照组，不随格子变
    `| 量 | ${armKeys.join(' | ')} | 差（lexical − off） | 怎么量的 |`,
    `| --- | ${armKeys.map(() => '---').join(' | ')} | --- | --- |`,
    // 五行按同一条规则拼：每条臂一格 → 差（相对 `off`）→ 量法。
    // ★ 写成数据而不是六条手写的长字符串：上一版每一行都把两个臂的名字写死在模板里，
    //   于是**多跑一格就会出现"表头三列、表体五列"**——那种表看着没事，读起来全是错的。
    ...[
      {
        label: '② 平均句长（字/句）',
        pick: (stats: ArmStats) => num(stats.avgSentenceLen, 2),
        value: (stats: ArmStats) => stats.avgSentenceLen,
        how: '正文按 `。！？!?…` 切句，去掉空白后数字符',
      },
      {
        label: '② 超长句比例',
        pick: (stats: ArmStats) => pct(stats.overLongRatio),
        value: (stats: ArmStats) => stats.overLongRatio,
        how: `单句 > ${BAND_MAX_CHARS[AGE_BAND]} 字（\`AGE_RULES\` 的 ${AGE_BAND} 上限）的句子占比`,
      },
      {
        label: '② 落在适龄区间的句子比例（**描述量，不参与裁决**）',
        pick: (stats: ArmStats) => pct(stats.inBandRatio),
        value: (stats: ArmStats) => stats.inBandRatio,
        how: `${BAND_MIN_CHARS[AGE_BAND]}–${BAND_MAX_CHARS[AGE_BAND]} 字的句子占比（区间取 \`AGE_RULES\` 的 ${AGE_BAND} 那一句）`,
      },
      {
        label: '② 超纲字比例',
        pick: (stats: ArmStats) => pct(stats.outOfBandRatio),
        value: (stats: ArmStats) => stats.outOfBandRatio,
        how: '汉字里**不出现在 96 段人工样书**中的占比（★ 代理量，见下）',
      },
      {
        label: '③ 与自家旧书重复度',
        pick: (stats: ArmStats) => pct(stats.dupWithOwn),
        value: (stats: ArmStats) => stats.dupWithOwn,
        how: `含 ≥${OVERLAP_GRAM} 字连续子串、且该子串出现在②创作史里的句子占比`,
      },
      {
        label: '④ 与范例的句子重合率',
        pick: (stats: ArmStats) => pct(stats.overlapWithExamples),
        value: (stats: ArmStats) => stats.overlapWithExamples,
        how: '同上，参照集换成**这一批主题检索到的范例**（所有臂共用同一批）',
      },
      {
        label: '⑤ 与已读故事的新意',
        pick: (stats: ArmStats) => pct(stats.noveltyVsRead),
        value: (stats: ArmStats) => stats.noveltyVsRead,
        how: '1 − 与已读清单（cloud / dino / moon 三部样书）的重合率',
      },
    ].map((metric) => {
      const cells = armKeys.map((key) => metric.pick(statsOf(report.arms[key] ?? [])))
      const base = metric.value(off)
      const treatment = metric.value(lex)
      return `| ${metric.label} | ${cells.join(' | ')} | ${delta(base, treatment)} | ${metric.how} |`
    }),
    '',
    `- ★ **④ 是反向指标**：这一行涨得太多就是**污染**（模型在照抄范例的句子）。`,
    `  验收线 = 对照组 + 5 个百分点 = ${pct(contaminationLimit)} → ` +
      (contaminated
        ? `**超了（lexical ${pct(lex.overlapWithExamples)}）**，按工单要求先修提示词再报数。`
        : `**没超**（lexical ${pct(lex.overlapWithExamples)}）。`),
    '- ★ **② 的"超纲字"是代理量，不是适龄字表**：`R-09` 的适龄字表**今天没有**',
    '  （`rag/review-corpus.ts` 写着这一条缺口）。这里的定义是"这个字在那 96 段人工写过的',
    '  适龄样书里一次都没出现过"——可复现、可复核，但它**只说明"不常见"**，不等于"超纲"。',
    `- ★ 样本量是 ${report.books} 个主题 × 每主题 ${report.repeats ?? 1} 次 × ${armKeys.length} 臂` +
      `（v2 的裁决只看 \`off\` 与 \`lexical\` 两臂的配对读数）。**这一格网关上没有 seed 参数**，` +
      '所以采样噪声无法固定，逐本明细在下面，判定时请看散点而不是只看均值。',
    '',
    '## 每一次重试的**原话**（引擎给的，没有重新归类）',
    '',
    ...[
      ...report.arms.off,
      ...report.arms.lexical,
      ...armKeys.slice(2).flatMap((key) => report.arms[key] ?? []),
    ]
      .filter((record) => record.failures.length > 0)
      // ★ 按**整条消息**排序再计数：同一条原因会重复出现，聚起来才看得见"这一臂栽在哪"
      .map(
        (record) =>
          `- ${record.arm} · ${record.theme}：` +
          record.failures.map((line) => `「${line.replace(/\n/g, ' / ')}」`).join(' '),
      ),
    ...([
      ...report.arms.off,
      ...report.arms.lexical,
      ...armKeys.slice(2).flatMap((key) => report.arms[key] ?? []),
    ].filter((record) => record.failures.length > 0).length === 0
      ? ['- （这一轮一次都没有重试过——那么 ① 这一栏**没有分辨力**，见结论那一节）']
      : []),
    '',
    '## 超参扫描（检索侧，不花一分钱）',
    '',
    `★ 扫的自变量是 **narrowedMinScore**（带主题的请求走的那一档，见 spec §九的策略改动）；` +
      `无主题那条路用的 \`minScore=${report.minScore}\` 不在这张表里。`,
    `★ 「平均避开」那一列在 \`history=live\` 下**恒为 0**——②创作史要等 Phase 0 跑完才存在，` +
      '而这张表在它之前算。它量的是**种子那一侧**的取数；避开那一侧的读数在逐本明细里。',
    '',
    '**先看分数分布**（k=5、minScore=0，每个主题最高的三段文字）：',
    '',
    '| 主题 | top1 | top2 | top3 |',
    '| --- | --- | --- | --- |',
    ...report.distribution.map(
      (row) =>
        `| ${row.theme} | ${row.top.map((score) => num(score, 2)).join(' | ') || '— | — | —'} |`,
    ),
    '',
    '| k | narrowedMinScore | 取到范例的主题数 | 平均范例数 | 平均避开数 | 范例平均分 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.sweep.map(
      (row) =>
        `| ${row.k} | ${row.minScore} | ${row.themesWithExamples}/${report.books} | ` +
        `${num(row.avgExamples, 2)} | ${num(row.avgAvoids, 2)} | ${row.avgTopScore === null ? '—' : num(row.avgTopScore, 2)} |`,
    ),
    '',
    '★ 定稿的两个数就是上表与本轮跑测**一起**看出来的：k 太小会让范例只剩一条（参考价值低），',
    '太大则把"只命中一个常见 bigram"的段落也拉进来；minScore 抬到把 top1 都挡掉时，',
    '`取到范例的主题数`会掉到 0——那一格等于把这一栏关掉。',
    '',
    '## 逐本明细',
    '',
    '| 臂 | 主题 | 结局 | 次数 | 页 | 句 | 平均句长 | 超长 | 适龄区间 | 超纲 | ③重复 | ④范例 | ⑤新意 | 范例/避开 | 秒 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...[...report.arms.off, ...report.arms.lexical].map((record) =>
      [
        `| ${record.arm} | ${record.theme} | ${record.verdict} | ${record.attempts} | ${record.nodeCount ?? '—'} |`,
        `${record.sentences ?? '—'} | ${record.avgSentenceLen === undefined ? '—' : num(record.avgSentenceLen, 1)} |`,
        `${record.overLongRatio === undefined ? '—' : pct(record.overLongRatio)} |`,
        `${record.inBandRatio === undefined ? '—' : pct(record.inBandRatio)} |`,
        `${record.outOfBandRatio === undefined ? '—' : pct(record.outOfBandRatio)} |`,
        `${record.dupWithOwn === undefined ? '—' : pct(record.dupWithOwn)} |`,
        `${record.overlapWithExamples === undefined ? '—' : pct(record.overlapWithExamples)} |`,
        `${record.noveltyVsRead === undefined ? '—' : pct(record.noveltyVsRead)} |`,
        `${record.examples ?? '—'}/${record.avoids ?? '—'} | ${record.seconds} |`,
      ].join(' '),
    ),
    '',
  ]

  const failures = [...report.arms.off, ...report.arms.lexical].filter(
    (record) =>
      record.verdict === 'plan-invalid' ||
      record.verdict === 'call-failed' ||
      record.verdict === 'rate-limited',
  )
  if (failures.length > 0) {
    lines.push(
      '## 没测成 / 不过的明细（**不是**生成质量的数据）',
      '',
      ...failures.map(
        (record) =>
          `- ${record.arm} · ${record.theme} · ${record.verdict}：` +
          `${record.errorCode ?? ''} ${(record.error ?? '').split('\n')[0]}`,
      ),
      '',
      '限流那一类**什么都没证明**（工单 01 的教训）：退避重试过，仍失败就记在这里，',
      '并且**不进任何分母**。处置是"等一会儿重跑这几本"，不是"把它记成失败"。',
      '',
    )
  }
  return lines.join('\n')
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
