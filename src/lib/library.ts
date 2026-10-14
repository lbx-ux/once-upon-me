/**
 * library.ts —— 书架上有什么（主页要的那份清单）
 *
 * 与 `book-source.ts` 的关系：那个回答"**这一本**在哪、怎么读"（单本，含演示书），
 * 这个回答"**一共有哪些本**"（列表）。分开是因为用途不同——阅读器要的是完整清单与页表，
 * 主页要的是一行摘要，把整本 `book.json`（含每页的 prompt 与资产指纹）搬到主页上是浪费。
 *
 * ★ 两条约定：
 *
 * 1. **只列运行期的书**（资产根下 `books/<id>/book.json`），不列 `public/demo` 里那本。
 *    理由是"我的故事"这个标题：随仓库提交的演示书不是用户做的，混进来就是往
 *    "已创作故事"里灌一个假数。演示书有自己的入口（首页"看一本成品"）。
 * 2. **摘要里的每个数都来自清单本身**，一个都不推算。页数 = `tree.nodes.length`，
 *    有图页数 = `illustrations` 里真的有条目的那些，"有朗读" = `narrations` 非空。
 *    推算出来的数（比如"大概 20 分钟能读完"）不进这里——那是另一种编。
 */

import { manifestPathOf, type Book } from './engine/index.ts'
import type { AssetStore } from './engine/providers/types.ts'

export type BookSummary = {
  bookId: string
  title: string
  /** 故事树里的页数 */
  pageCount: number
  /** 真的落了图的页数。★ 与页数分开记：一本 20 页里 3 页没出图是可能的，那是两件事 */
  illustratedCount: number
  /** 这本书有没有朗读（`narrations` 非空） */
  hasNarration: boolean
  cardId: string
  createdAt: number
}

/** 一份清单 → 一行摘要。纯函数，所以"页数怎么算"这件事可以被测 */
export function summarize(book: Book): BookSummary {
  return {
    bookId: book.bookId,
    title: book.tree?.title ?? '(没有名字的书)',
    pageCount: book.tree?.nodes?.length ?? 0,
    illustratedCount: book.illustrations?.length ?? 0,
    hasNarration: (book.narrations?.length ?? 0) > 0,
    cardId: book.cardId,
    createdAt: book.createdAt ?? 0,
  }
}

/**
 * 列书。读不到、或半截 JSON（进程被杀时最后写的那一件）都跳过——
 * 一本读不出来的书不该让整个书架 500（`book-source.ts` 对同一件事的处理是一样的）。
 */
export async function listBooks(store: AssetStore): Promise<BookSummary[]> {
  let paths: string[]
  try {
    paths = await store.list('books/')
  } catch {
    return []
  }
  const manifests = paths.filter((path) => path.endsWith('/book.json'))
  const books: BookSummary[] = []
  for (const path of manifests) {
    // ★ `readJson` 对半截 JSON 是**抛错**的（不是返回 null——这条是 library.test.ts 抓出来的）。
    //   进程被杀时最后写的那一件就是这种形状，而 `book-source.ts` 对同一件事的处理是
    //   "不存在与半截 JSON 都当作这里没有这本书"。一本读不出来的书不该让整个书架 500。
    let book: Book | null = null
    try {
      book = await store.readJson<Book>(path)
    } catch {
      book = null
    }
    if (book) books.push(summarize(book))
  }
  // 新的在前。同一毫秒（不可能但便宜）按书号兜底，保证顺序稳定
  return books.sort((a, b) => b.createdAt - a.createdAt || a.bookId.localeCompare(b.bookId))
}

/** 书号 → 清单路径。与引擎同一个约定，不许在别处再拼一次 */
export { manifestPathOf }
