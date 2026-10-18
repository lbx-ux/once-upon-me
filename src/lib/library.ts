/**
 * library.ts —— 书架上有什么（主页要的那份清单）
 *
 * 与 `book-source.ts` 的关系：那个回答"**这一本**在哪、怎么读"（单本，含演示书），
 * 这个回答"**一共有哪些本**"（列表）。分开是因为用途不同——阅读器要的是完整清单与页表，
 * 主页要的是一行摘要，把整本 `book.json`（含每页的 prompt 与资产指纹）搬到主页上是浪费。
 *
 * ★ 两条约定：
 *
 * 1. **只列运行期的书**（资产根下 `books/<id>/book.json`），不列 `public/demo` 里那本。
 *    理由是"我的故事"这个标题：随仓库提交的演示书不是用户做的，混进来就是往
 *    "已创作故事"里灌一个假数。演示书有自己的入口（`/shelf` 空态那条线；
 *    首页那颗「看一本成品」2026-10-17 起改指 `/booklist`，走的是另一批样书）。
 * 2. **摘要里的每个数都来自清单本身**（★ 2026-10-18 起"来自清单"包含**照清单算一步**）：
 *    页数 = 清单里那棵树的路长（`pageCount`；全表节点数是另一个字段 `nodeCount`），
 *    有图页数 = `illustrations` 里真的有条目的那些，"有朗读" = `narrations` 非空。
 *    推算出来的数（比如"大概 20 分钟能读完"）仍旧不进这里——那是另一种编。
 *    ★ 为什么"路长"这一步可以算：它在清单里**已经定死了**（`tree.next` / `pathFromRoot`
 *      是②装订时写进去的，不是这里猜的），而节点数不是这个问题的答案（见 `pageCount`）。
 *      草稿那一档（`summarizeStory`）算的是同一个量、用的是闸门那一屏**同一个**函数。
 * 3. **封面地址由调用方给**（`urlOf`）。这一屏要把封面显示多大是显示的事，
 *    不是书库的事；而"资产路径 → 地址"那条翻译只有一条
 *    （`book-source.ts` 的 `runtimeAssetUrl`，以 `coverUrlOf` 递进来）。
 */

import { manifestPathOf, isDraft, type Book } from './engine/index.ts'
import { pathLengthsOf } from './engine/tree.ts'
import { storyShapeOf } from './story-shape.ts'
import type { AssetStore } from './engine/providers/types.ts'
import type { BookForm } from './engine/domain.ts'
import { readStory, STORY_FILE, type StoryDraft } from './story-draft.ts'

/**
 * 书架上那一本是**什么状态**。
 *
 * ★ 2026-10-17（故事闸门）多了 `'story'` 这一档：`books/<id>/story.json` 在、
 *   `book.json` 不在 —— **故事写好了、还没开始画**。它与另外两个值说的是同一件事：
 *   **盘上有什么**。
 *
 * | 值 | 盘上有什么 | 界面上叫什么 |
 * | --- | --- | --- |
 * | `'story'` | 只有 `story.json`（+ 过程日志） | 还没开始画 |
 * | `'draft'` | 有 `book.json`，`status: 'draft'` | 正在编辑 |
 * | `'published'` | 有 `book.json`，其余（含没有 status 的老书） | 成品 |
 *
 * ★ 三者**不是同一件事的三个进度条刻度**：前两个的区别是"有没有图"，
 *   后两个的区别是"用户说了算不算"。合成一个数字（比如 33% / 66% / 100%）就会
 *   把"没有图"与"没装订"说成同一根轴上的事，而它们的判据、能做的动作、
 *   以及"要不要花钱"都不一样。
 */
export type BookStatus = 'story' | 'draft' | 'published'

export type BookSummary = {
  bookId: string
  title: string
  /**
   * 这本书**读起来有多少页** = 路长（工单 06 §三，2026-10-18）。
   *
   * ★ 2026-10-18 之前它是"表里的节点数"。共读版落地那一刻这个口径就成了假话：
   *   一棵树有两条路，而那个孩子只走其中一条；另一支的页也在盘上、也花了钱，
   *   但他永远读不到。书架上的"几页"回答的是**这本书读起来多长**，所以它是路长。
   * ★ 两条支不一样长时取**长的**那一条（`readPages`）：书架上的数是"最多读到多少"，
   *   短的那一支读到少一页是它自己的路。差 1 页是常态（`buildTree` 钉着）。
   * ★ 要"这本书一共画了几页"请看 `nodeCount`——那是**另一个数**、另一个问题。
   */
  pageCount: number
  /**
   * 全树节点数（含走不到的那一支）。管理页与审计看的是它。
   *
   * ★ 与 `pageCount` 分开记：两个数在独读版上相等、在共读版上差着那一支——
   *   合成一个数，症状是"书架说 7 页，而这本书有 9 张图"，两个都说不清。
   */
  nodeCount: number
  /**
   * 这一本是独读版还是共读版（工单 06 §三）。
   *
   * ★ 书架要拿它标出「共读版」：两种形态在架子上**长得一模一样**（封面 + 书名 + N 页），
   *   不标就分不出——而它们对孩子是两件事（一本听完就睡，一本中途要选一次）。
   * ★ 没有这个字段的书（类型上不该有，盘上确实一本都没有）就是**不标**：
   *   `solo` 是"没有选择点"，那正是它们的形状。不为一个不存在的形状写一段兜底。
   */
  form: BookForm
  /** 真的落了图的页数。★ 与页数分开记：一本 20 页里 3 页没出图是可能的，那是两件事 */
  illustratedCount: number
  /** 这本书有没有朗读（`narrations` 非空） */
  hasNarration: boolean
  /**
   * 草稿还是成品（工单 03），见 `BookStatus` 那张表。
   *
   * ★ **缺省是成品**，判据在引擎那边只有一处（`isDraft`）：盘上老的 `book.json`
   *   与随仓库提交的演示书都**没有这个字段**，把它们判成草稿会让它们
   *   凭空从书架消失——而用户只会以为书丢了。
   * ★ `'story'` 这一档**不看清单**（清单还没写），它看的是"目录里有没有 `book.json`"
   *   ——见 `listBooks`。
   */
  status: BookStatus
  cardId: string
  createdAt: number
  /**
   * 封面地址。**null = 这本书没有封面**（`Book.cover` 是可选字段，为读旧书而留）。
   *
   * ★ 与 `ResolvedBook.coverUrl` 同一条规矩：没有封面就照实没有，
   *   **不许拿第一页冒充封面**——那是"图没到位就留一个诚实的兜底"这条。
   * ★ 故事草稿**一定**是 `null`：一页都还没画，当然没有封面。
   */
  coverUrl: string | null
}

/**
 * 只留"已经画成一本书"的那些（**故事草稿不算**）。
 *
 * ★ 它不是"顺手写的 filter"，而是一条判据：**故事草稿还不是一本书**。
 *   两个地方要用它，理由各是各的、但结论一样：
 *
 * - 个人主页的"最近的书"点进去是**阅读器**（`/reader/<id>`）——
 *   一本还没画的点进去是空的；
 * - 角色墙那句"用他做过 **N 本书**"数的是书，把只有故事的本子算进去，
 *   那个数就不再是"做过几本"了。
 *
 * ★ 写成函数而不是两处各写一遍 `status !== 'story'`：这两处的**措辞**将来
 *   一定会分头改（"还没画的不算" / "读不开的不算"），而它们说的其实是同一件事。
 *
 * ★ 返回类型把 `'story'` 从 `status` 里**减掉**：调用方拿到它之后就再也不必处理
 *   那一档了（个人主页那一屏的 `RecentBook` 只有"草稿 / 成品"两种标签，
 *   把 `'story'` 留在类型里就是逼它在下游再判一次）。
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
 * 书架上那本封面要多大。★ 一个数只写一遍：显示宽度（`shelf.css` 的 `--book-w`，
 * 上限 192px）× 2 倍屏 = 384 → **正好**是 `thumbs.ts` 档位表里的 384 那一档。
 * ★ 2026-10-17 `--book-w` 从 156 抬到 192 时，这个数**没动**：192 就是这一档的
 *   天花板，抬上去只是把已经付过钱的那一档用满，请求还是 `?w=384`。
 *   越过它才要改这里（→ 512），而那是一次真花钱的决定。
 * 档位是封闭表，写小了会被向上归到 384，写大了就白拉一张 1024 的（116 KB → 一屏六本）。
 */
export const SHELF_COVER_WIDTH = 384

/**
 * "这一屏不显示封面" —— 给只数数、不摆封面的调用方（角色墙数"用他做过几本"）。
 *
 * ★ 显式传进来，**不设默认值**：默认值会让"调用方忘了给"和"这本书本来就没有封面"
 *   在类型上都是 `null`——而它们不是一件事。这是 domain.ts 那条
 *   "缺图 vs 未核对"的翻版，这里不重犯。
 */
export const noCovers = (): null => null

/**
 * 路长（一个树上所有"从根到叶"的长度）→ 书架上写的那个数。**取长的**。
 *
 * ★ 两条路不一样长时取长的：架子上的"8 页"是**最多读到多少**，那么没有一个孩子会
 *   读到比它更多的页（走短那一支的读到 7 页，那是他自己的路）。反过来取短的，
 *   家长按 7 页安排睡前时间、孩子读了 8 页——而架子写的是一个确定数，不像"至少"。
 * ★ 用 `pathLengthsOf` 的**升序**去重表，最后一个就是最长的（不必 `Math.max`）。
 * ★ 问不出路长时（一个数都没有）回全表节点数：它与 `nodeCount` 相等，
 *   不是第二个口径，是"路长在这棵树上问不出答案"时唯一数得出的东西。
 *   两种触发都真实：树是坏的（一个叶都没有），或者清单里的 `pathFromRoot` 是空的
 *   （手工摆的 fixture 就是这样——本书架的单测里有一条钉着它）。
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
    //   那个函数带着"缺省 = 成品"这条**迁移决定**，抄第二份就会有一天抄漏
    status: isDraft(book) ? 'draft' : 'published',
    cardId: book.cardId,
    createdAt: book.createdAt ?? 0,
    coverUrl,
  }
}

/**
 * 一份**故事草稿** → 一行摘要（2026-10-17，故事闸门）。
 *
 * ★ 它读的是 `story.json`（`lib/story-draft.ts`），不是清单：这一本还没有清单。
 *   页数是**故事里的页数**（`doc.nodes.length`）。
 * ★ `drawn` 是**盘上真的落了图的那几页**（调用方数 `page-*.png` 得到）。
 *   它可能不是 0：这一本可能正在画（用户点完「就按这个画」又退出去的那一段），
 *   也可能画到一半进程被杀过。原来这里恒为 0、书架上就写"还没开始画"——
 *   而用户看到的盘上已经有好几张图了（2026-10-17 实测报的 bug，原话是
 *   "他告诉我正在生成中，我看不到画的什么"）。
 * ★ 封面是 `null`：`cover.png` 是装订那一步的产物，而这一本还没装订。
 */
export function summarizeStory(bookId: string, draft: StoryDraft, drawn = 0): BookSummary {
  /*
   * 页数口径与 `summarize` 一样是**路长**，而且用的是闸门那一屏**同一个**
   * `storyShapeOf`（它内部就是 `buildTree`）：两处各算一份的症状是
   * "书架说 9 页、闸门说 7 页"，而这两个数说的是同一本书。
   * ★ 草稿存的是 `doc`（平铺的页表），路长要从它派生——`story-draft.ts` 文件头第 1 条
   *   写着"派生只发生在两处：②开跑前，与书架数页数"，这就是那第二处。
   * ★ 树建不起来（这一版还有错、正停在闸门那一屏）时 `storyShapeOf` 回 `null`：
   *   那时候两个数都是**全表节点数**。路长在这份草稿上还不存在（正是那些错让它不存在），
   *   而闸门那一屏正在说为什么。这不是拿节点数冒充路长——是那个数还没算出来。
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
 * `coverUrlOf` 由调用方给：**这一屏要把封面显示多大，是显示的事，不是书库的事**。
 * 路径 → 地址那条翻译只有一条（`book-source.ts` 的 `runtimeAssetUrl`，经过
 * `coverUrlOf` 递进来），这里只负责把每一本 `book` 交出去。不显示封面的调用方
 * 传 `noCovers`。
 *
 * ★ 2026-10-17：**一个目录只有 `story.json` 没有 `book.json`**（故事写好了、还没画）
 *   也算书架上的一本（`status: 'story'`）。不认它的话，家长在闸门那一屏改完故事、
 *   关掉标签页之后**再也没有入口回到那一段故事**——它还在盘上，只是界面上找不到。
 *   ★ 判据是"这个目录里有没有 `book.json`"，不是"清单里那个 status"：清单还没写呢。
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
  /** 有清单的书号。收尾时用来判断"哪些目录只有故事" */
  const withManifest = new Set<string>()

  for (const path of paths.filter((one) => one.endsWith('/book.json'))) {
    // ★ `readJson` 对半截 JSON 是**抛错**的（不是返回 null——这条是 library.test.ts 抓出来的）。
    //   进程被杀时最后写的那一件就是这种形状，而 `book-source.ts` 对同一件事的处理是
    //   "不存在与半截 JSON 都当作这里没有这本书"。一本读不出来的书不该让整个书架 500。
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
    // 书号 = 目录名。★ 不读 `story.json` 里的 `bookId` 字段：那是**写进去的**，
    //   而目录名是它唯一的家（`bookDirOf` 那一段"三处各写一遍会漂"是同一个道理）
    const bookId = path.slice('books/'.length, path.length - `/${STORY_FILE}`.length)
    if (withManifest.has(bookId)) continue
    const draft = await readStory(store, bookId)
    // ★ 2026-10-17（用户实测报的 bug）：这一本**可能已经在画了**——他点完
    //   「就按这个画」、从运行视图退出、回到书架。原来这一行恒为 0，于是书架上
    //   写着「还没开始画」，而盘上已经躺着几张页图（他看到的正是这一句）。
    //   判据用**已经落图的那几页**，不用"在不在跑"那个进程内的租约：
    //   半路被杀的那一本也该照实说"画到第几页"，而那件事租约不知道。
    //   数的是 `paths` 里同一目录下的 `page-*.png`（封面不算：它是另一件事，
    //   而且 `illustratedCount` 在清单那条路上数的也是正文页）。
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
