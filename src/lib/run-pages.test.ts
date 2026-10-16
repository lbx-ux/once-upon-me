/**
 * run-pages.test.ts —— 一本书 → 运行视图上那两个弹窗要的每页数据（工单 08）
 *
 * 四条判据，前两条是这一层存在的理由：
 *
 * 1. ★ **`prompt` 必须是真正会发出去的那一份**。它由 `pagePrompt()` 现算，
 *    与 `illustrateNode` 是**同一个函数**——这个弹窗的全部价值就是
 *    "我看到的就是它发给模型的"。在这里另拼一遍，屏幕上显示的和实际发出去的
 *    从第一天起就会分家，而没有任何测试会红。
 * 2. ★ **`prompt` 里不含家长补充的那一句**。补充是"这一次"才有的、还没发生；
 *    写进去的话，弹窗会把用户上一次的补充当成"原来的提示词"再显示一遍。
 * 3. **"这一页没做出来"要看 `errors`**，不能只看有没有 illustration 条目
 *    （`readerPages` 写过同一条：硬失败页在 `illustrations` 里也可能有条目）。
 * 4. **`body` 是拷贝**：弹窗里改它不该顺手改到书。
 */

import { describe, expect, it } from 'vitest'

import { runPagesOf } from './run-pages.ts'
import { pagePrompt } from './prompts/image.ts'
import type { Book, CharacterCard, StoryNode } from './engine/index.ts'

const CARD: CharacterCard = {
  schemaVersion: 1,
  cardId: 'c1',
  childId: 'kid-1',
  revision: 1,
  anchors: [{ slot: 'eyes', value: '深棕圆眼' }],
  style: { key: 'warm-handdrawn', promptFragment: '温暖手绘', ratio: '1:1' },
  reference: { path: 'cards/c1/ref.png', digest: 'beef', bytes: 3, mime: 'image/png' },
  provenance: { modelId: 'm', promptVersion: 'card@v1', cardRevision: 1, generatedAt: 0 },
  createdAt: 0,
}

function node(pageNo: number, body: string[]): StoryNode {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    scene: `第 ${pageNo} 页的场景`,
    body,
    imagePrompt: `第 ${pageNo} 页的画面`,
    mood: 'calm',
    next: [],
    pathFromRoot: [`n${pageNo}`],
  }
}

function book(parts: Partial<Book> = {}): Book {
  return {
    bookId: 'b1',
    cardId: 'c1',
    cardRevision: 1,
    form: 'solo',
    tree: { form: 'solo', title: 'T', rootId: 'n1', nodes: [node(1, ['一。']), node(2, ['二。'])] },
    illustrations: [
      {
        pageNo: 1,
        attempt: 1,
        asset: { path: 'books/b1/page-1-a1.png', mime: 'image/png', digest: 'd', bytes: 1 },
      },
    ],
    errors: [],
    narrations: [
      {
        pageNo: 1,
        voiceId: 'v1',
        textHash: 'h',
        asset: { path: 'books/b1/page-1-a1.mp3', mime: 'audio/mpeg', digest: 'd', bytes: 1 },
      },
    ],
    createdAt: 0,
    stats: {} as Book['stats'],
    ...parts,
  } as Book
}

/** 路径 → 地址那条翻译由调用方给（生产里是 `runtimeAssetUrl`）。这里只要看得出是谁 */
const urlOf = (path: string): string => `/${path}`

describe('runPagesOf', () => {
  it('★ prompt 就是 pagePrompt 算出来的那份（同一个函数，不是这里拼的）', () => {
    const book0 = book()
    const pages = runPagesOf(book0, CARD, urlOf, 768)
    expect(pages[0]?.prompt).toBe(
      pagePrompt({ card: CARD, page: '第 1 页的画面', scene: '第 1 页的场景', mood: 'calm' }),
    )
  })

  it('★ prompt 里没有家长补充那一句（补充是这一次才有的）', () => {
    const pages = runPagesOf(book(), CARD, urlOf, 768)
    expect(pages[0]?.prompt).not.toContain('要改掉上一版的问题')
  })

  it('有一页有图有音，另一页两样都没有', () => {
    const pages = runPagesOf(book(), CARD, urlOf, 768)
    expect(pages.map((page) => page.pageNo)).toEqual([1, 2])
    expect(pages[0]?.imageUrl).toBe('/books/b1/page-1-a1.png')
    expect(pages[0]?.narrationUrl).toBe('/books/b1/page-1-a1.mp3')
    expect(pages[1]?.imageUrl).toBeNull()
    expect(pages[1]?.narrationUrl).toBeNull()
  })

  it('★ 在 errors 里的那一页，图算"没做出来"（哪怕 illustrations 里还留着条目）', () => {
    const failed = book({ errors: [{ pageNo: 1, message: '这一页没做出来' }] })
    const pages = runPagesOf(failed, CARD, urlOf, 768)
    expect(pages[0]?.imageUrl).toBeNull()
    // 录音不受影响：图缺了那一页照样能念（audioUrl 与 imageUrl 是两件事）
    expect(pages[0]?.narrationUrl).toBe('/books/b1/page-1-a1.mp3')
  })

  it('body 是拷贝：弹窗里改它不该顺手改到书', () => {
    const book0 = book()
    const pages = runPagesOf(book0, CARD, urlOf, 768)
    pages[0]?.body.push('偷加的一句')
    expect(book0.tree.nodes[0]?.body).toEqual(['一。'])
  })

  it('宽度是调用方给的：显示多大是显示的事，这一层只负责把路径交出去', () => {
    const widths: number[] = []
    runPagesOf(
      book(),
      CARD,
      (path, width) => {
        widths.push(width)
        return path
      },
      384,
    )
    expect(widths.every((width) => width === 384)).toBe(true)
  })
})
