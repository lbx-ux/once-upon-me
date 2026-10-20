/**
 * admin/usage.test.ts —— 那一列数出来的东西对不对
 *
 * 最要紧的一条是「**只数 `u/` 底下**」：归属是靠那个前缀记的，而
 *   `.out/web` 里还有 `demo/`、`thumbs/` 这些公共目录。把根上那些也算进去的话，
 *   症状是"每个人都凭空多几本"——数看着像真的，而它是错的。
 *
 * 第二条要紧的是「数目录不数文件」：一本书 20 页图 + 1 份清单 + 几段朗读，
 *   数文件会报出 512 本。
 */

import { describe, expect, it } from 'vitest'

import { usageTextOf } from './state.ts'
import { usageFromPaths } from './usage.ts'

describe('★ 只数自己那一片', () => {
  it('三个数各数各的目录/档案', () => {
    const usage = usageFromPaths([
      'u/1/books/b-a/book.json',
      'u/1/books/b-a/page-1-a1.png',
      'u/1/books/b-a/page-2-b2.png',
      'u/1/books/b-b/book.json',
      'u/1/cards/c-a/ref.abcdef123456.png',
      'u/1/cards/c-a/meta.json',
      'u/1/children/kid-1.json',
      'u/1/shelf/order.json',
    ])
    expect(usage).toEqual({ '1': { books: 2, cards: 1, children: 1 } })
  })

  it('★ 根上那些公共目录一个都不算（demo / thumbs / booklist）', () => {
    const usage = usageFromPaths([
      'demo/books/demo-1/book.json',
      'demo/cards/demo-card/ref.png',
      'thumbs/books/demo-1/x-384.webp',
      'assets/whatever.png',
      'u/2/books/only/book.json',
    ])
    expect(usage).toEqual({ '2': { books: 1, cards: 0, children: 0 } })
  })

  it('★ 数的是目录，不是文件数', () => {
    const many = Array.from({ length: 20 }, (_, i) => `u/7/books/one/page-${i}-a1.png`)
    expect(usageFromPaths(['u/7/books/one/book.json', ...many])).toEqual({
      '7': { books: 1, cards: 0, children: 0 },
    })
  })

  it('两个人各数各的，一个人一个键', () => {
    const usage = usageFromPaths([
      'u/1/books/a/book.json',
      'u/10/books/b/book.json',
      'u/10/books/c/book.json',
      'u/2/children/kid-x.json',
    ])
    expect(usage['1']).toEqual({ books: 1, cards: 0, children: 0 })
    expect(usage['10']).toEqual({ books: 2, cards: 0, children: 0 })
    expect(usage['2']).toEqual({ books: 0, cards: 0, children: 1 })
  })

  it('★ u/1/ 与 u/10/ 不会串（前缀那个斜杠是承重的，与 asset-scope 同一条）', () => {
    const usage = usageFromPaths(['u/10/books/ten/book.json'])
    expect(usage['1']).toBeUndefined()
    expect(usage['10']).toEqual({ books: 1, cards: 0, children: 0 })
  })

  it('孩子那一项不把 `children/` 底下的别的文件算成孩子', () => {
    // `children/<childId>.json` 才是档案；多一层的东西不是（比如将来放缩略图）
    const usage = usageFromPaths(['u/3/children/kid-1.json', 'u/3/children/kid-1/face.png'])
    expect(usage['3']?.children).toBe(1)
  })

  it('空盘 → 空表（不是一条全零的记录）', () => {
    expect(usageFromPaths([])).toEqual({})
    expect(usageFromPaths(['u/9/shelf/order.json'])).toEqual({
      '9': { books: 0, cards: 0, children: 0 },
    })
  })
})

describe('那一列上写什么', () => {
  it('★ 数不出来是「—」，不是「0 本」——后者是假数', () => {
    expect(usageTextOf(undefined)).toBe('—')
  })

  it('全零说「还没有」', () => {
    expect(usageTextOf({ books: 0, cards: 0, children: 0 })).toBe('还没有')
  })

  it('有东西就照实说全三个数（零也写出来）', () => {
    expect(usageTextOf({ books: 3, cards: 2, children: 1 })).toBe('3 本 · 2 张卡 · 1 个孩子')
    expect(usageTextOf({ books: 1, cards: 0, children: 0 })).toBe('1 本 · 0 张卡 · 0 个孩子')
  })
})
