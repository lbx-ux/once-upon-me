/**
 * plan-retry.test.ts —— 规划期 `retry` 事件的**上界**（2026-10-20）
 *
 * 这一组用例盯的是一句话：**引擎只在真的还有下一次时，才说"正在重写"**。
 *
 * 起因是一次通读：`plan.ts` 的三处 `retry`（schema 没过 / 树形不合法 / 内容审核没过）
 * 在 `attempt === maxAttempts` 时**照样发**，然后循环结束、抛
 * `schema-validation-failed`——屏幕上最后留下的那句话是
 * 「这一版故事没通过校验，正在重写（第 3 / 3 次）」，而下面根本没有第 3 次以后的重写。
 * 那是这一屏唯一还在说的话，收尾的 fatal 帧把它换掉之前它一直站着。
 *
 * ★ 判据是现成的：同一个引擎里 `illustrate.ts` 的两处 `retry`
 *   （一致性没过 / 画面没过）都带着 `attempt < lastAttempt`。
 *   此处对齐它，并用例锁死：发出去的每一条 `retry` 的 `attempt` 都**严格小于**上界。
 */

import { describe, expect, it } from 'vitest'

import { planStory } from './plan.ts'
import type { EngineEvent, EngineEventPayload } from './events.ts'
import type { TextGenerator, TextResponse } from './providers/types.ts'
import type { StoryPlanInput } from '../prompts/story-plan.ts'

const INPUT: StoryPlanInput = {
  childName: '小乐',
  nameReading: 'xiǎo lè',
  ageBand: '4-6',
  interestTags: ['云'],
  lookTags: ['短发'],
  theme: 'cloud',
  form: 'solo',
  pages: 2,
}

/**
 * 三份夹具。★ 都是**三页**：`planDraftCodec` 的 `nodes` 是 `min: 3`
 * （一页两页的书不是这个产品要的），少一页就先在 schema 那一关红，
 * 于是"树形不合法""审核没过"这两条路根本走不到——用例会红在错误的地方。
 */
const node = (scene: string, body: string, extra: Record<string, unknown> = {}) => ({
  scene,
  body: [body],
  imagePrompt: '小女孩站在窗前，窗外一整片绿',
  mood: 'wonder',
  ...extra,
})

/** 一份合法的独读版故事表 */
const GOOD = JSON.stringify({
  title: '小乐的绿天空',
  nodes: [
    node('她把天空涂成绿色', '她把天空涂成了绿色。'),
    node('绿色顺着窗缝漏了出去', '绿色顺着窗缝漏了出去。'),
    node('整座城都绿了', '整座城都绿了，她合上了眼睛。'),
  ],
})

/** 树形不合法：第 1 页带了 `from`（`buildTree`：第一页不能有父节点） */
const BAD_TREE = JSON.stringify({
  title: '小乐的绿天空',
  nodes: [
    node('她把天空涂成绿色', '她把天空涂成了绿色。', { from: 2 }),
    node('绿色顺着窗缝漏了出去', '绿色顺着窗缝漏了出去。'),
    node('整座城都绿了', '整座城都绿了，她合上了眼睛。'),
  ],
})

/** schema 过、树形过，但内容审核没过：正文里有「血」（R-01，disposition: rewrite） */
const FLAGGED = JSON.stringify({
  title: '小乐的绿天空',
  nodes: [
    node('她把天空涂成绿色', '她的手指上有一点血。'),
    node('绿色顺着窗缝漏了出去', '绿色顺着窗缝漏了出去。'),
    node('整座城都绿了', '整座城都绿了，她合上了眼睛。'),
  ],
})

/** 按剧本回话的假文本：第 n 次调用用 `plan[n - 1]`，写完剧本就一直用最后那一条 */
function fakeText(plan: readonly string[]): { text: TextGenerator; calls: () => number } {
  let index = 0
  const textAt = (): string => plan[Math.min(index, plan.length - 1)] ?? ''
  return {
    calls: () => index,
    text: {
      id: 'fake-text',
      modelId: 'fake-text',
      async complete(): Promise<TextResponse> {
        const response: TextResponse = { text: textAt(), modelId: 'fake-text' }
        index += 1
        return response
      },
      async stream(_req, _budget, onDelta): Promise<TextResponse> {
        const response: TextResponse = { text: textAt(), modelId: 'fake-text' }
        index += 1
        onDelta({ text: response.text, streamed: false })
        return response
      },
    },
  }
}

/** 只做规划那一步的最小依赖；事件原样收集（编号由这一个包装补上） */
async function runPlan(
  plan: readonly string[],
  maxAttempts: number,
): Promise<{ events: EngineEvent[]; calls: () => number; error: Error | null }> {
  const { text, calls } = fakeText(plan)
  const events: EngineEvent[] = []
  let seq = 0
  const emit = (payload: EngineEventPayload): void => {
    seq += 1
    events.push({ seq, at: 0, stage: 'planning', ...payload } as unknown as EngineEvent)
  }
  /** 全部 attempt 都没过时 `planStory` 会抛——那正是这一组用例的一半场景，接住它 */
  let error: Error | null = null
  try {
    await planStory(INPUT, { text, form: 'solo', maxAttempts, emit })
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err))
  }
  return { events, calls, error }
}

describe('规划期 retry 事件的上界', () => {
  it('每一次都坏（schema）：发 N−1 条 retry，最大 attempt 的失败只说在 fatal 里', async () => {
    const { events, calls, error } = await runPlan(['这不是 JSON'], 3)
    expect(calls()).toBe(3)

    const retries = events.filter((event) => event.kind === 'retry')
    expect(retries.map((event) => event.attempt)).toEqual([1, 2])
    // 发出去的每一条都严格小于上界——这就是"还有下一次"的判据
    for (const event of retries) expect(event.attempt ?? 0).toBeLessThan(3)

    // ★ 少发一条事件**不等于少记一次失败**：第 3 次的问题照旧在抛出来的那句里
    expect(error?.message).toContain('Schema 校验未过')
    expect(error?.message).toContain('第 3 次')
    expect((error as Error & { detail?: string[] }).detail).toHaveLength(3)
  })

  it('每一次都坏（树形）：同一条纪律', async () => {
    const { events, calls } = await runPlan([BAD_TREE], 2)
    expect(calls()).toBe(2)

    const retries = events.filter((event) => event.kind === 'retry')
    expect(retries.map((event) => event.attempt)).toEqual([1])
  })

  it('只剩一次机会时一条 retry 都不发（它本来是句空头承诺）', async () => {
    const { events, calls } = await runPlan(['这不是 JSON'], 1)

    expect(calls()).toBe(1)
    expect(events.filter((event) => event.kind === 'retry')).toEqual([])
  })

  it('内容审核没过那一处也一样（三处同形）', async () => {
    const { events, calls } = await runPlan([FLAGGED], 2)
    expect(calls()).toBe(2)

    const retries = events.filter((event) => event.kind === 'retry')
    expect(retries.map((event) => event.attempt)).toEqual([1])
    // 那条话里要带条款 id（判据 5）：R-01 是「血」命中那一条
    const first = retries[0]
    expect(first?.kind === 'retry' ? first.reason : '').toContain('R-01')
  })

  it('一次就过的那种书：一条 retry 也没有（这条从来没错过，钉住它别被改坏）', async () => {
    const { events, calls } = await runPlan([GOOD], 3)

    expect(calls()).toBe(1)
    expect(events.filter((event) => event.kind === 'retry')).toEqual([])
    expect(events.at(-1)?.kind).toBe('plan-ready')
  })
})
