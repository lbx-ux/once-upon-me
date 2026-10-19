'use client'

/**
 * use-reading-prefs.ts —— 「设置」里那两份真值的**读法**
 *
 * 两个读者：设置弹窗（写）与两台阅读器（读）。它们在不同的路由里，
 * 中间隔的就是 `localStorage`——所以这两个 hook 都只做两件事：挂载后读一次、
 * 选的时候写一次。
 *
 * ★ **初值一律默认，挂载之后才读盘**。这一条不是保守，是必须的：
 *   服务端渲染那一趟读不到 `localStorage`，所以首屏 HTML 只能是默认值；
 *   要是把初值写成"读得到就读"的样子，客户端第一次渲染就会与那份 HTML 不一致
 *   ——轻则闪一下，重则 hydration 报错。`AppShell` 的侧栏折叠（`COLLAPSE_KEY`）
 *   就是同一件事的第一处，那里的注释写着同一条推理。
 *   ★ 代价认下：选了自动朗读的人，进阅读器时会先看到一瞬「▶ 朗读」再变成
 *     「▶ 自动朗读」。那是两个字的一次替换，而它换来的是首屏不会错。
 *     ★ 2026-10-18 加的底图那一档把这条代价放大了：它换的不是两个字，是**整屏的底**。
 *       仍然这么办——另一条路（把偏好读在服务端）要动 cookie 与渲染方式，
 *       而这一屏的底图只是"两层色差几个级"，闪一下远不到"先看错一屏"。
 *
 * ★ 不做跨标签页同步（`storage` 事件）：设置弹窗与阅读器不会同时开着——
 *   两个阅读器都不在 `(studio)` 路由组里，侧栏压根不出现。
 */

import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_READER_PAPER,
  loadReaderPaper,
  paperOf,
  saveReaderPaper,
  type ReaderPaperOption,
} from './reader-paper.ts'
import { DEFAULT_TURN_MODE, loadTurnMode, saveTurnMode, type TurnMode } from './reading-prefs.ts'
import {
  DEFAULT_ROTATE_HINT,
  loadRotateHint,
  saveRotateHint,
  type RotateHintMode,
} from './rotate-hint.ts'

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

/**
 * 阅读器那层底图。两台阅读器共用同一个偏好（`reader-paper.ts` 文件头第 4 条）。
 * 返回值是**那一档本身**（不是键）：调用方要的就是"铺哪张图"。
 */
export function useReaderPaper(): {
  paper: ReaderPaperOption
  setPaper: (key: string) => void
} {
  const [paper, apply] = useState<ReaderPaperOption>(DEFAULT_READER_PAPER)

  useEffect(() => {
    apply(loadReaderPaper())
  }, [])

  const setPaper = useCallback((key: string): void => {
    // ★ 存的与用的是同一个来源：落的那个键一定能在表里查到（`paperOf` 查不到会退回默认），
    //   所以下次读回来一定还是这一档
    const picked = paperOf(key)
    apply(picked)
    saveReaderPaper(picked.key)
  }, [])

  return { paper, setPaper }
}

/**
 * 竖屏进阅读器时那层「把手机横过来」还问不问（2026-10-19）。
 *
 * ★ 与上面那两个同一个分法（初值默认、挂载后读一次、选一下写一次）。这里的代价
 *   比底图那一档还小：读盘那一瞬的差别是"提示在不在"，而它在竖屏下是**一层压着
 *   大量内容的遮罩** —— 早一帧出现反而更像这一屏本来就有它，所以照旧这么办，
 *   不为它破例去读 cookie。
 *
 * ★ 与另外两份**不同**的是：这一份的 `setter` 有两个调用方，而且方向不同 ——
 *   阅读器里那颗「仍然竖着看」只写 `off`，设置里那两颗两个方向都能写。
 *   所以这里给的是**通用的 `setRotateHint(mode)`**，不是 `dismissRotateHint()`：
 *   一个只能关不能开的开关是陷阱，而那个"开"的入口必须真的存在
 *   （`SettingsDialog` 那一节就是它）。
 */
export function useRotateHint(): {
  rotateHint: RotateHintMode
  setRotateHint: (mode: RotateHintMode) => void
} {
  const [rotateHint, apply] = useState<RotateHintMode>(DEFAULT_ROTATE_HINT)

  useEffect(() => {
    apply(loadRotateHint())
  }, [])

  const setRotateHint = useCallback((mode: RotateHintMode): void => {
    apply(mode)
    saveRotateHint(mode)
  }, [])

  return { rotateHint, setRotateHint }
}
