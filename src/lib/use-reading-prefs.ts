'use client'

/**
 * use-reading-prefs.ts —— 「设置 · 阅读偏好」那一份真值的**读法**
 *
 * 两个读者：设置弹窗（写）与两个阅读器（读）。它们在不同的路由里，
 * 中间隔的就是 `localStorage`——所以这个 hook 只做两件事：挂载后读一次、
 * 选的时候写一次。
 *
 * ★ **初值一律默认（手动），挂载之后才读盘**。这一条不是保守，是必须的：
 *   服务端渲染那一趟读不到 `localStorage`，所以首屏 HTML 只能是默认值；
 *   要是把初值写成"读得到就读"的样子，客户端第一次渲染就会与那份 HTML 不一致
 *   ——轻则闪一下，重则 hydration 报错。`AppShell` 的侧栏折叠（`COLLAPSE_KEY`）
 *   就是同一件事的第一处，那里的注释写着同一条推理。
 *   ★ 代价认下：选了自动朗读的人，进阅读器时会先看到一瞬「▶ 朗读」再变成
 *     「▶ 自动朗读」。那是两个字的一次替换，而它换来的是首屏不会错。
 *
 * ★ 不做跨标签页同步（`storage` 事件）：设置弹窗与阅读器不会同时开着——
 *   两个阅读器都不在 `(studio)` 路由组里，侧栏压根不出现。
 */

import { useCallback, useEffect, useState } from 'react'

import { DEFAULT_TURN_MODE, loadTurnMode, saveTurnMode, type TurnMode } from './reading-prefs.ts'

export function useTurnMode(): {
  turnMode: TurnMode
  setTurnMode: (mode: TurnMode) => void
} {
  const [turnMode, apply] = useState<TurnMode>(DEFAULT_TURN_MODE)

  useEffect(() => {
    apply(loadTurnMode())
  }, [])

  /** 选一下就落盘：这层没有"保存"按钮，也没有第二个家 */
  const setTurnMode = useCallback((mode: TurnMode): void => {
    apply(mode)
    saveTurnMode(mode)
  }, [])

  return { turnMode, setTurnMode }
}
