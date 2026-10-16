/**
 * http.test.ts —— 网络错误的**判据**：`TypeError: fetch failed` 底下到底是哪一件
 *
 * 这一组用例是 2026-10-15 那次实测的直接产物。跑一本 20 页的书时本机网络断了约 36 分钟，
 * 17 页在日志里只留下同一行字：`/images/generations 网络错误：TypeError: fetch failed`。
 *
 * ★ 为什么这行字不够用，值得单开一组测试：它底下至少是四件事，
 *   而"能不能重试"完全取决于**是哪一件**——
 *   `ENOTFOUND`（请求没到服务端）重试是安全的；`ECONNRESET`（可能已经处理过）不是，
 *   而"生成类请求超时不许重试"那条纪律防的正是后者。
 *   所以这不是"报错文案更友好"的问题，是**重试策略的判据**。
 *
 * 用假 error 喂进去测：真正要钉住的是"会不会往下走一层 `cause`"，
 * 那件事没法靠真发一次断网的请求来测（且不该在测试里依赖网络）。
 */

import { describe, expect, it } from 'vitest'

import {
  describeNetworkError,
  fetchBytes,
  isSafeToRetryNetwork,
  requestJson,
  type HttpDeps,
} from './http.ts'
import { EngineError } from '../errors.ts'

/** 造一个 undici 形状的 `fetch failed`：真因在 `cause` 里 */
function fetchFailed(cause: unknown): Error {
  return new TypeError('fetch failed', { cause })
}

function withCode(code: string, message = `connect ${code}`): Error {
  const err = new Error(message)
  ;(err as Error & { code?: string }).code = code
  return err
}

describe('describeNetworkError', () => {
  it('★ 单个 cause：把 code 带出来，并给一句能定处置的话', () => {
    const text = describeNetworkError(fetchFailed(withCode('ENOTFOUND')))
    expect(text).toContain('TypeError: fetch failed')
    expect(text).toContain('ENOTFOUND')
    expect(text).toContain('请求没到服务端')
  })

  it('★ AggregateError：多地址重试时真因在再下一层，也要刨出来', () => {
    const aggregate = new AggregateError([withCode('ENOTFOUND'), withCode('ENOTFOUND')])
    const text = describeNetworkError(fetchFailed(aggregate))
    // 去重：两个一样的 code 只出现一次
    expect(text.split('ENOTFOUND')).toHaveLength(2)
  })

  it('ECONNRESET 要给"重试不一定安全"，不能和 ENOTFOUND 说成一样', () => {
    const reset = describeNetworkError(fetchFailed(withCode('ECONNRESET')))
    expect(reset).toContain('ECONNRESET')
    expect(reset).toContain('重试不一定是安全的')
    // 这两句必须分开：把 reset 说成"请求没到服务端"就会诱导出重复扣费的重试
    expect(reset).not.toContain('请求没到服务端')
  })

  it('取不到 code 时照实说取不到，不编一个', () => {
    expect(describeNetworkError(fetchFailed(new Error('socket hang up')))).toBe(
      'TypeError: fetch failed',
    )
    expect(describeNetworkError('就是一段字符串')).toBe('就是一段字符串')
    expect(describeNetworkError(undefined)).toBe('undefined')
  })

  it('环状 cause 不会把栈跑爆（深度上限）', () => {
    const a = new Error('a') as Error & { cause?: unknown; code?: string }
    const b = new Error('b') as Error & { cause?: unknown; code?: string }
    a.code = 'ENOTFOUND'
    b.code = 'ECONNRESET'
    a.cause = b
    b.cause = a
    expect(describeNetworkError(a)).toContain('ENOTFOUND')
  })
})

describe('requestJson 把 code 写进消息里', () => {
  const deps = (fetchImpl: typeof fetch): HttpDeps => ({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'k',
    fetchImpl,
  })

  it('★ 这一条才是那次事故的验收：失败的页面上要能看出是哪一种网络错', async () => {
    const failing = (() =>
      Promise.reject(fetchFailed(withCode('ENOTFOUND')))) as unknown as typeof fetch
    const err = await requestJson(deps(failing), { method: 'POST', path: '/images/generations' })
      .then(() => null)
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(EngineError)
    expect((err as EngineError).message).toContain('/images/generations 网络错误')
    expect((err as EngineError).message).toContain('ENOTFOUND')
  })

  it('被 abort 的仍然是"超时不许重试"那一句，不混进网络错误', async () => {
    const aborted = (() => {
      const err = new Error('This operation was aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    }) as unknown as typeof fetch
    const err = await requestJson(deps(aborted), { method: 'POST', path: '/x' })
      .then(() => null)
      .catch((e: unknown) => e)
    expect((err as EngineError).code).toBe('aborted')
    expect((err as EngineError).message).toContain('不要重试')
  })
})

describe('isSafeToRetryNetwork —— 重试的判据是"请求到没到过服务端"', () => {
  it('DNS 解析不了 / 连接被拒 / 连接超时 → 没到过 → 放行', () => {
    for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT']) {
      expect(isSafeToRetryNetwork(fetchFailed(withCode(code)))).toBe(true)
    }
  })

  it('★ ECONNRESET 不放行：连上了才被掐断，服务端可能已经建单了', () => {
    expect(isSafeToRetryNetwork(fetchFailed(withCode('ECONNRESET')))).toBe(false)
    expect(isSafeToRetryNetwork(fetchFailed(withCode('UND_ERR_SOCKET')))).toBe(false)
  })

  it('★ 混着出现就不放行（AggregateError 里有一个不安全 → 整次都不重）', () => {
    const mixed = new AggregateError([
      withCode('ENOTFOUND'),
      withCode('ECONNRESET', 'read ECONNRESET'),
    ])
    expect(isSafeToRetryNetwork(fetchFailed(mixed))).toBe(false)
  })

  it('判不出 code 就不重试——拿不到判据时，"不重试"是唯一不花钱的那一边', () => {
    expect(isSafeToRetryNetwork(fetchFailed(new Error('socket hang up')))).toBe(false)
    expect(isSafeToRetryNetwork(new Error('随便什么'))).toBe(false)
    expect(isSafeToRetryNetwork(undefined)).toBe(false)
  })
})

describe('requestJson 的连接级重试', () => {
  const deps = (fetchImpl: typeof fetch): HttpDeps => ({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'k',
    fetchImpl,
  })

  it('★ 抖一下能自己缓过来：第一次 ENOTFOUND、第二次成功 → 结果照常拿到，且只多打一次', async () => {
    let calls = 0
    const impl = (() => {
      calls += 1
      if (calls === 1) return Promise.reject(fetchFailed(withCode('ENOTFOUND')))
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
    }) as unknown as typeof fetch

    await expect(
      requestJson(deps(impl), { method: 'POST', path: '/images/generations' }),
    ).resolves.toEqual({ ok: true })
    expect(calls).toBe(2)
  })

  it('★ ECONNRESET 一次都不重——这是"不重复扣费"那一侧的验收', async () => {
    let calls = 0
    const impl = (() => {
      calls += 1
      return Promise.reject(fetchFailed(withCode('ECONNRESET')))
    }) as unknown as typeof fetch

    await expect(
      requestJson(deps(impl), { method: 'POST', path: '/images/generations' }),
    ).rejects.toThrow(/ECONNRESET/)
    expect(calls).toBe(1)
  })

  it('★ 上限就是 1 次：一直 ENOTFOUND 也只打 2 次，然后把错抛出去', async () => {
    let calls = 0
    const impl = (() => {
      calls += 1
      return Promise.reject(fetchFailed(withCode('ENOTFOUND')))
    }) as unknown as typeof fetch

    await expect(requestJson(deps(impl), { method: 'POST', path: '/x' })).rejects.toThrow(
      /ENOTFOUND/,
    )
    expect(calls).toBe(2)
  })

  it('超时/中止**不重试**：网络抖动的放行不能顺手把"超时"也放进去', async () => {
    let calls = 0
    const impl = (() => {
      calls += 1
      const err = new Error('This operation was aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    }) as unknown as typeof fetch

    await expect(requestJson(deps(impl), { method: 'POST', path: '/x' })).rejects.toThrow(
      /不要重试/,
    )
    expect(calls).toBe(1)
  })

  it('4xx 是"对面说话了"，走原来的路：不重试（重试也还是 4xx）', async () => {
    let calls = 0
    const impl = (() => {
      calls += 1
      return Promise.resolve(new Response('{"error":{"message":"参数不对"}}', { status: 422 }))
    }) as unknown as typeof fetch

    await expect(requestJson(deps(impl), { method: 'POST', path: '/x' })).rejects.toThrow(/422/)
    expect(calls).toBe(1)
  })
})

describe('失败消息要能指着下一步走', () => {
  it('★ 402 余额不足：说清"重试与改参数都无用"，别让人当配置问题查', async () => {
    const impl = (() =>
      Promise.resolve(
        new Response('{"error":{"code":"INSUFFICIENT_BALANCE","message":"余额不足"}}', {
          status: 402,
        }),
      )) as unknown as typeof fetch
    const err = await requestJson(
      { baseUrl: 'https://example.invalid/v1', apiKey: 'k', fetchImpl: impl },
      { method: 'POST', path: '/images/generations' },
    )
      .then(() => null)
      .catch((e: unknown) => e)

    const message = (err as EngineError).message
    // 供应商原文照旧要留着（它才是唯一线索），补上的是"往哪走"
    expect(message).toContain('402')
    expect(message).toContain('INSUFFICIENT_BALANCE')
    expect(message).toContain('要去充值')
    // 结构化字段也要留住，界面文案分流靠它
    expect((err as EngineError).httpStatus).toBe(402)
  })
})

describe('fetchBytes：报"哪一跳坏了"，但不许把签名抄进消息', () => {
  /** 一条带临时凭据的签名 URL —— 与实测那次形状一致 */
  const signed =
    'https://bucket.oss-cn-beijing.aliyuncs.com/generated/x.png' +
    '?x-oss-credential=STS.NXjmRCK1PrSs8UsYoNiPtLYB8%2F20261015&x-oss-signature=deadbeef'

  it('★ 网络错要带 code 与主机名（这一段原来只有一个光秃秃的 fetch failed）', async () => {
    const impl = (() =>
      Promise.reject(fetchFailed(withCode('ECONNRESET')))) as unknown as typeof fetch
    const err = await fetchBytes(signed, { fetchImpl: impl })
      .then(() => null)
      .catch((e: unknown) => e)

    const message = (err as EngineError).message
    expect(message).toContain('下载媒体网络错误')
    expect(message).toContain('ECONNRESET')
    // ★ 关键是主机名——出图与下载是两个不同的主机，得能分清是哪一跳
    expect(message).toContain('bucket.oss-cn-beijing.aliyuncs.com')
  })

  it('★ 签名与凭据一个字符都不许进消息', async () => {
    const impl = (() =>
      Promise.reject(fetchFailed(withCode('ENOTFOUND')))) as unknown as typeof fetch
    const err = await fetchBytes(signed, { fetchImpl: impl })
      .then(() => null)
      .catch((e: unknown) => e)

    const message = (err as EngineError).message
    expect(message).not.toContain('x-oss-signature')
    expect(message).not.toContain('deadbeef')
    expect(message).not.toContain('x-oss-credential')
    expect(message).not.toContain('STS.')
  })

  it('HTTP 非 2xx 的那条 EngineError 不被二次包装（它本来就说得够清楚）', async () => {
    const impl = (() =>
      Promise.resolve(new Response('nope', { status: 403 }))) as unknown as typeof fetch
    const err = await fetchBytes(signed, { fetchImpl: impl })
      .then(() => null)
      .catch((e: unknown) => e)
    expect((err as EngineError).message).toContain('下载媒体失败 HTTP 403')
  })
})
