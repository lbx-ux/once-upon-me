/**
 * /api/books/[bookId]/pages/[pageNo] —— 重画 / 重配一页（工单 01）
 *
 * ```
 *   POST  /api/books/<bookId>/pages/<pageNo>   { kind: 'image' | 'audio', env, voiceId? }
 * ```
 *
 * 这一条与 `POST /api/books`（整本）共用同一套帧协议（`lib/book-stream.ts`），
 * 所以客户端只需要一个解码器、一个事件处理器——实时、重放、单页重做三条路走同一段渲染代码。
 *
 * 四条与整本那条不同的处置，每条都有理由：
 *
 * 1. 日志是 append，不 truncate。截断只发生在一轮整本开始时（那时它要把上一轮的过程
 *    丢掉）。单页重做是这一本过程的续写——重放时先看到整本怎么画的、再看到第 3 页
 *    被重画了一遍，那正是发生过的事。
 * 2. 序号要接上去（`maxSeqOf`）。工厂每本书从 1 起，不接续的话日志里会出现两条
 *    `seq: 1`，而 `seq` 正是"重放能重建同一串界面状态"与"断线重连后对齐"的依据。
 * 3. 租约与整本共用（`tryStartRun`）。否则重画与整本重跑会同时写同一个目录：
 *    一份日志被两轮事件交叉写入，后写的还会覆盖 `book.json`。
 * 4. 卡按清单说的那一版去读（`book.cardId` + `book.cardRevision`），不是"最新的那一版"。
 *    用最新版重画一页会出现"这一页按第 3 版画、其余 19 页按第 1 版画"——
 *    而那本书的清单上写着它整本是第 1 版的。
 */

import type { NextRequest } from 'next/server'
import {
  childWordOf,
  createCardStore,
  createProviders,
  maxSeqOf,
  rerunNarration,
  rerunPage,
  type Book,
  type EngineEvent,
} from '@/lib/engine/index.ts'
import { encodeBookFrameToText, type BookStreamFrame } from '@/lib/book-stream.ts'
import { childProfileOf } from '@/lib/children-source.ts'
import { createFsEventLog } from '@/lib/event-log.ts'
import { assetRoot, finishRun, runKeyOf, tryStartRun } from '@/lib/books-runtime.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'
import { parseRerunBody } from '@/lib/rerun-api.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { createUserStore, userSliceRoot } from '@/lib/asset-scope.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ code, message, retryable: false }, { status })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bookId: string; pageNo: string }> },
): Promise<Response> {
  const { bookId, pageNo: pageNoRaw } = await ctx.params
  const pageNo = Number(pageNoRaw)
  if (!Number.isInteger(pageNo) || pageNo < 1) {
    return jsonError(400, 'invalid-request', `页码要是正整数，收到 ${pageNoRaw}`)
  }

  // 闸门按这一次要重做的东西要能力，不是按整本书要：重画一页只要图像，
  //   重配一段朗读只要语音。要成"文本 + 图像"的话，一个只有图像权限的人
  //   连"把这一页重画一遍"都做不了——而他做的确实是图像那一件事。
  //   顺序是"先解析再判"：要哪一项能力由 `kind` 决定，而 `kind` 是解析出来的。
  //     先判的话只能一律要图像，那对"重配朗读"就是拦错了人。
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonError(400, 'bad-json', '请求体不是合法的 JSON')
  }

  // 契约在 `lib/rerun-api.ts`（纯函数、有测试），这里只转发。
  //   校验写在路由里的话，只能靠手工发请求去测（`book-api.ts` 文件头那条）
  const parsed = parseRerunBody(raw)
  if (!parsed.ok) return jsonError(400, 'invalid-request', parsed.problems.join('；'))
  const { kind, voiceId, fixNote, body: newBody } = parsed.value

  const guard = await requireCapability(req, kind === 'audio' ? ['speech'] : ['image'])
  if (!guard.ok) return guard.response

  const root = assetRoot()
  const store = await createUserStore(root, guard.session.userId)
  const cardStore = createCardStore(store)

  let book: Book | null
  try {
    book = await store.readJson<Book>(`books/${bookId}/book.json`)
  } catch {
    book = null
  }
  if (!book) {
    return jsonError(404, 'book-not-found', `盘上没有这本书（${bookId}）。刷新一下书架看看`)
  }

  // 按清单说的那一版读卡：见文件头第 4 条
  const card = await cardStore.load(book.cardId, book.cardRevision)
  if (!card) {
    return jsonError(
      404,
      'card-not-found',
      `这本书要用的角色卡（${book.cardId} r${book.cardRevision}）不在了，重画不了`,
    )
  }

  /**
   * 重画也要带上那个称呼（小男孩 / 小女孩 / 孩子）。
   *
   * 不是可选的礼貌：不带它，重画出来的 prompt 与第一次跑不是同一份，
   *   而"同一本书里的每一页出自同一个模板"是 `provenance.promptVersion` 承诺的事
   *   （`image-page@v3` 那一段）。少了这一行，重画那一页恰好会退回"性别靠猜"。
   * ★ 卡读出来的是锚点，锚点里没有性别（这正是那个 bug 的根因），所以这里要按
   *   卡上的 childId 多读一次档案（`Book` 上没有 childId，卡上有）。
   *   读不到就用中性词——不是报错：重画的诱因多半是"这一页画歪了"，
   *   不该因为档案没了就连重画都不给。
   */
  const child = await childProfileOf(card.childId, userSliceRoot(root, guard.session.userId))
  const childWord = child ? childWordOf(child.profile.lookTags, child.profile.gender) : undefined

  // 租约按人记（`runKeyOf`）：整本在跑的时候挡住的是同一个账号的那一次重画
  const runKey = runKeyOf(guard.session.userId, bookId)
  if (!tryStartRun(runKey)) {
    return jsonError(409, 'book-busy', '这本书正在忙（整本生成或另一页重做中），等它完再说')
  }

  let providers
  try {
    providers = await createProviders({ env: serverEnv(), mode: 'live', assetRoot: root, store })
  } catch (err) {
    finishRun(runKey)
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }

  // 序号从日志里已有的最大值接上去（文件头第 2 条）。不 truncate（第 1 条）
  const log = await createFsEventLog(userSliceRoot(root, guard.session.userId))
  const { events: already } = await log.read(bookId)
  const startSeq = maxSeqOf(already)

  const encoder = new TextEncoder()
  let clientGone = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: BookStreamFrame): void => {
        if (clientGone) return
        try {
          controller.enqueue(encoder.encode(encodeBookFrameToText(frame)))
        } catch {
          // 浏览器关了这一页：从这里往后不入流，但落盘照旧
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
        const request = {
          book,
          card,
          pageNo,
          ...(voiceId ? { voiceId } : {}),
          ...(fixNote ? { fixNote } : {}),
          ...(newBody ? { body: newBody } : {}),
          ...(childWord ? { childWord } : {}),
        }
        const deps = { providers, onEvent, startSeq }
        if (kind === 'image') await rerunPage(request, deps)
        else await rerunNarration(request, deps)
        await chain
        send({ kind: 'status', running: false, bookReady: true })
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
