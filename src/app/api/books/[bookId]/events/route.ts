/**
 * GET /api/books/<bookId>/events —— 把这一轮的生成过程重放出来（工单 02 §2.3）
 *
 * 回答的是刷新页面之后的那个问题："我刷新之前发生了什么？"
 *
 * 四条约定：
 *
 * 1. **帧格式与实时流完全一样**（`engine` 帧逐条原样），所以客户端只需要一个解码器、
 *    一个事件处理器：实时与重放走同一段渲染代码。两份的话，重放出来的一定与实时不一样。
 * 2. **只回语义事件**。`delta`（打字机增量）不落盘，所以重放里没有它——
 *    这是刻意的：日志的判据是"能重建同一串**界面状态**"，不是"能重建同一段动画"（工单 07 §三）。
 * 3. **收尾给一条 `status` 帧**，如实说三件事：这一轮还在跑吗、成品在不在、
 *    日志里有没有读不出来的行。
 *    ★ 没有这一帧，客户端只能从"日志到这儿就没了"去猜，
 *    而"服务器上还在跑"与"这一轮死掉了"的界面文案完全不同。
 *    猜错的代价是一个永远转下去的圈，那是在撒谎。
 * 4. **坏行数随 status 一起报**（不是发一条 SSE 注释）：`events.jsonl` 在进程被杀的
 *    瞬间可能留下半行，读的时候会跳过它。跳过是必须的，**不说**是不行的——
 *    不说的话，没人分得清"少了 3 条事件"是引擎没发还是日志读坏了。
 *
 * ★ 路由参数在 Next 里已经解码过一次，这里不再 `decodeURIComponent`（重复解码会让
 *   带 `%` 的 id 直接抛错，而这类错在本地永远碰不到，只在别人手上碰得到）。
 */

import { createFsEventLog } from '@/lib/event-log.ts'
import { encodeBookFrameToText, type BookStreamFrame } from '@/lib/book-stream.ts'
import { assetRoot, bookExists, isRunning } from '@/lib/books-runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  const { bookId } = await ctx.params
  const log = await createFsEventLog(assetRoot())
  const { events, skipped } = await log.read(bookId)

  const frames: BookStreamFrame[] = [
    ...events.map((event): BookStreamFrame => ({ kind: 'engine', event })),
    {
      kind: 'status',
      running: isRunning(bookId),
      bookReady: await bookExists(bookId),
      skippedLines: skipped,
    },
  ]

  return new Response(frames.map(encodeBookFrameToText).join(''), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}
