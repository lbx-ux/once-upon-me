import { describe, expect, it } from 'vitest'

import {
  canCreate,
  maskPhone,
  missingForCreate,
  NO_PERMISSIONS,
  parseUser,
  safeNext,
  type Permissions,
} from './state.ts'

/**
 * `state.ts` 剩下三个纯函数 + 两个权限推导。
 * ★ 上一版这里还有"用户 round-trip / 在册号码表 / 底账"三组用例——它们测的是
 * 浏览器替后端记的那些账。后端落地之后那些账没了，用例跟着走：
 * "登出再登入昵称还在"这条性质现在由**服务端**保证，
 * 而它在 Java 那边有测试（`AuthFlowIntegrationTest#passwordSurvivesSignOut`）。
 */

const allOn: Permissions = { text: true, image: true, vision: true, speech: true }

function user(overrides: Record<string, unknown> = {}): unknown {
  return {
    userId: '7',
    account: '13800138000',
    phone: '13800138000',
    nickname: '小满妈妈',
    role: 'USER',
    createdAt: '2026-10-16T22:11:02.645706+08:00',
    permissions: allOn,
    ...overrides,
  }
}

describe('maskPhone', () => {
  it('11 位大陆号码盖中间四位', () => {
    expect(maskPhone('13800138000')).toBe('138****8000')
  })

  it('认不出来的一律原样返回，不套假的星号形状', () => {
    // ★ 短账号（演示账号）也走这一条：它没有被"打码"这回事
    expect(maskPhone('123456')).toBe('123456')
    expect(maskPhone('138001380001')).toBe('138001380001')
    expect(maskPhone('abc')).toBe('abc')
  })

  it('短账号没有手机号时是空串，不是 "null" 那四个字母', () => {
    expect(maskPhone(null)).toBe('')
    expect(maskPhone(undefined)).toBe('')
  })
})

describe('safeNext', () => {
  it('收站内路径', () => {
    expect(safeNext('/home')).toBe('/home')
    expect(safeNext('/account?tab=1')).toBe('/account?tab=1')
  })

  it('★ 协议相对的写法一个都不放过', () => {
    expect(safeNext('//evil.com')).toBeNull()
    expect(safeNext('/\\evil.com')).toBeNull()
    expect(safeNext('https://evil.com')).toBeNull()
  })

  it('带协议的、不以其开头的、空的，全给 null', () => {
    expect(safeNext('home')).toBeNull()
    expect(safeNext('')).toBeNull()
    expect(safeNext(undefined)).toBeNull()
    expect(safeNext(null)).toBeNull()
  })
})

describe('parseUser —— 接口回的东西也要逐字段验', () => {
  it('形状齐全才认', () => {
    const parsed = parseUser(user())
    expect(parsed?.userId).toBe('7')
    expect(parsed?.permissions.text).toBe(true)
  })

  it('缺字段 / 类型不对 / 不是对象，全是 null', () => {
    expect(parseUser(null)).toBeNull()
    expect(parseUser('nope')).toBeNull()
    expect(parseUser(user({ userId: '' }))).toBeNull()
    expect(parseUser(user({ nickname: 7 }))).toBeNull()
    expect(parseUser(user({ createdAt: undefined }))).toBeNull()
  })

  it('★ 账号要过形状：不然打码那一格会拿一坨垃圾去展示', () => {
    expect(parseUser(user({ account: 'admin' }))).toBeNull()
    expect(parseUser(user({ account: '12345' }))).toBeNull()
    expect(parseUser(user({ account: '123456' }))?.account).toBe('123456')
  })

  it('★ 手机号可空，但给了就必须是个号', () => {
    expect(parseUser(user({ phone: null }))?.phone).toBeNull()
    expect(parseUser(user({ phone: '123456' }))).toBeNull()
  })

  it('★ 昵称是空串时**照样认**——空串是"还没起过"，不是坏数据', () => {
    expect(parseUser(user({ nickname: '' }))?.nickname).toBe('')
  })

  it('★ 权限表缺一项就整份不认：半个权限表比没有更坏', () => {
    expect(parseUser(user({ permissions: { text: true, image: true, vision: true } }))).toBeNull()
    expect(parseUser(user({ permissions: { ...allOn, speech: 'yes' } }))).toBeNull()
    expect(parseUser(user({ permissions: NO_PERMISSIONS }))?.permissions.speech).toBe(false)
  })
})

describe('能不能开始创作', () => {
  it('要文本 + 图像两样（这一本最低要这两件事）', () => {
    expect(canCreate(allOn)).toBe(true)
    expect(canCreate({ ...allOn, image: false })).toBe(false)
    expect(canCreate({ ...allOn, text: false })).toBe(false)
    expect(canCreate(NO_PERMISSIONS)).toBe(false)
    // 视觉与语音是"更好"，不是"能不能开始"
    expect(canCreate({ ...allOn, vision: false, speech: false })).toBe(true)
  })

  it('缺哪几个要说得出名字——管理员看到提示时要能一眼答上勾哪个', () => {
    expect(missingForCreate(NO_PERMISSIONS)).toEqual(['文字', '图像'])
    expect(missingForCreate({ ...allOn, image: false })).toEqual(['图像'])
    expect(missingForCreate(allOn)).toEqual([])
  })
})
