/**
 * `/api/voices` —— 这个账号记着哪些音色、现在用哪一个（BFF，工单 16）
 *
 * ```
 *   GET   /api/voices   → { voices: [{voiceId, name, model, createdAt}], current }
 *   POST  /api/voices   { voiceId, name, model }   记一条刚录出来的（它成为当前）
 * ```
 *
 * ★★ 命名与隔壁那个 `/api/voice/*` 分开，别混：
 *   · `/api/voice/clone` `/api/voice/preview` `/api/voice/delete` —— 厂商侧的动作：
 *     要能力、要花钱、样本只在那条路上出现一次；
 *   · 这里（复数）—— 这个账号记着哪些音色、用哪一个：我们自己的库，
 *     一个字节的音频都没有（`server/.../db/schema.sql` 的 `voices` 表上写着）。
 *
 * 它替掉的是浏览器 localStorage（2026-10-17）。理由只有一条而它足够：
 *   换台设备就没了。"我录的声音"看起来像账号的属性，却住在一台设备的浏览器里。
 *
 * ★ 闸门是 `requireCapability(request, [])`（= 登录了没有）。不要 `speech` 能力：
 *   挑一个音色、看看自己录过哪些，不需要"再开一项权限"——真正要能力的是
 *   克隆（`/api/voice/clone`，`['speech']`）。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是字面量：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const result = await backendFetch<unknown>('/api/voices', {
    method: 'GET',
    token: sessionTokenOf(request),
  })
  if (!result.ok) return failureResponse(result)
  return NextResponse.json(result.data)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()

  const voiceId = textOf(body['voiceId'])
  const name = textOf(body['name'])
  const model = textOf(body['model'])
  if (voiceId === '') {
    return NextResponse.json(
      { code: 'invalid-request', message: '要记哪一条音色？' },
      { status: 400 },
    )
  }

  const result = await backendFetch<unknown>('/api/voices', {
    method: 'POST',
    token: sessionTokenOf(request),
    body: { voiceId, name, model },
  })
  if (!result.ok) return failureResponse(result)
  return NextResponse.json(result.data)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
