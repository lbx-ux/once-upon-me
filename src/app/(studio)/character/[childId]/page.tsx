import { notFound } from 'next/navigation'

import ChildDetail from '@/components/studio/ChildDetail.tsx'
import { childDetailOf } from '@/lib/children-list.ts'
import { isDemoChildId } from '@/lib/children-source.ts'

/**
 * /character/[childId] —— 一个孩子的形象页（工单 03 的 2.3 与第三刀）
 *
 * 四件事在这一屏上：**看**（现在这一版）、**提建议再画一版**、**切回旧版**、**删掉他**。
 * 取数在 `children-list.ts`（档案 + 卡 + 版本历史），交互在 `ChildDetail.tsx`。
 *
 * ★ childId 直接来自 URL 那一段。这里把它交给数据层，**由数据层去挡**
 *   （`profile-store` 的路径校验）——路由这层只转发字符串，它不知道
 *   childId 会被拿去当路径的一段。读不出这个孩子就是 404，不是报错页。
 * ★ `demoId` 与 `isDemo` 一起给过去：前者管"能不能删"，后者管"标不标示例"。
 *   两个判据在这里算好，客户端不做第二次判断（它读不到 `public/`）。
 */

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params
  const detail = await childDetailOf(childId)
  return { title: detail ? `${detail.item.profile.name} · 小主角` : '角色卡 · 小主角' }
}

export default async function ChildPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params
  const detail = await childDetailOf(childId)
  if (!detail) notFound()

  return (
    <ChildDetail
      profile={detail.item.profile}
      isDemo={detail.item.source === 'demo'}
      demoId={await isDemoChildId(childId)}
      revisions={detail.revisions}
      anchors={detail.item.card?.anchors ?? []}
    />
  )
}
