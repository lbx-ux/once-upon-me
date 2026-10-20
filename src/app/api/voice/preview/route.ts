import { EngineError } from '@/lib/engine/index.ts'
import type { NextRequest } from 'next/server'
import { voiceProviderOf } from '@/lib/engine/providers/registry.ts'
import { PREVIEW_LINE } from '@/lib/settings/preview-line.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'

/**
 * POST /api/voice/preview —— 「听一句真的」
 *
 * 为什么单独一条路由，而不是塞进 `/api/settings/probe`：
 *   探测回的是一句话结论（通了没通、多少字节），试听要回的是音频本身。
 *   两种响应形状挤在一个端点里，两边都会写得别扭。
 *
 * 为什么值得做：选音色这件事没法用文字判断。
 *   "天真男童音"这五个字不告诉你它念童书是什么调子——第一轮的两个音色就是听了三段真音频
 *   才定下的，2026-10-16 换的那两个是用户在厂商控制台里自己听过才挑的。
 *   所以选音色的那一屏不给试听，等于让人蒙。
 *
 * 三条约定：
 *   1. 文本限长（一次试听不该变成一整本书）；
 *   2. 音频不落盘——直接回字节。落盘就要管清理，而它是一次性的试听；
 *   3. ★ 密钥只从服务端环境来（ADR-0009）。这一条 2026-10-17 之前写的是
 *      "只从请求体的 env 来，服务端 `process.env` 不参与"——正好反过来。
 *
 * 缺省那句与音色卡上印的那句是同一个常量（`lib/settings/preview-line.ts`）：
 *   卡片会把它一起送来，缺省这条是兜底——两处各写一份的话，卡片上印的和实际念的
 *   迟早成了两句话，而这种错没人会去对。
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 试听最多这么长。超了就截，而不是报错——用户只是想听个调子 */
const MAX_PREVIEW_CHARS = 80

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
  if (voiceId === '') return new Response('没有指定音色', { status: 400 })

  // 调用方（音色卡）会把同一句话一起送来并印在卡片上；缺省这条是兜底，
  // 两边读的是同一个常量（`lib/settings/preview-line.ts`），所以不会各印各的
  const text = String(source['text'] ?? PREVIEW_LINE).slice(0, MAX_PREVIEW_CHARS)

  let bytes: Uint8Array
  let mime: string
  try {
    const voice = voiceProviderOf(serverEnv())
    if (!voice) {
      throw new EngineError('provider-not-configured', '语音没配齐（要 TTS_API_KEY 与 TTS_MODEL）')
    }
    // 试听用指定的那个音色，不是设置里存着的那个——正在挑的人要听的是候选
    const result = await voice.synthesize({ voiceId, text })
    bytes = result.bytes
    mime = result.mime
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 不回任何供应商的原始错误体：里面可能有请求回显
    return new Response(message, { status: 502 })
  }

  return new Response(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    {
      headers: {
        'Content-Type': mime,
        // 试听是一次性的：不缓存，也不进任何持久层
        'Cache-Control': 'no-store',
      },
    },
  )
}
