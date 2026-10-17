import { EngineError } from '@/lib/engine/index.ts'
import type { NextRequest } from 'next/server'
import { voiceProviderOf } from '@/lib/engine/providers/registry.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'
import { parseCloneRequest } from '@/lib/voices/request.ts'

/**
 * POST /api/voice/clone —— 「用我自己的声音」
 *
 * 一次调用把一段录音变成一条音色（厂商侧 `voice-enrollment` 的 `create_voice`）。
 * 四件事按顺序说清楚，因为每一件都是别人踩过的：
 *
 * 1. **样本从不上传以外的任何地方**。它出现在请求体里（base64），在适配器里被编成
 *    `data:` URL 发出去，然后这个函数返回、字节被回收。**不落盘、不进日志、不进任何
 *    localStorage**。§8.3 要求"拿到 voice_id 后立即删样本"，我们这条是更强的版本：
 *    从来没有一份要删的副本。
 * 2. **返回的只有 voice_id**，没有别的东西。样本的字节、长度、内容都不出现在响应里。
 * 3. **音色绑模型**：适配器会把 `target_model` 写成本次请求里的 `TTS_MODEL`
 *    （实测跨模型 400），所以这一次用的模型名要跟 voice_id 一起回去——
 *    界面靠它判断"这条音色现在还能不能用"。
 * 4. **错误照原文回**（截断），不吞、不包装成成功。一个"看起来成了"的假成功，
 *    会让家长对着一个听不见的声音找半天。
 *
 * ★ 校验在 `lib/voices/request.ts` 里（含"没有授权凭据号就拒"那一条），
 *   这里只负责把它的话翻成状态码。
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 供应商的错误体可能有几 KB，回一段就够定位；长了反而把关键行挤掉 */
const MAX_ERROR_CHARS = 300

export async function POST(req: NextRequest): Promise<Response> {
  // ★ 闸门在最前：这三条都只花语音的钱，所以只要**语音**那一个能力
  //   （用户 2026-10-16 定的：权限只管"能不能用语音"，用哪个音色仍由用户选）
  const guard = await requireCapability(req, ['speech'])
  if (!guard.ok) return guard.response

  let source: Record<string, unknown>
  try {
    source = (await req.json()) as Record<string, unknown>
  } catch {
    return new Response('请求体不是 JSON', { status: 400 })
  }

  const parsed = parseCloneRequest(source)
  if (!parsed.ok) return new Response(parsed.message, { status: parsed.status })

  const modelId = (serverEnv()['TTS_MODEL'] ?? '').trim()
  const voice = voiceProviderOf(serverEnv())
  if (!voice) {
    return new Response('语音没配齐（要 TTS_API_KEY 与 TTS_MODEL）', { status: 400 })
  }

  try {
    const { voiceId } = await voice.clone(parsed.value.request)
    return Response.json({ voiceId, modelId, name: parsed.value.name })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = err instanceof EngineError ? err.code : 'unknown'
    const status = code === 'provider-not-configured' ? 400 : 502
    // ★ 不回任何供应商的原始错误体：里面可能有请求回显（我们发出去的样本就在里面）
    return new Response(message.slice(0, MAX_ERROR_CHARS), { status })
  }
}
