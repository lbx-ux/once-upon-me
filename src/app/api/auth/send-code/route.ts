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

import { backendFetch, clientIpFrom } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  const body = await jsonBody<{ account?: unknown }>(request)
  if (!body || typeof body.account !== 'string') return badJson()

  const result = await backendFetch<{ ok: boolean; devMode: boolean; hint: string | null }>(
    '/api/auth/sms/send',
    {
      method: 'POST',
      body: { account: body.account },
      // ★ 客户端 IP 必须跟着走：Java 那边的频控有一层是"按 IP"，而它只能从
      //   这个头里知道 IP 是谁（回环那一跳上 getRemoteAddr 永远是 127.0.0.1）。
      //   不带它的后果是**全站共用一格**：第 6 个人就发不出验证码。
      clientIp: clientIpFrom(request),
    },
  )
  if (!result.ok) return failureResponse(result)

  // 原样透传：开发模式那句"没有真正发送"要能一路走到屏幕上
  return NextResponse.json(result.data)
}
