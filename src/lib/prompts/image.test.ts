/**
 * image.test.ts —— 页图与封面的**形状**契约
 *
 * ★ 这一组盯着的是 2026-10-15 那次返工：整本书出图尺寸是 1440×1440 方形，
 *   而跨页构图（`COMPOSITION_BLOCK` 写的是"主体偏右、左下留出可叠字区"）本来就是按 3:2 写的，
 *   方图裁成 3:2 等于**先按方构图再切掉两端**，留出的那块会被切走或位移。
 *   封面的 3:4 同理。
 *
 * 所以这里钉两件事：
 * 1. **比例**，不是具体像素——写死 `1536x1024` 会在换模型时变成绊脚石，
 *    但"必须是 3:2"是产品定义（跨页的形状），它不该被顺手改掉。
 * 2. **画面里不许出现书名**：封面 prompt 必须明确说这句话。
 *    `docs/cover-art-prompts.md` 记过教训——中文进图必然错字/缺笔/乱码。
 */

import { describe, expect, it } from 'vitest'

import {
  COVER_IMAGE_SIZE,
  DEFAULT_IMAGE_SIZE,
  IMAGE_PROMPT_VERSION,
  coverPrompt,
  pagePrompt,
} from './image.ts'
import type { CharacterCard } from '../engine/domain.ts'
import { SIZES_BY_MODEL } from '../engine/providers/tokenrhythm-image.ts'

/** 一个够用的假卡：只用到 anchors/style/revision 这几处 */
const card: CharacterCard = {
  cardId: 'test-card',
  childId: 'kid',
  revision: 1,
  anchors: [
    { slot: 'bone', value: '圆脸' },
    { slot: 'hair', value: '左上方翘一撮' },
  ],
  style: { key: 'warm-handdrawn', promptFragment: '温暖手绘水彩绘本插画', ratio: '3:2' },
  reference: { path: 'cards/test/ref.png', digest: 'abc', bytes: 3, mime: 'image/png' },
  digest: 'deadbeef',
  createdAt: 0,
} as unknown as CharacterCard

function ratioOf(size: string): number {
  const [w, h] = size.split('x').map(Number)
  return (w as number) / (h as number)
}

describe('出图尺寸的比例（这是产品定义，不是随手填的数）', () => {
  it('页图是 3:2 横版', () => {
    expect(ratioOf(DEFAULT_IMAGE_SIZE)).toBeCloseTo(1.5, 3)
  })

  it('封面是 3:4 竖版（与首页演示书 cover.webp 848×1130 同比例）', () => {
    expect(ratioOf(COVER_IMAGE_SIZE)).toBeCloseTo(0.75, 3)
  })

  it('页图与封面不是同一个尺寸——一份尺寸同时管两种形状是不可能的', () => {
    expect(DEFAULT_IMAGE_SIZE).not.toBe(COVER_IMAGE_SIZE)
  })

  /**
   * ★ 这一条是花了一次真跑换来的：我把尺寸改成 3:2 之后直接开跑，
   *   三页全被适配器**在发请求前**退回（"不在实测白名单里"）——一分钱没花，
   *   但整本书没出成。**改产品尺寸却忘了扩供应商白名单**，症状就是这样。
   *   探针当时能过，是因为它绕开了适配器直接打接口。
   *   所以"两个常量都在白名单里"必须有一条断言，而不是靠人记得。
   */
  it('★ 产品要用的两个尺寸都在供应商白名单里（改尺寸忘了扩白名单，这条会红）', () => {
    const allowed: readonly string[] = SIZES_BY_MODEL['wan2.7-image'] ?? []
    expect(allowed).toContain(DEFAULT_IMAGE_SIZE)
    expect(allowed).toContain(COVER_IMAGE_SIZE)
  })
})

describe('页图的 prompt 仍然是按跨页写的', () => {
  const prompt = pagePrompt({ card, page: '坐在云上', scene: '云像棉花糖', mood: 'wonder' })

  it('带上"左下留出可叠字区"那条构图约束', () => {
    expect(prompt).toContain('左下方')
  })

  it('不许把页级描述写成长相（长相只从角色卡派生）', () => {
    expect(prompt).toContain('温暖手绘水彩绘本插画')
    expect(prompt).toContain('坐在云上')
  })
})

describe('封面的 prompt', () => {
  const prompt = coverPrompt({ card, title: '云朵小船去旅行' })

  it('★ 明确要求"不要把书名画进画面"', () => {
    // 这句话丢了，症状是图上出现错字书名——而它看着像"模型不行"，不像提示词少了约束
    expect(prompt).toContain('不要把书名画进画面')
    expect(prompt).toContain('云朵小船去旅行')
  })

  it('仍然是同一条角色段（封面与内页必须是同一个孩子）', () => {
    expect(prompt).toContain('温暖手绘水彩绘本插画')
    expect(prompt).toContain('左上方翘一撮')
  })

  it('带上负极清单——只写"不要什么"会失效，这条在别的文件里也记过', () => {
    expect(prompt).toContain('避免出现：任何文字')
    expect(prompt).toContain('应当出现的是')
  })

  it('promptVersion 与页图同源（同一个出图管线，不是第二条流水线）', () => {
    expect(IMAGE_PROMPT_VERSION).toBe('image-page@v1')
  })
})
