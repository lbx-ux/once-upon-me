/**
 * library.ts —— 书架上有什么（主页要的那份清单）
 *
 * 与 `book-source.ts` 分工：那个回答"这一本在哪、怎么读"，这个回答"一共有哪些本"。
 * 分开是因为主页只要一行摘要，把整本 `book.json` 连每页提示词与资产指纹搬过去是浪费。
 *
 * 只列运行期的书（资产根下 `books/<id>/book.json`），不列 `public/demo` 里那本：
 * 演示书不是用户做的，混进"我的故事"里就是灌一个假数。它有自己的入口
 * （`/shelf` 空态那条线；首页那颗「看一本成品」2026-10-17 起改指 `/booklist`）。
 *
 * 摘要里的数：或者直接来自清单，或者照清单算一步——路长在装订那一步就写死了，
 * 不是这里猜的。推算出来的数（"大概 20 分钟读完"）不进这里。
 */

import { manifestPathOf, isDraft, type Book } from './engine/index.ts'
import { pathLengthsOf } from './engine/tree.ts'
import { storyShapeOf } from './story-shape.ts'
import type { AssetStore } from './engine/providers/types.ts'
import type { BookForm } from './engine/domain.ts'
import { readStory, STORY_FILE, type StoryDraft } from './story-draft.ts'

/**
 * 盘上有什么。三档不是一根进度条上的三格：前两档差在"有没有图"，后两档差在
 * "用户说了算不算"——判据、能做的动作、要不要花钱都不一样。
 *
 * 只剩 `story.json` = 故事写好了、还没开始画（2026-10-17 故事闸门加的）；
 * 有 `book.json` 且 `status: 'draft'` = 正在编辑；其余（含没有 status 的老书）= 成品。
 */
export type BookStatus = 'story' | 'draft' | 'published'

export type BookSummary = {
  bookId: string
  title: string
  /**
   * 这本书读起来有多少页 = 路长（2026-10-18 改的口径）。
   *
   * 在这之前它是"表里的节点数"，共读版落地那一刻就成了假话：一棵树两条路，
   * 另一支的页也在盘上、也花了钱，但那个孩子永远读不到。
   * 两支不一样长时取长的：架子上的数是"最多读到多少"，而不是"至少"。
   * 要"这本书一共画了几页"看 `nodeCount`，那是另一个问题。
   */
  pageCount: number
  /** 全树节点数，含走不到的那一支。管理页与审计看的是它 */
  nodeCount: number
  /** 独读版还是共读版。两种形态在架子上长得一模一样，不标就分不出，而它们对孩子是两件事 */
  form: BookForm
  /** 真的落了图的页数。与页数分开记：一本 20 页里 3 页没出图是可能的 */
  illustratedCount: number
  hasNarration: boolean
  /**
   * 缺省是成品。判据只有一处（引擎的 `isDraft`）：盘上老的 `book.json` 与
   * 随仓库提交的演示书都没有这个字段，把它们判成草稿会让它们凭空从书架消失，
   * 而用户只会以为书丢了。
   * `'story'` 那一档不看清单（清单还没写），看的是目录里有没有 `book.json`。
   */
  status: BookStatus
  cardId: string
  createdAt: number
  /** 没有封面就照实没有，不许拿第一页冒充。故事草稿一定是 `null`：一页都还没画 */
  coverUrl: string | null
}

/**
 * 只留"已经画成一本书"的那些，故事草稿不算。
 *
 * 两个调用方理由不同、结论一样：个人主页的"最近的书"点进去是阅读器，没画的是空的；
 * 角色墙那句"用他做过 N 本书"数的是书。
 * 写成函数而不是两处各写一遍 `status !== 'story'`，是因为这两处的措辞将来一定会
 * 分头改（"还没画的不算" / "读不开的不算"），说的却是同一件事。
 *
 * 返回类型把 `'story'` 从 `status` 里减掉：调用方拿到它之后就不必再处理那一档了。
 */
export function booksOnly(
  books: readonly BookSummary[],
): (BookSummary & { status: Exclude<BookStatus, 'story'> })[] {
  return books.filter(
    (book): book is BookSummary & { status: Exclude<BookStatus, 'story'> } =>
      book.status !== 'story',
  )
}

/**
 * 封面显示宽度（`shelf.css` 的 `--book-w` 上限 192px）× 2 倍屏 = 384，正好落在
 * `thumbs.ts` 档位表里 384 那一档。档位是封闭表：写小了会被向上归到 384，
 * 写大了就白拉一张 1024 的。
 *
 * 2026-10-17 `--book-w` 从 156 抬到 192 时这个数没动——192 就是这一档的天花板，
 * 抬上去只是把已经付过钱的那一档用满，请求还是 `?w=384`。
 * ★ 越过它才要改这里（→ 512），而那是一次真花钱的决定。
 */
export const SHELF_COVER_WIDTH = 384

/**
 * "这一屏不显示封面"——给只数数、不摆封面的调用方（角色墙数"用他做过几本"）。
 *
 * 显式传进来、不设默认值：默认值会让"调用方忘了给"和"这本书本来就没有封面"
 * 在类型上都是 `null`，而它们不是一件事。
 */
export const noCovers = (): null => null

/**
 * 路长 → 书架上写的那个数。取长的。
 *
 * 架子上的"8 页"是"最多读到多少"：反过来取短的，家长按 7 页安排睡前时间、孩子读了 8 页。
 * `pathLengthsOf` 给的是升序去重表，最后一个就是最长的，不必 `Math.max`。
 *
 * 问不出路长时（树是坏的、一个叶都没有，或者手摆的 fixture 里 `pathFromRoot` 是空的）
 * 回全表节点数——它与 `nodeCount` 相等，不是第二个口径，是这里唯一数得出的东西。
 */
function readPages(pathPages: readonly number[], nodeCount: number): number {
  const longest = pathPages[pathPages.length - 1]
  return longest ? longest : nodeCount
}

/** 一份清单 → 一行摘要。纯函数，所以"页数怎么算"这件事可以被测 */
export function summarize(book: Book, coverUrl: string | null): BookSummary {
  const nodeCount = book.tree?.nodes?.length ?? 0
  return {
    bookId: book.bookId,
    title: book.tree?.title ?? '(没有名字的书)',
    // ★ 树里已经有 `next` 与 `pathFromRoot`（②装订时算好的），这里只是把它读成一个数
    pageCount: readPages(book.tree?.nodes ? pathLengthsOf(book.tree) : [], nodeCount),
    nodeCount,
    form: book.form,
    illustratedCount: book.illustrations?.length ?? 0,
    hasNarration: (book.narrations?.length ?? 0) > 0,
    // ★ 判据走 `isDraft`，不在这里再写一遍 `book.status === 'draft'`：
    //   那个函数带着"缺省 = 成品"这条迁移决定，抄第二份就会有一天抄漏
    status: isDraft(book) ? 'draft' : 'published',
    cardId: book.cardId,
    createdAt: book.createdAt ?? 0,
    coverUrl,
  }
}

/**
 * 一份故事草稿 → 一行摘要（2026-10-17，故事闸门）。
 *
 * 读的是 `story.json`，不是清单——这一本还没有清单。页数走的是闸门那一屏同一个
 * `storyShapeOf`：两处各算一份的症状是"书架说 9 页、闸门说 7 页"，而这两个数说的是同一本书。
 * 树建不起来（这一版还有错、正停在闸门那一屏）时它回 `null`，那时候两个数都是全表节点数——
 * 路长在这份草稿上还不存在，不是拿节点数冒充路长。
 *
 * `drawn` 是盘上真的落了图的那几页，由调用方数。它可能不是 0：这一本可能正在画
 * （用户点完「就按这个画」又退出去的那一段），也可能画到一半进程被杀过。
 * 原来这里恒为 0、书架上就写"还没开始画"，而盘上已经躺着好几张图了
 * （2026-10-17 实测报的 bug）。封面是 `null`：`cover.png` 是装订那一步的产物。
 */
export function summarizeStory(bookId: string, draft: StoryDraft, drawn = 0): BookSummary {
  /*
   * 页数口径与 `summarize` 一样是路长。草稿存的是平铺的页表，路长要从它派生——
   * `story-draft.ts` 写着派生只发生在两处：②开跑前，与书架数页数，这就是那第二处。
   */
  const nodeCount = draft.doc.nodes.length
  const shape = storyShapeOf(draft.input.form, draft.doc)
  return {
    bookId,
    title: draft.doc.title.trim() === '' ? '(还没有名字)' : draft.doc.title,
    pageCount: readPages(shape?.pathPages ?? [], nodeCount),
    nodeCount,
    form: draft.input.form,
    illustratedCount: drawn,
    hasNarration: false,
    status: 'story',
    cardId: draft.input.cardId,
    createdAt: draft.createdAt ?? 0,
    coverUrl: null,
  }
}

/**
 * 列书。读不到、或半截 JSON（进程被杀时最后写的那一件）都跳过——
 * 一本读不出来的书不该让整个书架 500（`book-source.ts` 对同一件事的处理是一样的）。
 *
 * `coverUrlOf` 由调用方给：这一屏要把封面显示多大是显示的事，不是书库的事。
 * 路径 → 地址那条翻译只有一条（`book-source.ts` 的 `runtimeAssetUrl`，经过它递进来）。
 * 不显示封面的调用方传 `noCovers`。
 *
 * 2026-10-17 起，一个目录只有 `story.json` 没有 `book.json` 也算书架上的一本
 * （`status: 'story'`）。不认它的话，家长在闸门那一屏改完故事、关掉标签页之后
 * 就再也没有入口回到那一段故事——它还在盘上，只是界面上找不到。
 * 判据是"这个目录里有没有 `book.json`"，不是清单里那个 status：清单还没写呢。
 */
export async function listBooks(
  store: AssetStore,
  coverUrlOf: (book: Book) => string | null,
): Promise<BookSummary[]> {
  let paths: string[]
  try {
    paths = await store.list('books/')
  } catch {
    return []
  }
  const books: BookSummary[] = []
  /** 有清单的书号，收尾时用来判断哪些目录只有故事 */
  const withManifest = new Set<string>()

  for (const path of paths.filter((one) => one.endsWith('/book.json'))) {
    // ★ `readJson` 对半截 JSON 是抛错的，不是返回 null（library.test.ts 抓出来的）。
    // 进程被杀时最后写的那一件就是这种形状。
    let book: Book | null = null
    try {
      book = await store.readJson<Book>(path)
    } catch {
      book = null
    }
    if (book) {
      books.push(summarize(book, coverUrlOf(book)))
      withManifest.add(book.bookId)
    }
  }

  for (const path of paths.filter((one) => one.endsWith(`/${STORY_FILE}`))) {
    // 书号 = 目录名。不读 `story.json` 里的 `bookId` 字段：那是写进去的，
    // 而目录名是它唯一的家（`bookDirOf` 那一段"三处各写一遍会漂"是同一个道理）
    const bookId = path.slice('books/'.length, path.length - `/${STORY_FILE}`.length)
    if (withManifest.has(bookId)) continue
    const draft = await readStory(store, bookId)
    // 这一本可能已经在画了——他点完「就按这个画」、从运行视图退出、回到书架。
    // 2026-10-17 之前这一行恒为 0，于是书架上写着「还没开始画」，而盘上已经躺着几张页图。
    // 判据用已经落图的那几页，不用"在不在跑"那个进程内的租约：
    // 半路被杀的那一本也该照实说"画到第几页"，而那件事租约不知道。
    // 数的是同一目录下的 `page-*.png`，封面不算——`illustratedCount` 在清单那条路上
    // 数的也是正文页。
    const prefix = `books/${bookId}/page-`
    const drawn = paths.filter(
      (one) => one.startsWith(prefix) && one.endsWith('.png') && !one.includes('/thumbs/'),
    ).length
    if (draft) books.push(summarizeStory(bookId, draft, drawn))
  }

  // 新的在前。同一毫秒（不可能但便宜）按书号兜底，保证顺序稳定
  return books.sort((a, b) => b.createdAt - a.createdAt || a.bookId.localeCompare(b.bookId))
}

/** 书号 → 清单路径。与引擎同一个约定，不许在别处再拼一次 */
export { manifestPathOf }
