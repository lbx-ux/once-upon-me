/**
 * print-sheets.test.ts —— 打印那几张纸的版式：钉住三件会印错的事
 *
 * 1. 共读版的两条支**不许按 `pageNo` 平铺**。平铺出来的书，家长翻到一半会突然
 *    跳进另一条路上；这一条在没有用例的时候很容易被"按页号排一下不就行了"改回去。
 * 2. 缺图那一页**照样占一张纸**，而且纸上说得出它缺。跳过它，印出来的书少一页，
 *    没有任何痕迹能让人发现少了。
 * 3. 没有封面的书**照样有书名页**（不是拿第一页冒充封面）。
 *
 * 版式数据是纯函数，所以这里不碰浏览器、不碰文件系统：书用 `book()` 拼，
 * 页表喂给真的 `readerStory()`——"图缺没缺"只有一处真相（`book-source.ts`），
 * 这个测试不另造一份。
 */

import { describe, expect, it } from 'vitest'

import { readerStory } from './book-source.ts'
import { printSheetsOf } from './print-sheets.ts'
import type { Book, Illustration, StoryNode } from './engine/index.ts'

function node(pageNo: number, body: string[], pathFromRoot: string[]): StoryNode {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    scene: 'x',
    body,
    imagePrompt: 'x',
    mood: 'calm',
    next: [],
    pathFromRoot,
  }
}

function link(pageNo: number, body: string[], next: string[], path: string[]): StoryNode {
  return { ...node(pageNo, body, path), next }
}

function illustration(pageNo: number): Illustration {
  return {
    pageNo,
    attempt: 1,
    asset: {
      path: `books/b1/page-${pageNo}-a1.png`,
      digest: `d${pageNo}`,
      bytes: 10,
      mime: 'image/png',
    },
    provenance: { modelId: 'm', promptVersion: 'v', cardRevision: 1, generatedAt: 0 },
    needsHumanReview: false,
  }
}

const urlOf = (path: string): string => `/api/assets/${path}`

function book(parts: {
  nodes: StoryNode[]
  illustrations?: Illustration[]
  errors?: { pageNo: number; message: string }[]
  form?: 'solo' | 'shared'
  title?: string
}): Book {
  const form = parts.form ?? 'solo'
  return {
    bookId: 'b1',
    cardId: 'c1',
    cardRevision: 1,
    form,
    tree: {
      form,
      title: parts.title ?? '云朵船',
      rootId: parts.nodes[0]?.nodeId ?? '',
      nodes: parts.nodes,
    },
    illustrations: parts.illustrations ?? [],
    errors: parts.errors ?? [],
    narrations: [],
    createdAt: 0,
    stats: {} as Book['stats'],
  }
}

function sheetsOf(source: Book, coverUrl: string | null = '/cover.webp') {
  return printSheetsOf({ book: source, story: readerStory(source, urlOf), coverUrl })
}

describe('独读版：封面在前，页按页号排', () => {
  it('封面那张纸在最前，后面每页一张，图与正文都带过来', () => {
    const sheets = sheetsOf(
      book({
        nodes: [
          link(1, ['第一句。'], ['n2'], ['n1']),
          link(2, ['第二句。'], ['n3'], ['n1', 'n2']),
          node(3, ['第三句。'], ['n1', 'n2', 'n3']),
        ],
        illustrations: [illustration(1), illustration(2), illustration(3)],
      }),
    )

    expect(sheets).toHaveLength(4)
    expect(sheets[0]).toMatchObject({ kind: 'cover', title: '云朵船', imageUrl: '/cover.webp' })
    expect(sheets.slice(1).map((one) => (one.kind === 'page' ? one.pageNo : null))).toEqual([
      1, 2, 3,
    ])
    const first = sheets[1]
    expect(first?.kind).toBe('page')
    if (first?.kind !== 'page') throw new Error('第二张该是一页')
    expect(first.imageUrl).toBe('/api/assets/books/b1/page-1-a1.png')
    expect(first.body).toEqual(['第一句。'])
    expect(first.missing).toBe(false)
    expect(first.branch).toBeNull()
    expect(first.choice).toBeNull()
  })

  it('★ 没有封面的书：书名页照样在，只是没有图（不拿第一页冒充封面）', () => {
    const sheets = sheetsOf(book({ nodes: [node(1, ['a'], ['n1'])] }), null)
    expect(sheets[0]).toEqual({ kind: 'cover', title: '云朵船', imageUrl: null, form: 'solo' })
  })

  it('★ 缺图的那一页照样占一张纸，而且说得出它缺', () => {
    const sheets = sheetsOf(
      book({
        nodes: [
          link(1, ['一'], ['n2'], ['n1']),
          link(2, ['二'], ['n3'], ['n1', 'n2']),
          node(3, ['三'], ['n1', 'n2', 'n3']),
        ],
        illustrations: [illustration(1), illustration(3)],
        errors: [{ pageNo: 2, message: '出图失败' }],
      }),
    )
    expect(sheets).toHaveLength(4)
    const missing = sheets[2]
    expect(missing?.kind === 'page' && missing.missing).toBe(true)
    expect(missing?.kind === 'page' && missing.imageUrl).toBeNull()
    // 正文照旧在：缺的是图，不是这一页
    expect(missing?.kind === 'page' && missing.body).toEqual(['二'])
  })
})

describe('★ 共读版：主干 → 甲支 → 乙支，不按页号平铺', () => {
  /**
   * 树：
   *   1 → 2（选择点）→ [3 … 4]（甲支）/ [5 … 6]（乙支）
   * ★ 平铺数组里故意把乙支的页排在甲支前面（5、6 在 3、4 之前），
   *   而 `pageNo` 也故意与阅读顺序不一致——真实的书就是这样（`buildTree` 按 `via` 排）。
   */
  const nodes: StoryNode[] = [
    link(1, ['出发。'], ['n2'], ['n1']),
    {
      ...link(2, ['前面有两条路。'], ['n3', 'n5'], ['n1', 'n2']),
      choice: {
        prompt: '走哪一条？',
        options: [
          { iconKey: 'dino', emoji: '🦕', label: '恐龙的背', spoken: '走恐龙那边' },
          { iconKey: 'boat', emoji: '🛶', label: '小船的肚子', spoken: '走小船那边' },
        ],
      },
    },
    link(5, ['小船摇啊摇。'], ['n6'], ['n1', 'n2', 'n5']),
    node(6, ['靠岸了。'], ['n1', 'n2', 'n5', 'n6']),
    link(3, ['恐龙打个喷嚏。'], ['n4'], ['n1', 'n2', 'n3']),
    node(4, ['我们到家了。'], ['n1', 'n2', 'n3', 'n4']),
  ]

  it('主干两页在前，然后甲支两页，最后乙支两页', () => {
    const sheets = sheetsOf(book({ nodes, form: 'shared' }))
    const pages = sheets.slice(1).map((one) => (one.kind === 'page' ? one.pageNo : null))
    expect(pages).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('每页都标着自己属于哪条支（那行小字用的就是它）', () => {
    const sheets = sheetsOf(book({ nodes, form: 'shared' }))
    const marks = sheets
      .slice(1)
      .map((one) => (one.kind === 'page' ? [one.pageNo, one.branch, one.branchLabel] : null))
    expect(marks).toEqual([
      [1, null, null],
      [2, null, null], // 选择点这一页在主干上：两条路都要经过它
      [3, 'a', '恐龙的背'],
      [4, 'a', '恐龙的背'],
      [5, 'b', '小船的肚子'],
      [6, 'b', '小船的肚子'],
    ])
  })

  it('选择点那一页带着提问与两个选项（印出来要能照着念）', () => {
    const sheets = sheetsOf(book({ nodes, form: 'shared' }))
    const choice = sheets.find((one) => one.kind === 'page' && one.choice !== null)
    expect(choice?.kind === 'page' && choice.choice).toEqual({
      prompt: '走哪一条？',
      options: [
        { label: '恐龙的背', emoji: '🦕' },
        { label: '小船的肚子', emoji: '🛶' },
      ],
    })
  })

  it('两支都印：走不到的那一支也在一张纸上（这本书是一棵树，不是一条路）', () => {
    const sheets = sheetsOf(book({ nodes, form: 'shared' }))
    expect(sheets).toHaveLength(7) // 封面 + 6 页
  })
})
