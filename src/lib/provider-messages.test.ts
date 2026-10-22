/**
 * provider-messages.test.ts —— 文案分流靠 code + httpStatus，不靠 message
 *
 * 这份测试里每一个 message 都是乱写的（"供应商原文之类的随便一句话"）。
 * 这是刻意的：它在证明分流逻辑不读 message。哪天有人图省事改成
 * `message.includes('401')`，这些用例会全绿而线上文案会错——所以下面另有一条
 * 专门钉住"同一句话、不同状态码 → 不同文案"。
 */

import { describe, expect, it } from 'vitest'
import { EngineError } from './engine/index.ts'
import { isRetryable, userFailureOf, userMessageFor } from './provider-messages.ts'

const withStatus = (status: number, code = ''): EngineError =>
  new EngineError('provider-call-failed', '供应商原文之类的随便一句话', {
    httpStatus: status,
    providerCode: code,
  })

describe('userMessageFor 按状态码分流', () => {
  it('401 说 key 不对，并给出可照做的三步', () => {
    const text = userMessageFor(withStatus(401))
    expect(text).toContain('API key')
    expect(text).toContain('空格')
  })

  it('403 明说"改参数没用"（W1 实测：这是灰度权限）', () => {
    const text = userMessageFor(withStatus(403))
    expect(text).toContain('权限')
    expect(text).toContain('改参数没用')
  })

  it('401 与 403 不是同一句话（并成一句会让人反复改 key 而永远改不好）', () => {
    expect(userMessageFor(withStatus(401))).not.toBe(userMessageFor(withStatus(403)))
  })

  it('404 指向模型名，429 / 5xx 明说"不是你填错了"', () => {
    expect(userMessageFor(withStatus(404))).toContain('模型名')
    expect(userMessageFor(withStatus(429))).toContain('不是你填错了')
    expect(userMessageFor(withStatus(504))).toContain('key 没有问题')
  })

  it('同一句话、不同状态码 → 不同文案（分流不读 message）', () => {
    const a = userMessageFor(withStatus(401))
    const b = userMessageFor(withStatus(404))
    expect(a).not.toBe(b)
  })

  it('REASONING_REQUIRED 有专门一条（实测：glm-5.3-flash 不许关思考）', () => {
    const text = userMessageFor(withStatus(400, 'REASONING_REQUIRED'))
    expect(text).toContain('思考')
  })

  it('认不出来的状态码走兜底：**保留原文**，不说"未知错误"', () => {
    const text = userMessageFor(withStatus(418))
    expect(text).toContain('供应商原文之类的随便一句话')
  })
})

describe('userMessageFor 按引擎 code 分流', () => {
  it('缺配置的那条指向"回上一步填"', () => {
    const text = userMessageFor(
      new EngineError('provider-not-configured', 'LLM_API_KEY 未配置。真实密钥只写 .env.local'),
    )
    expect(text).toContain('上一步')
  })

  it('故事表过不了校验的那条明说"换模型时最常见"', () => {
    const text = userMessageFor(new EngineError('schema-validation-failed', '3 次都没过'))
    expect(text).toContain('换一个模型')
  })

  it('开发者原文照旧附在最后（换掉它我们就看不到供应商原话了）', () => {
    const text = userMessageFor(withStatus(401))
    expect(text).toContain('供我们排障的原文')
  })
})

describe('isRetryable', () => {
  it('配置错与凭据类错误重试一百次也一样', () => {
    expect(isRetryable(new EngineError('provider-not-configured', 'LLM_MODEL 未配置'))).toBe(false)
    expect(isRetryable(withStatus(401))).toBe(false)
    expect(isRetryable(withStatus(403))).toBe(false)
    expect(isRetryable(withStatus(404))).toBe(false)
  })

  it('限流、超时、平台故障是可重试的', () => {
    expect(isRetryable(withStatus(429))).toBe(true)
    expect(isRetryable(withStatus(504))).toBe(true)
    expect(isRetryable(new EngineError('provider-call-failed', '网络错误'))).toBe(true)
  })
})

/**
 * `userFailureOf` 是 Route Handler 唯一的出口（一次算清文案 + 可重试性 + 状态码），
 * 但在这之前一条测试都没有。工单 03 要改它的状态码分流，所以先把现状钉住。
 *
 * 这里最容易错的一处是"状态码按错在谁分"：那几个本地判出来的码
 *   （归一化、档案校验、查资产）身上没有 `httpStatus` 可读，一旦漏进兜底分支
 *   就会被回成 502 —— 一句"平台那边超时或不可用"盖在"回第 1 步补名字"上面。
 */
describe('userFailureOf · 状态码按"错在谁"分', () => {
  it('本地判出来的输入问题一律 400，不是 502（它们根本没发出请求）', () => {
    expect(userFailureOf(new EngineError('reference-invalid', '照片太小')).status).toBe(400)
    expect(userFailureOf(new EngineError('profile-invalid', '名字是空的')).status).toBe(400)
    expect(userFailureOf(new EngineError('card-invalid', '缺骨相')).status).toBe(400)
  })

  it('资产找不到是 404，与输入不合格分得开', () => {
    expect(userFailureOf(new EngineError('card-not-found', '第 3 版不在')).status).toBe(404)
  })

  it('供应商回来的状态码照旧按原样分：401/404 是 400，429/5xx 是 503', () => {
    expect(userFailureOf(withStatus(401)).status).toBe(400)
    expect(userFailureOf(withStatus(404)).status).toBe(400)
    expect(userFailureOf(withStatus(429)).status).toBe(503)
    expect(userFailureOf(withStatus(504)).status).toBe(503)
  })

  it('认不出来的走 502，且**保留供应商原文**', () => {
    const failure = userFailureOf(withStatus(418))
    expect(failure.status).toBe(502)
    expect(failure.message).toContain('供应商原文之类的随便一句话')
  })

  it('文案、可重试性、状态码三者同源（不各判各的）', () => {
    const failure = userFailureOf(new EngineError('profile-invalid', '名字是空的'))
    expect(failure.retryable).toBe(false)
    expect(failure.message).toContain('第 1 步')
    expect(failure.code).toBe('profile-invalid')
  })

  it('四个"输入问题"的码各给一句不同的话（合成一句家长不知道该动哪一格）', () => {
    const said = [
      userFailureOf(new EngineError('reference-invalid', 'x')).message,
      userFailureOf(new EngineError('profile-invalid', 'x')).message,
      userFailureOf(new EngineError('card-invalid', 'x')).message,
      userFailureOf(new EngineError('card-not-found', 'x')).message,
    ]
    expect(new Set(said).size).toBe(said.length)
  })

  it('★ asset-write-failed 一句话盖两件事：不能只说磁盘（2026-10-18 真撞到的一次）', () => {
    // `http.ts` 的 `fetchBytes` 把"把图下回来"那一步的失败也报成这个码，
    // 而原来那句话只说"磁盘满了或目录不可写"。本机代理掐断 OSS 的那次
    // （ECONNRESET），屏幕上于是让人去清一个空磁盘——**一句具体、可执行、
    // 且与故障无关的下一步，比没有这句话更坏**。
    const said = userFailureOf(
      new EngineError('asset-write-failed', '下载媒体网络错误：terminated · ECONNRESET'),
    ).message
    expect(said).toContain('下回来')
    expect(said).toContain('磁盘')
    // 那件真事必须还能被指出来（原文接在后面，分流逻辑不读它）
    expect(said).toContain('ECONNRESET')
  })
})

/**
 * ★ 500 那一档（2026-10-20 补）。
 *
 * 这一档原来是**空的**：`byStatus` 没有 500，`byCode('provider-call-failed')` 也没有，
 * 于是它落到兜底那句"原样保留供应商原文"——厂商那句黑话直接上了家长屏幕。
 * 触发它的那次实测：音色复刻连打 17 次只成功 2 次，失败一律
 * `HTTP 500 · InternalError · feat extract missing ph.bin`。
 *
 * 几条判据都对着"只有真改对才会不同"选：文案不再是原文（这是修的那个 bug）、
 * 该给的那串流水号真的出现了、而且它与 502/503/504 那句**不是同一句**
 * （那三句里有"换一个模型"，在音色这条路上是错的建议——音色绑模型）。
 */
describe('500：厂商内部报错（2026-10-20）', () => {
  const enrollment500 = (requestId: string) =>
    new EngineError(
      'provider-call-failed',
      '/services/audio/tts/customization 失败 HTTP 500 · InternalError · feat extract missing ph.bin' +
        '（这一条我们连着试了 4 次，每次都是这个结果）',
      { httpStatus: 500, providerCode: 'InternalError', traceId: requestId },
    )

  it('★ 不再把厂商黑话直接甩给家长，但原文与流水号都还在', () => {
    const said = userMessageFor(enrollment500('40dd863b-f7c4-9c26-9b69-488d60541514'))
    expect(said).toContain('再点一次')
    expect(said).toContain('不是你录的声音') // 这一句才是家长真正需要知道的
    expect(said).not.toBe(enrollment500('x').message) // 这一条就是修的那个 bug
    expect(said).toContain('ph.bin') // 原文照旧附上（我们自己排障要它）
    expect(said).toContain('厂商流水号 40dd863b-f7c4-9c26-9b69-488d60541514')
  })

  it('★ 整句话要装得下两处截断：路由 600、前端 600（装不下就等于没带流水号）', () => {
    // 这一条钉的不是文案好不好，是**流水号真的到得了屏幕上**：
    //   它在这句话的最末了，而这一句要穿过 `/api/voice/clone` 的 `.slice(0, 600)`
    //   与 `NewVoicePanel` 的 `.slice(0, 600)`（那两处 2026-10-20 从 300/200 抬上来的
    //   就是这个原因：300/200 恰好切在流水号中间）。这里拿真 500 那句原文算长度。
    const said = userMessageFor(enrollment500('40dd863b-f7c4-9c26-9b69-488d60541514'))
    expect(said.length).toBeLessThanOrEqual(600)
    expect(said.slice(0, 600)).toContain('40dd863b-f7c4-9c26-9b69-488d60541514')
  })

  it('★ 与 502/503/504 不是同一句：那三句的"换一个模型"在音色这条路上是错的建议', () => {
    const five = userMessageFor(enrollment500('r-1'))
    expect(five).not.toBe(userMessageFor(withStatus(503)))
    expect(five).not.toContain('换一个模型')
  })

  it('没有流水号时不硬凑一句；原文里已经有了就不重复', () => {
    const noId = userMessageFor(withStatus(500))
    expect(noId).toContain('再点一次')
    // 判据是"没有**附上**一个号"，不是"这句话里没有这五个字"——正文里本来就要提到它
    expect(noId).not.toContain('· 厂商流水号')
    const already = new EngineError(
      'provider-call-failed',
      '平台返回 request_id=abc123 之后就断了',
      {
        httpStatus: 500,
        traceId: 'abc123',
      },
    )
    expect(userMessageFor(already).match(/abc123/g)).toHaveLength(1)
  })
})

/**
 * ★ 两种"内容越线"不是同一件事（2026-10-22，用户在创作页踩到的那一次）。
 *
 *   `input-blocked`：拦的是**家长打的那句话**（主题 / 想让孩子得到的 / 改稿要求）。
 *     没有页码可言，出路只有"换个说法"。
 *   `review-blocked`：拦的是**模型写出来的那一页**，要说"哪一页"。
 *
 * 合成一个码时，界面只能说"上面那句写明了是哪一页"——而这一档根本没有页，
 * 家长会去故事里找一个还不存在的东西。
 */
describe('内容红线：家长那句话与模型写的页分开说', () => {
  const inputBlocked = (): EngineError =>
    new EngineError(
      'input-blocked',
      '你写的那句话里有不适合放进孩子的书里的内容：主题：暴力（R-02）——出现了「流血」。改一下再来',
    )
  const pageBlocked = (): EngineError =>
    new EngineError(
      'review-blocked',
      '这一版故事被内容审核拦下了：第 3 页：暴力（R-02）——出现了「血」',
    )

  it('★ 家长那句话只说一句（2026-10-22 用户拍板：不附原文、不列条款）', () => {
    const text = userMessageFor(inputBlocked())
    expect(text).toBe('你写的这句话里有不该给孩子看的内容，已经在编故事之前拦下了')
    // 同一件事不摆两遍：引擎原文与条款 id 在 `review` 事件与 `error.detail` 里，日志查得到
    expect(text).not.toContain('供我们排障的原文')
    expect(text).not.toContain('R-02')
    // "哪一页"属于模型写的那一档；这一档说它，家长会去找一个还不存在的页
    expect(text).not.toContain('哪一页')
  })

  it('模型写的页：仍旧说"哪一页"', () => {
    expect(userMessageFor(pageBlocked())).toContain('哪一页')
  })

  it('家长那句话不可重试（原样重发还是同一条红线），且按输入问题回 400', () => {
    expect(isRetryable(inputBlocked())).toBe(false)
    expect(userFailureOf(inputBlocked())).toMatchObject({ code: 'input-blocked', status: 400 })
  })
})
