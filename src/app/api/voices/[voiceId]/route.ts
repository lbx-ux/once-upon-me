/**
 * `/api/voices/[voiceId]` —— 从**我的列表**里删掉一条（BFF，工单 16）
 *
 * ```
 *   DELETE /api/voices/<voiceId>   → { voices, current }
 * ```
 *
 * ★★ 它**不碰厂商那边**。解绑是 `/api/voice/delete`（POST，要 `speech` 能力、
 *   要真的调一次厂商接口）。两条分开是刻意的：
 *   · "我的列表里不想留着它"与"厂商账号里那条嗓子还在"是两件事；
 *   · 合成一条的话，一次网络抖动会让人以为"厂商那边也删干净了"——
 *     而那正是隐私承诺最不能出错的一句（`/api/voice/delete` 的文件头写着）。
 *   界面上那一次删除是**两条请求**，收尾那句话分别说清各自的结果
 *   （见 `VoicePicker#removeVoice`）。
 *
 * ★ 路径上带的是**厂商的 voiceId**（不是我们表的主键）：客户端手上有的就是它，
 *   而换成我们的 id 就得先查一次"列表里哪个是它"——下一次刷新之后那个答案未必还在。
 *   Java 那边的删除条件里带着 userId，所以"删别人的那一条"在 SQL 里就不成立。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { AUTH_ROUTE_CONFIG, failureResponse } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

export const runtime = AUTH_ROUTE_CONFIG.runtime
export const dynamic = AUTH_ROUTE_CONFIG.dynamic

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ voiceId: string }> },
): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const { voiceId } = await ctx.params
  if (voiceId.trim() === '') {
    return NextResponse.json({ code: 'invalid-request', message: '要删哪一条？' }, { status: 400 })
  }

  // ★ 路径段要 encodeURIComponent：厂商的 id 里可能有 `:` `-` `.`（实测都是），
  //   而一个没编码的 `/` 会把 URL 拆成两段，那时删的是另一条（或者什么都删不到）
  const result = await backendFetch<unknown>(`/api/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    token: sessionTokenOf(request),
  })
  if (!result.ok) return failureResponse(result)
  return NextResponse.json(result.data)
}
