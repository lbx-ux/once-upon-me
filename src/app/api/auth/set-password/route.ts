/**
 * `POST /api/auth/set-password` —— 新用户设密码（BFF）
 *
 * ```
 *   { "password": "……" }   →   { "user": {…} }        // 会话 cookie 已经下发
 * ```
 *
 * 请求体里没有手机号：号码从那张某已验证的票里读（票在 cookie 里，是我们签的）。
 * 让客户端说"我给哪个号设密码"，就是把"这个号验证过了"这件事交给客户端保证——
 * 那样任何一个人打开控制台就能给任意号码设密码。
 *
 * 设完之后那张票立刻清掉：它的用途只有这一次。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import {
  clearedCookie,
  isHttps,
  sessionCookie,
  TICKET_COOKIE,
  ticketTokenOf,
} from '@/lib/auth/session.ts'

// ★ 段配置必须是字面量：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await jsonBody<{ password?: unknown }>(request)
  if (!body || typeof body.password !== 'string') return badJson()

  const ticket = ticketTokenOf(request)
  // 票不在（过期 / 没验证过）→ 这一步根本没资格发生。
  // 401 而不是 400：要人做的事是"回到上一步"，不是"改一下你的输入"
  if (!ticket) {
    return NextResponse.json(
      { code: 'no-ticket', message: '手机号还没验证过，请先用验证码登录' },
      { status: 401 },
    )
  }

  const result = await backendFetch<{ token: string; user: unknown }>('/api/auth/password', {
    method: 'POST',
    body: { ticket, password: body.password },
  })
  if (!result.ok) return failureResponse(result)

  const response = NextResponse.json({ user: result.data.user })
  response.cookies.set(sessionCookie(result.data.token, isHttps(request)))
  response.cookies.set(clearedCookie(TICKET_COOKIE, isHttps(request)))
  return response
}
