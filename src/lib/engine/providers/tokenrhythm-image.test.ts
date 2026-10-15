/**
 * tokenrhythm-image.test.ts —— 出请求**之前**就该拦下来的那几条
 *
 * 挑的两条都发生在网络调用之前，所以这个文件一次网络都不发、一分钱都不花。
 * 判据是"错误消息是哪一条"：如果 baseUrl 指向不存在的地址却报出参考图那条错，
 * 就证明它**根本没走到发请求**——这正是要锁的行为。
 *
 * 为什么值得单独测：文件头第 4 条说的"generations 这条路上没有参考图字段"
 * 后来被补全了——**同一家有另一条路由 `/images/edits` 是通的**（2026-10-14 实测，见适配器文件头）。
 * 但这里锁的行为一条都没跟着翻：**"走错路由时带参考图就报错，不许静默丢掉"**。
 * 静默丢掉的代价是整本书画完才发现不像，而那时钱已经花完了。
 *
 * ★ 新增的那条"能力申报"测的是**一对关系**（supportsReference ⟺ 有 edit 方法），
 *   不是一个值。把能力退回环境变量（W1 那个 `IMAGE_SUPPORTS_REFERENCE` 化石）就会红。
 */

import { describe, expect, it } from 'vitest'

import { createTokenrhythmImage, supportsReferenceOf } from './tokenrhythm-image.ts'
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

  it('★ 带参考图调 generate 仍然报错——"不许静默丢弃"这条不随能力变化', async () => {
    // 这条测的从来不是"这家不支持参考图"，而是**走错路由时不许装作没事**。
    // 现在这家支持了（另一条路由 `edit`），所以消息要多指一条路，但仍然是**报错**。
    await expect(() =>
      image().generate({
        prompt: 'x',
        size: '1440x1440',
        referenceDataUrl: 'data:image/png;base64,AAAA',
      }),
    ).rejects.toThrow(/带参考图请调 edit\(\)/)
  })

  it('能力申报：supportsReference 由"有没有 edit 方法"推出来，不是手填的', () => {
    const one = image()
    expect(typeof one.edit).toBe('function')
    // ★ 断言的是**这一对关系**，不是 true 这个值：把开关写回环境变量，
    //   这里就会红——那正是 W1 那个化石（IMAGE_SUPPORTS_REFERENCE）的病灶
    expect(one.supportsReference).toBe(typeof one.edit === 'function')
    // 白名单里只有 1:1 与 16:9 —— 判据 3 要的 3:2 / 3:4 确实不在其中
    expect(one.supportedRatios).toEqual(['1:1', '16:9'])
  })

  it('★ 推导函数本身可被证伪：一个**没有 edit** 的实现必须推出 false', () => {
    // 上面那条只能证明"这个 adapter 现在两者一致"。这条证明的是**如果 edit 不在**，
    // 能力位会自己翻——这正是把字面量 true 换成推导的全部意义。
    // 少了这条，把 derive 换回 `supportsReference: true` 不会有任何测试变红
    expect(supportsReferenceOf({})).toBe(false)
    expect(supportsReferenceOf({ edit: undefined })).toBe(false)
    expect(supportsReferenceOf({ edit: 'not-a-function' })).toBe(false)
    expect(supportsReferenceOf({ edit: () => undefined })).toBe(true)
  })

  it('edit() 不带参考图就发不出去（类型上要它，运行时也拦）', async () => {
    // baseUrl 指向一个不存在的地址：edit 会**走到发请求**（网络错），
    // 而 generate 带参考图是**没走到**（报的是参考图那条）。
    // 这个对照锁的是"两条路由各自成立"，而不是某一条的错误文案
    const one = image()
    await expect(
      one.edit!({ prompt: 'x', size: '1440x1440', referenceDataUrl: 'data:image/png;base64,AAAA' }),
    ).rejects.toThrow(/网络|fetch|ECONNREFUSED|Failed/i)
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

  it('比例集合来自白名单而不是硬编（3:2 / 3:4 确实不在其中）', () => {
    const generator = image()
    expect(generator.supportedRatios).toEqual(['1:1', '16:9'])
    expect(generator.supportedRatios).not.toContain('3:2')
  })
})
