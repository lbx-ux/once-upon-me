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
  /**
   * 家长「再画一版」时写下的那句话（工单 03）。
   *
   * ★ 它属于 provenance 而不属于 anchors：那句话是**怎么变成这一版的**，
   *   不是"他长什么样"的判据。锚点仍然逐条在 `anchors` 里，那个不变式不许破。
   * ★ 有它，版本历史才说得出"第 2 版和 1 版差在哪"；没有它，历史就只剩一串
   *   时间戳，家长切回去也不知道自己在切什么。
   */
  suggestion?: string
}

/* ───────────────────────────── 孩子与角色卡 ───────────────────────────── */

/** 适龄档：决定词汇量、句长、故事复杂度（checklist #3 的验收就靠它分档） */
export const AGE_BANDS = ['4-', '4-6', '6-8', '8+'] as const
export type AgeBand = (typeof AGE_BANDS)[number]

/**
 * 年龄档给家长看的话。
 *
 * ★ 它放在这里，是因为原来它**只活在创作流的芯片里**（`band === '4-' ? '不到 4 岁' : …`），
 *   于是任何别的地方要显示年龄，只有两条路：抄一份（迟早漂），或者显示 `4-6`——
 *   一个家长没填过、也读不顺的字符串。工单 03 的形象页与卡片墙都要显示年龄，
 *   所以它上提到领域层：**四档的说法人只有一份**。
 * ★ 与 `ageLabelOf`（prompts/character-sheet.ts）不是一回事：那个产出的是**给模型的词**
 *   （"四五岁左右"），它的措辞是为了让模型画对年龄，不是为了给人读。
 */
export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  '4-': '不到 4 岁',
  '4-6': '4-6 岁',
  '6-8': '6-8 岁',
  '8+': '8 岁以上',
}

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
export const ANCHOR_SLOTS = [
  'bone',
  'eyes',
  'hair',
  'build',
  'skin',
  'mark',
  'wardrobe',
  /**
   * ★ 第八格（2026-10-16，用户："这应该有一个补充，家长可以对孩子的外貌再进行补充"）。
   *
   * 加它的时候**没有新造第二套机制**：补充就是一条锚点，只是槽位是"别的"。
   * 于是它自动跟着现有的每一条路走——归一化的顺序、卡上的存储、`promptFragmentOf`
   * 拼出的角色段、每一页的画面 prompt、指纹——一处都不用另写。
   *
   * ★ 它是**软锚点**（见 `ANCHOR_STRENGTH`），所以：
   *   - 空着**完全合法**：`normalizeAnchors` 丢空值、`checkAnchors` 只报硬锚点的空值、
   *     `REQUIRED_SLOTS` 里没有它——**已建好的七格卡一张都不会因此失效**；
   *   - 预填值是**空的**（见 `default-anchors.ts`）：补充是家长自己加的东西，
   *     给一个示例值等于往每张新卡里塞一条没人写过的特征。
   *
   * ★ 它排在**最后**：槽位声明序就是 prompt 里角色段的顺序、也是表单里格子的顺序。
   *   表单那边有一条按位置写的 CSS（最后两格独占一行，见 `new-child.css`），
   *   那条注释当时就提醒过"往里加槽位时先回头看一眼"——这一刀照做了。
   */
  'extra',
] as const
export type AnchorSlot = (typeof ANCHOR_SLOTS)[number]

/** 槽位的中文名（角色卡编辑器 UI 与画面 prompt 的角色段都用它） */
export const ANCHOR_LABELS: Record<AnchorSlot, string> = {
  bone: '骨相',
  eyes: '眼睛',
  hair: '头发',
  build: '头身比',
  skin: '肤色',
  mark: '特征记号',
  wardrobe: '常服',
  /** 家长自己写的那些"别的"（见 `ANCHOR_SLOTS` 里那一段） */
  extra: '补充',
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
  /** 补充是家长自己加的东西，**空着是常态**——它绝不能是硬锚点（见 `ANCHOR_SLOTS`） */
  extra: 'soft',
}

export type CharacterAnchor = {
  slot: AnchorSlot
  /** 中文描述，会被原样拼进画面 prompt 的"角色段" */
  value: string
}

/**
 * **从照片能读出来的槽位**：`ANCHOR_SLOTS` 去掉 `extra`（补充）。
 *
 * ★ 2026-10-16 加第八格时顺手立了这一条，理由是那一刀踩到的**同一个坑**：
 *   "读照片"与"表单"两边各写一份槽位表，于是第八格一加进来，
 *   读照片那条路就去读一个**不该它读**的格子（提示词里"要读的槽位"列了八个、
 *   而 JSON 范例只有七个，模型只能自己猜），而界面那边又会把"补充没读出来"
 *   报给家长——可它本来就没人去读。
 * ★ 为什么补充**不该**被读：它是**家长自己写的那一句**（用户原话："家长可以对孩子的
 *   外貌再进行补充"）。让模型去填它，等于把"家长补一句"变成"模型猜一句"，
 *   而这一格的存在意义恰恰是"系统没覆盖到的地方由人来补"。
 * ★ 判据只有一处（这里），读照片适配器与 `/character/new` 那一屏都从这里取。
 */
export const READ_SLOTS: readonly AnchorSlot[] = ANCHOR_SLOTS.filter((slot) => slot !== 'extra')

/**
 * 外貌标签（工单 03 第二刀从 `creation/fields.tsx` 搬到这里，2026-10-15）。
 *
 * ★ 它为什么是**领域词汇**而不是界面选项：`childWordOf`（`creation/state.ts`）
 *   拿这几个词推断称呼，而那个称呼会进 prompt 决定模型画男孩还是女孩——
 *   也就是说这几个字符串**已经**是领域规则的一部分，只是住在界面那一层。
 *   搬过来的直接理由：视觉模型读照片之后要给"看出来哪些标签"，
 *   而**判据得与表单是同一份**（各写一份的坏法是"模型说短发、表单里没有短发这个选项"）。
 * ★ 别随手加语义不清的：`childWordOf` 靠 马尾/辫子/裙子/短发/球衣 这几个词分档。
 */
export const LOOK_TAGS = [
  '短发',
  '圆脸',
  '爱笑',
  '戴眼镜',
  '马尾',
  '小酒窝',
  '高个',
  '瘦小',
] as const

/** 兴趣标签。只在表单与故事里用，不进 prompt 的角色段——放在这里是为了与外貌标签同一处 */
export const INTEREST_TAGS = ['恐龙', '画画', '足球', '小猫', '太空', '云', '船', '音乐'] as const

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

/**
 * 封面：**一次单独的出图**，3:4 竖版（`COVER_IMAGE_SIZE`）。
 *
 * ★ 它不是"从某一页里挑一张"。任何一页的跨页图都答不了"这本书讲谁"：
 *   页图的构图是"这一页在发生什么"，而且左下角按约定留给正文。
 *   封面要能在没有上下文的时候独立认人——这是它的唯一职责。
 *
 * ★ 它**不进** `illustrations`：那个数组的每一项都带一致性判定与重画次数，
 *   而封面的判据不是"像不像上一页"（它没有上一页）。硬塞进去会让
 *   `stats.firstPassCount` / `redrawCount` 的分母多出一个语义不同的东西。
 */
export type Cover = {
  asset: AssetRef
  provenance: Provenance
  costCny?: number
}

/** 一本书 = 一堆资产 + 一份清单。★ 它是资产，不是一次调用（ADR-0003） */
/**
 * 一页的硬失败：这一页**没有图**（出图调用抛错、用尽重画后仍无资产…）。
 *
 * ★ 它与"未核对"是两件事，**不许并成一个数**：
 *   - 有图 + 未核对 → `Illustration.consistency.verdict === 'unavailable'`
 *     （比对没配或没跑成；降级 B 的入口，图是好的）
 *   - 没有图 → 这个类型
 *   实测踩过一次：比对调用 504 时异常冒出去，把**已经画完、已经付过钱的图**
 *   一起从书里丢掉，汇总行还写着"2/5 页有图"。见 `illustrate.ts` 里的那段注释。
 */
export type PageFailure = { pageNo: number; message: string }

export type Book = {
  bookId: string
  cardId: string
  cardRevision: number
  form: BookForm
  tree: StoryTree
  /**
   * 封面。**可选是为了读旧书**：仓库里那本预生成演示书（`public/demo/books/`）
   * 是在有封面这个字段之前出的，它的 `book.json` 里没有这一项。
   * 阅读器遇到没有封面的书要**照实少显示一面**，不许拿第一页冒充封面。
   */
  cover?: Cover
  illustrations: readonly Illustration[]
  /**
   * 硬失败页。`illustrateAll` 的注释早就写了"书要标'这一页缺'"，
   * 但这个字段一直到 2026-10-13 才补上——在那之前这些失败只在事件流里闪一下，
   * 书本身看不出来（`summary.json` 里也没有）。
   */
  errors: readonly PageFailure[]
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
