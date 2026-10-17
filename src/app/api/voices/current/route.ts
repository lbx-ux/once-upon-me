/**
 * `/api/voices/current` —— 换用哪一个音色（BFF，工单 16）
 *
 * ```
 *   PUT /api/voices/current   { voiceId, name?, model? }
 *     voiceId 为空串 = 取消选择（条目留着，见 `VoiceService#choose`）
 * ```
 *
 * ★ 用 `PUT` 而不是 `POST`：这个动作是"把这一格设成某个值"，发一次与发十次
 *   结果相同。隔壁 `POST /api/voices` 是"多一条"，那一个不幂等——两条路分开，
 *   是因为它们在**重发**这件事上的行为不一样，而"点了两下"是真的会发生。
 *
 * ★ `name` / `model` 是可省的：界面上"只切一次选择"的地方未必读过模型，
 *   而用空串去覆盖会把"模型对得上吗"那条判据的输入擦掉（Java 那边是"给了才覆盖"）。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import { requireCapability, sessionTokenOf } from '@/lib/auth/session.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const body = await jsonBody<Record<string, unknown>>(request)
  if (!body) return badJson()

  // ★ `voiceId` 必须**在场**（可以是空串）。缺了这一格是"调用方忘了传"，
  //   而把它当成"取消选择"会让一次拼错的请求悄悄把人的选择清掉
  const raw = body['voiceId']
  if (typeof raw !== 'string') {
    return NextResponse.json(
      { code: 'invalid-request', message: '要换哪一个音色？（空串表示这次先不指定）' },
      { status: 400 },
    )
  }

  const name = typeof body['name'] === 'string' ? body['name'] : ''
  const model = typeof body['model'] === 'string' ? body['model'] : ''

  const result = await backendFetch<unknown>('/api/voices/current', {
    method: 'PUT',
    token: sessionTokenOf(request),
    body: { voiceId: raw.trim(), name, model },
  })
  if (!result.ok) return failureResponse(result)
  return NextResponse.json(result.data)
}
