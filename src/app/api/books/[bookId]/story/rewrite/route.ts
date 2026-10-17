/**
 * /api/books/[bookId]/story/rewrite —— 「让 AI 重写一版」（故事闸门）
 *
 * ```
 *   POST /api/books/<bookId>/story/rewrite    { note: "结局改成她带着全班一起飞" }
 * ```
 *
 * 家长看完第一版故事，写一句"想让故事往哪儿发展"，模型按这个方向**重写整篇**。
 * 过程以 SSE 吐出来（与开一本那一条同一个协议、同一个解码器）。
 *
 * 四条：
 *
 * 1. **输入从 `story.json` 里拿，不是从请求体里拿。** 请求体只有一个 `note`。
 *    客户端重传孩子 / 卡 / 主题的话，那份数据就多了一个家，而它们在这一步上
 *    根本没有要动的地方（`story-draft.ts` 文件头第 2 条）。
 * 2. **先截断日志，序号从 1 重来。** 被弃掉的那一版故事不该留在日志里：
 *    `frames.ts` 的 `deskOf` 里 `total` 只增不减（判据 2），12 页重写成 8 页之后，
 *    重放出来的画桌会多出 4 个永远填不上的格子。这与"开跑前先截断"是同一条理由。
 * 3. **`editedAt` 会被清掉**：重写之后盘上那一份是**模型刚写的**，不是家长改的。
 *    留着上一个 `editedAt` 会让"这个字是谁写的"这个问题答错。
 * 4. **`createdAt` 不动**：这一本从哪一刻开始做，与重写了几版故事无关
 *    （②收尾写进 `book.json` 的 `Book.createdAt` 用的是它，书架按它排次序）。
 *
 * ★ 已经画过的书不许重写（409）：那一本的正文已经在 `book.json` 里了。
 */

import type { NextRequest } from 'next/server'
import { createCardStore, createProviders, planBook, type EngineEvent } from '@/lib/engine/index.ts'
import { encodeBookFrameToText, type BookStreamFrame } from '@/lib/book-stream.ts'
import { createFsEventLog } from '@/lib/event-log.ts'
import { assetRoot, bookExists, finishRun, runKeyOf, tryStartRun } from '@/lib/books-runtime.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'
import { readStory, storyRequestOf, writeStory, type StoryDraft } from '@/lib/story-draft.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'
import { createUserStore, userSliceRoot } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  // 与开一本那一条同一条口径：这一步只调文本模型
  const guard = await requireCapability(req, ['text'])
  if (!guard.ok) return guard.response

  const { bookId } = await ctx.params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonError(400, 'bad-json', '请求体不是合法的 JSON')
  }
  const note =
    typeof (raw as { note?: unknown })?.note === 'string'
      ? (raw as { note: string }).note.trim()
      : ''
  if (note === '') {
    return jsonError(400, 'invalid-request', '先写一句想让故事怎么变——不然重写出来的还是原来那一版')
  }

  const root = assetRoot()
  const store = await createUserStore(root, guard.session.userId)
  const draft = await readStory(store, bookId)
  if (!draft) {
    return jsonError(404, 'story-not-found', '这一本的故事不在了，回「创作」重新编一版吧')
  }
  if (await bookExists(store, bookId)) {
    return jsonError(
      409,
      'book-exists',
      '这本书已经画好了，故事改不动了。要改故事就是新做一本（换一个主题）。',
    )
  }

  const card = await createCardStore(store).load(draft.input.cardId, draft.input.cardRevision)
  if (!card) {
    return jsonError(
      404,
      'card-not-found',
      `这一本要用的角色卡（${draft.input.cardId}）不在了，重写不了`,
    )
  }
  const request = storyRequestOf(draft.input, card)

  const runKey = runKeyOf(guard.session.userId, bookId)
  if (!tryStartRun(runKey)) {
    return jsonError(409, 'book-busy', '这一本正在做，等它跑完再重写')
  }

  let providers
  try {
    providers = await createProviders({
      env: serverEnv(),
      mode: 'live',
      assetRoot: root,
      store,
    })
  } catch (err) {
    finishRun(runKey)
    const failure = userFailureOf(err)
    return jsonError(failure.status, failure.code, failure.message)
  }

  const log = await createFsEventLog(userSliceRoot(root, guard.session.userId))
  // 见文件头第 2 条：上一版故事的过程日志从这一刻起不属于这一本了
  await log.truncate(bookId)

  const encoder = new TextEncoder()
  let clientGone = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: BookStreamFrame): void => {
        if (clientGone) return
        try {
          controller.enqueue(encoder.encode(encodeBookFrameToText(frame)))
        } catch {
          clientGone = true
        }
      }

      let chain: Promise<void> = Promise.resolve()
      const onEvent = (event: EngineEvent): void => {
        chain = chain.then(async () => {
          await log.append(bookId, event)
          send({ kind: 'engine', event })
        })
      }

      try {
        const plan = await planBook(request, { providers, onEvent, reviseNote: note })
        await chain
        const next: StoryDraft = {
          ...draft,
          doc: plan.doc,
          provenance: {
            modelId: plan.modelId,
            promptVersion: plan.promptVersion,
            attempts: plan.attempts,
          },
          planMs: plan.elapsedMs,
          // ★ `createdAt` 不动；`editedAt` 清掉（见文件头第 3、4 条）
        }
        delete next.editedAt
        await writeStory(store, next)
        send({ kind: 'status', running: false, bookReady: false })
      } catch (err) {
        const failure = userFailureOf(err)
        await chain.catch(() => undefined)
        send({
          kind: 'fatal',
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        })
      } finally {
        finishRun(runKey)
        try {
          controller.close()
        } catch {
          /* 已经关了：正常 */
        }
      }
    },
    cancel() {
      clientGone = true
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
