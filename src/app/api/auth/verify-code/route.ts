/**
 * `POST /api/auth/verify-code` —— 核验验证码（BFF）
 *
 * ```
 *   { "account": "13800138000", "code": "123456" }
 *     →  { "kind": "signed-in",      "user": {…} }        // 老用户，cookie 已经下发
 *     →  { "kind": "needs-password" }                     // 新用户，票在 cookie 里
 * ```
 *
 * 两种票（会话票 / 设密码票）都进 cookie，一个字节都不回给浏览器。
 * 上一版那张"已验证会话"的注释里写着"它不落盘、刷新就没"——现在是更强的一条：
 * 它压根不出现在 JS 能碰到的地方（httpOnly）。
 */

import { NextResponse } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { isHttps, sessionCookie, ticketCookie } from '@/lib/auth/session.ts'

// ★ 段配置必须是字面量：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Verdict = {
  kind: 'signed-in' | 'needs-password'
  token: string
  user: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await jsonBody<{ account?: unknown; code?: unknown }>(request)
  if (!body || typeof body.account !== 'string' || typeof body.code !== 'string') return badJson()

  const result = await backendFetch<Verdict>('/api/auth/sms/verify', {
    method: 'POST',
    body: { account: body.account, code: body.code },
  })
  if (!result.ok) return failureResponse(result)

  const verdict = result.data
  const response = NextResponse.json({
    kind: verdict.kind,
    // 只把"这个人是谁"给浏览器。★ 票不在这里
    ...(verdict.kind === 'signed-in' ? { user: verdict.user } : {}),
  })

  if (verdict.kind === 'needs-password') {
    response.cookies.set(ticketCookie(verdict.token, isHttps(request)))
  } else {
    response.cookies.set(sessionCookie(verdict.token, isHttps(request)))
  }
  return response
}
