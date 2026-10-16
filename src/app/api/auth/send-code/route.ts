/**
 * `POST /api/auth/send-code` —— 发验证码（BFF）
 *
 * ```
 *   { "account": "13800138000" }  →  { "ok": true, "devMode": false }
 * ```
 *
 * ★ 浏览器**从不直接打 Java**：它连不到（Java 只听回环），而这一层顺手把
 * "后端在哪、要带什么内部令牌"这两件事关在服务端。
 *
 * ★ 频控全在后端（三层 + 每日硬顶），这一层**不自己加一道**：
 * 两道频控在同一个窗口上算，早晚会算出不一样的结果，而那时候
 * "为什么我被挡了"就成了一个要读两处代码才答得上来的问题。
 */

import { NextResponse } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { AUTH_ROUTE_CONFIG, badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'

export const runtime = AUTH_ROUTE_CONFIG.runtime
export const dynamic = AUTH_ROUTE_CONFIG.dynamic

export async function POST(request: Request): Promise<NextResponse> {
  const body = await jsonBody<{ account?: unknown }>(request)
  if (!body || typeof body.account !== 'string') return badJson()

  const result = await backendFetch<{ ok: boolean; devMode: boolean; hint: string | null }>(
    '/api/auth/sms/send',
    { method: 'POST', body: { account: body.account } },
  )
  if (!result.ok) return failureResponse(result)

  // 原样透传：开发模式那句"没有真正发送"要能一路走到屏幕上
  return NextResponse.json(result.data)
}
