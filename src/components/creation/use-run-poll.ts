'use client'

/**
 * use-run-poll.ts —— 阶流不在手上时，靠重读日志把进度补上（工单 D-34，2026-10-21 拆出）
 *
 * 它是**替补**，不是主路：SSE 只在"我们自己发起的那个请求"活着的时候才在手上
 * （「就按这个画」那一条），而这一屏在三种情况下手上什么都没有——
 * 刷新之后回到运行视图、从书架点进"正在编辑"的那一本、以及 409 `book-busy`
 * 之后切过来的那一档（多半是另一个标签页点的）。
 *
 * 三条实现上的讲究（都是踩出来的）：
 *
 * 1. ★ **`setTimeout` 链，不是 `setInterval`**：每一轮读完之后才排下一轮。
 *    `setInterval` 在慢网络下会同时挂好几条"读同一份日志"的请求，而它们的结果
 *    还会互相覆盖——症状是画桌在两份快照之间来回跳。
 * 2. ★ **只有"服务端在跑、而这一屏没连着那条流"时才拨**。`phase === 'running'`
 *    那一条正是"有 SSE 在喂"的意思，所以它被排除在外：那时候再插一手，
 *    两个来源会同时往同一张桌子上写。
 * 3. ★ **读不回来就停住**，不反复重试、也不把已经画出来的那几格擦掉：
 *    网络断掉时"停在最后一个已知状态"比"清空"诚实。
 *
 * ★ 它写进画桌的那条路走 `sink.replace`（`use-run-stream.ts` 的文件头第 1 条）：
 *   这一处原来自己抄了一遍 `eventsRef.current = events; setDesk(deskOf(events))`。
 */

import { useEffect, useState } from 'react'

import { replayFrames } from '@/lib/creation/api.ts'

import type { Phase } from './phase.ts'
import type { RunSink } from './use-run-stream.ts'

/**
 * 轮询的间隔（毫秒）。★ 它是**兜底**，不是主路。
 *
 * 来历（2026-10-21，工单 D-44）：
 *
 * 这一屏原来靠它报进度，间隔 **5 秒**。评分报告在 §2.16（−5）与 §2.17（−4）
 *   各扣了一次，理由是同一条："看不到画的什么"这个报障的修法**是轮询**，
 *   而粒度偏粗——真正该做的是把引擎那三件已经写好的流式接上（那是工单 D-04）。
 *   用户实测报的原话也是"他告诉我正在生成中，我看不到画的什么"。
 *
 * 2026-10-21 之后：
 *   - 「就按这个画」那一轮有 SSE（`use-run-stream.ts` 的 `onIllustrateFrame`），
 *     而**这一屏不再插一手**（下面那个 `phase !== 'replaying'` 那一格就是它）；
 *   - 编故事那一轮也有 SSE 了（工单 D-04），而且**增量**比轮询细得多；
 *   - 于是轮询只剩一条路：**手上没有流**的时候（刷新之后回到这一屏、
 *     从书架点进"正在编辑"的那一本、409 `book-busy` 之后切过来的那一档）。
 *
 * 那一条路上它仍然是必须的（`GET /events` 是一次性回吐，不是长连接），
 *   但可以慢下来：一条事件几 KB，而一页是分钟级的。
 * 15 秒是"最坏情况下也不至于让人以为卡死了"的量级；5 秒换来的是三倍的请求量，
 *   而那些请求多半回的是同一份日志。
 */
export const RUN_POLL_MS = 15000

export function useRunPoll(args: {
  bookId: string | null
  serverRunning: boolean
  phase: Phase
  sink: RunSink
  setServerRunning: (next: boolean) => void
  setPhase: (next: Phase) => void
  loadRunPages: (bookId: string) => Promise<void>
}): void {
  const { bookId, serverRunning, phase, sink, setServerRunning, setPhase, loadRunPages } = args

  /**
   * 排下一轮的那个计数器。★ 用 `setTimeout` 链而不是 `setInterval`：见文件头第 1 条。
   */
  const [pollTick, setPollTick] = useState(0)

  useEffect(() => {
    // 只有"服务器在跑、而这一屏没连着那条流"时才拨（`phase === 'running'` 时
    // 有 SSE 在喂，不需要也不该再插一手）
    if (!bookId || !serverRunning || phase !== 'replaying') return
    let stopped = false

    const timer = setTimeout(() => {
      void replayFrames(bookId)
        .then(({ events, status }) => {
          if (stopped) return
          sink.replace(events)
          setServerRunning(status?.running ?? false)
          if (status?.bookReady) {
            // 跑完了：书已经在盘上，画桌自己会切成"成品"那一张
            setPhase('ready')
            void loadRunPages(bookId)
          } else {
            setPollTick((n) => n + 1)
          }
        })
        .catch(() => {
          // 读不回来就停在这儿：不反复重试，也不把已经画出来的那几格擦掉
          if (!stopped) setServerRunning(false)
        })
    }, RUN_POLL_MS)

    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [bookId, serverRunning, phase, pollTick, sink, setServerRunning, setPhase, loadRunPages])
}
