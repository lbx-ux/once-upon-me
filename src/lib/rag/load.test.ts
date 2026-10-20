/**
 * load.test.ts —— 语料从盘上到检索器这一段（`.scratch/rag` 工单 04）
 *
 * 这一份测的是 `rag/` 里唯一碰文件系统的那一层，三条：
 *
 * 1. **种子索引真的读得出来**（96 条）。★ 这是**路径解析**唯一的守卫：
 *    它走 `process.cwd()`，而 `import.meta.url` 在 Next 的服务端 bundle 里指向打包产物——
 *    写错的话线上是"检索永远没东西"，而所有纯函数测试照样全绿。
 * 2. **② 现场扫**：一个家庭自己的书 → chunks；读不出来的那一本**跳过**，
 *    不让它把整次检索带走（与 `library.ts` "一本读不出来的书不该让整个书架 500"同一条）。
 * 3. **合成**：种子 + 自家，`corpusVersion` 留种子那一份；owner 边界从这里也守得住。
 */

import { describe, expect, it } from 'vitest'

import { createMemoryStore } from '../engine/providers/stores.ts'
import { storyPathOf, type StoryDraft } from '../story-draft.ts'
import { buildRagIndex, type RagChunk } from './corpus.ts'
import {
  createPlanRetriever,
  loadSeedIndex,
  ownChunksOf,
  ownerOf,
  queryTextOf,
  resetSeedIndexCache,
  seedIndexPath,
} from './load.ts'

/** 一本**写完了故事、还没画**的书（`story.json` 的形状） */
function draftOf(bookId: string, title: string, theme: string): StoryDraft {
  return {
    bookId,
    input: {
      child: {
        childId: 'c1',
        name: '小乐',
        nameReading: 'xiǎo lè',
        ageBand: '4-6',
        gender: 'girl',
        lookTags: [],
        interestTags: [],
      },
      cardId: 'card-1',
      cardRevision: 1,
      theme,
      wish: '云',
      form: 'solo',
    },
    doc: {
      title,
      nodes: [
        {
          scene: '客厅里的纸箱',
          body: ['纸箱火箭摆在客厅中间。', '她给妈妈留了一个座位。'],
          imagePrompt: '客厅里的纸箱火箭',
          mood: 'joy',
        },
        {
          scene: '数到三就出发',
          body: ['她数到三，火箭就动了。'],
          imagePrompt: '孩子骑在纸箱上',
          mood: 'wonder',
        },
      ],
    },
    provenance: { modelId: 'fake', promptVersion: 'story-plan@v4', attempts: 1 },
    planMs: 10,
    createdAt: 1,
  }
}

describe('种子索引：读得出来（路径解析的唯一守卫）', () => {
  it('`seedIndexPath()` 指到仓库里那一份', () => {
    expect(seedIndexPath().replaceAll('\\', '/')).toMatch(/src\/lib\/rag\/index\.seed\.json$/)
  })

  it('读出来是 96 条，而且**缓存**（第二次是同一个对象）', async () => {
    resetSeedIndexCache()
    const first = await loadSeedIndex()
    expect(first.chunks).toHaveLength(96)
    expect(first.corpusVersion).toBe('adfab4685031')
    expect(await loadSeedIndex()).toBe(first)
  })
})

describe('② 创作史：现场扫这一片存储', () => {
  it('一本两页的书 → 两个 chunk，id 带 owner 前缀', async () => {
    const store = createMemoryStore()
    await store.putJson({
      path: storyPathOf('bk_x'),
      value: draftOf('bk_x', '小雨的火箭', 'rocket'),
    })

    const chunks = await ownChunksOf(store, 'u/12')
    expect(chunks.map((chunk) => chunk.id)).toEqual(['u/12/books/bk_x#p1', 'u/12/books/bk_x#p2'])
    expect(chunks[0]?.text).toContain('纸箱火箭摆在客厅中间')
    expect(chunks[0]?.source).toBe('《小雨的火箭》第 1 页')
    // 主题与形态来自草稿（`story.json` 的 input），缺失才填通配
    expect(chunks[0]?.theme).toBe('rocket')
    expect(chunks[0]?.form).toBe('solo')
  })

  it('★ 半截 JSON 的那一本**跳过**，不让它把整次检索带走', async () => {
    const store = createMemoryStore()
    await store.putJson({
      path: storyPathOf('bk_good'),
      value: draftOf('bk_good', '好的那本', 'cloud'),
    })
    // 进程被杀时最后写的那一件就是这个形状（`library.ts` 记过这件事）
    await store.put({
      path: storyPathOf('bk_half'),
      bytes: new Uint8Array([123, 34]),
      mime: 'application/json',
    })

    const chunks = await ownChunksOf(store, 'u/12')
    expect(chunks.every((chunk) => chunk.id.startsWith('u/12/books/bk_good'))).toBe(true)
    expect(chunks).toHaveLength(2)
  })

  it('一片空存储 → 空数组（不是抛错）：头一本书就是这个样子', async () => {
    expect(await ownChunksOf(createMemoryStore(), 'u/12')).toEqual([])
  })

  /**
   * ★ 只过了**信封**的草稿不能让检索停摆（2026-10-20 修的）。
   *
   *   `readStory` 用的是 `isStoryDoc`——它只认"title 是字符串、nodes 是对象数组"，
   *   而 `PUT /api/books/<id>/story` 正是拿它把关的。所以盘上**真的可能出现**
   *   `{"nodes":[{}]}` 和 `{"nodes":[{"scene":123}]}` 这两种。
   *   修之前 `chunksFromStoryBook` 一句 `page.scene.trim()` 当场抛，
   *   抛出去被 `plan.ts` 的 `retrieveOnce` 接住（那一步刻意不拖垮规划）——
   *   于是症状是**这一片存储的检索从此永远不工作**，而屏幕上只有"这次没检索到"。
   *   判据因此两边都要：**不抛**，而且**好的那几页照常出来**。
   */
  it('★ 一页存成 `{}` 的草稿不会让整片检索停摆，好页照常出来', async () => {
    const store = createMemoryStore()
    await store.putJson({
      path: storyPathOf('bk_empty_node'),
      value: {
        ...draftOf('bk_empty_node', '缺字段的那本', 'cloud'),
        doc: { title: '缺字段的那本', nodes: [{}] },
      },
    })
    const chunks = await ownChunksOf(store, 'u/12')
    // 那一页一个字都没有 → 它本来就不是语料（与"空的跨页不产 chunk"同一条）
    expect(chunks).toEqual([])
  })

  it('★ 字段类型写错了（`scene` 是数字）也只跳过那一页，不抛', async () => {
    const store = createMemoryStore()
    await store.putJson({
      path: storyPathOf('bk_bad_type'),
      value: {
        ...draftOf('bk_bad_type', '类型写错的那本', 'cloud'),
        doc: { title: '类型写错的那本', nodes: [{ scene: 123, body: [7, '还留着的一句话。'] }] },
      },
    })
    const chunks = await ownChunksOf(store, 'u/12')
    expect(chunks).toHaveLength(1)
    // ★ 兜成空串而不是补一个默认值：缺的就是缺的（同 `RagChunk` 那条纪律）
    expect(chunks[0]?.text).toBe('还留着的一句话。')
  })
})

describe('合成：种子 + 自家', () => {
  const SEED = buildRagIndex(
    [
      {
        id: 'library/cloud#s1',
        kind: 'spread',
        owner: 'library',
        ageBand: '4-6',
        theme: 'cloud',
        form: '*',
        text: '云在变\n天上有一朵云，正在慢慢地变形状。',
        source: '样书《小飞看见的那朵云》第 2 跨页 · 云在变',
      },
    ],
    0,
  )

  const input = {
    childName: '小乐',
    nameReading: 'xiǎo lè',
    ageBand: '4-6' as const,
    interestTags: ['云'],
    lookTags: [],
    theme: 'cloud',
    wish: '云变成一只乌龟',
    form: 'solo' as const,
    pages: 3,
  }

  it('正例取到样书、反例取到自家的旧书，`corpusVersion` 留种子那一份', async () => {
    const store = createMemoryStore()
    await store.putJson({
      path: storyPathOf('bk_old'),
      value: draftOf('bk_old', '云上的船', 'cloud'),
    })

    const retriever = createPlanRetriever({ store, owner: 'u/12', seed: SEED, minScore: 0 })
    const result = await retriever(input)

    expect(result.corpusVersion).toBe(SEED.corpusVersion)
    // ★ 这一条测的是**合成与归属**，所以 `minScore: 0`（谁来都得留着）。
    //   阈值是另一件事：`idf` 随语料条数变，**2 条文档的测试索引上"1 分"是很高的门槛**
    //   （实测：一个只在一半文档里出现的 bigram 在这份索引上大约 0.8 分，
    //   而在真语料 96 条上约 4.2 分）。阈值凭直觉设一次就会踩到这个坑，
    //   所以它由工单 06 在真语料上量出来，不在这一层猜。
    expect(result.pair.examples.map((hit) => hit.chunk.id)).toEqual(['library/cloud#s1'])
    expect(result.pair.avoids.map((hit) => hit.chunk.id)).toEqual([
      'u/12/books/bk_old#p1',
      'u/12/books/bk_old#p2',
    ])
  })

  it('★ owner 是硬边界：别人家的 chunk 就算塞进索引也取不到', async () => {
    const foreign: RagChunk = {
      id: 'u/999/books/bk_theirs#p1',
      kind: 'page',
      owner: 'u/999',
      ageBand: '4-6',
      theme: 'cloud',
      form: 'solo',
      text: '云变成一只小狗，别人家的孩子也在看云。',
      source: '《别人家的云》第 1 页',
    }
    const retriever = createPlanRetriever({
      store: createMemoryStore(),
      owner: 'u/12',
      seed: SEED,
      own: [foreign],
      minScore: 0,
    })
    const result = await retriever(input)
    expect(result.pair.avoids).toEqual([])
    expect(result.pair.examples.some((hit) => hit.chunk.id.includes('u/999'))).toBe(false)
  })
})

describe('两个小工具', () => {
  it('`ownerOf`：拼得出 `u/<id>`，**空 userId 当场炸**（不许拼出 u/undefined）', () => {
    expect(ownerOf('12')).toBe('u/12')
    expect(() => ownerOf('')).toThrow(/没有归属/)
    expect(() => ownerOf(undefined)).toThrow(/没有归属/)
  })

  it('查询串：主题键不进（它对不上中文语料，只会让长度变得无意义）', () => {
    expect(
      queryTextOf({
        theme: 'cloud',
        wish: '云变成乌龟',
        reviseNote: '结局改成飞起来',
        interestTags: ['云', '恐龙'],
      }),
    ).toBe('云变成乌龟 结局改成飞起来 云 恐龙')
    expect(queryTextOf({ interestTags: [] })).toBe('')
  })

  it('★ 认不出来的主题**是内容**，要进（那一档的 theme 就是家长那句话）', () => {
    // 实测逼出来的：`engine-run --retrieve` 第一次什么都没取到——它只传了标签，
    // 而 theme 那半句被整条丢掉了
    expect(queryTextOf({ theme: '第一次离开家也不怕', interestTags: ['云'] })).toBe(
      '第一次离开家也不怕 云',
    )
    // 中文名（界面送的那一种）是**主题**，不进查询串（它已经由过滤器管了）
    expect(queryTextOf({ theme: '云', interestTags: [] })).toBe('')
  })
})
