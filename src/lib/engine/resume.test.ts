/**
 * resume.test.ts —— 断点续画：跳过已经画好的页，只补缺的（2026-10-30）
 *
 * 判据是**出图被调了几次**，不是"返回的书里有几页"：后者只要把断点里的页原样抄回去
 * 就能满足，而它一分钱没省——一个"每页都重画、再把旧记录盖掉"的实现会在这里全绿。
 *
 * 三件事一起钉住：
 *   1. 断点里有的页不重画（省的是真钱）；
 *   2. 断点里没有的页照画；
 *   3. `onProgress` 报的是**累积**的那一份（上一轮的 + 这一轮的），不是这一轮新画的
 *      ——否则第二轮再崩一次会把第一轮的成果覆盖掉。
 */

import { describe, expect, it } from 'vitest'

import { buildTree } from './tree.ts'
import { illustrateBook, type BookRequest, type CharacterCard, type Illustration } from './index.ts'
import { createMemoryStore } from './providers/stores.ts'
import type { ImageGenerator, ProviderBundle } from './providers/types.ts'

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
  theme: '会飞的绿天空',
  form: 'solo',
  pages: 3,
}

/** 记下每一次出图。★ 封面也算一次，所以断言里要把它算进去 */
async function bundle(): Promise<{ providers: ProviderBundle; images: () => number }> {
  const store = createMemoryStore()
  await store.put({
    path: CARD.reference.path,
    bytes: new Uint8Array([1, 2, 3]),
    mime: 'image/png',
  })
  let images = 0
  const image: ImageGenerator = {
    id: 'fake-image',
    modelId: 'fake-image',
    supportedRatios: ['1:1'],
    supportsReference: false,
    async generate() {
      images += 1
      return { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'image/png', modelId: 'fake-image' }
    },
  }
  return {
    providers: {
      mode: 'offline',
      text: {
        id: 'fake-text',
        modelId: 'fake-text',
        async complete() {
          return { text: '{}', modelId: 'fake-text' }
        },
        async stream() {
          return { text: '{}', modelId: 'fake-text' }
        },
      },
      image,
      vision: null,
      voice: null,
      store,
    },
    images: () => images,
  }
}

/** 一份"上一轮已经画好"的记录 */
function drawn(pageNo: number): Illustration {
  return {
    pageNo,
    attempt: 1,
    asset: {
      path: `books/x/page-${pageNo}.png`,
      mime: 'image/png',
      bytes: 4,
      digest: `d${pageNo}`,
    },
    provenance: {
      modelId: 'fake-image',
      promptVersion: 'page@v1',
      cardRevision: 1,
      generatedAt: 0,
    },
    needsHumanReview: false,
  }
}

async function treeOf() {
  const built = buildTree('solo', STORY.title, STORY.nodes)
  if (!built.ok) throw new Error('故事表不合法')
  return built.tree
}

describe('断点续画', () => {
  it('★ 断点里有的页一次都不重画，缺的照画', async () => {
    const tree = await treeOf()
    const { providers, images } = await bundle()
    const snapshots: number[][] = []

    const book = await illustrateBook(REQUEST, tree, {
      providers,
      resume: {
        illustrations: new Map([
          [1, drawn(1)],
          [2, drawn(2)],
        ]),
      },
      onProgress: (snapshot) => {
        snapshots.push(snapshot.illustrations.map((one) => one.pageNo))
      },
    })

    // 3 页里 2 页来自断点：只该画第 3 页，加上封面一共 2 次
    expect(images()).toBe(2)
    expect(book.illustrations.map((one) => one.pageNo)).toEqual([1, 2, 3])
    // ★ 报上去的是累积的那一份，而不是"这一轮新画的那一页"
    expect(snapshots.at(-1)).toEqual([1, 2, 3])
  })

  it('没有断点时一页不省（对照臂：上一条的读数不能是被别的因素解释掉的）', async () => {
    const tree = await treeOf()
    const { providers, images } = await bundle()
    const book = await illustrateBook(REQUEST, tree, { providers })

    expect(images()).toBe(4) // 3 页 + 封面
    expect(book.illustrations.map((one) => one.pageNo)).toEqual([1, 2, 3])
  })

  it('断点里有封面就跳过封面（封面也是一次真金白银的调用）', async () => {
    const tree = await treeOf()
    const { providers, images } = await bundle()
    const cover = {
      asset: { path: 'books/x/cover.png', mime: 'image/png', bytes: 4, digest: 'dc' },
      provenance: {
        modelId: 'fake-image',
        promptVersion: 'cover@v1',
        cardRevision: 1,
        generatedAt: 0,
      },
    }

    const book = await illustrateBook(REQUEST, tree, {
      providers,
      resume: {
        illustrations: new Map([
          [1, drawn(1)],
          [2, drawn(2)],
          [3, drawn(3)],
        ]),
        cover,
      },
    })

    expect(images()).toBe(0)
    expect(book.cover?.asset.path).toBe('books/x/cover.png')
  })
})
