/**
 * `PATCH /api/admin/users/<id>/permissions` —— 开 / 关一个人的创作权限（BFF）
 *
 * ```
 *   { "allowed": false }  → { userId, account, …, allowed: false }
 * ```
 *
 * ★ **全量提交，不是增量**（`PermissionPatch` 那一侧的原话）：界面送来的是那一格
 *   开关现在的位置，服务端拿它整份覆盖。增量（"把它关掉"）在并发下会变成
 *   "我以为我关掉的又开了"——两个人同时改，后到的那个是基于一份过期的认知发的。
 *
 * ★ 2026-10-18：身体由四个布尔收成一位（`allowed`）。路径仍然是 `…/permissions`：
 *   它改的确实是"这个人的权限"，只是那个人现在只有一位。
 *
 * ★ 那一位**不能缺**。缺了当 `false` 就等于"一次手滑关掉了一个人的权限"；
 *   当"不改"就等于这个接口有两种语义。所以缺一个就是 `bad-json`，让调用方把话说全。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const { userId } = await ctx.params
  // ★ 用户号**只做形状检查**（一串数字），不判"存不存在"、更不判"是不是别人"：
  //   那是 Java 的事，而这里替它判一次只会造出两套规则
  if (!/^\d+$/.test(userId)) {
    return NextResponse.json({ code: 'invalid-request', message: '用户号不对' }, { status: 400 })
  }

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()

  if (typeof body['allowed'] !== 'boolean') return badJson()

  const result = await backendFetch<unknown>(
    `/api/admin/users/${encodeURIComponent(userId)}/permissions`,
    { method: 'PATCH', token: sessionTokenOf(request), body: { allowed: body['allowed'] } },
  )
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}
