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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

/**
 * ★ 家长手输的两格：数据 / 指令分界（2026-10-20 补的判据）。
 *
 * 这一份提示词里有两处字是**家长打进来的**：首行那个名字，以及"想改哪里"那一句。
 * 它们进的是**图像**模型，而图像那条路上没有"内容对不对"的判据可回头查
 * ——事后只有那一档**不可复现**的画面审核。所以边界靠两件事划：
 *
 * 1. **引号 + 标记**：`「…」` 划出"这是被引用的字"，`家长原话` 说明它是谁说的。
 *    与 `story-plan.ts` 那三格同一个手法（那边的判据在 `story-plan.test.ts`）。
 * 2. **内容闸**：`cards/revise` 那条路 2026-10-20 起先跑 `reviewInput`，命中红线
 *    **拒发**。这一条是护栏（源码级），不是证明——理由与 `photo-card.test.ts`
 *    最后那一组相同：真正的证明在路由里，而路由要一个登录态才打得动。
 */
describe('家长手输的两格：数据 / 指令分界', () => {
  it('名字包进「」（它是家长填的，而三份模板共用这一行）', () => {
    expect(characterSheetPrompt(BASE)).toContain('「小宇」')
  })

  it('★ 没有名字时不留一对空引号——`「」` 在模型眼里是一个"空的名字"', () => {
    expect(characterSheetPrompt({ ...BASE, name: '' })).not.toContain('「」')
  })

  it('★ "想改哪里"那一句包进「」并标上`家长原话`', () => {
    const prompt = characterSheetPrompt({ ...BASE, revisionNote: '头发短一点，别改别的' })
    expect(prompt).toContain('家长原话：「头发短一点，别改别的」')
  })

  it('★ 不传那一格时标记不出现（不是恒真）', () => {
    expect(characterSheetPrompt(BASE)).not.toContain('家长原话')
  })

  it('三份模板的首行是同一行，所以名字那一处只有一个家', () => {
    const photo = characterSheetPrompt({ ...BASE, fromPhoto: true })
    expect(photo).toContain('「小宇」')
    expect(photo).toContain(characterSheetPrompt(BASE).split('\n')[0])
  })
})

describe('★ `想改哪里`那一格过了内容闸（grep 证据）', () => {
  /**
   * ★ 这一格原来**两道文字闸都不经过**：它不写进故事（躲过 `reviewStory`），
   *   也不是开书时的表单（躲过规划前那道 `reviewInput`）。补上之前，一句
   *   "改成脸上有血"在这条路上没有任何东西拦得住。
   * ★ 判据只看**代码**、不看注释，理由与 `photo-card.test.ts` 那一组相同：
   *   上面这段说明里就写着 `reviewInput` 四个字，连注释一起搜会恒真。
   */
  const code = readFileSync(
    fileURLToPath(new URL('../../app/api/cards/revise/route.ts', import.meta.url)),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

  it('路由先跑 `reviewInput`，命中就拒发', () => {
    expect(code).toMatch(/reviewInput\(/)
    expect(code).toMatch(/verdict !== 'pass'/)
  })
})
