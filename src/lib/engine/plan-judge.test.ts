/**
 * plan-judge.test.ts —— 语义复核接进规划之后，重试与放行的形状（2026-10-30）
 *
 * 四条判据，一条都不能少：
 *   ① 没有信号的书**一次都不问**（这一档的代价必须留在"可疑"上）；
 *   ② 问了、说没问题 → 正常放行，`attempts` 仍然是 1（兜底调用不进那个数）；
 *   ③ 问了、报了 → 带反馈重写；第二版过了就放行；
 *   ④ 问了、没跑成 → 放行，但事件里如实写 `unavailable`（不拿网络错误当违规）。
 */

import { describe, expect, it } from 'vitest'

import { planStory } from './plan.ts'
import type { EngineEvent, EngineEventPayload } from './events.ts'
import type { TextGenerator, TextRequest, TextResponse } from './providers/types.ts'
import type { StoryPlanInput } from '../prompts/story-plan.ts'

const INPUT: StoryPlanInput = {
  childName: '小乐',
  nameReading: 'xiǎo lè',
  ageBand: '4-6',
  interestTags: ['云'],
  lookTags: ['短发'],
  theme: 'cloud',
  form: 'solo',
  pages: 3,
}

const node = (body: string) => ({
  scene: '她把天空涂成绿色',
  body: [body],
  imagePrompt: '纸上的绿色天空和云',
  mood: 'wonder',
})

const GOOD = JSON.stringify({
  title: '小乐的绿天空',
  nodes: [
    node('她把天空涂成了绿色。'),
    node('绿色顺着窗缝漏了出去。'),
    node('整座城都变成绿色了。'),
  ],
})

const JUDGE_PASS = '{"findings":[]}'
const JUDGE_FLAG = JSON.stringify({
  findings: [
    {
      clauseId: 'R-03',
      pageNo: 1,
      quote: '她把天空涂成了绿色。',
      why: '这一句没有问题，但用例要的是"报了一条"',
    },
  ],
})

/** 按 system 分流：复核那一段走 `judgeReplies`，其余按规划回 `GOOD` */
function routingText(judgeReplies: readonly string[]): {
  text: TextGenerator
  planCalls: () => number
  judgeCalls: () => number
} {
  let plans = 0
  let judges = 0
  return {
    planCalls: () => plans,
    judgeCalls: () => judges,
    text: {
      id: 'fake-routing',
      modelId: 'fake-routing',
      async complete(req: TextRequest): Promise<TextResponse> {
        if ((req.system ?? '').includes('内容复核员')) {
          const reply = judgeReplies[Math.min(judges, judgeReplies.length - 1)] ?? JUDGE_PASS
          judges += 1
          return { text: reply, modelId: 'fake-judge' }
        }
        plans += 1
        return { text: GOOD, modelId: 'fake-planner' }
      },
      async stream(): Promise<TextResponse> {
        throw new Error('这一组只走 complete')
      },
    },
  }
}

function failingJudge(): { text: TextGenerator; planCalls: () => number } {
  let plans = 0
  return {
    planCalls: () => plans,
    text: {
      id: 'fake-routing',
      modelId: 'fake-routing',
      async complete(req: TextRequest): Promise<TextResponse> {
        if ((req.system ?? '').includes('内容复核员')) throw new Error('网关 504')
        plans += 1
        return { text: GOOD, modelId: 'fake-planner' }
      },
      async stream(): Promise<TextResponse> {
        throw new Error('这一组只走 complete')
      },
    },
  }
}

async function run(
  theme: string,
  text: TextGenerator,
  maxAttempts = 3,
): Promise<{
  events: EngineEvent[]
  outcome: Awaited<ReturnType<typeof planStory>> | null
  error: Error | null
}> {
  const events: EngineEvent[] = []
  let seq = 0
  const emit = (payload: EngineEventPayload): void => {
    seq += 1
    events.push({ seq, at: 0, stage: 'planning', ...payload } as unknown as EngineEvent)
  }
  let outcome: Awaited<ReturnType<typeof planStory>> | null = null
  let error: Error | null = null
  try {
    outcome = await planStory(
      { ...INPUT, theme },
      { text, judge: text, form: 'solo', maxAttempts, emit },
    )
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
  }
  return { events, outcome, error }
}

describe('规划期的语义复核', () => {
  it('没有信号：一次都不问，attempts 仍是 1', async () => {
    const { text, planCalls, judgeCalls } = routingText([JUDGE_FLAG])
    const { outcome, events, error } = await run('cloud', text)

    expect(error).toBeNull()
    expect(planCalls()).toBe(1)
    expect(judgeCalls()).toBe(0)
    expect(outcome?.attempts).toBe(1)
    expect(events.filter((event) => event.kind === 'review')).toEqual([])
  })

  it('有信号、模型说没问题：放行，attempts 不计那次兜底调用', async () => {
    const { text, planCalls, judgeCalls } = routingText([JUDGE_PASS])
    const { outcome, error, events } = await run('小宇第一次离开家', text)

    expect(error).toBeNull()
    expect(planCalls()).toBe(1)
    expect(judgeCalls()).toBe(1)
    expect(outcome?.attempts).toBe(1)
    expect(events.at(-1)?.kind).toBe('plan-ready')
  })

  it('有信号、模型报了：带反馈重写，第二版过了就放行', async () => {
    const { text, planCalls, judgeCalls } = routingText([JUDGE_FLAG, JUDGE_PASS])
    const { outcome, error, events } = await run('小宇第一次离开家', text)

    expect(error).toBeNull()
    expect(planCalls()).toBe(2)
    expect(judgeCalls()).toBe(2)
    expect(outcome?.attempts).toBe(2)

    const reviews = events.filter((event) => event.kind === 'review')
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ kind: 'review', check: 'safety', verdict: 'flag' })

    const retries = events.filter((event) => event.kind === 'retry')
    expect(retries).toHaveLength(1)
    expect(retries[0]?.kind === 'retry' ? retries[0].reason : '').toContain('R-03')
  })

  it('有信号、复核没跑成：放行，事件写 unavailable', async () => {
    const { text, planCalls } = failingJudge()
    const { outcome, error, events } = await run('小宇第一次离开家', text)

    expect(error).toBeNull()
    expect(planCalls()).toBe(1)
    expect(outcome?.attempts).toBe(1)

    const reviews = events.filter((event) => event.kind === 'review')
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ kind: 'review', verdict: 'unavailable' })
  })

  it('每次都被报：重试用完，最终那句是 review-blocked 而不是换模型', async () => {
    const { text, planCalls } = routingText([JUDGE_FLAG])
    const { error } = await run('小宇第一次离开家', text, 2)

    expect(planCalls()).toBe(2)
    // 收尾那句是 `review-blocked` 的文案（不是"换个模型"那种），且带着条款 id
    expect(error?.message).toContain('不该给孩子看的内容')
    expect(error?.message).toContain('R-03')
  })
})
