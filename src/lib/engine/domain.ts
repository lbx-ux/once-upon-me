/**
 * domain.ts —— 引擎的领域类型：只有形状，没有行为
 *
 * ★ 这里出现的每一个字段，都必须能回答"谁读它"。答不上来的字段一律不进这个文件——
 *   一份没人读的数据结构会在角色卡这种长期资产上变成债（改不动、又删不掉）。
 *
 * 与 UI 的关系：本文件不许 import React / next（由 eslint 的 `no-restricted-imports`
 * 与 `tsconfig.engine.json` 的严格档共同把门）。验收方式是
 * `node scripts/engine-run.ts` 不启动浏览器跑完一本书。
 */

/* ───────────────────────────── 资产引用 ───────────────────────────── */

/**
 * 一份**已经落盘**的产物：图、音频、或者录下的事件流。
 *
 * ★ 为什么 `path` 与 `originUrl` 是两个字段而不是一个：
 *   供应商返回的媒体 URL 是带签名的临时地址，实测约 1 小时过期
 *   （`E:\compete\模型.md` §7）。把链接直接当资产用，症状是"当时看着好好的，
 *   第二天整本书的图全裂"。所以引擎里**只有 `path` 可以被引用**，
 *   `originUrl` 留着只为排障，且类型上就摆在那儿提醒读代码的人。
 */
export type AssetRef = {
  /** 相对仓库根的落盘路径，例如 `data/cards/xiaolu/ref.r7.f3a1c9.webp` */
  path: string
  /** 内容哈希（FNV-1a 12 位十六进制）。内容寻址：同图不重复存，改图必然换名 */
  digest: string
  bytes: number
  mime: string
  /** 供应商侧的临时地址，仅排障用，不许进渲染路径 */
  originUrl?: string
  /** 该临时地址的过期时刻（epoch ms）；未知就不填 */
  originExpiresAt?: number
}

/**
 * 每一张生成出来的资产都带出处。
 *
 * 这条是 ADR-0003 的落地：模型换代之后，旧资产**仍然是合法交付物**，
 * 但必须能说清它是哪一版模型、哪一版提示词、哪一版角色卡生成的。
 * 现成的先例是 `docs/cover-art-prompts.md` 逐张记提示词——那是手工版。
 */
export type Provenance = {
  /** 实际调用的模型 id。**一律来自环境变量**，代码里不写死（见 providers/registry.ts） */
  modelId: string
  /** 提示词版本，例如 `story-plan@v1`（见 lib/prompts/） */
  promptVersion: string
  /** 出自角色卡的第几版修订 */
  cardRevision: number
  generatedAt: number
}

/* ───────────────────────────── 孩子与角色卡 ───────────────────────────── */

/** 适龄档：决定词汇量、句长、故事复杂度（checklist #3 的验收就靠它分档） */
export const AGE_BANDS = ['4-', '4-6', '6-8', '8+'] as const
export type AgeBand = (typeof AGE_BANDS)[number]

/**
 * Step 1「孩子是谁」的输入。
 *
 * ★ 这里**不放照片**：照片是敏感素材，用完即删（隐私设计 §七），
 *   它的产物是角色卡，不是这里的字段。要留就留 `photoUsedAt` 这种事实，
 *   原图不进引擎、不进数据库、不进日志。
 */
export type ChildProfile = {
  childId: string
  /** 书名与朗读里用的称呼 */
  name: string
  /**
   * 读音确认（多音字）：叫"乐乐"是 lè 还是 yuè。
   * 产品定义 Step 1 的原话是"读错家长第一秒就发现"——所以它是必填，不是可选备注。
   */
  nameReading: string
  ageBand: AgeBand
  lookTags: readonly string[]
  interestTags: readonly string[]
}

/**
 * 锚点槽位。**每一项都必须跨页不变**——这是角色卡的定义，不是排版偏好。
 * 会随页变化的东西（姿势、表情、场景、光线）一律不许进这张表，
 * 它们属于画面 prompt 的页级部分。
 */
export const ANCHOR_SLOTS = ['bone', 'eyes', 'hair', 'build', 'skin', 'mark', 'wardrobe'] as const
export type AnchorSlot = (typeof ANCHOR_SLOTS)[number]

/** 槽位的中文名，只给人看（日志与角色卡编辑器 UI），不进 prompt */
export const ANCHOR_LABELS: Record<AnchorSlot, string> = {
  bone: '骨相',
  eyes: '眼睛',
  hair: '头发',
  build: '头身比',
  skin: '肤色',
  mark: '特征记号',
  wardrobe: '常服',
}

/**
 * 硬锚点 = 一致性判定必须逐条核对；软锚点 = 允许合理变化，出现矛盾才算失败。
 *
 * 为什么要分：把"常服"当硬锚点，孩子换衣服的那一页就会被判不合格，
 * 而它恰恰是家长最想要的变化；把"骨相"当软锚点，脸崩了还算通过。
 * 分档本身是产品判断，写在这里而不是散在校验代码里。
 */
export const ANCHOR_STRENGTH: Record<AnchorSlot, 'hard' | 'soft'> = {
  bone: 'hard',
  eyes: 'hard',
  hair: 'hard',
  build: 'hard',
  skin: 'hard',
  mark: 'soft',
  wardrobe: 'soft',
}

export type CharacterAnchor = {
  slot: AnchorSlot
  /** 中文描述，会被原样拼进画面 prompt 的"角色段" */
  value: string
}

/** 画风锁定（W3「画风模板锁定」的字段先在这儿占住） */
export type StyleLock = {
  /** 语义名，与 docs 里的画风一致：warm-handdrawn / watercolor / paper-cut … */
  key: string
  /** 进 prompt 的风格段 */
  promptFragment: string
  /** 出图比例。实测供应商支持的尺寸见 providers/tokenrhythm-image.ts 的白名单 */
  ratio: '3:2' | '3:4' | '1:1'
}

/**
 * 角色卡 —— 一个孩子的**可复用形象资产**（GLOSSARY「角色卡」）。
 *
 * "资产化"在这个文件里落成三件事，缺一件就只是"一段提示词"：
 * 1. **有 ID 与被引用**：`cardId` + `revision`，每一页的 provenance 指回它，
 *    而不是把锚点复制进 20 段 prompt。改一次，跨页/跨书/跨形态全变。
 * 2. **有版本与出处**：`revision` 递增 + 内容指纹 `digest`，
 *    于是"这一页是哪版卡画的"可查，旧资产在模型换代后仍可解释（ADR-0003）。
 * 3. **有生命周期**：卡属于某个 `childId`，删孩子时级联（隐私设计 §九），
 *    原始照片不进卡（`sourcePhoto` 只记"用过、已删"这个事实）。
 */
export type CharacterCard = {
  /** 卡的数据版本，与 revision 不同：revision 是内容修订，这个是**结构**修订 */
  schemaVersion: 1
  cardId: string
  childId: string
  revision: number
  anchors: readonly CharacterAnchor[]
  style: StyleLock
  /** 参考图：派生资产，长期保留（隐私设计 §七 那一行的实现处） */
  reference: AssetRef
  /** 生成本卡时用的模型与提示词版本；参考图换了就要重算 */
  provenance: Provenance
  createdAt: number
  /** 原始照片：只记事实，不存内容。删孩子的凭据要能说出"它存在过、已删" */
  sourcePhoto?: { usedAt: number; deletedAt: number }
}

/* ───────────────────────────── 故事：一棵树，两种形态 ───────────────────────────── */

/**
 * 形态（GLOSSARY「形态」）。
 *
 * ★ 代码里**只有一种故事结构**：一棵树。独读版 = 没有任何选择点的树。
 *   这不是偷懒，是"一个引擎、两种形态"那句主张的技术落点：
 *   如果两种形态各写一套结构与流程，产品就成了聚合，判据（去掉互动绘本仍成立）当场失效。
 */
export const BOOK_FORMS = ['solo', 'shared'] as const
export type BookForm = (typeof BOOK_FORMS)[number]

export const FORM_LABELS: Record<BookForm, string> = { solo: '独读版', shared: '共读版' }

/** 情绪标签：喂给配音的语气与画面 prompt，不给人看 */
export const MOODS = ['calm', 'wonder', 'joy', 'tense', 'tender', 'proud'] as const
export type Mood = (typeof MOODS)[number]

/**
 * 故事树的一个节点 = 书的一页。
 *
 * 四个字段（场景 / 正文 / 画面 prompt / 情绪）是 §9.2 判据 1 里"每页 4 字段"的那四个，
 * 横评测的就是它们的 Schema 通过率。树形字段（`next` / `choice`）是共读版多出来的。
 */
export type StoryNode = {
  /** 稳定 ID，路径与"走过的路"都靠它，不用下标（分支一改下标全乱） */
  nodeId: string
  /** 主干页号，仅用于"第 N 页"这类人话显示；树里的真实位置看 `pathFromRoot` */
  pageNo: number
  /** 场景描述：给插画与审核看的，不印在页上 */
  scene: string
  /** 正文，一句一段（叠在图上的真 HTML 文字，绝不画进图里——中文进图必错字） */
  body: readonly string[]
  /** 画面 prompt 的**页级**部分；角色段由卡派生，不在此重复 */
  imagePrompt: string
  mood: Mood
  /** 选择点：有它就是共读版的分支节点，两个选项（孩子不识字，两个已经够） */
  choice?: StoryChoice
  /**
   * 子节点 ID。独读版 0 或 1 个；共读版的选择点恰好 2 个，
   * 顺序与 `choice.options` 一一对应（tree.ts 按 via=a/b 排过）。
   */
  next: readonly string[]
  /** 从根到本节点的路径，用于"上次你走的是这条路" */
  pathFromRoot: readonly string[]
}

export type StoryChoice = {
  /** 引导性提问 —— 把"看故事"变成"聊故事"的那一句（产品定义 §三） */
  prompt: string
  options: readonly [ChoiceOption, ChoiceOption]
}

export type ChoiceOption = {
  /** 图标语义名，落盘为 `choice-{key}.webp`；图没到位时露出 emoji 兜底 */
  iconKey: string
  emoji: string
  /** 选项文字，同时走语音朗读（图 + 语音双通道） */
  label: string
  /** 朗读用的更口语的一句：label 给眼睛看，spoken 给耳朵听 */
  spoken: string
}

export type StoryTree = {
  form: BookForm
  title: string
  rootId: string
  /** 扁平表 + ID 引用，不做嵌套：嵌套结构在"跳到第 7 页"与级联删除上都是坑 */
  nodes: readonly StoryNode[]
}

/* ───────────────────────────── 生成产物 ───────────────────────────── */

/** 一致性判定结果。★ `verdict` 与 `score` 是两件事，不许合并（见下） */
export type ConsistencyResult = {
  pageNo: number
  attempt: number
  /** 0–1。由视觉模型给出 */
  score: number | null
  /** 通过 / 不通过 / 判不了（视觉模型未配置或调用失败） */
  verdict: 'pass' | 'fail' | 'unavailable'
  threshold: number
  /** 逐锚点核对的结论，给人看的那句"哪一撮头发不对" */
  missedAnchors: readonly AnchorSlot[]
  reason?: string
}

export type Illustration = {
  pageNo: number
  attempt: number
  asset: AssetRef
  provenance: Provenance
  /** 供应商回传的实付金额（元）。实测图像一口价 0.20 元/张，与尺寸无关 */
  costCny?: number
  consistency?: ConsistencyResult
  /** 用尽重画次数仍不达标 → 标记人工介入（降级 B 的入口），而不是整本书失败 */
  needsHumanReview: boolean
}

export type Narration = {
  pageNo: number
  voiceId: string
  /** 正文哈希：`(voiceId, textHash)` 是去重键，树里共享的主干页因此只合成一次 */
  textHash: string
  asset: AssetRef
  durationMs?: number
}

/** 一本书 = 一堆资产 + 一份清单。★ 它是资产，不是一次调用（ADR-0003） */
export type Book = {
  bookId: string
  cardId: string
  cardRevision: number
  form: BookForm
  tree: StoryTree
  illustrations: readonly Illustration[]
  narrations: readonly Narration[]
  createdAt: number
  /** 端到端统计：#14「记录真实耗时与成本」的数据源，跑一次就有一份 */
  stats: BookStats
}

export type BookStats = {
  elapsedMs: number
  imageCalls: number
  /** 首次通过 / 重画后通过 —— §10.1 公式里的 r_redraw 直接从这里算 */
  firstPassCount: number
  redrawCount: number
  totalCostCny: number
  nodesPlanned: number
  nodesGenerated: number
}
