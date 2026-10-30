'use client'

/**
 * NoticesSheet —— 「通知」那一屏（2026-10-30）
 *
 * 一份清单，每一条是"一本书画好了 / 没画完"。数据由服务端页面读好递进来
 *   （`notices/page.tsx`），这里只做三件服务端做不了的事：点开即已读、
 *   全部标为已读、以及更新之后把新的未读数广播给侧栏。
 *
 * 四条判断
 *
 * 1. **点一条就跳去那本书。** 已读不是这个动作的目的，读那本书才是。
 *    所以标已读是"顺手发出去、不挡跳转"的一下（`keepalive: true`）——
 *    等它回来再 `router.push` 会让慢网上的点击像没反应。
 * 2. **已读在本地先改。** 那一行的高亮当场去掉、红点当场减一；
 *    服务端那一下失败时下一屏会纠正回来（红点会重新亮），
 *    而"点了之后要等一次刷新才变"是更常见的观感坏法。
 * 3. **全部标为已读只发一次请求。** 逐条 `POST` 在一屏几十条时是一串瀑布；
 *    服务端本来就是"逐个文件写"，一条请求里做完是它的事。
 * 4. **没有通知就什么都不画。** 2026-10-30 用户圈掉了"还没有通知 / 做一本……"那一块：
 *    空白本身就是"没有"，再补一段话只是替一块空地方找话说。
 *    页头那两句留着——那是在说这一屏是干什么的，不是在没有的时候另起一句解释。
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { announceUnreadNotices } from '@/lib/use-unread-notices.ts'

export type NoticeView = {
  id: string
  kind: 'book-ready' | 'book-failed'
  bookId: string
  title: string
  message: string
  /** 服务端格式化好的时间（`YYYY-MM-DD HH:mm`）。★ 在服务端算，客户端只画：
   *  两边各算一次会在时区上错开，hydration 当场报不一致 */
  when: string
  /** 毫秒时间戳，给 `<time dateTime>` */
  at: number
  read: boolean
}

export type NoticesSheetProps = {
  notices: NoticeView[]
  /** 超过一屏上限（60）没画出来的那些。0 = 全都在这一屏里 */
  hidden?: number
}

function hrefOf(notice: NoticeView): string {
  // 画完的 → 去读；没画完的 → 回闸门那一屏，故事还在，接着画不用重新编
  return notice.kind === 'book-ready'
    ? `/reader/${encodeURIComponent(notice.bookId)}`
    : `/create?book=${encodeURIComponent(notice.bookId)}`
}

export default function NoticesSheet({ notices, hidden = 0 }: NoticesSheetProps) {
  const [items, setItems] = useState(notices)
  const [busy, setBusy] = useState(false)

  // 服务端下一次给的是一份新数组（导航回来、重新渲染），本地那份要跟上，
  // 否则"在别处标了已读、回到这一屏还是高亮"（`key` 用不了：这是同一屏的 props 更新）
  useEffect(() => {
    setItems(notices)
  }, [notices])

  const unread = items.filter((one) => !one.read).length

  /** 点开一条：本地先改，然后把"标已读"发出去（不 await，不挡跳转） */
  function open(notice: NoticeView): void {
    if (notice.read) return
    const next = items.map((one) => (one.id === notice.id ? { ...one, read: true } : one))
    setItems(next)
    announceUnreadNotices(next.filter((one) => !one.read).length)
    void fetch('/api/notices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: notice.id }),
      // 跳转之后这个请求继续走完：它是"读过了"，不是这一屏的状态
      keepalive: true,
    }).catch(() => undefined)
  }

  async function markAll(): Promise<void> {
    if (busy || unread === 0) return
    setBusy(true)
    try {
      const response = await fetch('/api/notices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      if (!response.ok) return
      const data = (await response.json()) as { unread?: unknown }
      const left = typeof data.unread === 'number' ? data.unread : 0
      setItems((current) => current.map((one) => ({ ...one, read: true })))
      announceUnreadNotices(left)
    } catch {
      /* 标不上就保持原样：下一次进这一屏服务端还会照实说 */
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ntc" aria-labelledby="ntc-title">
      <header className="ntc__head">
        <div>
          <h1 className="ntc__title" id="ntc-title">
            通知
          </h1>
          <p className="ntc__sub">
            书画好了、或者画到一半停了，都记在这里。生成一本要十几分钟到几小时，不必守着屏幕。
          </p>
        </div>
        {unread > 0 && (
          <button type="button" className="ntc__all" onClick={() => void markAll()} disabled={busy}>
            {busy ? '正在标记…' : '全部标为已读'}
          </button>
        )}
      </header>

      {items.length > 0 && (
        <>
          <ul className="ntc__list">
            {items.map((notice) => (
              <li
                key={notice.id}
                className="ntc__item"
                data-unread={notice.read ? undefined : 'true'}
              >
                <span className="ntc__mark" aria-hidden="true" data-kind={notice.kind} />
                <div className="ntc__body">
                  <p className="ntc__line">
                    {notice.read ? null : <span className="ntc__unread">未读</span>}
                    <span className="ntc__name">《{notice.title}》</span>
                    {notice.kind === 'book-ready' ? '画好了' : '没画完'}
                  </p>
                  <p className="ntc__note">
                    {notice.kind === 'book-ready'
                      ? '点开就能读，不用再等。'
                      : notice.message || '画到一半停了。回这一本可以接着画。'}
                  </p>
                  <p className="ntc__meta">
                    <time dateTime={new Date(notice.at).toISOString()}>{notice.when}</time>
                  </p>
                </div>
                <Link
                  className="ntc__go"
                  href={hrefOf(notice)}
                  onClick={() => open(notice)}
                  aria-label={
                    notice.kind === 'book-ready'
                      ? `去读《${notice.title}》`
                      : `回到《${notice.title}》接着画`
                  }
                >
                  {notice.kind === 'book-ready' ? '去读' : '回到这一本'}
                  <span aria-hidden="true"> →</span>
                </Link>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <p className="ntc__more">还有 {hidden} 条更早的通知没有显示（保留 90 天）。</p>
          )}
        </>
      )}
    </section>
  )
}
