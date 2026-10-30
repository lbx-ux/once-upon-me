/**
 * notices.test.ts —— 站内信：一条记录一个文件
 *
 * 只用内存 store（`pnpm test` 是 `environment: 'node'`）。
 * 钉住的五件事，每件都对应一个真会发生的坏法：
 *
 * 1. 写进去读出来一致，新的排在前面（列表那一屏的顺序）。
 * 2. 坏文件名 / 半截 JSON / 形状不对，都只丢那一条——一条坏记录不许把整页读不出来。
 * 3. 同一毫秒写两次是同一个文件、同一份内容：覆盖无害（幂等）。
 * 4. 已读只改自己那一条，且不改已经是已读的那条（"第一次读到"的时间不许被刷新）。
 * 5. 删一本书要连它的通知一起删；保留期之外的清理不碰新的。
 * 6. 清空是**整片**清：读不出来的那些也走，报的是真删掉的条数，而且只动自己那一片
 *    （2026-10-30 加「清空」那颗钮时补的）。
 */

import { describe, expect, it } from 'vitest'

import { scopedStore } from './asset-scope.ts'
import { createMemoryStore } from './engine/providers/stores.ts'
import {
  addNotice,
  clearNotices,
  deleteNoticesOf,
  listNotices,
  markAllNoticesRead,
  markNoticeRead,
  noticeIdOf,
  noticePathOf,
  NOTICE_DIR,
  pruneNotices,
  readNotice,
  unreadCountOf,
} from './notices.ts'

const T0 = 1_760_000_000_000
const DAY = 24 * 60 * 60 * 1000

describe('写与读', () => {
  it('写进去读出来是一致的，id 由三样拼出来', async () => {
    const store = createMemoryStore()
    const one = await addNotice(store, {
      kind: 'book-ready',
      bookId: 'xiaoyu-r1-abc',
      title: '雨天的桥',
      at: T0,
    })
    expect(one.id).toBe(noticeIdOf('book-ready', 'xiaoyu-r1-abc', T0))
    expect(await readNotice(store, one.id)).toEqual(one)
    expect(one.readAt).toBeNull()
  })

  it('列表新的在前；同一时刻按 id 倒序定死，不靠插入顺序', async () => {
    const store = createMemoryStore()
    await addNotice(store, { kind: 'book-ready', bookId: 'b', title: '旧', at: T0 })
    await addNotice(store, { kind: 'book-ready', bookId: 'a', title: '新', at: T0 + 1 })
    const list = await listNotices(store)
    expect(list.map((one) => one.title)).toEqual(['新', '旧'])
  })

  it('同一毫秒写两次是同一个文件，覆盖无害', async () => {
    const store = createMemoryStore()
    await addNotice(store, { kind: 'book-ready', bookId: 'b', title: '第一版', at: T0 })
    await addNotice(store, { kind: 'book-ready', bookId: 'b', title: '第二版', at: T0 })
    const list = await listNotices(store)
    expect(list).toHaveLength(1)
    expect(list[0]?.title).toBe('第二版')
  })

  it('文件名不合法、半截 JSON、形状不对：只丢那一条', async () => {
    const store = createMemoryStore()
    await addNotice(store, { kind: 'book-ready', bookId: 'ok', title: '好的一条', at: T0 })

    // 名字不合形状：混进目录的别的文件
    await store.put({
      path: `${NOTICE_DIR}README.md`,
      bytes: new Uint8Array([35]),
      mime: 'text/markdown',
    })
    // 半截 JSON：进程被杀时最后写的那一件
    await store.put({
      path: noticePathOf(noticeIdOf('book-ready', 'half', T0)),
      bytes: new TextEncoder().encode('{"kind":"book-ready"'),
      mime: 'application/json',
    })
    // 形状不对：kind 不认识
    await store.putJson({
      path: noticePathOf(noticeIdOf('book-failed', 'bad', T0)),
      value: { kind: 'wat', bookId: 'bad', title: 'x', at: T0, readAt: null },
    })

    const list = await listNotices(store)
    expect(list.map((one) => one.bookId)).toEqual(['ok'])
    expect(await readNotice(store, 'book-ready-half')).toBeNull()
    expect(await readNotice(store, '../../etc/passwd')).toBeNull()
  })
})

describe('已读', () => {
  it('未读数只数 readAt 为 null 的', async () => {
    const store = createMemoryStore()
    const a = await addNotice(store, { kind: 'book-ready', bookId: 'a', title: 'A', at: T0 })
    await addNotice(store, { kind: 'book-ready', bookId: 'b', title: 'B', at: T0 + 1 })
    expect(unreadCountOf(await listNotices(store))).toBe(2)
    await markNoticeRead(store, a.id, T0 + 10)
    expect(unreadCountOf(await listNotices(store))).toBe(1)
  })

  it('已读的时间是第一次读到的时间，再点不刷新', async () => {
    const store = createMemoryStore()
    const one = await addNotice(store, { kind: 'book-failed', bookId: 'a', title: 'A', at: T0 })
    const first = await markNoticeRead(store, one.id, T0 + 100)
    const again = await markNoticeRead(store, one.id, T0 + 999)
    expect(first?.readAt).toBe(T0 + 100)
    expect(again?.readAt).toBe(T0 + 100)
  })

  it('全部标为已读，返回这一次改了几条', async () => {
    const store = createMemoryStore()
    await addNotice(store, { kind: 'book-ready', bookId: 'a', title: 'A', at: T0 })
    const b = await addNotice(store, { kind: 'book-ready', bookId: 'b', title: 'B', at: T0 + 1 })
    await markNoticeRead(store, b.id, T0 + 2)
    expect(await markAllNoticesRead(store, T0 + 3)).toBe(1)
    expect(unreadCountOf(await listNotices(store))).toBe(0)
    // 全读完再点一次：一条都没有改
    expect(await markAllNoticesRead(store, T0 + 4)).toBe(0)
  })
})

describe('清空', () => {
  it('整片清掉，报的是真删掉的条数；再点一次回 0 而不是报错', async () => {
    const store = createMemoryStore()
    for (let i = 0; i < 3; i += 1) {
      await addNotice(store, { kind: 'book-ready', bookId: `b${i}`, title: `T${i}`, at: T0 + i })
    }
    expect(await clearNotices(store)).toBe(3)
    expect(await listNotices(store)).toEqual([])
    expect(await clearNotices(store)).toBe(0)
  })

  it('读不出来的那些也一起走：清空之后这一片是空的', async () => {
    const store = createMemoryStore()
    await addNotice(store, { kind: 'book-ready', bookId: 'ok', title: '好的一条', at: T0 })
    // 这两种都进不了 `listNotices`（见「写与读」那个用例），逐条列着删会漏掉它们
    await store.put({
      path: `${NOTICE_DIR}README.md`,
      bytes: new Uint8Array([35]),
      mime: 'text/markdown',
    })
    await store.put({
      path: noticePathOf(noticeIdOf('book-ready', 'half', T0)),
      bytes: new TextEncoder().encode('{"kind":"book-ready"'),
      mime: 'application/json',
    })
    expect(await clearNotices(store)).toBe(3)
    expect(await store.list(NOTICE_DIR)).toEqual([])
  })

  it('只清自己那一片：别人的通知一条不动', async () => {
    const base = createMemoryStore()
    const mine = scopedStore(base, '7')
    const yours = scopedStore(base, '8')
    await addNotice(mine, { kind: 'book-ready', bookId: 'a', title: '我的', at: T0 })
    await addNotice(yours, { kind: 'book-ready', bookId: 'b', title: '你的', at: T0 + 1 })

    expect(await clearNotices(mine)).toBe(1)
    expect(await listNotices(mine)).toEqual([])
    expect((await listNotices(yours)).map((one) => one.title)).toEqual(['你的'])
  })
})

describe('删除与保留期', () => {
  it('删一本书只删它的通知', async () => {
    const store = createMemoryStore()
    await addNotice(store, { kind: 'book-ready', bookId: 'keep', title: 'K', at: T0 })
    await addNotice(store, { kind: 'book-failed', bookId: 'gone', title: 'G', at: T0 + 1 })
    await addNotice(store, { kind: 'book-ready', bookId: 'gone', title: 'G2', at: T0 + 2 })
    expect(await deleteNoticesOf(store, 'gone')).toBe(2)
    expect((await listNotices(store)).map((one) => one.bookId)).toEqual(['keep'])
  })

  it('保留期之外的被清掉，新的不动', async () => {
    const store = createMemoryStore()
    // ★ 直接写盘，不走 `addNotice`：它写完之后会顺手清一次（见下一个用例），
    //   那会把这条用例要验的"prune 自己"先清掉
    const raw = (bookId: string, at: number) => ({
      kind: 'book-ready' as const,
      bookId,
      title: bookId,
      message: '',
      at,
      readAt: null,
    })
    await store.putJson({
      path: noticePathOf(noticeIdOf('book-ready', 'old', T0)),
      value: raw('old', T0),
    })
    await store.putJson({
      path: noticePathOf(noticeIdOf('book-ready', 'new', T0 + 91 * DAY)),
      value: raw('new', T0 + 91 * DAY),
    })
    expect(await pruneNotices(store, T0 + 91 * DAY)).toBe(1)
    expect((await listNotices(store)).map((one) => one.bookId)).toEqual(['new'])
  })

  it('写一条新通知时顺手清掉过期的：清理不用等下一次巡检', async () => {
    const store = createMemoryStore()
    await addNotice(store, { kind: 'book-ready', bookId: 'old', title: 'O', at: T0 })
    await addNotice(store, { kind: 'book-ready', bookId: 'new', title: 'N', at: T0 + 91 * DAY })
    expect((await listNotices(store)).map((one) => one.bookId)).toEqual(['new'])
  })
})
