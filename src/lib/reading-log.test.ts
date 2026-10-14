/**
 * reading-log.test.ts —— 主页那几个数的**派生**部分
 *
 * 这些函数是纯的，所以"连续天数在什么情况下归零"这种事可以被钉死，
 * 而不是靠读代码的人自己推。三条最容易出错：
 *   ① 日期必须按**本地日历天**（用 toISOString 会把晚上读的书算到第二天）
 *   ② 今天还没读，昨天的连续**不该**归零（那是催促，不是记录）
 *   ③ 时长只往下取整（42.9 分钟报 42，不报 43——向上取整就是编）
 */

import { describe, expect, it } from 'vitest'

import {
  addReadingTime,
  dayKeyOf,
  emptyLog,
  markPage,
  parseLog,
  streakDays,
  totalMinutes,
  booksReadCount,
} from './reading-log.ts'

const at = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date =>
  new Date(y, m - 1, d, hh, mm, ss)

describe('dayKeyOf · 本地日历天', () => {
  it('就是本地那天，不受时区影响', () => {
    expect(dayKeyOf(at(2026, 10, 14))).toBe('2026-10-14')
    expect(dayKeyOf(at(2026, 1, 5, 23, 50))).toBe('2026-01-05')
  })

  it('★ 深夜读的书算**当天**，不算第二天（那正是 toISOString 会犯的错）', () => {
    // 本地 23:59:30 —— 用 UTC 的话，UTC+8 会算成同一天、UTC-5 会算成前一天，
    // 两个都跟"我本地哪天读的"无关。所以要断言的是**它跟本地字段一致**，
    // 而不是去猜测试机的时区（上一版在这里绕了个自证的错）
    const lateNight = at(2026, 10, 14, 23, 59, 30)
    expect(dayKeyOf(lateNight)).toBe('2026-10-14')
    expect(dayKeyOf(lateNight)).toBe(
      [
        String(lateNight.getFullYear()),
        String(lateNight.getMonth() + 1).padStart(2, '0'),
        String(lateNight.getDate()).padStart(2, '0'),
      ].join('-'),
    )
  })
})

describe('addReadingTime / markPage', () => {
  it('不足 1 毫秒的结算被丢掉（不给一个 0 天凑数）', () => {
    expect(addReadingTime(emptyLog(), at(2026, 10, 14), 0).days).toEqual([])
    expect(addReadingTime(emptyLog(), at(2026, 10, 14), -5).days).toEqual([])
  })

  it('★ 单次结算封顶 30 分钟：计时器卡住或系统休眠不该灌进一个荒谬的数', () => {
    const log = addReadingTime(emptyLog(), at(2026, 10, 14), 10 * 60 * 60_000)
    expect(totalMinutes(log)).toBe(30)
  })

  it('同一天累加，不同天各一条', () => {
    let log = emptyLog()
    log = addReadingTime(log, at(2026, 10, 14, 20), 5 * 60_000)
    log = addReadingTime(log, at(2026, 10, 14, 21), 7 * 60_000)
    log = addReadingTime(log, at(2026, 10, 13, 20), 3 * 60_000)
    expect(log.days.map((day) => day.date)).toEqual(['2026-10-14', '2026-10-13'])
    expect(totalMinutes(log)).toBe(15)
  })

  it('翻到同一本书多次只记一个书名，但会记下最后读到的页', () => {
    let log = emptyLog()
    log = markPage(log, 'b1', 1, at(2026, 10, 14, 20))
    log = markPage(log, 'b1', 7, at(2026, 10, 14, 20, 5))
    log = markPage(log, 'b2', 2, at(2026, 10, 14, 20, 6))
    expect(log.days[0]?.books).toEqual(['b1', 'b2'])
    expect(log.last).toMatchObject({ bookId: 'b2', pageNo: 2 })
    expect(booksReadCount(log)).toBe(2)
  })

  it('★ 只标记页数（不记时长）也算"这天读过"——连续天数靠它', () => {
    const log = markPage(emptyLog(), 'b1', 1, at(2026, 10, 14))
    expect(streakDays(log, at(2026, 10, 14))).toBe(1)
    expect(totalMinutes(log)).toBe(0)
  })
})

describe('streakDays', () => {
  const logOf = (...dates: string[]) => {
    let log = emptyLog()
    for (const date of dates) log = markPage(log, 'b1', 1, new Date(`${date}T12:00:00`))
    return log
  }

  it('连续三天，到今天为止', () => {
    const log = logOf('2026-10-12', '2026-10-13', '2026-10-14')
    expect(streakDays(log, at(2026, 10, 14))).toBe(3)
  })

  it('★ 今天还没读，昨天的连续**不归零**', () => {
    const log = logOf('2026-10-12', '2026-10-13')
    expect(streakDays(log, at(2026, 10, 14))).toBe(2)
  })

  it('断了就断：昨天没读，今天读的那天才开始', () => {
    const log = logOf('2026-10-10', '2026-10-14')
    expect(streakDays(log, at(2026, 10, 14))).toBe(1)
  })

  it('什么都没有 = 0；只有时长没有翻书记录 = 0（不算读过）', () => {
    expect(streakDays(emptyLog(), at(2026, 10, 14))).toBe(0)
    const timeOnly = addReadingTime(emptyLog(), at(2026, 10, 14), 60_000)
    expect(streakDays(timeOnly, at(2026, 10, 14))).toBe(0)
  })

  it('跨月连着读要数得出来（别只在同一月内比较字符串）', () => {
    const log = logOf('2026-09-30', '2026-10-01', '2026-10-02')
    expect(streakDays(log, at(2026, 10, 2))).toBe(3)
  })
})

describe('totalMinutes', () => {
  it('★ 向下取整：8.9 分钟报 8，不报 9（向上取整就是编数）', () => {
    const log = addReadingTime(emptyLog(), at(2026, 10, 14), 8.9 * 60_000)
    expect(totalMinutes(log)).toBe(8)
  })
})

describe('parseLog · 脏数据不能让整个主页崩', () => {
  it('空 / 非 JSON / 类型不对都退回空记录', () => {
    expect(parseLog(null).days).toEqual([])
    expect(parseLog('不是 JSON').days).toEqual([])
    expect(parseLog('"一个字符串"').days).toEqual([])
    expect(parseLog('{"days":"不是数组"}').days).toEqual([])
  })

  it('坏掉的一天被丢掉，好的那天下面的脏书名也被丢掉', () => {
    const parsed = parseLog(
      JSON.stringify({
        days: [
          { date: '2026-10-14', ms: 60_000, books: ['b1', 42, null] },
          { date: 123, ms: 'x', books: [] },
        ],
        last: { bookId: 'b1', pageNo: 3, at: 1 },
      }),
    )
    expect(parsed.days).toHaveLength(1)
    expect(parsed.days[0]?.books).toEqual(['b1'])
    expect(parsed.last?.pageNo).toBe(3)
  })
})
