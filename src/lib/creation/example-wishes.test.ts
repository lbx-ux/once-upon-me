/**
 * example-wishes.test.ts —— 那几句示例愿望的**结构性**约束
 *
 * ★ 为什么值得为一张"文案表"写测试：它有两处会静默坏掉——
 *   1. `theme` 写错一个字母，`initialThemeKey` 找不到就不选主题，
 *      于是"点了月亮那句、进去主题却不是月亮"，界面上没有任何异常；
 *   2. `themes.ts` 加了第 13 个主题忘了配例句，那一格在建议里永远缺席。
 *   这两条都不是审美判断，是能断言的事实。
 */

import { describe, expect, it } from 'vitest'

import { THEME_KEYS, THEMES } from '../themes.ts'
import {
  EXAMPLE_WISHES,
  missingThemes,
  nextExample,
  ofTheme,
  suggestions,
} from './example-wishes.ts'

describe('示例愿望表', () => {
  it('每一条的 theme 都是真实存在的主题键', () => {
    const keys = new Set<string>(THEME_KEYS)
    for (const item of EXAMPLE_WISHES) {
      expect(keys.has(item.theme), `${item.text} 的 theme=${item.theme} 不在 THEME_KEYS 里`).toBe(
        true,
      )
    }
  })

  it('十二个主题各有一句（新增主题忘了配例句会红在这里）', () => {
    expect(missingThemes()).toEqual([])
    expect(EXAMPLE_WISHES).toHaveLength(THEMES.length)
  })

  it('句子非空且不重复（重复的建议卡看起来像坏了）', () => {
    const texts = EXAMPLE_WISHES.map((item) => item.text)
    for (const text of texts) expect(text.trim().length).toBeGreaterThan(0)
    expect(new Set(texts).size).toBe(texts.length)
  })
})

describe('建议卡与灵感按钮', () => {
  it('建议卡三条，主题互不相同，且每条都查得回来', () => {
    const items = suggestions()
    expect(items).toHaveLength(3)
    expect(new Set(items.map((item) => item.theme)).size).toBe(3)
    for (const item of items) expect(ofTheme(item.theme)?.text).toBe(item.text)
  })

  it('灵感按钮是循环不是随机：连着按不会撞到同一条，转一圈回到起点', () => {
    const first = nextExample(0)
    expect(nextExample(1).text).not.toBe(first.text)
    expect(nextExample(EXAMPLE_WISHES.length)).toEqual(first)
    // 负数索引（客户端状态被清过）也要落在表内，而不是 undefined
    expect(nextExample(-1)).toEqual(EXAMPLE_WISHES[EXAMPLE_WISHES.length - 1])
  })
})
