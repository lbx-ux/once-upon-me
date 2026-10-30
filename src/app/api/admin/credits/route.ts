/**
 * `GET /api/admin/credits` —— 管理页那一张卡的总账（BFF）
 *
 * 三道闸都在服务端：`requireAdmin` 会去问 Java `/api/admin/check`
 * （角色 + 票的新鲜度），Java 那一侧还有它自己的 `requireAdminFresh`。
 * 这一层不自己看票里的 `role`——那张票里的角色是签发时的。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { failureResponse } from '@/lib/auth/bff.ts'
import { requireAdmin, sessionTokenOf } from '@/lib/auth/session.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdmin(request)
  if (!gate.ok) return gate.response

  const result = await backendFetch<unknown>('/api/admin/credits', {
    method: 'GET',
    token: sessionTokenOf(request),
  })
  if (!result.ok) return failureResponse(result)
  return NextResponse.json(result.data)
}
