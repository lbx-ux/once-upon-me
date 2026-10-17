/**
 * `GET /api/permission-requests/mine` —— 「我那条还在不在」（BFF）
 *
 * ```
 *   → { "request": { requestId, status: "PENDING", wants: {…}, note, createdAt } }
 *   → { "request": null }        // 没申请过，或者已经被处理了
 * ```
 *
 * ★ 它存在的理由只有一条，但很硬：界面上要显示「你已经申请过了，等站长处理」。
 *   没有它的话，一个人点完会以为没提交成功，然后再点一次——而"一个人堆三条一样的
 *   申请"正是服务端 `PermissionRequestService#submit` 专门要防的那种东西。
 *
 * ★ `null` 与 404 的分工：**没申请过是正常状态**，不是"资源不存在"。
 *   回 404 的话，前端的 `if (res.ok)` 会走到失败分支，于是界面上会同时显示
 *   「你还没申请过」和一句红色的报错。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { AUTH_ROUTE_CONFIG, failureResponse } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

export const runtime = AUTH_ROUTE_CONFIG.runtime
export const dynamic = AUTH_ROUTE_CONFIG.dynamic

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const result = await backendFetch<unknown>('/api/permission-requests/mine', {
    method: 'GET',
    token: sessionTokenOf(request),
  })
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}
