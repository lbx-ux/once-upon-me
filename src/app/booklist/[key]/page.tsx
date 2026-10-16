import type { Metadata } from 'next'
import Link from 'next/link'

import BooklistReader from '@/components/booklist/BooklistReader.tsx'
import { bookOf } from '@/components/booklist/booklist.ts'
import { readBooklistAssets } from '@/lib/booklist-assets.ts'

/**
 * /booklist/<key> —— 一本样书的阅读器（全屏）
 *
 * ★ **不在 `(studio)` 路由组里**，与 `/reader/*` 同一个理由（那一组的 layout 文件头写死了）：
 *   侧栏会压掉半幅书面，而这一屏的每一面就是半幅跨页图。
 *
 * 服务端这一层做两件事：按 key 把书查出来、把这一本的资产问一次盘。
 * 交互全在 `BooklistReader` 里。
 *
 * 图与音频**不齐也能读**：到哪一页显示到哪一页，没到的那一页是一张写着
 * "这一页的画还没到位"的纸（见组件里那段）。这一条是这一屏的常态，不是降级路径——
 * 12 本样书是一本一本画出来的。
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>
}): Promise<Metadata> {
  const { key } = await params
  const book = bookOf(key)
  return { title: book ? `《${book.title}》· 小主角` : '找不到这本样书 · 小主角' }
}

export default async function BooklistBookPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const book = bookOf(key)

  if (!book) {
    // 空态要说人话，并给出下一步（与 `/reader` 那个空态同一个写法）
    return (
      <main className="reader-page">
        <div className="reader-page__empty">
          <h1>找不到这本样书</h1>
          <p>
            灵感书单是按主题编的，一共 12 本，没有 <code>{key}</code> 这一本。
          </p>
          <p className="reader-page__actions">
            <Link href="/booklist">回灵感书单</Link>
            <Link href="/">回首页</Link>
          </p>
        </div>
      </main>
    )
  }

  const assets = await readBooklistAssets(book.key)

  return (
    <main className="reader-page">
      <nav className="reader-page__back">
        <Link href="/booklist">← 回灵感书单</Link>
      </nav>
      <BooklistReader book={book} coverUrl={assets.cover} art={assets.art} audio={assets.audio} />
    </main>
  )
}
