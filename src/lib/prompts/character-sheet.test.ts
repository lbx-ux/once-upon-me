/**
 * character-sheet.test.ts —— 角色标准像那份提示词里**两处不许悄悄变回去**的东西
 *
 * ★ 单独立一个文件，理由与 `style.test.ts` 同源：这两条都是**静默**漂移。
 *   背景那句被改回暖米色、或者版本号被三份抄成同一个，
 *   代码不报错、类型不报错、界面也不报错——只有卡片墙上会多出一张米色的卡，
 *   而"这张图是哪份提示词出的"从此答不上来。
 *
 * ★ 背景这一条是用户看出来的（2026-10-16 第 21 刀："生成的人物也要是白底的"）：
 *   卡面上那三张，演示卡是白底、现场生成的是暖米色。改之前量过：
 *   `#F2E1CC`（角上通道极差 38），演示卡是 `#FFFFFF`（极差 0）。
 *   量法与之后的读数在 `scripts/probe-portrait-background.mts`。
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_ANCHORS } from '@/lib/creation/default-anchors.ts'
import {
  CHARACTER_PHOTO_VERSION,
  CHARACTER_REVISE_VERSION,
  CHARACTER_SHEET_VERSION,
  characterSheetPrompt,
} from './character-sheet.ts'

const BASE = {
  name: '小宇',
  childWord: '小男孩',
  ageLabel: '四五岁左右',
  anchors: DEFAULT_ANCHORS,
}

describe('角色标准像的底', () => {
  it('背景那一段说的是纯白，而不是暖米色（用户划出来的那条）', () => {
    const prompt = characterSheetPrompt(BASE)
    expect(prompt).toContain('#FFFFFF')
    expect(prompt).not.toContain('暖米色')
  })

  it('★ 反着说的那句也在：模型实测会给纸染上一层暖白，光说"纯白"挡不住', () => {
    const prompt = characterSheetPrompt(BASE)
    // 实测（`scripts/probe-portrait-background.mts`）：只写"纯白 #FFFFFF 单一平涂"时，
    // `wan2.7-image` 回的是 #F7F7F3（角上最小通道 243）。补上这一句之后方向没变坏，
    // 但也没到 255——那是**模型的天花板**，不是这句话没用（见工单 03 第 21 刀）。
    expect(prompt).toContain('也不要给背景染上米黄或灰色')
  })

  it('照片那条路共用同一段【构图】，所以底也一样（三份提示词不许在这里分家）', () => {
    const fromPhoto = characterSheetPrompt({ ...BASE, fromPhoto: true })
    expect(fromPhoto).toContain('#FFFFFF')
    expect(fromPhoto).not.toContain('暖米色')
  })
})

describe('三个版本号', () => {
  it('互不相同——provenance 的全部用处就是分清"哪张图是哪份提示词出的"', () => {
    const all = [CHARACTER_SHEET_VERSION, CHARACTER_REVISE_VERSION, CHARACTER_PHOTO_VERSION]
    expect(new Set(all).size).toBe(3)
  })

  it('★ 都带版本后缀，别写成一个不会涨的名字（涨的那次是背景改白底）', () => {
    for (const version of [
      CHARACTER_SHEET_VERSION,
      CHARACTER_REVISE_VERSION,
      CHARACTER_PHOTO_VERSION,
    ]) {
      expect(version).toMatch(/^character-(sheet|revise|photo)@v\d+$/)
    }
  })
})
