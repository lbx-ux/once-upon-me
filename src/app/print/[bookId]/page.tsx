/**
 * /print/<bookId> —— 把一本书摊成几张 A4 纸，交给浏览器的打印（2026-10-29）
 *
 * 产品上的位置：`docs/business.md` §5.4 那三条"最后一公里"里的第二条——
 * 导出打印。分享链接解决"送到别人手里"，这一屏解决"放在桌上"。
 *
 * 五条判断
 *
 * 1. **不引 PDF 库，用浏览器自己的打印。** 运行期直接依赖只有五个（README §四），
 *    而 `@page { size: A4 landscape }` + 打印对话框里的「另存为 PDF」
 *    本来就是这件事最省的做法——中文、字体嵌入、图片压缩全由浏览器做，而且做得对。
 *    代价写在 `components/print/PrintNow.tsx` 与 `docs/known-tradeoffs.md`：
 *    产物是一次对话框，不是一个后台生成的下载链接。
 * 2. **读的是**这个人那片**，与阅读器同一条口径。** 别人的书号在这里读不到 → 404。
 *    未登录时只剩演示书那一条（评委不登录也要能打出来看）——这是 `resolveBook` 本来的形状，
 *    这一层不额外加闸，也不额外开口。
 * 3. **草稿打不出来，而且是 404 不是 403。** 没有 `book.json` 就没有页表，
 *    印出来只会是一张封面加一张空纸。与阅读器那条"不存在 / 是别人的"同一个出口
 *    （`readerStateOf` 那张表），不泄露"存在但画了一半"。
 * 4. **`?auto=1` 才自动弹打印对话框。** 从阅读器那颗按钮进来时带着它；
 *    直接打开地址只是铺开纸（见 `PrintNow.tsx` 文件头第 2 条）。
 * 5. **`noindex`。** 这是同一本书的第二种排法，没有理由被搜索引擎当成一篇文章收进去。
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import PrintBook from '@/components/print/PrintBook.tsx'
import PrintNow from '@/components/print/PrintNow.tsx'
import { createUserStore } from '@/lib/asset-scope.ts'
import { currentUserId } from '@/lib/auth/session.ts'
import { resolveBook } from '@/lib/book-source.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { printSheetsOf } from '@/lib/print-sheets.ts'

export const dynamic = 'force-dynamic'

/**
 * 一个人那一片。★ 与阅读器页面（`app/reader/[bookId]/page.tsx` 的 `readerSlice`）
 * 是同一条口径：未登录 → `null` → 只剩演示书那条路。
 * 两处各写一遍是因为它们各自是页面级的入口；口径本身只有 `resolveBook` 一处。
 */
async function readerSlice() {
  const userId = await currentUserId()
  if (!userId) return null
  return createUserStore(assetRoot(), userId)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bookId: string }>
}): Promise<Metadata> {
  const { bookId } = await params
  const resolved = await resolveBook(bookId, await readerSlice())
  return {
    title: resolved ? `打印《${resolved.book.tree.title}》· 小主角` : '找不到这本书 · 小主角',
    robots: { index: false, follow: false },
  }
}

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string }>
  searchParams: Promise<{ auto?: string | string[] }>
}) {
  const { bookId } = await params
  /**
   * ★ 图要**原尺寸 + JPEG**（见 `book-source.ts` 的 `pageWidth` 与 `thumbs.ts` 的
   *   `PRINT_QUALITY`）：屏幕那一档 1024 px 铺到 A4 上只有约 88 dpi，
   *   而原尺寸 PNG 会被浏览器的 PDF 生成器按无损压一遍，一本书 20 页就是 30 MB 上下。
   *   两个参数一起才是"清楚且发得出去"，只改一个都会掉到另一头。
   * ★ 演示书走静态文件，查询串它不认（`book-source.ts` 那条注释），
   *   所以这一档对它不起作用——那本书是仓库里的样本，几页图，不值得为它改静态导出。
   */
  const resolved = await resolveBook(bookId, await readerSlice(), {
    assetQuery: 'fmt=jpeg',
    pageWidth: null,
  })
  // 不存在、是别人的、还没画完（只有 story.json）——同一出口，理由见文件头第 3 条
  if (!resolved) notFound()

  const query = await searchParams
  const auto = (Array.isArray(query.auto) ? query.auto[0] : query.auto) === '1'
  const sheets = printSheetsOf({
    book: resolved.book,
    story: resolved.story,
    coverUrl: resolved.coverUrl,
  })

  return (
    <main className="print-page">
      <div className="print-page__bar">
        <Link className="print-page__back" href={`/reader/${bookId}`}>
          ← 回去看这本书
        </Link>
        <p className="print-page__hint">
          一共 {sheets.length} 页，A4 横向、一页一张纸。点右边那颗按钮，在打印对话框里选 「另存为
          PDF」。
        </p>
        <PrintNow auto={auto} />
      </div>
      <PrintBook sheets={sheets} />
    </main>
  )
}
