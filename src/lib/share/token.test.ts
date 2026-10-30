/**
 * token.test.ts —— 分享票的签与验
 *
 * 只测纯函数这一层：签名、过期、篡改、密钥隔离。**不测**"这条票能读哪本书"——
 * 那是 `access.ts` 的前缀判据，由 `access.test.ts` 与 `scripts/chk-share-link.mjs`
 * 各管一半（前者量判据，后者量真路由）。
 *
 * ★ 改环境变量是这里唯一的脏动作。三条断言都依赖"换了一把钥匙会怎样"，
 *   而不换钥匙就测不到"分享票不认会话票那把钥匙"这条最重要的隔离。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hashShareToken, signShareToken, verifyShareToken } from './token.ts'

const ORIGINAL = {
  APP_JWT_SECRET: process.env.APP_JWT_SECRET,
  SHARE_SECRET: process.env.SHARE_SECRET,
}

function restore(): void {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const HOUR = 60 * 60 * 1000

beforeEach(() => {
  process.env.APP_JWT_SECRET = 'test-secret-not-a-real-one'
  delete process.env.SHARE_SECRET
})

afterEach(restore)

describe('signShareToken / verifyShareToken', () => {
  it('签出来的票能被自己验回来，四个字段一致', () => {
    const signed = signShareToken({
      userId: '7',
      bookId: 'kid-abc123-sheet-deadbeef',
      expiresAt: Date.now() + HOUR,
    })
    const claims = verifyShareToken(signed.token)
    expect(claims).not.toBeNull()
    expect(claims?.userId).toBe('7')
    expect(claims?.bookId).toBe('kid-abc123-sheet-deadbeef')
    expect(claims?.expiresAt).toBe(signed.expiresAt)
    expect(claims?.nonce).toBe(signed.nonce)
  })

  it('格式是 v1.<payload>.<sig>，哈希是 64 位十六进制', () => {
    const signed = signShareToken({
      userId: '1',
      bookId: 'kid-a-sheet-b',
      expiresAt: Date.now() + HOUR,
    })
    expect(signed.token.split('.')).toHaveLength(3)
    expect(signed.token.startsWith('v1.')).toBe(true)
    expect(signed.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashShareToken(signed.token)).toBe(signed.hash)
  })

  it('两次签同一本书得到两张不同的票（nonce 不同）', () => {
    const expiresAt = Date.now() + HOUR
    const one = signShareToken({ userId: '1', bookId: 'kid-a-sheet-b', expiresAt })
    const two = signShareToken({ userId: '1', bookId: 'kid-a-sheet-b', expiresAt })
    expect(one.token).not.toBe(two.token)
    expect(one.hash).not.toBe(two.hash)
  })

  it('★ 改一个字节就验不过：改 payload、改签名、改版本，三条路', () => {
    const signed = signShareToken({
      userId: '1',
      bookId: 'kid-a-sheet-b',
      expiresAt: Date.now() + HOUR,
    })
    const parts = signed.token.split('.')

    /**
     * ★ 改的是**第一格**，不是最后一格（2026-10-30 实测改的）。
     *
     * base64url 的最后一格只有高 4 位是真数据、低 2 位是填充：32 字节的签名
     * 编成 43 格，最后一格落在填充位上，`A`（000000）与 `B`（000001）解出来是
     * **同一串字节**。于是"翻最后一格"有约 6% 的时候根本没改到任何一位，
     * 验签照样通过，这条判据就假红一次。
     *   量法：签 2000 张、翻末字符再验，**147 张（7.3%）仍然验过**；同样的样本
     *   翻首字符，**0 张**。第一格 6 位全部有效，改它一定改变解码后的字节。
     * 这条不是"把测试改松"——判据还是"改一个字节就验不过"，只是改在一个
     * 真的落在数据位上的字节。
     */
    const flip = (text: string): string => (text.startsWith('A') ? 'B' : 'A') + text.slice(1)

    expect(verifyShareToken(`v1.${flip(parts[1] as string)}.${parts[2]}`)).toBeNull()
    expect(verifyShareToken(`${parts[0]}.${parts[1]}.${flip(parts[2] as string)}`)).toBeNull()
    expect(verifyShareToken(`v2.${parts[1]}.${parts[2]}`)).toBeNull()
    // 少一段、多一段、空串、超长——同一个出口
    expect(verifyShareToken('v1.abc')).toBeNull()
    expect(verifyShareToken('')).toBeNull()
    expect(verifyShareToken('x'.repeat(600))).toBeNull()
  })

  it('★ 换一把钥匙（换 APP_JWT_SECRET）就验不过——票与会话不是同一把锁', () => {
    const signed = signShareToken({
      userId: '1',
      bookId: 'kid-a-sheet-b',
      expiresAt: Date.now() + HOUR,
    })
    process.env.APP_JWT_SECRET = 'another-secret'
    expect(verifyShareToken(signed.token)).toBeNull()
  })

  it('SHARE_SECRET 独立设置时压过派生值', () => {
    process.env.SHARE_SECRET = 'own-share-secret'
    const signed = signShareToken({
      userId: '1',
      bookId: 'kid-a-sheet-b',
      expiresAt: Date.now() + HOUR,
    })
    expect(verifyShareToken(signed.token)).not.toBeNull()

    delete process.env.SHARE_SECRET
    expect(verifyShareToken(signed.token)).toBeNull()
  })

  it('过期的票验不过（看的是验的那一刻，不是签的那一刻）', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
      const signed = signShareToken({
        userId: '1',
        bookId: 'kid-a-sheet-b',
        expiresAt: Date.now() + HOUR,
      })
      expect(verifyShareToken(signed.token)).not.toBeNull()

      vi.setSystemTime(new Date('2030-01-01T02:00:00Z'))
      expect(verifyShareToken(signed.token)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('入参不合法当场抛：书号、用户 id、过期时间', () => {
    expect(() =>
      signShareToken({ userId: '1', bookId: '../etc/passwd', expiresAt: Date.now() + HOUR }),
    ).toThrow()
    expect(() =>
      signShareToken({ userId: 'abc', bookId: 'kid-a-sheet-b', expiresAt: Date.now() + HOUR }),
    ).toThrow()
    expect(() =>
      signShareToken({ userId: '1', bookId: 'kid-a-sheet-b', expiresAt: Date.now() - 1 }),
    ).toThrow()
  })

  it('两个密钥都没配时签不出来（不是签一张假的）', () => {
    delete process.env.APP_JWT_SECRET
    delete process.env.SHARE_SECRET
    expect(() =>
      signShareToken({ userId: '1', bookId: 'kid-a-sheet-b', expiresAt: Date.now() + HOUR }),
    ).toThrow(/APP_JWT_SECRET/)
    expect(verifyShareToken('v1.abc.def')).toBeNull()
  })
})
