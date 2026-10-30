import NoticesSheet, { type NoticeView } from '@/components/notices/NoticesSheet.tsx'
import { createUserStore } from '@/lib/asset-scope.ts'
import { currentUserId } from '@/lib/auth/session.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { listNotices, NOTICE_LIMIT } from '@/lib/notices.ts'

/**
 * /notices —— 站内信（2026-10-30）
 *
 * 与 `/shelf` 同一条做法：盘上是一份份小文件，服务端读完直接渲染，首屏就有内容。
 *   未登录就是空的，不重定向、也不摆一句"请先登录"——工作台另外几屏也是这个口径，
 *   而 2026-10-30 用户把空态那段话整个圈掉了（见 `NoticesSheet` 文件头第 4 条）。
 *
 * 时间在这里格式化，不在客户端组件里：服务端与浏览器各算一次会在时区上错开，
 *   hydration 当场报不一致（`NoticesSheet` 里 `NoticeView.when` 那一格）。
 *   格式写死成 `YYYY-MM-DD HH:mm`，与本地 `toLocaleString` 相比少一层"系统语言"的变量。
 *
 * 一屏最多 `NOTICE_LIMIT` 条（60）。更老的不删：保留期是 90 天（`notices.ts`），
 *   而"我三个月前做过一本"这种事去书架看，不该在这一屏翻。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '通知 · 小主角' }

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 引擎与服务器都在东八区跑；这里不做时区转换，取的是这台机器的本地时间 */
function whenText(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export default async function NoticesPage() {
  const userId = await currentUserId()
  if (!userId) return <NoticesSheet notices={[]} />

  const store = await createUserStore(assetRoot(), userId)
  const all = await listNotices(store)
  const notices = all.slice(0, NOTICE_LIMIT)
  const views: NoticeView[] = notices.map((one) => ({
    id: one.id,
    kind: one.kind,
    bookId: one.bookId,
    title: one.title,
    message: one.message,
    when: whenText(one.at),
    at: one.at,
    read: one.readAt !== null,
  }))

  return <NoticesSheet notices={views} hidden={all.length - notices.length} />
}
