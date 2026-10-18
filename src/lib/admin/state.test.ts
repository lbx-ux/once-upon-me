/**
 * admin/state.test.ts —— 管理页那份数据怎么读回来
 *
 * ★ 这里唯一一条要紧的判断是：**半份用户表比没有更坏**。
 *   所以形状不对时整份拒绝，而不是"跳过那一条"。跳过的症状是
 *   "某个人的那一行在页面上不见了"，而管理员会以为自己已经看过全部人了。
 */

import { describe, expect, it } from 'vitest'

import { ACCESS_COLUMN, isAdmin, parseOverview, parseUserRow } from './state.ts'

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  userId: '5',
  account: '18635090513',
  phone: '18635090513',
  nickname: '小满妈妈',
  avatar: 'yun',
  role: 'USER',
  createdAt: '2026-10-16T23:36:20.896544+08:00',
  lastLoginAt: '2026-10-17T00:08:52.837+08:00',
  allowed: true,
  ...over,
})

const overview = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  users: [row()],
  smsToday: 237,
  smsDailyCap: 300,
  registrationOpen: true,
  demoAccount: '123456',
  ...over,
})

describe('parseOverview', () => {
  it('齐了就读得出来，"有没有创作权"那一位不差', () => {
    const parsed = parseOverview(overview())
    expect(parsed?.users[0]?.allowed).toBe(true)
    expect(parsed?.smsToday).toBe(237)
    expect(parsed?.smsDailyCap).toBe(300)
    expect(parsed?.registrationOpen).toBe(true)
    expect(parsed?.demoAccount).toBe('123456')
  })

  it('★ 有一个人缺了那一位 → **整份拒绝**，不是跳过那一条', () => {
    const bad = overview({
      users: [row({ userId: '6', allowed: undefined })],
    })
    expect(parseOverview(bad)).toBeNull()
  })

  it('那一位**必须是布尔**：字符串 `"true"` 不算', () => {
    // ★ 这正是"后端换了序列化方式、没人发现"会长出来的样子
    const bad = overview({ users: [row({ allowed: 'true' })] })
    expect(parseOverview(bad)).toBeNull()
  })

  it('users 不是数组 → null（而不是"零个人"）', () => {
    expect(parseOverview(overview({ users: null }))).toBeNull()
    expect(parseOverview(overview({ users: {} }))).toBeNull()
    expect(parseOverview(null)).toBeNull()
  })

  it('可空的两栏：空串读成 `null`（"没来过"与"上次登录是个空串"是两件事）', () => {
    const parsed = parseOverview(
      overview({ users: [row({ phone: '', lastLoginAt: '' })], demoAccount: null }),
    )
    expect(parsed?.users[0]?.phone).toBeNull()
    expect(parsed?.users[0]?.lastLoginAt).toBeNull()
    // ★ `demoAccount` 为空时**就是不标**——不是"没找到"，前端不因此去猜一个
    expect(parsed?.demoAccount).toBeNull()
  })

  it('缺的数是 0 而不是 undefined（界面上那一格永远画得出东西）', () => {
    const parsed = parseOverview({ users: [] })
    expect(parsed?.smsToday).toBe(0)
    expect(parsed?.smsDailyCap).toBe(0)
    expect(parsed?.registrationOpen).toBe(false)
  })
})

describe('parseUserRow · 改完一个开关之后那一行', () => {
  it('形状对就读得出来', () => {
    expect(parseUserRow(row())?.userId).toBe('5')
  })

  it('认不出来是 `null`，调用方据此**整页重取**而不是假装改成了', () => {
    expect(parseUserRow({ userId: '5' })).toBeNull()
    expect(parseUserRow(row({ userId: '' }))).toBeNull()
    expect(parseUserRow(row({ account: '' }))).toBeNull()
  })
})

describe('那两处常量', () => {
  it('那一列的名字与那句小字都在（表头不能是一格空白）', () => {
    expect(ACCESS_COLUMN.label).toBe('权限')
    expect(ACCESS_COLUMN.hint).not.toBe('')
  })

  it('★ `isAdmin` 只认 `ADMIN`，不认大小写变体、不认空', () => {
    // 宽松一点（比如 `role.includes('ADMIN')`）的代价是：一个叫 `ADMIN_READONLY`
    // 的角色会有侧栏那一格、打不开这一页——一个只在真登录之后才看得见的错
    expect(isAdmin('ADMIN')).toBe(true)
    expect(isAdmin('admin')).toBe(false)
    expect(isAdmin('ADMIN_READONLY')).toBe(false)
    expect(isAdmin('')).toBe(false)
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })
})
