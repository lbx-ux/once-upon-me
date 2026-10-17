/**
 * `POST /api/permission-requests` —— 用户提一条权限申请（BFF）
 *
 * ```
 *   { "note": "想做一本有插画的书" }        // note 也可以不给
 *     → { requestId, status: "PENDING", wants: {四项全 true}, … }
 *   400 { "code": "note-too-long", "message": "说明最多 500 个字" }
 * ```
 *
 * ★ 它替掉的是帮助弹窗里那句「发邮件到 2953997419@qq.com」（用户 2026-10-17）：
 *   邮件那条路缺的不是"能不能送到"，是**站长那边认不出人**——一个邮箱里躺着
 *   一堆"我想要画插画"，每一封都得靠签名去猜是谁。
 *
 * ★ 请求体里**只有一句说明**（2026-10-17 第二次改）：原来这里是四个布尔，
 *   让申请人自己勾要哪几项。用户把口径定成「申请的时候这些功能是一起发放的，
 *   申请的时候申请一下就行了」——于是那四个复选框撤了，而一个撤了的问题
 *   不该还留在线上契约里：留着的话，下一个人会以为服务端真的按那四个值发权限。
 *   响应里那个 `wants` 现在是服务端写死的四项全开（`PermissionRequestService#submit`）。
 *
 * ★ 这一层要过 `requireCapability(request, [])`（=「登录了没有」）：
 *   申请权限这件事的前提就是"你有一个账号"。没登录时它回 401「请先登录」，
 *   而转发给 Java 的话回的是同一件事的另一个说法。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 说明的上限。★ 与 Java 的 `PermissionRequest.NOTE_MAX` 逐字一致。
 * 这里挡一道不是"重复校验"：它省掉的是"打了三百字再被退回"，
 * 而 Java 那一道仍然是唯一作数的那一道（这里放行了它也照样会挡）。
 */
const NOTE_MAX = 500

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()

  const note = body['note']
  if (note !== undefined && note !== null && typeof note !== 'string') return badJson()
  if (typeof note === 'string' && note.length > NOTE_MAX) {
    return NextResponse.json(
      { code: 'note-too-long', message: `说明最多 ${NOTE_MAX} 个字` },
      { status: 400 },
    )
  }

  const result = await backendFetch<unknown>('/api/permission-requests', {
    method: 'POST',
    token: sessionTokenOf(request),
    body: { note: typeof note === 'string' ? note : null },
  })
  if (!result.ok) return failureResponse(result)

  return NextResponse.json(result.data)
}
