/**
 * safety-judge.test.ts —— 语义复核的提示词（2026-10-30）
 *
 * 这一组钉的是"哪些话必须在那一段里"。提示词被改坏不会让任何东西报错，
 * 只会让模型开始概括原文、或者开始报风格——两种都不会在单元测试之外显形，
 * 所以这里至少把几处硬约束写成断言。
 */

import { describe, expect, it } from 'vitest'

import { SAFETY_JUDGE_VERSION, safetyJudgeSystem, safetyJudgeUser } from './safety-judge.ts'
import type { StoryNode, StoryTree } from '../engine/domain.ts'

const CHOICE: StoryNode = {
  nodeId: 'n3',
  pageNo: 3,
  scene: '这一段画面不该进提示词',
  body: ['前面有两条路。'],
  imagePrompt: '这一段画面提示词也不该进',
  mood: 'wonder',
  next: ['n4', 'n5'],
  pathFromRoot: ['n1', 'n3'],
  choice: {
    prompt: '今天往哪边走？',
    options: [
      { iconKey: 'left', emoji: '👈', label: '左边', spoken: '我们走左边吧' },
      { iconKey: 'right', emoji: '👉', label: '右边', spoken: '我们走右边吧' },
    ],
  },
}

const TREE: StoryTree = {
  form: 'shared',
  title: '雨天的桥',
  rootId: 'n1',
  nodes: [
    {
      nodeId: 'n1',
      pageNo: 1,
      scene: '窗边',
      body: ['哗啦啦，大雨落下来。'],
      imagePrompt: '雨',
      mood: 'calm',
      next: ['n3'],
      pathFromRoot: ['n1'],
    },
    CHOICE,
  ],
}

describe('safetyJudgeSystem', () => {
  const system = safetyJudgeSystem()

  it('五类条款 id 都在（这一档没有自己的条款库，id 是唯一的接口）', () => {
    for (const id of ['R-01', 'R-03', 'R-07', 'R-08', 'R-09']) expect(system).toContain(id)
  })

  it('"逐字引用"这条判据写死了（代码靠它防幻觉）', () => {
    expect(system).toContain('逐字引用')
    expect(system).toContain('连续的一段')
  })

  it('输出形状给了一个能照着抄的例子', () => {
    expect(system).toContain('"findings"')
    expect(system).toContain('"clauseId"')
    expect(system).toContain('"quote"')
  })

  it('版本号带日期以外的语义：改文案要 +1', () => {
    expect(SAFETY_JUDGE_VERSION).toBe('safety-judge@v1')
  })
})

describe('safetyJudgeUser', () => {
  const user = safetyJudgeUser(TREE)

  it('书名、页码、正文、选择点都在', () => {
    expect(user).toContain('书名：雨天的桥')
    expect(user).toContain('第 1 页')
    expect(user).toContain('哗啦啦，大雨落下来。')
    expect(user).toContain('选择点提问：今天往哪边走？')
    expect(user).toContain('选项A：左边')
    expect(user).toContain('说给孩子听：我们走右边吧')
  })

  it('不带 scene / imagePrompt（画面那一档由视觉模型管）', () => {
    expect(user).not.toContain('这一段画面不该进提示词')
    expect(user).not.toContain('这一段画面提示词也不该进')
  })

  it('长句会被截断，不是原样塞进去', () => {
    const long = '雨'.repeat(400)
    const tree: StoryTree = {
      ...TREE,
      nodes: [{ ...TREE.nodes[0]!, body: [long] }],
    }
    expect(safetyJudgeUser(tree).length).toBeLessThan(400)
  })
})
