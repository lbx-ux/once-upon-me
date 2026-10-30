/**
 * `GET /api/credits` —— 我还剩几本、最近几十笔（BFF）
 *
 * 只要登录，不要任何能力（`[]`）：额度与"有没有创作权"是两件事——
 * 权限被收回的人仍然该看得见自己还剩几本、也仍然兑得掉一张码（那是他的钱）。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { failureResponse } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是字面量：成员表达式 Next 读不了（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const result = await backendFetch<unknown>('/api/credits', {
    method: 'GET',
    token: sessionTokenOf(request),
  })
  if (!result.ok) return failureResponse(result)
  return NextResponse.json(result.data)
}
