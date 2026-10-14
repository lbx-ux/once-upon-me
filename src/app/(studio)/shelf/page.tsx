import ShelfDashboard from '@/components/shelf/ShelfDashboard.tsx'
import { assetRoot } from '@/lib/books-runtime.ts'
import { createCardStore } from '@/lib/engine/character-card/store.ts'
import { createFsStore } from '@/lib/engine/providers/stores.ts'
import { listBooks } from '@/lib/library.ts'

/**
 * /shelf —— 书架（工单 05 那份仪表盘）
 *
 * 服务端只做取数：书架上有什么、有几个角色。**"今天"不在这里算**——
 * 那是本地日历的概念，交给浏览器（见 ShelfDashboard 里的注释：跨时区差一天，
 * 而"连续天数"恰恰只跟本地日历有关）。
 *
 * ★ 取数放在服务端而不是客户端 fetch：书是磁盘上的清单，服务端读完直接渲染，
 *   首屏就有内容（#12 的 LCP）。只有阅读记录必须由浏览器给——它只在本机。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '书架 · 小主角' }

export default async function ShelfPage() {
  const store = await createFsStore(assetRoot())
  const books = await listBooks(store)

  let characterCount = 0
  try {
    // 一张卡都没有 = 这个目录还没建过。那是"0 个角色"，不是错误（与 /api/cards 同一条处理）
    characterCount = (await createCardStore(store).summaries()).length
  } catch {
    characterCount = 0
  }

  return <ShelfDashboard books={books} characterCount={characterCount} />
}
