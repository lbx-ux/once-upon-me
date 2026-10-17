/**
 * /api/books —— 书架这一排的读、写次序、**开一本新书（只做①编故事）**
 *
 * ```
 *   GET   /api/books   书架上那几本的摘要（按 `shelf/order.json` 排好）
 *   PUT   /api/books   记住那一排的次序（用户拖完之后）
 *   POST  /api/books   开一本：**编故事**，过程以 SSE 吐出来（工单 02）
 * ```
 *
 * POST 那一条的正文在下面；这一节说的是它。
 *
 * 这是 `engine/events.ts` 那句"传输不在这里，在 app/api 那一层"的兑现处。
 * 引擎侧只调了一个动作：`planBook(request, {providers, onEvent})` 收进一个流。
 *
 * ★★ 2026-10-17（「故事闸门」）：这条路由**不再跑完一本书**，它只做 ①编故事，
 *    然后把那一版故事写进 `books/<id>/story.json` 就结束。
 *    ②逐页画在 `POST /api/books/<id>/illustrate`，家长点「就按这个画」之后才发生。
 *
 *    ★ 为什么**不新开一个 `/api/books/plan`**：那样"开一本"就有两个入口，
 *      而界面只会用其中一个——另一条路从第二天起开始漂（`shelf-order.ts` 那段
 *      "两处手写的数会各自漂移"是同一个教训）。URL 留着，职责收窄。
 *    ★ 能力闸门也跟着收窄成 `['text']`：这一步只调文本模型，不出一张图。
 *      要图的那一步在自己的路由上要 `['image']`（见 `illustrate/route.ts`）。
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
 *   ★ 2026-10-17 多了第四种：**这本书已经画过了**（`book-exists`，409）。理由见下面那一段。
 *
 * ★ 故事草稿**先写盘、再发收尾的那条 status 帧**：反过来的话，客户端一收到"结束了"
 *   就去 `GET /story`，而那一份可能还没落盘——症状是"编完故事，屏幕上说读不到这一本"。
 */

import type { NextRequest } from 'next/server'
import {
  bookIdOf,
  createCardStore,
  createProviders,
  planBook,
  type Book,
  type BookRequest,
  type EngineEvent,
} from '@/lib/engine/index.ts'
import { parseCreateBody } from '@/lib/book-api.ts'
import { encodeBookFrameToText, type BookStreamFrame } from '@/lib/book-stream.ts'
import { createFsEventLog } from '@/lib/event-log.ts'
import { assetRoot, bookExists, finishRun, runKeyOf, tryStartRun } from '@/lib/books-runtime.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'
import { storyInputOf, writeStory } from '@/lib/story-draft.ts'
import { coverUrlOf as coverUrlIn, runtimeAssetUrl } from '@/lib/book-source.ts'
import { listBooks, noCovers, SHELF_COVER_WIDTH } from '@/lib/library.ts'
import { applyOrder, loadOrder, pruneOrder, saveOrder } from '@/lib/shelf-order.ts'
import { createUserStore, userSliceRoot } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'

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
 * ★ 2026-10-16 起摘要里多一个 `coverUrl`：书架那一屏改成"书立在架子上"之后要封面。
 *   地址的尺寸口径与那一屏同一个数（`SHELF_COVER_WIDTH` = 384 档），
 *   免得同一个封面在两条路上各是一个大小。
 * ★ 2026-10-16 第二轮：**顺序与那一屏是同一条**（`applyOrder` + `shelf/order.json`）。
 *   这条接口现在没有别的消费者（那一屏是服务端直接读盘），但"书架按什么次序摆"
 *   只能有一个答案——接口回一个默认序、页面摆另一个，就是把同一件事说了两遍。
 */
export async function GET(req: NextRequest): Promise<Response> {
  // ★ 2026-10-17（工单 16）：这条路原来**连登录都不要求**，所以它数的是
  //   "这台服务器上的全部书"。现在只看自己那一片——未登录就是 401（没有账号 = 没有书）。
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  try {
    const store = await createUserStore(assetRoot(), guard.session.userId)
    const coverUrlOf = (book: Book): string | null =>
      coverUrlIn(book, (path) => runtimeAssetUrl(path, SHELF_COVER_WIDTH))
    const books = applyOrder(await listBooks(store, coverUrlOf), await loadOrder(store))
    return Response.json({ books })
  } catch (err) {
    // 书架读不出来是服务端的事，不该伪装成"你还没有故事"
    return jsonError(500, 'library-read-failed', err instanceof Error ? err.message : String(err))
  }
}

/**
 * PUT /api/books —— 记住书架那一排的**次序**（用户拖完之后）
 *
 * ```
 *   { "order": ["xiaolu-r1-bf84901c4fcd", "probe-01"] }
 * ```
 *
 * 四条：
 *
 * 1. **写的是全量次序**，不是"把 X 挪到 Y"。拖动会连着改好几次，一次一次增量下发
 *    就等于把"当前这一份是什么"复制到两端；全量是幂等的，重发一次不会有第二种结果。
 * 2. **只认盘上真有的书号**（`pruneOrder`）：客户端那一份可能比盘上旧一点点
 *    （另一个标签页刚删掉一本），写进去一个死 id 会让清单从第一天起就带着垃圾。
 * 3. **回写剪过的那一份**，让调用方手上的次序与服务端对齐——不回的话，
 *    "丢掉了一个 id"这件事只发生在服务端，界面还以为它还在。
 * 4. ★ **不做"最多 N 条"那种上限**：一个书架上有几本书由盘上那几本决定，
 *    这里再多一道闸门只会变成第二个真相（真要有几万本，先出问题的是 `listBooks`）。
 */
export async function PUT(req: NextRequest): Promise<Response> {
  // ★ 次序是**每个人自己那一份**（`shelf/order.json` 也落在作用域里），
  //   所以这条也要认人——否则拖动一次就会把次序写进公共那一份
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonError(400, 'bad-json', '请求体不是合法的 JSON')
  }
  const order = (raw as { order?: unknown })?.order
  if (!Array.isArray(order) || order.some((one) => typeof one !== 'string')) {
    return jsonError(400, 'invalid-request', 'order 必须是一个书号数组')
  }

  try {
    const store = await createUserStore(assetRoot(), guard.session.userId)
    const existing = await listBooks(store, noCovers)
    const ids = pruneOrder(
      order as string[],
      existing.map((book) => book.bookId),
    )
    return Response.json({ order: await saveOrder(store, ids) })
  } catch (err) {
    return jsonError(500, 'library-write-failed', err instanceof Error ? err.message : String(err))
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  // ★ 闸门在**解析请求体之前**：这是三道闸里唯一真管用的那道（界面那两道只是体验）。
  //   要的是这一步真正需要的**一样**能力：文本（编故事不出图）。
  //   ★ 2026-10-17 之前这里要 `['text', 'image']`——那时候这一个请求会把整本画完。
  //   判不了权限时它回 503 而不是放行，见 `session.ts` 文件头第 3 条。
  const guard = await requireCapability(req, ['text'])
  if (!guard.ok) return guard.response

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
  const store = await createUserStore(root, guard.session.userId)
  const cardStore = createCardStore(store)
  const log = await createFsEventLog(userSliceRoot(root, guard.session.userId))

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
    // ★ 配音这一条曾经**整条没接**：`CreateBookBody` 上没有 voiceId、`toBookBody()`
    //   也不传，于是引擎收到的永远是 undefined，走那条非致命 error
    //   （"没指定音色，这本书没有朗读"）。工单 02 把它接上。
    ...(body.voiceId ? { voiceId: body.voiceId } : {}),
    // ★ 草稿 / 成品由**调用方**声明，引擎原样抄进清单（`BookRequest.status` 那段）
    ...(body.status ? { status: body.status } : {}),
  }
  const bookId = bookIdOf(request)
  /** 租约按人记：见 `runKeyOf` 那段（同一个主题在两个人手上是同一个书号） */
  const runKey = runKeyOf(guard.session.userId, bookId)
  /** ①的输入原样留下来（`story.json` 要它）：②与"重写一版"都靠它，不让客户端再传一遍 */
  const storyInput = storyInputOf(body, card.revision)

  /**
   * ★ 已经画过的书，**不许再编一遍故事**。
   *
   * 书号是"卡 + 版 + 形态 + 主题"的指纹，**不含时间戳**（`bookIdOf` 那段）。
   * 所以同一个孩子 + 同一个主题 = 同一个书号 = 同一个目录，而那个目录里已经躺着
   * 一本画好的书。旧代码在这里是**直接重跑整本**（把上一本的书页图覆盖掉、再付一次钱），
   * 而屏幕上什么都没说——用户以为只是"再开一本"。
   *
   * ★ 换成一句明说的拒绝，代价讲清楚：**同一个主题做不出第二本**。
   *   想再来一本，改一个字就是另一个书号（"会飞的绿天空" → "会飞的绿天空2"）；
   *   想改这一本，走书架「正在编辑」那一栏。
   *   （这不是新造的约束，是这条指纹本来就有的约束——只是以前它是**静悄悄**的。）
   */
  if (await bookExists(store, bookId)) {
    return jsonError(
      409,
      'book-exists',
      '这个主题你已经有一本了（在书架上）。想再来一本就把主题改一个字——主题不一样就是另一本；想改这一本，去书架的「正在编辑」找它。',
      { bookId },
    )
  }

  // 同一本书不许两轮同时跑：书号一样 = 目录一样，两份日志会交叉写入
  if (!tryStartRun(runKey)) {
    return jsonError(409, 'book-busy', '这本书正在生成中——等它跑完再点，或者改一个主题再试', {
      bookId,
    })
  }

  // 配置先建（它在第一个字节之前就该失败），再截断日志：顺序反了会在配置错误时留下一份空日志
  let providers
  try {
    providers = await createProviders({
      // ★ 密钥只从服务端环境来（ADR-0009）。请求体里那个 `env` 字段整条退场了，
      //   所以这里**没有**回退可写：`serverEnv()` 就是唯一来源
      env: serverEnv(),
      mode: body.mode ?? 'live',
      assetRoot: root,
      store,
    })
  } catch (err) {
    finishRun(runKey)
    const failure = userFailureOf(err)
    return jsonError(failure.status, failure.code, failure.message, {
      retryable: failure.retryable,
    })
  }

  // 重开一轮先截断：不截断就会把两轮混成一条时间线，重放出来的过程是假的
  // ★ 第二次来到这一条（上一次只编了故事、没画）时也截断：被弃掉的那一版故事
  //   不该留在日志里——`frames.ts` 的 `deskOf` 里 `total` 只增不减，
  //   12 页重写成 8 页之后会多出 4 个永远填不上的格子
  await log.truncate(bookId)

  const startedAt = Date.now()
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
        const plan = await planBook(request, { providers, onEvent })
        await chain
        // ★ 先写盘、再发收尾帧（文件头最后那一段）
        await writeStory(store, {
          bookId,
          input: storyInput,
          doc: plan.doc,
          provenance: {
            modelId: plan.modelId,
            promptVersion: plan.promptVersion,
            attempts: plan.attempts,
          },
          planMs: plan.elapsedMs,
          createdAt: startedAt,
        })
        // ★ `bookReady: false` 是这一条路的**正常终态**，不是失败：闸门就停在"故事好了、
        //   书还没有"这一刻。客户端收到它之后去 `GET /story` 把故事摊出来。
        // ★ `bookId` 非给不可：①没有 `book-ready` 事件（书还没画完），而客户端
        //   从这一刻起就要知道书号——取故事要用它、`sessionStorage` 也要记它
        send({ kind: 'status', running: false, bookReady: false, bookId })
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

/**
 * 异常 → 用户文案的翻译在 [`lib/provider-messages.ts`](../../../../lib/provider-messages.ts)。
 * ★ 它**不在这条路由里**，因为这份文案有两个消费者：这条流的 `fatal` 帧，
 *   与工单 04/05 那几处表单提交失败。写两份的那天起，两处就会开始说不一致的话。
 */
