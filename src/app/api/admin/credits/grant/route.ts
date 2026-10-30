/**
 * `POST /api/admin/credits/grant` —— 给某个人补几本（BFF）
 *
 * ```
 *   { userId, books, note }  → { balance }
 * ```
 *
 * ★ 用户名下的额度只有账本一个来源：这一条走的是 `reason=grant`，
 * 不是"把余额改成某个数"。管理页上那条流水会留下"谁在哪天补了几本"，
 * 而直接改余额什么都不留。
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

  const userId = body['userId']
  const books = body['books']
  if (
    typeof userId !== 'number' ||
    !Number.isInteger(userId) ||
    userId <= 0 ||
    typeof books !== 'number' ||
    !Number.isInteger(books) ||
    books <= 0
  ) {
    return NextResponse.json(
      { code: 'invalid-request', message: '要补给谁、补几本，两个都要是正整数' },
      { status: 400 },
    )
  }

  const result = await backendFetch<unknown>('/api/admin/credits/grant', {
    method: 'POST',
    token: sessionTokenOf(request),
    body: {
      userId,
      books,
      note: typeof body['note'] === 'string' ? body['note'] : '',
    },
  })
  if (!result.ok) return failureResponse(result)
  return NextResponse.json(result.data)
}
