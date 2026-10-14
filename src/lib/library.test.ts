/**
 * library.test.ts —— 书架摘要：每个数都得来自清单本身
 *
 * 两件事值得钉住：
 *   ① **页数与"真的有图的页数"是两件事**。一本 20 页里 3 页没出图是可能的，
 *      把两个数合成一个，主页那句"20 页"就在撒谎（domain.ts 对"缺图 vs 未核对"
 *      警告过同一件事，别再犯第三次）。
 *   ② **只列运行期的书**，不列 `public/demo` 里随仓库提交的那本——
 *      混进来就是往"已创作故事"里灌一个假数。
 */

import { describe, expect, it } from 'vitest'

import { listBooks, summarize } from './library.ts'
import { createMemoryStore } from './engine/providers/stores.ts'
import type { Book } from './engine/index.ts'

function book(parts: Partial<Book> & { bookId: string }): Book {
  return {
    cardId: 'c1',
    cardRevision: 1,
    form: 'solo',
    tree: { form: 'solo', title: '雨天的桥', rootId: 'n1', nodes: [] },
    illustrations: [],
    errors: [],
    narrations: [],
    createdAt: 0,
    stats: {} as Book['stats'],
    ...parts,
  } as Book
}

describe('summarize', () => {
  it('页数来自故事树，有图页数来自 illustrations —— 两个数不合并', () => {
    const summary = summarize(
      book({
        bookId: 'b1',
        tree: {
          form: 'solo',
          title: 'T',
          rootId: 'n1',
          // 3 个节点
          nodes: [
            {
              nodeId: 'n1',
              pageNo: 1,
              scene: '',
              body: [],
              imagePrompt: '',
              mood: 'calm',
              next: [],
              pathFromRoot: [],
            },
            {
              nodeId: 'n2',
              pageNo: 2,
              scene: '',
              body: [],
              imagePrompt: '',
              mood: 'calm',
              next: [],
              pathFromRoot: [],
            },
            {
              nodeId: 'n3',
              pageNo: 3,
              scene: '',
              body: [],
              imagePrompt: '',
              mood: 'calm',
              next: [],
              pathFromRoot: [],
            },
          ],
        },
        // 只有 2 页有图
        illustrations: [
          {
            pageNo: 1,
            attempt: 1,
            asset: { path: 'p1', digest: 'd', bytes: 1, mime: 'image/png' },
            provenance: { modelId: 'm', promptVersion: 'v', cardRevision: 1, generatedAt: 0 },
            needsHumanReview: false,
          },
          {
            pageNo: 2,
            attempt: 1,
            asset: { path: 'p2', digest: 'd', bytes: 1, mime: 'image/png' },
            provenance: { modelId: 'm', promptVersion: 'v', cardRevision: 1, generatedAt: 0 },
            needsHumanReview: false,
          },
        ],
      }),
    )
    expect(summary.pageCount).toBe(3)
    expect(summary.illustratedCount).toBe(2)
  })

  it('有朗读看 narrations；没有就是 false（不是"未知"）', () => {
    expect(summarize(book({ bookId: 'b1' })).hasNarration).toBe(false)
    expect(
      summarize(
        book({
          bookId: 'b1',
          narrations: [
            {
              pageNo: 1,
              voiceId: 'v',
              textHash: 't',
              asset: { path: 'a', digest: 'd', bytes: 1, mime: 'audio/mpeg' },
            },
          ],
        }),
      ).hasNarration,
    ).toBe(true)
  })

  it('没有标题时给一个人话兜底，不是空字符串', () => {
    const broken = { ...book({ bookId: 'b1' }), tree: undefined } as unknown as Book
    expect(summarize(broken).title).toBe('(没有名字的书)')
  })
})

describe('listBooks', () => {
  it('只认 book.json：页图与事件日志都不算书', async () => {
    const store = await createMemoryStore()
    await store.putJson({
      path: 'books/b1/book.json',
      value: book({ bookId: 'b1', createdAt: 100 }),
    })
    await store.put({
      path: 'books/b1/page-1-a1.png',
      bytes: new Uint8Array([1]),
      mime: 'image/png',
    })
    await store.put({
      path: 'books/b1/events.jsonl',
      bytes: new Uint8Array([1]),
      mime: 'text/plain',
    })
    const books = await listBooks(store)
    expect(books.map((item) => item.bookId)).toEqual(['b1'])
  })

  it('新的在前', async () => {
    const store = await createMemoryStore()
    await store.putJson({
      path: 'books/old/book.json',
      value: book({ bookId: 'old', createdAt: 100 }),
    })
    await store.putJson({
      path: 'books/new/book.json',
      value: book({ bookId: 'new', createdAt: 900 }),
    })
    expect((await listBooks(store)).map((item) => item.bookId)).toEqual(['new', 'old'])
  })

  it('★ 一本读不出来的书不让整个书架 500（半截 JSON 当它不存在）', async () => {
    const store = await createMemoryStore()
    await store.put({
      path: 'books/broken/book.json',
      bytes: new TextEncoder().encode('{"bookId": "brok'),
      mime: 'application/json',
    })
    await store.putJson({ path: 'books/ok/book.json', value: book({ bookId: 'ok', createdAt: 5 }) })
    expect((await listBooks(store)).map((item) => item.bookId)).toEqual(['ok'])
  })

  it('一本都没有 = 空数组，不是抛错（新用户看到的就是这个）', async () => {
    expect(await listBooks(await createMemoryStore())).toEqual([])
  })
})
