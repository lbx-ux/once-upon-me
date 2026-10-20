/**
 * rotate-hint.test.ts —— 「横过来」提示里纯的那半：存储里那串字怎么读
 *
 * 不测 `load/save`：vitest 是 `environment: 'node'`（理由写在 vitest.config.ts，
 *   "浏览器事实用 preview 实测"），这里没有 `localStorage`。丢进这个文件的断言
 *   只该管一件事——认不出来的值会退到哪一边。
 *   而它比 `reading-prefs` 那一条更要紧：那边猜错是"书半夜自己念起来"，
 *   这边猜错是有人永远看不到那个提示，而他不知道自己在找什么。
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_ROTATE_HINT, parseRotateHint } from './rotate-hint.ts'

describe('parseRotateHint · 认不出来的值退到哪一边', () => {
  it('只有 off 这一个字面量能关掉提示', () => {
    expect(parseRotateHint('off')).toBe('off')
    expect(parseRotateHint('ask')).toBe('ask')
  })

  it('★ 没设置过 = 继续问（默认值就是"这一版之前的行为"）', () => {
    expect(parseRotateHint(null)).toBe(DEFAULT_ROTATE_HINT)
    expect(DEFAULT_ROTATE_HINT).toBe('ask')
  })

  it('★ 一切不认识的值都退到"继续问"，不是"猜一个"', () => {
    // 存储里的东西不一定是自己写的：上一版的格式、手改过的、只剩半截的
    for (const junk of ['', 'Off', 'OFF', 'no', 'false', '0', '{"hint":"off"}', 'off ']) {
      expect(parseRotateHint(junk)).toBe('ask')
    }
  })
})
