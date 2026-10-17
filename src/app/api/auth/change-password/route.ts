/**
 * `POST /api/auth/change-password` —— 改密码（BFF）
 *
 * ```
 *   { "currentPassword": "……", "newPassword": "……" }  →  { "user": {…} }
 * ```
 *
 * ★ **要现在的密码**：只要拿着会话就能改的话，一个被借走的 cookie 就等于账号本身。
 * 这条判据在 Java 那边（`AuthService#changePassword`），这一层只负责转发——
 * 与设密码那条同一个分工。
 *
 * ★ 改完之后 Java 会回一张**新票**（改密码的人自己不该被踢出去），
 * 这一层把它写进 cookie。别处的旧票由服务端的"密码代次"判据作废——
 * 那是"改密码"这个动作的另一半，没有它，这个功能在一半的场景里什么都没做。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireCapability, sessionCookie, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 只要登录（不需要任何能力）：改自己的密码不该要站长授权
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const body = await jsonBody<{ currentPassword?: unknown; newPassword?: unknown }>(request)
  if (!body || typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
    return badJson()
  }

  const result = await backendFetch<{ token: string; user: unknown }>('/api/auth/password', {
    method: 'PATCH',
    token: sessionTokenOf(request),
    body: { currentPassword: body.currentPassword, newPassword: body.newPassword },
  })
  if (!result.ok) return failureResponse(result)

  const response = NextResponse.json({ user: result.data.user })
  // ★ 换成新票：旧票在这一刻已经被服务端按"密码代次"作废了，
  //   不换的话，改密码的人自己下一个请求就会被登出
  response.cookies.set(sessionCookie(result.data.token))
  return response
}
