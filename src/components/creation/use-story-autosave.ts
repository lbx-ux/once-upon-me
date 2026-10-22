'use client'

/**
 * use-story-autosave.ts —— 闸门那一屏的自动保存（工单 D-34，2026-10-21 拆出）
 *
 * 不存的话，家长改到第 5 页时刷一下，前四页的改动就没了——而"关掉标签页也找得回来"
 * 正是这一轮对用户的承诺（书架那一栏也是为它做的）。存盘走 `PUT /story`，
 * 判据与「就按这个画」那一关共用 `lib/story-problems.ts`，所以不存在"存上了但画不了"。
 *
 * 它只拥有**那台状态机**（`SaveState`）：故事本身与"改过没有"留在调用方那边
 *   —— 那是这一屏的真相，别的地方也在读它（闸门上那三个框、重写前的那句提醒、
 *   「就按这个画」发出去的请求体）。
 *
 * ★ 一段静默期（`AUTOSAVE_MS`）：太短会边打字边发请求，太长会让"关掉标签页"
 *   重新变得危险。1.2 秒是"读完自己写的这一句"的量级。
 *
 * ★ 为什么闸门条件是**调用方算好给进来**的（`enabled`）：它真正的含义是
 *   "这一刻该不该存"（在闸门上、没有别的活在跑）。写成三个依赖拽进来
 *   （`phase` / `working` / `dirty`）的话，这个 hook 就要认识另外两个 hook 的状态；
 *   而 `working` 那个依赖本身是有来历的：重写一版会换掉盘上那一份故事，
 *   一个排着队的自动保存会在它之后落地，把家长改的旧文字盖回新故事上。
 *   把它算在调用方，那一条来历就写在它该在的地方（`GenerationRun` 的 `rewrite`）。
 */

import { useEffect, useState } from 'react'

import type { StoryDoc } from '@/lib/schemas/story.ts'
import { saveStory } from '@/lib/creation/api.ts'

/**
 * 那行小字的状态机。★ `'failed'` 是必须存在的一档：存不上要说得出来。
 * 2026-10-18 多一档 `'rewritten'`：重写成功之后这一屏上要有一句"换成新的了"——
 *   整篇被换掉是悄悄发生的（同一屏、同一批框，只是字不一样了），而家长刚等了
 *   101 秒（实测），他需要一个答案："刚才那一眼是不是白等"。用户原话：
 *   「这样用户怎么知道有没有重新生成故事呢」。它与会话里其余几档同寿：一动笔就归零。
 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'rewritten'

/** 自动保存的静默期（毫秒）。★ 这个数只有一个读者：家长停手多久之后算"改完了一句" */
export const AUTOSAVE_MS = 1200

export function useStoryAutosave(args: {
  bookId: string | null
  story: StoryDoc | null
  /** 家长手改过没有（`false` 时一句都不存） */
  dirty: boolean
  /** 这一刻该不该存：在闸门上、且没有别的活在跑（见文件头那一段） */
  enabled: boolean
}): {
  saveState: SaveState
  setSaveState: (next: SaveState) => void
} {
  const { bookId, story, dirty, enabled } = args
  const [saveState, setSaveState] = useState<SaveState>('idle')

  useEffect(() => {
    if (!enabled || !dirty || !story || !bookId) return
    setSaveState('saving')
    const timer = setTimeout(() => {
      void saveStory(bookId, story)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('failed'))
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [story, dirty, enabled, bookId])

  return { saveState, setSaveState }
}
