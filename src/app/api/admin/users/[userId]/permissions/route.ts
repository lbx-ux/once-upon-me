/**
 * `PATCH /api/admin/users/<id>/permissions` —— 改一个人的四个开关（BFF）
 *
 * ```
 *   { "text": true, "image": true, "vision": false, "speech": false }
 *     → { userId, account, …, permissions: {…} }
 * ```
 *
 * ★ **全量提交，不是增量**（`PermissionPatch` 那一侧的原话）：界面送来的是四个布尔，
 *   服务端拿它整份覆盖。增量（"把 image 关掉"）在并发下会变成
 *   "我以为我关掉的又开了"——两个人同时改，后到的那个是基于一份过期的认知发的。
 *
 * ★ 四个字段**一个都不能少**。少一个的话，把它当 `false` 处理就等于
 *   "一次手滑关掉了一项权限"；当"不改"处理就等于这个接口有两种语义。
 *   所以缺一个就是 `bad-json`，让调用方把话说全。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 四个能力。★ 与 `lib/auth/session.ts` 的 `Capability`、与 Java 的 `Permissions` 同一组 */
const KEYS = ['text', 'image', 'vision', 'speech'] as const

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

  const patch: Record<string, boolean> = {}
  for (const key of KEYS) {
    if (typeof body[key] !== 'boolean') return badJson()
    patch[key] = body[key]
  }

  const result = await backendFetch<unknown>(
    `/api/admin/users/${encodeURIComponent(userId)}/permissions`,
    { method: 'PATCH', token: sessionTokenOf(request), body: patch },
  )
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}
