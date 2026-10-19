/**
 * style.test.ts —— 画风那三个字与画风那段话必须说的是同一件事
 *
 * ★ 为什么值得单独立一个文件：这一处漂移是**静默**的。
 *   改提示词的人把"水彩铺色"换成"厚涂"，界面上那句"水彩"不会报错、不会变红，
 *   只会让家长看到的说明与拿到的书对不上——而这是这个项目最贵的一类错
 *   （docs/known-tradeoffs.md：说出来的与做出来的不一致）。
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_STYLE_FRAGMENT, DEFAULT_STYLE_LABEL } from './character-sheet.ts'

describe('画风标签', () => {
  it('界面上那个词真的出现在提示词里（改了提示词忘了改标签会红在这里）', () => {
    expect(DEFAULT_STYLE_FRAGMENT).toContain(DEFAULT_STYLE_LABEL)
  })

  it('标签短到能塞进一颗胶囊（它出现在输入框上方那一行）', () => {
    expect(DEFAULT_STYLE_LABEL.length).toBeLessThanOrEqual(4)
  })
})
