/**
 * qwen-image.test.ts —— 发请求之前该拦下来的、以及请求体到底长什么样
 *
 * 这一组取代了 `tokenrhythm-image.test.ts`（那家的适配器随换模型整体退场）。
 * 搬过来的行为一条都没放松，因为它们的理由与厂商无关：
 *
 * 1. **走错方法时带参考图就报错，不许静默丢掉**。丢掉的代价是整本书画完才发现不像，
 *    而那时钱已经花完了。
 * 2. **不在白名单里的尺寸不发请求**：一次 200 就是一张图的钱。
 * 3. **只重 429**：5xx 与超时都可能已经受理过，重试就是重复扣费。
 *
 * 这一家特有的四条（老那家没有的，所以是新判据）：
 *
 * 4. **两条路是同一条路**：`edit` 也打 DashScope 原生那条 `/services/aigc/multimodal-generation/
 *    generation`，差别只是 content 数组里多一段 `{image}`。★ 文档里的 OpenAI 兼容模式
 *    （`/compatible-mode/v1/images/generations`）在共享域名上是 404——实测过，别看着文档改回去。
 * 5. **尺寸写法是星号**：全仓库统一 `宽x高`，原生协议要 `宽*高`。转换只做一次（发请求那一层），
 *    混用的症状是 400 而错误文案里只有尺寸。
 * 6. **参考图那条路上 `size` 照发**（上一家那条路没有这个字段、产物尺寸由模型定）。
 *    这是 `referenceForPages` 敢开的前提，所以要有一条断言钉住它。
 * 7. **`referenceApplied` 是读数不是声明**：读 `usage.input_image_count`。
 *    T2I 回 0、I2I 回实际张数、缺 usage 一律 false。这一位决定调用方要不要当场失败，
 *    所以三种情形都要有反例。产物地址只在 `output` 子树里找（输入与输出同名，见那条测试）。
 *
 * 前两条发生在网络调用之前，所以那几条一次网络都不发、一分钱不花；后面的用替身 fetch。
 */

import { afterEach, describe, expect, it } from 'vitest'

import { createQwenImage, SIZES_BY_MODEL, supportsReferenceOf } from './qwen-image.ts'
import { EngineError } from '../errors.ts'

/** 故意用一个不存在的地址：真发出请求就会报网络错，而不是我们要断言的那条 */
const deps = { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test-key-not-a-secret' }

/**
 * 测试用的尺寸。
 *
 * ★ 它**必须**在实测白名单里，所以下面第一条断言就是"探针跑过了没有"。
 *   白名单还是空的时候这一组会红，而且红得直说该干什么——这是有意的：
 *   一个"没量过也能跑"的适配器，正是"拿正式跑测当探测"的第一步。
 */
const SIZE = '1536x1024'

/** 原生同步那条路。★ 不是 `/images/generations`（那个地址在共享域名上是 404，实测过） */
const MULTIMODAL_PATH = '/services/aigc/multimodal-generation/generation'

/** 原生响应：地址在 `output.choices[0].message.content[0].image`，**不在**顶层 `url` */
function withImage(url: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    output: {
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content: [{ image: url }] } },
      ],
    },
    request_id: 'req-1',
    ...extra,
  }
}

const DEFAULT_SUCCESS = withImage('https://cdn.invalid/a.png')

function image(opts = {}) {
  return createQwenImage(deps, 'qwen-image-3.0', opts)
}

describe('qwen-image · 白名单是量出来的，不是照文档抄的', () => {
  it('★ 产品要用的三个尺寸都得在表里（没跑探针就会红在这里）', () => {
    const allowed: readonly string[] = SIZES_BY_MODEL['qwen-image-3.0'] ?? []
    // 探针：node scripts/probe-qwen-image.mts —— 它读 PNG 的 IHDR 核宽高，
    //   与请求分毫不差才算过。文档给的合法范围不算数。
    expect(allowed).toContain('1536x1024')
    expect(allowed).toContain('1152x1536')
    expect(allowed).toContain('1440x1440')
  })

  it('比例集合来自白名单，不是硬编的', () => {
    expect(image().supportedRatios).toContain('3:2')
    expect(image().supportedRatios).toContain('3:4')
  })
})

describe('qwen-image · 发请求之前的拦截', () => {
  it('尺寸不在白名单 → 报错，并且**不发请求**', async () => {
    await expect(() => image().generate({ prompt: 'x', size: '512x512' })).rejects.toThrow(
      /不在 .* 的实测白名单里/,
    )
  })

  it('★ 模型名不在表里 → 报"不认识这个模型"，不是"这个尺寸没量过"', async () => {
    // 两条消息必须分得开：换模型的人该去改 IMAGE_MODEL，而改尺寸的人该去跑探针。
    // 合成一句的话，前者会去查尺寸表——那是一条死路
    await expect(() =>
      createQwenImage(deps, 'wan2.7-image').generate({ prompt: 'x', size: '1536x1024' }),
    ).rejects.toThrow(/只认 qwen-image-3\.0/)
  })

  it('带参考图调 generate → 报错，且指向 edit()（不是"这家不支持"）', async () => {
    await expect(() =>
      image().generate({
        prompt: '一个小女孩站在船上',
        size: SIZE,
        referenceDataUrl: 'data:image/png;base64,AAAA',
      }),
    ).rejects.toThrow(/要参考图请调 edit\(\)/)
  })

  it('★ 参考图不许静默丢弃——这条不随供应商变化', async () => {
    await expect(() =>
      image().generate({
        prompt: 'x',
        size: SIZE,
        referenceDataUrl: 'data:image/png;base64,AAAA',
      }),
    ).rejects.toThrow(/拒绝把参考图悄悄丢掉/)
  })

  it('能力申报：supportsReference 由"有没有 edit 方法"推出来，不是手填的', () => {
    const one = image()
    expect(typeof one.edit).toBe('function')
    expect(one.supportsReference).toBe(typeof one.edit === 'function')
  })

  it('★ 推导函数本身可被证伪：一个**没有 edit** 的实现必须推出 false', () => {
    expect(supportsReferenceOf({})).toBe(false)
    expect(supportsReferenceOf({ edit: undefined })).toBe(false)
    expect(supportsReferenceOf({ edit: 'not-a-function' })).toBe(false)
    expect(supportsReferenceOf({ edit: () => undefined })).toBe(true)
  })

  it('没有 Key → 报 provider-not-configured，不假装能出图', async () => {
    await expect(() =>
      createQwenImage({ ...deps, apiKey: '' }, 'qwen-image-3.0').generate({
        prompt: 'x',
        size: SIZE,
      }),
    ).rejects.toThrow(/IMAGE_API_KEY 未配置/)
  })
})

describe('qwen-image · 请求体与响应读数（替身 fetch）', () => {
  const REAL_FETCH = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = REAL_FETCH
  })

  type Call = { url: string; body: Record<string, unknown> }

  /** 按剧本回状态码的替身。第 n 次调用看 `script[n-1]`；剧本用完之后一律 200 成功 */
  function stub(
    script: number[] = [],
    success: Record<string, unknown> = DEFAULT_SUCCESS,
  ): { calls: Call[] } {
    const calls: Call[] = []
    globalThis.fetch = (async (url: string, init?: { body?: string }) => {
      const index = calls.length
      calls.push({
        url: String(url),
        body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      })
      const status = script[index] ?? 200
      if (status !== 200) {
        return new Response(JSON.stringify({ code: 'Throttling', message: '容量限流' }), {
          status,
          headers: { 'content-type': 'application/json' },
        })
      }
      // 出图那条路回一个签名地址；下载那条路（同一个替身）回字节
      if (String(url).includes(MULTIMODAL_PATH)) {
        return new Response(JSON.stringify(success), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }) as unknown as typeof fetch
    return { calls }
  }

  /** 只数**付费那一次**调用（下载那条路也走这个替身，别把它算进来） */
  const paid = (calls: Call[]): Call[] => calls.filter((call) => call.url.includes(MULTIMODAL_PATH))

  const one = (opts = {}) =>
    createQwenImage({ ...deps, fetchImpl: globalThis.fetch }, 'qwen-image-3.0', {
      backoffMs: 0,
      ...opts,
    })

  /** 原生响应：地址在 `output.choices[0].message.content[0].image`，不在顶层 `url` */

  it('文生图：content 数组里**只有 text**，size 换成星号写法，改写显式关掉', async () => {
    const { calls } = stub()
    await one().generate({ prompt: '一个小女孩站在船上', size: SIZE })
    expect(paid(calls)[0]?.body).toMatchObject({
      model: 'qwen-image-3.0',
      input: {
        messages: [{ role: 'user', content: [{ text: '一个小女孩站在船上' }] }],
      },
      parameters: {
        // ★ 星号：全仓库统一 `宽x高`，原生协议要 `宽*高`（混用的症状是 400，文案里只有尺寸）
        size: '1536*1024',
        n: 1,
        // ★ 显式关掉提示词改写（理由见适配器的 QwenImageOptions.promptExtend）
        prompt_extend: false,
      },
    })
    expect(paid(calls)[0]?.body).toMatchObject({
      input: { messages: [{ content: [{ text: '一个小女孩站在船上' }] }] },
    })
    // 纯文字那条路不许出现图像段（出现了就是"以为锁了脸其实没锁"那一类）
    const content = (
      paid(calls)[0]?.body as { input: { messages: { content: Record<string, unknown>[] }[] } }
    ).input.messages[0]?.content
    expect(content?.some((segment) => 'image' in segment)).toBe(false)
  })

  it('★ 图生图走**同一条路**：content 里多一段 {image}，size 照发', async () => {
    const { calls } = stub()
    const response = await one().edit!({
      prompt: 'x',
      size: SIZE,
      referenceDataUrl: 'data:image/png;base64,AAAA',
    })
    // 上一家那条路是另一个路由（/images/edits）且**没有 size 字段**；这一家两条路合一，
    //   尺寸与文字那条一样受管——这是 referenceForPages 敢开的前提
    expect(paid(calls)[0]?.url).toContain(MULTIMODAL_PATH)
    expect(paid(calls)[0]?.body).toMatchObject({
      input: {
        messages: [
          {
            role: 'user',
            content: [{ image: 'data:image/png;base64,AAAA' }, { text: 'x' }],
          },
        ],
      },
      parameters: { size: '1536*1024' },
    })
    // 这次替身没回 usage ⇒ 没法确认参考图进没进请求（"没法确认"不许写成"确认了"）
    expect(response.referenceApplied).toBe(false)
  })

  it('提示词改写：IMAGE_PROMPT_EXTEND=on 那一档能翻回来（对照用）', async () => {
    const { calls } = stub()
    await one({ promptExtend: true }).generate({ prompt: 'x', size: SIZE })
    expect(
      (paid(calls)[0]?.body as { parameters: Record<string, unknown> }).parameters['prompt_extend'],
    ).toBe(true)
  })

  /**
   * ★ 负向提示词走 `parameters.negative_prompt`（2026-10-21 晚）
   *
   * 起因：这家**真的把正文写进了画面**（每页左下角一小段汉字）。正向提示词里写
   * "别写字"对它不够——这一位才是它明说的开关。两条路（T2I / I2I）都要带。
   */
  it('★ 负向提示词进 `parameters.negative_prompt`，两条路都带', async () => {
    const { calls } = stub()
    await one().generate({ prompt: 'x', size: SIZE, negativePrompt: '文字，字幕' })
    await one().edit!({
      prompt: 'x',
      size: SIZE,
      referenceDataUrl: 'data:image/png;base64,AAAA',
      negativePrompt: '文字，字幕',
    })
    for (const call of paid(calls).slice(1)) {
      expect(
        (call.body as { parameters: Record<string, unknown> }).parameters['negative_prompt'],
      ).toBe('文字，字幕')
    }
  })

  it('不给负向提示词就不发这一位（不凭空补一个）', async () => {
    const { calls } = stub()
    await one().generate({ prompt: 'x', size: SIZE })
    expect(
      (paid(calls)[0]?.body as { parameters: Record<string, unknown> }).parameters,
    ).not.toHaveProperty('negative_prompt')
  })

  it('★ referenceApplied 是读数：input_image_count ≥ 1 才算参考图进了请求', async () => {
    const yes = stub(
      [],
      withImage('https://cdn.invalid/a.png', {
        usage: { input_image_count: 1, output_image_type: 'qima_output_1k' },
      }),
    )
    await expect(
      one().edit!({ prompt: 'x', size: SIZE, referenceDataUrl: 'data:image/png;base64,AAAA' }),
    ).resolves.toMatchObject({ referenceApplied: true })
    expect(paid(yes.calls)).toHaveLength(1)
  })

  it('★ 0 张也要报 false（"回了 200"不等于"参考图进去了"）', async () => {
    stub([], withImage('https://cdn.invalid/a.png', { usage: { input_image_count: 0 } }))
    await expect(
      one().edit!({ prompt: 'x', size: SIZE, referenceDataUrl: 'data:image/png;base64,AAAA' }),
    ).resolves.toMatchObject({ referenceApplied: false })
  })

  it('★ 地址只在 output 子树里找：请求回显的 data URL 不许被当成产物', async () => {
    // 原生协议里输入与输出用同一个键名（content[].image）。若哪天响应把请求回显一份，
    //   在整份 body 上递归找 image 会捞到我们自己那张 base64——症状是存下一堆看不懂的字节
    stub([], {
      input: { messages: [{ role: 'user', content: [{ image: 'data:image/png;base64,EVIL' }] }] },
      output: {
        choices: [{ message: { content: [{ image: 'https://cdn.invalid/real.png' }] } }],
      },
    })
    const response = await one().generate({ prompt: 'x', size: SIZE })
    expect(response.originUrl).toBe('https://cdn.invalid/real.png')
  })

  it('响应里没有费用字段 → 按 unitCostCny 兜底记账（这是兜底，不是实测）', async () => {
    stub()
    await expect(
      one({ unitCostCny: 0.11 }).generate({ prompt: 'x', size: SIZE }),
    ).resolves.toMatchObject({ costCny: 0.11, mime: 'image/png' })
  })

  it('★ 费用没报、env 也没给单价 → **不记账**（宁缺毋编）', async () => {
    stub()
    const response = await one().generate({ prompt: 'x', size: SIZE })
    // 上一家那 0.20 元是那家实测的一口价，搬过来就是编数：总成本会显示成一个假的精确值
    expect(response.costCny).toBeUndefined()
  })

  it('★ `request_id` 落在 traceId 上——这条路上报障报得出号', async () => {
    stub([], withImage('https://cdn.invalid/a.png', { request_id: '34293948-2c74-9e0a' }))
    const response = await one().generate({ prompt: 'x', size: SIZE })
    expect(response.traceId).toBe('34293948-2c74-9e0a')
  })

  it('地址里带 Expires（大写）也要读得到失效时刻——签名地址会过期', async () => {
    stub([], withImage('https://cdn.invalid/a.png?Expires=1788339600&OSSAccessKeyId=x'))
    const response = await one().generate({ prompt: 'x', size: SIZE })
    expect(response.originExpiresAt).toBe(1788339600000)
  })

  /**
   * 限流退避（2026-10-21，工单 D-03）。判据比 `qwen-speech` 那一组**更窄**：只重 429。
   * 退避给 0，所以这一组不真等 7 秒；退避的**存在与次序**由调用次数钉住。
   */
  it('★ 第一次 429、第二次成 → 拿到图，且重发的是逐字节同一个请求', async () => {
    const { calls } = stub([429])
    await expect(
      one().generate({ prompt: '一个小女孩站在船上', size: SIZE }),
    ).resolves.toMatchObject({ mime: 'image/png' })
    expect(paid(calls)).toHaveLength(2)
    // 同一个 prompt、同一个 size：429 挡回来的请求没有被受理，重发不会画出两张图
    expect(paid(calls)[1]?.body).toEqual(paid(calls)[0]?.body)
    // 而且下载只发生一次（重试的是"要图"，不是"再下一次"）
    expect(calls.filter((call) => call.url.includes('cdn.invalid'))).toHaveLength(1)
  })

  it('连着四次都 429 → 抛错带"试了 4 次"，状态码还在（界面要靠它分流）', async () => {
    const { calls } = stub([429, 429, 429, 429])
    const err: unknown = await one()
      .generate({ prompt: 'x', size: SIZE })
      .then(
        () => null,
        (e: unknown) => e,
      )
    expect(paid(calls)).toHaveLength(4)
    expect(err).toBeInstanceOf(EngineError)
    expect((err as EngineError).message).toContain('连着试了 4 次')
    expect((err as EngineError).httpStatus).toBe(429)
  })

  it('★ 5xx 一次都不重试——这是"不重复扣费"那一侧的验收', async () => {
    for (const status of [500, 502, 504]) {
      const { calls } = stub([status])
      await expect(one().generate({ prompt: 'x', size: SIZE }), String(status)).rejects.toThrow(
        String(status),
      )
      expect(paid(calls), String(status)).toHaveLength(1)
    }
  })

  it('402（余额不足）一次都不重试：它不是限流，是没钱了', async () => {
    const { calls } = stub([402])
    await expect(one().generate({ prompt: 'x', size: SIZE })).rejects.toThrow(/402/)
    expect(paid(calls)).toHaveLength(1)
  })

  it('★ 超时 / 被 abort 不重试（同步接口超时是"不知道有没有扣费"）', async () => {
    let count = 0
    globalThis.fetch = (async () => {
      count += 1
      const err = new Error('This operation was aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch
    await expect(one().generate({ prompt: 'x', size: SIZE })).rejects.toThrow(/超时或中止/)
    expect(count).toBe(1)
  })
})
