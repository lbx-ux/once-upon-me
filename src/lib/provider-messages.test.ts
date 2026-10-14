/**
 * provider-messages.test.ts —— 文案分流靠 code + httpStatus，不靠 message
 *
 * 这份测试里**每一个 message 都是乱写的**（"供应商原文之类的随便一句话"）。
 * 这是刻意的：它在证明分流逻辑不读 message。哪天有人图省事改成
 * `message.includes('401')`，这些用例会全绿而线上文案会错——所以下面另有一条
 * 专门钉住"同一句话、不同状态码 → 不同文案"。
 */

import { describe, expect, it } from 'vitest'
import { EngineError } from './engine/index.ts'
import { isRetryable, userMessageFor } from './provider-messages.ts'

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
