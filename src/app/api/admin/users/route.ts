/**
 * `GET /api/admin/users` —— 管理页那一屏的全部数据（BFF）
 *
 * ```
 *   GET  → { users: [...], smsToday, smsDailyCap, registrationOpen, demoAccount }
 *   403  { "code": "no-permission", "message": "当前用户没有权限，请联系管理员" }
 * ```
 *
 * ★ **这一层不做角色判断**。`role === 'ADMIN'` 那条判据的唯一一份在 Java 里
 *   （`AdminController#requireAdminFresh`），这里只是转发——两处各判一次的话，
 *   它们迟早会不一样，而不一样的那一刻症状是"界面上看得见、点下去 403"，
 *   或者更坏的"界面藏起来了、接口收得下"。
 *
 * ★ 但这一层**要**先过 `requireCapability(request, [])`：那是"登录了没有"。
 *   没登录时它回 401「请先登录」，而把请求转发给 Java 的话回的是同一件事的另一个说法
 *   （Java 那句是「密码改过了，请重新登录」那一族）。让"没登录"只有一种说法。
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

  const result = await backendFetch<unknown>('/api/admin/users', {
    method: 'GET',
    token: sessionTokenOf(request),
  })
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}
