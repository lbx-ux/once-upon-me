/**
 * review-judge.test.ts —— 语义复核的判据与它的边界（2026-10-30）
 *
 * 这一组用例全在测同一句话：**模型说什么不算数，原文里找得到的才算数**。
 * 所以有一半的用例是"模型报了，但应该被丢掉"的坏样本——它们是这一档唯一防幻觉的手段，
 * 比"模型能报对"重要得多。
 *
 * 其余三组：
 *   · 什么时候不花钱（没有信号 → 一次调用都不发）；
 *   · 页码对不上时按引用重新定位（报错页是常事，报错行不是）；
 *   · 跑不成走 `unavailable`、不发 `flag`（没有判据的拦截是假拦）。
 */

import { describe, expect, it } from 'vitest'

import { judgeIfSuspect, judgeStory } from './review-judge.ts'
import type { StoryNode, StoryTree } from './domain.ts'
import type { EngineEventPayload } from './events.ts'
import type { TextGenerator, TextRequest, TextResponse } from './providers/types.ts'

function node(pageNo: number, body: readonly string[]): StoryNode {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    scene: '雨天的窗',
    body,
    imagePrompt: '纸上的雨',
    mood: 'calm',
    next: [],
    pathFromRoot: [`n${pageNo}`],
  }
}

const TREE: StoryTree = {
  form: 'solo',
  title: '雨天的桥',
  rootId: 'n1',
  nodes: [
    node(1, ['哗啦啦，大雨落下来。']),
    node(2, ['小宇撑着伞走上小桥。']),
    node(3, ['雨停了，他回家了。']),
  ],
}

function replyWith(text: string): {
  text: TextGenerator
  calls: () => number
  requests: TextRequest[]
} {
  const requests: TextRequest[] = []
  return {
    requests,
    calls: () => requests.length,
    text: {
      id: 'fake-judge',
      modelId: 'fake-judge',
      async complete(req: TextRequest): Promise<TextResponse> {
        requests.push(req)
        return { text, modelId: 'fake-judge' }
      },
      async stream(): Promise<TextResponse> {
        throw new Error('语义复核不走流式')
      },
    },
  }
}

function failing(): TextGenerator {
  return {
    id: 'fake-judge',
    modelId: 'fake-judge',
    async complete(): Promise<TextResponse> {
      throw new Error('网关 504')
    },
    async stream(): Promise<TextResponse> {
      throw new Error('语义复核不走流式')
    },
  }
}

const finding = (quote: string, pageNo = 2, clauseId = 'R-03') =>
  JSON.stringify({ findings: [{ clauseId, pageNo, quote, why: '委婉写法，孩子会追问' }] })

describe('judgeStory：原文核验', () => {
  it('引用在原文里 → flag，页码与引用都留着', async () => {
    const { text } = replyWith(finding('小宇撑着伞走上小桥'))
    const outcome = await judgeStory(TREE, text)

    expect(outcome.verdict).toBe('flag')
    expect(outcome.dropped).toBe(0)
    expect(outcome.findings).toHaveLength(1)
    expect(outcome.findings[0]).toMatchObject({
      pageNo: 2,
      clauseId: 'R-03',
      category: '死亡',
      disposition: 'rewrite',
      word: '小宇撑着伞走上小桥',
    })
    expect(outcome.reason).toContain('第 2 页')
    expect(outcome.reason).toContain('R-03')
  })

  it('模型编了一句原文里没有的话 → 丢掉，pass，dropped 记 1', async () => {
    const { text } = replyWith(finding('他睡着了，再也没有醒过来'))
    const outcome = await judgeStory(TREE, text)

    expect(outcome.verdict).toBe('pass')
    expect(outcome.findings).toEqual([])
    expect(outcome.dropped).toBe(1)
    expect(outcome.reason).toBe('')
  })

  it('页码报错了、但引用在全书唯一 → 按引用重新定位', async () => {
    const { text } = replyWith(finding('雨停了，他回家了', 7))
    const outcome = await judgeStory(TREE, text)

    expect(outcome.verdict).toBe('flag')
    expect(outcome.findings[0]?.pageNo).toBe(3)
  })

  it('同一句话在两页都出现 → 分不清是哪一页，丢掉', async () => {
    const tree: StoryTree = {
      ...TREE,
      nodes: [node(1, ['他看着窗外的雨。']), node(2, ['他看着窗外的雨。']), node(3, ['雨停了。'])],
    }
    const { text } = replyWith(finding('他看着窗外的雨。', 3))
    const outcome = await judgeStory(tree, text)

    expect(outcome.verdict).toBe('pass')
    expect(outcome.dropped).toBe(1)
  })

  it('空白不影响核对（模型抄的时候多一个空格不算编造）', async () => {
    const { text } = replyWith(finding('小宇 撑着伞 走上小桥'))
    const outcome = await judgeStory(TREE, text)

    expect(outcome.verdict).toBe('flag')
    expect(outcome.dropped).toBe(0)
  })

  it('认不出的条款 id：保留原文，归「适龄」，只给 rewrite', async () => {
    const { text } = replyWith(finding('雨停了，他回家了', 3, 'R-99'))
    const outcome = await judgeStory(TREE, text)

    expect(outcome.findings[0]).toMatchObject({
      clauseId: 'R-99',
      category: '适龄',
      disposition: 'rewrite',
    })
  })

  it('R-04（自伤）仍然是 block——处置跟着条款库，不跟着这一档自己定', async () => {
    const tree: StoryTree = {
      ...TREE,
      nodes: [
        node(1, ['哗啦啦，大雨落下来。']),
        node(2, ['他说他不想活了。']),
        node(3, ['雨停了，他回家了。']),
      ],
    }
    const { text } = replyWith(finding('他说他不想活了。', 2, 'R-04'))
    const outcome = await judgeStory(tree, text)

    expect(outcome.verdict).toBe('block')
  })
})

describe('judgeStory：跑不成的时候', () => {
  it('调用抛错 → unavailable，不是 flag', async () => {
    const outcome = await judgeStory(TREE, failing())
    expect(outcome.verdict).toBe('unavailable')
    expect(outcome.reason).toContain('网关 504')
  })

  it('回答不是 JSON → unavailable', async () => {
    const { text } = replyWith('我觉得这本书挺好的。')
    const outcome = await judgeStory(TREE, text)
    expect(outcome.verdict).toBe('unavailable')
    expect(outcome.reason).toContain('JSON')
  })

  it('findings 缺失 → unavailable（形状不对就是没跑成，不猜成 pass）', async () => {
    const { text } = replyWith('{"verdict":"pass"}')
    const outcome = await judgeStory(TREE, text)
    expect(outcome.verdict).toBe('unavailable')
  })
})

describe('judgeIfSuspect：什么时候花钱', () => {
  it('没有信号 → null，一次调用都不发', async () => {
    const { text, calls } = replyWith('{"findings":[]}')
    const emitted: EngineEventPayload[] = []
    const result = await judgeIfSuspect(TREE, {
      text,
      input: { theme: 'cloud' },
      emit: (payload) => emitted.push(payload),
      stage: 'planning',
    })

    expect(result).toBeNull()
    expect(calls()).toBe(0)
    expect(emitted).toEqual([])
  })

  it('没有文本能力 → null（脚本与离线路不跑这一档）', async () => {
    const result = await judgeIfSuspect(TREE, {
      text: undefined,
      input: { theme: '离开' },
      emit: () => {},
      stage: 'planning',
    })
    expect(result).toBeNull()
  })

  it('有信号 + 模型报了一条 → 发一条 flag 事件，stage 原样带出去', async () => {
    const { text, calls } = replyWith(finding('小宇撑着伞走上小桥'))
    const emitted: EngineEventPayload[] = []
    const result = await judgeIfSuspect(TREE, {
      text,
      input: { theme: '小宇第一次离开家' },
      emit: (payload) => emitted.push(payload),
      stage: 'auditing',
    })

    expect(calls()).toBe(1)
    expect(result?.signals[0]?.code).toBe('theme-stem')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ kind: 'review', stage: 'auditing', verdict: 'flag' })
  })

  it('有信号 + 模型说没问题 → 不发事件（pass 本来就是没人看的那一条）', async () => {
    const { text } = replyWith('{"findings":[]}')
    const emitted: EngineEventPayload[] = []
    const result = await judgeIfSuspect(TREE, {
      text,
      input: { theme: '离开' },
      emit: (payload) => emitted.push(payload),
      stage: 'planning',
    })

    expect(result?.outcome.verdict).toBe('pass')
    expect(emitted).toEqual([])
  })

  it('有信号 + 没跑成 → 发一条 unavailable，不拦', async () => {
    const emitted: EngineEventPayload[] = []
    const result = await judgeIfSuspect(TREE, {
      text: failing(),
      input: { theme: '离开' },
      emit: (payload) => emitted.push(payload),
      stage: 'planning',
    })

    expect(result?.outcome.verdict).toBe('unavailable')
    expect(emitted[0]).toMatchObject({ kind: 'review', verdict: 'unavailable' })
  })
})
