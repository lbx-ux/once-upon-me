import type { Metadata } from 'next'
import Link from 'next/link'
import ReaderBook from '@/components/reader/ReaderBook'
import { resolveBook } from '@/lib/book-source'

/**
 * /reader/<bookId> —— 独读版阅读器
 *
 * 服务端这一层只做三件事：把书读出来（运行期产物 **或** 预生成的演示书，
 * 见 `lib/book-source.ts`）、把资产路径算成 URL、把页表交给客户端组件。
 * 交互全在 `ReaderBook` 里。
 *
 * ★ 这一页**不做**客户端取数：书是磁盘上的一份清单，服务端读完直接渲染，
 *   首屏就有内容（#12 的 LCP 与"零延迟"那条产品主张都吃这一口）。
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bookId: string }>
}): Promise<Metadata> {
  const { bookId } = await params
  const resolved = await resolveBook(bookId)
  return {
    title: resolved ? `${resolved.book.tree.title} · 小主角` : '找不到这本书 · 小主角',
  }
}

export default async function ReaderPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params
  const resolved = await resolveBook(bookId)

  if (!resolved) {
    // 空态要说人话，并给出下一步（工单 04 §四 那张表里的"阅读器没有这本书"那一行）
    return (
      <main className="reader-page">
        <div className="reader-page__empty">
          <h1>找不到这本书</h1>
          <p>
            没有书号 <code>{bookId}</code> 对应的成品。可能是还没生成完，
            或者这一轮被中断了（刷新会打断那条连接）。
          </p>
          <p className="reader-page__actions">
            <Link href="/home">回「创作」做一本</Link>
            <Link href="/">回首页</Link>
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="reader-page">
      <nav className="reader-page__back">
        <Link href="/home">← 再做一本</Link>
      </nav>
      <ReaderBook
        bookId={bookId}
        title={resolved.book.tree.title}
        coverUrl={resolved.coverUrl}
        pages={resolved.pages}
        source={resolved.source}
      />
    </main>
  )
}
