'use client'

/**
 * app/error.tsx —— 根错误边界
 *
 * 这一层接的是**根布局底下那棵树**里抛出来的异常：任何一屏在渲染期抛了错，
 * 用户看到的就是下面这张纸，而不是 Next 自带的那个黑底白字错误页。
 * （根布局**自己**抛的错不在这里 —— 那要 `global-error.tsx`，它得自带
 * `<html>`/`<body>`。没有加它，理由见下。）
 *
 * ---------------------------------------------------------------------------
 * 两条判断
 *
 * 1. **只做"重试"，不做自动刷新。** `reset()` 重挂这一棵子树；整页 `location.reload()`
 *    会把用户为了走到这一屏做的那几步（滚动位置、已经填了一半的表单、正在跑的那次生成）
 *    一起丢掉。这一条与全站"不替用户做决定"是同一句话。
 * 2. **不做 `global-error.tsx`。** 它会顶掉根布局，于是既没有设计令牌、
 *    也没有两个 Provider，要另搭一套最小的样式 —— 而它能多接住的那一类错误
 *    （根布局自己抛）在这个站里基本不存在：根布局只挂 Provider，而
 *    `AuthProvider` 自己把 `/api/auth/me` 的失败收在 `meError` 里（它是一条
 *    有名字的状态，不是异常）。为一个接不住东西的边界写第二套页面，是拿"看起来完整"
 *    换维护面。真要接住根布局那一天再加，加的时候它会用上同一张纸。
 *
 * 文案、延迟显形与按钮的理由都写在 `components/system/SystemNotice.tsx` 的文件头。
 */

import SystemNotice from '@/components/system/SystemNotice.tsx'

export default function RootError({
  error,
  reset,
}: {
  /** `digest` 是 Next 给这次失败的摘要，生产环境才有（dev 下是 undefined） */
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <SystemNotice kind="error" digest={error.digest} reset={reset} />
}
