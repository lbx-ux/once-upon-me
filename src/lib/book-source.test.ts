/**
 * book-source.test.ts —— `readerPages` 里**图与朗读是两件事**
 *
 * 这一条最容易被"顺手合并"：写成 `audioUrl: missing ? null : …`、
 * 或者 `imageUrl: illustration ? … : narration ? … ` 之类。
 * 合并之后的症状是**一页因为没配音就显示成"这一页没做出来"**，
 * 或者反过来——图缺了却因为配音在而显示成正常页。
 *
 * 所以这里锁的是"两种缺席互不影响"，外加去重那条：
 * 共读版主干页共用同一份录音时，两个 pageNo 都要能拿到**同一个** URL。
 */

import { describe, expect, it } from 'vitest'

import { demoAssetPathFor, readerPages } from './book-source.ts'
import type { Book, Illustration, Narration, StoryNode } from './engine/index.ts'

function node(pageNo: number, body: string[]): StoryNode {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    scene: 'x',
    body,
    imagePrompt: 'x',
    mood: 'calm',
    next: [],
    pathFromRoot: [`n${pageNo}`],
  }
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

function narration(pageNo: number, assetPath = `books/b1/page-${pageNo}-a1.mp3`): Narration {
  return {
    pageNo,
    voiceId: 'v1',
    textHash: `t${pageNo}`,
    asset: { path: assetPath, digest: `a${pageNo}`, bytes: 100, mime: 'audio/mpeg' },
  }
}

function book(parts: {
  nodes: StoryNode[]
  illustrations?: Illustration[]
  narrations?: Narration[]
  errors?: { pageNo: number; message: string }[]
}): Book {
  return {
    bookId: 'b1',
    cardId: 'c1',
    cardRevision: 1,
    form: 'solo',
    tree: { form: 'solo', title: 'T', rootId: 'n1', nodes: parts.nodes },
    illustrations: parts.illustrations ?? [],
    errors: parts.errors ?? [],
    narrations: parts.narrations ?? [],
    createdAt: 0,
    stats: {} as Book['stats'],
  }
}

const urlOf = (path: string): string => `/api/assets/${path}`

describe('readerPages · 图与朗读互不影响', () => {
  it('有图有音 / 有图无音 / 无图有音 三种各归各', () => {
    const pages = readerPages(
      book({
        nodes: [node(1, ['a']), node(2, ['b']), node(3, ['c'])],
        // 第 3 页**没有 illustration**（硬失败），但有朗读
        illustrations: [illustration(1), illustration(2)],
        narrations: [narration(1), narration(3)],
        errors: [{ pageNo: 3, message: '出图失败' }],
      }),
      urlOf,
    )

    expect(pages.map((p) => [p.pageNo, p.imageUrl !== null, p.audioUrl !== null])).toEqual([
      [1, true, true],
      [2, true, false], // 有图没配音
      [3, false, true], // 没图但有配音 —— ★ 不许被 missing 连坐
    ])
    expect(pages[2]?.missing).toBe(true)
  })

  it('整本没有 narrations（W2 那种书）→ audioUrl 全是 null，不是 undefined', () => {
    const pages = readerPages(
      book({ nodes: [node(1, ['a'])], illustrations: [illustration(1)] }),
      urlOf,
    )
    expect(pages[0]?.audioUrl).toBeNull()
  })

  it('★ 主干页共用一份录音：两个 pageNo 拿到同一个 URL', () => {
    const shared = 'books/b1/page-1-a1.mp3'
    const pages = readerPages(
      book({
        nodes: [node(1, ['同一段正文。']), node(2, ['同一段正文。'])],
        illustrations: [illustration(1), illustration(2)],
        narrations: [narration(1, shared), narration(2, shared)],
      }),
      urlOf,
    )
    expect(pages[0]?.audioUrl).toBe('/api/assets/books/b1/page-1-a1.mp3')
    expect(pages[1]?.audioUrl).toBe(pages[0]?.audioUrl)
  })

  it('demo 来源用静态地址，两处不会漂（同一个 urlOf 传进来）', () => {
    const pages = readerPages(
      book({
        nodes: [node(1, ['a'])],
        illustrations: [illustration(1)],
        narrations: [narration(1)],
      }),
      (path) => `/demo/books/b1/${path.split('/').pop()}`,
    )
    expect(pages[0]?.audioUrl).toBe('/demo/books/b1/page-1-a1.mp3')
  })
})

/**
 * 演示副本的"有 .webp 就用它"这一条。
 *
 * ★ 它必须在这里测，而不是在浏览器里看：本机常常同时有同一本书的运行期副本
 *   （书号是确定性的），`resolveBook` 会先命中那条，演示分支在面板里根本走不到。
 *   而它真正生效的场合恰好是"那台只有 public/ 的机器"——演示机。
 */
describe('demoAssetPathFor · 演示图的 webp 兄弟文件', () => {
  const siblings = new Set(['page-1-a1.webp'])

  it('目录里有同名 .webp 就换过去', () => {
    expect(demoAssetPathFor('books/b1/page-1-a1.png', siblings)).toBe('books/b1/page-1-a1.webp')
  })

  it('没有就照旧回 .png（不是回一个不存在的小图）', () => {
    expect(demoAssetPathFor('books/b1/page-2-a1.png', siblings)).toBe('books/b1/page-2-a1.png')
  })

  it('音频与非 png 一律不动', () => {
    expect(demoAssetPathFor('books/b1/page-1-a1.mp3', siblings)).toBe('books/b1/page-1-a1.mp3')
    expect(demoAssetPathFor('books/b1/page-1-a1.webp', siblings)).toBe('books/b1/page-1-a1.webp')
  })

  it('空集合（那本从来没导出过小图）全部回原图，不抛', () => {
    expect(demoAssetPathFor('books/b1/page-1-a1.png', new Set())).toBe('books/b1/page-1-a1.png')
  })
})
