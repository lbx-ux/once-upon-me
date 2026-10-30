/**
 * instrumentation.test.ts —— 启动钩子的两道闸（2026-10-30）
 *
 * 这里测得到的只有两件：它在非 nodejs 档不做事、在非生产环境默认不对账。
 * ★ "Next 真的会调 `register()`"是框架事实，这里测不到——那一条靠验收时
 * 起一次真服务看日志，别拿这两条当它的证明。
 *
 * 第二条值得钉住的原因不是性能：本仓 `.env.local` 的 `BACKEND_URL` 指线上，
 * 一个 dev server 起来就去动线上账本，是那种"本地跑一下、账上少一本"的坑。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { register } from './instrumentation.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('register', () => {
  it('非 nodejs 档直接返回（edge 里没有 fs，也没有资产根）', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await register()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('本地 dev 默认不对账：一个 dev server 起来不该动线上账本', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('NODE_ENV', 'development')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await register()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
