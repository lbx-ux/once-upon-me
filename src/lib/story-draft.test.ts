/**
 * story-draft.test.ts —— 故事草稿的**存与读**（闸门那一份盘上状态）
 *
 * 这一层是"编故事"与"逐页画"之间唯一的连接物：中间隔着家长看故事的那几分钟、
 * 甚至隔着一次刷新。所以它要钉住的不是"能存进去"，而是**存进去的东西读得回来、
 * 而且读回来的就是原来那一份**——两件事缺一件，症状都是"我改的字没了"。
 *
 * 三组：
 *
 * 1. **信封的边界**：盘上的东西不可信（半截 JSON、别人塞的文件、字段类型不对）。
 *    判据与写的那一侧**同一个函数**（`isStoryDoc`）——写下去一份读不回来的东西，
 *    症状是"存上了、刷新之后这一本没了"。
 * 2. **故事内容不在这里校验**。家长把一页正文删空、正要重写的那几秒里存盘不该失败
 *    （见文件头那段）；那件事由 `story-problems.ts` 在界面上与服务端那一关管。
 * 3. **`editedAt` 的三态**：没改过（没有这个字段）/ 改过（有）/ 重写之后（又没有了）。
 */

import { describe, expect, it } from 'vitest'

import { createMemoryStore } from './engine/providers/stores.ts'
import {
  asStoryDraft,
  isStoryDoc,
  readStory,
  storyInputOf,
  storyPathOf,
  storyRequestOf,
  writeStory,
  type StoryDraft,
} from './story-draft.ts'
import type { CharacterCard } from './engine/index.ts'

function draft(parts: Partial<StoryDraft> = {}): StoryDraft {
  return {
    bookId: 'b1',
    input: {
      child: {
        childId: 'k1',
        name: '小乐',
        nameReading: 'xiǎo lè',
        ageBand: '4-6',
        lookTags: [],
        interestTags: [],
      },
      cardId: 'c1',
      cardRevision: 3,
      theme: '绿天空',
      wish: '想飞',
      form: 'solo',
      pages: 8,
      voiceId: 'v1',
      status: 'draft',
    },
    doc: {
      title: '小乐的绿天空',
      nodes: [
        { scene: '一', body: ['a'], imagePrompt: 'p', mood: 'calm' },
        { scene: '二', body: ['b'], imagePrompt: 'p', mood: 'calm' },
        { scene: '三', body: ['c'], imagePrompt: 'p', mood: 'calm' },
      ],
    },
    provenance: { modelId: 'm1', promptVersion: 'story-plan@v2', attempts: 2 },
    planMs: 1234,
    createdAt: 1000,
    ...parts,
  }
}

const CARD = { cardId: 'c1', revision: 3 } as CharacterCard

describe('storyPathOf', () => {
  it('落在这一本自己的目录里（与 book.json / events.jsonl 同一个家）', () => {
    expect(storyPathOf('b1')).toBe('books/b1/story.json')
  })
})

describe('writeStory / readStory', () => {
  it('存进去的读回来逐字段相等', async () => {
    const store = await createMemoryStore()
    await writeStory(store, draft())
    expect(await readStory(store, 'b1')).toEqual(draft())
  })

  it('★ 盘上没有、半截 JSON、信封不对：三种都当"这里没有草稿"，不抛', async () => {
    const store = await createMemoryStore()
    expect(await readStory(store, 'none')).toBeNull()

    await store.put({
      path: 'books/half/story.json',
      bytes: new TextEncoder().encode('{"bookId": "ha'),
      mime: 'application/json',
    })
    expect(await readStory(store, 'half')).toBeNull()

    // 有 doc 但 doc 的形状不对（title 不是字符串）
    await store.putJson({
      path: 'books/s1/story.json',
      value: { doc: { title: 7, nodes: [] }, input: { cardId: 'c1', child: {} } },
    })
    expect(await readStory(store, 's1')).toBeNull()

    // 缺 input（旧版本写的文件、或者别人手工塞的）
    await store.putJson({
      path: 'books/s2/story.json',
      value: { doc: { title: 'T', nodes: [] } },
    })
    expect(await readStory(store, 's2')).toBeNull()
  })

  it('★ 内容坏掉的草稿**照读不误**：那正是家长改到一半的样子', async () => {
    const store = await createMemoryStore()
    // 三页里有一页正文是空的、标题只有一个字——全都过不了 `planDraftCodec`
    await writeStory(
      store,
      draft({
        doc: {
          title: '绿',
          nodes: [
            { scene: '一', body: [''], imagePrompt: 'p', mood: 'calm' },
            { scene: '二', body: ['b'], imagePrompt: 'p', mood: 'calm' },
            { scene: '三', body: ['c'], imagePrompt: 'p', mood: 'calm' },
          ],
        },
      }),
    )
    const back = await readStory(store, 'b1')
    expect(back?.doc.title).toBe('绿')
    expect(back?.doc.nodes[0]?.body).toEqual([''])
  })

  it('`editedAt` 三态：没有 = 一个字没动', async () => {
    const store = await createMemoryStore()
    await writeStory(store, draft())
    expect(await readStory(store, 'b1')).not.toHaveProperty('editedAt')

    await writeStory(store, draft({ editedAt: 5000 }))
    expect((await readStory(store, 'b1'))?.editedAt).toBe(5000)
  })

  it('写坏了（盘上的东西不是 JSON）时 readStory 回 null，不抛', async () => {
    const store = await createMemoryStore()
    await store.putJson({ path: 'books/b1/story.json', value: { nope: true } })
    expect(await readStory(store, 'b1')).toBeNull()
  })
})

describe('isStoryDoc（读与写共用的那一条判据）', () => {
  it('书名是字符串 + 每页是对象才算数', () => {
    expect(isStoryDoc({ title: 'T', nodes: [] })).toBe(true)
    expect(isStoryDoc({ title: 'T', nodes: [{ scene: 'x' }] })).toBe(true)
    expect(isStoryDoc({ title: 'T' })).toBe(false)
    expect(isStoryDoc({ title: 1, nodes: [] })).toBe(false)
    expect(isStoryDoc({ title: 'T', nodes: ['x'] })).toBe(false)
    expect(isStoryDoc(null)).toBe(false)
    expect(isStoryDoc([])).toBe(false)
  })
})

describe('storyInputOf / storyRequestOf', () => {
  it('卡号与**解析过的那一版**一起记下来（请求里可以不给版号）', () => {
    const input = storyInputOf(
      {
        child: {
          childId: 'k1',
          name: '小乐',
          nameReading: 'xiǎo lè',
          ageBand: '4-6',
          lookTags: [],
          interestTags: [],
        },
        cardId: 'c1',
        theme: '绿天空',
        form: 'solo',
        pages: 8,
        status: 'draft',
      },
      3,
    )
    expect(input.cardRevision).toBe(3)
    // ★ 没给的字段**不进对象**（与请求体那几个可选字段同一条写法）：
    //   一个 `wish: undefined` 与"没有 wish"在读代码时是两件事
    expect(input).not.toHaveProperty('wish')
    expect(input).not.toHaveProperty('voiceId')
  })

  it('①的输入 + 现读的卡 → 引擎要的那份请求', () => {
    const request = storyRequestOf(draft().input, CARD)
    expect(request.card).toBe(CARD)
    expect(request.theme).toBe('绿天空')
    expect(request.wish).toBe('想飞')
    expect(request.voiceId).toBe('v1')
    expect(request.status).toBe('draft')
  })

  it('asStoryDraft：`bookId` 缺省取目录名（盘上的字段不可信）', () => {
    const raw = { doc: { title: 'T', nodes: [] }, input: { cardId: 'c1', child: {} } }
    expect(asStoryDraft(raw, 'from-dir')?.bookId).toBe('from-dir')
    expect(asStoryDraft({ ...raw, bookId: 'written' }, 'from-dir')?.bookId).toBe('written')
  })
})
