'use client'

/**
 * use-unread-notices.ts —— 侧栏那颗红点问的次数（一个数，不是一份列表）
 *
 * 为什么在客户端问，而不是让 `(studio)/layout.tsx` 服务端读完递下来：
 *   那一层是 `staleTimes: 30` 的产物，回访刚看过的一屏不会重新取数
 *   （`next.config.ts` 那个开关就是为了"回访快"）。而通知恰恰是**在一屏之外**
 *   产生的：用户在 `/create` 等一本书画完，红点要在下一次导航时亮起来。
 *   递下来的数会在 30 秒里一直是旧的，正好把这个场景盖掉。
 *
 * 什么时候问：挂载、登录态从"没登录"变成"已登录"、以及**每次换屏**。
 *   不做定时轮询：这本书画完时用户多半就在这一屏上，结束后他自己会点去哪儿；
 *   而一个每 30 秒打一次的轮询，为一个一天响不了几次的红点付一整天的请求。
 *
 * 为什么换屏也要问：`/create` 画完 → 用户点「书架」→ 这一次导航就是"该知道"的时刻。
 *   一次 `?count=1` 只列几个小文件，比让用户自己想起来去点通知便宜。
 *
 * 通知页标完已读会广播 `NOTICES_CHANGED_EVENT`（带新的未读数），这里直接采用——
 *   不广播的话，红点要等下一次换屏才灭，看起来像"点了已读没生效"。
 */

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export const NOTICES_CHANGED_EVENT = 'xiaozhujue:notices-changed'

/** 通知页改完已读之后广播一次。`unread` 是服务端回的那个数，不是本地猜的 */
export function announceUnreadNotices(unread: number): void {
  window.dispatchEvent(new CustomEvent(NOTICES_CHANGED_EVENT, { detail: { unread } }))
}

export function useUnreadNotices(enabled: boolean): number {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setUnread(0)
      return
    }
    let alive = true
    fetch('/api/notices?count=1', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { unread?: unknown } | null) => {
        if (!alive) return
        if (typeof data?.unread === 'number') setUnread(data.unread)
      })
      // 问不到就保持原样：红点晚一拍亮，不该因为一次失败的 GET 把已有的数清零
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [enabled, pathname])

  useEffect(() => {
    const onChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ unread?: unknown }>).detail
      if (typeof detail?.unread === 'number') setUnread(detail.unread)
    }
    window.addEventListener(NOTICES_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(NOTICES_CHANGED_EVENT, onChanged)
  }, [])

  return unread
}
