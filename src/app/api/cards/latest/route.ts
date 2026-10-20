/**
 * POST /api/cards/latest —— 「切回这一版」：把 `latest` 指回旧的一版
 *
 * 它只动那个一字节的指针：不删新图、不改任何一版的内容。
 *   语义是"从现在起用第 N 版形象"（下一本书会用这一版），
 *   不是"第 N 版之后那些没发生过"——已经做出来的书仍然指着它们各自那一版（ADR-0007）。
 *   所以这个动作不需要二次确认，也不该说成"撤销"：说成撤销，家长会以为
 *   刚才那一版没了，然后不敢点。
 *
 * 没有 env：这一步不调任何外部接口，纯本地指针。把 env 塞进来会让人以为
 *   这一下要花钱（ADR-0008 那条约定是给"真要调模型"的路用的）。
 *
 * 2026-10-17（工单 16）：补上登录闸（原来没有）。这一下动的是**卡号上那个
 *   一字节的指针**——没有闸的话，谁都能把别人的"现在用第几版"改掉，
 *   而症状要到那个人下一次做书时才看得出来（用的是另一版的脸）。
 */

import type { NextRequest } from 'next/server'
import { createCardStore } from '@/lib/engine/index.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { createUserStore } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  // 不要任何能力：改指针不是一次生成
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ code: 'bad-json', message: '请求体不是合法的 JSON' }, { status: 400 })
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return Response.json(
      { code: 'invalid-request', message: '请求体要是一个对象' },
      { status: 400 },
    )
  }

  const source = raw as Record<string, unknown>
  const cardId = typeof source['cardId'] === 'string' ? source['cardId'].trim() : ''
  const revision = Number(source['revision'])
  if (cardId === '' || !Number.isInteger(revision) || revision < 1) {
    return Response.json(
      { code: 'invalid-request', message: 'cardId 与 revision 都要给（revision 从 1 起）' },
      { status: 400 },
    )
  }

  const store = await createUserStore(assetRoot(), guard.session.userId)
  const cardStore = createCardStore(store)
  try {
    await cardStore.setLatest(cardId, revision)
    return Response.json({ cardId, revision })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}
