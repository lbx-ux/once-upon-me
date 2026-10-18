import { describe, expect, it } from 'vitest'
import type { NodeDraft } from '../schemas/story.ts'
import { buildTree, linearOrder, pathOf } from './tree.ts'

/** 造一页。四个必填字段给足，剩下的按调用方覆盖 */
function page(overrides: Partial<NodeDraft> = {}): NodeDraft {
  return {
    scene: '草地上，小宇抬头看云',
    body: ['云变成了一条恐龙的背。'],
    imagePrompt: '午后草地，孩子仰头，远处一朵长背脊的云',
    mood: 'wonder',
    ...overrides,
  }
}

/** 选择点那一页多出来的九格。★ 线格式是**平铺**的（见 `schemas/story.ts` 那段 ★★），
 *  所以这里也是一个平铺对象，直接摊进 `page()`，不再包一层 `choice` */
const CHOICE: Partial<NodeDraft> = {
  ask: '你觉得他该上哪一朵云？为什么？',
  labelA: '恐龙背',
  spokenA: '爬上恐龙的背',
  iconA: 'dino',
  emojiA: '🦕',
  labelB: '船肚子',
  spokenB: '钻进船的肚子',
  iconB: 'ship',
  emojiB: '⛵',
}

describe('buildTree · 独读版', () => {
  it('不填 from 就是线性：路径按页号排', () => {
    const result = buildTree('solo', '小宇的云', [page(), page(), page(), page()])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tree.nodes.map((n) => n.pathFromRoot)).toEqual([
      ['n1'],
      ['n1', 'n2'],
      ['n1', 'n2', 'n3'],
      ['n1', 'n2', 'n3', 'n4'],
    ])
  })

  it('独读版出现 choice 被拒（睡前越选越兴奋，这条是产品判据不是格式偏好）', () => {
    const result = buildTree('solo', 't', [page(CHOICE), page(), page()])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((p) => p.message).join('')).toContain('独读版')
  })
})

describe('buildTree · 共读版', () => {
  it('选择点分两条，next 顺序 = 选项顺序（点"恐龙"却走到"船"是最难查的错）', () => {
    const result = buildTree('shared', '小宇的云', [
      page(),
      page(CHOICE),
      page({ from: 2, via: 'a', scene: '骑上恐龙背' }),
      page({ from: 2, via: 'b', scene: '钻进船肚子' }),
      page({ from: 4 }),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const choiceNode = result.tree.nodes[1]
    expect(choiceNode?.next).toEqual(['n3', 'n4'])
    expect(pathOf(result.tree, 'n4').map((n) => n.nodeId)).toEqual(['n1', 'n2', 'n4'])
  })

  it('via 写反了也能纠正顺序：a 永远排在前', () => {
    const result = buildTree('shared', 't', [
      page(),
      page(CHOICE),
      page({ from: 2, via: 'b' }),
      page({ from: 2, via: 'a' }),
    ])
    if (!result.ok) throw new Error('应当通过')
    expect(result.tree.nodes[1]?.next).toEqual(['n4', 'n3'])
  })

  it('选择点只有一条分支被拒', () => {
    const result = buildTree('shared', 't', [page(), page(CHOICE), page({ from: 2, via: 'a' })])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((p) => p.message).join('')).toContain('必须是 2 条')
  })

  it('共读版一个选择点都没有 → 那是独读版，报错而不是默默当它通过', () => {
    const result = buildTree('shared', 't', [page(), page(), page()])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0]?.message).toContain('独读版')
  })

  /* ── 2026-10-18 共读版收窄成一档之后新加的三条 ───────────────────────────── */

  it('两个选择点被拒：多出来的那条岔路会把其中一支截断', () => {
    const result = buildTree('shared', 't', [
      page(), // n1
      page(CHOICE), // n2 ← 第一个选择点
      page({ from: 2, via: 'a' }), // n3
      page({ from: 2, via: 'b' }), // n4
      page({ from: 3, ...CHOICE }), // n5 ← 第二个选择点
      page({ from: 5, via: 'a' }),
      page({ from: 5, via: 'b' }),
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    const said = result.problems.map((p) => p.message).join('')
    expect(said).toContain('只支持一个选择点')
    // 报的是**整篇**的问题（index 0），并点名是哪几页——家长/模型要知道改哪里
    expect(result.problems.some((p) => p.index === 0 && p.message.includes('第 2、5 页'))).toBe(
      true,
    )
  })

  it('两支页数差超过 1 页被拒（一边的孩子读到的东西明显更少，而书上不提示）', () => {
    const result = buildTree('shared', 't', [
      page(), // n1
      page(CHOICE), // n2
      page({ from: 2, via: 'a' }), // n3  ← a 支只有这 1 页
      page({ from: 2, via: 'b' }), // n4
      page({ from: 4 }), // n5
      page({ from: 5 }), // n6  ← b 支 3 页
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((p) => p.message).join('')).toContain('页数差太多')
  })

  it('差 1 页是允许的（一支 2 页、一支 1 页）—— 判据是"差太多"，不是"必须一样长"', () => {
    const result = buildTree('shared', 't', [
      page(), // n1
      page(CHOICE), // n2
      page({ from: 2, via: 'a' }), // n3
      page({ from: 3 }), // n4  ← a 支 2 页
      page({ from: 2, via: 'b' }), // n5  ← b 支 1 页
    ])
    if (!result.ok) {
      throw new Error(`应当通过：${result.problems.map((p) => p.message).join('；')}`)
    }
    expect(result.tree.nodes[1]?.next).toEqual(['n3', 'n5'])
  })
})

describe('buildTree · 结构完整性', () => {
  it('向前引用被拒（于是环在定义上不可能出现）', () => {
    const result = buildTree('solo', 't', [page(), page({ from: 4 }), page()])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems[0]?.message).toContain('不合法')
  })

  it('第一页不许有父节点', () => {
    const result = buildTree('solo', 't', [page({ from: 1 }), page()])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((p) => p.message).join('')).toContain('第一页')
  })

  it('所有问题一次全报，不是遇一个就返回 —— 重试提示要整份清单', () => {
    const result = buildTree('solo', 't', [page(), page({ from: 9 }), page({ from: 9 })])
    if (result.ok) throw new Error('应当失败')
    expect(result.problems.length).toBeGreaterThan(1)
  })

  it('mood 不在枚举里会被夹成 calm 并报告（不让一个错别字毁掉整本书）', () => {
    const result = buildTree('solo', 't', [page({ mood: 'happy' }), page(), page()])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.map((p) => p.message).join('')).toContain('不在枚举')
  })
})

describe('线性读法', () => {
  it('linearOrder 与 pageNo 一致，与数组顺序无关', () => {
    const result = buildTree('shared', 't', [
      page(),
      page(CHOICE),
      page({ from: 2, via: 'a' }),
      page({ from: 2, via: 'b' }),
    ])
    if (!result.ok) throw new Error('应当通过')
    const shuffled = [...result.tree.nodes].reverse()
    expect(linearOrder({ ...result.tree, nodes: shuffled }).map((n) => n.pageNo)).toEqual([
      1, 2, 3, 4,
    ])
  })
})
