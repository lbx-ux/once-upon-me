/**
 * reading-log.ts —— 阅读记录：主页那几个数**唯一的出处**
 *
 * 设计稿上有四张统计卡（已创作故事 / 阅读时长 / 收藏角色 / 连续天数）。后三个数
 * 在这个产品里**本来没有任何数据源**——所以要么真去记，要么那张卡不做。
 * 这一层就是"真去记"：不记，那三个数就是编的（工单 05 §二 的判据）。
 *
 * ★ 四条不显然的规则，每条都对应一个"数会变成假的"的具体路径：
 *
 * 1. **只算"页面可见"的时长**。不看可见性的话，"开着去吃饭"会记成阅读时长——
 *    那不是"不精确"，那是这个数**根本不是它声称的东西**。所以计时靠
 *    `visibilitychange`：切走就结算，切回来重新开始。
 * 2. **记录只活在这台设备的这个浏览器里**。它不是账号级的数——换机器、清缓存就没了。
 *    所以界面上必须写明这一点（写明了才叫诚实，不然是"看起来像账号数据"）。
 *    也因此它进 `localStorage`（存的是书号、页码、毫秒数，**没有秘密**），
 *    而**不是**跟设置里的 key 那样只活在内存——两者性质不同，别混。
 * 3. **导出的是纯函数 + 一层薄薄的存取**。派生（总时长、连续天数、上次读到哪儿）
 *    全在纯函数里，所以它们可测；只有 `load/save` 碰 localStorage。
 * 4. **日期按**本地**日历天算**（`YYYY-MM-DD`），不是按 24 小时窗口。
 *    "连续天数"是日历上的概念：昨晚 23:50 读的、今早 7:00 读的，是两天，也是连着读。
 */

export const READING_LOG_KEY = 'xiaozhujue.reading.v1'

/** 一天一条。`books` 去重，用来判断"这天读过书"而不是"这天开过页面" */
export type DayLog = {
  /** 本地日历天 `YYYY-MM-DD` */
  date: string
  /** **页面可见**的累计毫秒数（规则 1） */
  ms: number
  books: string[]
}

/** 上次读到哪儿。主页的"继续上次创作"靠它 */
export type LastPosition = {
  bookId: string
  pageNo: number
  at: number
}

export type ReadingLog = {
  days: DayLog[]
  last: LastPosition | null
}

/** 保留多少天。★ 只留 90 天：再久的"连续天数"没有意义，而这个是本地存储，不能无限长 */
const KEEP_DAYS = 90

export function emptyLog(): ReadingLog {
  return { days: [], last: null }
}

/** 本地日历天的键。不用 `toISOString()`——那是 UTC，晚上读的书会被算到第二天 */
export function dayKeyOf(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function withDay(log: ReadingLog, date: string, mutate: (day: DayLog) => void): ReadingLog {
  const days = log.days.map((day) => ({ ...day, books: [...day.books] }))
  let target = days.find((day) => day.date === date)
  if (!target) {
    target = { date, ms: 0, books: [] }
    days.push(target)
  }
  mutate(target)
  days.sort((a, b) => (a.date < b.date ? 1 : -1)) // 新的在前
  return { ...log, days: days.slice(0, KEEP_DAYS) }
}

/** 结算一段**可见**的阅读时长（规则 1：调用方只在可见时才计时） */
export function addReadingTime(log: ReadingLog, at: Date, deltaMs: number): ReadingLog {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return log
  // 单次结算封顶 30 分钟：一次 rAF 卡住或系统休眠会把一个荒谬的数灌进来，
  // 而那种数一旦进了统计就再也分不清是"真读了"还是"计时器坏了"
  const capped = Math.min(deltaMs, 30 * 60_000)
  return withDay(log, dayKeyOf(at), (day) => {
    day.ms += capped
  })
}

/** 翻到某一页。同时也是"这天读过这本书"的凭据（`books` 那一栏） */
export function markPage(log: ReadingLog, bookId: string, pageNo: number, at: Date): ReadingLog {
  const next = withDay(log, dayKeyOf(at), (day) => {
    if (!day.books.includes(bookId)) day.books.push(bookId)
  })
  return { ...next, last: { bookId, pageNo, at: at.getTime() } }
}

/** 总时长（分钟）。不足一分钟如实给 0，不四舍五入成 1——那是编数 */
export function totalMinutes(log: ReadingLog): number {
  const ms = log.days.reduce((sum, day) => sum + day.ms, 0)
  return Math.floor(ms / 60_000)
}

/**
 * 连续天数。
 *
 * 判据：从**今天**往回数，连续有记录的天数；**今天还没读也算数**——
 * 昨天读了、今天还没读，人不该看到"连续天数归零"（那是催促，不是记录）。
 * 但断了两天以上就真的断了。
 */
export function streakDays(log: ReadingLog, today: Date): number {
  const read = new Set(log.days.filter((day) => day.books.length > 0).map((day) => day.date))
  if (read.size === 0) return 0
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  // 今天没读就从昨天起数（见上面那条判据）
  if (!read.has(dayKeyOf(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (read.has(dayKeyOf(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** 读过几本书（去重）。这是"已创作故事"的**旁证**，不是它本身——那个数以书库为准 */
export function booksReadCount(log: ReadingLog): number {
  return new Set(log.days.flatMap((day) => day.books)).size
}

/* ───────────────────────── 存取（薄薄一层） ───────────────────────── */

export function parseLog(raw: string | null): ReadingLog {
  if (!raw) return emptyLog()
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return emptyLog()
    const value = parsed as Partial<ReadingLog>
    const days = Array.isArray(value.days)
      ? value.days
          .filter((day): day is DayLog => {
            const item = day as Partial<DayLog> | null
            return Boolean(item && typeof item.date === 'string' && typeof item.ms === 'number')
          })
          .map((day) => ({
            date: day.date,
            ms: day.ms,
            books: Array.isArray(day.books) ? day.books.filter((b) => typeof b === 'string') : [],
          }))
      : []
    const last =
      value.last && typeof value.last.bookId === 'string' && typeof value.last.pageNo === 'number'
        ? { bookId: value.last.bookId, pageNo: value.last.pageNo, at: value.last.at ?? 0 }
        : null
    return { days, last }
  } catch {
    return emptyLog()
  }
}

export function loadReadingLog(): ReadingLog {
  if (typeof window === 'undefined') return emptyLog()
  try {
    return parseLog(window.localStorage.getItem(READING_LOG_KEY))
  } catch {
    return emptyLog()
  }
}

export function saveReadingLog(log: ReadingLog): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(READING_LOG_KEY, JSON.stringify(log))
  } catch {
    // 配额满或隐私模式：记录丢了就丢了，**不许**因此影响阅读本身
  }
}
