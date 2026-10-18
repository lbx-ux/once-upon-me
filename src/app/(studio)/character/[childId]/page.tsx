import { notFound } from 'next/navigation'

import ChildDetail from '@/components/studio/ChildDetail.tsx'
import { userSliceRoot } from '@/lib/asset-scope.ts'
import { currentUserId } from '@/lib/auth/session.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import {
  childDetailOf,
  demoChildDetailOf,
  type ChildDetail as ChildDetailData,
} from '@/lib/children-list.ts'
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

/**
 * 这一屏的取数：**谁能看谁**，只此一处。
 *
 * - 登录 → 只在**自己那一片**里找。别人的 childId 读不到 → 404（不是"读出来再判是不是他的"）。
 * - 访客（未登录）→ 只有**随仓库发布的示例**能看，走 `demoChildDetailOf`：
 *   它只读 `public/demo/`（`demoAssetRoot()`），所以"别人的孩子"这条路在访客那一支里
 *   **根本不存在**——不是被过滤掉，是那个根底下没有这个人。
 *
 * ★ 2026-10-18：访客那一支是这一轮加的（用户："没有登录的人，那两个默认角色卡也是可以看见的"）。
 *   `canEdit` 由**这里**决定，界面照它把写动作收起来——判据在服务端，与 `demoId` 那条一样。
 */
async function detailFor(
  childId: string,
): Promise<{ detail: ChildDetailData; canEdit: boolean } | null> {
  const userId = await currentUserId()
  if (userId) {
    const detail = await childDetailOf(childId, userSliceRoot(assetRoot(), userId))
    return detail ? { detail, canEdit: true } : null
  }
  // 访客：只有示例 id 放行（判据是"这个 id 在示例里存在"，见 `children-source.ts`）
  if (!(await isDemoChildId(childId))) return null
  const detail = await demoChildDetailOf(childId)
  return detail ? { detail, canEdit: false } : null
}

export async function generateMetadata({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params
  const found = await detailFor(childId)
  return { title: found ? `${found.detail.item.profile.name} · 小主角` : '角色卡 · 小主角' }
}

export default async function ChildPage({ params }: { params: Promise<{ childId: string }> }) {
  const { childId } = await params
  const found = await detailFor(childId)
  if (!found) notFound()

  const { detail, canEdit } = found
  return (
    <ChildDetail
      profile={detail.item.profile}
      isDemo={detail.item.source === 'demo'}
      demoId={await isDemoChildId(childId)}
      canEdit={canEdit}
      revisions={detail.revisions}
      anchors={detail.item.card?.anchors ?? []}
    />
  )
}
