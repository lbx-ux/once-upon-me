'use client'

/**
 * use-reading-prefs.ts —— 「设置」里那两份真值的读法
 *
 * 两个读者：设置弹窗（写）与两台阅读器（读）。它们在不同的路由里，
 * 中间隔的就是 `localStorage`——所以这两个 hook 都只做两件事：挂载后读一次、
 * 选的时候写一次。
 *
 * ★ 初值一律默认，挂载之后才读盘。这一条不是保守，是必须的：
 *   服务端渲染那一趟读不到 `localStorage`，所以首屏 HTML 只能是默认值；
 *   要是把初值写成"读得到就读"的样子，客户端第一次渲染就会与那份 HTML 不一致
 *   ——轻则闪一下，重则 hydration 报错。`AppShell` 的侧栏折叠（`COLLAPSE_KEY`）
 *   就是同一件事的第一处，那里的注释写着同一条推理。
 *   ★ 代价认下：选了自动朗读的人，进阅读器时会先看到一瞬「▶ 朗读」再变成
 *     「▶ 自动朗读」。那是两个字的一次替换，而它换来的是首屏不会错。
 *     2026-10-18 加的底图那一档把这条代价放大了：它换的不是两个字，是整屏的底。
 *       仍然这么办——另一条路（把偏好读在服务端）要动 cookie 与渲染方式，
 *       而这一屏的底图只是"两层色差几个级"，闪一下远不到"先看错一屏"。
 *
 * 不做跨标签页同步（`storage` 事件）：设置弹窗与阅读器不会同时开着——
 *   两个阅读器都不在 `(studio)` 路由组里，侧栏压根不出现。
 *
 * 2026-10-20：`useTurnMode` 一个变两个（`useSharedTurnMode`），因为阅读偏好里
 *   多了一节「共读版」，两档各落一个键。两者共用下面那个 `useStoredTurnMode`——
 *   它们只该在"读哪个键"上不同。
 */

import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_READER_PAPER,
  loadReaderPaper,
  paperOf,
  saveReaderPaper,
  type ReaderPaperOption,
} from './reader-paper.ts'
import {
  DEFAULT_TURN_MODE,
  loadSharedTurnMode,
  loadTurnMode,
  saveSharedTurnMode,
  saveTurnMode,
  type TurnMode,
} from './reading-prefs.ts'
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
  const [turnMode, setTurnMode] = useStoredTurnMode(loadTurnMode, saveTurnMode)
  return { turnMode, setTurnMode }
}

/**
 * 共读版那一档（2026-10-20）。与上面那个同形、同一份实现，只是读另一个键
 * （`SHARED_TURN_MODE_KEY`）——两档各选各的，理由写在 `reading-prefs.ts` 的文件头。
 * 阅读器按 `story.form` 二选一喂给朗读那一套，所以这一屏最多读两个 `localStorage`
 *   键、各一次，代价可以忽略。
 */
export function useSharedTurnMode(): {
  turnMode: TurnMode
  setTurnMode: (mode: TurnMode) => void
} {
  const [turnMode, setTurnMode] = useStoredTurnMode(loadSharedTurnMode, saveSharedTurnMode)
  return { turnMode, setTurnMode }
}

/**
 * 「挂载后只读一次、选一下就落盘」这一套的唯一一份。
 * 两个 turn-mode 钩子共用它，是刻意的：它们只该在读哪个键上不同，
 *   连初值或落盘时机上有一点差别都会变成"两种形态里同一个偏好的脾气不一样"。
 */
function useStoredTurnMode(
  load: () => TurnMode,
  save: (mode: TurnMode) => void,
): [TurnMode, (mode: TurnMode) => void] {
  const [mode, apply] = useState<TurnMode>(DEFAULT_TURN_MODE)

  useEffect(() => {
    apply(load())
  }, [load])

  /** 选一下就落盘：这层没有"保存"按钮，也没有第二个家 */
  const setMode = useCallback(
    (next: TurnMode): void => {
      apply(next)
      save(next)
    },
    [save],
  )

  return [mode, setMode]
}

/**
 * 阅读器那层底图。两台阅读器共用同一个偏好（`reader-paper.ts` 文件头第 4 条）。
 * 返回值是那一档本身（不是键）：调用方要的就是"铺哪张图"。
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
    // 存的与用的是同一个来源：落的那个键一定能在表里查到（`paperOf` 查不到会退回默认），
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
 * 与另外两份不同的是：这一份的 `setter` 有两个调用方，而且方向不同 ——
 *   阅读器里那颗「仍然竖着看」只写 `off`，设置里那两颗两个方向都能写。
 *   所以这里给的是通用的 `setRotateHint(mode)`，不是 `dismissRotateHint()`：
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
