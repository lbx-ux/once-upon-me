/**
 * book-stream.ts —— 生成过程这条 SSE 流上跑的**帧协议**（app 层，引擎不认识它）
 *
 * `engine/events.ts` 是引擎与界面之间的 seam，它定义了**语义事件**。
 * 这一层是那条 seam 的**传输形态**：一帧 = 一个 `SseFrame`，
 * 载荷是下面这四个变体之一。
 *
 * 为什么要有 `delta` 与 `fatal` 两个变体，而不是全塞进 `EngineEvent`：
 *
 * 1. **`delta`（展示用增量，工单 07）不落盘**。落盘的判据是"重放这份日志必须能
 *    重建出同一串界面状态"——token 级增量满足不了这条（重放一段打字机动画没有意义），
 *    而它会把这几十行的日志变成几十万行。两个寿命不同的东西塞进一个通道，
 *    结果一定是日志被废掉。
 * 2. **`fatal`（流级硬失败）不是引擎事件**。引擎抛出的异常（角色卡不合格、
 *    provider 配置缺失）会**终止这一轮**，它不是"某个阶段出了一条非致命事件"。
 *    一次性返回结果的写法里它是 HTTP 500；流已经开了之后，它只能是一条帧。
 *
 * ★ `status`（重放结束时的那一帧）解决的是一个具体的撒谎场景：
 *   刷新之后，客户端只知道"日志到这里为止"，它**分不出**
 *   "服务器上还在跑"与"这一轮死掉了"。这两种情况的界面文案完全不同，
 *   所以必须由服务端如实告诉它——见工单 02 §2.3。
 */

import type { EngineEvent } from './engine/index.ts'
import { encodeFrame, type SseFrame } from './engine/sse.ts'

export type BookStreamFrame =
  | { kind: 'engine'; event: EngineEvent }
  /** 展示用增量，**不落盘**（工单 07）。`pageNo` 缺省表示"还没到某一页"（规划期的标题） */
  | { kind: 'delta'; pageNo?: number; text: string; streamed: boolean }
  /**
   * 这一轮终止了。
   *
   * ★ `code` / `message` / `retryable` 全部由服务端算好（`provider-messages.ts` 的
   *   `userFailureOf`）：**可重试性与文案必须同源**，否则会出现"这句话说 key 不对、
   *   下面却贴一个『可以再点一次』"这种自相矛盾（实测差点就这么上了）。
   */
  | { kind: 'fatal'; code: string; message: string; retryable?: boolean }
  /** 重放的收尾帧：这一轮还在跑吗、成品在不在、日志里有没有读不出来的行 */
  | { kind: 'status'; running: boolean; bookReady: boolean; skippedLines?: number }

export const BOOK_FRAME_KINDS = ['engine', 'delta', 'fatal', 'status'] as const

/** 这一帧要不要写进 `events.jsonl`。**只有语义事件落盘**，其余三个都是传输层的产物 */
export function isLoggable(frame: BookStreamFrame): boolean {
  return frame.kind === 'engine'
}

export function encodeBookFrame(frame: BookStreamFrame): SseFrame {
  return { event: frame.kind, data: JSON.stringify(frame) }
}

/** 反解一帧。认不出来的返回 null——**不抛**，因为一条坏帧不该让整条流断掉 */
export function decodeBookFrame(frame: SseFrame): BookStreamFrame | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(frame.data)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const kind = (parsed as { kind?: unknown }).kind
  if (typeof kind !== 'string') return null
  if (!(BOOK_FRAME_KINDS as readonly string[]).includes(kind)) return null
  // 只核 kind：载荷的字段级校验交给消费者（事件本身是引擎产出并已落盘的，
  // 在这里再定义一套校验就等于给同一个协议写两份判据）
  return parsed as BookStreamFrame
}

/** 帧 → 线上字节。写在这里而不是让调用方自己拼，是为了让"编码"只有一处 */
export function encodeBookFrameToText(frame: BookStreamFrame): string {
  return encodeFrame(encodeBookFrame(frame))
}
