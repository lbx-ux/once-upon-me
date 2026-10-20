import { describe, expect, it } from 'vitest'
import type { NodeDraft } from '../schemas/story.ts'
import {
  branchLabelsOf,
  branchPagesOf,
  buildTree,
  isChoicePage,
  linearOrder,
  pathLengthsOf,
  pathOf,
} from './tree.ts'

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

/** 选择点那一页多出来的九格。★ 线格式是平铺的（见 `schemas/story.ts` 那段 ★★），
 *  所以这里也是一个平铺对象，直接摊进 `page()`，不再包一层 `choice`
 */
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

  /* 2026-10-18 共读版收窄成一档之后新加的三条 */

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
    // 报的是整篇的问题（index 0），并点名是哪几页——家长/模型要知道改哪里
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

describe('两条支与路长（工单 05）', () => {
  /**
   * 这个形状是刻意摆的，它让"按平铺顺序猜"与"按路算"给出不同的答案：
   *   a 支那一页（第 3 页）排在 b 支那几页（第 4、5 页）前面，
   *   但 b 支更长。所以下面每条判据都同时钉住"是哪一支"与"不是靠位置猜的"。
   */
  function sharedTree() {
    const result = buildTree('shared', '小宇的云', [
      page(),
      page(CHOICE),
      page({ from: 2, via: 'a' }),
      page({ from: 2, via: 'b' }),
      page({ from: 4 }),
    ])
    if (!result.ok) throw new Error('应当通过')
    return result.tree
  }

  it('branchPagesOf：按"从根走过来的路经不经过哪个孩子"分，不按平铺顺序', () => {
    expect(branchPagesOf(sharedTree())).toEqual({ a: [3], b: [4, 5] })
  })

  it('★ 选择点那一页不属于任何一支：两条路都要经过它', () => {
    const { a, b } = branchPagesOf(sharedTree())
    expect(a).not.toContain(2)
    expect(b).not.toContain(2)
    // 也没漏掉谁：主干（1、2）+ 两支（3、4、5）= 全表
    expect([...a, ...b].sort((x, y) => x - y)).toEqual([3, 4, 5])
  })

  it('独读版没有支：两个空表，不抛', () => {
    const result = buildTree('solo', 't', [page(), page(), page()])
    if (!result.ok) throw new Error('应当通过')
    expect(branchPagesOf(result.tree)).toEqual({ a: [], b: [] })
  })

  /**
   * ★ 草稿那一层的那一份（2026-10-18）。闸门那一屏用它——而那一屏**必须在
   * 树建不起来的时候也能标**（写了一半的那一页正是最需要能改的那一页）。
   */
  describe('branchLabelsOf —— 草稿那一层谁在哪条支上', () => {
    it('主干是 null，两条支按 via 一路继承下去', () => {
      expect(
        branchLabelsOf([
          page(),
          page(CHOICE),
          page({ from: 2, via: 'a' }),
          page({ from: 3 }),
          page({ from: 2, via: 'b' }),
        ]),
      ).toEqual([null, null, 'a', 'a', 'b'])
    })

    it('★ 不按平铺顺序：b 支的页排在 a 支前面也照样算得对', () => {
      // 验证夹具就是这么摆的（`branchPagesOf` 那条注释里写着）
      expect(
        branchLabelsOf([
          page(),
          page(CHOICE),
          page({ from: 2, via: 'b' }),
          page({ from: 2, via: 'a' }),
        ]),
      ).toEqual([null, null, 'b', 'a'])
    })

    it('不写 from 的草稿仍然算得出：缺省父页 = 上一页（与 buildTree 同一条）', () => {
      expect(branchLabelsOf([page(), page(CHOICE), page({ via: 'a' }), page()])).toEqual([
        null,
        null,
        'a',
        'a',
      ])
    })

    it('★ 接不回主干的那几页回 null，不抛（那是校验的活，不是标记的活）', () => {
      expect(branchLabelsOf([page(), page({ from: 9, via: 'a' })])).toEqual([null, null])
    })

    it('独读版（一个 via 都没有）整列都是 null', () => {
      expect(branchLabelsOf([page(), page(), page()])).toEqual([null, null, null])
    })

    it('★ 选择点那一页是主干（两条路都要经过它）——与 branchPagesOf 同一条事实', () => {
      const labels = branchLabelsOf([page(), page(CHOICE), page({ from: 2, via: 'a' })])
      expect(labels[1]).toBe(null)
    })
  })

  it('pathLengthsOf：是"孩子读到的长度"，去重升序，两支差 ≤ 1', () => {
    // a 支的叶在第 3 页（读到 3 页）、b 支的叶在第 5 页（读到 4 页）
    expect(pathLengthsOf(sharedTree())).toEqual([3, 4])
  })

  it('pathLengthsOf：独读版只有一个数（整条链）', () => {
    const result = buildTree('solo', 't', [page(), page(), page(), page()])
    if (!result.ok) throw new Error('应当通过')
    expect(pathLengthsOf(result.tree)).toEqual([4])
  })

  it('★ 路长与节点数在共读版上**不相等**——这正是闸门那一行要说的事', () => {
    const tree = sharedTree()
    expect(tree.nodes.length).toBe(5)
    expect(Math.max(...pathLengthsOf(tree))).toBe(4)
  })
})

describe('isChoicePage（工单 05 §一：闸门据此摊开那九个框）', () => {
  it('写全了是一个选择点', () => {
    expect(isChoicePage(page(CHOICE))).toBe(true)
  })

  it('★ 写了一半也算——那正是最需要能改的那一页（树正因为这半页建不起来）', () => {
    // 有提问、选项没写全：`toChoice` 会报「选择点写了一半」，界面必须把框摊开
    expect(isChoicePage(page({ ask: '你选哪个？' }))).toBe(true)
    expect(isChoicePage(page({ ask: '你选哪个？', labelA: '恐龙背', spokenA: '爬上恐龙背' }))).toBe(
      true,
    )
  })

  it('★ 只有一侧的 label、没有 spoken **不算**：它与 `toChoice` 是同一句话，引擎也不报错', () => {
    // 这一条钉的是"两边一样宽"：`optionOf` 要 label + spoken 齐全，
    // 所以这种残留是惰性数据——引擎既不组装 choice、也不报问题。
    // ★ 它不能被这样漏掉：闸门那一屏的判据是
    //   `isChoicePage(node) || 这一页有 field === 'choice' 的问题`，
    //   所以schema 报得出来的那几种（比如 labelA 空着/太短）照样会把框摊开。
    expect(isChoicePage(page({ labelA: '恐龙背' }))).toBe(false)
  })

  it('★ 光有 icon / emoji **不算**：那四个格子在 codec 里是 withDefault，每一页都有值', () => {
    // 这一条是这条判据的全部难点：拿"九格里任意一个有值"当判据的话，
    // 过一遍校验之后每一页都是选择点，那九个框会摊在整本书上
    expect(isChoicePage(page({ iconA: 'dino', emojiA: '🦕', iconB: 'ship', emojiB: '⛵' }))).toBe(
      false,
    )
    expect(isChoicePage(page())).toBe(false)
  })

  it('空白不算：`ask: "   "` 是没写', () => {
    expect(isChoicePage(page({ ask: '   ' }))).toBe(false)
  })
})
