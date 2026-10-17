/**
 * `DELETE /api/admin/users/<userId>` —— 删一个号（BFF）
 *
 * ```
 *   204 空响应
 *   400 { "code": "demo-account", "message": "演示账号删了会在下次启动时长回来…" }
 *   400 { "code": "last-admin",   "message": "这是最后一个管理员，删掉之后就没人能改权限了" }
 * ```
 *
 * ★ 用 `DELETE` 而不是 `POST .../delete`：这一条是**真的删**，而
 *   "HTTP 动词与后果对得上"是这一层唯一还剩下的自我说明。
 *
 * ★ **响应是空的（204），不是"删掉的那一行"**：那一行已经不存在了，
 *   回一份它的快照等于给出一份过了期的真相。前端要的是"这一行从列表里去掉"，
 *   而它本来就该整页重取一次。
 *
 * ★ 它**不会**带走这个人做过的绘本——此刻作品还挂不到人身上（工单 16）。
 *   那句话在 Java 的 `AdminService#deleteUser` 上，这里不重复。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { failureResponse } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const { userId } = await ctx.params
  if (!/^\d+$/.test(userId)) {
    return NextResponse.json({ code: 'invalid-request', message: '用户号不对' }, { status: 400 })
  }

  const result = await backendFetch<unknown>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    token: sessionTokenOf(request),
  })
  if (!result.ok) return failureResponse(result)

  return new NextResponse(null, { status: 204 })
}
