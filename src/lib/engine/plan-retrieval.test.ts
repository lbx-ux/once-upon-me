/**
 * plan-retrieval.test.ts —— 检索接进规划那一路（`.scratch/rag` 工单 04）
 *
 * 这一组用例盯的是接线，不是检索本身（那是 `rag/retrieve.test.ts` 的事）。
 * 五条，每条对应一处只会悄悄坏的地方：
 *
 * 1. 没开检索时提示词逐字节不变——新能力不许改变老路径（与 `onDelta` 同一条纪律）。
 * 2. 取到东西时，那一段进提示词、且在末尾（`rag/prompt.ts` 把反例排在它自己那一段的
 *    末尾，而"最后读到的是别重样"这件事只有它在消息末尾时才成立）。
 * 3. 检索抛错不许拖垮规划，但也不许静默——两件事各发一条事件。
 * 4. 重试不再检索：三次 attempt 共用同一份（`retriever` 被调用的次数要真的是 1）。
 * 5. `planBook` 把 `deps.retriever` 递到了提示词里（这一步是纯接线，最容易断）。
 */

import { describe, expect, it } from 'vitest'

import { planBook, type BookRequest, type CharacterCard, type EngineEvent } from './index.ts'
import { planStory } from './plan.ts'
import { createMemoryStore } from './providers/stores.ts'
import type { ProviderBundle, TextGenerator, TextResponse } from './providers/types.ts'
import { EXAMPLE_HEAD, NO_COPY_LINE } from '../rag/prompt.ts'
import type { RetrievePair } from '../rag/retrieve.ts'
import { storyPlanUser, type StoryPlanInput } from '../prompts/story-plan.ts'
import type { RagChunk } from '../rag/corpus.ts'

const STORY = {
  title: '小乐的绿天空',
  nodes: [
    {
      scene: '她把天空涂成绿色',
      body: ['她把天空涂成了绿色。'],
      imagePrompt: '小女孩站在窗前，窗外一整片绿',
      mood: 'wonder',
    },
    {
      scene: '绿色从窗缝里漏出去',
      body: ['绿色顺着窗缝漏了出去。'],
      imagePrompt: '绿色的光从窗缝漏到街上',
      mood: 'joy',
    },
    {
      scene: '整座城都绿了，她困了',
      body: ['整座城都绿了。', '她合上了眼睛。'],
      imagePrompt: '绿光里的小床，孩子睡着',
      mood: 'tender',
    },
  ],
}

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

function chunk(id: string, text: string, source: string): RagChunk {
  return {
    id,
    kind: 'spread',
    owner: 'library',
    ageBand: '4-6',
    theme: 'cloud',
    form: '*',
    text,
    source,
  }
}

const PAIR: RetrievePair = {
  examples: [
    {
      chunk: chunk(
        'library/cloud#s2',
        '云在变\n天上有一朵云，正在慢慢地变形状。',
        '样书《小飞看见的那朵云》第 2 跨页 · 云在变',
      ),
      score: 9.52,
      why: '同档 4-6 · 同主题 cloud · 命中 6 个 bigram',
    },
  ],
  avoids: [
    {
      chunk: chunk(
        'u/1/books/bk_x#p1',
        '纸箱火箭\n她给妈妈留了一个座位。',
        '《小雨的火箭》第 1 页',
      ),
      score: 4.1,
      why: '你已经给他写过 · 命中 3 个 bigram',
    },
  ],
}

/**
 * 假文本：按队列回话，`prompts()` 把每一次收到的用户提示词记下来。
 *
 * 先取这一轮的回复再自增：反过来写的话第一次拿到的就是 replies[1]，
 *   那条"重试时不再检索"的用例会当场变成"一次就过"（真错过一次，红得很安静）。
 */
function fakeText(replies: readonly string[]): { text: TextGenerator; prompts: () => string[] } {
  const prompts: string[] = []
  let index = 0
  return {
    prompts: () => prompts,
    text: {
      id: 'fake-text',
      modelId: 'fake-text',
      async complete(req) {
        prompts.push(req.user ?? '')
        const response: TextResponse = {
          text: replies[Math.min(index, replies.length - 1)] ?? JSON.stringify(STORY),
          modelId: 'fake-text',
        }
        index += 1
        return response
      },
      async stream(req, _budget, onDelta) {
        prompts.push(req.user ?? '')
        const response: TextResponse = {
          text: replies[Math.min(index, replies.length - 1)] ?? JSON.stringify(STORY),
          modelId: 'fake-text',
        }
        index += 1
        onDelta({ text: response.text, streamed: false })
        return response
      },
    },
  }
}

/** 只做规划那一步的最小依赖：文本是假的，检索是假的 */
async function runPlan(
  options: {
    replies?: readonly string[]
    retrieve?: () => Promise<{ pair: RetrievePair; corpusVersion: string }>
  } = {},
): Promise<{
  events: EngineEvent[]
  prompts: string[]
  outcome: Awaited<ReturnType<typeof planStory>>
}> {
  const { text, prompts } = fakeText(options.replies ?? [JSON.stringify(STORY)])
  const events: EngineEvent[] = []
  let seq = 0
  const emit = (payload: Record<string, unknown>): void => {
    seq += 1
    events.push({ seq, at: 0, stage: 'planning', ...payload } as unknown as EngineEvent)
  }
  const outcome = await planStory(INPUT, {
    text,
    form: 'solo',
    emit,
    ...(options.retrieve ? { retrieve: options.retrieve } : {}),
  })
  return { events, prompts: prompts(), outcome }
}

describe('检索接进规划', () => {
  it('★ 没开检索时提示词逐字节不变，返回里也没有 retrieval 字段', async () => {
    const { prompts, outcome } = await runPlan()
    expect(prompts[0]).toBe(storyPlanUser(INPUT))
    expect(outcome.retrieval).toBeUndefined()
  })

  it('取到东西时：那一段进提示词、在末尾，且带红线与出处', async () => {
    const { prompts } = await runPlan({
      retrieve: async () => ({ pair: PAIR, corpusVersion: 'adfab4685031' }),
    })
    const user = prompts[0] ?? ''
    expect(user).toContain(EXAMPLE_HEAD)
    expect(user).toContain(NO_COPY_LINE)
    expect(user).toContain('样书《小飞看见的那朵云》第 2 跨页 · 云在变')
    // ★ 在末尾：它后面不该再有别的内容（`formatFailures` 那一段只在重试时追加）
    expect(user.trimEnd().endsWith('）')).toBe(true)
    // 没开检索的那一份是它的前缀（说明只是"追加了一段"，没有改动原来的字）
    expect(user.startsWith(storyPlanUser(INPUT))).toBe(true)
  })

  it('provenance：条数、最高分、正反两类都在', async () => {
    const { outcome } = await runPlan({
      retrieve: async () => ({ pair: PAIR, corpusVersion: 'adfab4685031' }),
    })
    const retrieval = outcome.retrieval
    expect(retrieval?.corpusVersion).toBe('adfab4685031')
    expect(retrieval?.examples).toBe(1)
    expect(retrieval?.avoids).toBe(1)
    expect(retrieval?.topScore).toBe(9.52)
    expect(retrieval?.hits.map((hit) => hit.polarity)).toEqual(['example', 'avoid'])
    expect(retrieval?.hits[1]?.chunkId).toBe('u/1/books/bk_x#p1')
  })

  it('空结果是合法的：没有这一段，但 provenance 说得出"这次没取到"', async () => {
    const { prompts, outcome } = await runPlan({
      retrieve: async () => ({ pair: { examples: [], avoids: [] }, corpusVersion: 'adfab4685031' }),
    })
    expect(prompts[0]).toBe(storyPlanUser(INPUT))
    expect(outcome.retrieval?.corpusVersion).toBe('adfab4685031')
    expect(outcome.retrieval?.hits).toEqual([])
    expect(outcome.retrieval?.topScore).toBeNull()
  })

  it('★ 检索抛错不拖垮规划，但两件事各发一条事件（不许静默）', async () => {
    const { prompts, events, outcome } = await runPlan({
      retrieve: async () => {
        throw new Error('索引文件不合格：缺少 corpusVersion')
      },
    })
    // 书照常编出来
    expect(outcome.attempts).toBe(1)
    expect(prompts[0]).toBe(storyPlanUser(INPUT))
    // 这一步发生过（corpusVersion 为 null），而且说得出为什么
    const retrieved = events.find((event) => event.kind === 'retrieved')
    expect(retrieved).toMatchObject({ corpusVersion: null, examples: 0, avoids: 0 })
    const error = events.find((event) => event.kind === 'error')
    expect(error).toMatchObject({ code: 'retrieval-failed', fatal: false })
    expect((error as { message: string }).message).toContain('索引文件不合格')
    // provenance 也如实记着"没跑成"，而不是"取到了 0 条"
    expect(outcome.retrieval?.corpusVersion).toBeNull()
  })

  it('★ 重试时不再检索：三次 attempt 共用一份（调用次数真的是 1）', async () => {
    let calls = 0
    const { events, outcome } = await runPlan({
      // 第一次给一张不合法的表（少一页），第二次才对
      replies: [
        JSON.stringify({ title: '太短了', nodes: [STORY.nodes[0]] }),
        JSON.stringify(STORY),
      ],
      retrieve: async () => {
        calls += 1
        return { pair: PAIR, corpusVersion: 'adfab4685031' }
      },
    })
    expect(outcome.attempts).toBe(2)
    expect(calls).toBe(1)
    // 检索那一段在第一次与第二次的提示词里都在（它进的是 baseUser，不是某一次的特例）
    expect(
      events.filter((event) => event.kind === 'stage' && event.stage === 'retrieving'),
    ).toHaveLength(1)
    expect(events.filter((event) => event.kind === 'retrieved')).toHaveLength(1)
  })
})

/* 接线：planBook 真的把 retriever 递下去了吗 */

const CARD: CharacterCard = {
  schemaVersion: 1,
  cardId: 'test-card',
  childId: 'test-child',
  revision: 1,
  anchors: [
    { slot: 'bone', value: '圆脸、下颌线软' },
    { slot: 'eyes', value: '深棕圆眼' },
    { slot: 'hair', value: '黑直短发' },
    { slot: 'build', value: '头身比约 1:4' },
    { slot: 'skin', value: '暖黄偏深' },
  ],
  style: { key: 'warm-handdrawn', promptFragment: '温暖手绘', ratio: '1:1' },
  reference: { path: 'cards/test/ref.png', digest: 'deadbeef0000', bytes: 3, mime: 'image/png' },
  provenance: { modelId: 'fake-image', promptVersion: 'card@v1', cardRevision: 1, generatedAt: 0 },
  createdAt: 0,
}

const REQUEST: BookRequest = {
  child: {
    childId: 'test-child',
    name: '小乐',
    nameReading: 'xiǎo lè',
    ageBand: '4-6',
    gender: 'girl',
    lookTags: ['短发'],
    interestTags: ['云'],
  },
  card: CARD,
  theme: 'cloud',
  wish: '一朵云变来变去',
  form: 'solo',
  pages: 3,
}

describe('★ planBook 把 retriever 递到了提示词里', () => {
  it('用户提示词里出现范例段，且返回的 StoryPlan 带 retrieval', async () => {
    const { text, prompts } = fakeText([JSON.stringify(STORY)])
    const providers = {
      mode: 'offline',
      text,
      image: null,
      vision: null,
      voice: null,
      store: createMemoryStore(),
    } as unknown as ProviderBundle

    const plan = await planBook(REQUEST, {
      providers,
      retriever: async () => ({ pair: PAIR, corpusVersion: 'adfab4685031' }),
    })

    expect(prompts()[0]).toContain(EXAMPLE_HEAD)
    expect(plan.retrieval?.corpusVersion).toBe('adfab4685031')
    expect(plan.retrieval?.hits).toHaveLength(2)
  })
})
