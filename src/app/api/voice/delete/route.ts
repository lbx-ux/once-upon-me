import { EngineError } from '@/lib/engine/index.ts'
import type { NextRequest } from 'next/server'
import { voiceProviderOf } from '@/lib/engine/providers/registry.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'

/**
 * POST /api/voice/delete —— 删掉一条（我自己的）音色
 *
 * 这是隐私承诺的那一半：不想要时能删掉。契约与"删孩子"同源——
 * 界面先说清"将要失去什么"，这里只负责真的删，并且失败不吞：
 * 一个把失败变成 `{released:false}` 又不说的实现，会让"已经删干净了"这句话变成假的
 * （`qwen-speech.ts` 的 release 上有这条注释，实测依据也在那里：删完再合成是 400）。
 *
 * 这里不做两步确认：确认是界面的事（列出将要失去什么、给一张报数的凭据）。
 *   服务端只认一件事——收到哪个 voiceId 就删哪个。把确认做进接口，两边会各有一份
 *   不同的"将要失去什么"，迟早一份说 8 条另一份说 7 条。
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ERROR_CHARS = 300

export async function POST(req: NextRequest): Promise<Response> {
  // 闸门在最前：这三条都只花语音的钱，所以只要语音那一个能力
  //   （用户 2026-10-16 定的：权限只管"能不能用语音"，用哪个音色仍由用户选）
  const guard = await requireCapability(req, ['speech'])
  if (!guard.ok) return guard.response

  let source: Record<string, unknown>
  try {
    source = (await req.json()) as Record<string, unknown>
  } catch {
    return new Response('请求体不是 JSON', { status: 400 })
  }

  const voiceId = String(source['voiceId'] ?? '').trim()
  if (voiceId === '') return new Response('没有指定要删哪条音色', { status: 400 })

  const voice = voiceProviderOf(serverEnv())
  if (!voice) {
    return new Response('语音没配齐（要 TTS_API_KEY 与 TTS_MODEL），删不掉', { status: 400 })
  }

  try {
    const { released } = await voice.release(voiceId)
    return Response.json({ released })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = err instanceof EngineError ? err.code : 'unknown'
    return new Response(message.slice(0, MAX_ERROR_CHARS), {
      status: code === 'provider-not-configured' ? 400 : 502,
    })
  }
}
