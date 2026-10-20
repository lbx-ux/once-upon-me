import CharacterWall from '@/components/studio/CharacterWall.tsx'
import { currentUserId } from '@/lib/auth/session.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { userSliceRoot } from '@/lib/asset-scope.ts'
import { listDemoWallItems, listWallItems } from '@/lib/children-list.ts'

/**
 * /character —— 小主角（工作台的第三格）
 *
 * 服务端只做取数：有哪些孩子、他们各长什么样、以及用他们做过几本书
 * （第五轮加的那条，悬停时露出来）。卡片长什么样、动效怎么排，
 * 全在 `components/studio/CharacterWall.tsx`。
 *
 * 工单 03 换了这一屏的取数：以前是 `listCardItems()` + `loadKidNames()`，
 *   两个来源各说一半（卡说形象、演示名单说名字），而且都取自同一份演示副产物。
 *   现在是档案（他是谁） 对 卡（他长什么样），对起来的活只有一处实现
 *   （`lib/children-list.ts`）。
 * 取数可能空，而且不是错误：一个新检出的仓库里 `.out/web` 什么都没有，
 *   那时列表里只有两个示例（档案随仓库发布）。
 * 第五轮用的是 `listWallItems()` 而不是 `listChildItems()`：多出来的那部分是
 *   "用他做过几本书"，而它要读一遍书架。只有这一屏要，所以只有这一屏付那份钱
 *   （详情页与创作流仍然用 `listChildItems`）。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '角色卡 · 小主角' }

export default async function CharacterPage() {
  // ★ 2026-10-17（工单 16）：登录之后只列自己的孩子（别人的孩子在他那一片里不存在）。
  //
  // 2026-10-18：未登录不再是空墙——访客看的是随仓库发布的示例（小满 / 小宇），
  //   走 `listDemoWallItems()`：只读 `public/demo/` 那一片，卡的图走静态地址
  //   （`public/demo/cards/…`，Next 直接发，不需要鉴权——`/api/assets` 对匿名仍然 401）。
  //   ★ 那条界线一个字没动：别人的孩子仍然要登录才看得到，因为访客那一支的根
  //   由 `demoAssetRoot()` 钉死在 `public/demo/`，它根本不认识 `.out/web`。
  //   这段改动的来由与代价记在 docs/known-tradeoffs.md（原来是"访客看到空墙"那一条）。
  const userId = await currentUserId()
  if (!userId) return <CharacterWall items={await listDemoWallItems()} />

  return <CharacterWall items={await listWallItems(userSliceRoot(assetRoot(), userId))} />
}
