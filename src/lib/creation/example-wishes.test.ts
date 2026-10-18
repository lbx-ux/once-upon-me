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

import { THEME_KEYS, THEMES, themeCardPath } from '../themes.ts'
import { EXAMPLE_WISHES, missingThemes, ofTheme } from './example-wishes.ts'

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

describe('主题墙', () => {
  it('主题墙一格一条：12 个主题都查得回自己那句', () => {
    // ★ 这条钉的是"墙上的每一格按下去都有反应"。查不回来就是一格点了不填字的死卡
    for (const theme of THEMES) {
      const item = ofTheme(theme.key)
      expect(item, `${theme.key} 没有例句，那一格按下去填不出东西`).not.toBeNull()
      expect(item?.text.trim().length).toBeGreaterThan(0)
    }
  })

  it('派生小图的路径由 key 决定（文件名对不上就是一张裂图）', () => {
    for (const theme of THEMES) {
      expect(themeCardPath(theme.key)).toBe(`/art-cards/${theme.key}.webp`)
    }
  })
})
