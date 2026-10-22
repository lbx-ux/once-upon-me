/**
 * story-draft.ts —— 故事草稿：①编故事 与 ②逐页画 之间落在盘上的那一份
 *
 * ```
 *   .out/web/books/<bookId>/story.json     ← 这个文件
 *   .out/web/books/<bookId>/events.jsonl   ← ①的事件（②接着往里追加）
 *   .out/web/books/<bookId>/book.json      ← ②收尾才写（在这之前，这本书在盘上「还不存在」）
 * ```
 *
 * 为什么要有它
 *
 * 「故事闸门」（2026-10-17）：编完故事先停下来，把那一版摊给家长看、让家长改，
 * 改了再画。而这是两个 HTTP 请求——中间隔着家长看故事的那几分钟，甚至隔着一次刷新。
 * 所以那一版故事必须落下：内存里的东西熬不过一次刷新，而家长改的字不能丢。
 *
 * 它也是"这本书现在做到哪一步"在盘上的唯一凭据：有 `story.json` 没有 `book.json`
 *   = 一台故事写好了、还没开始画的本子。书架那一栏（`library.ts`）认的就是这件事。
 *
 * 三条刻意的形状
 *
 * 1. 存的是 `doc`（书名 + 每页草稿），不是 `StoryTree`。 树里那些
 *    `nodeId` / `pathFromRoot` / `next` 全是派生物，由 `buildTree` 从 `doc` 算出来。
 *    存两份就是同一个值有两个家，而它们漂移的那天，家长改的东西与画出来的东西
 *    就是两份数据。派生只发生在两处：②开跑前（顺便就是校验），与书架数页数。
 * 2. `input` 整份留着（孩子 / 卡号与版 / 主题 / 页数 / 音色 / 状态）。
 *    ②与"重写一版"都不让客户端再传一遍——客户端重传的形状里，
 *    孩子、主题、卡都可能有第二份真相，而它们在这条路上根本不需要动。
 *    卡的内容不存（只存 `cardId` + `cardRevision`）：与 `book.json`、`/pages`
 *    同一条规矩，卡是独立资产（ADR-0007），按版号现读才能保证
 *    "屏幕上显示的提示词"与"真正拿去画的那一版卡"是同一版。
 * 3. `editedAt` 缺省不存在，不是 `null`：没有它 = 家长一个字都没改，
 *    有它 = 改过（并且在那一刻又存回来过）。这两种状态在排障时要能分开。
 *
 * 盘上的东西不可信（读的那一侧）
 *
 * `readStory` 只认真校验信封（书名是字符串、nodes 是数组、input 在），
 * 不校验故事内容。理由是一条真实的坏法：故事本体将来若因 schema 变更而不合法，
 * "拒绝读"会让家长那几分钟的改动从界面上消失（而那正是闸门存在的意义）；
 * 而照实读出来、把问题标在那一格上（`lib/story-problems.ts`），家长能自己改回去。
 */

import {
  bookDirOf,
  type BookForm,
  type BookRequest,
  type CharacterCard,
  type ChildProfile,
  type RetrievalProvenance,
  type RetrievedChunkRef,
} from './engine/index.ts'
import type { AssetStore } from './engine/providers/types.ts'
import type { CreateBookBody } from './book-api.ts'
import type { PlanDraft } from './schemas/story.ts'

/**
 * ①那一步的输入，原样留着给②用。
 * 它就是 `CreateBookBody` 去掉 `mode`（跑法不是书的一部分），只是 `cardRevision`
 *   在这里是解析过的——请求里可以不给版号（"用最新那版"），而草稿必须记下
 *   当时真用的是哪一版，否则重写一版时会悄悄换一张卡。
 */
export type StoryInput = {
  child: ChildProfile
  cardId: string
  cardRevision: number
  theme: string
  wish?: string
  form: BookForm
  pages?: number
  voiceId?: string
  status?: 'draft' | 'published'
}

export type StoryDraft = {
  bookId: string
  input: StoryInput
  doc: PlanDraft
  /**
   * 这一版故事是谁编的（ADR-0003 的出处）。`attempts` = **一共调了几次模型**，
   * 它是报价表 §10.1 的 N_plan——重写一版会把它换成新的那一次，
   * 因为这个数说的是"盘上这一版花了多少代价"，不是"这一路上一共试了几次"。
   *
   * ★ 独读版一次尝试就是一次调用，所以两种口径在那里是同一个数；
   *   共读版走两步（提纲 + 三段展开，`engine/plan-shared.ts`），一次成功最少也是 4 次调用
   *   ——"第几次才成功"这个说法在那一档没有意义，`attempts` 因此统一按调用次数记。
   */
  provenance: {
    modelId: string
    promptVersion: string
    attempts: number
    /**
     * 这一版故事是看着哪些旧文本写出来的（2026-10-19，`.scratch/rag`）。
     *
     * 可选，理由与 `events.ts` 的 `branchPages` 完全相同：2026-10-19 之前
     *   落盘的 `story.json` 没有这个字段，那是历史，不重录；读的时候没有就不显示。
     * 它在这里是可答性的落点：家长问"这本书为什么像书单里那本"，
     *   答得出是哪一页哪一句被参考过（`hits` 里有出处与分数）。
     */
    retrieval?: RetrievalProvenance
  }
  /**
   * ①那一段的机器时间（毫秒）。②的 `stats.elapsedMs` 靠它把编故事算进去，
   * 所以两种走法（脚本一次跑完 / 界面分两步）在账单上仍然可比。
   */
  planMs: number
  /** 编故事开始的那一刻。②把它抄成 `Book.createdAt`（书架按它排次序） */
  createdAt: number
  /** 家长动手改过的时刻。没有 = 一个字没动 */
  editedAt?: number
}

export const STORY_FILE = 'story.json'

export function storyPathOf(bookId: string): string {
  return `${bookDirOf(bookId)}/${STORY_FILE}`
}

/** 一份请求体 + 真用上的那一版卡 → ①的输入。只在这里拼一次，别让每个路由各拼一遍 */
export function storyInputOf(body: CreateBookBody, cardRevision: number): StoryInput {
  return {
    child: body.child,
    cardId: body.cardId,
    cardRevision,
    theme: body.theme,
    ...(body.wish ? { wish: body.wish } : {}),
    form: body.form,
    ...(body.pages !== undefined ? { pages: body.pages } : {}),
    ...(body.voiceId ? { voiceId: body.voiceId } : {}),
    ...(body.status ? { status: body.status } : {}),
  }
}

/**
 * ①的输入 + 现读的那一版卡 → 引擎要的那份请求。
 * 它是"故事草稿"与"引擎"之间唯一的翻译处：卡在这里从"号 + 版"变成实物，
 *   而 `theme` / `wish` 那两条可选字段的 `有才传` 写法（`state.ts` 那条）
 *   也在这里守住——传一个空串进去，引擎那边"没填"与"填了个空的"就分不开了。
 */
export function storyRequestOf(input: StoryInput, card: CharacterCard): BookRequest {
  return {
    child: input.child,
    card,
    theme: input.theme,
    ...(input.wish ? { wish: input.wish } : {}),
    form: input.form,
    ...(input.pages !== undefined ? { pages: input.pages } : {}),
    ...(input.voiceId ? { voiceId: input.voiceId } : {}),
    ...(input.status ? { status: input.status } : {}),
  }
}

/**
 * 读草稿。读不到就是 `null`（不存在、半截 JSON、信封不对，三种都是"这里没有草稿"）。
 *
 * 与 `library.ts` / `book-source.ts` 对半截 JSON 的处理是同一条：一本读不出来的书
 *   不该让整个书架 500。而"半截"是进程被杀时最后写的那一件的真实形状。
 */
export async function readStory(store: AssetStore, bookId: string): Promise<StoryDraft | null> {
  let raw: unknown
  try {
    raw = await store.readJson<unknown>(storyPathOf(bookId))
  } catch {
    return null
  }
  return asStoryDraft(raw, bookId)
}

/**
 * 信封：书名是字符串、每页是一个对象。
 *
 * 读（`asStoryDraft`）与写（`/story` 的 PUT）走的是同一个判断：
 *   写下去一份读不回来的东西，症状是"存上了、刷新之后这一本没了"——
 *   而那正是这道闸门要防的事。
 * 它不看故事内容（正文有没有超长、情节够不够长），那是
 *   `lib/story-problems.ts` 的事：家长把一页正文删空、正要重写的那几秒里，
 *   存盘不该失败（见文件头那段）。
 */
export function isStoryDoc(raw: unknown): raw is PlanDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const record = raw as Record<string, unknown>
  const nodes = record['nodes']
  if (typeof record['title'] !== 'string' || !Array.isArray(nodes)) return false
  return nodes.every((node) => !!node && typeof node === 'object' && !Array.isArray(node))
}

/**
 * 信封校验：只认真形状，不认故事内容（理由见文件头）。
 * 导出来是为了让 `library.ts` 复用同一份判据——书架扫盘时读到的也是这个形状。
 */
export function asStoryDraft(raw: unknown, bookId: string): StoryDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const input = record['input'] as Record<string, unknown> | undefined
  const doc = record['doc']
  if (!input || !isStoryDoc(doc)) return null
  if (typeof input['cardId'] !== 'string' || !input['child']) return null

  const provenance = (record['provenance'] ?? {}) as Record<string, unknown>
  const retrieval = asRetrieval(provenance['retrieval'])
  return {
    bookId: typeof record['bookId'] === 'string' ? record['bookId'] : bookId,
    input: input as unknown as StoryInput,
    doc,
    provenance: {
      modelId: typeof provenance['modelId'] === 'string' ? provenance['modelId'] : '',
      promptVersion:
        typeof provenance['promptVersion'] === 'string' ? provenance['promptVersion'] : '',
      attempts: typeof provenance['attempts'] === 'number' ? provenance['attempts'] : 0,
      // 读回来的时候也认它：写出去、读回来丢掉一个字段，是那种"看起来没事、
      //   等有人要显示它时才发现"的不对称。形状不对就当没有（历史产物就是没有）
      ...(retrieval ? { retrieval } : {}),
    },
    planMs: typeof record['planMs'] === 'number' ? record['planMs'] : 0,
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : 0,
    ...(typeof record['editedAt'] === 'number' ? { editedAt: record['editedAt'] } : {}),
  }
}

/**
 * 检索出处的信封校验。
 *
 * `corpusVersion` 允许是 `null`（那一轮没检索成，见 `domain.ts` 那条注释），
 *   所以这里判的是 `null 或 非空字符串`，而不是"必须是非空字符串"——
 *   写成后者会把"检索没成"那一档读成"没有检索"，两件事就差在这里。
 */
function asRetrieval(raw: unknown): RetrievalProvenance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const corpusVersion = record['corpusVersion']
  if (corpusVersion !== null && typeof corpusVersion !== 'string') return null
  if (typeof record['examples'] !== 'number' || typeof record['avoids'] !== 'number') return null
  const rawHits = record['hits']
  if (!Array.isArray(rawHits)) return null

  const hits: RetrievedChunkRef[] = []
  for (const item of rawHits) {
    if (!item || typeof item !== 'object') return null
    const hit = item as Record<string, unknown>
    if (
      typeof hit['chunkId'] !== 'string' ||
      typeof hit['source'] !== 'string' ||
      typeof hit['score'] !== 'number' ||
      (hit['polarity'] !== 'example' && hit['polarity'] !== 'avoid')
    ) {
      return null
    }
    hits.push({
      chunkId: hit['chunkId'],
      source: hit['source'],
      score: hit['score'],
      polarity: hit['polarity'],
    })
  }

  const topScore = record['topScore']
  return {
    corpusVersion: corpusVersion as string | null,
    examples: record['examples'],
    avoids: record['avoids'],
    topScore: typeof topScore === 'number' ? topScore : null,
    hits,
  }
}

export async function writeStory(store: AssetStore, draft: StoryDraft): Promise<void> {
  await store.putJson({ path: storyPathOf(draft.bookId), value: draft })
}
