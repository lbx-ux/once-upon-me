/**
 * phase.test.ts —— 「该落在哪一屏」那几条判据
 *
 * ★ 这一组用例是补票的：那两条 bug 都是用户先撞上才被发现，而它们本来
 *   都能在这一层被钉住（两次的原因见 `phase.ts` 文件头）。
 *   最要紧的两条是「故事在手 + 正在跑 → 运行视图」与「一边跑一边重放」那一格。
 */

import { describe, expect, it } from 'vitest'

import { entryPhaseOf } from './phase.ts'

describe('从书架点进来该落哪一屏', () => {
  it('★ 故事在手、服务器上正在画 → 进运行视图（用户实测报的那条 bug）', () => {
    // 这一格原来落的是 `'story'`（闸门）：看不到进度，点画只收到 409
    expect(entryPhaseOf({ hasStory: true, status: { running: true, bookReady: false } })).toBe(
      'replaying',
    )
  })

  it('故事在手、没在跑 → 闸门（这一屏的正文来自 story.json）', () => {
    expect(entryPhaseOf({ hasStory: true, status: { running: false, bookReady: false } })).toBe(
      'story',
    )
    // 读不回日志也一样：故事在手就还能改、还能画（那一支的 catch 故意是空的）
    expect(entryPhaseOf({ hasStory: true, status: undefined })).toBe('story')
  })

  it('画完了的那一本 → 成品那一屏（哪怕盘上还留着一份故事草稿）', () => {
    // `story.json` 在装订之后不删，所以这一格真会发生：
    //   判据顺序错了就会把一本画好的书送回闸门
    expect(entryPhaseOf({ hasStory: true, status: { running: false, bookReady: true } })).toBe(
      'ready',
    )
    expect(entryPhaseOf({ hasStory: false, status: { running: false, bookReady: true } })).toBe(
      'ready',
    )
  })

  it('没有故事的那一本：在跑 → 运行视图；跑完了没画完 → 说清这一轮没成', () => {
    expect(entryPhaseOf({ hasStory: false, status: { running: true, bookReady: false } })).toBe(
      'replaying',
    )
    expect(entryPhaseOf({ hasStory: false, status: { running: false, bookReady: false } })).toBe(
      'failed',
    )
    // 读不回日志：没有故事可依靠，只能说这一轮没了（`GenerationRun` 那边会补一句 fatal）
    expect(entryPhaseOf({ hasStory: false, status: undefined })).toBe('failed')
  })
})
