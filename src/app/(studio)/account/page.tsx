import ProfileHome from '@/components/account/ProfileHome.tsx'
import { assetRoot } from '@/lib/books-runtime.ts'
import { listCardItems } from '@/lib/cards-list.ts'
import { createFsStore } from '@/lib/engine/providers/stores.ts'
import { listBooks, noCovers } from '@/lib/library.ts'

/**
 * /account —— 个人主页（登录之后侧栏底部那一格指向这里）
 *
 * 服务端这一层只做一件事：**数数**。数出这台设备上有几张角色卡、几本书。
 *
 * ★ 为什么放服务端，与 `/shelf` 同一条理由：两边都是盘上的清单，服务端读完直接渲染，
 *   首屏就有数字；放客户端 fetch 的话这一屏会先亮两个 0 再跳一次。
 * ★ 顺手省掉的是**封面**：`noCovers()` 明确说"这一屏只看数，不摆封面"。
 *   不省的话这里会去读一遍 `books/` 下每一张封面图，而这一屏一个字都用不上它们
 *   （`noCovers` 刻意没有默认值，理由写在 `lib/library.ts` 上：默认值会让
 *   "调用方忘了给"和"这本书本来就没封面"在类型上都是 null，而它们不是一件事）。
 *
 * ★ 取数是 `force-dynamic`：这两个数会随着人做书、做卡而变，
 *   缓存住的话"刚做完一本，个人主页还是 3"。
 *
 * ★ 这一屏**不读登录态**。身份住在本机（`AuthProvider` / localStorage），
 *   服务端此刻无从知道是谁——所以这一页是"壳由服务端给、身份由客户端填"。
 *   等后端落地、session 变成服务端能读的东西，这一页的取数才会开始跟人有关：
 *   那时 `counts` 会变成"这个人的书"，而组件里那两处「这台设备上」也才该改口
 *   （见 `ProfileHome.tsx` 文件头第 2 条）。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '个人主页 · 小主角' }

export default async function AccountPage() {
  const store = await createFsStore(assetRoot())
  const [cards, books] = await Promise.all([listCardItems(), listBooks(store, noCovers)])

  return <ProfileHome counts={{ cards: cards.length, books: books.length }} />
}
