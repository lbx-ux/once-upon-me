/**
 * tokenrhythm-image.test.ts —— 出请求**之前**就该拦下来的那几条
 *
 * 挑的两条都发生在网络调用之前，所以这个文件一次网络都不发、一分钱都不花。
 * 判据是"错误消息是哪一条"：如果 baseUrl 指向不存在的地址却报出参考图那条错，
 * 就证明它**根本没走到发请求**——这正是要锁的行为。
 *
 * 为什么值得单独测：文件头第 4 条的实测结论是"这个接口没有参考图字段"。
 * 那条结论本身可能有一天被推翻（平台加字段、或换供应商），
 * 但**"带参考图就报错、不许静默丢掉"**这个行为不该跟着翻——
 * 静默丢掉的代价是整本书画完才发现不像，而那时钱已经花完了。
 */

import { describe, expect, it } from 'vitest'

import { createTokenrhythmImage } from './tokenrhythm-image.ts'
import { EngineError } from '../errors.ts'

/** 故意用一个不存在的地址：真发出请求就会报网络错，而不是我们要断言的那条 */
const deps = { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test-key-not-a-secret' }

function image(opts = {}) {
  return createTokenrhythmImage(deps, 'wan2.7-image', opts)
}

describe('tokenrhythm-image · 发请求之前的拦截', () => {
  it('带参考图 → 直接报错，消息说清"没有这个入口"与"不许静默降级"', async () => {
    await expect(() =>
      image().generate({
        prompt: '一个小女孩站在船上',
        size: '1440x1440',
        referenceDataUrl: 'data:image/png;base64,AAAA',
      }),
    ).rejects.toThrowError(EngineError)

    await expect(() =>
      image().generate({
        prompt: 'x',
        size: '1440x1440',
        referenceDataUrl: 'data:image/png;base64,AAAA',
      }),
    ).rejects.toThrow(/没有参考图字段/)
  })

  it('★ 开了 supportsReference 也一样报错——开关不是"允许丢弃"的许可证', async () => {
    // 这是关键的一条：以前 supportsReference=1 + 字段名没填对 = 悄悄不带参考图继续画。
    // 现在无论开关怎么设，带参考图就是错。
    await expect(() =>
      image({ supportsReference: true }).generate({
        prompt: 'x',
        size: '1440x1440',
        referenceDataUrl: 'data:image/png;base64,AAAA',
      }),
    ).rejects.toThrow(/拒绝降级/)
  })

  it('尺寸不在白名单 → 报错，并且**不发请求**（一次 200 就是一张图的钱）', async () => {
    await expect(() => image().generate({ prompt: 'x', size: '512x512' })).rejects.toThrow(
      /不在 .* 的实测白名单里/,
    )
  })

  it('没有 Key → 报 provider-not-configured，不假装能出图', async () => {
    await expect(() =>
      createTokenrhythmImage({ ...deps, apiKey: '' }, 'wan2.7-image').generate({
        prompt: 'x',
        size: '1440x1440',
      }),
    ).rejects.toThrow(/IMAGE_API_KEY 未配置/)
  })

  it('能力申报：supportsReference 恒为 false，比例来自白名单而不是硬编', () => {
    const generator = image()
    expect(generator.supportsReference).toBe(false)
    // 白名单里只有 1:1 与 16:9 —— 判据 3 要的 3:2 / 3:4 确实不在其中
    expect(generator.supportedRatios).toEqual(['1:1', '16:9'])
    expect(generator.supportedRatios).not.toContain('3:2')
  })
})
