/**
 * shelf-order.test.ts —— 顺序清单：覆盖只覆盖它认识的那几本
 *
 * 这一层没有几行代码，但四条规则各有一条用例，因为每一条单看都像可以商量：
 *   ① 清单没见过的排最前面（不是最后面）——理由在 `shelf-order.ts` 文件头
 *   ② 死 id（书删了）忽略
 *   ③ `moveTo` 的下标是"去掉被拖的那一本之后"数出来的——拖动那边直接传它，
 *      所以这条语义错了，拖过一格就会多走一格，而且只在"往回拖"时看得出来
 *   ④ 坏掉的 `order.json` 退回默认序，不 500——两个 store 实现对半截 JSON
 *      行为不一致（内存抛、fs 回 null），两条路都要走一遍
 */

import { describe, expect, it } from 'vitest'

import { createMemoryStore } from './engine/providers/stores.ts'
import {
  applyOrder,
  loadOrder,
  moveTo,
  pruneOrder,
  saveOrder,
  SHELF_ORDER_PATH,
} from './shelf-order.ts'

/** 这一层只认 `bookId`（`applyOrder` 的泛型只要求它），所以 fixture 可以这么小 */
const books = (...ids: string[]): { bookId: string }[] => ids.map((bookId) => ({ bookId }))
const idsOf = (list: readonly { bookId: string }[]): string[] => list.map((one) => one.bookId)

describe('applyOrder', () => {
  it('清单是空的：原样返回默认序（新的在前那条规则没被推翻）', () => {
    expect(idsOf(applyOrder(books('c', 'b', 'a'), []))).toEqual(['c', 'b', 'a'])
  })

  it('清单里的按清单排', () => {
    expect(idsOf(applyOrder(books('c', 'b', 'a'), ['a', 'c', 'b']))).toEqual(['a', 'c', 'b'])
  })

  it('★ 清单没见过的排在最前面，它们之间仍是默认序', () => {
    // c、b 是用户排过的；a 是刚做出来的新书（默认序里它本来就在最前）
    expect(idsOf(applyOrder(books('a', 'c', 'b'), ['b', 'c']))).toEqual(['a', 'b', 'c'])
    // 两本都没见过：按默认序一起排在最前面
    expect(idsOf(applyOrder(books('e', 'd', 'c'), ['c']))).toEqual(['e', 'd', 'c'])
  })

  it('死 id 与重复 id 都吃掉，不占位、不重复', () => {
    expect(idsOf(applyOrder(books('b', 'a'), ['a', '已经删了', 'a', 'b']))).toEqual(['a', 'b'])
  })
})

describe('pruneOrder', () => {
  it('丢掉盘上没有的，保持相对次序', () => {
    expect(pruneOrder(['c', 'x', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
  })

  it('去重，且不动没被提及的项', () => {
    expect(pruneOrder(['a', 'a', 'b'], ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('moveTo', () => {
  it('往前挪、往后挪', () => {
    expect(moveTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(moveTo(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
  })

  it('★ 下标是"去掉被拖的那一本之后"数出来的', () => {
    // 拖 b 到 c 后面：调用方在 [a, c] 里数出 c 是第 1 位、要插在它后面 → 传 2
    expect(moveTo(['a', 'b', 'c'], 'b', 2)).toEqual(['a', 'c', 'b'])
    // 反过来往回拖也一样：在 [b, c] 里数出 b 是第 0 位、插在它前面 → 传 0
    expect(moveTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
  })

  it('越界夹到两端；不在这列里的 id 不动它', () => {
    expect(moveTo(['a', 'b'], 'b', 99)).toEqual(['a', 'b'])
    expect(moveTo(['a', 'b'], 'b', -3)).toEqual(['b', 'a'])
    expect(moveTo(['a', 'b'], 'zzz', 0)).toEqual(['a', 'b'])
  })

  it('返回新数组，不就地改传进来的那一份', () => {
    const before = ['a', 'b', 'c']
    const after = moveTo(before, 'c', 0)
    expect(after).toEqual(['c', 'a', 'b'])
    expect(before).toEqual(['a', 'b', 'c'])
  })
})

describe('loadOrder / saveOrder', () => {
  it('文件不在：空清单（不是抛）', async () => {
    expect(await loadOrder(createMemoryStore())).toEqual([])
  })

  it('★ 半截 JSON 退回默认序：内存 store 对它是抛的，fs store 回 null，两条都由同一个 catch 收拾', async () => {
    const store = createMemoryStore()
    await store.put({
      path: SHELF_ORDER_PATH,
      bytes: new TextEncoder().encode('{"order": ["a", "b"'),
      mime: 'application/json',
    })
    expect(await loadOrder(store)).toEqual([])
  })

  it('形状不对也退回默认序：不是对象、order 不是数组、数组里混了非字符串', async () => {
    const store = createMemoryStore()
    await store.putJson({ path: SHELF_ORDER_PATH, value: 42 })
    expect(await loadOrder(store)).toEqual([])
    await store.putJson({ path: SHELF_ORDER_PATH, value: { order: 'a,b' } })
    expect(await loadOrder(store)).toEqual([])
    await store.putJson({ path: SHELF_ORDER_PATH, value: { order: ['a', 7, '', null, 'b'] } })
    expect(await loadOrder(store)).toEqual(['a', 'b'])
  })

  it('写下去的形状是 {order, at}，空串被剔掉，重复被合并', async () => {
    const store = createMemoryStore()
    const written = await saveOrder(store, ['b', '', 'a', 'b'])
    expect(written).toEqual(['b', 'a'])
    const file = await store.readJson<{ order: string[]; at: number }>(SHELF_ORDER_PATH)
    expect(file?.order).toEqual(['b', 'a'])
    expect(typeof file?.at).toBe('number')
  })

  it('写两次就是后写的那一份说了算（不是追加）', async () => {
    const store = createMemoryStore()
    await saveOrder(store, ['a', 'b'])
    await saveOrder(store, ['b', 'a'])
    expect(await loadOrder(store)).toEqual(['b', 'a'])
  })
})
