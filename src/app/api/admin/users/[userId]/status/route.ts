/**
 * `PATCH /api/admin/users/<userId>/status` —— 停号 / 复号（BFF）
 *
 * ```
 *   { "status": "DISABLED" }  → 这个人现在那一行
 *   { "status": "ACTIVE" }    → 同上
 * ```
 *
 * ★ `status` 只认**这两个字符串**：Java 那边不是这两个就回 `bad-status`，
 *   但这里先挡一道的价值在于——一个手滑的 `"DISABLED "`（带空格）或
 *   `"disabled"`（小写）如果在 Java 被当成"两个都不是"，那还好；
 *   怕的是某天有人在那里加一句 `toUpperCase()`，于是**拼错的状态悄悄变成了停号**。
 *   这一层只放行确切的两种写法，多一道字面量比较。
 *
 * ★ 停用对**已经登着的会话**当场生效（Java 会顺手顶密码代次）。
 *   这里不解释这件事，界面上的文案要说。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** ★ 与 Java 的 `User.STATUS_ACTIVE` / `STATUS_DISABLED` 逐字一致 */
const STATUSES = ['ACTIVE', 'DISABLED'] as const

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const { userId } = await ctx.params
  if (!/^\d+$/.test(userId)) {
    return NextResponse.json({ code: 'invalid-request', message: '用户号不对' }, { status: 400 })
  }

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()

  const status = body['status']
  if (typeof status !== 'string' || !STATUSES.includes(status as (typeof STATUSES)[number])) {
    return badJson()
  }

  const result = await backendFetch<unknown>(
    `/api/admin/users/${encodeURIComponent(userId)}/status`,
    {
      method: 'PATCH',
      token: sessionTokenOf(request),
      body: { status },
    },
  )
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}
