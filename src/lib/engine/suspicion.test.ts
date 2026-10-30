/**
 * suspicion.test.ts —— 语义复核的触发条件（2026-10-30）
 *
 * 这一组盯的不是"判断得准不准"（那是模型的事），而是**什么时候花钱**：
 *   正常的一本书零信号，三类可疑各能单独触发，且 detail 说得出是哪一页/哪个词。
 *
 * 三个边界各有一条用例，因为它们都是"差一个字就全触发/全不触发"的地方：
 *   · 正文恰好 8 个字（门槛是 `< 8`，所以 8 不触发）；
 *   · 句子数恰好等于页数（门槛是 `< 页数`，所以相等不触发）；
 *   · 同一类信号最多报三条（日志不是清单墙）。
 */

import { describe, expect, it } from 'vitest'

import { suspicionOf, TERSE_PAGE_CHARS } from './suspicion.ts'
import type { StoryNode, StoryTree } from './domain.ts'

function node(pageNo: number, body: readonly string[]): StoryNode {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    scene: '一个安静的场景',
    body,
    imagePrompt: '纸上的插画',
    mood: 'calm',
    next: [],
    pathFromRoot: [`n${pageNo}`],
  }
}

function treeOf(nodes: readonly StoryNode[], title = '小乐的一天'): StoryTree {
  return { form: 'solo', title, rootId: 'n1', nodes }
}

/** 三页、每页一句 10 个字：句子数 3 = 页数 3，正文 10 > 8，哪一类都不该触发 */
const CLEAN = treeOf([
  node(1, ['她把天空涂成绿色。']),
  node(2, ['绿色顺着窗缝漏出去。']),
  node(3, ['整座城都变成绿色。']),
])

describe('suspicionOf：正常的一本书不触发', () => {
  it('干净的主题 + 正常的正文 → 空数组', () => {
    expect(suspicionOf({ theme: 'cloud', wish: '想让孩子学会分享', tree: CLEAN })).toEqual([])
  })

  it('8 个字恰好不触发（门槛是严格小于）', () => {
    const tree = treeOf([
      node(1, ['一二三四五六七八']),
      node(2, ['二三四五六七八九']),
      node(3, ['三四五六七八九十']),
    ])
    expect(TERSE_PAGE_CHARS).toBe(8)
    expect(suspicionOf({ tree })).toEqual([])
  })
})

describe('suspicionOf：三类触发', () => {
  it('主题里有高敏词根 → theme-stem，detail 说得出是哪个词', () => {
    const signals = suspicionOf({ theme: '小宇第一次离开家', tree: CLEAN })
    expect(signals).toEqual([{ code: 'theme-stem', detail: '主题里出现了「离开」' }])
  })

  it('"一个人"也算信号（它可以正常，但值得问一次）', () => {
    const signals = suspicionOf({ wish: '一个人也可以很好', tree: CLEAN })
    expect(signals.map((s) => s.code)).toEqual(['theme-stem'])
    expect(signals[0]?.detail).toContain('「一个人」')
  })

  it('某页正文太短 → terse-page，带页号与字数', () => {
    const tree = treeOf([
      node(1, ['她把天空涂成绿色。']),
      node(2, ['她走了。']),
      node(3, ['整座城都变成绿色。']),
    ])
    const signals = suspicionOf({ tree })
    expect(signals).toEqual([{ code: 'terse-page', detail: '第 2 页的正文只有 4 个字' }])
  })

  it('整本句子数比页数少 → short-story', () => {
    const tree = treeOf([
      node(1, ['她把天空涂成绿色。']),
      node(2, []),
      node(3, ['整座城都变成绿色。']),
    ])
    const signals = suspicionOf({ tree })
    // 第 2 页是空的（terse-page），整本 2 句 < 3 页（short-story）
    expect(signals.map((s) => s.code)).toEqual(['terse-page', 'short-story'])
    expect(signals.map((s) => s.detail)).toContain('整本只有 2 句正文，比 3 页还少')
  })

  it('同一类信号最多报三条（日志不是清单墙）', () => {
    const tree = treeOf([
      node(1, ['短。']),
      node(2, ['短。']),
      node(3, ['短。']),
      node(4, ['短。']),
      node(5, ['短。']),
    ])
    const terse = suspicionOf({ tree }).filter((s) => s.code === 'terse-page')
    expect(terse).toHaveLength(3)
  })
})

describe('suspicionOf：故事正文里的三类（2026-10-30 下午补）', () => {
  it('委婉死亡的二元组：睡着 + 再也', () => {
    const tree = treeOf([
      node(1, ['小狗趴在垫子上。']),
      node(2, ['它今天没有起来吃饭。']),
      node(3, ['小狗睡着了，再也没有醒过来。']),
    ])
    const signals = suspicionOf({ tree })
    expect(signals.map((s) => s.code)).toEqual(['story-pair'])
    expect(signals[0]?.detail).toContain('第 3 页')
  })

  it('只有"睡着了"不触发（睡前书每页都有）', () => {
    const tree = treeOf([
      node(1, ['晚上，他翻着旧相册。']),
      node(2, ['照片里有一个男孩。']),
      node(3, ['他想着照片里的男孩，睡着了。']),
    ])
    expect(suspicionOf({ tree })).toEqual([])
  })

  it('留白吓人的信号词：有东西', () => {
    const tree = treeOf([
      node(1, ['走廊的灯忽明忽暗。']),
      node(2, ['她听见门后面有声音。']),
      node(3, ['门后面有东西在等她。']),
    ])
    expect(suspicionOf({ tree }).map((s) => s.code)).toEqual(['story-stem'])
  })

  it('说教的信号词：这个故事告诉我们', () => {
    const tree = treeOf([
      node(1, ['小狐狸捡到了一个钱包。']),
      node(2, ['它把钱包还给了失主。']),
      node(3, ['这个故事告诉我们，做人一定要诚实。']),
    ])
    expect(suspicionOf({ tree }).map((s) => s.code)).toEqual(['story-stem'])
  })

  it('超长句：一句 39 个字', () => {
    const tree = treeOf([
      node(1, ['他安静地站在窗前。']),
      node(2, ['世界在他面前慢慢展开。']),
      node(3, ['在这个充满未知与变数的世界里，他必须学会以坚定不移的信念面对接踵而至的挑战。']),
    ])
    expect(suspicionOf({ tree }).map((s) => s.code)).toEqual(['long-sentence'])
  })

  it('书名里的信号词也算（那也是一句孩子会听到的话）', () => {
    const tree = treeOf(
      [
        node(1, ['她把天空涂成绿色。']),
        node(2, ['绿色顺着窗缝漏出去。']),
        node(3, ['整座城都变成绿色了。']),
      ],
      '门后面有东西',
    )
    const signals = suspicionOf({ tree })
    expect(signals.map((s) => s.code)).toEqual(['story-stem'])
    expect(signals[0]?.detail).toBe('书名出现了「有东西」')
  })

  it('书名的委婉二元组也算', () => {
    const tree = treeOf(
      [
        node(1, ['她把天空涂成绿色。']),
        node(2, ['绿色顺着窗缝漏出去。']),
        node(3, ['整座城都变成绿色了。']),
      ],
      '小狗走了，再也不回来',
    )
    const signals = suspicionOf({ tree })
    expect(signals.map((s) => s.code)).toEqual(['story-pair'])
    expect(signals[0]?.detail).toContain('书名')
  })
})
