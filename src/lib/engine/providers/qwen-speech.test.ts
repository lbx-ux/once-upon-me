/**
 * qwen-speech.test.ts —— 语音适配器：**发请求之前**该拦下来的，与请求体长什么样
 *
 * 两组判据，都不花钱：
 *
 * 1. **没接的能力不许静默忽略**（文件头第 5 条）。`pronunciation`（读音纠正）与
 *    `mood`（情绪）现在都还没接，传进来必须**报错**。这两条最容易在将来被"顺手改成忽略"，
 *    而被忽略的症状要到"名字念错了""20 页一个调子"时才浮出来——那时已经付过钱了。
 * 2. **请求体的形状**。`sample_rate` 实测被忽略，所以它**不许**出现在 payload 里
 *    （发一个不生效的参数，等于告诉下一个人"语速是靠它调的"）。
 *    `clone` 的样本必须以 **data URL** 送出去——这是"样本从不落到任何地方"
 *    这条隐私承诺在代码里的唯一凭据。
 *
 * 这里 stub 掉 `globalThis.fetch` 并把每次调用抄下来，所以断言的是**真实请求体**，
 * 不是"我们以为发出去的东西"。
 */

import { afterEach, describe, expect, it } from 'vitest'

import { createQwenSpeech } from './qwen-speech.ts'
import { EngineError } from '../errors.ts'

const DEPS = { baseUrl: 'https://example.invalid/api/v1', apiKey: 'test-key-not-a-secret' }
const MODEL = 'qwen-audio-3.0-tts-flash'

const REAL_FETCH = globalThis.fetch
afterEach(() => {
  globalThis.fetch = REAL_FETCH
})

/** 任何一次真网络都不该发生时的替身：它响了就说明拦截失败了 */
function forbidNetwork(): void {
  globalThis.fetch = (async () => {
    throw new Error('不该发请求：这一条应该在发请求之前就被拦下')
  }) as unknown as typeof fetch
}

type Call = { url: string; body: unknown }

/** 记下每次调用并依次回响应的假 fetch */
function stubFetch(responses: unknown[], calls: Call[]): void {
  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    calls.push({
      url: String(url),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })
    const next = responses[calls.length - 1]
    if (next === undefined) throw new Error(`第 ${calls.length} 次调用没有预备响应`)
    return next
  }) as unknown as typeof fetch
}

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => new ArrayBuffer(0),
})

const audioResponse = (bytes: number[], mime = 'audio/mpeg') => ({
  ok: true,
  status: 200,
  headers: { get: (key: string) => (key.toLowerCase() === 'content-type' ? mime : null) },
  text: async () => '',
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
})

describe('qwen-speech · 发请求之前的拦截', () => {
  it('★ 带 pronunciation（读音纠正）→ 报错，不静默忽略', async () => {
    forbidNetwork()
    const speech = createQwenSpeech(DEPS, MODEL)
    await expect(() =>
      speech.synthesize({ voiceId: 'v', text: '小宇', pronunciation: { 乐: 'yuè' } }),
    ).rejects.toThrow(/读音纠正/)
    // 空的 pronunciation 不算"带"：它是可选字段，调用方不填时不该被卡住
    const calls: Call[] = []
    stubFetch(
      [
        jsonResponse({ output: { audio: { url: 'https://cdn.invalid/a.mp3' } } }),
        audioResponse([1]),
      ],
      calls,
    )
    await expect(
      speech.synthesize({ voiceId: 'v', text: '小宇', pronunciation: {} }),
    ).resolves.toBeTruthy()
  })

  it('★ 带 mood（情绪）→ 报错，理由写清"标签没实测过"', async () => {
    forbidNetwork()
    const speech = createQwenSpeech(DEPS, MODEL)
    await expect(() =>
      speech.synthesize({ voiceId: 'v', text: '天黑了', mood: 'calm' }),
    ).rejects.toThrow(/情绪标签/)
  })

  it('没 key → provider-not-configured，而不是发出一个 401', async () => {
    forbidNetwork()
    const speech = createQwenSpeech({ ...DEPS, apiKey: '' }, MODEL)
    await expect(() => speech.synthesize({ voiceId: 'v', text: '你好' })).rejects.toThrow(
      /TTS_API_KEY 未配置/,
    )
  })

  it('clone 的样本是空的 / 超 10MB / 格式不支持 → 各自报错', async () => {
    forbidNetwork()
    const speech = createQwenSpeech(DEPS, MODEL)
    await expect(() =>
      speech.clone({ sampleBytes: new Uint8Array(0), mime: 'audio/mpeg', consentRef: 'c1' }),
    ).rejects.toThrow(/样本是空的/)
    await expect(() =>
      speech.clone({
        sampleBytes: new Uint8Array(10 * 1024 * 1024 + 1),
        mime: 'audio/mpeg',
        consentRef: 'c1',
      }),
    ).rejects.toThrow(/超过 10MB/)
    await expect(() =>
      speech.clone({ sampleBytes: new Uint8Array([1, 2, 3]), mime: 'video/mp4', consentRef: 'c1' }),
    ).rejects.toThrow(/不在支持列表/)
  })
})

describe('qwen-speech · 请求体与下载', () => {
  it('synthesize：路径 / 请求体 / 并立刻下载回来的音频', async () => {
    const calls: Call[] = []
    stubFetch(
      [
        jsonResponse({
          output: { audio: { url: 'https://cdn.invalid/a.mp3', expires_at: 1_792_047_962 } },
        }),
        audioResponse([0x49, 0x44, 0x33]),
      ],
      calls,
    )
    const speech = createQwenSpeech(DEPS, MODEL)
    const result = await speech.synthesize({
      voiceId: 'longjielidou_v3.6',
      text: '哗啦啦，大雨落下来。',
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toBe(
      'https://example.invalid/api/v1/services/audio/tts/SpeechSynthesizer',
    )
    // ★ toEqual 是精确匹配：多一个 sample_rate 就会失败（文件头第 6 条）
    expect(calls[0]?.body).toEqual({
      model: MODEL,
      input: { text: '哗啦啦，大雨落下来。', voice: 'longjielidou_v3.6', format: 'mp3' },
    })
    // 拿到地址就立刻下载，URL 不往上传（types.ts 文件头第 2 条）
    expect(calls[1]?.url).toBe('https://cdn.invalid/a.mp3')
    expect(result.mime).toBe('audio/mpeg')
    expect([...result.bytes]).toEqual([0x49, 0x44, 0x33])
  })

  it('★ clone：样本以 data URL 送出去（隐私承诺在代码里的凭据）', async () => {
    const calls: Call[] = []
    stubFetch([jsonResponse({ output: { voice_id: `${MODEL}-xiaozhujue-abc123` } })], calls)
    const speech = createQwenSpeech(DEPS, MODEL)
    const { voiceId } = await speech.clone({
      sampleBytes: new Uint8Array([1, 2, 3]),
      mime: 'audio/mpeg',
      consentRef: 'consent-2026-10-14-01',
    })

    expect(voiceId).toBe(`${MODEL}-xiaozhujue-abc123`)
    expect(calls[0]?.url).toBe('https://example.invalid/api/v1/services/audio/tts/customization')
    const input = (calls[0]?.body as { input: Record<string, unknown> }).input
    expect(input['action']).toBe('create_voice')
    // 音色绑定模型（文件头第 4 条）：target_model 必须是本适配器的 modelId
    expect(input['target_model']).toBe(MODEL)
    expect(String(input['url'])).toMatch(/^data:audio\/mpeg;base64,/)
    // consentRef 有意不发送（这一家不要授权凭据），但它不该变成 payload 里的什么字段
    expect(JSON.stringify(calls[0]?.body)).not.toContain('consent-2026-10-14-01')
  })

  it('release：发 delete_voice，成功才回 released: true', async () => {
    const calls: Call[] = []
    stubFetch([jsonResponse({ output: {}, usage: { count: 1 } })], calls)
    const speech = createQwenSpeech(DEPS, MODEL)
    await expect(speech.release('v-1')).resolves.toEqual({ released: true })
    expect((calls[0]?.body as { input: Record<string, unknown> }).input).toEqual({
      action: 'delete_voice',
      voice_id: 'v-1',
    })
  })

  it('release 失败时抛错（不吞成 released:false —— 删除凭据要写得出"这一处没删掉"）', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 400,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ code: 'InvalidParameter', message: 'voice 不存在' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch
    const speech = createQwenSpeech(DEPS, MODEL)
    await expect(() => speech.release('v-1')).rejects.toThrowError(EngineError)
  })
})
