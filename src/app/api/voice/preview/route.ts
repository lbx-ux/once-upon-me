import { EngineError } from '@/lib/engine/index.ts'
import { voiceProviderOf, type Env } from '@/lib/engine/providers/registry.ts'

/**
 * POST /api/voice/preview —— 「听一句真的」
 *
 * ★ 为什么单独一条路由，而不是塞进 `/api/settings/probe`：
 *   探测回的是**一句话结论**（通了没通、多少字节），试听要回的是**音频本身**。
 *   两种响应形状挤在一个端点里，两边都会写得别扭。
 *
 * ★ 为什么值得做：选音色这件事**没法用文字判断**。
 *   "男童声（5 岁）"这五个字不告诉你它念童书是什么调子——
 *   本轮用户就是听了三段真音频才说"这几个声音可以的"。
 *   所以选音色的那一屏不给试听，等于让人蒙。
 *
 * 三条约定：
 *   1. 文本**限长**（一次试听不该变成一整本书）；
 *   2. 音频**不落盘**——直接回字节。落盘就要管清理，而它是一次性的试听；
 *   3. 密钥只从请求体的 env 来（ADR-0008），服务端 `process.env` 不参与。
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 试听最多这么长。超了就截，而不是报错——用户只是想听个调子 */
const MAX_PREVIEW_CHARS = 80

/** 默认那句。★ 用演示书第 1 页的真句子，不用"测试文本一二三"：
 *  念的是真语料，听出来的才是产品里的效果 */
const DEFAULT_TEXT = '哗啦啦，大雨落下来。'

export async function POST(req: Request): Promise<Response> {
  let source: Record<string, unknown>
  try {
    source = (await req.json()) as Record<string, unknown>
  } catch {
    return new Response('请求体不是 JSON', { status: 400 })
  }

  const rawEnv = source['env']
  if (!rawEnv || typeof rawEnv !== 'object' || Array.isArray(rawEnv)) {
    return new Response('env 要是键值对', { status: 400 })
  }
  const env: Env = {}
  for (const [key, value] of Object.entries(rawEnv as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() !== '') env[key] = value
  }

  const voiceId = String(source['voiceId'] ?? '').trim()
  if (voiceId === '') return new Response('没有指定音色', { status: 400 })

  const text = String(source['text'] ?? DEFAULT_TEXT).slice(0, MAX_PREVIEW_CHARS)

  let bytes: Uint8Array
  let mime: string
  try {
    const voice = voiceProviderOf(env)
    if (!voice) {
      throw new EngineError('provider-not-configured', '语音没配齐（要 TTS_API_KEY 与 TTS_MODEL）')
    }
    // 试听用**指定**的那个音色，不是设置里存着的那个——正在挑的人要听的是候选
    const result = await voice.synthesize({ voiceId, text })
    bytes = result.bytes
    mime = result.mime
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // ★ 不回任何供应商的原始错误体：里面可能有请求回显
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
