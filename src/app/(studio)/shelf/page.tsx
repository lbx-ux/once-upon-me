import ShelfDashboard from '@/components/shelf/ShelfDashboard.tsx'
import { assetRoot } from '@/lib/books-runtime.ts'
import { coverUrlOf, runtimeAssetUrl } from '@/lib/book-source.ts'
import { createFsStore } from '@/lib/engine/providers/stores.ts'
import { listBooks, SHELF_COVER_WIDTH } from '@/lib/library.ts'
import { applyOrder, loadOrder } from '@/lib/shelf-order.ts'

/**
 * /shelf —— 书架
 *
 * 服务端把这一屏要的东西一次读完：书架上摆着哪几本、每本的封面地址。
 * ★ 这一屏**没有"今天"这个概念了**：2026-10-16 用户把顶部那块（问候语 + 四格统计 +
 *   「只记在这台设备上」那句 + 继续上次创作 + 两个 tab）整块去掉之后，
 *   剩下来的全是清单里的静态字段——于是它从客户端组件变成了纯服务端渲染：
 *   没有 `useEffect`、没有 `loadReadingLog`、也没有"挂载后才敢显示"的闪烁。
 *   原先那句"今天要在客户端算"的理由（跨时区差一天，见旧版注释与
 *   `reading-log.ts` 规则 4）跟着那块的删除一起失效——不是被推翻，是没有读者了。
 *
 * ★ 取数放在服务端而不是客户端 fetch：书是磁盘上的清单，服务端读完直接渲染，
 *   首屏就有内容（#12 的 LCP）。
 *
 * ★ 封面走 384 档（`SHELF_COVER_WIDTH`）：这一屏的书只有 100–156px 宽，
 *   1024 档是给阅读器一整页用的，一屏六本按 1024 拉就是六张 159 KB。
 *
 * ★ 2026-10-16 第二轮：**次序也是在服务端定的**（`applyOrder` + `shelf/order.json`）。
 *   用户拖动之后新次序要立刻成立，而"立刻"的正确含义是**下一次首屏就是它**——
 *   存在浏览器里的话，首屏只能按默认序渲染、挂载之后再跳一次，那正是上面刚说过的
 *   "挂载前后两副面孔"。所以顺序跟着书一起在服务端读出来（`lib/shelf-order.ts`）。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '书架 · 小主角' }

export default async function ShelfPage() {
  const store = await createFsStore(assetRoot())
  // 封面走 384 档（`SHELF_COVER_WIDTH`）：这一屏的书只有 104–156px 宽，
  // 1024 档是给阅读器一整页用的，一屏六本按 1024 拉就是六张 159 KB
  const books = await listBooks(store, (book) =>
    coverUrlOf(book, (path) => runtimeAssetUrl(path, SHELF_COVER_WIDTH)),
  )

  return <ShelfDashboard books={applyOrder(books, await loadOrder(store))} />
}
