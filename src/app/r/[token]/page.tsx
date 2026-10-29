/**
 * /r/<token> —— 家人分享出来的那一本（2026-10-29）
 *
 * 这一屏只做三件事：验票、把书读出来、交给同一台阅读器。没有侧栏、没有"再做一本"、
 * 没有书架入口——它是**一本书**，不是工作台的一屏。
 *
 * 五条判断
 *
 * 1. **一切"不行"都回 404，不回 403。** 过期、伪造、收回、书被删了——
 *    四件事同一个出口。分开的话，"这张票存在过"就成了一件能被问出来的事，
 *    而分享链接本身就是一把钥匙（`access.ts` 文件头同一条）。
 *
 * 2. **读的是主人那一片，不是公共目录。** `resolveShareAccess` 交回的就是
 *    主人那一片的 store；`allowDemo: false` 再挡掉"书删了就退回公共样书"——
 *    链接指向的是这一本，不是"同号的另一本"。
 *
 * 3. **资产 URL 带 `share=`。** 图与朗读是浏览器匿名取的，`/api/assets` 那条路由
 *    原来只认登录；带上这张票之后，它只放行 `books/<这本书>/` 之下的字节。
 *    查询串只拼在**运行期**那条路上（演示书是静态文件，见 `book-source.ts`）。
 *
 * 4. **`noindex` + `no-referrer`。** 一本给孩子做的书不该被搜索引擎收进去；
 *    `no-referrer` 则保证从这一页往外走时票不会挂在 Referer 上。
 *
 * 5. **不写任何东西。** 这一页没有任何 POST；阅读器那一层只写它自己的
 *    `localStorage`（读到第几页、选了哪一支），那是在**看的人**的浏览器里，
 *    与主人那一片无关。判据 4 查的就是这件事：DOM 里没有任何"写"的按钮。
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import ReaderBook from '@/components/reader/ReaderBook.tsx'
import RotateHint from '@/components/reader/RotateHint.tsx'
import { assetRoot } from '@/lib/books-runtime.ts'
import { resolveBook } from '@/lib/book-source.ts'
import { originFromHeaders, resolveShareAccess, type ShareAccess } from '@/lib/share/access.ts'

export const dynamic = 'force-dynamic'

const DESCRIPTION = '一本以孩子为主角、用家人的声音朗读的定制绘本。'

/** 票在 URL 里；任何一条出站链接都会把它带出去，所以这一页干脆没有出站链接 */
function absolute(origin: string, path: string): string {
  return origin ? `${origin}${path}` : path
}

async function readOf(token: string): Promise<{
  access: ShareAccess
  resolved: NonNullable<Awaited<ReturnType<typeof resolveBook>>>
} | null> {
  const access = await resolveShareAccess(token, assetRoot())
  if (!access) return null
  const resolved = await resolveBook(access.bookId, access.store, {
    assetQuery: `share=${encodeURIComponent(token)}`,
    allowDemo: false,
  })
  return resolved ? { access, resolved } : null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const found = await readOf(token)
  if (!found) {
    return {
      title: '找不到这一页 · 小主角',
      robots: { index: false, follow: false },
      referrer: 'no-referrer',
    }
  }

  const title = `${found.resolved.book.tree.title} · 小主角`
  const origin = originFromHeaders(await headers())
  const cover = found.resolved.coverUrl ? absolute(origin, found.resolved.coverUrl) : undefined

  return {
    title,
    description: DESCRIPTION,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    openGraph: {
      title,
      description: DESCRIPTION,
      type: 'article',
      images: cover ? [{ url: cover }] : undefined,
    },
    twitter: {
      card: cover ? 'summary_large_image' : 'summary',
      title,
      description: DESCRIPTION,
      images: cover ? [cover] : undefined,
    },
  }
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const found = await readOf(token)
  if (!found) notFound()

  const { resolved } = found
  return (
    <main className="reader-page">
      <RotateHint />
      <ReaderBook
        bookId={resolved.book.bookId}
        title={resolved.book.tree.title}
        coverUrl={resolved.coverUrl}
        story={resolved.story}
        source={resolved.source}
      />
    </main>
  )
}
