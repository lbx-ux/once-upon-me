'use client'

/**
 * use-rotating-line.ts —— 等待时**轮着播**的那一句话
 *
 * 两个读者，两处都是"同一件活的同一句话"：
 *   ① `/character/new` 那一屏**原地**的那一行（弹窗被收起之后它还在那儿）；
 *   ② 那个弹窗自己（`AiWaitDialog.tsx`）。
 * 所以它从 `NewChild.tsx` 里搬出来住在这儿——两处各写一份的话，下一次改文案
 * 只会改到其中一处，而"同一句话在两个地方不一样"是没人会去量的那种坏。
 *
 * ★ **为什么会走到"只能播话"这一步**（这条比这个 hook 本身重要）：
 *   这几件活（读照片 / 出图）在浏览器这边都是**一次性回包**——在它返回之前
 *   收不到任何中间消息，不知道模型读到第几格了、也不知道它在想还是在写。
 *   所以这两屏上**不许**出现百分比进度条：那是一条按时间编出来的假进度，
 *   而这个项目里假的东西比没有更糟（README §五）。
 *
 * ★ 于是那几句话立了一条纪律：**只说"还在办"，不说"办到哪儿了"**。
 *   - 可以说：加急、在画、快好了——它们不承诺任何具体的进度或时刻；
 *   - 不许说：「已经画好 80%」「还剩 10 秒」「正在检查五官」——那几句要么是编的进度，
 *     要么是在讲模型内部的状态，而我们**看不到**它。
 *   ★ 那句话的清单在 `components/studio/wait-copy.ts`，纪律有一条**机器版**：
 *     `wait-copy.test.ts` 断言那几句里不出现数字与百分号。
 */

import { useEffect, useState } from 'react'

/**
 * 每句播多久。
 *
 * ★ 8 秒是照着实测时长挑的：读照片约 45 秒（走完一轮半）、出图约 24 秒（走三轮）
 *   ——不会快到像在闪，也不会慢到像卡住。
 */
export const ROTATE_MS = 8000

/**
 * `active` 变 false 时回到第一句：下一次点按钮要重新从「正在加急处理中」开始，
 * 而不是接着上一轮的中间（上一轮结束在哪句是随机的，接着播会让"重新开始"
 * 看起来像"还在上一轮里"）。
 */
export function useRotatingLine(lines: readonly string[], active: boolean): string {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      setIndex(0)
      return
    }
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % lines.length)
    }, ROTATE_MS)
    return () => clearInterval(timer)
  }, [active, lines])

  return lines[index] ?? lines[0] ?? ''
}
