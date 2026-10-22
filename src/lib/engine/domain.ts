/**
 * domain.ts —— 引擎的领域类型：只有形状，没有行为。
 *
 * 这里出现的每一个字段，都必须能回答"谁读它"。答不上来的字段一律不进这个文件——
 * 一份没人读的数据结构会在角色卡这种长期资产上变成债（改不动、又删不掉）。
 *
 * 本文件不许 import React / next（eslint 的 `no-restricted-imports` 与
 * `tsconfig.engine.json` 的严格档一起把门），验收方式是 `node scripts/engine-run.ts`
 * 不启动浏览器跑完一本书。
 */

/* 资产引用 */

/**
 * 一份已经落盘的产物：图、音频、或者录下的事件流。
 *
 * `path` 与 `originUrl` 是两个字段而不是一个：供应商返回的媒体 URL 是带签名的临时地址，
 * 实测约 1 小时过期（`E:\compete\模型.md` §7），直接当资产用，症状是"当时看着好好的，
 * 第二天整本书的图全裂"。所以引擎里只有 `path` 可以被引用，`originUrl` 只为排障留着，
 * 摆在类型里提醒读代码的人。
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
 * 这条是 ADR-0003 的落地：模型换代之后，旧资产仍然是合法交付物，
 * 但必须能说清它是哪一版模型、哪一版提示词、哪一版角色卡生成的。
 * 现成的先例是 `docs/cover-art-prompts.md` 逐张记提示词——那是手工版。
 */
export type Provenance = {
  /** 实际调用的模型 id。一律来自环境变量，代码里不写死（见 providers/registry.ts） */
  modelId: string
  /** 提示词版本，例如 `story-plan@v1`（见 lib/prompts/） */
  promptVersion: string
  /** 出自角色卡的第几版修订 */
  cardRevision: number
  generatedAt: number
  /**
   * 家长「再画一版」时写下的那句话（工单 03）。
   *
   * 它属于 provenance 而不属于 anchors：那句话是"怎么变成这一版的"，不是"他长什么样"
   * 的判据——锚点仍然逐条在 `anchors` 里，那个不变式不许破。有它，版本历史才说得出
   * "第 2 版和 1 版差在哪"；没有它，历史只剩一串时间戳，家长切回去也不知道在切什么。
   */
  suggestion?: string
}

/* 检索的出处 */

/**
 * 一条被取到的旧文本（2026-10-19，`.scratch/rag`）。
 *
 * 只留够回答"这本书为什么长这样"的四个字段：哪一条、什么出处、多相关、是正例还是反例。
 * 不留正文本身——它在语料里查得到，抄进 provenance 等于把 12 本样书的片段散进每一本书。
 */
export type RetrievedChunkRef = {
  /** `library/cloud#s2` 或 `u/12/books/bk_x#p7`，owner 前缀在这里也看得见 */
  chunkId: string
  /** 给人的出处：`样书《…》第 3 跨页 · 风来了` */
  source: string
  score: number
  /** 正例（照着节奏写）/ 反例（他读过了，避开） */
  polarity: 'example' | 'avoid'
}

/**
 * 「这一版故事是看着哪些旧文本写出来的」。
 *
 * `corpusVersion` 是 `null` 与不是 `null` 是两件事：`null` = 这一轮没检索成（索引读不到、
 * 检索抛错），书照常编出来了；有值 = 检索确实跑了，用的是那一版语料。
 * 两者都不许被写成"检索过了但没取到"——后者是 `hits: []`，它是有信息量的（新主题、
 * 头一本书），而前者是"这一步没发生"。
 */
export type RetrievalProvenance = {
  corpusVersion: string | null
  /** 取到几条正例 / 反例（= `hits` 里两类的条数，放在这里免得读的人自己数） */
  examples: number
  avoids: number
  /** 最高分。`null` = 一条都没取到 */
  topScore: number | null
  hits: readonly RetrievedChunkRef[]
}

/* 孩子与角色卡 */

/**
 * 适龄档：决定词汇量、句长、故事复杂度（`AGE_RULES` 按它分档）。
 *
 * 2026-10-19 改过口径：这里原来写着「checklist #3 的验收就靠它分档」，把分档说成了检索。
 * 检索是另一条路（`rag/`：bigram + BM25 取旧文本），落点也不同——这一档进提示词的
 * 语言规则，检索进范例那一段。两者有一处真关系：语料的年龄档过滤
 * （`rag/retrieve.ts` 的 `bandAdmits`）用的就是它，`example` 那一侧收同档与相邻一档。
 */
export const AGE_BANDS = ['4-', '4-6', '6-8', '8+'] as const
export type AgeBand = (typeof AGE_BANDS)[number]

/**
 * 年龄档给家长看的话。
 *
 * 它上提到这里，是因为原来只活在创作流的芯片里（`band === '4-' ? '不到 4 岁' : …`），
 * 于是别处要显示年龄只有两条路：抄一份（迟早漂），或者显示 `4-6`——一个家长没填过、
 * 也读不顺的字符串。形象页与卡片墙都要显示年龄，四档的说法人留一份。
 *
 * 与 `ageLabelOf`（prompts/character-sheet.ts）不是一回事：那个产出的是给模型的词
 * （"四五岁左右"），措辞是为了让模型画对年龄，不是给人读。
 */
export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  '4-': '不到 4 岁',
  '4-6': '4-6 岁',
  '6-8': '6-8 岁',
  '8+': '8 岁以上',
}

/**
 * 性别。它在这个产品里只做一件事：决定标准像提示词里的那个称呼（小男孩 / 小女孩），
 * 而那一个词直接决定模型画男孩还是画女孩。
 *
 * 2026-10-16 才加（第 23 刀，用户："角色在增加一个选择性别的功能，这样前端生成的图片
 * 更加准确"）。那个词原来是从外貌标签推的（`childWordOf`：马尾/辫子/裙子 → 小女孩），
 * 而两组标签的控件在同一天被删掉了（用户："上面两行要填的，和下面的差不多"）。
 * 控件一没，那条推断就基本推不出东西，性别只能靠锚点里"头发长短"去猜——那是这一格
 * 该由人回答的问题。
 *
 * ★ 只有两档，没有"其他/不确定"："不选"本身就是那一档（`gender` 缺省 = 没选，退回按
 * 标签推、再推不出就用中性的"孩子"）。加一个"其他"会把一个必须落地成一个词的选择
 * 变成一句声明，而 prompt 那边消费不了它。
 */
export const GENDERS = ['boy', 'girl'] as const
export type Gender = (typeof GENDERS)[number]

export const GENDER_LABELS: Record<Gender, string> = {
  boy: '男孩',
  girl: '女孩',
}

/** 三个读者共用它：请求体、磁盘上读回来的记录、以及界面 */
export function isGender(value: unknown): value is Gender {
  return typeof value === 'string' && (GENDERS as readonly string[]).includes(value)
}

/**
 * 称呼：先看用户选的那一档性别，没选才回头由外貌标签推；都推不出就用中性词，不猜
 * （猜错会让出一张画错性别的标准像，或者让一本书里换性别）。
 *
 * 2026-10-16 从 `creation/state.ts` 搬到这里，起因是一条用户报障："我提供给你的是男孩子，
 * 怎么生成出来有男孩有女孩子"。查下来：这个称呼只进了标准像（`character-sheet.ts` 的
 * `childWord`），逐页的 prompt 里一个字都没有——`promptFragmentOf(card)` 只拼锚点文本，
 * 而那张卡的锚点（脸圆润/眼圆黑/黑直短发/头戴鸭舌帽…）里也没有一个性别词。于是每一页
 * 都由模型自己猜，同一个孩子在 8 页里画成了男孩也画成了女孩。
 *
 * 它必须能被引擎调用（逐页 prompt 是引擎拼的），而引擎不许 import `lib/creation/**`——
 * 这个词与它的两个输入（`Gender` / 外貌标签）本来就是领域概念，所以家在这里，
 * `creation/state.ts` 仍然 re-export（界面那几处不必改）。
 *
 * 优先级只有这一处：选的性别 > 标签推出来的 > 孩子。
 */
export function childWordOf(lookTags: readonly string[], gender?: Gender): string {
  if (gender === 'girl') return '小女孩'
  if (gender === 'boy') return '小男孩'
  const joined = lookTags.join('')
  if (/马尾|辫子|裙子/.test(joined)) return '小女孩'
  if (/短发|球衣/.test(joined)) return '小男孩'
  return '孩子'
}

/**
 * Step 1「孩子是谁」的输入。
 *
 * 这里不放照片：照片是敏感素材，用完即删（隐私设计 §七），它的产物是角色卡，不是这里的
 * 字段。要留就留 `photoUsedAt` 这种事实，原图不进引擎、不进数据库、不进日志。
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
  /**
   * 性别（2026-10-16 第 23 刀）。可选：随仓库发布的示例档案、以及这一天之前建好的孩子
   * 都没有这一栏，而"没填"是一个合法状态——那时退回按外貌标签推。
   */
  gender?: Gender
  lookTags: readonly string[]
  interestTags: readonly string[]
}

/**
 * 锚点槽位。每一项都必须跨页不变——这是角色卡的定义，不是排版偏好。
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
   * 第八格（2026-10-16，用户："这应该有一个补充，家长可以对孩子的外貌再进行补充"）。
   *
   * 加它没有新造第二套机制：补充就是一条锚点，只是槽位是"别的"。于是它自动跟着现有的
   * 每一条路走——归一化顺序、卡上的存储、`promptFragmentOf` 拼出的角色段、每页的画面
   * prompt、指纹——一处都不用另写。
   *
   * 它是软锚点（见 `ANCHOR_STRENGTH`），所以空着完全合法：`normalizeAnchors` 丢空值、
   * `checkAnchors` 只报硬锚点的空值、`REQUIRED_SLOTS` 里没有它，已建好的七格卡一张都
   * 不会失效。预填值也是空的（见 `default-anchors.ts`）——补充是家长自己加的东西，
   * 给一个示例值等于往每张新卡里塞一条没人写过的特征。
   *
   * 它排在最后：槽位声明序就是 prompt 里角色段的顺序、也是表单里格子的顺序，而表单那边
   * 有一条按位置写的 CSS（最后两格独占一行，见 `new-child.css`）。
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
  /** 补充是家长自己加的东西，空着是常态——它绝不能是硬锚点（见 `ANCHOR_SLOTS`） */
  extra: 'soft',
}

export type CharacterAnchor = {
  slot: AnchorSlot
  /** 中文描述，会被原样拼进画面 prompt 的"角色段" */
  value: string
}

/**
 * 从照片能读出来的槽位：`ANCHOR_SLOTS` 去掉 `extra`（补充）。
 *
 * 2026-10-16 加第八格时顺手立的。踩到的坑是"读照片"与"表单"两边各写一份槽位表：
 * 第八格一加进来，读照片那条路就去读一个不该它读的格子（提示词里"要读的槽位"列了八个、
 * JSON 范例只有七个，模型只能自己猜），界面那边又会把"补充没读出来"报给家长——
 * 可它本来就没人去读。
 *
 * 补充不该被读，是因为它是家长自己写的那一句（用户原话："家长可以对孩子的外貌再进行
 * 补充"）。让模型去填等于把"家长补一句"变成"模型猜一句"，而这一格的意义恰恰是
 * "系统没覆盖到的地方由人来补"。
 *
 * 判据只有一处（这里），读照片适配器与 `/character/new` 那一屏都从这里取。
 */
export const READ_SLOTS: readonly AnchorSlot[] = ANCHOR_SLOTS.filter((slot) => slot !== 'extra')

/**
 * 外貌标签（工单 03 第二刀从 `creation/fields.tsx` 搬到这里，2026-10-15）。
 *
 * 它为什么是领域词汇而不是界面选项：`childWordOf`（`creation/state.ts`）拿这几个词推断
 * 称呼，而那个称呼会进 prompt 决定模型画男孩还是女孩——这几个字符串已经是领域规则的
 * 一部分，只是原先住在界面那一层。搬过来的直接理由：视觉模型读照片之后要给"看出来
 * 哪些标签"，判据得与表单是同一份（各写一份的坏法是"模型说短发、表单里没有短发这个选项"）。
 *
 * 别随手加语义不清的：`childWordOf` 靠 马尾/辫子/裙子/短发/球衣 这几个词分档。
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
  /** 出图比例。实测供应商支持的尺寸见 providers/qwen-image.ts 的白名单 */
  ratio: '3:2' | '3:4' | '1:1'
}

/**
 * 角色卡 —— 一个孩子的可复用形象资产（GLOSSARY「角色卡」）。
 *
 * "资产化"在这个文件里落成三件事，缺一件就只是"一段提示词"：
 * 1. 有 ID 与被引用：`cardId` + `revision`，每页的 provenance 指回它，而不是把锚点复制进
 *    20 段 prompt。改一次，跨页/跨书/跨形态全变。
 * 2. 有版本与出处：`revision` 递增 + 内容指纹 `digest`，于是"这一页是哪版卡画的"可查，
 *    旧资产在模型换代后仍可解释（ADR-0003）。
 * 3. 有生命周期：卡属于某个 `childId`，删孩子时级联（隐私设计 §九），原始照片不进卡
 *    （`sourcePhoto` 只记"用过、已删"这个事实）。
 */
export type CharacterCard = {
  /** 卡的数据版本，与 revision 不同：revision 是内容修订，这个是结构修订 */
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

/* 故事：一棵树，两种形态 */

/**
 * 形态（GLOSSARY「形态」）。
 *
 * 代码里只有一种故事结构：一棵树，独读版 = 没有任何选择点的树。这不是偷懒，是"一个引擎、
 * 两种形态"那句主张的技术落点：两种形态各写一套结构与流程，产品就成了聚合，
 * 判据（去掉互动绘本仍成立）当场失效。
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
  /** 画面 prompt 的页级部分；角色段由卡派生，不在此重复 */
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

/**
 * 盘上有图的那几个图标 key（2026-10-18，共读版）。
 *
 * 它是美术清单，不是枚举校验——这个区别是钱决定的：`planStory` 的重试是整篇重写
 * （`plan.ts` 循环重发同一个 prompt），让一个装饰性字段（图标名）不合枚举去触发整本故事
 * 重新生成，是拿这条流水线上最贵的动作换最便宜的东西。而 `schemas/schema.ts` 的
 * `withDefault` 本来就是宽容的（`result.ok ? result : ok(fallback)`），于是今天的形状
 * 天然是"对得上就用图、对不上露 emoji"——与首页那两枚云图、第三屏那 5 张插画同一个机制。
 *
 * 词表只写一处，两个消费者都从这里取：提示词把它列给模型看（`story-plan.ts` 的 `{icons}`），
 * 界面把它当"哪个 key 有图"的判据（`lib/choice-icons.ts`）。各写一份的症状是"模型挑了一个
 * 界面不认得的 key"，而两边都觉得自己是对的。
 *
 * 前两个（`dino` / `ship`）已经有图，是首页第二屏那本演示书的两枚
 * （`public/book/choice-dino.webp` / `choice-ship.webp`），其余按
 * `docs/choice-icon-prompts.md` 出。
 *
 * 挑词表的三条口径都是判据，不是审美：
 * 1. 每枚都要能当任一侧的选项——不要"上/下""左/右"这类方向词。一条岔路是
 *    "恐龙背 vs 船肚子"，不是"左边 vs 右边"。
 * 2. 一枚一个物件，不画场景、不画人物。它在按钮里只有 56px 见方（`.book-choice__icon`，
 *    `reader/reader-book.css`；2026-10-18 从代码量出来的。这里原来写 96–120px，
 *    那是更早一版按钮的尺寸，按它去挑细节会挑多了）。
 * 3. 与绘本同一支笔（水彩 + 彩铅收形）。emoji 是扁平 clip-art，与水彩是两套画法，
 *    这正是"不许只放 emoji"的判据。
 *
 * 排在前面的"孩子最常想去的那些地方与东西"：车船飞行器、动物、天体、家与路。
 * 加一枚就是多一张图要出，不要为了凑整齐往里塞同义词（`ship` 与 `boat` 是一件事）。
 */
export const CHOICE_ICONS = [
  'dino', // 已有图（首页演示书）
  'ship', // 已有图（首页演示书）
  'rocket',
  'bird',
  'cat',
  'fish',
  'moon',
  'star',
  'tree',
  'house',
  'cloud',
  'door',
  'bridge',
  'lamp',
  'flower',
  'car',
  'kite',
  'balloon',
  'cake',
  'drum',
] as const
export type ChoiceIcon = (typeof CHOICE_ICONS)[number]

/**
 * 这个 key 盘上有没有图。只有这一个判据——界面据此决定是出图还是露 emoji。
 *
 * 收 `string` 而不是 `ChoiceIcon`：值是模型写的，可以是词表之外的任何东西
 * （`'dinosaur-back'`、`'恐龙背'`）。收窄会把"模型没照词表挑"从一个正常情况变成类型
 * 错误，于是调用方要写断言，而断言在那里唯一的作用就是把一个可能的错值说成不可能。
 */
export function hasChoiceIcon(key: string): key is ChoiceIcon {
  return (CHOICE_ICONS as readonly string[]).includes(key)
}

/**
 * 那 20 个 key 各叫什么（中文）。给闸门那一屏的下拉框用。
 *
 * 2026-10-18 用户原话：「这个选项都是英文，换成中文，避免一些家长不知道」。在那之前
 * 下拉框里列的就是 `dino` / `ship` / `kite` 这一串 key——它是盘上的文件名，不是给家长
 * 看的字。
 *
 * 表放在引擎这一层，是因为它与 `CHOICE_ICONS` 是同一件事的两面（键与名），两个文件的
 * 坏法是"加了新 key 却没人给它起名，下拉框里那一项空白"。放在一起，`domain.test.ts`
 * 一条 `every(hasLabel)` 就把它钉死了。与 `NARRATION_PART_LABELS` / `MOODS` 同一做法：
 * 这不是业务逻辑，但它是判据的一部分——名字缺一个，界面上就是一行空白。
 *
 * 值里不带 emoji：emoji 是另一个真字段（`ChoiceOption.emoji`，模型写、家长能改），它在
 * 下拉框左边单独一格摆着（`.ss__glyph`）。名字里再塞一个，屏幕上会出现两个不一样的
 * emoji 并排，而那会让人以为自己改坏了什么。
 */
export const CHOICE_ICON_LABELS: Record<ChoiceIcon, string> = {
  dino: '恐龙',
  ship: '帆船',
  rocket: '火箭',
  bird: '小鸟',
  cat: '小猫',
  fish: '小鱼',
  moon: '月亮',
  star: '星星',
  tree: '大树',
  house: '房子',
  cloud: '云朵',
  door: '门',
  bridge: '桥',
  lamp: '台灯',
  flower: '花',
  car: '小汽车',
  kite: '风筝',
  balloon: '气球',
  cake: '蛋糕',
  drum: '小鼓',
}

export type StoryTree = {
  form: BookForm
  title: string
  rootId: string
  /** 扁平表 + ID 引用，不做嵌套：嵌套结构在"跳到第 7 页"与级联删除上都是坑 */
  nodes: readonly StoryNode[]
}

/* 生成产物 */

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

/**
 * 画面审核的结论（2026-10-19，`.scratch/safety` 工单 01）。
 *
 * 它与 `ConsistencyResult` 的 `verdict` 同名同义（`pass` / `flag` / `unavailable`），
 * 但判据完全不同，所以它是另一个类型而不是给它加一个 `kind` 字段：一致性是一个 0–1 的
 * 分对一个阈值，可复现，算得上一道判据；画面审核是一个视觉模型的"看见/没看见"，
 * 不可复现，所以它是兜底。塞进一个类型，下一个人会以为它们可以共用一个阈值。
 * 因此这里也没有分数：画面这一档只有"有/没有"，编一个 0.8 出来只会让人以为它可以校准。
 *
 * `problems` 里的 `clauseId` 是真的条款 id（`R-01`…，与文字面那道闸同一份语料），所以
 * "这一页是哪一条没过"在 `book.json` 里查得到。类别与处置不记在这里——它们是条款库的
 * 属性，抄一份进清单就是第二个真相来源。
 */
export type PictureReviewResult = {
  pageNo: number
  attempt: number
  /** 通过 / 有发现（这一版不该出去）/ 没审成（视觉模型未配置或这一次调用失败） */
  verdict: 'pass' | 'flag' | 'unavailable'
  /** 命中的条款与"画面上在哪儿"。★ `pass` 时是空数组；`unavailable` 时必然是空的
   *  （没审成 != 审了没问题，这两件事由 `verdict` 分开，不靠这个数组的长短去猜）
   */
  problems: readonly { clauseId: string; where: string }[]
  reason?: string
}

export type Illustration = {
  pageNo: number
  attempt: number
  asset: AssetRef
  provenance: Provenance
  /** 供应商回传的实付金额（元）。★ 2026-10-21 换家之后：图像这一家**不回传费用**，
   *  所以这一位常常是缺省的——而缺省不等于「我们猜一个单价填上去」（见 IMAGE_UNIT_COST_CNY） */
  costCny?: number
  consistency?: ConsistencyResult
  /**
   * 画面审核的结论。缺席 = 这一页根本没走到那一步，两种成因都不是"通过了"：
   * 这台机器没有视觉能力（`vision` 与 `pictureReview` 都是 null），`illustrateNode`
   * 在那一步之前就停了，理由写在 `consistency.reason` 里（"未配置视觉模型，这一页没有
   * 核对过（像不像与画面都没查）"）；或者这一页在出图/落盘那两跳就失败了。
   * "配了审核、但这一次调用没跑成"是写进来的 `verdict: 'unavailable'`，不是缺席——
   * 两者都要收进 `needsHumanReview`，但记录里要分得出是哪一种。
   */
  pictureReview?: PictureReviewResult
  /** 用尽重画次数仍不达标 → 标记人工介入（降级 B 的入口），而不是整本书失败 */
  needsHumanReview: boolean
}

/**
 * 一页里可以有几段音频。顺序就是落盘顺序，也是界面上的念读顺序。
 *
 * 只有 `body` 是每一页都有的，另外三段是共读版选择点那一页多出来的（产品定义：选项走
 * 「大图标 + 语音朗读」双通道，`spoken` 就是那个"耳朵"通道）。`prompt` 是给家长念的
 * 引导提问，`option-a` / `option-b` 才对应两颗按钮；它也要有声音，是因为孩子不识字，
 * 家长不在的那几秒，选项至少得能自己说出来。
 */
export const NARRATION_PARTS = ['body', 'prompt', 'option-a', 'option-b'] as const
export type NarrationPart = (typeof NARRATION_PARTS)[number]

/**
 * 片段的中文名。报错与过程面板都要这一份：一页现在最多四段，
 * 只说"这一页没配上音"，家长不知道缺的是哪一句（正文没配上他自己能念；
 * 选项没配上，孩子就选不了）。
 */
export const NARRATION_PART_LABELS: Record<NarrationPart, string> = {
  body: '正文',
  prompt: '引导提问',
  'option-a': '选项 A',
  'option-b': '选项 B',
}

export type Narration = {
  pageNo: number
  /**
   * 这一份录音是这一页里的哪一段。
   *
   * 缺省 = `body`（正文）。盘上已有的书、以及随仓库提交的演示书都没有这个字段，而
   * "缺省是正文"让它们一本都不受影响——与 `Book.status` 那条"缺省 = 成品"同一类迁移
   * 决定。写成可选而不是必填也是同一个理由：填一个 `'body'` 进旧书要重写清单，而清单
   * 是资产（ADR-0003），不该为了一个新字段批量重写。
   */
  part?: NarrationPart
  voiceId: string
  /** 正文哈希：`(voiceId, textHash)` 是去重键，同一段文字因此只合成一次 */
  textHash: string
  asset: AssetRef
  durationMs?: number
}

/**
 * 封面：一次单独的出图，3:4 竖版（`COVER_IMAGE_SIZE`）。
 *
 * 它不是"从某一页里挑一张"。任何一页的跨页图都答不了"这本书讲谁"：页图的构图是"这一页
 * 在发生什么"，而且左下角按约定留给正文。封面要能在没有上下文的时候独立认人，
 * 这是它唯一的职责。
 *
 * 它不进 `illustrations`：那个数组的每一项都带一致性判定与重画次数，而封面的判据不是
 * "像不像上一页"（它没有上一页）。硬塞进去会让 `stats.firstPassCount` / `redrawCount`
 * 的分母多出一个语义不同的东西。
 */
export type Cover = {
  asset: AssetRef
  provenance: Provenance
  costCny?: number
  /**
   * 封面上的画面审核结论（`.scratch/safety` 工单 01）。`pageNo` 恒为 0，那是封面的约定。
   *
   * 它只可能是 `pass` 或 `unavailable`：`flag` 到不了这里——封面被拦下时
   * `illustrateCover` 当场抛错（那条注释写了为什么它没有第二次机会），所以一本有清单的
   * 书，封面要么审过、要么没审成。也正是这个原因，`Cover` 上没有 `needsHumanReview`：
   * 页图那个字段的读法是"这一页有人得看一眼"，而封面这一档的处置是"当场拒绝"，
   * 没有"留着让人看"这条路。
   */
  pictureReview?: PictureReviewResult
}

/** 一本书 = 一堆资产 + 一份清单。★ 它是资产，不是一次调用（ADR-0003） */
/**
 * 一页的硬失败：这一页没有图（出图调用抛错、用尽重画后仍无资产…）。
 *
 * 它与"未核对"是两件事，不许并成一个数：有图 + 未核对 →
 * `Illustration.consistency.verdict === 'unavailable'`（比对没配或没跑成；降级 B 的入口，
 * 图是好的）；没有图 → 这个类型。
 * 实测踩过一次：比对调用 504 时异常冒出去，把已经画完、已经付过钱的图一起从书里丢掉，
 * 汇总行还写着"2/5 页有图"。见 `illustrate.ts` 里的那段注释。
 */
export type PageFailure = { pageNo: number; message: string }

export type Book = {
  bookId: string
  cardId: string
  cardRevision: number
  form: BookForm
  tree: StoryTree
  /**
   * 封面。可选是为了读旧书：仓库里那本预生成演示书（`public/demo/books/`）
   * 是在有封面这个字段之前出的，它的 `book.json` 里没有这一项。
   * 阅读器遇到没有封面的书要照实少显示一面，不许拿第一页冒充封面。
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
  /**
   * 这一本是用哪个音色朗读的。没有 = 这一本不配音（工单 02/03）。
   *
   * 不能从 `narrations` 推：那个数组为空有两种完全不同的成因——① 不做这件事（跑的时候
   * 关掉了朗读）；② 做了但没做成（那一页没配上音）。运行视图要按这个区别说不同的话
   * （"不配音" vs "有 3 页没配上音"），而后者在界面上是一次该被看见的失败。合成一个推断，
   * 失败就会被说成选择。这与"缺图 vs 未核对"那条警告是同一件事，别再犯第四次。
   *
   * 与 `Book.status` 一样由引擎原样抄：引擎不挑音色（"默认音色是产品概念，不是引擎概念"，
   * 见 `BookRequest.voiceId`），它只记下调用方说了什么。
   */
  voiceId?: string
  createdAt: number
  /**
   * 这是一份草稿还是一本成品（工单 03）。
   *
   * 缺省 = 成品，判据写成"只有明确写着 `draft` 的才是草稿"（`isDraft`）。盘上已经有两种
   * 没有这个字段的书：随仓库提交的预生成演示书（`public/demo/books/`）与这个字段之前
   * 跑出来的所有运行期书。把缺省判成草稿会让它们凭空从书架消失，而用户只会以为书丢了。
   * 这是一条迁移决定，不是随手写的默认值——改它之前先想清楚那两种书怎么办。
   *
   * 引擎只把它原样抄进清单，不定策略：草稿还是成品是产品概念，与 `voiceId` 同一条理由。
   */
  status?: 'draft' | 'published'
  /** 端到端统计：#14「记录真实耗时与成本」的数据源，跑一次就有一份 */
  stats: BookStats
}

/** 只有明确写着 `draft` 的才是草稿。理由见 `Book.status` 那段（缺省 = 成品） */
export function isDraft(book: Book): boolean {
  return book.status === 'draft'
}

export type BookStats = {
  elapsedMs: number
  imageCalls: number
  /** 首次通过 / 重画后通过 —— §10.1 公式里的 r_redraw 直接从这里算 */
  firstPassCount: number
  redrawCount: number
  /**
   * 累计花费（元）。★ 它是 `costCny ?? 0` 逐次加出来的，所以**没有回传费用的那几次会记成 0**。
   * 2026-10-21 起图像那一家不回传费用（见 `IMAGE_UNIT_COST_CNY` 与
   * `docs/known-tradeoffs.md` 里那一节），于是 `0` 在这里的含义是**"没量到"**，
   * 不是"免费"——要报账请看厂商账单，别拿这一个数当账单。
   */
  totalCostCny: number
  nodesPlanned: number
  nodesGenerated: number
}
