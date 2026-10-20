import BooklistWall from '@/components/booklist/BooklistWall.tsx'
import { listBooklist } from '@/lib/booklist-assets.ts'

/**
 * /booklist —— 灵感书单（侧栏「创作」与「书架」之间的那一格）
 *
 * 服务端这一层只做一件事：问盘。12 本样书的图与音频是分批到达的，
 * "哪几张到了"只有服务端知道（`lib/booklist-assets.ts`），所以卡面上的
 * "画还在画 · 5/8"是真的数，而不是一个猜出来的进度。
 *
 * 取数放在服务端而不是客户端 fetch：它是磁盘上的一组文件名，服务端读完直接渲染，
 *   首屏就有内容（#12 的 LCP），与 `/shelf`、`/home` 同一套做法。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '灵感书单 · 小主角' }

export default async function BooklistPage() {
  const entries = await listBooklist()
  return <BooklistWall entries={entries} />
}
