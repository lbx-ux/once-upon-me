/**
 * auth/client.test.ts —— ★ 「接后端」那条缝**现在**的契约
 *
 * 这个文件值钱的地方只有两处，其余是普通的快乐路径：
 *
 * 1. **`setPassword` 不许被绕过**。它兑现"只有走过验证码的会话才能设密码"这条——
 *    没有它，任何一个人打开控制台就能给任意号码设密码。所以这里专门测三种绕过：
 *    从没验过、验的是另一个号、验完之后又验一次。
 * 2. **一个口令都不落盘**。表里那件事实是"这个号码在册"，不是一个凭据。
 *    测试直接**在存完之后的存储里找那串口令**——找不到才算过。
 *
 * ★ 每个 case 都 `vi.resetModules()` 再重新 import：`client.ts` 里那个
 *   `verifiedPhone` 是**模块级的会话状态**（它故意的，见那边的注释），
 *   不重置的话用例之间会互相串味，第二个用例就会在前一个的会话里通过。
 *
 * ★ 每个函数都会等 `MOCK_LATENCY_MS`（320ms）。这里**不去 mock 掉那个等待**：
 *   它正是"界面上那些 pending 态真的会出现"的证据，把它抹掉等于把这个文件
 *   变成另一个东西的测试。代价是这一个文件要跑几秒，可以接受。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthStorage } from './state.ts'

function fakeStorage(
  seed: Record<string, string> = {},
): AuthStorage & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  }
}

/** 每个用例都从一个**干净的模块**开始（见文件头最后一条） */
async function loadClient() {
  vi.resetModules()
  return await import('./client.ts')
}

const PHONE = '13900001111'
const OTHER_PHONE = '13700002222'
const CODE = '123456'
const PASSWORD = 'hunter2-hunter2'

let storage: ReturnType<typeof fakeStorage>

beforeEach(() => {
  storage = fakeStorage()
})

describe('sendCode', () => {
  it('11 位大陆号发得出去', async () => {
    const { sendCode } = await loadClient()
    expect(await sendCode(PHONE, storage)).toEqual({ ok: true })
  })

  it('不是 11 位大陆号就带一句能读的话回来', async () => {
    const { sendCode } = await loadClient()
    for (const bad of ['', '1390000111', '139000011112', 'abcdefghijk', '+8613900001111']) {
      const result = await sendCode(bad, storage)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toBe('请输入 11 位大陆手机号')
    }
  })
})

describe('verifyCode —— 通过之后才谈得上"新用户还是老用户"', () => {
  it('没设过密码的号码 → needs-password，并把号码带回去', async () => {
    const { verifyCode } = await loadClient()
    expect(await verifyCode(PHONE, CODE, storage)).toEqual({
      ok: true,
      kind: 'needs-password',
      phone: PHONE,
    })
  })

  it('设过密码的号码 → 直接登录', async () => {
    const { addRegistered } = await import('./state.ts')
    addRegistered(OTHER_PHONE, storage)
    const { verifyCode } = await loadClient()

    const verdict = await verifyCode(OTHER_PHONE, CODE, storage)
    expect(verdict.ok && verdict.kind).toBe('signed-in')
    if (verdict.ok && verdict.kind === 'signed-in') {
      expect(verdict.user.phone).toBe(OTHER_PHONE)
      expect(verdict.user.userId).toBe(`local-${OTHER_PHONE}`)
    }
  })

  it('★ 演示账号 `13800138000` 走验证码能直接进（参考稿那个已有账号）', async () => {
    const { DEMO_REGISTERED_PHONE } = await import('./state.ts')
    const { verifyCode } = await loadClient()
    const verdict = await verifyCode(DEMO_REGISTERED_PHONE, CODE, storage)
    expect(verdict.ok && verdict.kind).toBe('signed-in')
    // ★ 断言的是"**在册表**里没有它"，不是"存储是空的"：
    //   它登录时会留下一条底账（首次登录时间 + 昵称，见 state.ts 的 `AuthProfile`），
    //   那是这次登录真发生过的事；而"预置一个演示账号"**没有**发生，
    //   不该往用户的盘上留一条他没做过的记录——那才是这条断言要钉的
    const { loadRegistered } = await import('./state.ts')
    expect(loadRegistered(storage)).toEqual([])
  })

  it('号码或验证码不合形状时报错，不是静默通过', async () => {
    const { verifyCode } = await loadClient()
    const badPhone = await verifyCode('139', CODE, storage)
    expect(badPhone.ok).toBe(false)
    if (!badPhone.ok) expect(badPhone.message).toBe('请输入 11 位大陆手机号')

    const badCode = await verifyCode(PHONE, '12345', storage)
    expect(badCode.ok).toBe(false)
    if (!badCode.ok) expect(badCode.message).toBe('请输入 6 位验证码')
  })

  it('★ 验证码没过，会话就没被武装 —— 接着设密码必须被拒', async () => {
    const { verifyCode, setPassword } = await loadClient()
    const failed = await verifyCode(PHONE, 'abc', storage)
    expect(failed.ok).toBe(false)

    const result = await setPassword(PHONE, PASSWORD, storage)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('手机号还没验证过，请先用验证码登录')
    expect(Object.keys(storage.dump())).toEqual([])
  })
})

describe('setPassword —— ★ 只在已验证的会话里可调，而且只用一次', () => {
  it('★ 从没验过就直接调 = 被拒（控制台里那个人就是这么干的）', async () => {
    const { setPassword } = await loadClient()
    const result = await setPassword(PHONE, PASSWORD, storage)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('手机号还没验证过，请先用验证码登录')
    // 而且号码**没有**进册
    const { isRegistered } = await import('./state.ts')
    expect(isRegistered(PHONE, storage)).toBe(false)
  })

  it('★ 验的是 A 号、却给 B 号设密码 = 被拒', async () => {
    const { verifyCode, setPassword } = await loadClient()
    await verifyCode(PHONE, CODE, storage)

    const result = await setPassword(OTHER_PHONE, PASSWORD, storage)
    expect(result.ok).toBe(false)
    const { isRegistered } = await import('./state.ts')
    expect(isRegistered(OTHER_PHONE, storage)).toBe(false)
  })

  it('密码太短时被拒，而且号码不进册', async () => {
    const { verifyCode, setPassword, PASSWORD_MIN } = await loadClient()
    await verifyCode(PHONE, CODE, storage)

    const result = await setPassword(PHONE, 'a'.repeat(PASSWORD_MIN - 1), storage)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe(`密码至少 ${PASSWORD_MIN} 位`)

    const { isRegistered } = await import('./state.ts')
    expect(isRegistered(PHONE, storage)).toBe(false)
  })

  it('走完验证码之后设成功：拿到登录态，号码进册', async () => {
    const { verifyCode, setPassword } = await loadClient()
    const verdict = await verifyCode(PHONE, CODE, storage)
    expect(verdict.ok && verdict.kind).toBe('needs-password')

    const result = await setPassword(PHONE, PASSWORD, storage)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.user.phone).toBe(PHONE)

    const { isRegistered } = await import('./state.ts')
    expect(isRegistered(PHONE, storage)).toBe(true)
  })

  it('★ 一个已验证会话只够设一次密码（用完即焚）', async () => {
    const { verifyCode, setPassword } = await loadClient()
    await verifyCode(PHONE, CODE, storage)
    expect((await setPassword(PHONE, PASSWORD, storage)).ok).toBe(true)

    // 第二次：同一个号码、同样合法，也必须被拒
    const second = await setPassword(PHONE, 'another-password', storage)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.message).toBe('手机号还没验证过，请先用验证码登录')
  })
})

describe('loginWithPassword', () => {
  it('号码不在册 → 那句真话，而且**不是**在说密码长度', async () => {
    const { loginWithPassword } = await loadClient()
    // ★ 故意给一个短密码：结论必须是"还没设过密码"，
    //   否则就是在让人去改一个不存在的密码（client.ts 里那条次序）
    const result = await loginWithPassword(PHONE, 'x', storage)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('这个号码还没设过密码，先用验证码登录')
  })

  it('在册但密码太短 → 这一句才是「密码至少 8 位」', async () => {
    const { addRegistered } = await import('./state.ts')
    addRegistered(PHONE, storage)
    const { loginWithPassword, PASSWORD_MIN } = await loadClient()

    const result = await loginWithPassword(PHONE, 'x', storage)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe(`密码至少 ${PASSWORD_MIN} 位`)
  })

  it('在册且密码够长 → 登录', async () => {
    const { addRegistered } = await import('./state.ts')
    addRegistered(PHONE, storage)
    const { loginWithPassword } = await loadClient()

    const result = await loginWithPassword(PHONE, PASSWORD, storage)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.user.userId).toBe(`local-${PHONE}`)
  })

  it('号码不合形状时先报号码', async () => {
    const { loginWithPassword } = await loadClient()
    const result = await loginWithPassword('139', PASSWORD, storage)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('请输入 11 位大陆手机号')
  })
})

describe('★ 口令一个都不落盘', () => {
  it('设完密码之后，存储里找不到那串口令', async () => {
    const { verifyCode, setPassword } = await loadClient()
    await verifyCode(PHONE, CODE, storage)
    await setPassword(PHONE, PASSWORD, storage)

    // 在**整个存储**里找，而不是只找某一个键：换个键名藏起来同样要被抓到
    const raw = JSON.stringify(storage.dump())
    expect(raw).not.toContain(PASSWORD)
    expect(raw).not.toContain('hunter2')
    // 存进去的确实只是一件事实："这个号码在册"。
    // ★ `dump()` 的**值本身**是一段 JSON 字符串（那正是 localStorage 的形状），
    //   所以要逐键再 parse 一次，不然这条断言比的是"[\"139...\"]"这个字符串
    const entries: Record<string, unknown> = Object.fromEntries(
      Object.entries(storage.dump()).map(([key, value]) => [key, JSON.parse(value)]),
    )
    // 在册表里只有号码（不含演示账号，它是现算的）
    expect(entries['xiaozhujue.auth.registered']).toEqual([PHONE])
    // ★ 底账里也只有那三件能见人的东西，没有任何一段口令
    expect(entries['xiaozhujue.auth.profiles']).toEqual([
      { phone: PHONE, nickname: '', createdAt: expect.any(String) },
    ])
    expect(Object.keys(entries).sort()).toEqual([
      'xiaozhujue.auth.profiles',
      'xiaozhujue.auth.registered',
    ])
  })
})

describe('同一个号码重新登录：首次登录时间与昵称要留住', () => {
  it('★ `createdAt` 不会被刷成现在——写着"首次"的字段每次登录都变就是坏的', async () => {
    const { addRegistered, saveUser, loadUser } = await import('./state.ts')
    addRegistered(PHONE, storage)
    saveUser(
      {
        userId: `local-${PHONE}`,
        phone: PHONE,
        nickname: '小满',
        createdAt: '2020-01-02T03:04:05.000Z',
      },
      storage,
    )

    const { loginWithPassword } = await loadClient()
    const result = await loginWithPassword(PHONE, PASSWORD, storage)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user.createdAt).toBe('2020-01-02T03:04:05.000Z')
      expect(result.user.nickname).toBe('小满')
    }
    // 而且它**没有**顺手把存储改掉（落盘是 Provider 的事，不是 client 的）
    expect(loadUser(storage)?.createdAt).toBe('2020-01-02T03:04:05.000Z')
  })

  it('换一个号码进来，昵称不跟着串过去', async () => {
    const { saveUser } = await import('./state.ts')
    saveUser(
      {
        userId: `local-${PHONE}`,
        phone: PHONE,
        nickname: '小满',
        createdAt: '2020-01-02T03:04:05.000Z',
      },
      storage,
    )

    // ★ `verifyCode` 与 `setPassword` 必须来自**同一次 import**：
    //   `loadClient()` 每次都重置模块，而那个已验证会话就活在模块里
    const { verifyCode, setPassword } = await loadClient()
    const verdict = await verifyCode(OTHER_PHONE, CODE, storage)
    expect(verdict.ok && verdict.kind).toBe('needs-password')

    const result = await setPassword(OTHER_PHONE, PASSWORD, storage)
    expect(result.ok).toBe(true)
    // 上一个人叫小满，不等于这个人也叫小满——空串是"还没起过"
    if (result.ok) expect(result.user.nickname).toBe('')
  })
})

describe('updateNickname', () => {
  it('裁空白，空串是合法值（"还没起过"），所以不做非空校验', async () => {
    const { updateNickname } = await loadClient()
    const user = {
      userId: `local-${PHONE}`,
      phone: PHONE,
      nickname: '',
      createdAt: '2026-10-16T03:00:00.000Z',
    }

    const named = await updateNickname(user, '  小满  ', storage)
    expect(named.ok && named.user.nickname).toBe('小满')

    const cleared = await updateNickname(user, '   ', storage)
    expect(cleared.ok && cleared.user.nickname).toBe('')
  })
})

/**
 * ★ 这一组对应一个**在浏览器里量出来的**缺陷，不是推想的：
 *   设了昵称「小满」→ 退出登录 → 用密码登回来，名字没了，
 *   而且「首次登录」被刷成了刚才那一刻（一个写着"首次"的字段每次登录都变）。
 *
 *   根因：`createdAt`/`nickname` 当时只从**登录态**里读，而登出会清掉登录态。
 *   修法是给这两件东西单开一张**底账**（`AuthProfile`），登出不动它。
 */
describe('★ 登出再登入：底账要留住（浏览器里踩到过）', () => {
  it('登出（清登录态）之后重新登录，`createdAt` 与昵称都还在', async () => {
    const { addRegistered, clearUser, loadUser, loadProfile } = await import('./state.ts')

    // 第一次：验证码 → 设密码
    const { verifyCode, setPassword, updateNickname } = await loadClient()
    await verifyCode(PHONE, CODE, storage)
    const first = await setPassword(PHONE, PASSWORD, storage)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    await updateNickname(first.user, '小满', storage)
    const firstCreatedAt = first.user.createdAt
    addRegistered(PHONE, storage)

    // 登出：只清"此刻是谁"，底账不动
    clearUser(storage)
    expect(loadUser(storage)).toBeNull()
    expect(loadProfile(PHONE, storage)?.nickname).toBe('小满')

    // 用密码登回来
    const { loginWithPassword } = await loadClient()
    const back = await loginWithPassword(PHONE, PASSWORD, storage)
    expect(back.ok).toBe(true)
    if (back.ok) {
      expect(back.user.nickname).toBe('小满')
      // ★ 这一条是整组的重点：写着"首次"的字段不能因为重新登录就变
      expect(back.user.createdAt).toBe(firstCreatedAt)
    }
  })

  it('登出之后走验证码那条路回来，也一样留住', async () => {
    const { addRegistered, clearUser } = await import('./state.ts')

    const { verifyCode, setPassword, updateNickname } = await loadClient()
    await verifyCode(OTHER_PHONE, CODE, storage)
    const first = await setPassword(OTHER_PHONE, PASSWORD, storage)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    await updateNickname(first.user, '阿豆', storage)
    addRegistered(OTHER_PHONE, storage)
    const firstCreatedAt = first.user.createdAt

    clearUser(storage)

    const { verifyCode: verifyAgain } = await loadClient()
    const verdict = await verifyAgain(OTHER_PHONE, CODE, storage)
    expect(verdict.ok && verdict.kind).toBe('signed-in')
    if (verdict.ok && verdict.kind === 'signed-in') {
      expect(verdict.user.nickname).toBe('阿豆')
      expect(verdict.user.createdAt).toBe(firstCreatedAt)
    }
  })

  it('底账里认不出来的条目一律丢掉，不抛', async () => {
    const { loadProfiles } = await import('./state.ts')
    const dirty = fakeStorage({
      'xiaozhujue.auth.profiles': JSON.stringify([
        { phone: PHONE, nickname: '小满', createdAt: '2026-01-01T00:00:00.000Z' },
        { phone: 'abc', nickname: 'x', createdAt: 'y' },
        { phone: OTHER_PHONE },
        null,
        'bogus',
      ]),
    })
    const profiles = loadProfiles(dirty)
    expect(profiles).toEqual([
      { phone: PHONE, nickname: '小满', createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    // 空串昵称**是合法的**（"还没起过"），不能连这条一起丢掉
    const blank = fakeStorage({
      'xiaozhujue.auth.profiles': JSON.stringify([
        { phone: PHONE, nickname: '', createdAt: '2026-01-01T00:00:00.000Z' },
      ]),
    })
    expect(loadProfiles(blank)).toHaveLength(1)
  })
})
