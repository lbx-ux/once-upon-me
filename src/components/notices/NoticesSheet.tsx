'use client'

/**
 * NoticesSheet —— 「通知」那一屏（2026-10-30）
 *
 * 一份清单，每一条是"一本书画好了 / 没画完"。数据由服务端页面读好递进来
 *   （`notices/page.tsx`），这里只做四件服务端做不了的事：点开即已读、
 *   全部标为已读、清空、以及更新之后把新的未读数广播给侧栏。
 *
 * 五条判断
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
 * 5. **清空是两步，而且删的是整片。** 与 `VoicePicker` 那颗垃圾桶同一条做法：
 *    先按「清空」，那一行当场换成「确认清空 / 算了」；点完报的是**服务端真删掉的
 *    条数**（`removed`），不是这一屏画出来的条数——一屏只画 60 条（`NOTICE_LIMIT`），
 *    藏起来的那几条也要一起走，否则"清空了、下次进来还剩几条"是解释不清的。
 *    清空之后那句话（`receipt`）是这次动作的回执，不是空态文案：
 *    它由一次点击产生，下一次进这一屏就不再出现。
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
  /** 一屏之外还压着几条（超过 `NOTICE_LIMIT`）。清空要连它们一起清，所以本地也得能改 */
  const [more, setMore] = useState(hidden)
  /** 「清空」的两步：这颗钮按下之后那一行换成确认/算了，不是点了就删 */
  const [confirming, setConfirming] = useState(false)
  /** 清空这一次的回执。成功与失败都要说清，而且数字用服务端回来的那一份 */
  const [receipt, setReceipt] = useState<{ tone: 'done' | 'failed'; text: string } | null>(null)

  // 服务端下一次给的是一份新数组（导航回来、重新渲染），本地那份要跟上，
  // 否则"在别处标了已读、回到这一屏还是高亮"（`key` 用不了：这是同一屏的 props 更新）
  useEffect(() => {
    setItems(notices)
    setMore(hidden)
    setConfirming(false)
  }, [notices, hidden])

  const unread = items.filter((one) => !one.read).length
  /** 这一屏 + 一屏之外 = 按「清空」会删掉的条数（确认那一行说的就是它） */
  const total = items.length + more

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

  /**
   * 清空这一屏（服务端删的是整片，见文件头第 5 条）。
   *
   * 与 `markAll` 的差别：那一个失败就保持原样、下一屏再说；这一个失败要**当场说**——
   *   因为"按了清空、它没清"与"按了清空、它清了"在屏幕上是同一个空白，
   *   而下一屏会照实把通知摆回来，用户只会以为自己看错了。
   */
  async function clearAll(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch('/api/notices', { method: 'DELETE' })
      const data = (await response.json().catch(() => null)) as {
        removed?: unknown
        unread?: unknown
        message?: unknown
      } | null
      if (!response.ok) {
        const why = typeof data?.message === 'string' ? data.message : '服务没有回应'
        setReceipt({ tone: 'failed', text: `没清掉：${why}` })
        return
      }
      const removed = typeof data?.removed === 'number' ? data.removed : 0
      setItems([])
      setMore(0)
      setConfirming(false)
      announceUnreadNotices(typeof data?.unread === 'number' ? data.unread : 0)
      setReceipt({
        tone: 'done',
        text: removed > 0 ? `已经清掉 ${removed} 条通知。` : '通知已经不在了。',
      })
    } catch {
      setReceipt({ tone: 'failed', text: '没清掉：网络断了，通知还在。' })
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
        {total > 0 && (
          <div className="ntc__acts">
            {confirming ? (
              /* 两步的第二下。`role="alertdialog"` 与 `VoicePicker` 那颗垃圾桶同一条：
                 读屏进来先听见"要清掉几条、删的是什么"，而不是先听见一颗按钮 */
              <div
                className="ntc__confirm"
                role="alertdialog"
                aria-label={`清空全部 ${total} 条通知？只删这一屏的记录，书和书架都不动`}
              >
                <button
                  type="button"
                  className="ntc__danger"
                  onClick={() => void clearAll()}
                  disabled={busy}
                  title="只删通知的记录：书、草稿、书架上的东西都不动"
                >
                  {busy ? '正在清…' : '确认清空'}
                </button>
                <button
                  type="button"
                  className="ntc__cancel"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  算了
                </button>
              </div>
            ) : (
              <>
                {unread > 0 && (
                  <button
                    type="button"
                    className="ntc__all"
                    onClick={() => void markAll()}
                    disabled={busy}
                  >
                    {busy ? '正在标记…' : '全部标为已读'}
                  </button>
                )}
                {/* 「清空」是这片里唯一会让文件消失的动作，所以它是一颗**图标**，
                    不是与「全部标为已读」同款的白胶囊（2026-10-30 用户要求的）。
                    ★ 只有图标就必须补两样：`aria-label`（读屏念得到"清空全部通知"）
                      与 `title`（鼠标停一下能看到删的是哪一样、书不跟着走）——
                      与 `VoicePicker` 那颗垃圾桶同一条处置。
                    ★ 图形也是**照抄**那三笔（盖 / 提手 / 桶身）：删东西这个动作在全站
                      只该有这一张脸，重画一次就多一处"哪颗才是删"的猜测。 */}
                <button
                  type="button"
                  className="ntc__clear"
                  onClick={() => setConfirming(true)}
                  disabled={busy}
                  aria-label={`清空全部 ${total} 条通知`}
                  title={`清掉全部 ${total} 条通知：书、草稿、书架上的东西都不动`}
                >
                  <svg className="ntc__clear-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <g
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {/* 盖 */}
                      <path d="M4.6 7.4h14.8" />
                      {/* 提手 */}
                      <path d="M9.6 7.4V5.6A1.6 1.6 0 0 1 11.2 4h1.6a1.6 1.6 0 0 1 1.6 1.6v1.8" />
                      {/* 桶身 */}
                      <path d="M7.3 7.4l.82 11.1a1.8 1.8 0 0 0 1.8 1.7h4.16a1.8 1.8 0 0 0 1.8-1.7l.82-11.1" />
                    </g>
                  </svg>
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {receipt && (
        <p className="ntc__receipt" data-tone={receipt.tone} role="status">
          {receipt.text}
        </p>
      )}

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
          {more > 0 && (
            <p className="ntc__more">还有 {more} 条更早的通知没有显示（保留 90 天）。</p>
          )}
        </>
      )}
    </section>
  )
}
