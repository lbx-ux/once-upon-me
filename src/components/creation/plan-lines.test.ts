/**
 * plan-lines.test.ts —— 「正在编故事」那一段的两句纪律
 *
 * 钉住的是两件会被后人顺手破坏、而屏幕上不会当场显形的事：
 *   ① 轮播那几句里不许出现数字、百分号、页码——它们要在**第一段增量到达之前**
 *      就说话，那一刻我们没有任何进度可报，写了就是编
 *      （docs/known-tradeoffs.md 那条："编出来的东西比没有更糟"）；
 *   ② 四句话都要说得出"这件活在做什么"，不能退化成第二句"正在编故事"。
 *      那种退化在屏幕上不显形（轮播照转），但它把这一处改动的理由整个抹掉了。
 *
 * ★ 2026-10-21（工单 D-04）多了第三条，它是这一组用例现在最该守的：
 *   **真进度那一句（`writingLineOf`）里的两个数都不许是它自己编的**——
 *   `k` 只许来自 `readPlanProgress` 数出来的闭合页数，`N` 只许来自请求。
 *   没有 `N` 时它**不许拿 k 当中分母**：那一种读起来像进度条卡在 100%，
 *   而它防的正是"把 1 页的书说成 1 / 1 页"这种假话。
 */

import { describe, expect, it } from 'vitest'

import { PLAN_LINES, writingLineOf } from './plan-lines.ts'

describe('编故事那一段轮播的话', () => {
  it('★ 一句都不许带数字、百分号、页码（这一趟没有进度可报）', () => {
    for (const line of PLAN_LINES) {
      expect(line).not.toMatch(/[0-9%]/)
      expect(line).not.toMatch(/第\s*.+页/)
      expect(line).not.toMatch(/还剩|剩余|马上|秒/)
    }
  })

  it('四句各不相同，而且不是同一句换皮（每句都说了"在做哪一件事"）', () => {
    expect(new Set(PLAN_LINES).size).toBe(PLAN_LINES.length)
    expect(PLAN_LINES.length).toBeGreaterThanOrEqual(3)
    for (const line of PLAN_LINES) {
      expect(line.trim().length).toBeGreaterThan(4)
      expect(line.startsWith('正在') || line.startsWith('还在')).toBe(true)
    }
  })
})

describe('真的在写的时候那一句（2026-10-21 晚：不再报页数）', () => {
  it('已经写出东西了 → 「正在思考中」', () => {
    expect(writingLineOf({ pages: 1 })).toBe('正在思考中')
    expect(writingLineOf({ pages: 12 })).toBe('正在思考中')
  })

  it('★ 一个数都不许有（"已写 12 / 8 页"那件事的教训）', () => {
    // 分子是表里节点数、分母是请求页数，共读版两者不是一个单位；而且那个数说的是
    //   "模型写了几个 JSON 对象"，不是家长关心的"故事到哪儿了"
    for (const pages of [1, 4, 12, 21]) {
      expect(writingLineOf({ pages })).not.toMatch(/\d/)
    }
  })

  it('一段都还没写出来就不说话（轮播那一句正在说）', () => {
    expect(writingLineOf({ pages: 0 })).toBeNull()
  })
})
