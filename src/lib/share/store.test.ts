/**
 * store.test.ts —— 分享账本：一条记录一个文件
 *
 * 只用内存 store。三条判据在这里钉住：过期/收回/不存在都算"不活"；
 * 收回是改字段不是删文件（删了就看不出它曾经存在过）；坏文件不许让整页读不出来。
 */

import { describe, expect, it } from 'vitest'

import { createMemoryStore } from '../engine/providers/stores.ts'
import {
  activeSharesOf,
  deleteSharesOf,
  isShareActive,
  listShares,
  pruneShares,
  putShare,
  readShare,
  revokeSharesOf,
  sharePathOf,
  shareStateOf,
  shareStatesOf,
  type ShareRecord,
} from './store.ts'

const DAY = 24 * 60 * 60 * 1000
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

function record(bookId: string, overrides: Partial<ShareRecord> = {}): ShareRecord {
  const now = Date.now()
  return { bookId, createdAt: now, expiresAt: now + DAY, revokedAt: null, ...overrides }
}

describe('记录本身', () => {
  it('写进去读出来是一致的', async () => {
    const store = createMemoryStore()
    const one = record('kid-a-sheet-b')
    await putShare(store, HASH_A, one)
    expect(await readShare(store, HASH_A)).toEqual(one)
  })

  it('没写过、哈希不合法、坏 JSON 都回 null', async () => {
    const store = createMemoryStore()
    expect(await readShare(store, HASH_A)).toBeNull()
    expect(await readShare(store, 'not-a-hash')).toBeNull()
    // 一份半截 JSON：进程被杀时最后写的那一件长这样
    await store.put({
      path: sharePathOf(HASH_B),
      bytes: new TextEncoder().encode('{"bookId":'),
      mime: 'application/json',
    })
    expect(await readShare(store, HASH_B)).toBeNull()
  })

  it('sharePathOf 只认 64 位十六进制——别的一律抛，不拼进路径', () => {
    expect(sharePathOf(HASH_A)).toBe(`shares/${HASH_A}.json`)
    expect(() => sharePathOf('../book')).toThrow()
    expect(() => sharePathOf('A'.repeat(64))).toThrow()
  })

  it('活着的判据：没收回、没过期', () => {
    const now = Date.now()
    expect(isShareActive(record('x'), now)).toBe(true)
    expect(isShareActive(record('x', { expiresAt: now - 1 }), now)).toBe(false)
    expect(isShareActive(record('x', { revokedAt: now }), now)).toBe(false)
  })
})

describe('按书聚合', () => {
  it('shareStateOf 只看这本书，并取最晚到期', async () => {
    const store = createMemoryStore()
    const now = Date.now()
    await putShare(store, HASH_A, record('kid-a-sheet-b', { expiresAt: now + DAY }))
    await putShare(store, HASH_B, record('kid-a-sheet-b', { expiresAt: now + 3 * DAY }))
    await putShare(store, HASH_C, record('kid-c-sheet-d'))

    const state = await shareStateOf(store, 'kid-a-sheet-b', now)
    expect(state.active).toBe(true)
    expect(state.expiresAt).toBe(now + 3 * DAY)

    expect(await shareStateOf(store, 'kid-e-sheet-f', now)).toEqual({
      active: false,
      expiresAt: null,
    })
  })

  it('shareStatesOf 给书架一张表：没有活链接的书不在表里', async () => {
    const store = createMemoryStore()
    const now = Date.now()
    await putShare(store, HASH_A, record('kid-a-sheet-b', { expiresAt: now + DAY }))
    await putShare(store, HASH_B, record('kid-c-sheet-d', { revokedAt: now }))
    expect(await shareStatesOf(store, now)).toEqual({ 'kid-a-sheet-b': now + DAY })
  })

  it('★ 收回是改字段：文件还在，revokedAt 记下第一次的时间', async () => {
    const store = createMemoryStore()
    const now = Date.now()
    await putShare(store, HASH_A, record('kid-a-sheet-b'))

    expect(await revokeSharesOf(store, 'kid-a-sheet-b', now)).toBe(1)
    const after = await readShare(store, HASH_A)
    expect(after?.revokedAt).toBe(now)
    // 再收一次不改时间、也不重复计数
    expect(await revokeSharesOf(store, 'kid-a-sheet-b', now + 1000)).toBe(0)
    expect((await readShare(store, HASH_A))?.revokedAt).toBe(now)
  })

  it('收回只动这本书的链接', async () => {
    const store = createMemoryStore()
    await putShare(store, HASH_A, record('kid-a-sheet-b'))
    await putShare(store, HASH_B, record('kid-c-sheet-d'))
    await revokeSharesOf(store, 'kid-a-sheet-b')
    expect(await activeSharesOf(store, 'kid-c-sheet-d')).toHaveLength(1)
  })

  it('目录里混进不是哈希的文件时，整张表照样读得出来', async () => {
    const store = createMemoryStore()
    await putShare(store, HASH_A, record('kid-a-sheet-b'))
    await store.putJson({ path: 'shares/notes.json', value: { hello: 1 } })
    await store.putJson({ path: 'shares/other/deep.json', value: {} })
    const list = await listShares(store)
    expect(list.map((one) => one.hash)).toEqual([HASH_A])
  })

  it('★ 删一本书时它的分享记录全删，别的书一条不动', async () => {
    const store = createMemoryStore()
    await putShare(store, HASH_A, record('kid-a-sheet-b'))
    await putShare(store, HASH_B, record('kid-a-sheet-b', { revokedAt: Date.now() }))
    await putShare(store, HASH_C, record('kid-c-sheet-d'))

    expect(await deleteSharesOf(store, 'kid-a-sheet-b')).toBe(2)
    expect(await readShare(store, HASH_A)).toBeNull()
    expect(await readShare(store, HASH_B)).toBeNull()
    expect(await readShare(store, HASH_C)).not.toBeNull()
  })

  it('清理只删过期/收回超过保留期的，留下的还能读', async () => {
    const store = createMemoryStore()
    const now = Date.now()
    const old = 40 * DAY
    await putShare(store, HASH_A, record('kid-a-sheet-b', { expiresAt: now - old }))
    await putShare(store, HASH_B, record('kid-c-sheet-d', { expiresAt: now + DAY }))
    await putShare(store, HASH_C, record('kid-e-sheet-f', { revokedAt: now - old }))

    expect(await pruneShares(store, now)).toBe(2)
    expect(await readShare(store, HASH_B)).not.toBeNull()
    expect(await readShare(store, HASH_A)).toBeNull()
  })
})
