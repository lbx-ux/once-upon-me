'use client'

/**
 * ShelfDashboard —— 书架（工单 05 的那份仪表盘，2026-10-14 挪进侧栏工作台的「书架」）
 *
 * ★ 设计稿是**通用儿童 App 的模板**，里面有几个数在这个产品里没有出处。
 *   本文件对每一个都做了判断，判据写在工单 05 §一 的表里：
 *
 *   | 设计稿            | 这里怎么落地                                              |
 *   | ----------------- | --------------------------------------------------------- |
 *   | 已创作故事 12     | ✅ 书库里真有几本                                         |
 *   | 阅读时长 8.5 小时 | ✅ 真记（`reading-log.ts`，只算页面可见的时长）           |
 *   | 收藏角色 6        | ⚠️ 换成**我的角色**：收藏这个动作还不存在，角色数是真的   |
 *   | 连续天数 5        | ✅ 真记（按本地日历天，今天还没读也不归零）               |
 *   | tab 推荐          | ❌ 换成**主题模板**：这个产品没有内容库，书是生成的        |
 *   | tab 收藏          | ❌ 撤掉（没有收藏动作，留一个空的 tab 就是假装）           |
 *   | 为你推荐 三张卡   | ❌ 同一件事，换成主题模板，点一下预填创作流                |
 *   | 继续上次创作      | ✅ 从阅读记录来，带页码                                    |
 *   | 我的故事 列表     | ✅ 书库                                                     |
 *   | 你好，小宇妈妈    | ⚠️ **不写"妈妈"**：这个产品不知道来的是谁（见 §三）        |
 *
 * ★ 三个数都只在这台设备成立，所以**界面上写明**。这是"数字要能复现"的另一面：
 *   复现不了的时候，要说清它的边界在哪。
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { THEMES, artPath } from '@/lib/themes.ts'
import type { BookSummary } from '@/lib/library.ts'
import {
  dayKeyOf,
  loadReadingLog,
  streakDays,
  totalMinutes,
  type ReadingLog,
} from '@/lib/reading-log.ts'

export type ShelfDashboardProps = {
  books: BookSummary[]
  /** 角色卡数量（`GET /api/cards` 那份数据，服务端读来的）。收藏动作还没有，所以是"我的角色" */
  characterCount: number
}

/** 相对时间。★ 不做"3 天前"这种——本地时钟与书的时间戳都不可信，说清是哪天更老实 */
function shortDate(at: number, today: string): string {
  if (!at) return '—'
  const date = new Date(at)
  const key = dayKeyOf(date)
  if (key === today) {
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    return `今天 ${hh}:${mm}`
  }
  return key
}

export default function ShelfDashboard({ books, characterCount }: ShelfDashboardProps) {
  // ★ 阅读记录只在浏览器里有。挂载后再读，避免服务端/客户端首次渲染不一致
  const [log, setLog] = useState<ReadingLog | null>(null)
  /**
   * "今天"**在客户端算**，不从服务端传。
   * ★ 服务端与浏览器的时区可能不同，用服务端那一天去算连续天数，跨时区会差一天——
   *   而"连续天数"恰恰是一个**只跟本地日历有关**的数（reading-log.ts 规则 4）。
   */
  const [today, setToday] = useState('')
  const [tab, setTab] = useState<'recent' | 'themes'>('recent')
  // ★ 「模型与密钥」的入口只在侧栏（工单 04 的抽屉 + 工单 06 的工作台外壳）。
  //   这里原来还有一颗"设置"齿轮——同一屏两个入口通向同一个抽屉，属于没搬干净。

  useEffect(() => {
    setLog(loadReadingLog())
    setToday(dayKeyOf(new Date()))
  }, [])

  const stats = useMemo(() => {
    if (!log || today === '') return null
    const todayDate = new Date(`${today}T12:00:00`)
    return {
      minutes: totalMinutes(log),
      streak: streakDays(log, todayDate),
      readToday: log.days.some((day) => day.date === today && day.books.length > 0),
    }
  }, [log, today])

  /** 继续上次创作：只有真的读过才给这张卡（没读过就没有"上次"） */
  const resume = useMemo(() => {
    const last = log?.last
    if (!last) return null
    const book = books.find((item) => item.bookId === last.bookId)
    if (!book) return null
    return { book, pageNo: last.pageNo }
  }, [log, books])

  return (
    <main className="shelf">
      <header className="shelf__head">
        <div>
          {/* ★ 不写"小宇妈妈"：这个产品不知道来的是妈妈、爸爸还是爷爷。
              写成某一个，就是第一句话就把一半用户写错（工单 05 §三）。
              有角色时用孩子的名字，没有就中性问候。 */}
          <h1 className="shelf__hello">
            {books.length > 0 ? '你好，欢迎回来' : '你好，欢迎来到小主角'}
          </h1>
          <p className="shelf__sub">
            这里放你做的书。{books.length === 0 && '先做一本，或者先用示例角色看看效果。'}
          </p>
        </div>
      </header>

      {/* ── 统计卡。每张卡上的数都说得出处；说不出处的不在这上面 ── */}
      <section className="shelf__stats" aria-label="统计">
        <Stat label="已创作故事" value={String(books.length)} unit="本" />
        <Stat
          label="阅读时长"
          value={log ? String(stats?.minutes ?? 0) : '—'}
          unit="分钟"
          note={log ? undefined : '正在读记录…'}
        />
        <Stat label="我的角色" value={String(characterCount)} unit="个" />
        <Stat
          label="连续天数"
          value={log ? String(stats?.streak ?? 0) : '—'}
          unit="天"
          // ★ 这句只给"昨天读过、今天还没读"的人看。一本都没读过的新用户看到它
          //   会被莫名催一下——而 `streakDays` 的"今天没读不归零"那条规则，
          //   本来也只在这种情形下才起作用（reading-log.ts）
          note={
            stats && stats.streak > 0 && !stats.readToday
              ? '今天还没读，昨天读的也还算连着'
              : undefined
          }
        />
      </section>
      {/* ★ 这几个数只在这台设备的这个浏览器里成立。写明才算诚实——不然它看起来像账号数据 */}
      <p className="shelf__local-note">
        阅读时长与连续天数只记在<b>这台设备</b>上（换设备或清浏览器数据就没了）；
        故事本身在服务端的书库里。
      </p>

      {/* ── 继续上次创作 ── */}
      {resume && (
        <Link className="shelf__resume" href={`/reader/${resume.book.bookId}`}>
          <span className="shelf__resume-label">继续上次创作</span>
          <span className="shelf__resume-title">《{resume.book.title}》</span>
          <span className="shelf__resume-sub">
            上次读到第 {resume.pageNo} 页 · 共 {resume.book.pageCount} 页
          </span>
        </Link>
      )}

      {/* ── 最近 / 主题模板。★ 设计稿的第三个 tab 是"收藏"，这里撤掉了：
             收藏这个动作还不存在，留一个点开是空的 tab 就是假装 ── */}
      <nav className="shelf__tabs" role="tablist" aria-label="书架视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'recent'}
          className="shelf__tab"
          onClick={() => setTab('recent')}
        >
          最近
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'themes'}
          className="shelf__tab"
          onClick={() => setTab('themes')}
        >
          主题模板
        </button>
      </nav>

      {tab === 'themes' ? (
        <section className="shelf__themes" aria-label="主题模板">
          <p className="shelf__section-hint">
            挑一个主题，点进去就开始做——它会把创作流的第一步填好。
            <b>这里不是内容库</b>：书是给你家孩子生成的，不是挑现成的。
          </p>
          <div className="shelf__theme-grid">
            {THEMES.map((theme) => (
              <Link
                key={theme.key}
                className="shelf__theme"
                href={`/create?theme=${theme.key}`}
                title={theme.tagline}
              >
                {/* 背景图而不是 <img>：与 `.reader__art` 同一个做法。
                    旁边就是中文名字，读屏不需要它念第二遍"恐龙"，
                    而仓库里 `next/image` 是「刻意未做」那一条（README §五），
                    不该在新增页面上悄悄多算一条警告 */}
                <span
                  className="shelf__theme-art"
                  style={{ backgroundImage: `url(${artPath(theme.key)})` }}
                  aria-hidden="true"
                />
                {/* ★ 这里原来在名字前面挂了一枚 `theme.emoji`。2026-10-15 删掉了：
                    上面那张 72px 的水彩就是同一个主题的画像，再挂一枚扁平高饱和的
                    clip-art 是**同一个主题的两张画**，而且两套画法（README §五那条）。
                    删的时候没有顺手换成派生小图——同一张画的第二个尺寸只会更花。
                    `THEMES[].emoji` 这个字段留着：书里那套"图没到位时露出 emoji"的
                    兜底机制还在用（`book/demoBook.ts`、`engine/domain.ts`）。 */}
                <span className="shelf__theme-label">{theme.label}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="shelf__books" aria-label="我的故事">
          <h2 className="shelf__section-title">我的故事</h2>
          {books.length === 0 ? (
            // 空态是最重要的一屏（第一次进来的人看到的就是它）：给一条能走的路，不是一句"还没有"
            <div className="shelf__empty">
              <p>这里会放你做的书。现在一本都还没有。</p>
              <p className="shelf__empty-actions">
                <Link className="shelf__cta" href="/create">
                  做第一本
                </Link>
                <Link
                  className="shelf__cta shelf__cta--ghost"
                  href="/reader/xiaoyu-r1-4fe055c5723b"
                >
                  先看一本成品
                </Link>
              </p>
            </div>
          ) : (
            <ul className="shelf__list">
              {books.map((book) => (
                <li key={book.bookId}>
                  <Link className="shelf__book" href={`/reader/${book.bookId}`}>
                    <span className="shelf__book-title">《{book.title}》</span>
                    <span className="shelf__book-meta">
                      {book.pageCount} 页
                      {/* ★ 只有真的有朗读才写这一句。没有的不写"无朗读"——
                          一本没有朗读的书不需要一直在标题旁边道歉 */}
                      {book.hasNarration && <span className="shelf__book-audio">有朗读</span>}
                      <span className="shelf__book-date">{shortDate(book.createdAt, today)}</span>
                    </span>
                  </Link>
                </li>
              ))}
              <li>
                <Link className="shelf__book shelf__book--new" href="/create">
                  ＋ 新建故事
                </Link>
              </li>
            </ul>
          )}
        </section>
      )}
    </main>
  )
}

function Stat({
  label,
  value,
  unit,
  note,
}: {
  label: string
  value: string
  unit: string
  note?: string
}) {
  return (
    <div className="shelf__stat">
      <span className="shelf__stat-label">{label}</span>
      <span className="shelf__stat-value">
        {value}
        <span className="shelf__stat-unit">{unit}</span>
      </span>
      {note && <span className="shelf__stat-note">{note}</span>}
    </div>
  )
}
