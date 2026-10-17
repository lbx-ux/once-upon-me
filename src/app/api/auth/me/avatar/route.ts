/**
 * `POST /api/auth/me/avatar` —— 换一个默认头像（BFF）
 *
 * ```
 *   { "avatar": "fox" }  →  { "user": {…} }
 * ```
 *
 * ★ 只收一个 id，不收文件、不收 URL：这一轮**不做上传**（用户 2026-10-16 定的：
 * 系统给几个默认头像，用户在里面挑）。所以服务器上没有"用户上传的文件"这块磁盘，
 * 也没有尺寸、体裁、过审那一串事。
 *
 * ★ id 的形状由后端判（`AccountRules.requireAvatarId`，`^[a-z0-9_-]{1,32}$`），
 * **这一层不自己判一遍**：两处各写一份判据的那天起，它们就会开始不一样。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { AUTH_ROUTE_CONFIG, badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

export const runtime = AUTH_ROUTE_CONFIG.runtime
export const dynamic = AUTH_ROUTE_CONFIG.dynamic

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const body = await jsonBody<{ avatar?: unknown }>(request)
  if (!body || typeof body.avatar !== 'string') return badJson()

  const result = await backendFetch<unknown>('/api/auth/me/avatar', {
    method: 'PATCH',
    token: sessionTokenOf(request),
    body: { avatar: body.avatar },
  })
  if (!result.ok) return failureResponse(result)

  return NextResponse.json({ user: result.data })
}
