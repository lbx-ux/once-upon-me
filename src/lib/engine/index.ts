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
} from './domain.ts'
import { linearOrder } from './tree.ts'
import { createEventFactory, type EngineEventPayload } from './events.ts'
import { EngineError } from './errors.ts'
import { planStory } from './plan.ts'
import { illustrateAll } from './illustrate.ts'
import { cardDigest, validateCard } from './character-card/card.ts'
import { digest } from './digest.ts'
import { toDataUrl } from './providers/http.ts'
import type { ProviderBundle } from './providers/types.ts'
import type { StoryPlanInput } from '../prompts/story-plan.ts'

export type {
  AssetRef,
  Book,
  BookForm,
  CharacterAnchor,
  CharacterCard,
  ChildProfile,
  ConsistencyResult,
  Illustration,
  Narration,
  Provenance,
  StoryChoice,
  StoryNode,
  StoryTree,
  StyleLock,
} from './domain.ts'
export { EngineError } from './errors.ts'
export type { EngineEvent, EngineEventPayload } from './events.ts'
export { STAGE_LABELS, describeEvent, isDisplayable } from './events.ts'
export { buildTree, choicePagesOf, linearOrder, pathOf } from './tree.ts'
export {
  ANCHOR_LABELS,
  ANCHOR_SLOTS,
  ANCHOR_STRENGTH,
  AGE_BANDS,
  MOODS,
  FORM_LABELS,
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
    emit: forward,
    now,
  })

  if (!providers.voice) {
    forward({
      kind: 'error',
      stage: 'narrating',
      code: 'provider-not-configured',
      message: '配音能力未接入（W4 落地），这本书暂时没有朗读',
      fatal: false,
    })
  }

  const stats = summarize({
    elapsedMs: now() - startedAt,
    planAttempts: plan.attempts,
    illustrations,
    errors,
    nodesPlanned: plan.tree.nodes.length,
  })

  const book: Book = {
    bookId: bookIdOf(request),
    cardId: request.card.cardId,
    cardRevision: request.card.revision,
    form: plan.tree.form,
    tree: plan.tree,
    illustrations,
    // 配音在 W1 是空的。留空数组而不是留一个假的：见 CLAUDE.md「没有的东西直说没有」
    narrations: [] as Narration[],
    createdAt: startedAt,
    stats,
  }

  const manifestPath = `books/${book.bookId}/book.json`
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
 * 书号 = 卡 + 版 + 主题指纹。
 * 刻意**不含时间戳**：同一份输入必须得到同一个书号，否则离线演示的资产
 * 每次跑都换目录，"预生成资产"就成了每次都重新生成的东西。
 */
function bookIdOf(request: BookRequest): string {
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
    imageCalls:
      input.illustrations.reduce((sum, item) => sum + item.attempt, 0) + input.errors.length,
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
