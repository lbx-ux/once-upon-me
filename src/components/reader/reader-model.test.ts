/**
 * reader-model.test.ts —— 锁住"**一页 = 一个跨页 = 一张图**"
 *
 * ★ 这一组测的不是几何（那个在 flip.ts，而且它一直是对的），是**每一面装什么**。
 *   2026-10-15 之前的形状是每一面装一整页，翻开一屏 = 左右各一张不同的图；
 *   而"一页图配一页字"与"一张横图在书脊处切开"在类型上完全一样，闸门抓不到。
 *   下面那几条断言就是那次返工留下的判据——把页模型改回两面各一张图，它们会红。
 */

import { describe, expect, it } from 'vitest'

import {
  autoCueOf,
  leafCountOf,
  openingOf,
  readerFaces,
  readoutOf,
  showsText,
} from './reader-model.ts'
import type { ReaderPage } from '@/lib/book-source.ts'

function page(pageNo: number, body: readonly string[] = ['一句。']): ReaderPage {
  return {
    pageNo,
    imageUrl: `books/b1/page-${pageNo}-a1.png`,
    audioUrl: null,
    body,
    missing: false,
  }
}

const PAGES = [page(1), page(2), page(3)]

describe('面表：一页的两半是**同一张图**', () => {
  it('面数 = 2 × 页数 + 2（封面 + 每页两半 + 封底）', () => {
    expect(readerFaces(PAGES)).toHaveLength(2 * PAGES.length + 2)
  })

  it('叶数 = 页数 + 1（flip.ts 的叶表：N 个跨页要 N+1 叶）', () => {
    expect(leafCountOf(PAGES)).toBe(PAGES.length + 1)
    expect(readerFaces(PAGES)).toHaveLength(2 * leafCountOf(PAGES))
  })

  it('★ 同一个 opening 的左右半指着**同一个 page 对象**——不是两张不同的图', () => {
    const faces = readerFaces(PAGES)
    for (let k = 1; k <= PAGES.length; k++) {
      const left = faces[2 * k - 1]
      const right = faces[2 * k]
      expect(left?.kind).toBe('art')
      expect(right?.kind).toBe('art')
      if (left?.kind !== 'art' || right?.kind !== 'art') return
      expect(left.half).toBe('left')
      expect(right.half).toBe('right')
      // 同一张图（对象同一个）——"左右各一个"就是把这里换成两张不同的图
      expect(left.page).toBe(right.page)
      expect(left.page.pageNo).toBe(k)
    }
  })

  it('★ openingOf 把这两半算成同一个 opening（挂图窗口按它算）', () => {
    for (let k = 1; k <= PAGES.length; k++) {
      expect(openingOf(2 * k - 1)).toBe(k)
      expect(openingOf(2 * k)).toBe(k)
    }
    // 两个端点：封面在 0，封底在 leafCount
    expect(openingOf(0)).toBe(0)
    expect(openingOf(readerFaces(PAGES).length - 1)).toBe(leafCountOf(PAGES))
  })

  it('封面在最前、封底在最后（顺序错了翻出来的第一屏不是封面）', () => {
    const faces = readerFaces(PAGES)
    expect(faces[0]?.kind).toBe('cover')
    expect(faces[faces.length - 1]?.kind).toBe('back')
  })

  it('没有页的书只剩封面与封底，不抛', () => {
    expect(readerFaces([]).map((face) => face.kind)).toEqual(['cover', 'back'])
    expect(leafCountOf([])).toBe(1)
  })
})

describe('正文只跟左半走', () => {
  it('同一页的两个半页：左半出正文，右半不出', () => {
    const faces = readerFaces([page(1, ['第一句。', '第二句。'])])
    expect(showsText(faces[1]!)).toBe(true)
    expect(showsText(faces[2]!)).toBe(false)
  })

  it('封面与封底不出正文（它们是 kind，不是空的 page）', () => {
    const faces = readerFaces(PAGES)
    expect(showsText(faces[0]!)).toBe(false)
    expect(showsText(faces[faces.length - 1]!)).toBe(false)
  })

  it('正文是空数组时不出一块空的字（不是"能出却没出"）', () => {
    const faces = readerFaces([page(1, [])])
    expect(showsText(faces[1]!)).toBe(false)
  })
})

describe('页码：封面与封底**不是页**', () => {
  it('翻开一屏报一页，不是"第 1–2 页"', () => {
    expect(readoutOf(1, PAGES)).toEqual({ label: '第 1 页', page: 1 })
    expect(readoutOf(2, PAGES)).toEqual({ label: '第 2 页', page: 2 })
  })

  it('两端是封面与封底，page 为 null', () => {
    expect(readoutOf(0, PAGES)).toEqual({ label: '封面', page: null })
    expect(readoutOf(leafCountOf(PAGES), PAGES)).toEqual({ label: '封底', page: null })
  })

  it('★ 封底的 page **不是** pages.length —— 那个哨兵恰好等于最后一页的页码', () => {
    // 这条是这次一起修掉的缺陷：`page: pages.length` 会让下游把"停在封底"读成
    // "在第 P 页"，于是朗读按钮亮着、阅读时长也记到最后一页头上
    const last = readoutOf(leafCountOf(PAGES), PAGES)
    expect(last.page).toBeNull()
    expect(last.page).not.toBe(PAGES.length)
  })

  it('半翻状态下报的是**正在翻向**的那一页（四舍五入，不出现第 1.5 页）', () => {
    expect(readoutOf(1.4, PAGES)).toEqual({ label: '第 1 页', page: 1 })
    expect(readoutOf(1.6, PAGES)).toEqual({ label: '第 2 页', page: 2 })
  })

  it('越界的 q 不抛，报最接近的那一端', () => {
    expect(readoutOf(-3, PAGES).label).toBe('封面')
    expect(readoutOf(99, PAGES).label).toBe('封底')
  })
})

describe('自动朗读：第 opening 屏该念哪儿', () => {
  const COUNT = PAGES.length

  it('第 k 屏念第 k 屏', () => {
    for (let k = 1; k <= COUNT; k++) {
      expect(autoCueOf(k, COUNT)).toEqual({ kind: 'speak', screen: k })
    }
  })

  it('★ 封面是 begin，不是"没有可念的"', () => {
    // `readoutOf` 在封面给的是 `page: null`，但那句话在这里不够用：
    // 跟着那个 null 走，按一次「自动朗读」就是一句也不念
    expect(autoCueOf(0, COUNT)).toEqual({ kind: 'begin' })
    expect(readoutOf(0, PAGES).page).toBeNull()
  })

  it('★ 封底是 done —— 边界是 `屏数 + 1`，不是 `屏数`', () => {
    // 差一写法的症状：最后一屏被念两遍（一遍算"第 N 屏"、一遍算"封底"），
    // 或者最后一屏永远轮不到 —— 那个哨兵值与 `readoutOf` 那条注释同源
    expect(autoCueOf(leafCountOf(PAGES), COUNT)).toEqual({ kind: 'done' })
    expect(autoCueOf(COUNT, COUNT)).toEqual({ kind: 'speak', screen: COUNT })
  })

  it('越界不抛：负数当封面、超出的当封底', () => {
    expect(autoCueOf(-3, COUNT)).toEqual({ kind: 'begin' })
    expect(autoCueOf(99, COUNT)).toEqual({ kind: 'done' })
  })

  it('空书（封面紧挨着封底）两个端点都认得出，不会去念第 1 屏', () => {
    expect(autoCueOf(0, 0)).toEqual({ kind: 'begin' })
    expect(autoCueOf(1, 0)).toEqual({ kind: 'done' })
  })
})
