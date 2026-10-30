/**
 * `POST /api/admin/credits/codes` —— 生成一批兑换码（BFF）
 *
 * ```
 *   { batch, count, booksPerCode, expiresInDays, note }
 *     → { batch, booksPerCode, codes: ["ABCD-…", …], expiresAt }
 * ```
 *
 * ★ 这一层只做**形状检查**（是不是整数、有没有负数），业务边界（1–500 张、
 * 一张换 1–100 本、有效期 0–3650 天）由 Java 的 `CreditAdminService` 判——
 * 在这一层再写一遍就会有两套上限，而它们迟早不一样。
 *
 * ★ 响应里的 `codes` 是**明文**，只出现这一次。前端必须当场给下载。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireAdmin, sessionTokenOf } from '@/lib/auth/session.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdmin(request)
  if (!gate.ok) return gate.response

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()

  const count = integer(body['count'])
  const booksPerCode = integer(body['booksPerCode'])
  const expiresInDays = body['expiresInDays'] === undefined ? 0 : integer(body['expiresInDays'])
  if (
    count === null ||
    booksPerCode === null ||
    expiresInDays === null ||
    count < 1 ||
    booksPerCode < 1 ||
    expiresInDays < 0
  ) {
    return NextResponse.json(
      { code: 'invalid-request', message: '数量、本数、有效期都要是非负整数' },
      { status: 400 },
    )
  }

  const result = await backendFetch<unknown>('/api/admin/credits/codes', {
    method: 'POST',
    token: sessionTokenOf(request),
    body: {
      batch: typeof body['batch'] === 'string' ? body['batch'] : '',
      count,
      booksPerCode,
      expiresInDays,
      note: typeof body['note'] === 'string' ? body['note'] : '',
    },
  })
  if (!result.ok) return failureResponse(result)
  return NextResponse.json(result.data)
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}
