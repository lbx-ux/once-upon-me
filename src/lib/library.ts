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
 * 3. **封面地址由调用方给**（`urlOf`）。这一屏要把封面显示多大是显示的事，
 *    不是书库的事；而"资产路径 → 地址"那条翻译只有一条
 *    （`book-source.ts` 的 `runtimeAssetUrl`，以 `coverUrlOf` 递进来）。
 */

import { manifestPathOf, isDraft, type Book } from './engine/index.ts'
import type { AssetStore } from './engine/providers/types.ts'

/** 书架上那一排怎么分组。判据的那一份在 `engine/domain.ts`（`Book.status` + `isDraft`） */
export type BookStatus = 'draft' | 'published'

export type BookSummary = {
  bookId: string
  title: string
  /** 故事树里的页数 */
  pageCount: number
  /** 真的落了图的页数。★ 与页数分开记：一本 20 页里 3 页没出图是可能的，那是两件事 */
  illustratedCount: number
  /** 这本书有没有朗读（`narrations` 非空） */
  hasNarration: boolean
  /**
   * 草稿还是成品（工单 03）。
   *
   * ★ **缺省是成品**，判据在引擎那边只有一处（`isDraft`）：盘上老的 `book.json`
   *   与随仓库提交的演示书都**没有这个字段**，把它们判成草稿会让它们
   *   凭空从书架消失——而用户只会以为书丢了。
   */
  status: BookStatus
  cardId: string
  createdAt: number
  /**
   * 封面地址。**null = 这本书没有封面**（`Book.cover` 是可选字段，为读旧书而留）。
   *
   * ★ 与 `ResolvedBook.coverUrl` 同一条规矩：没有封面就照实没有，
   *   **不许拿第一页冒充封面**——那是"图没到位就留一个诚实的兜底"这条。
   */
  coverUrl: string | null
}

/**
 * 书架上那本封面要多大。★ 一个数只写一遍：显示宽度（`shelf.css` 的 `--book-w`，
 * 上限 192px）× 2 倍屏 = 384 → **正好**是 `thumbs.ts` 档位表里的 384 那一档。
 * ★ 2026-10-17 `--book-w` 从 156 抬到 192 时，这个数**没动**：192 就是这一档的
 *   天花板，抬上去只是把已经付过钱的那一档用满，请求还是 `?w=384`。
 *   越过它才要改这里（→ 512），而那是一次真花钱的决定。
 * 档位是封闭表，写小了会被向上归到 384，写大了就白拉一张 1024 的（116 KB → 一屏六本）。
 */
export const SHELF_COVER_WIDTH = 384

/**
 * "这一屏不显示封面" —— 给只数数、不摆封面的调用方（角色墙数"用他做过几本"）。
 *
 * ★ 显式传进来，**不设默认值**：默认值会让"调用方忘了给"和"这本书本来就没有封面"
 *   在类型上都是 `null`——而它们不是一件事。这是 domain.ts 那条
 *   "缺图 vs 未核对"的翻版，这里不重犯。
 */
export const noCovers = (): null => null

/** 一份清单 → 一行摘要。纯函数，所以"页数怎么算"这件事可以被测 */
export function summarize(book: Book, coverUrl: string | null): BookSummary {
  return {
    bookId: book.bookId,
    title: book.tree?.title ?? '(没有名字的书)',
    pageCount: book.tree?.nodes?.length ?? 0,
    illustratedCount: book.illustrations?.length ?? 0,
    hasNarration: (book.narrations?.length ?? 0) > 0,
    // ★ 判据走 `isDraft`，不在这里再写一遍 `book.status === 'draft'`：
    //   那个函数带着"缺省 = 成品"这条**迁移决定**，抄第二份就会有一天抄漏
    status: isDraft(book) ? 'draft' : 'published',
    cardId: book.cardId,
    createdAt: book.createdAt ?? 0,
    coverUrl,
  }
}

/**
 * 列书。读不到、或半截 JSON（进程被杀时最后写的那一件）都跳过——
 * 一本读不出来的书不该让整个书架 500（`book-source.ts` 对同一件事的处理是一样的）。
 *
 * `coverUrlOf` 由调用方给：**这一屏要把封面显示多大，是显示的事，不是书库的事**。
 * 路径 → 地址那条翻译只有一条（`book-source.ts` 的 `runtimeAssetUrl`，经过
 * `coverUrlOf` 递进来），这里只负责把每一本 `book` 交出去。不显示封面的调用方
 * 传 `noCovers`。
 */
export async function listBooks(
  store: AssetStore,
  coverUrlOf: (book: Book) => string | null,
): Promise<BookSummary[]> {
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
    if (book) books.push(summarize(book, coverUrlOf(book)))
  }
  // 新的在前。同一毫秒（不可能但便宜）按书号兜底，保证顺序稳定
  return books.sort((a, b) => b.createdAt - a.createdAt || a.bookId.localeCompare(b.bookId))
}

/** 书号 → 清单路径。与引擎同一个约定，不许在别处再拼一次 */
export { manifestPathOf }
