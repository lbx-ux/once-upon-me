/**
 * plan-tools-wiring.test.ts —— 带工具那条路接到 `planStory` 上了没有
 *
 * 三件事，各对应一条会静默坏掉的地方：
 *
 * 1. 判据 8：不传 `tools` 时请求体逐字节等于今天。 这一层最容易出的错是
 *    "顺手给每条路都带上 `tools: []`"或"统一改成 messages 形状"——
 *    两者都不会让任何测试变红，只会让每一次跑测都换一条没量过的路，而横评的数字
 *    与上一次不可比（B1 已经付过一次这种学费）。
 * 2. 互斥当场抛：`tools` 与 `retrieve` / `onDelta` 同时给是两个不同的问题，
 *    静默取一个的话，"第三臂量的是什么"就说不清了。
 * 3. 工具查完之后，后面那一整套校验照旧跑：模型查了半天，最后交回来的还得是
 *    一张合法故事表——工具循环返回的 `text` 与 `complete()` 返回的是同一种东西。
 */

import { describe, expect, it } from 'vitest'

import { planStory, type PlanOptions } from './plan.ts'
import type { EngineEventPayload } from './events.ts'
import type { ToolDef } from './tool-loop.ts'
import type { StoryPlanInput } from '../prompts/story-plan.ts'
import type { TextGenerator, TextRequest, TextResponse } from './providers/types.ts'

/* 夹具 */

const STORY = {
  title: '小满和会下雨的恐龙',
  nodes: [
    {
      scene: '窗帘上有一片雨',
      body: ['窗外下起了雨。'],
      imagePrompt: '雨点打在窗玻璃上',
      mood: 'calm',
    },
    {
      scene: '恐龙从雨里走来',
      body: ['一只恐龙走进雨里。'],
      imagePrompt: '恐龙在雨里慢慢走过来',
      mood: 'joy',
    },
    {
      scene: '他们一起躲雨',
      body: ['他们一起躲进屋檐。'],
      imagePrompt: '恐龙与孩子站在屋檐下',
      mood: 'tender',
    },
  ],
}

const INPUT: StoryPlanInput = {
  childName: '小满',
  nameReading: 'mǎn',
  ageBand: '4-6',
  interestTags: ['恐龙'],
  lookTags: ['圆脸'],
  theme: '恐龙',
  form: 'solo',
  pages: 3,
}

/** 第一轮回工具调用，第二轮回故事表。★ 记录每一次的请求，判据 8 要看它 */
function fakeText(): { text: TextGenerator; seen: TextRequest[] } {
  const seen: TextRequest[] = []
  let turn = 0
  const reply = (): TextResponse => {
    turn += 1
    return turn === 1
      ? {
          text: '',
          modelId: 'fake-text',
          toolCalls: [{ id: 'c1', name: 'read_shelf', argumentsJson: '{}' }],
        }
      : { text: JSON.stringify(STORY), modelId: 'fake-text' }
  }
  return {
    seen,
    text: {
      id: 'fake-text',
      modelId: 'fake-text',
      async complete(req) {
        seen.push(req)
        return reply()
      },
      async stream(req, _budget, onDelta) {
        seen.push(req)
        const response = reply()
        onDelta({ text: response.text, streamed: false })
        return response
      },
    },
  }
}

const SHELF: ToolDef = {
  spec: { name: 'read_shelf', description: '看看有哪些书', parameters: { type: 'object' } },
  run: () => '他名下已有 1 本：《云》',
}

function opts(fake: ReturnType<typeof fakeText>, extra: Partial<PlanOptions> = {}): PlanOptions {
  return {
    text: fake.text,
    form: 'solo',
    emit: () => {},
    ...extra,
  }
}

/* 判据 8 */

describe('★ 判据 8：不传 tools 时，请求体逐字节等于今天', () => {
  it('不给 tools → 走 `complete`，请求里**没有** tools / messages 两个字段', async () => {
    const fake = fakeText()
    // 不给工具时第一轮就该是故事表：把剧本换成"一次就给答案"
    const plain: TextGenerator = {
      ...fake.text,
      async complete(req) {
        fake.seen.push(req)
        return { text: JSON.stringify(STORY), modelId: 'plain' }
      },
    }
    const outcome = await planStory(INPUT, { text: plain, form: 'solo', emit: () => {} })
    expect(outcome.doc.title).toBe(STORY.title)
    expect(fake.seen).toHaveLength(1)
    const request = fake.seen[0]
    expect(request).not.toHaveProperty('tools')
    expect(request).not.toHaveProperty('messages')
    // 形状还是 system + user 两条老字段
    expect(typeof request?.system).toBe('string')
    expect(typeof request?.user).toBe('string')
  })
})

/* 带工具那条路 */

describe('带工具那一条', () => {
  it('模型先调工具、再给故事表——后面那整套校验照旧跑', async () => {
    const fake = fakeText()
    const events: EngineEventPayload[] = []
    const outcome = await planStory(
      INPUT,
      opts(fake, { tools: [SHELF], emit: (one) => events.push(one) }),
    )
    expect(outcome.doc.title).toBe(STORY.title)
    // 两次调用：第一轮调工具，第二轮给答案
    expect(fake.seen).toHaveLength(2)
    // 第二轮带着回填的 tool 消息
    expect(fake.seen[1]?.messages?.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'c1' })
    // 过程里有一条 tool 事件（画桌那一行要看它）
    expect(events.filter((one) => one.kind === 'tool')).toHaveLength(1)
  })

  it('通过校验后照常发 `plan-ready`（工具那条路不是旁路）', async () => {
    const fake = fakeText()
    const events: EngineEventPayload[] = []
    await planStory(INPUT, opts(fake, { tools: [SHELF], emit: (one) => events.push(one) }))
    expect(events.some((one) => one.kind === 'plan-ready')).toBe(true)
  })
})

/* 互斥 */

describe('★ 互斥当场抛，不静默取一个', () => {
  it('tools 与 retrieve 同时给 → 抛，且说清是"同一个问题的两种答案"', async () => {
    const fake = fakeText()
    await expect(
      planStory(
        INPUT,
        opts(fake, {
          tools: [SHELF],
          retrieve: async () => ({ pair: { examples: [], avoids: [] }, corpusVersion: 'x' }),
        }),
      ),
    ).rejects.toThrow(/两种答案/)
  })

  it('tools 与 onDelta 同时给 → 抛（工具循环要完整回包，不是增量）', async () => {
    const fake = fakeText()
    await expect(
      planStory(INPUT, opts(fake, { tools: [SHELF], onDelta: () => {} })),
    ).rejects.toThrow(/onDelta/)
  })
})
