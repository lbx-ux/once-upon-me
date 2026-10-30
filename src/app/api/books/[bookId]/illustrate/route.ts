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
  type EngineEvent,
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
import { requireCapability } from '@/lib/auth/session.ts'
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

  const log = await createFsEventLog(userSliceRoot(root, guard.session.userId))
  const { events } = await log.read(bookId)

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
      const failure = userFailureOf(err)
      return jsonError(failure.status, failure.code, failure.message)
    }
  }

  const request = storyRequestOf(draft.input, card)
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
        await illustrateBook(request, built.tree, {
          providers,
          onEvent,
          startSeq: maxSeqOf(events),
          planMs: draft.planMs,
          createdAt: draft.createdAt,
        })
        await chain
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
