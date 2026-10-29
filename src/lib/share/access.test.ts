/**
 * access.test.ts —— 一张票能读哪一条路径，以及站点的 origin 怎么算
 *
 * `resolveShareAccess` 的**真**路径（读磁盘、查记录）由 `scripts/chk-share-link.mjs`
 * 在真 dev server 上量；这里只钉两件纯的事：前缀判据与 origin 的取值顺序。
 * 那两件恰好是"分享一本"会不会变成"公开一片"的那条线。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { originFromHeaders, resolveShareAccess, shareAllowsAsset, shareUrlOf } from './access.ts'

const ORIGINAL = process.env.SITE_ORIGIN

beforeEach(() => {
  delete process.env.SITE_ORIGIN
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SITE_ORIGIN
  else process.env.SITE_ORIGIN = ORIGINAL
})

describe('shareAllowsAsset · 只放行这一本书的图与朗读', () => {
  it('这本书目录下的图与朗读可以读', () => {
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-b/page-1-a1.png')).toBe(true)
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-b/cover-a1.webp')).toBe(true)
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-b/page-1-a1.mp3')).toBe(true)
  })

  it('★ 制作底稿不行：manifest 与事件日志不是给孩子读的', () => {
    // 2026-10-29 复查实测：改之前这两条都回 200（book.json 里有每页 prompt 与统计）
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-b/book.json')).toBe(false)
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-b/events.jsonl')).toBe(false)
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-b/story.json')).toBe(false)
  })

  it('★ 别的书、别的前缀、没有斜杠的目录本身，一律不行', () => {
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-c/page-1-a1.png')).toBe(false)
    // 前缀相同但书号多一截：`books/kid-a-sheet-b-2/…` 不是这本书
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-b-2/page-1-a1.png')).toBe(false)
    expect(shareAllowsAsset('kid-a-sheet-b', 'cards/xiaoman-r1/ref.png')).toBe(false)
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-b')).toBe(false)
  })

  it('带 `..` 的路径在这一层就拒，两种分隔符都算', () => {
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-b/../kid-a-sheet-c/x.png')).toBe(
      false,
    )
    expect(shareAllowsAsset('kid-a-sheet-b', 'books/kid-a-sheet-b/..\\kid-a-sheet-c/x.png')).toBe(
      false,
    )
  })
})

describe('originFromHeaders · 先看配置，再看请求头', () => {
  it('SITE_ORIGIN 设了就只用它，末尾斜杠去掉', () => {
    process.env.SITE_ORIGIN = 'https://lbx99.xyz/'
    const headers = new Headers({ host: 'evil.example', 'x-forwarded-proto': 'http' })
    expect(originFromHeaders(headers)).toBe('https://lbx99.xyz')
  })

  it('配置里带了路径也只取 origin；不是合法 URL 就回空串', () => {
    process.env.SITE_ORIGIN = 'https://lbx99.xyz/some/path?x=1'
    expect(originFromHeaders(new Headers())).toBe('https://lbx99.xyz')

    process.env.SITE_ORIGIN = 'lbx99.xyz'
    expect(originFromHeaders(new Headers())).toBe('')
  })

  it('没配置时按 x-forwarded-proto / x-forwarded-host 推', () => {
    const headers = new Headers({
      host: '127.0.0.1:3000',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'lbx99.xyz',
    })
    expect(originFromHeaders(headers)).toBe('https://lbx99.xyz')
  })

  it('只有 Host 时按 http（本机开发那条路）', () => {
    expect(originFromHeaders(new Headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000')
  })

  it('Host 不像一个主机名就回空串，不拼一个坏链接', () => {
    expect(originFromHeaders(new Headers({ host: 'evil.example/path' }))).toBe('')
    expect(originFromHeaders(new Headers({}))).toBe('')
  })

  it('shareUrlOf 拼出来就是 /r/<票>', () => {
    expect(shareUrlOf('https://lbx99.xyz', 'v1.abc.def')).toBe('https://lbx99.xyz/r/v1.abc.def')
  })
})

describe('resolveShareAccess · 一眼假的票不该碰磁盘', () => {
  it('格式不对、过期、空串都回 null', async () => {
    expect(await resolveShareAccess('', '/tmp/does-not-matter')).toBeNull()
    expect(await resolveShareAccess('nope', '/tmp/does-not-matter')).toBeNull()
    expect(await resolveShareAccess('v1.abc.def', '/tmp/does-not-matter')).toBeNull()
  })
})
