/**
 * book-progress.test.ts —— 断点文件那层形状判据（2026-10-30）
 *
 * 两条判据，各自对应一种"退错"：
 *   1. **读坏了当没有**。半截 JSON 是进程被杀时最后写的那一件的真实形状——
 *      它不是错误，是"没有断点"。当成错误抛，用户就得先删书才能重做。
 *   2. **认不出的形状当没有**。缺 `pageNo` 的断点会让"跳过这一页"悄悄成立，
 *      而盘上根本没有那张图——用户拿到一本缺页的书，日志里一个字都不会提
 *      （与 `lib/admin/state.ts` 那句"半份比没有更坏"同一条）。
 *
 * 第三条盯的是指纹：故事一改，断点必须作废。
 */

import { describe, expect, it } from 'vitest'

import { createMemoryStore } from './engine/providers/stores.ts'
import {
  asProgress,
  progressPathOf,
  readProgress,
  storyDigestOf,
  writeProgress,
} from './book-progress.ts'
import type { StoryTree } from './engine/domain.ts'

const TREE: StoryTree = {
  form: 'solo',
  title: '小乐的绿天空',
  rootId: 'n1',
  nodes: [
    {
      id: 'n1',
      pageNo: 1,
      scene: '她把天空涂成绿色',
      body: ['她把天空涂成了绿色。'],
      imagePrompt: '小女孩站在窗前，窗外一整片绿',
      mood: 'wonder',
    },
  ] as unknown as StoryTree['nodes'],
}

describe('断点', () => {
  it('写进去、读回来，是同一份', async () => {
    const store = createMemoryStore()
    await writeProgress(store, 'book-a', {
      digest: storyDigestOf(TREE),
      illustrations: [],
      cover: null,
      narrations: [],
    })

    const read = await readProgress(store, 'book-a')
    expect(read?.digest).toBe(storyDigestOf(TREE))
    expect(read?.illustrations).toEqual([])
    expect(read?.cover).toBeNull()
  })

  it('没有断点 / 读坏了 → null（不是错误）', async () => {
    const store = createMemoryStore()
    expect(await readProgress(store, 'no-such')).toBeNull()

    await store.put({
      path: progressPathOf('book-b'),
      bytes: new TextEncoder().encode('{"digest": "abc", 半截'),
      mime: 'application/json',
    })
    expect(await readProgress(store, 'book-b')).toBeNull()
  })

  it('认不出的形状 → null，不猜', () => {
    expect(asProgress(null)).toBeNull()
    expect(
      asProgress({ schemaVersion: 2, digest: 'd', illustrations: [], cover: null, narrations: [] }),
    ).toBeNull()
    // 少一页的 asset：最坏的那一种——跳过了，而盘上没有图
    expect(
      asProgress({
        schemaVersion: 1,
        digest: 'd',
        illustrations: [{ pageNo: 1, attempt: 1, provenance: {} }],
        cover: null,
        narrations: [],
      }),
    ).toBeNull()
  })

  it('故事改一个字，指纹就变（断点作废）', () => {
    const changed: StoryTree = {
      ...TREE,
      nodes: [{ ...TREE.nodes[0], scene: '她把天空涂成蓝色' }] as unknown as StoryTree['nodes'],
    }
    expect(storyDigestOf(TREE)).not.toBe(storyDigestOf(changed))
  })
})
