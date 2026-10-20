/**
 * /api/books/[bookId]/story —— 故事草稿的读与存（故事闸门）
 *
 * ```
 *   GET   /api/books/<bookId>/story   家长要改的那一份（书名 + 每页草稿）
 *   PUT   /api/books/<bookId>/story   把改过的存回去
 * ```
 *
 * 「重写一版」不在这里：它是一次模型调用（有过程、要 SSE、要花钱），
 * 所以在隔壁的 `rewrite/route.ts`。这一条只搬字节。
 *
 * 四条：
 *
 * 1. GET 回的只有 `doc`（书名 + `nodes`），不回 `input` / `planMs` 那些。
 *    家长改的是故事，而 `input`（孩子、卡号、主题）在这一屏上没有要动的地方——
 *    回过去只会让人以为"这些也能改"。
 * 2. PUT 只校验信封，不校验故事内容。这一条与"读的那一侧"是同一条判据的两半
 *    （见 `lib/story-draft.ts` 文件头）：家长把某一页的正文删空、正要重新写的那几秒里，
 *    存盘不该失败——失败的话，一次刷新就把他的改动抹了，而那正是这道闸门要防的事。
 *    内容合不合法由「就按这个画」那一关说了算（`illustrate/route.ts` 用同一个 codec 查），
 *    界面上也实时标着（`lib/story-problems.ts`，同一份判据）。
 * 3. 存盘记 `editedAt`。缺省不存在 = 一个字没动，这是排障时要能分开的两种状态。
 * 4. 已经画过的书不许再改故事（409）。那一本的正文已经写进 `book.json` 了，
 *    在这里改只会让盘上两份数据打架，而屏幕上不会有人发现。
 */

import { createUserStore } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { assetRoot, bookExists } from '@/lib/books-runtime.ts'

import type { NextRequest } from 'next/server'
import { isStoryDoc, readStory, writeStory, type StoryDraft } from '@/lib/story-draft.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status })
}

const NOT_FOUND = '这一本的故事不在了（也许已经画成书，也许被删掉了）。刷新一下书架看看。'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  // 2026-10-17（工单 16）：这条路原来没有登录闸。故事草稿也是"我的东西"。
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { bookId } = await ctx.params
  const store = await createUserStore(assetRoot(), guard.session.userId)
  const draft = await readStory(store, bookId)
  if (!draft) return jsonError(404, 'story-not-found', NOT_FOUND)

  // 只回 `doc`。`input`（孩子 / 卡号 / 主题）与 `planMs` 在这一屏上没有要动的地方，
  //   回过去只会让人以为"这些也能改"（见文件头第 1 条）
  return Response.json({ story: draft.doc, editedAt: draft.editedAt ?? null })
}

/**
 * 存回改过的故事。请求体就是 `{ title, nodes }`——与模型输出的形状同一个
 * （`schemas/story.ts` 的 `PlanDraft`），所以"家长改的那一份"与"模型写的那一份"
 * 在盘上是同一个东西，`buildTree` 也无从分辨它们（那正是我们要的）。
 */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { bookId } = await ctx.params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonError(400, 'bad-json', '请求体不是合法的 JSON')
  }

  const store = await createUserStore(assetRoot(), guard.session.userId)
  const draft = await readStory(store, bookId)
  if (!draft) return jsonError(404, 'story-not-found', NOT_FOUND)

  if (await bookExists(store, bookId)) {
    return jsonError(
      409,
      'book-exists',
      '这本书已经画好了，故事改不动了。要改故事就是新做一本（换一个主题）。',
    )
  }

  if (!isStoryDoc(raw)) {
    return jsonError(400, 'invalid-request', '故事要是一个带书名和每页内容的 JSON 对象')
  }

  const next: StoryDraft = { ...draft, doc: raw, editedAt: Date.now() }
  try {
    await writeStory(store, next)
  } catch (err) {
    return jsonError(500, 'asset-write-failed', err instanceof Error ? err.message : String(err))
  }

  return Response.json({ savedAt: next.editedAt })
}
