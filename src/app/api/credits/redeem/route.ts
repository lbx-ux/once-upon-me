/**
 * `POST /api/credits/redeem` —— 用户输一张兑换码（BFF）
 *
 * ```
 *   { "code": "ABCD-EFGH-JKLM-NPQR" }  → { books, balance, codeTail }
 * ```
 *
 * ★ 形状检查只做一条：`code` 是字符串且不长于 64。**不在这里判 16 位、
 * 不在这里判字母表**——那是 Java 的 `CodeFactory` 说了算的事，
 * 在这里再实现一遍就是两套规则（而它们迟早会开始不一样）。
 *
 * ★ 失败原样透传：三种失败（不存在 / 用过 / 过期）是**同一句话、同一个 400**，
 * 那是刻意的，见 Java 的 `CreditService#badCode`。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()
  const code = body['code']
  if (typeof code !== 'string' || code.trim() === '' || code.length > 64) {
    return NextResponse.json({ code: 'bad-code', message: '把兑换码填进来' }, { status: 400 })
  }

  const result = await backendFetch<unknown>('/api/credits/redeem', {
    method: 'POST',
    token: sessionTokenOf(request),
    body: { code },
  })
  if (!result.ok) return failureResponse(result)
  return NextResponse.json(result.data)
}
