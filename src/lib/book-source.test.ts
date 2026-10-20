/**
 * book-source.test.ts —— `readerPages` 里图与朗读是两件事
 *
 * 这一条最容易被"顺手合并"：写成 `audioUrl: missing ? null : …`、
 * 或者 `imageUrl: illustration ? … : narration ? … ` 之类。
 * 合并之后的症状是一页因为没配音就显示成"这一页没做出来"，
 * 或者反过来——图缺了却因为配音在而显示成正常页。
 *
 * 所以这里锁的是"两种缺席互不影响"，外加去重那条：
 * 共读版主干页共用同一份录音时，两个 pageNo 都要能拿到同一个 URL。
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  coverUrlOf,
  demoAssetPathFor,
  readerPages,
  readerStory,
  resolveBook,
} from './book-source.ts'
import { storyPath } from '@/components/reader/reader-model.ts'
import { createMemoryStore } from './engine/providers/stores.ts'
import { createFsStore } from './engine/index.ts'
import { scopedStore } from './asset-scope.ts'
import type { Book, Cover, Illustration, Narration, StoryNode } from './engine/index.ts'

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

/** 带岔路的节点：`next` 两个、`choice` 两个选项（顺序 = `via` a/b，tree.ts 保证） */
function choiceNode(pageNo: number, next: [string, string]): StoryNode {
  return {
    ...node(pageNo, ['前面有两条路。']),
    next,
    choice: {
      prompt: '走哪一条？',
      options: [
        { iconKey: 'dino', emoji: '🦕', label: '恐龙的背', spoken: '走恐龙那边' },
        { iconKey: '还不在词表里', emoji: '🛶', label: '小船的肚子', spoken: '走小船那边' },
      ],
    },
  }
}

function link(pageNo: number, next: string): StoryNode {
  return { ...node(pageNo, [`第 ${pageNo} 页。`]), next: [next] }
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
  form?: 'solo' | 'shared'
}): Book {
  const form = parts.form ?? 'solo'
  return {
    bookId: 'b1',
    cardId: 'c1',
    cardRevision: 1,
    form,
    tree: { form, title: 'T', rootId: 'n1', nodes: parts.nodes },
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
        // 第 3 页没有 illustration（硬失败），但有朗读
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
 * ★ 共读版：平铺表不是任何一条阅读路径（2026-10-18）
 *
 * 钉的是"阅读器不许拿 `readerPages()` 渲染共读版"。那条路按页号排，于是两条支被读成
 * 相邻的两页：孩子选了一次，看到的却是两条路连着读下来——树的形状在屏幕上完全
 * 看不出来，而三道闸门一条都不响（类型对、lint 过、几何自检也过）。
 * 今天盘上还没有共读版的书，所以它不是活的 bug，只是一颗埋着的雷。
 *
 * 机械的那半边由类型兜着：`ReaderBookProps` 里只有 `story`，没有 `pages`，
 * 组件根本拿不到那张平铺表。所以这一组测的是另一半——那张表真的不等于任何一条路，
 * 以及 `readerStory` 交出来的树长得对不对。
 */
describe('readerStory · 平铺表 ≠ 阅读路径', () => {
  /**
   * 1 → 2 → 3（选择点）→ a 支 4 收尾 / b 支 5 → 6 收尾。
   * 两支的页号交错（a 支是 4、b 支是 5 与 6）：平铺顺序 `1,2,3,4,5,6` 谁都不长这样，
   *   走 b 支的人永远见不到第 4 页。
   */
  const shared = book({
    form: 'shared',
    nodes: [
      link(1, 'n2'),
      link(2, 'n3'),
      choiceNode(3, ['n4', 'n5']),
      node(4, ['恐龙那边。']),
      link(5, 'n6'),
      node(6, ['小船那边。']),
    ],
    illustrations: [1, 2, 3, 4, 5, 6].map(illustration),
    narrations: [1, 2, 3, 4, 5, 6].map((pageNo) => narration(pageNo)),
  })

  it('平铺表是**全表**（含走不到的那一支），按页号排', () => {
    expect(readerPages(shared, urlOf).map((page) => page.pageNo)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('★ 走 b 支那一条路里**没有第 4 页**，而平铺表里有它', () => {
    const story = readerStory(shared, urlOf)
    expect(story.form).toBe('shared')
    const b = storyPath(story, 'b').map((node) => node.pageNo)
    expect(b).toEqual([1, 2, 3, 5, 6])
    expect(b).not.toContain(4)
    expect(readerPages(shared, urlOf).map((page) => page.pageNo)).toContain(4)
  })

  it('没选过就停在选择点上（那一屏才浮得出两颗按钮）', () => {
    const story = readerStory(shared, urlOf)
    const path = storyPath(story, null)
    expect(path.map((node) => node.pageNo)).toEqual([1, 2, 3])
    expect(path[2]?.choice?.prompt).toBe('走哪一条？')
  })

  it('★ 两种形态用的是**同一个 builder**：同一页的图与音在两处逐字相同', () => {
    // 一个真相、两个投影。分开算的症状是"内页缩了、封面没缩"那一类没人会去查的差异
    const pages = readerPages(shared, urlOf)
    const story = readerStory(shared, urlOf)
    for (const page of pages) {
      const view = story.nodes.find((item) => item.pageNo === page.pageNo)
      expect(view?.imageUrl).toBe(page.imageUrl)
      expect(view?.audioUrl).toBe(page.audioUrl)
      expect(view?.missing).toBe(page.missing)
    }
  })

  it('选择点那三段音各归各的（按 `part` 取，不是"一页一条"）', () => {
    const withParts = book({
      form: 'shared',
      nodes: [link(1, 'n2'), choiceNode(2, ['n3', 'n4']), node(3, []), node(4, [])],
      illustrations: [1, 2, 3, 4].map(illustration),
      narrations: [
        narration(2, 'books/b1/page-2-a1.mp3'),
        {
          ...narration(2),
          part: 'prompt',
          asset: { ...narration(2).asset, path: 'books/b1/ask.mp3' },
        },
        {
          ...narration(2),
          part: 'option-a',
          asset: { ...narration(2).asset, path: 'books/b1/opt-a.mp3' },
        },
        {
          ...narration(2),
          part: 'option-b',
          asset: { ...narration(2).asset, path: 'books/b1/opt-b.mp3' },
        },
      ],
    })
    const view = readerStory(withParts, urlOf).nodes.find((item) => item.pageNo === 2)
    expect(view?.audioUrl).toBe('/api/assets/books/b1/page-2-a1.mp3')
    expect(view?.choice?.promptAudioUrl).toBe('/api/assets/books/b1/ask.mp3')
    expect(view?.choice?.options[0]?.audioUrl).toBe('/api/assets/books/b1/opt-a.mp3')
    expect(view?.choice?.options[1]?.audioUrl).toBe('/api/assets/books/b1/opt-b.mp3')
  })

  it('★ 图标：盘上有图给地址，词表之外的 key 给 null（露 emoji 那一档，不回 404 地址）', () => {
    const view = readerStory(shared, urlOf).nodes.find((item) => item.pageNo === 3)
    expect(view?.choice?.options[0]?.iconUrl).toBe('/book/choice-dino.webp')
    expect(view?.choice?.options[1]?.iconUrl).toBeNull()
    expect(view?.choice?.options[1]?.emoji).toBe('🛶')
  })

  it('缺图那一页在两条路上都是 missing（`Book.errors` 那条路不受分支影响）', () => {
    const broken = book({
      form: 'shared',
      nodes: [link(1, 'n2'), choiceNode(2, ['n3', 'n4']), node(3, []), node(4, [])],
      illustrations: [illustration(1), illustration(2), illustration(3)],
      errors: [{ pageNo: 3, message: '出图失败' }],
    })
    const story = readerStory(broken, urlOf)
    const a = storyPath(story, 'a').map((node) => node.pageNo)
    expect(a).toEqual([1, 2, 3])
    expect(story.nodes.find((item) => item.pageNo === 3)?.missing).toBe(true)
    expect(story.nodes.find((item) => item.pageNo === 3)?.imageUrl).toBeNull()
  })
})

/**
 * 封面：2026-10-15 起书里多了一个 `cover` 字段（一次单独的出图，3:4）。
 *
 * 这一条锁的是"没有就照实说没有"：仓库里那本预生成的演示书是在这个字段之前
 *   出的，它的 `book.json` 里没有 `cover`。阅读器要照实只出书名，
 *   不许拿第一页顶上——拿第一页冒充当面，是"图没到位就留一个诚实的兜底"那条的反面。
 */
describe('coverUrlOf · 有封面走同一条 URL 规则，没有就是 null', () => {
  const cover: Cover = {
    asset: { path: 'books/b1/cover.png', digest: 'c1', bytes: 20, mime: 'image/png' },
    provenance: { modelId: 'm', promptVersion: 'image-page@v1', cardRevision: 1, generatedAt: 0 },
  }

  it('有 cover → 用传进来的那个 urlOf（缩图规则与内页同一条，不另起一套）', () => {
    const withCover: Book = { ...book({ nodes: [node(1, ['a'])] }), cover }
    expect(coverUrlOf(withCover, urlOf)).toBe('/api/assets/books/b1/cover.png')
  })

  it('★ 没有 cover → null，不是空串、也不是第一页那张图', () => {
    const bare = book({ nodes: [node(1, ['a'])], illustrations: [illustration(1)] })
    expect(coverUrlOf(bare, urlOf)).toBeNull()
    // 就算页图都在，也不许拿它当封面
    expect(coverUrlOf(bare, urlOf)).not.toBe(urlOf('books/b1/page-1-a1.png'))
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

/**
 * ★ 2026-10-17：从谁那一片读（用户实测报的「书架里看得见、点进去说找不到」）
 *
 * 这一组必须落在真磁盘上，不能只用 `createMemoryStore`：要钉住的那一条恰恰是
 * "裸根上那份明明在、也不许读"——而"裸根"是一个真实的目录概念
 * （`assetRoot()` 下的 `books/<id>/`，迁移前的老地方），内存 store 里没有它。
 *
 * 场景就是用户报的那一件：书按人搬进了 `u/<userId>/`，而阅读器还在老地方找。
 * 于是架上（读自己那一片）说有、点开（读裸根）说没有。三条判据把它夹死：
 *
 * | 给谁读        | 盘上有什么                      | 该得到 |
 * | ------------- | ------------------------------- | ------ |
 * | 主人那一片    | `u/7/books/b1/book.json`        | 这本书 |
 * | 别人那一片    | 同一份字节，只是不在这片里      | null   |
 * | 没有会话       | 裸根 `books/b1/book.json` 也在   | null   |
 *
 * 最后那一行是本组的重点：没有那一片就不去别处找。所以它在裸根上摆一份
 * 一模一样的清单——"读到了"就是失败（归属成了一句空话）。
 */
describe('resolveBook · 只读请求者那一片', () => {
  async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'xzj-book-source-'))
    const previous = process.env['ASSET_ROOT']
    process.env['ASSET_ROOT'] = root
    try {
      await run(root)
    } finally {
      if (previous === undefined) delete process.env['ASSET_ROOT']
      else process.env['ASSET_ROOT'] = previous
      await rm(root, { recursive: true, force: true })
    }
  }

  async function writeManifest(root: string, where: string, raw?: string): Promise<void> {
    const dir = join(root, where)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'book.json'),
      raw ??
        JSON.stringify(book({ nodes: [node(1, ['第 1 页'])], illustrations: [illustration(1)] })),
      'utf8',
    )
  }

  it('给了那一片：读得到，图与封面都走 `/api/assets`（与资产路由同一条口径）', async () => {
    const store = scopedStore(await createMemoryStore(), '7')
    await store.putJson({
      path: 'books/b1/book.json',
      value: book({ nodes: [node(1, ['第 1 页'])], illustrations: [illustration(1)] }),
    })

    const resolved = await resolveBook('b1', store)
    expect(resolved?.source).toBe('runtime')
    expect(resolved?.book.bookId).toBe('b1')
    expect(resolved?.pages[0]?.imageUrl).toBe('/api/assets/books/b1/page-1-a1.png?w=1024')
  })

  it('★ 盘上那份在主人那一片里 → 读得到；换一个人那一片 → 读不到', async () => {
    await withTempRoot(async (root) => {
      await writeManifest(root, join('u', '7', 'books', 'b1'))
      const base = await createFsStore(root)

      const mine = await resolveBook('b1', scopedStore(base, '7'))
      expect(mine?.source).toBe('runtime')
      expect(mine?.book.tree.title).toBe('T')

      expect(await resolveBook('b1', scopedStore(base, '8'))).toBeNull()
    })
  })

  it('★★ 没有那一片（没登录）→ null，**就算裸根上摆着一份也不读**', async () => {
    await withTempRoot(async (root) => {
      // 迁移前的老地方：格式一模一样，只是不该再有人从这里读
      await writeManifest(root, join('books', 'b1'))
      expect(await resolveBook('b1', null)).toBeNull()
      // 同一个书号，主人那一片是空的 → 也是 null（不是"回退到裸根那份"）
      expect(await resolveBook('b1', scopedStore(await createFsStore(root), '7'))).toBeNull()
    })
  })

  it('清单读不回来（半截 JSON）当它不存在，不抛', async () => {
    await withTempRoot(async (root) => {
      await writeManifest(root, join('u', '7', 'books', 'b1'), '{"bookId": "b1"')
      expect(await resolveBook('b1', scopedStore(await createFsStore(root), '7'))).toBeNull()
    })
  })
})
