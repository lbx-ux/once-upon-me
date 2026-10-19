import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { backendFetch, clientIpFrom } from './backend.ts'

/**
 * `backend.ts` 的客户端 IP —— 这一层有两个必须钉住的东西，都不是风格问题：
 *
 * 1. **取值顺序**：`X-Real-IP` 优先，退而求其次取 `X-Forwarded-For` 的**最后一段**。
 *    ★ 不能取第一段：Nginx 那条 `$proxy_add_x_forwarded_for` 是**追加**，
 *    所以第一段是**客户端自己填的**，而 Java 读的正是第一段 —— 照抄它等于
 *    "谁都能换着 IP 绕过按 IP 的频控"（那是挡"一个人换 IP 刷短信"的唯一闸门）。
 * 2. **它真的被发出去了**：`clientIpFrom()` 算得再对，忘了接到请求头上就等于没有。
 *    所以这里打桩 `fetch`，直接看出站请求里有没有那个头。
 *
 * ★ 这两条都属于"只有真做才会不同"：把取值改回第一段、或者把
 * `headers['X-Forwarded-For']` 那一行删掉，用例会红；只改注释不会。
 */

/** 一个假的 fetch：只记下被调用成什么样 */
function stubFetch() {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
  return calls
}

function headersOf(call: { init: RequestInit }): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>
}

/** 造一个只带这几个头的请求 */
function requestWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/auth/send-code', { method: 'POST', headers })
}

const savedToken = process.env['INTERNAL_TOKEN']

beforeEach(() => {
  process.env['INTERNAL_TOKEN'] = 'test-token'
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (savedToken === undefined) delete process.env['INTERNAL_TOKEN']
  else process.env['INTERNAL_TOKEN'] = savedToken
})

describe('clientIpFrom —— 取值顺序', () => {
  it('认 X-Real-IP（Nginx 用 $remote_addr 覆盖写，客户端伪造不了）', () => {
    expect(clientIpFrom(requestWith({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('★ 只有 X-Forwarded-For 时取**最后一段**，不取第一段', () => {
    // 第一段 `1.2.3.4` 是客户端自己带的（Nginx 会把它留在最左边），
    // 最后一段才是 Nginx 追加的真实地址。
    expect(clientIpFrom(requestWith({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe(
      '203.0.113.9',
    )
    // 单值那一份（BFF 自己发出去的就是这个形状）
    expect(clientIpFrom(requestWith({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('X-Real-IP 是垃圾时不放弃，退回 X-Forwarded-For 的最后一段', () => {
    expect(
      clientIpFrom(
        requestWith({ 'x-real-ip': 'not-an-ip', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }),
      ),
    ).toBe('203.0.113.9')
  })

  it('认 IPv6 的形状', () => {
    expect(clientIpFrom(requestWith({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1')
  })

  it('不像 IP 的值一律回 null（宁可不带，也不让随手编的字符串变成频控的键）', () => {
    expect(clientIpFrom(requestWith({ 'x-real-ip': 'unknown' }))).toBeNull()
    expect(clientIpFrom(requestWith({ 'x-forwarded-for': '999.999.999.999' }))).toBeNull()
    expect(clientIpFrom(requestWith({ 'x-forwarded-for': '<script>' }))).toBeNull()
  })

  it('两个头都没有时回 null（本地直连 Next 就是这种）', () => {
    expect(clientIpFrom(requestWith({}))).toBeNull()
  })
})

describe('backendFetch —— 它真的把 IP 带过去了', () => {
  it('★ 给了 clientIp 就出现在出站请求头上', async () => {
    const calls = stubFetch()
    await backendFetch('/api/auth/sms/send', { method: 'POST', body: {}, clientIp: '203.0.113.9' })

    expect(calls).toHaveLength(1)
    expect(headersOf(calls[0]!)).toMatchObject({
      'X-Forwarded-For': '203.0.113.9',
      'X-Internal-Token': 'test-token',
    })
  })

  it('没给就不带这个头（Java 于是退回"回环地址"这个已知现状，而不是收到一个空值）', async () => {
    const calls = stubFetch()
    await backendFetch('/api/auth/me', { method: 'GET' })

    const headers = headersOf(calls[0]!)
    expect(headers).not.toHaveProperty('X-Forwarded-For')
    expect(headers['X-Internal-Token']).toBe('test-token')
  })

  it('clientIp 为 null 时也不带（routes 里传的就是 clientIpFrom 的结果）', async () => {
    const calls = stubFetch()
    await backendFetch('/api/auth/sms/send', { method: 'POST', body: {}, clientIp: null })
    expect(headersOf(calls[0]!)).not.toHaveProperty('X-Forwarded-For')
  })
})
