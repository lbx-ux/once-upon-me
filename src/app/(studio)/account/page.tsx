import ProfileHome, { type RecentBook } from '@/components/account/ProfileHome.tsx'
import { assetRoot } from '@/lib/books-runtime.ts'
import { coverUrlOf, runtimeAssetUrl } from '@/lib/book-source.ts'
import { listCardItems } from '@/lib/cards-list.ts'
import { createFsStore } from '@/lib/engine/providers/stores.ts'
import { listBooks, SHELF_COVER_WIDTH } from '@/lib/library.ts'

/**
 * /account —— 个人主页（登录之后侧栏底部那一格指向这里）
 *
 * 服务端这一层只做一件事：**把右边那一栏要的东西取好**——几张卡、以及最近做过的书。
 *
 * ★ 为什么放服务端，与 `/shelf` 同一条理由：两边都是盘上的清单，服务端读完直接渲染，
 *   首屏就有内容；放客户端 fetch 的话这一屏会先亮一屏空的再跳一次。
 *
 * ★ 封面这一档用的是 `SHELF_COVER_WIDTH`（384）**同一个数**，而不是另挑一档：
 *   这一屏的封面显示 74px，384 明显够；换一个更小的档（240）看着更省，
 *   但那样同一本书的封面会在书架与个人主页上各拉一次——
 *   档位是**封闭表**（`thumbs.ts`），多用一个档就多一份要维护的派生资产。
 *   理由与那个文件里"档位是封闭表"那条同源。
 *
 * ★ 这一屏**不读登录态**。身份住在 cookie 里、由客户端那一半读（`AuthProvider`），
 *   所以服务端给的是"这台服务器上的全部作品"——不是"这个人的"。
 *   组件里那两处说明（`.pf__work-sub`、以及文件头第 2 条）写的正是这件事。
 *   等书真的挂到 userId 上，这里再改成按人过滤。
 *
 * ★ 取数是 `force-dynamic`：这两个数会随着人做书、做卡而变，
 *   缓存住的话"刚做完一本，个人主页还是 3"。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '个人主页 · 小主角' }

/**
 * 右边那一列最多显示几本。
 *
 * ★ 这是个**显示**上的数，不是数据上的：书架那一屏才是"全部"。
 *   个人主页要回答的是"最近在做什么"，20 本一屏下来会把下面那两颗快捷入口推没。
 */
const RECENT_LIMIT = 5

export default async function AccountPage() {
  const store = await createFsStore(assetRoot())
  const [cards, books] = await Promise.all([
    listCardItems(),
    /* ★ 封面那条翻译只有一处（`book-source.ts` 的 `coverUrlOf`）：
       自己写一遍 `book.cover?.asset.path` 就是在抄第二份——
       而抄错的那一次的症状是"个人主页上这一本没有封面"，看不出是拼错了。 */
    listBooks(store, (book) =>
      coverUrlOf(book, (path) => runtimeAssetUrl(path, SHELF_COVER_WIDTH)),
    ),
  ])

  /**
   * 收窄成组件要的那几个字段（`RecentBook`）。
   * ★ 映射写在这里、只写这一处：组件是客户端组件，而 `BookSummary` 是引擎那一侧的类型
   *   （`lib/library.ts` import 了整个引擎）——照搬过去会把引擎拖进浏览器包。
   */
  const recent: RecentBook[] = books.slice(0, RECENT_LIMIT).map((book) => ({
    bookId: book.bookId,
    title: book.title,
    pageCount: book.pageCount,
    hasNarration: book.hasNarration,
    status: book.status,
    createdAt: book.createdAt,
    coverUrl: book.coverUrl,
  }))

  return <ProfileHome counts={{ cards: cards.length, books: books.length }} books={recent} />
}
