'use client'

/**
 * use-reading-log.ts —— 让阅读器把"读了多久、读到哪儿"记下来（工单 05）
 *
 * 两条规则在这里落地，两条都对应一个"数会变成假的"的具体路径：
 *
 * 1. **只算页面可见的时长**。切到别的标签页、或者把窗口最小化去吃饭，
 *    都不算阅读——所以计时靠 `visibilitychange`：切走就结算并停表，切回来重新开始。
 *    不这么做的话，"阅读时长"就不是它声称的东西了。
 * 2. **翻页即"这天读过这本书"**。连续天数与"读过几本"都靠这条凭据；
 *    光打开页面不翻页不算（那是"点开看了一眼"）。
 *
 * ★ 写盘时机：切走时、翻页时、以及离开这一屏时。没有做定时落盘——
 *   代价是"读着读着进程被杀"会丢掉最后一段，可以接受；
 *   而做成每 5 秒写一次 localStorage，反而会在慢设备上与补间抢主线程。
 *
 * ★ `pageNo` 是 `number | null`：`null` = 现在这一屏**不是页**（封面、封底）。
 *   以前这里传的是 0 与 `pages.length` 两个哨兵值，而后者**恰好等于最后一页的页码**
 *   ——于是停在封底那几秒会被记成"又读了第 P 页"。哨兵值撞上真值就是这种形状。
 */

import { useCallback, useEffect, useRef } from 'react'

import {
  addReadingTime,
  loadReadingLog,
  markPage,
  saveReadingLog,
  type ReadingLog,
} from './reading-log.ts'

export function useReadingLog(bookId: string, pageNo: number | null): void {
  const logRef = useRef<ReadingLog | null>(null)
  /** 本段"可见"的起点。null = 现在不可见（或还没开始） */
  const visibleSince = useRef<number | null>(null)

  const log = (): ReadingLog => {
    logRef.current ??= loadReadingLog()
    return logRef.current
  }

  /** 把从上次结算到现在这段可见时长记上 */
  const flush = useCallback(() => {
    if (visibleSince.current === null) return
    const now = Date.now()
    const delta = now - visibleSince.current
    visibleSince.current = now
    logRef.current = addReadingTime(log(), new Date(now), delta)
    saveReadingLog(logRef.current)
  }, [])

  useEffect(() => {
    if (document.visibilityState === 'visible') visibleSince.current = Date.now()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        flush()
        // 停表：不可见的那段时间**一格都不记**（规则 1）
        visibleSince.current = null
      } else {
        visibleSince.current = Date.now()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [flush])

  useEffect(() => {
    // null / 0 那条路径 = 封面与封底。那两面没有正文，"读到第几页"不该记它们
    if (pageNo === null || !Number.isFinite(pageNo) || pageNo <= 0) return
    logRef.current = markPage(log(), bookId, pageNo, new Date())
    saveReadingLog(logRef.current)
  }, [bookId, pageNo])
}
