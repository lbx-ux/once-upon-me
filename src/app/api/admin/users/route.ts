/**
 * `GET|POST /api/admin/users` —— 管理页那一屏的全部数据 / 建一个号（BFF）
 *
 * ```
 *   GET   → { users: [...], smsToday, smsDailyCap, registrationOpen, demoAccount }
 *   POST  { account, password } → 这个新号那一行（四个能力全关）
 *   403   { "code": "no-permission", "message": "当前用户没有权限，请联系管理员" }
 * ```
 *
 * `POST` 与 `GET` 同一条路径（不是 `/users/new`）：新建出来的东西**就是这个集合的
 *   一个成员**，而"往集合里加一个"本来就是 `POST` 到集合。`/new` 那种写法是
 *   "页面上有个新建表单"的形状，不是资源的形状。
 *
 * 这一层不做角色判断。`role === 'ADMIN'` 那条判据的唯一一份在 Java 里
 *   （`AdminController#requireAdminFresh`），这里只是转发——两处各判一次的话，
 *   它们迟早会不一样，而不一样的那一刻症状是"界面上看得见、点下去 403"，
 *   或者更坏的"界面藏起来了、接口收得下"。
 *
 * 但这一层要先过 `requireCapability(request, [])`：那是"登录了没有"。
 *   没登录时它回 401「请先登录」，而把请求转发给 Java 的话回的是同一件事的另一个说法
 *   （Java 那句是「密码改过了，请重新登录」那一族）。让"没登录"只有一种说法。
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

  const result = await backendFetch<unknown>('/api/admin/users', {
    method: 'GET',
    token: sessionTokenOf(request),
  })
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}

/**
 * 建一个号。
 *
 * 这里只做形状检查（两个字段都在、都是字符串、都不是纯空白），
 *   一句业务规则都不判：「账号是不是已经被用了」「口令够不够长」全在 Java 的
 *   `AccountRules` 里。在这里再判一次的下场是两套规则——而它们只要有一次不一样，
 *   症状就是"界面说不行、接口其实收得下"（或者反过来）。
 *
 * 口令进日志这一层是零：这个 handler 不 log 任何东西。`badJson()` 那句
 *   也不带原文。这是刻意的——日志会被复制出去，而口令不该有第二份副本。
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()

  const account = body['account']
  const password = body['password']
  if (typeof account !== 'string' || account.trim() === '') return badJson()
  if (typeof password !== 'string' || password === '') return badJson()

  const result = await backendFetch<unknown>('/api/admin/users', {
    method: 'POST',
    token: sessionTokenOf(request),
    body: { account: account.trim(), password },
  })
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}
