/**
 * index.ts —— 引擎的唯一入口
 *
 * ★ 这就是"引擎与 UI 的模块边界"本身。整个引擎对外只有四个动作：
 *
 * ```ts
 * buildCharacterCard(...)          →  CharacterCard        （① 资产化：做一次，跨页跨书复用）
 * planBook(request, deps)          →  Promise<StoryPlan>   （② 编故事，停在闸门之前）
 * illustrateBook(request, tree, …) →  Promise<Book>        （③–⑦ 逐页画 / 封面 / 配音 / 装订）
 * runBook(request, deps)           →  Promise<Book>        （上面两步接起来）
 * ```
 *
 * ★ 为什么②③ 是**两个**动作（2026-10-17，「故事闸门」）：出图是这条流水线上唯一
 *   真正花钱的一步，而它原来紧跟在编故事后面——家长在看到故事第一个字之前钱就花了。
 *   拆开之后界面能把那一版故事摊出来给家长改，改完再画。
 *   `runBook` 留着**不是为了兼容**：脚本、横评、离线跑测走的是它，而它必须是这两个动作的
 *   **复合**（不是另写一条），否则"引擎不碰 React"能跑通的那条路，与实际产品走的那条路
 *   就分了家——而分家的那一天起，跑测量出来的就不是线上那件事了。
 *
 * 三条接口约定，UI 那边只需要知道这些：
 *
 * 1. **依赖是传进来的**（`deps.providers`）。引擎自己不读 `process.env`、
 *    不 `new` 任何适配器 —— 所以 node 脚本、Route Handler、单元测试
 *    跑的是同一条代码路径，"引擎不碰 React"这条约束才有可验证的意义。
 * 2. **过程 = 事件，结果 = 返回值**。事件是协议（可以走 SSE / MCP / 日志），
 *    返回值是资产（可以落盘、可以被引用）。两者不混：事件里不放字节，
 *    返回值里不放进度。
 * 3. **一页失败不等于一本书失败**。缺的页在 `Book.illustrations` 里没有条目，
 *    `stats.nodesGenerated < stats.nodesPlanned` 就是它的可核对表达。
 *
 * 目录里其它文件（plan / illustrate / tree / providers / character-card）
 * 都是**内部实现**：`src/lib/engine/` 之外的代码不该 import 它们，
 * 只 import 这个 index。要越过去用，先想清楚是不是接口少了什么。
 */

import type {
  Book,
  BookForm,
  BookStats,
  CharacterCard,
  ChildProfile,
  Illustration,
  Narration,
  NarrationPart,
  RetrievalProvenance,
  RetrievedChunkRef,
  StoryNode,
  StoryTree,
} from './domain.ts'
import { childWordOf, NARRATION_PARTS } from './domain.ts'
import { linearOrder } from './tree.ts'
import { createEventFactory, type EngineEvent, type EngineEventPayload } from './events.ts'
import { EngineError } from './errors.ts'
import { planStory, type PlanRetriever } from './plan.ts'
import type { ToolDef } from './tool-loop.ts'
import { reviewProblemText, reviewStory } from './review.ts'
import { illustrateAll, illustrateCover, illustrateNode } from './illustrate.ts'
import { narrateAll, narrateTarget, nextTakeNo, targetsOfNode } from './narrate.ts'
import { cardDigest, validateCard } from './character-card/card.ts'
import { digest } from './digest.ts'
import { toDataUrl } from './providers/http.ts'
import type { ProviderBundle } from './providers/types.ts'
import type { StoryPlanInput } from '../prompts/story-plan.ts'
// ★ `PlanDraft` 是**模型吐回来的那张故事表**（书名 + 每页草稿），
//   而它同时就是"家长看到、能改的那一份"（`lib/story-draft.ts` 存的就是它）。
//   两个用途同一个形状是刻意的：中间再立一个"给界面看的"类型，就得写一层转换，
//   而那一层转换正是"家长改的东西与拿去画的东西"分家的地方。
import type { PlanDraft } from '../schemas/story.ts'

export type {
  AgeBand,
  AnchorSlot,
  AssetRef,
  Book,
  BookForm,
  CharacterAnchor,
  CharacterCard,
  ChildProfile,
  ConsistencyResult,
  Cover,
  /*
   * ★ `Gender` 是**类型**，与上面那几个常量（`GENDERS` / `GENDER_LABELS` /
   *   `isGender`）是同一件事的两半。原来只有那一半被导出来了，
   *   于是服务端那句 `ListChildPickerItem.gender?: Gender` 只能改从
   *   `domain.ts` 直接取——为了让一层不同的 import 路径而在同一个文件里
   *   开两扇门，还不如把类型也导出来（`.test.ts` 用的是同一条）。
   */
  Gender,
  Illustration,
  Narration,
  Provenance,
  ChoiceOption,
  StoryChoice,
  StoryNode,
  StoryTree,
  StyleLock,
} from './domain.ts'
export { EngineError, asEngineError } from './errors.ts'
/**
 * ★ 检索那道缝的类型也导出去：`lib/rag/load.ts` 要按它拼出那个函数，
 *   而"引擎以外只 import 这个 index"这条规矩对 `lib/rag` 一样成立。
 */
export type { PlanRetriever, PlanRetrieval } from './plan.ts'
/**
 * ★ 2026-10-19 加（`.scratch/rag`）：**检索的出处**。`story-draft.ts` 要把它写进
 *   `story.json` 的 provenance，而那一层只从 `engine/index.ts` 取东西。
 *   ★ 这两个名字在**上面的 import 里已经引过一次**（`StoryPlan` 那一处要用），
 *     所以这里是**本地转出**而不是 `export … from './domain.ts'`——
 *     同一个名字既做本地绑定又做转出绑定，实测报 TS2300 重复标识符。
 */
export type { RetrievalProvenance, RetrievedChunkRef }
export type { EngineEvent, EngineEventPayload } from './events.ts'
export { STAGE_LABELS, describeEvent, isDisplayable, maxSeqOf } from './events.ts'
export { buildTree, choicePagesOf, linearOrder, pathOf } from './tree.ts'
export {
  ANCHOR_LABELS,
  ANCHOR_SLOTS,
  ANCHOR_STRENGTH,
  AGE_BANDS,
  BOOK_FORMS,
  GENDERS,
  GENDER_LABELS,
  MOODS,
  FORM_LABELS,
  childWordOf,
  isDraft,
  isGender,
} from './domain.ts'
export {
  checklistOf,
  cardDigest,
  normalizeAnchors,
  promptFragmentOf,
  reviseCard,
  validateCard,
} from './character-card/card.ts'
export { buildCard, attachReferenceDigest } from './character-card/card.ts'
/**
 * 单页重配要用到的那两个（工单 01）。`narrateNode` 是循环体的那一份实现，
 * `nextTakeNo` 决定新录音落到哪个文件名——两者都是**判据**，不是实现细节：
 * 路由自己拼文件名的那天起，"第三版会不会覆盖第二版"就只有真跑一本书才知道了。
 * ★ `targetsOfNode` 一起导出（2026-10-18）：一页现在最多四段（正文 + 选择点那三段），
 *   想知道"这一页应该有哪几份录音"的地方（阅读器、探针、重配）只有这一个来源。
 */
export { narrateNode, targetsOfNode, nextTakeNo, narrationTextOf } from './narrate.ts'
export type { NarrationTarget } from './narrate.ts'
export { createProviders, describeProviders } from './providers/registry.ts'
export { createFsStore, createMemoryStore } from './providers/stores.ts'
export { emptyManifest, loadManifest, auditManifest } from './providers/replay.ts'
export type { ReplayManifest } from './providers/replay.ts'

export type BookRequest = {
  child: ChildProfile
  card: CharacterCard
  theme: string
  wish?: string
  form: BookForm
  /** 独读版默认 20 页（产品定义 §二），共读版是主干页数 */
  pages?: number
  /** 跑测与演示都要能缩小规模，所以它是入参不是常量 */
  maxIllustrationAttempts?: number
  /**
   * 用哪个音色朗读。**留给调用方**（界面与脚本各自决定默认值），引擎不读环境变量。
   * 不给就不配音并说明——"默认音色"是产品概念，不是引擎概念。
   */
  voiceId?: string
  /**
   * 每一页都带角色卡参考图去画（走 provider 的 `edit`）。
   *
   * ★ 默认关，且**这不是能力问题**：`/images/edits` 已实测通（工单 02）。
   *   关着是因为开了它同时改变三件没量过的事——产物尺寸由模型定（那条路没有 `size`
   *   字段）、单张扣费未知、以及"跨页一致性到底提升多少"这个 ADR-0007 的赌注本身。
   *   判据与代价写在 `illustrate.ts` 的 `referenceForPages` 上。
   *
   * ★ 单页重画（`rerunPage`）**不读这个字段**，理由写在那个函数里——它没有地方可读。
   */
  referenceForPages?: boolean
  /**
   * 这一轮做出来的是一份**草稿**还是一本**成品**（工单 03）。
   *
   * ★ 引擎**原样抄进清单**，不定策略：与 `voiceId` 同一条理由——
   *   "草稿还是成品"是产品概念，不是引擎概念。不传就是缺省（= 成品，见 `domain.ts`）。
   */
  status?: 'draft' | 'published'
}

export type RunDeps = {
  providers: ProviderBundle
  onEvent?: (event: ReturnType<ReturnType<typeof createEventFactory>>) => void
  /** 时钟是依赖：测试要能钉住时间，资产指纹才稳定 */
  now?: () => number
  /**
   * 事件序号**从哪儿接着数**（2026-10-17，「故事闸门」）。
   *
   * ★ 编故事与逐页画现在是**两个请求**，而它们往**同一个** `events.jsonl` 追加。
   *   序号从 1 重来的话，日志里会出现两条 `seq: 1`——而 `seq` 正是"重放能重建
   *   同一串界面状态"与"SSE 断线后对齐"的依据。与 `RerunDeps.startSeq`
   *   是同一个字段、同一条理由。
   * ★ 缺省仍是 0，所以整本一次跑完的那条路（脚本、离线跑测）一个字都不用改。
   */
  startSeq?: number
  /**
   * 检索（2026-10-19，`.scratch/rag`）。**不传就是这一轮不检索**。
   *
   * ★ 它落在 `RunDeps` 而不是 `PlanDeps`：**它是"这一轮运行"的一个属性**，
   *   而 `runBook` 里也包含编故事那一步。挂在 `PlanDeps` 上的话，
   *   脚本与横评（它们走 `runBook`，见那个函数的注释）就传不进来——
   *   而"脚本走的那条路 == 产品走的那条路"正是 `split.test.ts` 摁着的那件事。
   *   ②（逐页画）不读它，这没问题：`IllustrateDeps` 是 `RunDeps & …`，
   *   多带一个没人读的字段，好过让两条路各有一套依赖。
   *
   * ★ 与 `providers` 同一条分工：引擎不读盘、不找语料、不知道语料在哪——
   *   它只调这个函数，拿回"取到了哪几段、用的是哪一版语料"。
   *   语料的装载在 `lib/rag/load.ts`（服务端那一侧），
   *   于是"引擎不碰 React、不碰文件系统"这条约束在加了检索之后仍然成立：
   *   `node scripts/engine-run.mts --mode=stub` 照样跑得完一本书。
   */
  retriever?: PlanRetriever
  /**
   * 让**我们自己的模型**去调工具（2026-10-19，`.scratch/mcp` 工单 06）。
   * **不传就是今天那条路。**
   *
   * ★ 它落在 `RunDeps` 而不是只挂在 `PlanDeps` 上，与 `retriever` 同一条理由：
   *   `runBook` 里也包含编故事那一步，而脚本/横评走的是 `runBook`——
   *   挂在 `PlanDeps` 上的话，那两条路就传不进来，"脚本走的那条路 == 产品走的那条路"
   *   这条纪律当场破。②（逐页画）不读它，多带一个没人读的字段好过两套依赖。
   * ★ 与 `retriever` 互斥，理由见 `plan.ts` 的 `PlanOptions.tools`。
   */
  tools?: readonly ToolDef[]
  /** 工具轮数上限。缺省见 `tool-loop.ts` */
  maxToolSteps?: number
}

/**
 * ①编故事 的产物。
 *
 * ★ `doc` 与 `tree` 是**同一份东西的两种形状**，不是两份数据：`doc` 是模型吐回来的
 *   那张表（家长改的是它、盘上存的也是它），`tree` 由 `buildTree` 从它派生。
 *   两个都回，是为了不让调用方自己再派生一遍——那会是同一个校验的第二份实现。
 */
export type StoryPlan = {
  tree: StoryTree
  /** 书名 + 每页草稿。它会进 `books/<id>/story.json`，家长改完再递回来 */
  doc: PlanDraft
  modelId: string
  promptVersion: string
  /** 第几次调用才成功（1 = 一次过，是判据 1 的原始数据） */
  attempts: number
  /**
   * 这一步花了多久（机器时间）。
   * ★ ②的 `stats.elapsedMs` 靠它把"编故事"算进去——见 `illustrateBook` 里那段。
   */
  elapsedMs: number
  /**
   * 这一步最后发出的事件序号。**②接着数要用它。**
   *
   * ★ 不给 `createEventFactory` 加一个"读当前号"的口子：那会让工厂多出一份
   *   "可以被读"的状态，而调用方真正要知道的只是"我发到哪儿了"，
   *   在这一层顺手记一下（`emit` 本来就把事件还给我们）就够了。
   */
  lastSeq: number
  /**
   * 这一版故事是看着哪些旧文本写出来的（2026-10-19）。**没开检索就没有这个字段**。
   * ★ 三种状态各不相同，`story-draft.ts` 原样写进 `story.json` 的 provenance。
   */
  retrieval?: RetrievalProvenance
}

export type PlanDeps = RunDeps & {
  /**
   * 「让 AI 重写一版」时家长写的那句话。**不传 = 第一次编**。
   * ★ 它只是提示词里多出来的一段（见 `prompts/story-plan.ts` 的 `reviseNote`），
   *   引擎这边**不多一条"重写"的路**：重写与初编的差别只在输入，不在流水线。
   */
  reviseNote?: string
}

/**
 * ①编故事 —— 只做这一步，停在闸门之前。
 *
 * ★ `validateCard` 在这一步做，**不是只在②**：卡不合格时不该让家长先改完一整篇故事，
 *   再被告知"这张卡画不了"（而且它本来就是 `runBook` 里排在规划之前的那一关）。
 */
export async function planBook(request: BookRequest, deps: PlanDeps): Promise<StoryPlan> {
  const now = deps.now ?? (() => Date.now())
  const emit = createEventFactory(now, deps.startSeq ?? 0)
  let lastSeq = deps.startSeq ?? 0
  const forward = (payload: EngineEventPayload): void => {
    const event = emit(payload)
    lastSeq = event.seq
    deps.onEvent?.(event)
  }
  const startedAt = now()

  const cardProblems = validateCard(request.card)
  if (cardProblems.length > 0) {
    throw new EngineError('card-invalid', `角色卡不合格：${cardProblems.join('；')}`)
  }

  const reviseNote = deps.reviseNote?.trim() ?? ''
  const planInput: StoryPlanInput = {
    childName: request.child.name,
    nameReading: request.child.nameReading,
    ageBand: request.child.ageBand,
    interestTags: request.child.interestTags,
    lookTags: request.child.lookTags,
    theme: request.theme,
    wish: request.wish,
    form: request.form,
    pages: request.pages ?? (request.form === 'solo' ? 20 : 8),
    // ★ 有才传（与请求体那几个可选字段同一条写法）：传一个空串进去，
    //   提示词那边"没写"与"写了个空的"就分不出来了。
    //   ★ 它是**提示词那一段**的输入，所以走 `StoryPlanInput` 而不是 `PlanOptions`——
    //     措辞归 `prompts/` 管（README §二：提示词不散落），引擎这一层只负责把它递过去
    ...(reviseNote !== '' ? { reviseNote } : {}),
  }

  const plan = await planStory(planInput, {
    text: deps.providers.text,
    form: request.form,
    // ★ 不传就是这一轮不检索（`PlanOptions.retrieve` 那条注释）
    ...(deps.retriever ? { retrieve: deps.retriever } : {}),
    ...(deps.tools ? { tools: deps.tools } : {}),
    ...(deps.maxToolSteps === undefined ? {} : { maxToolSteps: deps.maxToolSteps }),
    emit: forward,
  })

  return {
    tree: plan.tree,
    doc: plan.doc,
    modelId: plan.modelId,
    promptVersion: plan.promptVersion,
    attempts: plan.attempts,
    elapsedMs: now() - startedAt,
    lastSeq,
    ...(plan.retrieval ? { retrieval: plan.retrieval } : {}),
  }
}

export type IllustrateDeps = RunDeps & {
  /**
   * 这一本**前面那一段**（①编故事）已经花掉的机器时间。②的 `stats.elapsedMs` 会把它加上。
   *
   * ★ 为什么不是一个"开始时刻"：家长可能把故事改上十分钟，而那十分钟**不是生成**。
   *   记成"从按下开始到装订完"的话，`stats.elapsedMs` 这个数就同时表示两件事
   *   （机器跑了多久 / 人想了多久），而它是 #14「端到端耗时」与 §10.1 的数据源。
   *   所以口径定成**机器跑的总时长**，人看故事与改故事的时间一律不算——
   *   两条路（脚本 / 界面）因此仍然可比。
   */
  planMs?: number
  /**
   * 这一本是什么时候**开始做**的（账单上的 `createdAt`）。
   * ★ 脚本那条路传的是编故事开始的那一刻（与拆开之前逐字相同）；界面那条路传
   *   故事草稿的 `createdAt`——两者说的是同一件事：这一本是从哪一刻开始的。
   */
  createdAt?: number
}

/**
 * ③–⑦ 逐页画 / 封面 / 配音 / 装订 —— 收的 `tree` 就是**真拿去画的那一棵**。
 *
 * ★ 它**不重做规划**：家长改过的那一版故事就是 `tree`，在这里再编一次故事
 *   等于把家长改的东西丢掉，而且再花一次文本调用的钱。
 */
export async function illustrateBook(
  request: BookRequest,
  tree: StoryTree,
  deps: IllustrateDeps,
): Promise<Book> {
  const now = deps.now ?? (() => Date.now())
  const emit = createEventFactory(now, deps.startSeq ?? 0)
  const forward = (payload: EngineEventPayload): void => {
    deps.onEvent?.(emit(payload))
  }
  const { providers } = deps
  const startedAt = deps.createdAt ?? now()
  /** ①那一段的机器时间。★ 见 `IllustrateDeps.planMs`：口径是机器时间，不是挂钟 */
  const planMs = deps.planMs ?? 0

  /**
   * 内容审核的**最后一道**（2026-10-19，`.scratch/rag` 工单 05）。
   *
   * ★ 为什么规划那一步已经审过一次，这里还要再审：**这一版正文可能已经不是模型写的那一版了**。
   *   故事闸门允许家长在 `StorySheet` 上逐字改，而"改"这件事不经过规划那一步——
   *   盘上那份 `story.json` 才是接下来要画、要念的东西。
   *   只留规划那一道闸的话，家长手打进去的任何字都绕过了它。
   * ★ 为什么放在**最前面**（第一张图都还没画）：与规划那一步同一条理由——
   *   出图是这条流水线上唯一真花钱的一步，拦在它之前，钱就没花。
   *   （工单里写的是"装订前"；这里比它更早，因为"更早"是严格更好的位置：
   *   装订前的检查栏下来的那一版，图已经画完了。）
   * ★ 这一道上 **`flag` 也拒发**（不像规划那一步会先带反馈重写）：这里没有"重写一版"那条路——
   *   `illustrateBook` 不重做规划（那会把家长改过的东西丢掉，还再花一次文本调用的钱）。
   *   所以两种处置在这道闸上的下一步是同一件事：**退回去改那一份故事**。
   *   事件里的 `verdict` 仍然如实报 `flag` / `block`，让界面说得清是哪一种。
   */
  const review = reviewStory(tree)
  if (review.verdict !== 'pass') {
    const flagged = review.pages.filter((page) => page.verdict !== 'pass')
    const reason = flagged.map(reviewProblemText).join('；')
    forward({ kind: 'review', stage: 'auditing', check: 'safety', verdict: review.verdict, reason })
    throw new EngineError('review-blocked', `这一版故事被内容审核拦下了：${reason}`, {
      detail: flagged.map(
        (page) => `${page.pageNo}:${page.problems.map((p) => p.clauseId).join(',')}`,
      ),
    })
  }

  const referenceBytes = await providers.store.read(request.card.reference.path)
  if (!referenceBytes) {
    throw new EngineError(
      'asset-write-failed',
      `角色卡参考图读不到：${request.card.reference.path}。没有参考图就没有锁脸与比对，拒绝继续`,
    )
  }
  const referenceDataUrl = toDataUrl(referenceBytes, request.card.reference.mime)

  const { illustrations, errors } = await illustrateAll(linearOrder(tree), {
    image: providers.image,
    vision: providers.vision,
    // ★ 画面审核与比对**是同一个 provider**（`ProviderBundle.vision` 是两个接口的交集）：
    //   它们背后是同一个端点的同一个模型。分成两个字段是因为问的问题不一样，
    //   不是因为可以分别配——见 `IllustrateOptions.pictureReview` 那段
    pictureReview: providers.vision,
    store: providers.store,
    card: request.card,
    referenceDataUrl,
    bookId: bookIdOf(request),
    maxAttempts: request.maxIllustrationAttempts,
    // 默认关：见 BookRequest.referenceForPages 那段（能力有，代价没量）
    referenceForPages: request.referenceForPages === true,
    // ★ 身份那一行（"整本书就是这个孩子（小男孩）"）——2026-10-16 那条
    //   "提供的是男孩子，生成出来有男有女"的报障：这个称呼原先只进标准像的 prompt，
    //   逐页那条路一个字都没有（卡的锚点里也没有性别词），于是每一页都由模型自己猜。
    //   算它的是**这一层**：手上同时有 gender 与 lookTags 的地方只有这里
    //   （`ChildProfile`），而卡那一边两样都没有
    childWord: childWordOf(request.child.lookTags, request.child.gender),
    emit: forward,
    now,
  })

  // ── 封面 ──────────────────────────────────────────────────────────────────
  // 排在页图之后：页图是书的正文，缺一本不成书；封面晚一步不影响任何依赖它的东西，
  // 而且万一封面这次出图失败，前面花的钱至少还在页图里（封面失败是硬失败，见下面）。
  const cover = await illustrateCover({
    image: providers.image,
    store: providers.store,
    card: request.card,
    bookId: bookIdOf(request),
    title: tree.title,
    // 封面也要过画面审核（`.scratch/safety` 工单 01）：它是孩子在货架上第一眼看见的那张。
    // 这一档与页图**共用一个重画次数**（`maxIllustrationAttempts`）——再开一个旋钮
    // 只会多一处"改了那个没改这个"，而它们要表达的是同一件事：愿意为一张图花几次钱
    pictureReview: providers.vision,
    maxAttempts: request.maxIllustrationAttempts,
    emit: forward,
    now,
  })

  // ── 配音 ──────────────────────────────────────────────────────────────────
  // 三种状态都发一条**说清原因**的事件，而不是只有"成功"与"沉默"两种：
  // 没配音的书在阅读器里是没有播放控件的，用户要知道为什么没有。
  let narrations: readonly Narration[] = []
  if (!providers.voice) {
    forward({
      kind: 'error',
      stage: 'narrating',
      code: 'provider-not-configured',
      message: '配音能力没接上（TTS_API_KEY / TTS_MODEL 未配置），这本书没有朗读',
      fatal: false,
    })
  } else if (!request.voiceId) {
    forward({
      kind: 'error',
      stage: 'narrating',
      code: 'provider-not-configured',
      message: '没指定音色（voiceId），这本书没有朗读',
      fatal: false,
    })
  } else {
    const narrated = await narrateAll(linearOrder(tree), {
      voice: providers.voice,
      voiceId: request.voiceId,
      store: providers.store,
      bookId: bookIdOf(request),
      emit: forward,
    })
    narrations = narrated.narrations
    // ★ 配不上音的页**不进 `errors`**：那个字段是"这一页没有图"（见 domain.ts 里
    //   PageFailure 那段注释，它专门警告过不要与"未核对"合并——同一个教训）。
    //   音频缺席的记录在 `narrations` 本身：有 entry 的页才有录音，
    //   没 entry 的页读出来就是"这一页没有朗读"，一个字段只有一种含义。
  }

  const stats = summarize({
    // ★ 机器时间 = ① + ②（见 `IllustrateDeps.planMs`）。一次跑完那条路上
    //   `planMs` 就是刚才那一段的实测值，所以两种走法的口径是同一个。
    elapsedMs: planMs + (now() - startedAt),
    illustrations,
    errors,
    nodesPlanned: tree.nodes.length,
    // ★ 封面是一次**真实的付费调用**，必须进账。原来的口径只数页图，
    //   加了封面却不改这里，`imageCalls` 就会比实际少一次——
    //   而这个数字是 §10.1 与 #14 的数据源，"少一次"是账目错，不是舍入。
    extraImageCalls: 1,
  })

  const book: Book = {
    bookId: bookIdOf(request),
    cardId: request.card.cardId,
    cardRevision: request.card.revision,
    form: tree.form,
    tree,
    cover,
    illustrations,
    // 硬失败页要跟着书走，不能只闪一下事件流——这就是 illustrateAll 注释里
    // 说的"书要标'这一页缺'"
    errors,
    // 没配音时是空数组，不填一个假的占位（CLAUDE.md「没有的东西直说没有」）。
    // 有配音时，`narrations` 就是"哪些页有录音"的唯一记录
    narrations,
    // 这一本用哪个音色朗读。★ 它是"不做"与"没做成"的分界：`narrations` 为空时，
    //   有这个字段是"做了但没配上音"，没有才是"这一本不配音"（见 `Book.voiceId`）
    ...(request.voiceId ? { voiceId: request.voiceId } : {}),
    createdAt: startedAt,
    // 原样抄，不定策略（见 `BookRequest.status`）。不传就是**不写这个字段**，
    // 而不是写一个 `undefined`——盘上的清单要能一眼看出"这是那本没标过的旧书"
    ...(request.status ? { status: request.status } : {}),
    stats,
  }

  const manifestPath = manifestPathOf(book.bookId)
  await providers.store.putJson({
    path: manifestPath,
    value: { ...book, cardDigest: cardDigest(request.card) },
  })
  forward({
    kind: 'book-ready',
    stage: 'assembling',
    bookId: book.bookId,
    path: manifestPath,
    stats: toRecord(stats),
  })
  return book
}

/**
 * 编故事 + 逐页画，一次跑完（②–⑦ 那条老路）。
 *
 * ★ 它就是上面两个动作的**复合**，逐字节等价于拆开之前的那一个 `runBook`：
 *   `createdAt` 与 `planMs` 都由这里给，所以 `stats` 也是同一个。
 *   脚本（`scripts/engine-run.ts`）、离线跑测、横评走的是它——
 *   而它们走的必须是**同一条代码路径**（见文件头那段）。
 */
export async function runBook(request: BookRequest, deps: RunDeps): Promise<Book> {
  const now = deps.now ?? (() => Date.now())
  const startedAt = now()
  const plan = await planBook(request, deps)
  return illustrateBook(request, plan.tree, {
    ...deps,
    // ★ 序号接着①数（见 `RunDeps.startSeq`）：整本一条流的话这条其实无所谓，
    //   但少了它，日志里就会有两段都从 1 开始的事件——而"整本一条流"不是
    //   永久成立的前提，它只是今天的跑法
    startSeq: plan.lastSeq,
    planMs: plan.elapsedMs,
    createdAt: startedAt,
  })
}

/**
 * 单页重做（工单 01）—— 用户看完整本之后，对某一页点「重画」或「重配」。
 *
 * ★ 为什么不是"重跑整本"：20 页重画一遍再付一次钱，还会把已经满意的 19 页一起换掉。
 *   而 `illustrateNode` 本来就是按页导出的，`book.json` 里也存着 `tree.nodes`，
 *   所以缺的只是"单页接起来 + 写回清单"这一层。
 *
 * ★ **调用方把清单与卡读出来递进来**：引擎不决定"清单在哪儿、卡在哪儿"，
 *   与 `runBook` 收 `deps.providers` 而不是自己读 `process.env` 是同一条边界。
 *   返回的是新的 `Book`（已经落盘的那一份），不是"成功/失败"。
 */
export type PageRerunRequest = {
  book: Book
  card: CharacterCard
  pageNo: number
  /**
   * 重画时家长写的那句补充（"上一版哪里不对"）。不写就是纯重画。
   * ★ 它只影响**画面**：`pagePrompt` 把它接在页级描述之后。
   */
  fixNote?: string
  /**
   * 重配时**改过的正文**（一句一段）。不给就照原来那份念。
   *
   * ★ 它改的是**书里的正文本身**，不只是录音：正文是阅读器上那几段字，
   *   改了它，书里那一页的字也跟着变。这是刻意的——用户看到的是"这段录音念的是什么"，
   *   改错字、改一句话，本来就该两边一起改。
   * ★ 代价要写明白：**图不会跟着重画**。画面是按**原来**那段正文出的
   *   （`imagePrompt` 由规划给出，与 `body` 是两条线），改完之后可能图文对不上。
   *   所以要改的不只是错别字时，该做的是重画那一步。
   */
  body?: readonly string[]
  /** 重配用哪个音色。不给就沿用这一页原来那份录音的音色 */
  voiceId?: string
  /**
   * 这一页的**主角称呼**（小男孩 / 小女孩 / 孩子）。
   *
   * ★ 重画必须与第一次跑用**同一行 prompt**，否则 `provenance.promptVersion` 一样、
   *   实际的提示词却不同——同一本书里的两页就不可比了（`imagePage@v3` 那一段说的
   *   正是"版本号是可比性的界"，界要真的成立）。
   * ★ 由**路由**给（它按 `book.childId` 读一次档案）。引擎这一层手上只有卡与书，
   *   两样都没有性别与外貌标签。
   */
  childWord?: string
}

export type RerunDeps = {
  providers: ProviderBundle
  onEvent?: (event: EngineEvent) => void
  /**
   * 事件序号**从哪儿接着数**（工单 01 §3.2）。
   *
   * ★ 重做是往**同一个** `events.jsonl` 追加的（整本那一轮开始时才 `truncate`），
   *   所以调用方要给 `maxSeqOf(日志里已有的事件)`。不给（= 0）的话日志里会出现
   *   两条 `seq: 1`，而 `seq` 正是重放重建界面状态的依据。
   */
  startSeq?: number
  now?: () => number
}

/** 这一页在这本书的故事表里。找不到就是 `page-not-found`（见 errors.ts 那条注释） */
function nodeFor(book: Book, pageNo: number): StoryNode {
  const node = linearOrder(book.tree).find((each) => each.pageNo === pageNo)
  if (!node) {
    throw new EngineError(
      'page-not-found',
      `这本书里没有第 ${pageNo} 页（一共 ${book.tree.nodes.length} 页）`,
    )
  }
  return node
}

/**
 * 按页号**替换**那一条。★ 是替换不是追加：`frames.ts` 判据 1 记着同一个教训——
 * 写成分页追加的话，20 页的书重画 3 页会变成 23 页。
 * 排序保持升序（清单按页号读起来才顺，阅读器也按它取）。
 *
 * ★ **它只适用于"一页一条"的那两种**（`illustrations` / `cover` 那一族）。
 *   配音自从一页可以有四段之后就不能用它了——见 `replaceNarration`（2026-10-18）。
 */
function replaceByPage<T extends { pageNo: number }>(items: readonly T[], next: T): T[] {
  const kept = items.filter((item) => item.pageNo !== next.pageNo)
  return [...kept, next].sort((left, right) => left.pageNo - right.pageNo)
}

/** 片段在清单里的次序：同一页按 正文 → 引导提问 → 选项 A → 选项 B 排 */
function narrationOrderOf(item: Narration): number {
  return NARRATION_PARTS.indexOf(item.part ?? 'body')
}

/**
 * 替换**若干段**录音（一页最多四段）。
 *
 * ★ 为什么不能复用 `replaceByPage`：它按 `pageNo` 删条目，而一页现在有好几条——
 *   重配选择点那一页会把同一页的另外三段**一起删掉**，
 *   症状是"换了音色之后，提问与两个选项凭空不见了"（而这种缺失没人会去查）。
 * ★ 键是 `(pageNo, part)`；`part` 缺省按 `body` 算（盘上已有的书没有这个字段）。
 */
function replaceNarration(items: readonly Narration[], next: readonly Narration[]): Narration[] {
  const keyOf = (item: Narration): string => `${item.pageNo}:${item.part ?? 'body'}`
  const replaced = new Set(next.map(keyOf))
  const kept = items.filter((item) => !replaced.has(keyOf(item)))
  return [...kept, ...next].sort(
    (left, right) => left.pageNo - right.pageNo || narrationOrderOf(left) - narrationOrderOf(right),
  )
}

function rerunForward(deps: RerunDeps): (payload: EngineEventPayload) => void {
  if (!deps.onEvent) return () => undefined
  const emit = createEventFactory(deps.now ?? (() => Date.now()), deps.startSeq ?? 0)
  return (payload) => deps.onEvent?.(emit(payload))
}

/**
 * 重画一页。
 *
 * 四条刻意的处置，每条都对应一种真的会错的做法：
 *
 * 1. **`attemptBase` 接着数**，不是从 1 重来。文件名是 `page-{n}-a{attempt}` 拼的，
 *    从 1 重来会把上一次那张**覆盖掉**——而"失败的图也落盘"是这条流水线写明的纪律
 *    （`illustrate.ts` 文件头第 3 条：家长要能看见"上一版为什么不像"）。
 * 2. **这一页从 `errors` 里摘掉**：它以前"没做出来"，现在做出来了。
 *    `errors` 的口径是"这一页没有图"，留着它就是一句假话。
 * 3. **stats 只累加，不重算**：`imageCalls` / `elapsedMs` / `totalCostCny` 加上这一次的，
 *    `firstPassCount` / `redrawCount` **原样不动**。理由是那两个数说的是
 *    "这本书第一次跑完时一次通过了几页"，把**人事后的干预**算进去，
 *    等于把人的判断记成模型的成绩（§10.1 的 r_redraw 与 #2 都从它们算）。
 * 4. **`referenceForPages` 按 `false` 走**。★ 这是个已知的缺口，不是随手写的：
 *    那本书原本开没开参考图**没有记在清单里**（`Illustration.provenance` 只记了
 *    模型、提示词版本、卡版本），而界面这一路从来没开过（只有脚本会开）。
 *    真要让脚本跑的书也重画成同一套，该补的是 `Book` 上的一个字段——
 *    不是在这里猜一个值。
 */
export async function rerunPage(request: PageRerunRequest, deps: RerunDeps): Promise<Book> {
  const { providers } = deps
  const now = deps.now ?? (() => Date.now())
  const forward = rerunForward(deps)
  const node = nodeFor(request.book, request.pageNo)
  const previous = request.book.illustrations.find((item) => item.pageNo === request.pageNo)

  const referenceBytes = await providers.store.read(request.card.reference.path)
  if (!referenceBytes) {
    throw new EngineError(
      'asset-write-failed',
      `角色卡参考图读不到：${request.card.reference.path}。没有参考图就没有锁脸与比对，拒绝重画`,
    )
  }

  const startedAt = now()
  const illustration = await illustrateNode(node, {
    image: providers.image,
    vision: providers.vision,
    // ★ 单页重画也走画面审核（`.scratch/safety` 工单 01）：重画出来的那一张
    //   与第一版一样要过这道闸。**不开这个口子**的理由与 `referenceForPages: false`
    //   那一段同源——"重画的时候顺便把闸门关掉"是那种没人会写在文档里的豁免，
    //   而它正好发生在"上一版刚被拦下"之后。
    pictureReview: providers.vision,
    store: providers.store,
    card: request.card,
    referenceDataUrl: toDataUrl(referenceBytes, request.card.reference.mime),
    bookId: request.book.bookId,
    attemptBase: previous?.attempt ?? 0,
    referenceForPages: false,
    ...(request.childWord ? { childWord: request.childWord } : {}),
    ...(request.fixNote?.trim() ? { fixNote: request.fixNote.trim() } : {}),
    emit: forward,
    now,
  })

  /**
   * 这一次真的又付了钱，所以成本**累加**（不是"换成新的那一份"——
   * 上一次那一笔也已经花掉了）。`attempt` 是**全局**编号，
   * 所以这一次用掉几次 = 新的 attempt − 上一次的 attempt。
   */
  const attemptsUsed = illustration.attempt - (previous?.attempt ?? 0)
  const book: Book = {
    ...request.book,
    illustrations: replaceByPage(request.book.illustrations, illustration),
    errors: request.book.errors.filter((item) => item.pageNo !== request.pageNo),
    stats: {
      ...request.book.stats,
      elapsedMs: request.book.stats.elapsedMs + (now() - startedAt),
      imageCalls: request.book.stats.imageCalls + attemptsUsed,
      totalCostCny: round2(request.book.stats.totalCostCny + (illustration.costCny ?? 0)),
    },
  }
  return saveRerun(book, request.card, providers, forward)
}

/**
 * 重配一页。
 *
 * ★ 落一份**新文件**（`takeNo` = 旧路径里那个号 + 1），旧录音留着——
 *   与"失败的图也落盘"是同一条纪律。只是这里的价值不同：录音没有"像不像"可比，
 *   所以它只值一条注释，不值一次比对。
 * ★ 只替换这一页那一条：共读版的主干页会**共用同一份录音**（`narrate.ts` 规则 1），
 *   按 `voiceId:textHash` 去重的话会把别的页一起改掉。单页重配**不去重**——
 *   用户点的是"这一页"，改的就只能是这一页。
 */
export async function rerunNarration(request: PageRerunRequest, deps: RerunDeps): Promise<Book> {
  const { providers } = deps
  const voice = providers.voice
  if (!voice) {
    throw new EngineError(
      'provider-not-configured',
      '配音能力没接上（TTS_API_KEY / TTS_MODEL 未配置），重配不了',
    )
  }
  const now = deps.now ?? (() => Date.now())
  const forward = rerunForward(deps)
  const original = nodeFor(request.book, request.pageNo)
  /** 这一页**某一段**原来那一份录音（缺省 = 正文）。takeNo 要按段各数各的 */
  const previousOf = (part: NarrationPart): Narration | undefined =>
    request.book.narrations.find(
      (item) => item.pageNo === request.pageNo && (item.part ?? 'body') === part,
    )
  const previous = previousOf('body')
  const voiceId = request.voiceId ?? previous?.voiceId
  if (!voiceId) {
    throw new EngineError('invalid-request', '没说要重配成哪一个音色（voiceId）')
  }

  /**
   * 改过正文就用改过的那份，并把书里那一页的正文一起换掉。
   * ★ 空行丢掉、空白行不许留：`narrateTarget` 拿到空串会去要一段空白音频，
   *   而厂商那边要么报错要么回一段静音——两种都不会在界面上说清"这一页没有正文了"。
   *   所以**在这里就拒绝**，让用户看到他删空了。
   */
  const body = request.body?.map((line) => line.trim()).filter((line) => line !== '')
  if (request.body && (body ?? []).length === 0) {
    throw new EngineError('invalid-request', '这一页的正文被改空了——至少留一句话')
  }
  const node = body ? { ...original, body } : original

  const startedAt = now()
  /**
   * ★ **这一页的每一段都重录一遍**（正文 + 选择点的提问与两个选项）。
   *
   * 只重录正文的坏法很具体：重配最常见的原因是**换了音色**，而换了音色之后
   * 正文是新的声音、选择点那三句还是旧声音——同一页里两个讲述者，
   * 而界面上写着"已换"。多花的是三次合成，换的是这一页**声音是一致的**。
   * （空文本的段照旧跳过，与整本那条同一条。）
   */
  const fresh: Narration[] = []
  for (const target of targetsOfNode(node)) {
    if (target.text.trim() === '') continue
    const { narration } = await narrateTarget(target, {
      voice,
      voiceId,
      store: providers.store,
      bookId: request.book.bookId,
      emit: forward,
      takeNo: nextTakeNo(previousOf(target.part)?.asset.path),
    })
    fresh.push(narration)
  }

  const book: Book = {
    ...request.book,
    // 改过正文就把它写回故事表里（见 `PageRerunRequest.body` 那段：改的是书本身）
    ...(body
      ? {
          tree: {
            ...request.book.tree,
            nodes: request.book.tree.nodes.map((item) =>
              item.pageNo === request.pageNo ? node : item,
            ),
          },
        }
      : {}),
    narrations: replaceNarration(request.book.narrations, fresh),
    // 重配可能换了一个音色，而"这一本用哪个音色"要跟着走——
    // 不然界面上写着 A、书里每一页都是 B（`Book.voiceId` 那段）
    voiceId,
    stats: {
      ...request.book.stats,
      elapsedMs: request.book.stats.elapsedMs + (now() - startedAt),
    },
  }
  return saveRerun(book, request.card, providers, forward)
}

/**
 * 重做之后把清单写回去，并发一条 `book-ready`。
 *
 * ★ `cardDigest` 要跟着写：`runBook` 收尾写的就是 `{...book, cardDigest}`，
 *   重做时漏掉它的话，清单上那个字段会**原地消失**——
 *   而它正是"这本书是拿哪一版卡画的"的记录（ADR-0007 的可复用靠它）。
 * ★ 再发一条 `book-ready` 不是多余：重放这一串日志的人（刷新、书架点「继续做」）
 *   要能在**重做之后**仍然读到"这本书是完整的"。
 */
async function saveRerun(
  book: Book,
  card: CharacterCard,
  providers: ProviderBundle,
  forward: (payload: EngineEventPayload) => void,
): Promise<Book> {
  const manifestPath = manifestPathOf(book.bookId)
  await providers.store.putJson({
    path: manifestPath,
    value: { ...book, cardDigest: cardDigest(card) },
  })
  forward({
    kind: 'book-ready',
    stage: 'assembling',
    bookId: book.bookId,
    path: manifestPath,
    stats: toRecord(book.stats),
  })
  return book
}

/**
 * 书目录与清单路径。
 *
 * ★ 为什么把它导出而不是留在本文件里：**这一层之外还有人要按同一个拼法找文件**——
 *   app 层的事件日志（`books/<id>/events.jsonl`）、阅读器要读的 `book.json`、
 *   静态导出的演示书。三处各写一遍 `books/${id}/...`，漂了以后的症状是
 *   "日志写在这儿、阅读器去那儿找"，而两边都不会报错。所以只在这里定义一次。
 */
export function bookDirOf(bookId: string): string {
  return `${BOOKS_PREFIX}/${bookId}`
}

export function manifestPathOf(bookId: string): string {
  return `${bookDirOf(bookId)}/book.json`
}

export const BOOKS_PREFIX = 'books'

/**
 * 书号 = 卡 + 版 + 主题指纹。
 * 刻意**不含时间戳**：同一份输入必须得到同一个书号，否则离线演示的资产
 * 每次跑都换目录，"预生成资产"就成了每次都重新生成的东西。
 *
 * ★ 导出它是因为调用方**在跑之前**就需要知道书号：事件日志要按书号开文件、
 *   同一本书的并发保护要按书号挡。让调用方自己拼一遍指纹 = 两处拼法会漂。
 */
export function bookIdOf(request: BookRequest): string {
  const theme = digest(
    `${request.card.cardId}|r${request.card.revision}|${request.form}|${request.theme}`,
  )
  return `${request.card.cardId}-${theme}`
}

/**
 * 统计口径写死在这里，因为 #14「端到端耗时与成本实测」与 §10.1 的 r_redraw
 * 都要从这几个数算出来。口径一变，历史数据就不可比——所以它不是"顺手记几个数"。
 *
 * ★ 2026-10-17 拆流水线时删掉了一个 `planAttempts` 形参：它**从来没有被读过**
 *   （`BookStats` 里没有这个字段），是"规划重试几次"那个数在这条路上的一具空壳——
 *   而拆开之后②手上根本没有规划这回事，再传一个 0 进去就是编。那个数今天落在
 *   故事草稿的 `provenance.attempts` 上（`lib/story-draft.ts`），有读者。
 */
function summarize(input: {
  elapsedMs: number
  illustrations: Illustration[]
  errors: { pageNo: number; message: string }[]
  nodesPlanned: number
  /** 页图之外的付费出图调用（目前只有封面一次）。不传 = 0 */
  extraImageCalls?: number
}): BookStats {
  const judged = input.illustrations.filter(
    (item) => item.consistency && item.consistency.verdict !== 'unavailable',
  )
  const firstPass = judged.filter(
    (item) => item.consistency?.attempt === 1 && item.consistency.verdict === 'pass',
  )
  return {
    elapsedMs: input.elapsedMs,
    // 每页最多画 maxAttempts 次，实际次数 = 各页 attempt 之和（失败的页也算，钱已经花了）
    // ★ 封面不在 `illustrations` 里（它没有页号、也不比对），所以单独加：
    //   口径是"这次运行一共花了多少次出图",不是"每页画了几次"。
    imageCalls:
      input.illustrations.reduce((sum, item) => sum + item.attempt, 0) +
      input.errors.length +
      (input.extraImageCalls ?? 0),
    firstPassCount: firstPass.length,
    redrawCount: Math.max(0, judged.length - firstPass.length),
    totalCostCny: round2(input.illustrations.reduce((sum, item) => sum + (item.costCny ?? 0), 0)),
    nodesPlanned: input.nodesPlanned,
    nodesGenerated: input.illustrations.length,
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function toRecord(stats: BookStats): Record<string, number> {
  return { ...stats } as unknown as Record<string, number>
}

/* ───────────────────────── 角色卡：入口再导出（见 character-card/） ───────────────────────── */

export { createCardStore } from './character-card/store.ts'
export type { CardStore } from './character-card/store.ts'

/* ───────────────────────── 孩子档案：入口再导出（见 character-card/profile*.ts） ───────────── */

export {
  buildChildRecord,
  displayNameOf,
  toChildRecord,
  validateChildRecord,
} from './character-card/profile.ts'
export type { ChildRecord, NewChildRecord } from './character-card/profile.ts'
export { CHILDREN_PREFIX, createProfileStore } from './character-card/profile-store.ts'
export type { ProfileStore } from './character-card/profile-store.ts'
