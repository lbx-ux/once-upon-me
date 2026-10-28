/**
 * `POST /api/auth/login-password` —— 密码登录（BFF）
 *
 * ```
 *   { "account": "123456", "password": "123456" }  →  { "user": {…} }
 * ```
 *
 * 路径叫 `login-password` 而不是 `login`：它与 `/api/auth/verify-code`
 * 是并列的两条进门路（一个用码、一个用口令），名字里说清是哪一条。
 * 上一轮那个前端函数就叫 `loginWithPassword`，这一层跟着它走。
 *
 * 连错 5 次锁 10 分钟在 Java 那边（`LoginAttemptGuard`）——不在这里：
 * 这一层是无状态的，每个请求可能落在不同的实例上，做计数只会做成一份假账。
 */

import { NextResponse } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { isHttps, sessionCookie } from '@/lib/auth/session.ts'

// ★ 段配置必须是字面量：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  const body = await jsonBody<{ account?: unknown; password?: unknown }>(request)
  if (!body || typeof body.account !== 'string' || typeof body.password !== 'string') {
    return badJson()
  }

  const result = await backendFetch<{ token: string; user: unknown }>('/api/auth/login', {
    method: 'POST',
    body: { account: body.account, password: body.password },
  })
  if (!result.ok) return failureResponse(result)

  const response = NextResponse.json({ user: result.data.user })
  response.cookies.set(sessionCookie(result.data.token, isHttps(request)))
  return response
}
