import CharacterWall from '@/components/studio/CharacterWall.tsx'
import { currentUserId } from '@/lib/auth/session.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { userSliceRoot } from '@/lib/asset-scope.ts'
import { listWallItems } from '@/lib/children-list.ts'

/**
 * /character —— 小主角（工作台的第三格）
 *
 * 服务端只做取数：有哪些孩子、他们各长什么样、以及**用他们做过几本书**
 * （第五轮加的那条，悬停时露出来）。卡片长什么样、动效怎么排，
 * 全在 `components/studio/CharacterWall.tsx`。
 *
 * ★ 工单 03 换了这一屏的取数：以前是 `listCardItems()` + `loadKidNames()`，
 *   两个来源各说一半（卡说形象、演示名单说名字），而且都取自同一份演示副产物。
 *   现在是**档案（他是谁）** 对 **卡（他长什么样）**，对起来的活只有一处实现
 *   （`lib/children-list.ts`）。
 * ★ 取数可能空，而且**不是错误**：一个新检出的仓库里 `.out/web` 什么都没有，
 *   那时列表里只有两个**示例**（档案随仓库发布）。
 * ★ 第五轮用的是 `listWallItems()` 而不是 `listChildItems()`：多出来的那部分是
 *   "用他做过几本书"，而它要读一遍书架。**只有这一屏要**，所以只有这一屏付那份钱
 *   （详情页与创作流仍然用 `listChildItems`）。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '角色卡 · 小主角' }

export default async function CharacterPage() {
  // ★ 2026-10-17（工单 16）：只列**自己**的孩子（别人的孩子在他那一片里不存在）。
  //   未登录 = 空墙（同 shelf 那段口径）。
  //   ★ 那句原来的理由写错了，2026-10-17 顺带改掉：它写的是"示例孩子也读不到了——
  //   他活在演示账号那一片里"。**示例孩子不在任何人的那一片里**，他们的档案与卡
  //   分别在 `public/demo/children/` 与 `public/demo/cards/`（见 `card-source.ts`），
  //   `listChildren` / `listCardItems` 对谁都读得到。这里看不到他们，是因为**这一行
  //   提前返回了空墙**——一个取数上的分岔，不是"示例内容有主人"。
  //   ★ 于是有一个后果要记着：示例卡的图走 `/api/assets`（要登录），而访客看到的是
  //   空墙——两者一致，所以不会出现"碎图"。要让访客也看见，得换成静态地址（README §五）。
  const userId = await currentUserId()
  if (!userId) return <CharacterWall items={[]} />

  return <CharacterWall items={await listWallItems(userSliceRoot(assetRoot(), userId))} />
}
