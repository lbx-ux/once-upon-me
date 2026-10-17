/**
 * `PATCH /api/admin/requests/<requestId>` —— 批 / 拒一条申请（BFF）
 *
 * ```
 *   { "approve": true }   → { requestId, status: "APPROVED", … }
 *   { "approve": false }  → { requestId, status: "REJECTED", … }
 *   400 { "code": "already-decided", "message": "这条申请已经处理过了" }
 * ```
 *
 * ★ `approve` **必须是布尔**：`{"approve": "false"}`（字符串）或漏掉这个字段，
 *   Java 那边收到原始 `boolean` 会当成 `false` —— 也就是**悄悄拒掉**一条申请，
 *   而发出这个请求的人以为自己在批准。这一层挡住它比事后查"谁批的"便宜。
 *
 * ★ 批准的含义是**并上**（不是换成）：一个已经有文本权限、这次只申请图像的人，
 *   批完两项都在。那条规则写在 Java 的 `PermissionRequestService#decide` 上，
 *   这里不重复一遍——重复的那一份迟早会与它不一样。
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
  ctx: { params: Promise<{ requestId: string }> },
): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const { requestId } = await ctx.params
  // ★ 编号**只做形状检查**（一串数字），不判"存不存在"——那是 Java 的事
  if (!/^\d+$/.test(requestId)) {
    return NextResponse.json({ code: 'invalid-request', message: '申请编号不对' }, { status: 400 })
  }

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()
  if (typeof body['approve'] !== 'boolean') return badJson()

  const result = await backendFetch<unknown>(
    `/api/admin/requests/${encodeURIComponent(requestId)}`,
    { method: 'PATCH', token: sessionTokenOf(request), body: { approve: body['approve'] } },
  )
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}
