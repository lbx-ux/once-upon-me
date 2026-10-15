import CharacterWall from '@/components/studio/CharacterWall.tsx'
import { listChildItems } from '@/lib/children-list.ts'

/**
 * /character —— 小主角（工作台的第三格）
 *
 * 服务端只做取数：有哪些孩子、他们各长什么样。卡片长什么样、动效怎么排，
 * 全在 `components/studio/CharacterWall.tsx`。
 *
 * ★ 工单 03 换了这一屏的取数：以前是 `listCardItems()` + `loadKidNames()`，
 *   两个来源各说一半（卡说形象、演示名单说名字），而且都取自同一份演示副产物。
 *   现在是**档案（他是谁）** 对 **卡（他长什么样）**，对起来的活只有一处实现
 *   （`lib/children-list.ts`）。
 * ★ 取数可能空，而且**不是错误**：一个新检出的仓库里 `.out/web` 什么都没有，
 *   那时列表里只有两个**示例**（档案随仓库发布）。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '小主角 · 小主角' }

export default async function CharacterPage() {
  return <CharacterWall items={await listChildItems()} />
}
