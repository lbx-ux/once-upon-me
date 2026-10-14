/**
 * POST /api/settings/probe —— 设置抽屉里那个「试一试」
 *
 * ★ 它存在的理由只有一条：**"配好了没有"必须是真打一次请求得出的**，
 *   不是"字段非空"、不是"格式像 key"。工单 04 §二 的原话是"每组要有一条真实的自检"。
 *   而 `/v1/models` 那种清单当不了能力证明——本项目已经错过两次
 *   （聚合站的模型目录漏报了图像能力，见 app-restructure spec §1.2）。
 *
 * 三条约定：
 *
 * 1. **一次只探一个能力**。所以走 `textProviderOf` / `imageProviderOf` / `voiceProviderOf`
 *   这一组导出函数，而不是 `createProviders`（那个是全都要，少一项就抛错，
 *   等于逼用户把四组都填满才能验一组）。
 * 2. **视觉没有探测入口**——它要**两张图**才有意义，而"试一试"不该为了探测去画一张图。
 *   与其做一个假的，界面上就写"要验视觉比对，请出一张形象"（那条本来就会真跑一次比对）。
 * 3. **花钱的那一档要在请求之前说清**。图像一次是 ¥0.2（实测一口价，与尺寸无关），
 *   花的是用户自己的钱，所以路由这边照实际记账返回，界面那边在点之前就写明。
 *
 * ★ 密钥的处理：env 从请求体进来，本路由**不把它写进任何响应、任何日志**。
 *   返回前还过一道 `redact`（见那个函数）——不是怀疑 provider 会泄，是"不许依赖别人不泄"。
 */

import { NextResponse } from 'next/server'
import { asEngineError, EngineError } from '@/lib/engine/index.ts'
import {
  imageProviderOf,
  textProviderOf,
  voiceProviderOf,
  type Env,
} from '@/lib/engine/providers/registry.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Capability = 'text' | 'image' | 'speech'
const CAPABILITIES: readonly string[] = ['text', 'image', 'speech']

/**
 * 探测用的最小文本。★ 短到接近免费，但必须是一句**真话**——空串会被某些供应商挡。
 *
 * ★★ 而**文字这一组的探测必须按 JSON 问**，理由是实测出来的（2026-07-14 起这条平台的行为）：
 *   第一次写成"只回一个字：好"，聚合站回
 *   `400 LITELLM_ERROR · 'messages' must contain the word 'json' in some form,
 *   to use 'response_format' of type 'json_object'`
 *   ——因为生产配置（`textOptionsOf`）默认 `LLM_JSON_MODE=object`，
 *   而这个平台对该模式有个额外要求：messages 里得出现 json 字样。
 *   **这不是绕过去，是让探测更真**：引擎里每一次文字调用（故事表、三个校验）
 *   都是要 JSON 的，一次纯聊天式的探测反而测了一个生产里不存在的用法。
 */
const PING_SYSTEM = '你只回 JSON，不要解释。'
const PING_TEXT = '把 {"ok": true} 原样回给我。'

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, detail: '请求体不是 JSON' }, { status: 400 })
  }
  const source = (body ?? {}) as Record<string, unknown>
  const capability = String(source['capability'] ?? '')
  if (!CAPABILITIES.includes(capability)) {
    return NextResponse.json(
      { ok: false, detail: `不认识的探测项「${capability}」（可选：text / image / speech）` },
      { status: 400 },
    )
  }
  const rawEnv = source['env']
  if (!rawEnv || typeof rawEnv !== 'object' || Array.isArray(rawEnv)) {
    return NextResponse.json({ ok: false, detail: 'env 要是键值对' }, { status: 400 })
  }
  const env: Env = {}
  for (const [key, value] of Object.entries(rawEnv as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() !== '') env[key] = value
  }

  // ★ 先按**用户能懂的话**检查一遍这一组缺什么。
  //   适配器自己的报错是写给开发者的（"真实密钥只写 .env.local"——那是给跑脚本的人看的），
  //   而这里坐在屏幕前的是家长，他该看到的是"这一格还没填"，不是一句仓库约定。
  const lacking = missingFor(capability as Capability, env)
  if (lacking.length > 0) {
    return NextResponse.json({
      ok: false,
      ms: 0,
      detail: `这一组还差：${lacking.join('、')}——填在上面那几格里，然后重新点一次`,
    })
  }

  const startedAt = Date.now()
  try {
    const result = await probe(capability as Capability, env)
    return NextResponse.json({
      ok: true,
      ms: Date.now() - startedAt,
      ...result,
      detail: redact(env, result.detail),
    })
  } catch (err) {
    const failure = asEngineError(err)
    return NextResponse.json({
      ok: false,
      ms: Date.now() - startedAt,
      // ★ 只回消息，不回 detail/body：provider 的错误体形状不归我们管，
      //   而"响应里带回来的东西"是最容易 accidentally 把密钥带出去的一条路
      detail: redact(env, failure.message),
      code: failure.code,
    })
  }
}

/** 这一组要跑起来必须有哪几格。**面向用户的措辞**，不是环境变量的名字 */
function missingFor(capability: Capability, env: Env): string[] {
  const has = (key: string): boolean => Boolean(env[key]?.trim())
  if (capability === 'text') {
    const lacking: string[] = []
    if (!has('LLM_MODEL')) lacking.push('模型名')
    if (!has('LLM_API_KEY')) lacking.push('Key')
    return lacking
  }
  if (capability === 'image') {
    const lacking: string[] = []
    if (!has('IMAGE_MODEL')) lacking.push('模型名')
    if (!has('IMAGE_API_KEY')) lacking.push('Key')
    return lacking
  }
  const lacking: string[] = []
  if (!has('TTS_MODEL')) lacking.push('模型名')
  if (!has('TTS_API_KEY')) lacking.push('Key')
  if (!has('TTS_VOICE')) lacking.push('音色')
  return lacking
}

/** 各能力最便宜的一次真调用。返回一句给用户看的实话 */
async function probe(
  capability: Capability,
  env: Env,
): Promise<{ detail: string; costCny?: number }> {
  if (capability === 'text') {
    const text = textProviderOf(env)
    const response = await text.complete({
      system: PING_SYSTEM,
      user: PING_TEXT,
      maxTokens: 64,
    })
    const preview = response.text.trim().replace(/\s+/g, ' ').slice(0, 60)
    return { detail: `${text.modelId} 回了「${preview || '（空）'}」` }
  }

  if (capability === 'speech') {
    const voice = voiceProviderOf(env)
    if (!voice) {
      throw new EngineError('provider-not-configured', '语音没配齐（要 TTS_API_KEY 与 TTS_MODEL）')
    }
    const voiceId = (env['TTS_VOICE'] ?? '').trim()
    if (voiceId === '') {
      throw new EngineError(
        'provider-not-configured',
        '还没选音色——先选一个默认音色，或填一个克隆来的 voice id',
      )
    }
    const result = await voice.synthesize({ voiceId, text: PING_TEXT })
    return {
      detail: `${voice.modelId} · 音色 ${voiceId} · 回 ${result.bytes.byteLength} 字节（${result.mime}）`,
    }
  }

  // image：最小尺寸，一次一口价
  const image = imageProviderOf(env)
  const result = await image.generate({ prompt: '一只纸船', size: '768x768' })
  return {
    // ★ 上面那句初稿写的是"多少**字数**的图"——图按字节算，不数字数。
    //   这句话是要给家长看的，措辞错了会让人以为我们在数字
    detail: `${image.modelId} 画了一张图，回 ${result.bytes.byteLength} 字节`,
    costCny: result.costCny,
  }
}

/**
 * ★ 兜底：万一某条 provider 的错误消息里带了 key，**不能让它跟着响应出去**。
 *   我们不假设供应商的报错格式，所以这里不判断"该不该有"，直接把已知 key 的值替掉。
 */
function redact(env: Env, message: string): string {
  let out = message
  for (const [key, value] of Object.entries(env)) {
    if (!key.endsWith('_API_KEY') || !value || value.length < 6) continue
    out = out.split(value).join('「密钥已隐去」')
  }
  return out
}
