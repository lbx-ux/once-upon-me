import { describe, expect, it } from 'vitest'

import {
  CLICK_RADIUS,
  STAGE_RADIUS,
  dragSteps,
  reelDepth,
  reelJumped,
  reelState,
  ringOffset,
  wrapActive,
} from './reel'

/**
 * lib/reel.ts 的测试
 *
 * 这块逻辑没有一处能靠眼睛查：可见性、tab 序列、读屏三者不一致时，
 * 页面上看起来完全正常，只有键盘党与读屏用户会发现有些卡永远到不了。
 * 所以这三个量必须由测试钉住，而不是由实现顺手算。
 *
 * 但"环形偏移"这一条是眼睛查出来的：第一版 offset = index - active，
 *   当前卡是第 1 条时左边一个卡位都没有，截图上就是轮播左边空一大片。
 *   下面那条「两侧永远被填满」的不变量就是为它补的。
 */

/** 把一组 offset 按卡位排出来，方便一眼对照 */
const offsets = (active: number, count: number) => reelState(active, count).map((s) => s.offset)

describe('reelState', () => {
  it('五张卡、当前是第 3 条（下标 2）时，offset 是它自己减当前', () => {
    const slots = reelState(2, 5)
    expect(slots.map((s) => s.offset)).toEqual([-2, -1, 0, 1, 2])
    expect(slots.map((s) => s.index)).toEqual([0, 1, 2, 3, 4])
  })

  it('★ 这是轮播：当前是第 1 条时，左边是第 5 条，不是空', () => {
    // 第一版栽在这条上：offset 用 index - active，active=0 时得到 [0,1,2,3,4]，
    // 左边零个卡位，第 4、5 条全堆在右边缘外被裁掉。
    expect(offsets(0, 5)).toEqual([0, 1, 2, -2, -1])
  })

  it('★ 不变量：任何一张当当前卡，两侧都填满，且恰好一张在 0 位', () => {
    // 这一条是上面那个 bug 的通用形式 —— 单点断言挡不住"某一张才出现的问题"。
    for (let active = 0; active < 5; active++) {
      const list = offsets(active, 5)
      expect(list.filter((o) => o === 0)).toHaveLength(1)
      expect([...list].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2])
      // 左侧与右侧各两张，谁都不许缺席
      expect(list.filter((o) => o < 0)).toHaveLength(2)
      expect(list.filter((o) => o > 0)).toHaveLength(2)
    }
  })

  it('只有当前卡暴露给辅助技术与 tab 序列', () => {
    const slots = reelState(2, 5)
    expect(slots.filter((s) => s.exposed).map((s) => s.index)).toEqual([2])
  })

  it('★ advanceOnClick 与 exposed 是两件事，不许合并', () => {
    const slots = reelState(0, 5)
    // 下标 1：点它该翻过去，但对读屏是隐藏的
    expect(slots[1]).toMatchObject({ advanceOnClick: true, exposed: false })
    // 下标 2：只露一条缝，点它不该翻 —— 翻过去要点两下才够近
    expect(slots[2]).toMatchObject({ advanceOnClick: false, exposed: false })
    // 当前卡：可被读到，但点自己没有意义
    expect(slots[0]).toMatchObject({ advanceOnClick: false, exposed: true })
  })

  it('左右邻居都能点：环形轮播里"上一个"是第 5 条，不是没有', () => {
    const slots = reelState(0, 5)
    expect(slots[4].offset).toBe(-1)
    expect(slots[4].advanceOnClick).toBe(true) // 点左邻居 → 翻到第 5 条
    expect(slots[3].offset).toBe(-2)
    expect(slots[3].advanceOnClick).toBe(false)
  })

  it('★ 每一条都在返回列表里，哪怕它排在舞台外', () => {
    // 这条测试替一个真实缺陷写：第一版有 `rendered`（|offset| <= 2 才进 DOM），
    // 而首页是静态预渲染的 —— active 初值 0，左边没有卡位，于是 5 条亮点里
    // 只有 3 条出现在 HTML 里，另外两条对爬虫与禁用 JS 的人根本不存在，
    // 而页面上完全看不出来。现在这一层不再决定 DOM 里有没有这张卡。
    expect(reelState(0, 5)).toHaveLength(5)
    expect(reelState(4, 5)).toHaveLength(5)
    expect(reelState(3, 8)).toHaveLength(8)
  })

  it('reelDepth 把舞台外的卡钉在最深一档', () => {
    // 外观只有 0/1/2 三档，CSS 不必为第 3、4 张补选择器；
    // 更外面的靠 .hl 的 overflow 裁掉，不靠隐藏。
    expect(reelDepth(0)).toBe(0)
    expect(reelDepth(-1)).toBe(1)
    expect(reelDepth(2)).toBe(2)
    expect(reelDepth(-3)).toBe(2)
    expect(reelDepth(7)).toBe(2)
  })

  it('夹取下界：active 为负按 0 算，当前卡仍然是它', () => {
    const slots = reelState(-7, 5)
    expect(slots[0].isCurrent).toBe(true)
    expect(slots.map((s) => s.offset)).toEqual([0, 1, 2, -2, -1])
  })

  it('夹取上界：active 超出张数按最后一张算', () => {
    const slots = reelState(99, 5)
    expect(slots[4].isCurrent).toBe(true)
    expect(slots.map((s) => s.offset)).toEqual([1, 2, -2, -1, 0])
  })

  it('NaN 不传染：active 是 NaN 时退回 0，offset 全是有限数', () => {
    // 这条不是防御性代码 —— 上游是键盘事件与 scrollY，NaN 真的会来。
    // 一旦漏进来，它会顺着 offset 流进 transform 字符串，整排卡当场消失。
    const slots = reelState(Number.NaN, 5)
    expect(slots.every((s) => Number.isFinite(s.offset))).toBe(true)
    expect(slots[0].isCurrent).toBe(true)
  })

  it('零张卡返回空数组，不抛', () => {
    expect(reelState(0, 0)).toEqual([])
  })

  it('一张卡时它就是当前卡', () => {
    expect(reelState(0, 1)).toMatchObject([{ offset: 0, isCurrent: true, exposed: true }])
  })

  it('张数超过舞台时，多出来的钉在最深一档而不是消失', () => {
    // 以后加到 7 条亮点时不用回来改 CSS：offset 走到 ±3，
    // reelDepth 把它夹成 2，外观与"最外那两张"同档。
    expect(offsets(0, 7)).toEqual([0, 1, 2, 3, -3, -2, -1])
    expect(offsets(0, 7).map(reelDepth)).toEqual([0, 1, 2, 2, 2, 2, 1])
  })

  it('半径常量与上面的假设一致（改常量就要回来看断言）', () => {
    expect(STAGE_RADIUS).toBe(2)
    expect(CLICK_RADIUS).toBe(1)
  })
})

describe('ringOffset —— 环上的带符号最短位移', () => {
  it('五张：右边走三格等于左边走两格，取短的', () => {
    expect(ringOffset(0, 3, 5)).toBe(-2)
    expect(ringOffset(0, 2, 5)).toBe(2)
    expect(ringOffset(0, 4, 5)).toBe(-1)
    expect(ringOffset(0, 1, 5)).toBe(1)
    expect(ringOffset(0, 0, 5)).toBe(0)
  })

  it('★ 结果永远落在半圈以内（这是"两侧都填满"的根）', () => {
    for (let from = 0; from < 5; from++) {
      for (let to = 0; to < 5; to++) {
        expect(Math.abs(ringOffset(from, to, 5))).toBeLessThanOrEqual(2)
      }
    }
  })

  it('偶数张时正对面那张算在右边 —— 只要确定，不要每次不一样', () => {
    expect(ringOffset(0, 2, 4)).toBe(2)
    expect(ringOffset(0, 3, 4)).toBe(-1)
  })

  it('负数取模要修正：JS 的 % 跟着被除数符号走', () => {
    expect(-3 % 5).toBe(-3) // 不加 +count 就会算出 -3 而不是 2
    expect(ringOffset(3, 0, 5)).toBe(2)
  })

  it('零张卡返回 0，不除零', () => {
    expect(ringOffset(0, 0, 0)).toBe(0)
  })
})

describe('wrapActive —— 环形步进（键盘与自动播共用）', () => {
  it('正中间照常走', () => {
    expect(wrapActive(2, 1, 5)).toBe(3)
    expect(wrapActive(2, -1, 5)).toBe(1)
  })

  it('★ 末尾往前一步回到 0：这是轮播，走到头不会永远停在那儿', () => {
    expect(wrapActive(4, 1, 5)).toBe(0)
    expect(wrapActive(0, -1, 5)).toBe(4)
  })

  it('负数取模要修正：JS 的 % 会给出 -1', () => {
    // 这条抓的是实现里最容易漏的那个括号：`(-1 % 5)` 在 JS 里是 -1 不是 4。
    expect(-1 % 5).toBe(-1)
    expect(wrapActive(0, -1, 5)).toBe(4)
    expect(wrapActive(1, -3, 5)).toBe(3)
  })

  it('越界的起点先夹住再走，不算出 NaN 或负下标', () => {
    expect(wrapActive(99, 1, 5)).toBe(0)
    expect(wrapActive(-7, 1, 5)).toBe(1)
    expect(wrapActive(Number.NaN, 1, 5)).toBe(1) // 当作 0 起步
  })

  it('零张卡返回 0，不除零', () => {
    expect(wrapActive(0, 1, 0)).toBe(0)
  })

  it('非整数 delta 取整，不算出半个卡位', () => {
    expect(wrapActive(0, 1.7, 5)).toBe(1)
  })
})

describe('dragSteps —— 拖了多少像素该翻到第几条', () => {
  const STEP = 525

  it('往左拖 = 前进（内容跟着手走）', () => {
    expect(dragSteps(-STEP, STEP, 5)).toBe(1)
    expect(dragSteps(STEP, STEP, 5)).toBe(-1)
  })

  it('★ 过半就认，不过半弹回', () => {
    // 用 round 不是 floor：拖到 0.5 格时用户已经表达意图了，
    // 而"卡在中间不上不下"是最坏的结果。
    expect(dragSteps(-260, STEP, 5)).toBe(0) // 0.495 格 → 弹回
    expect(dragSteps(-270, STEP, 5)).toBe(1) // 0.514 格 → 认
    expect(dragSteps(-100, STEP, 5)).toBe(0) // 当成点击，不翻
  })

  it('拖满两格就是两格', () => {
    expect(dragSteps(-STEP * 2, STEP, 5)).toBe(2)
    expect(dragSteps(STEP * 2, STEP, 5)).toBe(-2)
  })

  it('★ 上限夹在半圈：环上绕两圈会落回同一处，只会让人误判', () => {
    expect(dragSteps(-STEP * 10, STEP, 5)).toBe(2) // floor(5/2)
    expect(dragSteps(STEP * 10, STEP, 5)).toBe(-2)
    expect(dragSteps(-STEP * 4, STEP, 4)).toBe(2) // 偶数张同样夹在半圈
  })

  it('量不到步长时什么都不翻，不除零', () => {
    expect(dragSteps(-900, 0, 5)).toBe(0)
    expect(dragSteps(-900, Number.NaN, 5)).toBe(0)
    expect(dragSteps(Number.NaN, STEP, 5)).toBe(0)
    expect(dragSteps(-900, STEP, 0)).toBe(0)
  })
})

describe('reelJumped —— 谁这一拍跨过了接缝（组件据此关掉它的补间）', () => {
  const at = (active: number) => offsets(active, 5)

  it('★ 前进绕回那一下：恰好一张跨界，且就是最左那张', () => {
    // active 4 → 0：下标 2 那张从 -2 跳到 +2（走了长的那条路）。
    const j = reelJumped(at(4), at(0), 5)
    expect(j.filter(Boolean)).toHaveLength(1)
    expect(j[2]).toBe(true)
  })

  it('★ 后退绕回那一下：同样恰好一张', () => {
    const j = reelJumped(at(0), at(4), 5)
    expect(j.filter(Boolean)).toHaveLength(1)
    expect(j[2]).toBe(true)
  })

  it('★ 环上**每一步**都恰好有一张跨界，不是只有绕回那一下', () => {
    // 我一开始把这条写成"普通一步不该有人跨界"——那是错的，而且错得值得留着：
    // 环上往前进一步，最左那张（-2）必然要从左边缘绕回右边缘（+2），
    // 这是环形轮播的固有形状，跟"走到第 5 条再绕回第 1 条"是同一件事。
    // 所以组件每拍都会关掉一张的补间，而不是偶尔。
    for (let active = 0; active < 4; active++) {
      const prev = at(active)
      const next = at(active + 1)
      const j = reelJumped(prev, next, 5)
      expect(j.filter(Boolean)).toHaveLength(1)
      const i = j.findIndex(Boolean)
      expect(prev[i]).toBe(-2) // 前进：从最左绕到最右
      expect(next[i]).toBe(2)
    }
    for (let active = 4; active > 0; active--) {
      const prev = at(active)
      const next = at(active - 1)
      const j = reelJumped(prev, next, 5)
      expect(j.filter(Boolean)).toHaveLength(1)
      const i = j.findIndex(Boolean)
      expect(prev[i]).toBe(2) // 后退：从最右绕到最左
      expect(next[i]).toBe(-2)
    }
  })

  it('Home / End 这种一步跨几格的大跳：仍然只有一张走的是长路', () => {
    expect(reelJumped(at(0), at(4), 5).filter(Boolean)).toHaveLength(1)
    expect(reelJumped(at(4), at(0), 5).filter(Boolean)).toHaveLength(1)
  })

  it('首帧没有"上一次"，一律不算跨界', () => {
    expect(reelJumped([], at(0), 5)).toEqual([false, false, false, false, false])
  })

  it('位置没变时不报跨界（自动播被暂停后又恢复的那一帧）', () => {
    expect(reelJumped(at(2), at(2), 5).some(Boolean)).toBe(false)
  })

  it('七张时接缝在 ±3 那对卡之间', () => {
    const o = (a: number) => offsets(a, 7)
    const j = reelJumped(o(6), o(0), 7)
    expect(j.filter(Boolean)).toHaveLength(1)
    // 跨界的是原来在最左（-3）那张，它绕到了最右（+3）
    expect(j.findIndex((x) => x)).toBe(o(0).findIndex((x) => x === 3))
  })
})
