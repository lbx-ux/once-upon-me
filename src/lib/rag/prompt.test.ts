/**
 * prompt.test.ts —— 提示词那一段的两条硬约束
 *
 * 1. **有范例就必须带那句"不许照抄"**（不带的话模型会把别人书里的句子搬进这本）
 * 2. **空结果整段不出现**（返回空串，而不是写一句"没有检索到范例"）
 *
 * 另外钉住段落顺序：反例在后。这一栏最新鲜的一条技术方案是负向检索，
 * 它要是被范例段盖过去，等于白做。
 */

import { describe, expect, it } from 'vitest'

import type { RagChunk } from './corpus.ts'
import { AVOID_HEAD, EXAMPLE_HEAD, NO_COPY_LINE, retrievalBlock } from './prompt.ts'
import type { RetrieveHit } from './retrieve.ts'

function hit(
  id: string,
  text: string,
  source: string,
  score = 1,
  why = '命中 2 个 bigram',
): RetrieveHit {
  const chunk: RagChunk = {
    id,
    kind: 'spread',
    owner: 'library',
    ageBand: '4-6',
    theme: 'cloud',
    form: '*',
    text,
    source,
  }
  return { chunk, score, why }
}

const example = hit(
  'library/cloud#s1',
  '躺在垫子上\n正午，小飞躺在野餐垫上，手枕在脑后。',
  '样书《小飞看见的那朵云》第 1 跨页 · 躺在垫子上',
)
const avoid = hit(
  'u/12/books/bk_x#p1',
  '客厅里的纸箱\n她给妈妈留了一个座位。',
  '《小雨的火箭》第 1 页',
  2,
  '你已经给他写过 · 命中 3 个 bigram',
)

describe('提示词那一段', () => {
  it('★ 两边都空 → **空串**（不是一句"没有检索到范例"）', () => {
    expect(retrievalBlock({ examples: [], avoids: [] })).toBe('')
  })

  it('有范例 → 带标题、带"不许照抄"那句、带出处', () => {
    const block = retrievalBlock({ examples: [example], avoids: [] })
    expect(block).toContain(EXAMPLE_HEAD)
    expect(block).toContain(NO_COPY_LINE)
    expect(block).toContain('样书《小飞看见的那朵云》第 1 跨页 · 躺在垫子上')
    expect(block).not.toContain(AVOID_HEAD)
  })

  it('只有反例 → 不带"不许照抄"（那句是范例段的前提，不是全局声明）', () => {
    const block = retrievalBlock({ examples: [], avoids: [avoid] })
    expect(block).toContain(AVOID_HEAD)
    expect(block).not.toContain(EXAMPLE_HEAD)
    expect(block).not.toContain(NO_COPY_LINE)
    expect(block).toContain('与你这次的要求很近')
  })

  it('★ 反例段在范例段**后面**', () => {
    const block = retrievalBlock({ examples: [example], avoids: [avoid] })
    expect(block.indexOf(EXAMPLE_HEAD)).toBeLessThan(block.indexOf(AVOID_HEAD))
  })

  it('正文与出处分行：出处那行以 `——出处：` 开头', () => {
    const block = retrievalBlock({ examples: [example], avoids: [] })
    expect(block).toContain('——出处：')
    const lines = block.split('\n')
    expect(lines.some((line) => line.trimStart().startsWith('——出处：'))).toBe(true)
  })

  it('多条时编号从 1 起，逐条分开', () => {
    const two = retrievalBlock({
      examples: [
        example,
        hit('library/cloud#s2', '风来了\n吹了一下，乌龟散了。', '样书《…》第 3 跨页 · 风来了'),
      ],
      avoids: [],
    })
    expect(two).toContain('1. ')
    expect(two).toContain('2. ')
  })

  it('`why` 不进提示词（那是给人的，进事件与 provenance）', () => {
    const block = retrievalBlock({ examples: [example], avoids: [avoid] })
    expect(block).not.toContain('命中 2 个 bigram')
    expect(block).not.toContain('命中 3 个 bigram')
  })
})
