/**
 * story-shape.test.ts —— 闸门那一行数字（工单 05 §二）
 *
 * 这一屏整个存在的理由是钱还没花，所以"读下来多长 / 一共要画多少页"这两个数
 * 必须与引擎里那棵树对得上。这里钉三件事：
 *
 * 1. 独读版两个数相等 → 那一行不出现（说两遍是噪音）；
 * 2. 共读版两个数不等 → 路长是一个区间（两支差 1 页是常态）、画的是全表节点数；
 * 3. 树建不起来（这一版有错）→ `null`，那一屏交给问题清单说话。
 */

import { describe, expect, it } from 'vitest'

import type { NodeDraft } from './schemas/story.ts'
import { shapeLineOf, storyShapeOf } from './story-shape.ts'

function page(overrides: Partial<NodeDraft> = {}): NodeDraft {
  return {
    scene: '草地上，小宇抬头看云',
    body: ['云变成了一条恐龙的背。'],
    imagePrompt: '午后草地，孩子仰头，远处一朵长背脊的云',
    mood: 'wonder',
    ...overrides,
  }
}

/** 共读版：主干 1、2，选择点 2，a 支第 3 页收尾、b 支第 4–5 页 */
const SHARED: NodeDraft[] = [
  page(),
  page({
    ask: '你觉得他该上哪一朵云？为什么？',
    labelA: '恐龙背',
    spokenA: '爬上恐龙的背',
    iconA: 'dino',
    emojiA: '🦕',
    labelB: '船肚子',
    spokenB: '钻进船的肚子',
    iconB: 'ship',
    emojiB: '⛵',
  }),
  page({ from: 2, via: 'a' }),
  page({ from: 2, via: 'b' }),
  page({ from: 4 }),
]

describe('storyShapeOf', () => {
  it('独读版：路长 = 要画的页数，那一行数字因此是 null', () => {
    const shape = storyShapeOf('solo', { title: 't', nodes: [page(), page(), page(), page()] })
    expect(shape).not.toBeNull()
    expect(shape?.pathPages).toEqual([4])
    expect(shape?.drawPages).toBe(4)
    expect(shapeLineOf(shape!)).toBeNull()
  })

  it('★ 共读版：路长是一个区间、画的是全表节点数（含走不到的那一支）', () => {
    const shape = storyShapeOf('shared', { title: '小宇的云', nodes: SHARED })
    expect(shape?.pathPages).toEqual([3, 4])
    expect(shape?.drawPages).toBe(5)
    expect(shapeLineOf(shape!)).toBe('读下来 3–4 页，一共要画 5 页的图（含走不到的那一支）')
  })

  it('两支一样长时只说一个数（不是"4–4 页"）', () => {
    const shape = storyShapeOf('shared', {
      title: '小宇的云',
      nodes: [
        page(),
        page({ ...SHARED[1]! }),
        page({ from: 2, via: 'a' }),
        page({ from: 2, via: 'b' }),
      ],
    })
    expect(shape?.pathPages).toEqual([3])
    expect(shapeLineOf(shape!)).toBe('读下来 3 页，一共要画 4 页的图（含走不到的那一支）')
  })

  it('★ 树建不起来时是 null：那一屏有问题清单在说话，不摆一个"要画几页"', () => {
    // 共读版一个选择点都没有
    expect(storyShapeOf('shared', { title: 't', nodes: [page(), page(), page()] })).toBeNull()
    // 独读版里出现了选择点
    expect(storyShapeOf('solo', { title: 't', nodes: SHARED })).toBeNull()
  })
})
