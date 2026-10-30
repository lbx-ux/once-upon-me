/**
 * /api/books/[bookId]/illustrate —— ②–⑦ 逐页画 / 封面 / 配音 / 装订（故事闸门）
 *
 * ```
 *   POST /api/books/<bookId>/illustrate    { title, nodes }   ← 家长改过的那一份故事
 * ```
 *
 * 家长在 `StorySheet` 上过完一遍、点「就按这个画」，才走到这里。这是唯一真正花钱的一步
 * （一页一次出图，2026-10-21 实测 6–12 s/页；单价按厂商计费），所以这一条上的闸门比别处多：
 *
 * | 什么时候 | 回什么 | 为什么 |
 * | --- | --- | --- |
 * | 请求体里的故事过不了校验 | 400 + 逐条问题 | 学校验的与界面用的是同一个函数（`storyProblemsOf`），所以这里回的话就是屏幕上那句话 |
 * | `book.json` 已经在了 | 409 `book-exists` | 一次误点会再画一遍整本——每一页都是钱 |
 * | `story.json` 不在 | 404 `story-not-found` | 没有故事就画不出页，而"从空气里编一个"比报错糟 |
 * | 这一本正在跑 | 409 `book-busy` | 书号一样 = 目录一样，两份日志会交叉写入 |
 * | 要不到 `image` 能力 | 403/503（`requireCapability`） | 与开一本那一条的 `text` 是同一条口径 |
 *
 * 四件值得说明的处置：
 *
 * 1. `startSeq` 从日志里已有的最大号接上去（`maxSeqOf`）。②是另一个请求，
 *    序号从 1 重来的话日志里会出现两条 `seq: 1`，而 `seq` 正是重放重建界面状态的依据。
 * 2. `planMs` 与 `createdAt` 都从故事草稿来：前者让 `stats.elapsedMs` 在
 *    "脚本一次跑完"与"界面分两步"之间仍然可比（口径是机器时间，不含家长看故事的时间），
 *    后者让 `Book.createdAt` 说的是"这一本从哪一刻开始做"。
 * 3. 请求体里的故事与盘上那一份不一样时会写回去。不一样只可能是因为自动保存
 *    还差最后一拍（`StorySheet` 的自动保存），而"盘上留着的"必须就是"真拿去画的"那一段：
 *    两份数据打架是这一类功能最典型的坏法。
 * 4. 重放的最大号要读日志，不是"上一次跑完的号"：这一段日志在①之后还可能有
 *    家长触发的重写（那一条会截断日志），所以唯一可信的来源是当下的日志。
 */

import type { NextRequest } from 'next/server'
import {
  buildTree,
  createCardStore,
  createProviders,
  illustrateBook,
  maxSeqOf,
  type Cover,
  type EngineEvent,
  type Illustration,
  type Narration,
} from '@/lib/engine/index.ts'
import { encodeBookFrameToText, type BookStreamFrame } from '@/lib/book-stream.ts'
import { createFsEventLog } from '@/lib/event-log.ts'
import { assetRoot, bookExists, finishRun, runKeyOf, tryStartRun } from '@/lib/books-runtime.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'
import { readStory, storyRequestOf, writeStory, type StoryDraft } from '@/lib/story-draft.ts'
import { isStoryDoc } from '@/lib/story-draft.ts'
import { storyProblemText, storyProblemsOf } from '@/lib/story-problems.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'
import { createUserStore, userSliceRoot } from '@/lib/asset-scope.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'
import { refundOne, spendOne } from '@/lib/credits/server.ts'
import { clearProgress, readProgress, storyDigestOf, writeProgress } from '@/lib/book-progress.ts'
import { addNotice } from '@/lib/notices.ts'
import { asPlanDraft, planDraftCodec, type PlanDraft } from '@/lib/schemas/story.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const

function jsonError(status: number, code: string, message: string, extra?: unknown): Response {
  return Response.json({ code, message, ...(extra ? { extra } : {}) }, { status })
}

const ALREADY = '这本书已经画过了。要重做就是新做一本（换一个主题），或者在书架上改它。'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  // 闸门在解析请求体之前（与开一本那一条同一条纪律）。这一步要的是图像能力：
  // 它不出一个字、只出图与比对（比对走的是视觉模型，也归在 image 这一档）
  const guard = await requireCapability(req, ['image'])
  if (!guard.ok) return guard.response

  const { bookId } = await ctx.params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonError(400, 'bad-json', '请求体不是合法的 JSON')
  }

  const root = assetRoot()
  const store = await createUserStore(root, guard.session.userId)
  const draft = await readStory(store, bookId)
  if (!draft) {
    return jsonError(404, 'story-not-found', '这一本的故事不在了，回「创作」重新编一版吧')
  }
  if (await bookExists(store, bookId)) return jsonError(409, 'book-exists', ALREADY)

  if (!isStoryDoc(raw)) {
    return jsonError(400, 'invalid-request', '这一份故事读不出来（书名或每页内容不对）')
  }
  const doc = raw

  // 判据与界面上标出来的是同一个函数（`lib/story-problems.ts`）：
  //   所以这里回的那句话就是用户屏幕上已经看到的那句话，不会出现"界面说行、
  //   服务端说不行"这种两边各说各的
  const problems = storyProblemsOf(draft.input.form, doc)
  if (problems.length > 0) {
    return jsonError(400, 'invalid-request', storyProblemText(problems) ?? '故事还有问题', problems)
  }

  /**
   * 建树用的是 codec 归一化过的那一份，不是请求体里的原文。
   *
   * `planDraftCodec` 会 trim 掉两头的空白、把正文里的空行滤掉，而 `body: ['正文', '']`
   * 是能过校验的（滤完还剩一条）。照原文建树的话，书里会多出一个空行——
   * 而朗读那一层拿到空串会去要一段空白音频，厂商那边要么报错要么回一段静音，
   * 两种都不会在界面上说清"这一页没有正文了"（`engine/index.ts` 的
   * `rerunNarration` 为同一件事写明了"在这里就拒绝"）。
   * 判据与归一化因此是同一个 codec，只是取了它两次结果里的不同一半
   *   （`storyProblemsOf` 要问题、这里要值）。
   */
  const normalized = normalizedDocOf(doc)
  const built = buildTree(draft.input.form, normalized.title, normalized.nodes)
  if (!built.ok) {
    return jsonError(400, 'invalid-request', '这一份故事的结构不对，画不出来')
  }

  const card = await createCardStore(store).load(draft.input.cardId, draft.input.cardRevision)
  if (!card) {
    return jsonError(
      404,
      'card-not-found',
      `这一本要用的角色卡（${draft.input.cardId}）不在了，画不了`,
    )
  }

  // 租约按人记（`runKeyOf`）：画这一本的"在跑"只该挡住同一个账号的第二次点
  const runKey = runKeyOf(guard.session.userId, bookId)
  if (!tryStartRun(runKey)) {
    /* ★ 2026-10-17 改了文案：原来只说"等它画完再点"，而用户实测撞上的正是这一句
       ——他点完画、退出、从书架点回来（那时候这一本还没有 `book.json`），
       屏幕上是闸门 + 这句错话，看不到画到哪儿了。现在告诉他出口在哪：
       刷新这一页（或从书架点它）会落到运行视图，那里有进度。
       落点那一侧也一起改了（`GenerationRun` 的 `resume.story` 那一支）：服务器
         在跑就直接进运行视图；而点「就按这个画」撞上这一条时也会当场切过去。 */
    return jsonError(
      409,
      'book-busy',
      '这一本正在画。要看画到哪儿了，刷新这一页（或从书架的「正在编辑」点它）——画完之前不能再点这里。',
    )
  }

  let providers
  try {
    providers = await createProviders({ env: serverEnv(), mode: 'live', assetRoot: root, store })
  } catch (err) {
    finishRun(runKey)
    const failure = userFailureOf(err)
    return jsonError(failure.status, failure.code, failure.message)
  }

  /**
   * 扣额度：★ **在租约之后、真正开画之前**。
   *
   * 为什么在这个位置而不是更早：前面每一条 4xx（书已经画过、故事不在、正在跑、
   * 角色卡不在）都不该扣钱。为什么不是更晚：`illustrateBook` 一开口就花钱，
   * 扣在它后面等于"花了才发现没额度"。
   *
   * 为什么扣在租约之后：租约挡住的是"同一本正在画"的第二次点击，
   * 那一条会在扣之前返回 409——不然一次误点会扣两次。
   *
   * ★ 余额是在 Java 那张余额表上用一条带条件的 UPDATE 扣的
   * （`balance = balance - 1 WHERE balance >= 1`），不是"这里先读再减"。
   * 两个标签页同时点这一下时，只有一条能成功。
   */
  const token = sessionTokenOf(req) ?? ''
  const log = await createFsEventLog(userSliceRoot(root, guard.session.userId))
  const { events } = await log.read(bookId)

  /**
   * ★ 断点续画（2026-10-30）。上一轮画到一半失败时留下的那份断点，指纹与这一版故事
   * 对得上才作数（故事改过 = 页号与正文都变了，那份断点指向的是另一本书）。
   *
   * 有断点 ⇒ **这一次不扣额度**：一个书号只该收一次，而那一次已经收过了。
   * 没有 ⇒ 走老路：先结清上一轮（零页的那种），再扣这一次。
   */
  const progress = await readProgress(store, bookId)
  const digest = storyDigestOf(built.tree)
  const resumed = progress !== null && progress.digest === digest ? progress : null
  const resuming = resumed !== null && resumed.illustrations.length > 0

  if (!resuming) {
    /* ★ 先结清上一轮：判据与下面那个退款分支同一句——**这本书的事件日志里一条
       `illustration` 都没有** = 一页都没画出来。而走到这里还没被 409 挡掉，
       说明这次是"同一本书再画一遍"。于是"扣过、却没人退成"的那一笔只可能来自
       一种情况：上一轮**扣完、开画的路上进程没了**（部署、OOM、systemd 拉起），
       `catch` 与 `finally` 都没轮到。

       为什么敢无条件打这一下：Java 那边按书号封顶（只退"扣过 − 退过"那部分），
       且按次退。所以"这本书从没扣过"回 400、"已经退过"回 200 不动余额，
       两种都是我们要的噪音而不是错误——`.catch` 吞掉即可。 */
    if (!events.some((event) => event.kind === 'illustration')) {
      await refundOne(token, bookId).catch(() => undefined)
    }

    const spent = await spendOne(token, bookId)
    if (!spent.ok) {
      finishRun(runKey)
      // `status: 0` 是"后端没通"（见 `lib/auth/response.ts`），归到 503
      return jsonError(spent.status >= 400 ? spent.status : 503, spent.code, spent.message)
    }
  }

  // 见文件头第 3 条：盘上留着的必须是真拿去画的那一段（所以写的是归一化过的那一份）
  // ★ 这一段在 `tryStartRun` 之后、流建立之前，所以它的失败要自己还租约
  //   （2026-10-22 审查）：写不进去时原来直接 500 冒出去，`finishRun` 永远轮不到，
  //   这本书就一直回 409「正在画」，直到进程重启。
  if (!sameDoc(normalized, draft.doc)) {
    const next: StoryDraft = { ...draft, doc: normalized, editedAt: Date.now() }
    try {
      await writeStory(store, next)
    } catch (err) {
      finishRun(runKey)
      // ★ 已经扣过了：写盘失败意味着这一轮一页都不会画，退回去
      await refundOne(token, bookId).catch(() => undefined)
      const failure = userFailureOf(err)
      return jsonError(failure.status, failure.code, failure.message)
    }
  }

  const request = storyRequestOf(draft.input, card)
  const encoder = new TextEncoder()
  let clientGone = false
  /**
   * 这一轮画出来了几页。★ 退款判据用它，不用 `stats`：
   * 失败时 `illustrateBook` 可能根本没返回，而事件是一条条到的。
   * 只认 `illustration`（那一页的图真的落盘了），不认 `retry`——
   * 重画过一次但最终没成的页也花过钱，只是这一页没拿到东西。
   */
  // ★ 断点里已经有几页：退款判据要算上它们（否则"接着画、这一轮一页没画成"
  //   会被读成"整本零页"，把上一笔额度也退掉——白送一本）
  let pagesDrawn = resumed?.illustrations.length ?? 0

  /**
   * 断点落盘。★ 串成一条链：出图是并发的（上限 3），两份快照同时写会乱序，
   * 而乱序的结果是断点退回上一版（少几页），下一轮就重画那几页——每一页都是钱。
   */
  let saving: Promise<void> = Promise.resolve()
  const saveProgress = (value: {
    illustrations: readonly Illustration[]
    cover: Cover | null
    narrations: readonly Narration[]
  }): void => {
    saving = saving
      .then(() => writeProgress(store, bookId, { digest, ...value }))
      .catch(() => undefined)
  }

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
        if (event.kind === 'illustration') pagesDrawn += 1
        chain = chain.then(async () => {
          await log.append(bookId, event)
          send({ kind: 'engine', event })
        })
      }

      try {
        const book = await illustrateBook(request, built.tree, {
          providers,
          onEvent,
          startSeq: maxSeqOf(events),
          planMs: draft.planMs,
          createdAt: draft.createdAt,
          // ★ 续画：把断点里那几页递进去，引擎跳过它们（不重画 = 不再付钱）
          ...(resumed
            ? {
                resume: {
                  illustrations: new Map(resumed.illustrations.map((one) => [one.pageNo, one])),
                  ...(resumed.cover ? { cover: resumed.cover } : {}),
                  ...(resumed.narrations.length > 0 ? { narrations: resumed.narrations } : {}),
                },
              }
            : {}),
          onProgress: saveProgress,
        })
        await chain
        // ★ 装订完 = `book.json` 已经在盘上，断点就该走了（留着只会让"盘上有断点"
        //   这件事有两种意思）。先等落盘那条链跑完，别把刚写的删成半截。
        await saving
        await clearProgress(store, bookId)
        /* ★ 一页都没画出来（所有页都失败，但引擎按"一页失败不影响整本"吞掉了）：
           这一本没有可读的内容，额度必须退回；也不能发 `book-ready`——
           那会让界面把一本空书说成"做好了"。
           ★ 退的判据在 Java 那边是"这本书扣过几次、退过几次"，两个合计对齐：
             这次重试扣的那一本退得回来，退的合计也不会超过扣的（2026-10-30 改）。 */
        if (book.stats.nodesGenerated === 0) {
          /* ★ 退没退成，话得分开说（2026-10-30）：这一句原来是写死的"额度已经退回"，
             而退款是一次网络请求。退不回去时说退了，用户会以为自己还欠着一本，
             或者反过来——他去兑换页发现少了一本，以为是我们吃了。 */
          const refund = await refundOne(token, bookId).catch(() => null)
          send({
            kind: 'fatal',
            code: 'no-pages',
            message:
              refund !== null && refund.ok
                ? '这一本一页都没画出来，额度已经退回。多半是模型那一头的问题，过一会儿再试；这一本要先从书架上删掉，才能重做。'
                : `这一本一页都没画出来，但额度这次没能自动退回（${refund?.message ?? '连不上服务'}）。把这个书号发给站长，让他从后台补回来。`,
            retryable: true,
          })
          return
        }
        /* 站内信（2026-10-30）：一本书实测要 12–174 分钟，画完那一刻用户多半不在这块屏前。
           写失败不挡收尾帧——书已经画完了，不该因为一条通知写不进去就把这一轮说成失败。
           ★ 写在 `book.json` 之后（`illustrateBook` 返回就是装订完了）：早了会通知一本
             还读不开的书，用户点进来是 404。 */
        await addNotice(store, {
          kind: 'book-ready',
          bookId,
          title: normalized.title,
        }).catch(() => undefined)
        send({ kind: 'status', running: false, bookReady: true })
      } catch (err) {
        const failure = userFailureOf(err)
        await chain.catch(() => undefined)
        /* ★ 一页都没画出来就失败了：额度退回。画出来过就不退——
           那几页的图是真花了钱的，退等于让一次"画到一半撤了"变成免费。
           判据是上面那个 `pagesDrawn`，不是异常的文案。 */
        if (pagesDrawn === 0) {
          await refundOne(token, bookId).catch(() => undefined)
        }
        /* 失败也留一条：这条路的失败常常发生在用户离开几十分钟之后
           （出图超时、网关排队、审核拦下），不记下来，他回来只看到一屏安静的画桌。 */
        await addNotice(store, {
          kind: 'book-failed',
          bookId,
          title: normalized.title,
          message: failure.message,
        }).catch(() => undefined)
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

/** 两份故事是不是同一份。比 JSON 原文就够：两边都是 JSON 进出的同一形状 */
function sameDoc(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * 过一遍 codec，拿它归一化之后的那一份（trim / 丢空行）。
 *
 * 只在"上面那一关已经放行"之后调用：`parse` 不 ok 时原样回传入的那一份
 *   （那时候已经 400 了，这个返回值不会被用到），所以这里不需要再处理一次失败。
 */
function normalizedDocOf(doc: PlanDraft): PlanDraft {
  const parsed = planDraftCodec.parse(doc, '')
  return parsed.ok ? asPlanDraft(parsed.value) : doc
}
