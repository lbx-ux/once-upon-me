/**
 * `GET /api/admin/requests` —— 全部权限申请，待处理在前（BFF）
 *
 * ```
 *   → [ { requestId, userId, account, nickname, phone, wants: {…},
 *         note, status: "PENDING"|"APPROVED"|"REJECTED", createdAt, decidedAt } ]
 * ```
 *
 * ★ 与 `/api/admin/users` **分成两条路由**，不并成一个"管理页大对象"：
 *   批完一条要刷新的是这一列，不是整张用户表。并在一起的话，每批一条就把
 *   整张表重新拉一遍——顺便把别人正在改的复选框覆盖回旧值。
 *
 * ★ 这一层仍然**不做角色判断**（同 `/api/admin/users`）：`role === 'ADMIN'`
 *   的唯一一份判据在 Java 的 `AdminController#requireAdminFresh` 里。
 *   这里只过 `requireCapability(request, [])`，也就是"登录了没有"。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { failureResponse } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const result = await backendFetch<unknown>('/api/admin/requests', {
    method: 'GET',
    token: sessionTokenOf(request),
  })
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}
