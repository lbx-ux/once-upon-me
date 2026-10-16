/**
 * index.ts —— 引擎的唯一入口
 *
 * ★ 这就是"引擎与 UI 的模块边界"本身。整个引擎对外只有两个动作：
 *
 * ```ts
 * buildCharacterCard(...)  →  CharacterCard      （① 资产化：做一次，跨页跨书复用）
 * runBook(request, deps)   →  Promise<Book>      （②–⑦ 一条流水线，过程靠 emit 吐出来）
 * ```
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
  StoryNode,
} from './domain.ts'
import { childWordOf } from './domain.ts'
import { linearOrder } from './tree.ts'
import { createEventFactory, type EngineEvent, type EngineEventPayload } from './events.ts'
import { EngineError } from './errors.ts'
import { planStory } from './plan.ts'
import { illustrateAll, illustrateCover, illustrateNode } from './illustrate.ts'
import { narrateAll, narrateNode, nextTakeNo } from './narrate.ts'
import { cardDigest, validateCard } from './character-card/card.ts'
import { digest } from './digest.ts'
import { toDataUrl } from './providers/http.ts'
import type { ProviderBundle } from './providers/types.ts'
import type { StoryPlanInput } from '../prompts/story-plan.ts'

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
  StoryChoice,
  StoryNode,
  StoryTree,
  StyleLock,
} from './domain.ts'
export { EngineError, asEngineError } from './errors.ts'
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
 */
export { narrateNode, nextTakeNo, narrationTextOf } from './narrate.ts'
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
}

export async function runBook(request: BookRequest, deps: RunDeps): Promise<Book> {
  const now = deps.now ?? (() => Date.now())
  const emit = createEventFactory(now)
  const forward = (payload: EngineEventPayload): void => {
    deps.onEvent?.(emit(payload))
  }
  const { providers } = deps
  const startedAt = now()

  const cardProblems = validateCard(request.card)
  if (cardProblems.length > 0) {
    throw new EngineError('card-invalid', `角色卡不合格：${cardProblems.join('；')}`)
  }

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
  }

  const plan = await planStory(planInput, {
    text: providers.text,
    form: request.form,
    emit: forward,
  })

  const referenceBytes = await providers.store.read(request.card.reference.path)
  if (!referenceBytes) {
    throw new EngineError(
      'asset-write-failed',
      `角色卡参考图读不到：${request.card.reference.path}。没有参考图就没有锁脸与比对，拒绝继续`,
    )
  }
  const referenceDataUrl = toDataUrl(referenceBytes, request.card.reference.mime)

  const { illustrations, errors } = await illustrateAll(linearOrder(plan.tree), {
    image: providers.image,
    vision: providers.vision,
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
    title: plan.tree.title,
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
    const narrated = await narrateAll(linearOrder(plan.tree), {
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
    elapsedMs: now() - startedAt,
    planAttempts: plan.attempts,
    illustrations,
    errors,
    nodesPlanned: plan.tree.nodes.length,
    // ★ 封面是一次**真实的付费调用**，必须进账。原来的口径只数页图，
    //   加了封面却不改这里，`imageCalls` 就会比实际少一次——
    //   而这个数字是 §10.1 与 #14 的数据源，"少一次"是账目错，不是舍入。
    extraImageCalls: 1,
  })

  const book: Book = {
    bookId: bookIdOf(request),
    cardId: request.card.cardId,
    cardRevision: request.card.revision,
    form: plan.tree.form,
    tree: plan.tree,
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
 */
function replaceByPage<T extends { pageNo: number }>(items: readonly T[], next: T): T[] {
  const kept = items.filter((item) => item.pageNo !== next.pageNo)
  return [...kept, next].sort((left, right) => left.pageNo - right.pageNo)
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
  const previous = request.book.narrations.find((item) => item.pageNo === request.pageNo)
  const voiceId = request.voiceId ?? previous?.voiceId
  if (!voiceId) {
    throw new EngineError('invalid-request', '没说要重配成哪一个音色（voiceId）')
  }

  /**
   * 改过正文就用改过的那份，并把书里那一页的正文一起换掉。
   * ★ 空行丢掉、空白行不许留：`narrateNode` 拿到空串会去要一段空白音频，
   *   而厂商那边要么报错要么回一段静音——两种都不会在界面上说清"这一页没有正文了"。
   *   所以**在这里就拒绝**，让用户看到他删空了。
   */
  const body = request.body?.map((line) => line.trim()).filter((line) => line !== '')
  if (request.body && (body ?? []).length === 0) {
    throw new EngineError('invalid-request', '这一页的正文被改空了——至少留一句话')
  }
  const node = body ? { ...original, body } : original

  const startedAt = now()
  const { narration } = await narrateNode(node, {
    voice,
    voiceId,
    store: providers.store,
    bookId: request.book.bookId,
    emit: forward,
    takeNo: nextTakeNo(previous?.asset.path),
  })

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
    narrations: replaceByPage(request.book.narrations, narration),
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
 */
function summarize(input: {
  elapsedMs: number
  planAttempts: number
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
