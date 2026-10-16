import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  changePassword,
  fetchMe,
  loginWithPassword,
  logout,
  pickAvatar,
  sendCode,
  setPassword,
  updateNickname,
  verifyCode,
} from './client.ts'

/**
 * `client.ts` —— **它现在唯一的工作是"把话说对"**：请求打到哪个路径、
 * body 里有什么、失败怎么翻译。
 *
 * ★ 上一版这个文件里那些用例（"口令一个都不落盘""底账要留住""一个已验证会话
 * 只够设一次密码"）测的是**模拟**。那些性质一条都没丢，只是换了地方：
 * 它们现在由 Java 保证，且在 `server/src/test/java/.../AuthFlowIntegrationTest.java`
 * 里有对应的真实用例（设密码 → 登出 → 登回来昵称还在、票不能当会话用、等等）。
 * 在这里再测一遍等于测两份实现里的同一件事，而两份测试谁都不会因此更可信。
 *
 * ★ 留下的是**这一层独有的契约**：路径、字段、以及最要紧的一条——
 * `setPassword` 的 body 里**没有手机号**（号码只能从票里读）。那不是风格，
 * 那是"任何人都不能给别人的号码设密码"这条性质在**这一层**的样子。
 */

/** 一个假的 fetch：只记下被调用成什么样，回一个给定的响应 */
function stubFetch(reply: { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const status = reply.status ?? 200
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const BACKEND_USER = {
  userId: '7',
  account: '13800138000',
  phone: '13800138000',
  nickname: '小满妈妈',
  avatar: 'fox',
  role: 'USER',
  createdAt: '2026-10-16T22:11:02.645706+08:00',
  permissions: { text: true, image: true, vision: false, speech: false },
}

function bodyOf(call: { init: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendCode', () => {
  it('打到 BFF 的 /api/auth/send-code，body 里只有 account', async () => {
    const calls = stubFetch({ body: { ok: true, devMode: false, hint: null } })

    const result = await sendCode('13800138000')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/auth/send-code')
    expect(calls[0]?.init.method).toBe('POST')
    expect(bodyOf(calls[0]!)).toEqual({ account: '13800138000' })
    expect(result).toEqual({ ok: true, devMode: false, hint: null })
  })

  it('★ 开发模式那句 hint 要原样带回去（界面上要显示"没有真正发送"）', async () => {
    stubFetch({
      body: { ok: true, devMode: true, hint: '开发模式：没有真正发送短信，验证码固定 123456' },
    })

    const result = await sendCode('13800138000')

    expect(result).toEqual({
      ok: true,
      devMode: true,
      hint: '开发模式：没有真正发送短信，验证码固定 123456',
    })
  })

  it('后端说发得太频（429）时，把那句话原样给上层', async () => {
    stubFetch({
      status: 429,
      body: { code: 'sms-rate-limited', message: '刚发过一条，请等 60 秒再试' },
    })

    const result = await sendCode('13800138000')

    expect(result).toEqual({ ok: false, message: '刚发过一条，请等 60 秒再试' })
  })
})

describe('verifyCode', () => {
  it('老用户 → signed-in，带 user；★ 票不在响应里（它在 httpOnly cookie 里）', async () => {
    const calls = stubFetch({ body: { kind: 'signed-in', user: BACKEND_USER } })

    const result = await verifyCode('13800138000', '123456')

    expect(bodyOf(calls[0]!)).toEqual({ account: '13800138000', code: '123456' })
    expect(result.ok).toBe(true)
    expect(result.ok && result.kind === 'signed-in' ? result.user.userId : null).toBe('7')
  })

  it('新用户 → needs-password，而且**没有 user**', async () => {
    stubFetch({ body: { kind: 'needs-password' } })

    const result = await verifyCode('13800138000', '123456')

    expect(result).toEqual({ ok: true, kind: 'needs-password' })
  })

  it('验证码不对 → 把后端那句话带回来', async () => {
    stubFetch({ status: 400, body: { code: 'bad-code', message: '验证码不对，或者已经过期了' } })

    const result = await verifyCode('13800138000', '000000')

    expect(result).toEqual({ ok: false, message: '验证码不对，或者已经过期了' })
  })
})

describe('setPassword', () => {
  it('★ body 里**没有手机号**：号码只能从票里读', async () => {
    const calls = stubFetch({ body: { user: BACKEND_USER } })

    await setPassword('yigebenzi123')

    const body = bodyOf(calls[0]!)
    expect(body).toEqual({ password: 'yigebenzi123' })
    // 这一条是整份测试里最要紧的一行：多一个 account，那个洞就回来了
    expect(Object.keys(body)).not.toContain('account')
  })

  it('票过期（401）时把话带回来', async () => {
    stubFetch({
      status: 401,
      body: { code: 'no-ticket', message: '手机号还没验证过，请先用验证码登录' },
    })

    const result = await setPassword('yigebenzi123')

    expect(result).toEqual({ ok: false, message: '手机号还没验证过，请先用验证码登录' })
  })
})

describe('loginWithPassword', () => {
  it('打到 /api/auth/login-password，带上账号与口令', async () => {
    const calls = stubFetch({ body: { user: BACKEND_USER } })

    const result = await loginWithPassword('123456', '123456')

    expect(calls[0]?.url).toBe('/api/auth/login-password')
    expect(bodyOf(calls[0]!)).toEqual({ account: '123456', password: '123456' })
    expect(result.ok).toBe(true)
  })

  it('后端那句"这个号码还没设过密码，先用验证码登录"原样透传', async () => {
    stubFetch({
      status: 400,
      body: { code: 'no-password', message: '这个号码还没设过密码，先用验证码登录' },
    })

    const result = await loginWithPassword('13900139000', 'whatever1')

    expect(result).toEqual({ ok: false, message: '这个号码还没设过密码，先用验证码登录' })
  })
})

describe('fetchMe', () => {
  it('登录着：user + permissions + configured 三样都给上层', async () => {
    stubFetch({
      body: {
        user: BACKEND_USER,
        permissions: BACKEND_USER.permissions,
        configured: { text: true, image: true, vision: false, speech: true },
      },
    })

    const result = await fetchMe()

    expect(result.ok && !('signedOut' in result) && result.configured.speech).toBe(true)
  })

  it('★ 401 是"没登录"（正常结果），503 才是"账号服务连不上"（错误）', async () => {
    stubFetch({ status: 401, body: { code: 'not-signed-in', message: '请先登录' } })
    expect(await fetchMe()).toEqual({ ok: true, signedOut: true })

    vi.unstubAllGlobals()
    stubFetch({ status: 503, body: { code: 'backend-unreachable', message: '连不上账号服务' } })
    const failed = await fetchMe()
    expect(failed.ok).toBe(false)
    expect(failed.ok === false && 'message' in failed ? failed.message : '').toContain(
      '连不上账号服务',
    )
  })
})

describe('updateNickname / pickAvatar / logout', () => {
  it('改昵称：body 里只有昵称（人是谁由 cookie 说）', async () => {
    const calls = stubFetch({ body: { user: { ...BACKEND_USER, nickname: '小满' } } })

    await updateNickname('小满')

    expect(calls[0]?.url).toBe('/api/auth/me')
    expect(bodyOf(calls[0]!)).toEqual({ nickname: '小满' })
  })

  it('换头像：只递一个 id（这一轮不做上传）', async () => {
    const calls = stubFetch({ body: { user: { ...BACKEND_USER, avatar: 'bear' } } })

    await pickAvatar('bear')

    expect(calls[0]?.url).toBe('/api/auth/me/avatar')
    expect(bodyOf(calls[0]!)).toEqual({ avatar: 'bear' })
  })

  it('改密码：body 里是"现在的密码 + 新密码"，同样没有账号（人是谁由 cookie 说）', async () => {
    const calls = stubFetch({ body: { user: BACKEND_USER } })

    await changePassword('jiu-mima-123', 'xin-mima-456')

    expect(calls[0]?.url).toBe('/api/auth/change-password')
    expect(bodyOf(calls[0]!)).toEqual({
      currentPassword: 'jiu-mima-123',
      newPassword: 'xin-mima-456',
    })
  })

  it('改密码时"现在的密码不对"这句原样透传（不能吞成一句笼统的失败）', async () => {
    stubFetch({ status: 400, body: { code: 'bad-password', message: '现在的密码不对' } })

    const result = await changePassword('cuo-de', 'xin-mima-456')

    expect(result).toEqual({ ok: false, message: '现在的密码不对' })
  })

  it('登出：叫一次 BFF，后端不通也算登出成功（cookie 已经被删了）', async () => {
    stubFetch({ status: 503, body: { code: 'backend-unreachable', message: '连不上账号服务' } })

    await expect(logout()).resolves.toBeUndefined()
  })
})
