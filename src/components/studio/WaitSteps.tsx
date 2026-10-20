'use client'

/**
 * WaitSteps —— 「这件事走到第几步」那一列（唯一的实现）
 *
 * 三个家：`/character/new` 左栏（读照片）、右上角（出图）、以及等待弹窗
 * （`AiWaitDialog.tsx`）。★ 前两个是弹窗被收起之后才画出来的——
 * 同一时刻屏幕上只该有一列（理由见 `NewChild.tsx` 那一段：两列会变成
 * 两个 `role="status"`，读屏会把同一句话念两遍）。
 *
 * 它只画，不判断：哪几步、哪一步是"现在"，全在 `wait-copy.ts`（纯函数，有测试）。
 *   组件这边一个 if 都不该有，否则"三步"这件事就有了第二个真相。
 *
 * 三档状态的画法（空圈 / 实心灰点 / 实心橙点在呼吸）在 `wait-steps.css` 里，
 *   连同「为什么不用 emoji 当图标」与静止模式那一条。
 */

import type { WaitStep } from '@/components/studio/wait-copy.ts'

export type WaitStepsProps = {
  steps: readonly WaitStep[]
  /**
   * 当前那一步后面那句轮播的话（`useRotatingLine` 给的）。
   * 它每 8 秒换一次，所以进不了读屏（`aria-hidden`）——不挡的话，
   *   外面那层 `role="status"` 每 8 秒打断用户一次。
   */
  say?: string
}

export default function WaitSteps({ steps, say }: WaitStepsProps) {
  // 一次请求的活没有三步（`wait-copy.ts` 那条判据），那时这一块整个不画
  if (steps.length === 0) return null

  return (
    // `role="status"`：这一列出现（以及它换状态）时读屏念一次。
    // 三步里"当前"那一步的点在呼吸——那是装饰，状态本身由字色与 `data-state` 说
    <ol className="ws" role="status">
      {steps.map((step) => (
        <li key={step.text} className="ws__step" data-state={step.state}>
          {step.text}
          {step.state === 'now' && say ? (
            <span className="ws__say" aria-hidden="true">
              {say}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
