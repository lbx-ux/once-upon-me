/**
 * library.test.ts —— 书架摘要：每个数都得来自清单本身
 *
 * 两件事值得钉住：
 *   ① 页数与"真的有图的页数"是两件事。一本 20 页里 3 页没出图是可能的，
 *      把两个数合成一个，主页那句"20 页"就在撒谎（domain.ts 对"缺图 vs 未核对"
 *      警告过同一件事，别再犯第三次）。
 *   ② 只列运行期的书，不列 `public/demo` 里随仓库提交的那本——
 *      混进来就是往"已创作故事"里灌一个假数。
 *   ③ 封面地址是调用方算好递进来的（2026-10-16 书架改成"书立在架子上"时要的）：
 *      这里钉住的是"每一本都过一遍那个函数"，不是"怎么拼这个地址"——
 *      拼地址只有一条路（`book-source.ts` 的 `runtimeAssetUrl`），单测在那边。
 */

import { describe, expect, it } from 'vitest'

import { booksOnly, listBooks, noCovers, summarize, summarizeStory } from './library.ts'
import { createMemoryStore } from './engine/providers/stores.ts'
import type { Book, StoryNode, StoryTree } from './engine/index.ts'
import type { NodeDraft } from './schemas/story.ts'
import type { StoryDraft } from './story-draft.ts'

/**
 * 树上的一页。
 *
 * 这个 helper 是 2026-10-18 抽出来的，因为这一组 fixture 原来是假的：
 *   三个 `next: []`、`pathFromRoot: []` 的节点——那不是一棵树，是三个孤立的点，
 *   而真实的书是 `buildTree` 装订出来的，`next` 与 `pathFromRoot` 一定有。
 *   页数口径改成路长之后（工单 06 §三），假 fixture 会量出 0 页，
 *   而那是"数据不对"，不是"代码不对"。要测那条兜底就照实造一个假形状（下面有一条）。
 */
function treeNode(
  pageNo: number,
  next: readonly string[] = [],
  pathFromRoot: readonly string[] = [],
): StoryNode {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    scene: '',
    body: [],
    imagePrompt: '',
    mood: 'calm',
    next,
    pathFromRoot,
  }
}

/**
 * 一棵真的共读版的树：主干 4 页 → 第 4 页分岔 → A 支 3 页（路长 7）、
 * B 支 4 页（路长 8），一共 11 个节点。
 *
 * 它就是验收判据里那个形状：「一本 8 页路长、11 个节点的书，架子写 8 不写 11」。
 *   两条支不一样长是常态（`buildTree` 只要求差 ≤ 1），所以这条 fixture 也钉住
 *   "取长的那一条"这个选择（另一条用例钉两条一样长的情形）。
 */
function sharedTree(): StoryTree {
  /** 每一页有哪几个孩子。顺序照 `buildTree` 摆出来的（via=a 在前） */
  const children: Record<number, number[]> = {
    1: [2],
    2: [3],
    3: [4],
    4: [5, 8],
    5: [6],
    6: [7],
    8: [9],
    9: [10],
    10: [11],
  }
  const paths = new Map<number, string[]>()
  /** ★ `pathFromRoot` 含自己（引擎的 `computePaths` 就是这么填的，别少一个） */
  const walk = (pageNo: number, soFar: string[]): void => {
    const here = [...soFar, `n${pageNo}`]
    paths.set(pageNo, here)
    for (const child of children[pageNo] ?? []) walk(child, here)
  }
  walk(1, [])

  return {
    form: 'shared',
    title: '两条路',
    rootId: 'n1',
    nodes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((pageNo) => ({
      ...treeNode(
        pageNo,
        (children[pageNo] ?? []).map((child) => `n${child}`),
        paths.get(pageNo) ?? [],
      ),
      // 第 4 页是那个选择点（路长与节点数的差就是从它这儿来的）
      ...(pageNo === 4
        ? {
            choice: {
              prompt: '往哪边走？',
              options: [
                { iconKey: 'dino', emoji: '🦕', label: '骑恐龙', spoken: '我们骑恐龙去看看' },
                { iconKey: 'ship', emoji: '⛵', label: '上小船', spoken: '我们上小船去看看' },
              ],
            },
          }
        : {}),
    })),
  }
}

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

/**
 * 封面地址这一项，这几条用例都不测（它由调用方算好递进来，见 `listBooks` 那条）。
 * 传 `null` 是如实的：这些 fixture 里的书真的没有 `cover` 字段。
 */
const NO_COVER: string | null = null

describe('summarize', () => {
  it('页数来自故事树，有图页数来自 illustrations —— 两个数不合并', () => {
    const summary = summarize(
      book({
        bookId: 'b1',
        tree: {
          form: 'solo',
          title: 'T',
          rootId: 'n1',
          // 3 个节点、一条链——独读版就是这样，所以路长与节点数相等
          nodes: [
            treeNode(1, ['n2'], ['n1']),
            treeNode(2, ['n3'], ['n1', 'n2']),
            treeNode(3, [], ['n1', 'n2', 'n3']),
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
      NO_COVER,
    )
    expect(summary.pageCount).toBe(3)
    expect(summary.nodeCount).toBe(3)
    expect(summary.illustratedCount).toBe(2)
  })

  /* 页数口径：路长 vs 全树节点数（工单 06 §三，2026-10-18） */

  it('★ 共读版：页数是**路长**，不是全树节点数（8 页 / 11 个节点）', () => {
    const summary = summarize(book({ bookId: 'b1', form: 'shared', tree: sharedTree() }), NO_COVER)
    // 两条路是 7 页与 8 页 —— 取长的那一条（孩子最多读到 8 页）
    expect(summary.pageCount).toBe(8)
    // 而这本书真的要画 11 页的图（那一支走不到也得画）——所以这个数另记
    expect(summary.nodeCount).toBe(11)
    expect(summary.form).toBe('shared')
  })

  it('共读版的形态跟着摘要走（独读版是 solo，书架靠它决定标不标角标）', () => {
    expect(summarize(book({ bookId: 'b1' }), NO_COVER).form).toBe('solo')
    expect(summarize(book({ bookId: 'b2', form: 'shared' }), NO_COVER).form).toBe('shared')
  })

  it('清单里没有路径（手工摆的假树）时退回节点数，不写 0 页', () => {
    // 真实的书不会有这个形状：`buildTree` 装订出来的树每页都有 `next` 与
    // `pathFromRoot`。但清单是盘上的 JSON，读到一个没有路径的表时，
    // 架子上写 0 页是一句假话，写节点数是这棵树上唯一数得出的东西。
    const shapeless = book({
      bookId: 'b1',
      tree: {
        form: 'solo',
        title: 'T',
        rootId: 'n1',
        nodes: [treeNode(1), treeNode(2), treeNode(3)],
      },
    })
    const summary = summarize(shapeless, NO_COVER)
    expect(summary.pageCount).toBe(3)
    expect(summary.nodeCount).toBe(3)
  })

  it('有朗读看 narrations；没有就是 false（不是"未知"）', () => {
    expect(summarize(book({ bookId: 'b1' }), NO_COVER).hasNarration).toBe(false)
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
        NO_COVER,
      ).hasNarration,
    ).toBe(true)
  })

  it('没有标题时给一个人话兜底，不是空字符串', () => {
    const broken = { ...book({ bookId: 'b1' }), tree: undefined } as unknown as Book
    expect(summarize(broken, NO_COVER).title).toBe('(没有名字的书)')
  })

  it('封面地址是调用方算好递进来的，原样进摘要（null 就是没有封面）', () => {
    expect(summarize(book({ bookId: 'b1' }), '/api/assets/x?w=384').coverUrl).toBe(
      '/api/assets/x?w=384',
    )
    expect(summarize(book({ bookId: 'b1' }), NO_COVER).coverUrl).toBeNull()
  })
})

/**
 * 草稿那一档的页数（工单 06 §三）。
 *
 * ★ 它与成品那一档必须是同一个口径：一本共读版在闸门那一屏写"读下来 4 页"，
 *   而书架上写"5 页"，家长看到的是同一本书上的两个数（草稿存的是平铺的页表，
 *   路长要从它派生——用的是闸门那一屏同一个 `storyShapeOf`）。
 */
describe('summarizeStory：草稿的页数也是路长', () => {
  /** 一份共读版草稿：5 页、第 3 页分岔、两支各 1 页 —— 路长 4、表里 5 页 */
  function sharedDraft(choicePage: Partial<NodeDraft> = {}): StoryDraft {
    const page = (extra: Partial<NodeDraft> = {}): NodeDraft => ({
      scene: '场景',
      body: ['正文'],
      imagePrompt: '画面',
      mood: 'calm',
      ...extra,
    })
    return {
      bookId: 's1',
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
        cardRevision: 1,
        theme: '两条路',
        form: 'shared',
      },
      doc: {
        title: '两条路',
        nodes: [
          page(),
          page(),
          page({
            ask: '往哪边走？',
            labelA: '骑恐龙',
            spokenA: '我们骑恐龙去看看',
            labelB: '上小船',
            spokenB: '我们上小船去看看',
            ...choicePage,
          }),
          page({ from: 3, via: 'a' }),
          page({ from: 3, via: 'b' }),
        ],
      },
      provenance: { modelId: 'm', promptVersion: 'story-plan@v3', attempts: 1 },
      planMs: 1000,
      createdAt: 10,
    }
  }

  it('★ 共读版草稿：写的是路长（4 页），不是表里的 5 页', () => {
    const summary = summarizeStory('s1', sharedDraft())
    expect(summary.pageCount).toBe(4)
    expect(summary.nodeCount).toBe(5)
    expect(summary.form).toBe('shared')
  })

  it('树建不起来（这一版还有错）时两个数都是表里的页数——路长这时候还不存在', () => {
    // 把 B 那颗按钮的"念出来的"删掉：`buildTree` 会说"选择点写了一半"，
    // 而那一本正停在闸门那一屏上等家长改（`storyProblemsOf` 会说清是哪一格）
    const summary = summarizeStory('s1', sharedDraft({ spokenB: undefined }))
    expect(summary.pageCount).toBe(5)
    expect(summary.nodeCount).toBe(5)
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
    const books = await listBooks(store, noCovers)
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
    expect((await listBooks(store, noCovers)).map((item) => item.bookId)).toEqual(['new', 'old'])
  })

  it('★ 一本读不出来的书不让整个书架 500（半截 JSON 当它不存在）', async () => {
    const store = await createMemoryStore()
    await store.put({
      path: 'books/broken/book.json',
      bytes: new TextEncoder().encode('{"bookId": "brok'),
      mime: 'application/json',
    })
    await store.putJson({ path: 'books/ok/book.json', value: book({ bookId: 'ok', createdAt: 5 }) })
    expect((await listBooks(store, noCovers)).map((item) => item.bookId)).toEqual(['ok'])
  })

  it('一本都没有 = 空数组，不是抛错（新用户看到的就是这个）', async () => {
    expect(await listBooks(await createMemoryStore(), noCovers)).toEqual([])
  })

  it('封面地址由调用方算：每一本都过一遍那个函数，拿回来的原样进摘要', async () => {
    const store = await createMemoryStore()
    await store.putJson({
      path: 'books/b1/book.json',
      value: book({ bookId: 'b1', createdAt: 1 }),
    })
    const seen: string[] = []
    const books = await listBooks(store, (item) => {
      seen.push(item.bookId)
      return `/api/assets/books/${item.bookId}/cover.png?w=384`
    })
    expect(seen).toEqual(['b1'])
    expect(books[0]?.coverUrl).toBe('/api/assets/books/b1/cover.png?w=384')
  })

  /* 故事草稿（2026-10-17，故事闸门） */

  /** 一份最小但合法的故事草稿。★ 页数取自 `doc.nodes`，所以这里给三页 */
  function draft(bookId: string, createdAt: number, title = '绿天空') {
    return {
      bookId,
      input: {
        child: { childId: 'k1', name: '小乐', nameReading: 'xiǎo lè', ageBand: '4-6' },
        cardId: 'c1',
        cardRevision: 1,
        theme: '绿天空',
        form: 'solo',
      },
      doc: {
        title,
        nodes: [1, 2, 3].map((pageNo) => ({
          scene: `第 ${pageNo} 页的场景`,
          body: [`第 ${pageNo} 页的正文`],
          imagePrompt: `第 ${pageNo} 页的画面描述`,
          mood: 'calm',
        })),
      },
      provenance: { modelId: 'm', promptVersion: 'story-plan@v2', attempts: 1 },
      planMs: 1000,
      createdAt,
    }
  }

  it('★ 只有 story.json 的目录也算书架上的一本，status 是 story', async () => {
    const store = await createMemoryStore()
    await store.putJson({ path: 'books/s1/story.json', value: draft('s1', 10) })

    const books = await listBooks(store, noCovers)
    expect(books.map((item) => item.bookId)).toEqual(['s1'])
    expect(books[0]).toMatchObject({
      status: 'story',
      title: '绿天空',
      // 页数来自故事里的页数；而"有几页有图"是 0——它真的还没画
      // 独读版草稿的页数等于表里的页数（路长与节点数在这一档上相等）
      pageCount: 3,
      nodeCount: 3,
      form: 'solo',
      illustratedCount: 0,
      hasNarration: false,
      coverUrl: null,
      createdAt: 10,
    })
  })

  it('★ 已经在画的那一本要照实说画到第几页（用户实测报的 bug）', async () => {
    // 场景：用户点完「就按这个画」、从运行视图点「退出」——这一本还没有 `book.json`，
    // 而盘上已经躺着两张页图。原来这一行恒写"还没开始画"（`illustratedCount: 0`），
    // 他的原话是"他告诉我正在生成中，我看不到画的什么"。
    const store = await createMemoryStore()
    await store.putJson({ path: 'books/s1/story.json', value: draft('s1', 10) })
    for (const name of ['page-1-a1.png', 'page-2-a1.png']) {
      await store.put({
        path: `books/s1/${name}`,
        bytes: new Uint8Array([1]),
        mime: 'image/png',
      })
    }

    const books = await listBooks(store, noCovers)
    expect(books[0]?.status).toBe('story')
    expect(books[0]?.illustratedCount).toBe(2)
    // 封面不算：那是装订那一步的产物，而这一本还没装订
    await store.put({ path: 'books/s1/cover.png', bytes: new Uint8Array([1]), mime: 'image/png' })
    expect((await listBooks(store, noCovers))[0]?.illustratedCount).toBe(2)
    // ★ 别的书的页图不算在自己头上（前缀里带着书号那一段斜杠）
    await store.putJson({ path: 'books/s1x/story.json', value: draft('s1x', 10) })
    await store.put({
      path: 'books/s1x/page-1-a1.png',
      bytes: new Uint8Array([1]),
      mime: 'image/png',
    })
    const again = await listBooks(store, noCovers)
    expect(again.find((item) => item.bookId === 's1')?.illustratedCount).toBe(2)
    expect(again.find((item) => item.bookId === 's1x')?.illustratedCount).toBe(1)
  })

  it('★ 两样都有时**清单说了算**：故事草稿是这一本曾经的样子，不是它的现状', async () => {
    const store = await createMemoryStore()
    await store.putJson({ path: 'books/b1/story.json', value: draft('b1', 900) })
    await store.putJson({
      path: 'books/b1/book.json',
      value: book({ bookId: 'b1', createdAt: 100, status: 'draft' }),
    })

    const books = await listBooks(store, noCovers)
    // 只出现一本，而它的状态是"画完了没装订"，不是"还没开始画"
    expect(books).toHaveLength(1)
    expect(books[0]?.status).toBe('draft')
  })

  it('story.json 读不回来（半截 / 信封不对）时跳过，不当成一本书', async () => {
    const store = await createMemoryStore()
    await store.put({
      path: 'books/half/story.json',
      bytes: new TextEncoder().encode('{"bookId": "ha'),
      mime: 'application/json',
    })
    // 信封不对：没有 doc
    await store.putJson({ path: 'books/nodoc/story.json', value: { bookId: 'nodoc' } })
    await store.putJson({ path: 'books/ok/story.json', value: draft('ok', 1) })

    expect((await listBooks(store, noCovers)).map((item) => item.bookId)).toEqual(['ok'])
  })

  it('booksOnly 把故事草稿摘出去（个人主页与角色墙都读它）', async () => {
    const store = await createMemoryStore()
    await store.putJson({ path: 'books/s1/story.json', value: draft('s1', 900) })
    await store.putJson({ path: 'books/b1/book.json', value: book({ bookId: 'b1', createdAt: 1 }) })

    const all = await listBooks(store, noCovers)
    expect(all.map((item) => item.bookId)).toEqual(['s1', 'b1'])
    expect(booksOnly(all).map((item) => item.bookId)).toEqual(['b1'])
  })
})

/**
 * 草稿 / 成品（工单 03）。
 *
 * 这一组钉的是缺省值，不是一个字段的有无：盘上已经有两种没有 `status` 的书
 * （随仓库提交的演示书、这个字段之前跑出来的运行期书）。把它们判成草稿的话，
 * 它们会凭空从书架消失——而用户只会以为书丢了。
 */
describe('status：缺省是成品，只有明确写着 draft 的才是草稿', () => {
  it('没有这个字段 → 成品（老的 book.json 与演示书都靠这一条活着）', () => {
    expect(summarize(book({ bookId: 'b1' }), NO_COVER).status).toBe('published')
  })

  it('写着 draft → 草稿', () => {
    expect(summarize(book({ bookId: 'b1', status: 'draft' }), NO_COVER).status).toBe('draft')
  })

  it('写着 published → 成品', () => {
    expect(summarize(book({ bookId: 'b1', status: 'published' }), NO_COVER).status).toBe(
      'published',
    )
  })
})
