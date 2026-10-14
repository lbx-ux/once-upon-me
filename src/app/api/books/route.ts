/**
 * POST /api/books —— 跑一本书，过程以 SSE 吐出来（工单 02）
 *
 * 这是 `engine/events.ts` 那句"传输不在这里，在 app/api 那一层"的兑现处。
 * 引擎侧一行没改：`runBook(request, {providers, onEvent})` 原样收进一个流。
 *
 * 四条不显然的约定，都在这里摁住：
 *
 * 1. **顺序是先落盘、再入流**。日志是"重放能重建同一串界面状态"的依据，
 *    所以"客户端看见了什么"必须是"日志里有什么"的子集，反过来不成立。
 *    代价是每条事件晚几毫秒到界面——比起刷新后看到一段缺了中间几步的过程，这个代价便宜。
 * 2. **客户端断开 ≠ 后端停手**。写进一个已经关掉的流会抛错，而那个错**不许**
 *    顺着回调链把日志一起带走（`controller.enqueue` 抛错会让后面的事件连日志都写不进去，
 *    于是"日志缺一段"与"这一轮没跑完"两件事混在一起，谁都读不出来）。
 *    所以入流单独 `try/catch`，落盘照旧。
 * 3. **引擎抛出的硬失败要变成一条帧**。HTTP 头早发出去了，改不了状态码；
 *    一次性返回的写法里它是 500，流里它只能是 `{kind:'fatal'}`。
 * 4. **fatal 之后必须 close()**。不关的话浏览器那边的 `getReader()` 永远等在那里，
 *    界面停在"正在生成"，而服务端早就结束了。
 *
 * ★ 三种"还没开始"的失败（请求不合法 / 卡找不到 / 这本书正在跑）走的是**普通 HTTP 错误码**，
 *   不是流：它们都发生在第一个字节之前，用一个能读的状态码比在流里说一句更诚实。
 */

import {
  bookIdOf,
  createCardStore,
  createFsStore,
  createProviders,
  runBook,
  type BookRequest,
  type EngineEvent,
} from '@/lib/engine/index.ts'
import { parseCreateBody } from '@/lib/book-api.ts'
import { encodeBookFrameToText, type BookStreamFrame } from '@/lib/book-stream.ts'
import { createFsEventLog } from '@/lib/event-log.ts'
import { assetRoot, finishRun, tryStartRun } from '@/lib/books-runtime.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'
import { listBooks } from '@/lib/library.ts'

/** node 运行时：资产要落盘（providers/stores.ts 的 fs 实现） */
export const runtime = 'nodejs'
/** 流式响应不许被静态化/缓存 */
export const dynamic = 'force-dynamic'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  // no-transform：反向代理攒批会把这个流变成"跑完一次性全到"，看起来像引擎没吐事件
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Nginx 的缓冲开关。本机演示用不上，但这一行是"部署那天不用重新查一遍"的保险
  'X-Accel-Buffering': 'no',
} as const

function jsonError(status: number, code: string, message: string, extra?: unknown): Response {
  return Response.json({ code, message, ...(extra ? { extra } : {}) }, { status })
}

/**
 * GET /api/books —— 书架（主页"我的故事"要用）
 *
 * ★ 它只列**运行期**的书，不列 `public/demo` 里随仓库提交的那本——
 *   理由写在 `lib/library.ts` 的文件头（往"已创作故事"里灌一个演示书是假数）。
 * ★ 返回的是**摘要**（标题 / 页数 / 有没有朗读），不是整本清单：
 *   主页不需要每页的 prompt 与资产指纹，传过去是白搬。
 */
export async function GET(): Promise<Response> {
  try {
    const store = await createFsStore(assetRoot())
    const books = await listBooks(store)
    return Response.json({ books })
  } catch (err) {
    // 书架读不出来是服务端的事，不该伪装成"你还没有故事"
    return jsonError(500, 'library-read-failed', err instanceof Error ? err.message : String(err))
  }
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonError(400, 'bad-json', '请求体不是合法的 JSON')
  }

  const parsed = parseCreateBody(raw)
  if (!parsed.ok) {
    // 一次报全部问题：填表的人宁可一次看到三条，也不愿意改一条提交一次
    return jsonError(400, 'invalid-request', parsed.problems.join('；'), parsed.problems)
  }
  const body = parsed.value

  const root = assetRoot()
  const store = await createFsStore(root)
  const cardStore = createCardStore(store)
  const log = await createFsEventLog(root)

  const card =
    body.cardRevision === undefined
      ? await cardStore.latest(body.cardId)
      : await cardStore.load(body.cardId, body.cardRevision)
  if (!card) {
    return jsonError(
      404,
      'card-not-found',
      `找不到角色卡 ${body.cardId}${
        body.cardRevision === undefined ? '' : ` r${body.cardRevision}`
      }。先在第 3 步做一张卡，或者选一张已有的`,
    )
  }

  const request: BookRequest = {
    child: body.child,
    card,
    theme: body.theme,
    ...(body.wish ? { wish: body.wish } : {}),
    form: body.form,
    ...(body.pages !== undefined ? { pages: body.pages } : {}),
  }
  const bookId = bookIdOf(request)

  // 同一本书不许两轮同时跑：书号一样 = 目录一样，两份日志会交叉写入
  if (!tryStartRun(bookId)) {
    return jsonError(409, 'book-busy', '这本书正在生成中——等它跑完再点，或者改一个主题再试', {
      bookId,
    })
  }

  // 配置先建（它在第一个字节之前就该失败），再截断日志：顺序反了会在配置错误时留下一份空日志
  let providers
  try {
    providers = await createProviders({
      env: body.env ?? {},
      mode: body.mode ?? 'live',
      assetRoot: root,
      store,
    })
  } catch (err) {
    finishRun(bookId)
    const failure = userFailureOf(err)
    return jsonError(failure.status, failure.code, failure.message, {
      retryable: failure.retryable,
    })
  }

  // 重开一轮先截断：不截断就会把两轮混成一条时间线，重放出来的过程是假的
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
          // 浏览器关了标签页 / 按了停止：从这里往后不再入流，但**落盘照旧**（见文件头第 2 条）
          clientGone = true
        }
      }

      // 事件在引擎里是同步 emit 的，而落盘是异步的。串成一条链，顺序就是发射顺序。
      let chain: Promise<void> = Promise.resolve()
      const onEvent = (event: EngineEvent): void => {
        chain = chain.then(async () => {
          await log.append(bookId, event)
          send({ kind: 'engine', event })
        })
      }

      try {
        await runBook(request, { providers, onEvent })
        await chain
        send({ kind: 'status', running: false, bookReady: true })
      } catch (err) {
        const failure = userFailureOf(err)
        // 先把已经发生的事件写完再报错，否则日志会缺掉最后几条（它们真的发生过）
        await chain.catch(() => undefined)
        send({
          kind: 'fatal',
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        })
      } finally {
        finishRun(bookId)
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

/**
 * 异常 → 用户文案的翻译在 [`lib/provider-messages.ts`](../../../../lib/provider-messages.ts)。
 * ★ 它**不在这条路由里**，因为这份文案有两个消费者：这条流的 `fatal` 帧，
 *   与工单 04/05 那几处表单提交失败。写两份的那天起，两处就会开始说不一致的话。
 */
