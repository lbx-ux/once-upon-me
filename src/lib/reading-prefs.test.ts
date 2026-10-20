/**
 * reading-prefs.test.ts —— 阅读偏好里纯的那半：存储里那串字怎么读
 *
 * 不测 `load/save`：vitest 是 `environment: 'node'`（理由写在 vitest.config.ts，
 *   "浏览器事实用 preview 实测"），这里没有 `localStorage`。丢进这个文件的断言
 *   只该管一件事——认不出来的值会退到哪一边，而那正是一个睡着了的孩子会被吵醒的地方。
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TURN_MODE,
  SHARED_TURN_MODE_KEY,
  TURN_MODE_KEY,
  parseTurnMode,
} from './reading-prefs.ts'

describe('parseTurnMode · 认不出来的值退到哪一边', () => {
  it('只有 auto 这一个字面量能打开自动朗读', () => {
    expect(parseTurnMode('auto')).toBe('auto')
    expect(parseTurnMode('manual')).toBe('manual')
  })

  it('★ 没设置过 = 手动（默认值就是"这一版之前唯一的行为"）', () => {
    expect(parseTurnMode(null)).toBe(DEFAULT_TURN_MODE)
    expect(DEFAULT_TURN_MODE).toBe('manual')
  })

  it('★ 一切不认识的值都退到手动，不是"猜一个"', () => {
    // 存储里的东西不一定是自己写的：上一版的格式、手改过的、只剩半截的
    for (const junk of ['', 'Auto', 'AUTO', 'on', 'true', '1', '{"mode":"auto"}', 'auto ']) {
      expect(parseTurnMode(junk)).toBe('manual')
    }
  })
})

describe('两个键：独读版与共读版各一份（2026-10-20）', () => {
  it('★ 是两个键 —— 同一个键会让两节设置变成同一个开关', () => {
    expect(SHARED_TURN_MODE_KEY).not.toBe(TURN_MODE_KEY)
  })

  it('★ 老键**不许改名** —— 改名等于把所有已经选过的人的偏好静默退回默认', () => {
    // 想把它"整理"成 `xiaozhujue.reader.turn.solo` 的话，读完这条再决定：
    // 省下的是键名好看，付出的是"我明明设过自动朗读"变成没人查得出来的坏法
    expect(TURN_MODE_KEY).toBe('xiaozhujue.reader.turn')
    expect(SHARED_TURN_MODE_KEY).toBe('xiaozhujue.reader.turn.shared')
  })
})
