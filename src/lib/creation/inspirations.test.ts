/**
 * inspirations.test.ts —— 灵感池与"发牌"那一步的**结构性**约束
 *
 * ★ 为什么值得测：这一份表坏起来全是静默的——
 *   1. `theme` 写错一个字母：那一句抽到时点不亮任何一格，立绘也不换，屏幕上什么都不说；
 *   2. 某个主题一条都没有：那句"点了主题卡就换人"的话在这一路上有个洞；
 *   3. 全都带主题（或全都不带）：`theme: null` 那条分支变成死代码，
 *      而"默认形象"是产品里真的那一半；
 *   4. 抽牌抽成顺序（就是这一刀要修的那个旧样子）：只有"一轮不重复"能证伪它。
 *   这四条都不是审美判断，是能断言的事实。
 */

import { describe, expect, it } from 'vitest'

import { THEME_KEYS, THEMES } from '../themes.ts'
import { EXAMPLE_WISHES } from './example-wishes.ts'
import { drawInspiration, INSPIRATION_POOL } from './inspirations.ts'

describe('灵感池', () => {
  it('每条带的 theme 都是真实存在的主题键', () => {
    const keys = new Set<string>(THEME_KEYS)
    for (const item of INSPIRATION_POOL) {
      if (item.theme === undefined) continue
      expect(keys.has(item.theme), `${item.text} 的 theme=${item.theme} 不在 THEME_KEYS 里`).toBe(
        true,
      )
    }
  })

  it('够大：至少 60 条（骰子的"随机"靠的就是这个数）', () => {
    expect(INSPIRATION_POOL.length).toBeGreaterThanOrEqual(60)
  })

  it('句子非空、不重复，也不与墙上那 12 句撞车', () => {
    const texts = INSPIRATION_POOL.map((item) => item.text)
    for (const text of texts) expect(text.trim().length).toBeGreaterThan(0)
    // ★ 池子里自己重复：抽到两次同一句，用户会以为按坏了
    expect(new Set(texts).size).toBe(texts.length)
    // ★ 与墙上那 12 句重复：墙上那句是配着插画出的说明，"换一句"换出同一句
    //   看着像按钮没反应（12 格全部按过一遍之后概率不低）
    const wall = new Set(EXAMPLE_WISHES.map((item) => item.text))
    for (const text of texts) expect(wall.has(text), `「${text}」与主题墙那一句重复了`).toBe(false)
  })

  it('12 个主题每个都至少有一条（否则"点亮那一格"有条走不到的路）', () => {
    const covered = new Set(INSPIRATION_POOL.map((item) => item.theme))
    for (const theme of THEMES) {
      expect(covered.has(theme.key), `${theme.key} 在池子里一条都没有`).toBe(true)
    }
  })

  it('有不带主题的（否则"主题清空 / 走默认形象"那条分支是死的）', () => {
    const free = INSPIRATION_POOL.filter((item) => item.theme === undefined)
    expect(free.length).toBeGreaterThan(0)
  })
})

describe('发牌（"换一句"按下去的那一步）', () => {
  /** 可复现的假随机：一串写死的数循环用 */
  function seq(values: number[]): () => number {
    let at = 0
    return () => values[at++ % values.length] as number
  }

  /** 连抽 n 次（每次都把牌堆与上一次的索引传回去，与组件里那两个 ref 同一条） */
  function draws(n: number, rand: () => number): number[] {
    let deck: number[] = []
    let last = -1
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const next = drawInspiration(deck, last, rand)
      deck = next.deck
      last = next.index
      out.push(next.index)
    }
    return out
  }

  it('一轮之内不重复：抽满一条池子正好是 0…N-1 的一个排列', () => {
    const got = draws(INSPIRATION_POOL.length, seq([0.13, 0.71, 0.29, 0.53, 0.97, 0.41, 0.07]))
    // ★ 这一条同时否掉两种坏法：随机到重复（长度对不上）与**按顺序**（就是旧样子：
    //   那么抽出来会正好是 0,1,2,…，一个排列也满足，所以下面还要单独查它不是顺序）
    expect(new Set(got).size).toBe(INSPIRATION_POOL.length)
    expect([...got].sort((a, b) => a - b)).toEqual(
      Array.from({ length: INSPIRATION_POOL.length }, (_, i) => i),
    )
    expect(got).not.toEqual(Array.from({ length: INSPIRATION_POOL.length }, (_, i) => i))
  })

  it('牌发完了自己重洗，而且重洗后的第一张不是刚抽过的那张', () => {
    const n = INSPIRATION_POOL.length
    const got = draws(n + 1, seq([0.37, 0.82, 0.19, 0.64, 0.05, 0.91, 0.46]))
    expect(got[n]).not.toBe(got[n - 1])
    // 第二轮的第一张仍然落在池子里（不是 undefined / -1 这类"没牌了"的表示）
    expect(got[n]).toBeGreaterThanOrEqual(0)
    expect(got[n]).toBeLessThan(n)
  })

  it('牌堆不改（纯函数）：传进去的那个数组一张不少', () => {
    const deck = [3, 1, 4]
    const out = drawInspiration(deck, -1, seq([0.5]))
    expect(deck).toEqual([3, 1, 4])
    expect(out.deck).toEqual([3, 1])
    expect(out.index).toBe(4)
  })

  it('抽到的索引永远指向池子里真有的那一条', () => {
    for (const index of draws(40, seq([0.11, 0.99, 0.5, 0.03, 0.77]))) {
      expect(INSPIRATION_POOL[index]).toBeDefined()
    }
  })
})
