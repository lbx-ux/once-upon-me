import CharacterWall from '@/components/studio/CharacterWall.tsx'
import { listCardItems } from '@/lib/cards-list.ts'
import { loadKidNames } from '@/lib/kid-names.ts'

/**
 * /character —— 小主角（工作台的第三格）
 *
 * 服务端只做取数：有哪些卡、演示名单里有没有它们的名字。
 * 卡片长什么样、动效怎么排，全在 `components/studio/CharacterWall.tsx`。
 *
 * ★ 两个取数各自都可能空，且**都不是错误**：一张卡都没有 = 目录还没建过；
 *   `kids.json` 读不到 = 运行时新建的卡，那本来就没有名字那一层（工单 03 的活）。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '小主角 · 小主角' }

export default async function CharacterPage() {
  const [cards, names] = await Promise.all([listCardItems(), loadKidNames()])
  return <CharacterWall cards={cards} names={names} />
}
