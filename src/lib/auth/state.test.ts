/**
 * auth/state.test.ts —— 「谁在用」这一层里那些**不会随后端改变**的性质
 *
 * 值钱的都在两边：**坏数据不许炸**（localStorage 是用户能手改的地方）与
 * **`?next=` 不许把人送到站外**（登录页最经典的那个洞）。
 * 中间那几组是普通的 round-trip。
 *
 * ★ 存储是**传进去的**，不是全局的——`vitest.config.mts` 跑 `environment: 'node'`，
 *   那里没有 localStorage。下面这个 `fakeStorage()` 就是那一层的全部依赖。
 */

import { describe, expect, it } from 'vitest'

import {
  addRegistered,
  clearUser,
  DEMO_REGISTERED_PHONE,
  isRegistered,
  loadRegistered,
  loadUser,
  maskPhone,
  parseUser,
  safeNext,
  saveUser,
  type AuthStorage,
} from './state.ts'

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

const USER = {
  userId: 'local-13800138000',
  phone: '13800138000',
  nickname: '',
  createdAt: '2026-10-16T03:00:00.000Z',
}

describe('maskPhone', () => {
  it('11 位大陆号码盖中间四位', () => {
    expect(maskPhone('13800138000')).toBe('138****8000')
    expect(maskPhone('19912345678')).toBe('199****5678')
  })

  it('认不出来的一律原样返回，不套假的星号形状', () => {
    // ★ 往一个坏字符串上盖 `*` 会让它看起来"打码过了"，而它只是坏数据
    expect(maskPhone('')).toBe('')
    expect(maskPhone('1380013800')).toBe('1380013800') // 10 位
    expect(maskPhone('138001380000')).toBe('138001380000') // 12 位
    expect(maskPhone('1380013800a')).toBe('1380013800a')
    expect(maskPhone('+8613800138000')).toBe('+8613800138000')
  })
})

describe('safeNext', () => {
  it('收站内路径', () => {
    expect(safeNext('/home')).toBe('/home')
    expect(safeNext('/reader/abc?page=2')).toBe('/reader/abc?page=2')
    expect(safeNext('/')).toBe('/')
  })

  it('★ 协议相对的写法一个都不放过', () => {
    // 这三条就是那个洞本身：浏览器把它们当**站外**
    expect(safeNext('//evil.com')).toBeNull()
    expect(safeNext('//evil.com/home')).toBeNull()
    expect(safeNext('/\\evil.com')).toBeNull()
    expect(safeNext('/\\/evil.com')).toBeNull()
  })

  it('带协议的、不以其开头的、空的，全给 null', () => {
    expect(safeNext('https://evil.com')).toBeNull()
    expect(safeNext('javascript:alert(1)')).toBeNull()
    expect(safeNext('home')).toBeNull()
    expect(safeNext('')).toBeNull()
    expect(safeNext(undefined)).toBeNull()
    expect(safeNext(null)).toBeNull()
  })
})

describe('parseUser —— 坏数据一律 null，不抛', () => {
  it('形状齐全才认', () => {
    expect(parseUser(USER)).toEqual(USER)
  })

  it('缺字段 / 类型不对 / 不是对象，全是 null', () => {
    expect(parseUser(null)).toBeNull()
    expect(parseUser('13800138000')).toBeNull()
    expect(parseUser([])).toBeNull()
    expect(parseUser({ ...USER, userId: '' })).toBeNull()
    expect(parseUser({ ...USER, phone: 13800138000 })).toBeNull()
    expect(parseUser({ ...USER, nickname: null })).toBeNull()
    expect(parseUser({ ...USER, createdAt: 1 })).toBeNull()
  })

  it('★ 手机号要过格式：不然界面上那句"打码手机号"会去展示一坨垃圾', () => {
    expect(parseUser({ ...USER, phone: 'x'.repeat(11) })).toBeNull()
    expect(parseUser({ ...USER, phone: '1380013800' })).toBeNull()
  })

  it('★ 昵称是空串时**照样认**——空串是"还没起过"，不是坏数据', () => {
    expect(parseUser({ ...USER, nickname: '' })?.nickname).toBe('')
  })
})

describe('用户 round-trip', () => {
  it('存了读得回来，清了就是 null', () => {
    const storage = fakeStorage()
    expect(loadUser(storage)).toBeNull()

    saveUser(USER, storage)
    expect(loadUser(storage)).toEqual(USER)

    clearUser(storage)
    expect(loadUser(storage)).toBeNull()
  })

  it('没有存储（服务端 / 隐私模式）时读是 null、写不抛', () => {
    expect(loadUser(null)).toBeNull()
    expect(() => saveUser(USER, null)).not.toThrow()
    expect(() => clearUser(null)).not.toThrow()
  })

  it('存储里是坏 JSON 时不抛，当没登录', () => {
    const storage = fakeStorage({ 'xiaozhujue.auth.user': '{ 这不是 json' })
    expect(loadUser(storage)).toBeNull()
  })

  it('setItem 抛（配额满）时吞掉，不把失败变成崩溃', () => {
    const storage: AuthStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => undefined,
    }
    expect(() => saveUser(USER, storage)).not.toThrow()
  })
})

describe('在册号码表 —— 只记号码，不记密码', () => {
  it('演示账号一开始就在册，而且**没被写进存储**', () => {
    const storage = fakeStorage()
    expect(isRegistered(DEMO_REGISTERED_PHONE, storage)).toBe(true)
    // ★ 断言这一条是为了钉住"不写演示账号"：写进去就等于第一次访问
    //   就往用户盘上留一条他没做过的记录，以后换演示账号还得写迁移
    expect(loadRegistered(storage)).toEqual([])
    expect(Object.keys(storage.dump())).toEqual([])
  })

  it('设过密码之后在册，且重复记不会记两遍', () => {
    const storage = fakeStorage()
    expect(isRegistered('13900000000', storage)).toBe(false)

    expect(addRegistered('13900000000', storage)).toEqual(['13900000000'])
    expect(isRegistered('13900000000', storage)).toBe(true)
    expect(addRegistered('13900000000', storage)).toEqual(['13900000000'])
  })

  it('★ 存储里塞不进不是号码的东西', () => {
    const storage = fakeStorage({
      'xiaozhujue.auth.registered': JSON.stringify(['13800138000', 'abc', 42, null, '123']),
    })
    expect(loadRegistered(storage)).toEqual(['13800138000'])
  })

  it('存的是数组以外的东西时当空表', () => {
    const storage = fakeStorage({ 'xiaozhujue.auth.registered': '{"a":1}' })
    expect(loadRegistered(storage)).toEqual([])
  })
})
