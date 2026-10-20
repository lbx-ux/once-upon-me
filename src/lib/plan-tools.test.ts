/**
 * plan-tools.test.ts —— 编故事那一步的四件工具
 *
 * 这一组用例盯三件事：
 *
 * 1. `check_draft` 是双向的：越线的正文要指出具体条款号，
 *    一段正常正文一条都不报。只测一边的话，一个"永远回没通过"的实现会全绿——
 *    而它在这个产品里的后果是每本书都编不出来。
 *    （这个项目在「空值算不算错」那一族上付过学费，`known-tradeoffs.md` 有。）
 * 2. 空语料是合法结果，不是失败。`search_past_stories` 取不到东西时
 *    要说得清"这次没有可参考的"，而不是抛、也不是回一个空串——
 *    空串在模型那边读起来像"被打断了"。
 * 3. 复用而不是另写：`read_shelf` 数的是这个孩子的书（按卡号筛），
 *    `search_past_stories` 走的是 `rag/retrieve.ts` 的同一份排序与阈值。
 *
 * 语料是注入的（`seed` / `own`），所以这一组不读盘、不打网络。
 */

import { describe, expect, it } from 'vitest'

import { planToolsOf, type PlanToolsContext } from './plan-tools.ts'
import { createMemoryStore } from './engine/providers/stores.ts'
import { SOURCE_BOUNDARY_LINE } from './rag/prompt.ts'
import type { RagChunk, RagIndex } from './rag/corpus.ts'
import type { CharacterCard } from './engine/index.ts'
import type { ToolDef } from './engine/tool-loop.ts'

/* 夹具 */

const CARD: CharacterCard = {
  schemaVersion: 1,
  cardId: 'xiaoman-sheet',
  childId: 'xiaoman',
  revision: 1,
  anchors: [
    { slot: 'bone', value: '圆脸、下颌线软' },
    { slot: 'eyes', value: '深棕圆眼' },
    { slot: 'hair', value: '黑直短发，左上翘一撮' },
    { slot: 'build', value: '头身比约 1:4' },
    { slot: 'skin', value: '暖黄偏深' },
  ],
  style: { key: 'warm-handdrawn', promptFragment: '温暖手绘水彩', ratio: '3:2' },
  reference: {
    path: 'cards/xiaoman-sheet/ref.deadbeef.png',
    digest: 'deadbeef',
    bytes: 4,
    mime: 'image/png',
  },
  provenance: { modelId: 'fake-image', promptVersion: 'card@v1', cardRevision: 1, generatedAt: 0 },
  createdAt: 0,
}

function chunk(id: string, text: string, overrides: Partial<RagChunk> = {}): RagChunk {
  return {
    id,
    kind: 'spread',
    owner: 'library',
    ageBand: '4-6',
    theme: 'dino',
    form: '*',
    text,
    source: `样书${id}`,
    ...overrides,
  }
}

const SEED: RagIndex = {
  corpusVersion: 'test00000000',
  builtAt: 0,
  chunks: [
    chunk('library/dino#s1', '小果走进林子，蕨叶比她还高，叶尖挂着露水，林子里很安静。'),
    chunk('library/dino#s2', '她蹲下来看一只小恐龙，它的脚很短，尾巴上有一道浅色的印。'),
  ],
}

function tools(overrides: Partial<PlanToolsContext> = {}): Map<string, ToolDef> {
  const context: PlanToolsContext = {
    store: createMemoryStore(),
    owner: 'u/1',
    card: CARD,
    query: { ageBand: '4-6', theme: 'dino', form: 'solo' },
    seed: SEED,
    own: [],
    ...overrides,
  }
  return new Map(planToolsOf(context).map((one) => [one.spec.name, one]))
}

const CARD_KEYS = ['search_past_stories', 'read_shelf', 'check_draft', 'character_brief']

/** 把"同步抛也行、异步拒也行"统一成被拒的 promise（见那条断言上的注释） */
function thrownBy(list: Map<string, ToolDef>, name: string, args: unknown): Promise<unknown> {
  const tool = list.get(name)
  if (!tool) throw new Error(`夹具里没有 ${name}`)
  return Promise.resolve().then(() => tool.run(args))
}

/* 形状 */

describe('四件工具的形状', () => {
  it('名字与 spec 里那张表对得上', () => {
    expect([...tools().keys()]).toEqual(CARD_KEYS)
  })

  it('每条的 parameters 都是合法 JSON Schema，且必填项真的被校验', async () => {
    const list = tools()
    for (const tool of list.values()) {
      expect(tool.spec.parameters['type']).toBe('object')
      expect(tool.spec.description.length).toBeGreaterThan(20)
    }
    // ★ `ToolDef.run` 允许是同步的（`Promise<string> | string`），所以这里不能直接
    //   用 `.rejects`——同步抛出会在拿到 promise 之前就落地，而失败现场会变成
    //   "测试自己写错了"。包一层 `Promise.resolve().then(...)`，两种形状都接得住。
    await expect(thrownBy(list, 'check_draft', {})).rejects.toThrow(/text/)
    await expect(thrownBy(list, 'search_past_stories', {})).rejects.toThrow(/query/)
  })
})

/* check_draft：双向 */

describe('★ check_draft 的判据是双向的', () => {
  it('越线的正文要**指出具体条款号**', async () => {
    const text = await tools().get('check_draft')?.run({ text: '他看见地上有一摊血。' })
    expect(text).toMatch(/R-\d\d/) // 条款 id，判据 5 要的"具体到哪一条"
    expect(text).toContain('没通过')
  })

  it('★ 一段正常正文**一条都不报**，而且说得清"可以"（不是空串）', async () => {
    const text = await tools().get('check_draft')?.run({
      text: '小满把伞举过头顶，雨点打在伞面上，像有人在轻轻敲门。',
    })
    expect(text).toContain('通过了')
    // 空串会让模型以为"被打断了"；判据要的是它读得出"这段可以用"
    expect(text).not.toBe('')
  })

  it('空白文本不报问题（`reviewText` 就是这么定的，这里不重新判一遍）', async () => {
    const text = await tools().get('check_draft')?.run({ text: '   ' })
    expect(text).toContain('通过了')
  })
})

/* search_past_stories */

describe('search_past_stories', () => {
  it('查得到时给出正例，并带上"为什么是它"', async () => {
    const text = await tools().get('search_past_stories')?.run({ query: '走进林子 蕨叶 露水' })
    expect(text).toContain('可以照着写的')
    expect(text).toContain('走进林子')
  })

  it('★ 空语料是**合法结果**，不是失败——说得出"这次没有可参考的"', async () => {
    const empty = tools({ seed: { corpusVersion: 'empty', builtAt: 0, chunks: [] }, own: [] })
    const text = await empty.get('search_past_stories')?.run({ query: '完全不相干的查法' })
    expect(text).toContain('没有')
    expect(text).toContain('照常往下写')
    // 不许写成"检索失败"：那会让模型去重试、绕路
    expect(text).not.toContain('失败')
  })

  it('k 越界被挡住，且报出边界', async () => {
    await expect(
      thrownBy(tools(), 'search_past_stories', { query: '林子', k: 99 }),
    ).rejects.toThrow(/1–10/)
  })

  it('★ 他自己写过的段落会进「他读过的」那一侧（反例只从这一片取）', async () => {
    const mine = chunk('u/1/books/bk_ab#p1', '小果走进林子，蕨叶比她还高。', {
      owner: 'u/1',
      kind: 'page',
      theme: '*',
    })
    const list = tools({ own: [mine] })
    const text = await list.get('search_past_stories')?.run({ query: '走进林子 蕨叶' })
    expect(text).toContain('他读过的')
  })

  /**
   * 返回文本是模型输入，所以它要带那句数据 / 指令分界（2026-10-20）。
   *
   *   这一格与规划里的预检索吃的是同一份素材——正例里有一半以上来自家长
   *   自己家里那几本书的 `story.json`，而那一份家长可以逐字改。所以"这些字是
   *   素材不是指令"这件事在两个入口各说一次，而措辞只有一处
   *   （`rag/prompt.ts` 的 `SOURCE_BOUNDARY_LINE`）——判据从这里现取，
   *   不抄字面：另写一份的话，改了一边另一边就漂。
   */
  it('★ 返回文本带数据 / 指令分界，且与预检索那一段共用同一句', async () => {
    const text = await tools().get('search_past_stories')?.run({ query: '走进林子 蕨叶 露水' })
    expect(text).toContain(SOURCE_BOUNDARY_LINE)
    // 位置：声明要排在素材之前（排在后面就成了对已读内容的一句附注）
    expect(text?.indexOf(SOURCE_BOUNDARY_LINE)).toBeLessThan(text?.indexOf('可以照着写的') ?? -1)
  })

  /**
   * 反面的一半：没有素材时不留一句声明（与 `retrievalBlock` 空结果回空串
   *   同一条纪律）。判据落在"那句分界不出现"，因为"空结果也要声明"是一种
   *   看起来更安全的写法，而它会让模型读到一段没有对象的警告。
   */
  it('★ 没有可参考的片段时，那句分界不出现（不是常驻声明）', async () => {
    const empty = tools({ seed: { corpusVersion: 'empty', builtAt: 0, chunks: [] }, own: [] })
    const text = await empty.get('search_past_stories')?.run({ query: '完全不相干的查法' })
    expect(text).not.toContain(SOURCE_BOUNDARY_LINE)
  })
})

/* read_shelf */

describe('read_shelf', () => {
  it('一本都没有时说得清"这是第一本"', async () => {
    const text = await tools().get('read_shelf')?.run({})
    expect(text).toContain('第一本')
  })

  it('★ 只数**这个孩子**的书（按卡号筛），不是整个账号的', async () => {
    const store = createMemoryStore()
    await store.putJson({
      path: 'books/mine/book.json',
      value: { bookId: 'mine', cardId: CARD.cardId, tree: { title: '我的第一本' } },
    })
    await store.putJson({
      path: 'books/other/book.json',
      value: { bookId: 'other', cardId: 'someone-else', tree: { title: '别人的' } },
    })
    const text = await tools({ store }).get('read_shelf')?.run({})
    expect(text).toContain('我的第一本')
    expect(text).not.toContain('别人的')
  })
})

/* character_brief */

describe('character_brief', () => {
  it('回的是**画师会拿到的那一段**与核对清单，不是八条锚点的原文', async () => {
    const text = await tools().get('character_brief')?.run({})
    expect(text).toContain('温暖手绘水彩') // promptFragmentOf 的产物
    expect(text).toContain('核对')
    // 锚点原文本来就在规划提示词里，这条工具的价值正是"另一部分"
    expect(text).toContain('出图提示词的开头')
  })
})

/* 不写盘 */

describe('★ 四件工具都不写盘', () => {
  it('跑完一轮之后 store 里一条新路径都没有', async () => {
    const store = createMemoryStore()
    const list = tools({ store })
    for (const tool of list.values()) {
      const args =
        tool.spec.name === 'check_draft'
          ? { text: '小满把伞举过头顶。' }
          : tool.spec.name === 'search_past_stories'
            ? { query: '走进林子' }
            : {}
      await tool.run(args)
    }
    expect(await store.list('')).toEqual([])
  })
})
