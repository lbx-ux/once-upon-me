/**
 * `PATCH /api/admin/users/<userId>/password` —— 替一个人重置密码（BFF）
 *
 * ```
 *   { "password": "……" }  → 这个人现在那一行（不含口令）
 * ```
 *
 * 口令从请求体进来、不被回显：响应里只有这个人现在的样子。
 *   服务端生成一个口令再告诉你，那条路要把它写进某处才能被读到，
 *   而这个仓库在密钥与录音样本上已经两次选了"没有一份要删的副本"。
 *
 * 用 `PATCH` 而不是 `PUT`：改的是这个人的一个属性（口令），不是把整个人换掉。
 *
 * 与 `PATCH .../status` 分成两条而不是合成一条"改这个人"：
 *   两条的后果差得很远（一条会把他踢下线，一条是给他一把新钥匙），
 *   而界面上按的也是两个不同的按钮。合成一条通用 patch 之后，
 *   "我到底改了什么"要读请求体才知道。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是字面量：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  // 只判"是不是一个非空字符串"。长度与复杂度是 Java 的 `AccountRules.requirePassword`，
  //   这里再写一遍就会有两套口令规则
  const password = body['password']
  if (typeof password !== 'string' || password === '') return badJson()

  const result = await backendFetch<unknown>(
    `/api/admin/users/${encodeURIComponent(userId)}/password`,
    { method: 'PATCH', token: sessionTokenOf(request), body: { password } },
  )
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}
