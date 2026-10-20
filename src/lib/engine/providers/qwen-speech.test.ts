/**
 * qwen-speech.test.ts —— 语音适配器：发请求之前该拦下来的，与请求体长什么样
 *
 * 两组判据，都不花钱：
 *
 * 1. 没接的能力不许静默忽略（文件头第 5 条）。`pronunciation`（读音纠正）与
 *    `mood`（情绪）现在都还没接，传进来必须报错。这两条最容易在将来被"顺手改成忽略"，
 *    而被忽略的症状要到"名字念错了""20 页一个调子"时才浮出来——那时已经付过钱了。
 * 2. 请求体的形状。`sample_rate` 实测被忽略，所以它不许出现在 payload 里
 *    （发一个不生效的参数，等于告诉下一个人"语速是靠它调的"）。
 *    `clone` 的样本必须以 data URL 送出去——这是"样本从不落到任何地方"
 *    这条隐私承诺在代码里的唯一凭据。
 *
 * 这里 stub 掉 `globalThis.fetch` 并把每次调用抄下来，所以断言的是真实请求体，
 * 不是"我们以为发出去的东西"。
 */

import { afterEach, describe, expect, it } from 'vitest'

import { createQwenSpeech } from './qwen-speech.ts'
import { EngineError } from '../errors.ts'
import type { Mood } from '../domain.ts'

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

  it('★ 带 mood（情绪）= 标签贴在正文最前面，不是报错（2026-10-19 接上）', async () => {
    const calls: Call[] = []
    stubFetch(
      [
        jsonResponse({ output: { audio: { url: 'https://cdn.invalid/a.mp3' } } }),
        audioResponse([1]),
      ],
      calls,
    )
    const speech = createQwenSpeech(DEPS, MODEL)
    await speech.synthesize({ voiceId: 'v', text: '天黑了', mood: 'tender' })
    expect((calls[0]?.body as { input: { text: string } }).input.text).toBe('[empathetic]天黑了')
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
    // toEqual 是精确匹配：多一个 sample_rate 就会失败（文件头第 6 条）
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

/**
 * 情绪标签（2026-10-19 接上）。
 *
 * 这一组断言的是真实请求体里的 `input.text`，不是"我们以为贴上去的标签"——
 *   与上面那两组的理由一样：只有抄下来的 payload 才算证据。
 * ★ `calm` 那一档是判据不是省略：它必须逐字节等于原文。
 *   "平稳叙述就是这个音色的默认状态"这件事在代码里只有这一个凭据。
 */
describe('qwen-speech · 情绪标签', () => {
  const textOf = (body: unknown) => (body as { input: { text: string } }).input.text

  /** 合一次，把真实请求体里的 text 拿回来 */
  async function spokenWith(mood: Mood | undefined, model = MODEL) {
    const calls: Call[] = []
    stubFetch(
      [
        jsonResponse({ output: { audio: { url: 'https://cdn.invalid/a.mp3' } } }),
        audioResponse([1]),
      ],
      calls,
    )
    const speech = createQwenSpeech(DEPS, model)
    await speech.synthesize({ voiceId: 'v', text: '天黑了', ...(mood ? { mood } : {}) })
    return { text: textOf(calls[0]?.body), supportsMood: speech.supportsMood }
  }

  it('六个 mood 各贴各的标签；calm 逐字节就是原文', async () => {
    expect((await spokenWith('wonder')).text).toBe('[amazed]天黑了')
    expect((await spokenWith('joy')).text).toBe('[excited]天黑了')
    expect((await spokenWith('tense')).text).toBe('[trembling]天黑了')
    expect((await spokenWith('tender')).text).toBe('[empathetic]天黑了')
    // proud 与 joy 同档：词表里没有更贴"自豪"的（见 MOOD_TAGS 注释），这是认下来的重合
    expect((await spokenWith('proud')).text).toBe('[excited]天黑了')
    // ★ calm 不发标签。它必须一个字都不多，否则"默认音色"这句话就没有凭据了
    expect((await spokenWith('calm')).text).toBe('天黑了')
  })

  it('不传 mood → 原文照送（老调用方逐字节不受影响）', async () => {
    expect((await spokenWith(undefined)).text).toBe('天黑了')
  })

  it('★ 词表之外的 mood 一律**不发标签**（发了就是让厂商乱来）', async () => {
    // 模型写的 JSON 可以带任何字符串；tree.ts 会兜底成 calm，但这一层不该依赖那一层
    const calls: Call[] = []
    stubFetch(
      [
        jsonResponse({ output: { audio: { url: 'https://cdn.invalid/a.mp3' } } }),
        audioResponse([1]),
      ],
      calls,
    )
    const speech = createQwenSpeech(DEPS, MODEL)
    await speech.synthesize({
      voiceId: 'v',
      text: '天黑了',
      mood: 'ecstatic' as unknown as Mood,
    })
    expect(textOf(calls[0]?.body)).toBe('天黑了')
  })

  it('★ 不在名单上的模型：一个方括号都不发，且 supportsMood 为 false', async () => {
    const { text, supportsMood } = await spokenWith('joy', 'cosyvoice-v2-other')
    expect(text).toBe('天黑了')
    expect(text).not.toContain('[')
    expect(supportsMood).toBe(false)
  })

  it('名单上的三个模型都认；大小写/前后缀不同的名字不认（精确匹配）', async () => {
    for (const model of [
      'qwen-audio-3.1-tts-flash',
      'qwen-audio-3.0-tts-plus',
      'qwen-audio-3.0-tts-flash',
    ]) {
      const { supportsMood, text } = await spokenWith('joy', model)
      expect(supportsMood, model).toBe(true)
      expect(text, model).toBe('[excited]天黑了')
    }
    // 前缀匹配是故意不做的：认错了厂商不是忽略标签，而是把它当控制符乱来
    for (const model of ['QWEN-AUDIO-3.0-TTS-FLASH', 'qwen-audio-3.0-tts-flash-preview']) {
      expect((await spokenWith('joy', model)).supportsMood, model).toBe(false)
    }
  })
})

/**
 * ★ 复刻失败时的重试（2026-10-20 加）。
 *
 * 这一组量的是"发了几次请求、发的是什么、抛出来那句还剩哪些字段"——
 * 都是只有真做才会不同的量。背景是当天实测厂商那条 `create_voice` 连打 17 次
 *   只成功 2 次（同一份合规样本，失败一律 `HTTP 500 InternalError`），
 *   台账在 `docs/known-tradeoffs.md`。
 *
 * 退避给 0（`opts.enrollBackoffMs`），所以这一组不真等 7 秒；
 *   退避的**存在与次序**由第 2 条那 4 次调用钉住，退避的**数**不值一条测试。
 */
describe('qwen-speech · 复刻重试（只重 5xx/429）', () => {
  const SAMPLE = { sampleBytes: new Uint8Array([1, 2, 3]), mime: 'audio/wav', consentRef: 'c1' }

  /** 厂商那句真 500 的形状（2026-10-20 实测到的原文，含他们的 request_id） */
  const vendor500 = (requestId: string) => ({
    ok: false,
    status: 500,
    headers: { get: () => 'application/json' },
    text: async () =>
      JSON.stringify({
        request_id: requestId,
        code: 'InternalError',
        message: 'feat extract missing ph.bin',
      }),
    arrayBuffer: async () => new ArrayBuffer(0),
  })

  const statusResponse = (status: number, code: string) => ({
    ok: false,
    status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ code, message: 'no' }),
    arrayBuffer: async () => new ArrayBuffer(0),
  })

  it('★ 第一次 500、第二次成 → 拿到 voice_id，只发了两次，且两次的样本逐字节一样', async () => {
    const calls: Call[] = []
    stubFetch([vendor500('req-1'), jsonResponse({ output: { voice_id: 'v-ok' } })], calls)
    const speech = createQwenSpeech(DEPS, MODEL, { enrollBackoffMs: 0 })
    await expect(speech.clone(SAMPLE)).resolves.toEqual({ voiceId: 'v-ok' })
    expect(calls).toHaveLength(2)
    // 重试发的是同一次录入，不是"让家长再录一遍"——请求体一模一样
    expect(calls[1]?.body).toEqual(calls[0]?.body)
  })

  it('★ 连着四次都 500 → 抛错带"试了 4 次"，而状态码与流水号**还在**（界面分流与报障都要它们）', async () => {
    const calls: Call[] = []
    stubFetch([vendor500('r1'), vendor500('r2'), vendor500('r3'), vendor500('r4')], calls)
    const speech = createQwenSpeech(DEPS, MODEL, { enrollBackoffMs: 0 })
    const err: unknown = await speech.clone(SAMPLE).then(
      () => null,
      (e: unknown) => e,
    )
    expect(calls).toHaveLength(4)
    expect(err).toBeInstanceOf(EngineError)
    const failure = err as EngineError
    expect(failure.message).toContain('连着试了 4 次')
    // 这两条是"包装不能把结构化字段弄丢"的判据：丢了界面就分流不了，报障也没号可报
    expect(failure.httpStatus).toBe(500)
    expect(failure.traceId).toBe('r4')
  })

  it('★ 401 / 403 一次都不重试：key 与权限试一百次也一样', async () => {
    for (const status of [401, 403]) {
      const calls: Call[] = []
      stubFetch([statusResponse(status, status === 401 ? 'InvalidApiKey' : 'AccessDenied')], calls)
      const speech = createQwenSpeech(DEPS, MODEL, { enrollBackoffMs: 0 })
      await expect(speech.clone(SAMPLE)).rejects.toThrow(/401|403/)
      expect(calls, String(status)).toHaveLength(1)
    }
  })

  it('★ 200 却没有 voice_id → 不重试（分不清他们建没建，重试就可能多出一条孤儿音色）', async () => {
    const calls: Call[] = []
    stubFetch([jsonResponse({ output: {} })], calls)
    const speech = createQwenSpeech(DEPS, MODEL, { enrollBackoffMs: 0 })
    await expect(speech.clone(SAMPLE)).rejects.toThrow(/没有返回 voice_id/)
    expect(calls).toHaveLength(1)
  })

  it('★ 连接中途被掐（ECONNRESET）不重试：那一种"不知道到没到"', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    }) as unknown as typeof fetch
    const speech = createQwenSpeech(DEPS, MODEL, { enrollBackoffMs: 0 })
    await expect(speech.clone(SAMPLE)).rejects.toThrow(/ECONNRESET/)
    expect(calls).toBe(1)
  })

  it('429 也重试（容量限流与录音无关，换个时刻再发一次）', async () => {
    const calls: Call[] = []
    stubFetch(
      [statusResponse(429, 'Throttling'), jsonResponse({ output: { voice_id: 'v-2' } })],
      calls,
    )
    const speech = createQwenSpeech(DEPS, MODEL, { enrollBackoffMs: 0 })
    await expect(speech.clone(SAMPLE)).resolves.toEqual({ voiceId: 'v-2' })
    expect(calls).toHaveLength(2)
  })
})
