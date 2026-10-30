/**
 * book-source.ts —— 一本书从哪读：运行期产物，或随仓库提交的预生成演示书
 *
 * ADR-0003 的演示路径靠它成立："一本已经生成好的书是资产，不是一次调用"。
 * 所以查找顺序是两个来源、一个函数：
 *
 * ```
 *   1. 运行期：ASSET_ROOT/u/<用户>/books/<id>/book.json  （家长刚做出来的那本）
 *   2. 预生成：public/demo/books/<id>/book.json          （随仓库提交，断网也在）
 * ```
 *
 * ★ 为什么必须是一个函数：两个来源、两种 URL 前缀。页面里各写一遍查找顺序，
 *   就是两份迟早会漂的真相——漂了以后的症状是"本地能翻，演示那台说图不存在"。
 *
 * 服务端专用。客户端拿到的是已经算好的 URL 列表（见 `readerPages`），
 *   它不需要知道这本书来自哪儿，也不该知道。
 *
 * ★ 2026-10-17：运行期那一条**多了一段 `u/<用户>`**（资产按用户分目录，工单 16）。
 *    这一层原来拼的是裸根 `books/<id>/book.json`，而那个文件已经搬走了——
 *    症状是用户实测报的"书架里看得见这本，点进去说找不到这本书"：
 *    书架那一头读的是这个人自己那一片（`(studio)/shelf/page.tsx` 的
 *    `createUserStore`），这一头却还在老地方找。
 *    所以现在由调用方把自己那一片递进来，与 `/api/assets` 那条路由同一条口径
 *    （它也 `createUserStore(assetRoot(), userId)`）。
 *
 *    这个参数是必给的（`AssetStore | null`，不是可选），这是刻意的：
 *      "这本书从谁那一片读"必须是一个当场写下来的决定，不能有一个
 *      "什么都不传就……"的缺省。传 `null` 的含义是这个人没有那一片
 *      （没登录）→ 于是只有演示书那一条，与书架未登录时给空架子同一条口径
 *      （「权限是结构性的，不是过滤」）。
 *      脚本若真要读裸根，那一句话就是 `createUnscopedStore(assetRoot())`——
 *        `asset-scope.ts` 特意让那个名字每次出现都要被解释一遍。
 *    ★ 代价说清楚：运行期的书因此只有它的主人在登录状态下读得到——
 *      图那一头本来就是这条口径（资产路由也要会话），所以这不是新加的约束，
 *      是让正文那一头别再假装人人可读。
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assetUrlOf, encodeAssetPath } from './asset-url.ts'
import { isResizableImage, READER_PAGE_WIDTH } from './thumbs.ts'
import type { AssetStore } from './engine/providers/types.ts'
import { iconUrlOf } from './choice-icons.ts'
import {
  isBookId,
  linearOrder,
  manifestPathOf,
  type Book,
  type ChoiceOption,
  type StoryNode,
} from './engine/index.ts'

/** 预生成演示书在 `public/` 下的位置。导出脚本与这一层共用这串字面量 */
export const DEMO_DIR = 'demo/books'

export type BookSource = 'runtime' | 'demo'

/** 阅读器要的一页：图 + 正文 + 朗读。`imageUrl` 为 null 表示这一页没做出来（书里标了） */
export type ReaderPage = {
  pageNo: number
  imageUrl: string | null
  /**
   * 这一页的朗读音频。null = 这一页没有朗读（书里没有 narrations，或这一页没配上）。
   * ★ 它与 `imageUrl` 为 null 是两件事，不许合并：图缺了这一页没法读，
   *   音缺了这一页照样能读（工单 08 §一 的判据 ③）。
   */
  audioUrl: string | null
  /** 正文，一句一段。★ 真 HTML 文字，绝不画进图里（中文进图必错字） */
  body: readonly string[]
  missing: boolean
}

export type ResolvedBook = {
  book: Book
  source: BookSource
  /**
   * 封面图。null = 这本书没有封面：仓库里那本预生成的演示书是在有 `cover`
   * 这个字段之前出的（见 domain.ts 那条注释）。阅读器遇到 null 就照实只出书名，
   * 不许拿第一页冒充封面——那是"图没到位就留一个诚实的兜底"这条。
   */
  coverUrl: string | null
  /**
   * 页表：按页号排的全表。独读版的阅读顺序就是它。
   * ★ 共读版不能拿它当阅读顺序（那会把走不到的那一支也读出来）——
   *   共读版要的是 `story` + `storyPath()`。（2026-10-18）
   */
  pages: ReaderPage[]
  /** 树的形状 + 每一页的图/音/选择点。两种形态共用它，见 `readerStory` */
  story: ResolvedStory
}

/* 共读版要的那一层：树 + 每一页的视图 */

/**
 * 一个选项能直接渲染的样子：图与音都算成了地址，文字是给孩子看/听的那两句。
 *
 * `iconUrl` 为 null 不是错误：模型写的 `iconKey` 可以不在词表里，
 *   那时界面露 `emoji`。见 `lib/choice-icons.ts` 那段。
 */
export type StoryOptionView = {
  label: string
  spoken: string
  emoji: string
  iconUrl: string | null
  /** 这一句的朗读；null = 这一句没录上（与"整本没配音"是两件事） */
  audioUrl: string | null
}

export type StoryChoiceView = {
  /** 给家长念的引导提问（不识字的孩子由家长念；有配音时它也会被念出来） */
  prompt: string
  promptAudioUrl: string | null
  /** 顺序 = 按钮的左右顺序。`options[0]` 对应 `via: 'a'` 那一支（tree.ts 保证） */
  options: readonly [StoryOptionView, StoryOptionView]
}

/**
 * 一页能直接渲染的样子。
 *
 * ★ `pageNo` 是资产编号，不是"第几页"：共读版里这两个数必须分开
 *   （`page-7-a1.webp` 可能是孩子读到的第 2 页）。给人看的那个数由路径算，
 *   见 `components/reader/reader-model.ts` 的 `readoutOf`。
 */
export type StoryView = {
  nodeId: string
  pageNo: number
  body: readonly string[]
  imageUrl: string | null
  /** 这一页正文的朗读 */
  audioUrl: string | null
  missing: boolean
  /** 这一页的子节点。选择点两个（顺序 = 选项顺序），其余页 0 或 1 个 */
  next: readonly string[]
  /** 这一页是选择点时才有 */
  choice: StoryChoiceView | null
}

export type ResolvedStory = {
  form: 'solo' | 'shared'
  rootId: string
  /**
   * 全表（含走不到的那一支）。"哪一些会被读到"由路径决定——
   * 这正是"预生成"这个词的形状：钱在生成那一刻就花完了，读的时候不再花钱。
   */
  nodes: readonly StoryView[]
}

/**
 * 演示书里资产的相对位置：把 `books/<id>/` 前缀摘掉，剩下的挂在
 * `/demo/books/<id>/` 之下。导出脚本用同一个函数落盘，两边不会漂。
 */
export function assetPathInDemo(bookId: string, assetPath: string): string {
  const prefix = `books/${bookId}/`
  return assetPath.startsWith(prefix) ? assetPath.slice(prefix.length) : assetPath
}

/** 预生成书里那张图在浏览器里的地址（静态文件，由 Next 直接出，不经 API） */
export function demoAssetUrl(bookId: string, assetPath: string): string {
  return `/${DEMO_DIR}/${encodeURIComponent(bookId)}/${encodeAssetPath(assetPathInDemo(bookId, assetPath))}`
}

/**
 * 静态的演示图不能挂 `?w=`：Next 直接发盘上的字节，查询字符串它看不懂，
 * 挂上去会静悄悄回原图——一个骗人的优化比不优化更糟。
 * 所以演示书这一路换的是"导出时预生成的 `.webp` 兄弟文件"（见 `export-demo-book.mts`），
 * 磁盘上有就用它，没有就照旧用原图。★ 原图仍然留在目录里：它是清单指的那份记录。
 *
 * 为什么单独抽成一个函数：本机常常同时存在同一本书的运行期副本与演示副本
 *   （书号是确定性的，同一份锚点 + 主题算出同一个号），于是 `resolveBook` 先命中运行期那条，
 *   演示这条分支在浏览器里根本走不到。没有测试的分支等于没有——而它恰好只在
 *   "评委那台只有 `public/` 的机器"上生效，那正是最需要它对的那一台。
 *
 * `webpSiblings` 是那一本目录里 `.webp` 的文件名集合（不是整条路径）。
 */
export function demoAssetPathFor(assetPath: string, webpSiblings: ReadonlySet<string>): string {
  if (!/\.png$/i.test(assetPath)) return assetPath
  const swapped = assetPath.replace(/\.png$/i, '.webp')
  return webpSiblings.has(swapped.split('/').pop() ?? '') ? swapped : assetPath
}

/** 磁盘上的一份清单。演示书走这一条（它随仓库提交，不属于谁那一片） */
async function readBook(path: string): Promise<Book | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Book
  } catch {
    // 不存在、或半截 JSON（进程被杀时最后写的那一件）——都当作"这里没有这本书"
    return null
  }
}

/**
 * 某个人那一片里的一份清单。路径是逻辑路径（`books/<id>/book.json`），
 * 前缀由 `scopedStore` 加——这一层不知道账号存在（`asset-scope.ts` 纪律 1）。
 *
 * `readJson` 两个实现对坏 JSON 的反应不一样（内存 store 直接抛，磁盘 store 吞成 null），
 *   所以这里自己兜一层：判据必须是"任何读不回来的情况都当它不存在"，
 *   而它同时决定阅读器是出书还是出「找不到这本书」——不能两家口径。
 */
async function readBookFrom(store: AssetStore, path: string): Promise<Book | null> {
  try {
    return await store.readJson<Book>(path)
  } catch {
    return null
  }
}

/**
 * 运行期资产 → URL 的那条路。`width` 是这次要显示多大（缩略档由 `thumbs.ts` 归位）。
 *
 * 抽出来是因为它现在有两个消费者、两种尺寸：阅读器要 1024（一页铺满屏），
 *   书架上那本封面只要 384（显示约 156px）。两处各写一遍 `assetUrlOf` +
 *   `isResizableImage` 之后，早晚会出现"内页缩了、封面没缩"这种没人会去查的差异
 *   （封面原来就是一张 2.8 MB 的 PNG，正是这条注释要挡的那件事）。
 *   判据是扩展名，所以"这一页有没有朗读"这件事不受缩放影响。
 */
export function runtimeAssetUrl(path: string, width: number | null, query?: string): string {
  const url = assetUrlOf(path, isResizableImage(path) && width !== null ? width : undefined)
  if (!query) return url
  return `${url}${url.includes('?') ? '&' : '?'}${query}`
}

/**
 * `resolveBook` 的两个可选旋钮。缺省 = 老行为，所有既有调用一个字都不用改。
 *
 * - `assetQuery`：拼到运行期资产 URL 后面（不带 `?`）。分享页用它带 `share=<票>`——
 *   那些 `<img>` 是浏览器匿名取的，`/api/assets` 那条路由要靠这张票认人。
 *   ★ 只对**运行期**那条生效：演示书走 `public/` 静态文件，查询字符串它看不懂
 *   （`demoAssetPathFor` 上面那段写过同一件事）。
 * - `allowDemo`：分享页传 `false`。理由不是安全（演示书是公开的），是"这条链接
 *   指向的是主人这一本"：主人把书删了之后，它不该悄悄变成公共样书。
 */
export type ResolveBookOptions = {
  assetQuery?: string
  allowDemo?: boolean
  /**
   * 页图要哪一档宽（2026-10-29）。缺省 = `READER_PAGE_WIDTH`（1024，阅读器那一档）；
   * 传 `null` = **不缩，用原尺寸**。
   *
   * 打印那一屏传 `null`：一页铺在 297mm 宽的纸上，1024 px 只有约 88 dpi，
   *   而原图是 1536 px（约 131 dpi）。★ 这不是"越大越好"——真正让它可行的是
   *   `?fmt=jpeg`（见 `thumbs.ts` 的 `PRINT_QUALITY`），否则原尺寸会把 PDF 撑到 30 MB。
   */
  pageWidth?: number | null
}

/**
 * 一个书号 → 这一本书。
 *
 * `store` 是请求者自己那一片（登录之后才有）；`null` = 他没有那一片，
 * 于是只剩演示书。见文件头 ★★ 那一段：这个参数是必给的，缺省不存在。
 *
 * 顺序是先你自己的、再演示那本——不是"先新的再旧的"：同一本书可能既是
 * 你刚做出来的（书号是确定性的），又是随仓库提交的演示书，这时给你看你自己那份
 * （`demoAssetPathFor` 上面那段注释记的正是这件事）。
 */
export async function resolveBook(
  bookId: string,
  store: AssetStore | null,
  options: ResolveBookOptions = {},
): Promise<ResolvedBook | null> {
  // ★ 书号来自 URL（`/reader/<bookId>`），而下面两处会把它拼进路径：
  //   store 的逻辑路径、以及演示书那一条的 `join(…, 'public', DEMO_DIR, bookId)`。
  //   store 那一侧有 `assertInsideScope`，可它在 `..` 时**抛**，而 `readBookFrom`
  //   把异常吞成 null——于是控制流会掉进演示书那一条，绕过商店的边界。
  //   2026-10-22 审查实测：`..%2F..%2F.out%2Fweb%2Fu%2F7%2F…` 能让匿名读者读到
  //   另一个账号的清单。判据放在入口，两个分支一起挡住。
  //   不合法 = "这里没有这本书"，与半截 JSON 同一个口径；不抛、不回声书号。
  if (!isBookId(bookId)) return null

  const manifestPath = manifestPathOf(bookId)
  const runtime = store
    ? await readBookFrom(store, manifestPath)
    : // 没有那一片就不去别处找：裸根是迁移之前的老地方，
      // 现在盘上的新书一本也不会落在那儿（见文件头）
      null
  if (runtime) {
    // 图与封面走同一条 urlOf（1024 档，`/api/assets` 现缩并落盘缓存）
    const pageWidth = options.pageWidth === undefined ? READER_PAGE_WIDTH : options.pageWidth
    const runtimeUrl = (path: string): string =>
      runtimeAssetUrl(path, pageWidth, options.assetQuery)
    return {
      book: runtime,
      source: 'runtime',
      coverUrl: coverUrlOf(runtime, runtimeUrl),
      pages: readerPages(runtime, runtimeUrl),
      story: readerStory(runtime, runtimeUrl),
    }
  }

  // 分享页传 `allowDemo: false`：链接只指向主人这一本（见 `ResolveBookOptions`）
  if (options.allowDemo === false) return null

  const demoDir = join(process.cwd(), 'public', DEMO_DIR, bookId)
  const demo = await readBook(join(demoDir, 'book.json'))
  if (demo) {
    // 目录里有哪些 `.webp` 兄弟文件。读不到目录就当都没有（回原图，不是回一张碎图）
    const siblings = new Set(
      (await readdir(demoDir).catch(() => [] as string[])).filter((name) => /\.webp$/i.test(name)),
    )
    const demoUrl = (path: string): string => demoAssetUrl(bookId, demoAssetPathFor(path, siblings))
    return {
      book: demo,
      source: 'demo',
      coverUrl: coverUrlOf(demo, demoUrl),
      pages: readerPages(demo, demoUrl),
      story: readerStory(demo, demoUrl),
    }
  }
  return null
}

/**
 * 封面 → 阅读器的封面地址。没有 `cover` 字段就是 null（见 `ResolvedBook.coverUrl`）。
 *
 * 单独一个导出函数，理由与 `readerPages` 一样：它是"书的字段 → 页面要的东西"
 *   这一步翻译，要能被单测钉住，而不是埋在 `resolveBook` 里跟着文件系统一起难测。
 */
export function coverUrlOf(book: Book, urlOf: (assetPath: string) => string): string | null {
  return book.cover ? urlOf(book.cover.asset.path) : null
}

/**
 * 书 → 阅读器的页表。
 *
 * 这里要处理三种"这一页没有图"，而且它们不是同一件事（domain.ts 里写过一次，
 *   这里再落一次地）：① 有图且核对过；② 有图但没核对（`verdict: 'unavailable'`）；
 *   ③ 根本没有图（在这本书的 `errors` 里）。阅读器只关心第三种——
 *   前两种的图都是好的，照样给孩子看。
 *
 * 2026-10-18：它现在是 `storyViewsOf` 的一个投影（按页号排的那一条链），
 *   不再自己算一遍图与音——两个消费者共用一个真相（`readerStory` 那一半也要它们）。
 */
export function readerPages(book: Book, urlOf: (assetPath: string) => string): ReaderPage[] {
  const views = storyViewsOf(book, urlOf)
  return linearOrder(book.tree).map((node: StoryNode) => {
    const view = views.get(node.nodeId)
    return {
      pageNo: node.pageNo,
      imageUrl: view?.imageUrl ?? null,
      audioUrl: view?.audioUrl ?? null,
      body: node.body,
      missing: view?.missing ?? true,
    }
  })
}

/**
 * 书 → 一棵能直接渲染的树（两种形态共用）。
 *
 * ★ 为什么共读版不能复用 `readerPages`：它按页号排，于是两条支会被读成
 *   "第 4 页、第 5 页"——孩子选了一次，看到的却是两条路连着。
 *   阅读顺序在共读版里是从根走到叶的那条路（`reader-model.ts` 的 `storyPath`）。
 * 一个 builder、两个消费者：`readerPages`（独读版那条链）与 `readerStory`（树）
 *   都从这里取"这一页的图/音/缺没缺"，于是不会出现"内页缩了、封面没缩"那种没人会去查的差异。
 */
export function readerStory(book: Book, urlOf: (assetPath: string) => string): ResolvedStory {
  const views = storyViewsOf(book, urlOf)
  return {
    form: book.form,
    rootId: book.tree.rootId,
    nodes: book.tree.nodes.map((node: StoryNode) => {
      const view = views.get(node.nodeId)
      return {
        nodeId: node.nodeId,
        pageNo: node.pageNo,
        body: node.body,
        imageUrl: view?.imageUrl ?? null,
        audioUrl: view?.audioUrl ?? null,
        missing: view?.missing ?? true,
        next: node.next,
        choice: view?.choice ?? null,
      }
    }),
  }
}

/**
 * 每一页的图 / 音 / 缺没缺 / 选择点的三段音——两种形态唯一的那个 builder。
 *
 * 键是 `nodeId`（不是 `pageNo`）：共读版里"这一页"是节点，页号只是它的资产编号。
 */
function storyViewsOf(
  book: Book,
  urlOf: (assetPath: string) => string,
): Map<string, Pick<StoryView, 'imageUrl' | 'audioUrl' | 'missing' | 'choice'>> {
  const byPage = new Map(book.illustrations.map((item) => [item.pageNo, item]))
  const failed = new Set(book.errors.map((item) => item.pageNo))
  /**
   * 一页最多四段（正文 / 引导提问 / 选项 A / 选项 B），所以这里按 `(pageNo, part)` 收，
   *   而不是"一页一条"。`part` 缺省就是正文——盘上已有的书没有这个字段。
   */
  const narrationBy = new Map(
    book.narrations.map((item) => [`${item.pageNo}:${item.part ?? 'body'}`, item]),
  )
  const audioOf = (pageNo: number, part: string): string | null => {
    const narration = narrationBy.get(`${pageNo}:${part}`)
    return narration ? urlOf(narration.asset.path) : null
  }

  const views = new Map<string, Pick<StoryView, 'imageUrl' | 'audioUrl' | 'missing' | 'choice'>>()
  for (const node of book.tree.nodes) {
    const illustration = byPage.get(node.pageNo)
    // 缺图判定要同时看两处：没有 illustration 条目，或者页号在硬失败那张表里
    const missing = !illustration || failed.has(node.pageNo)
    views.set(node.nodeId, {
      imageUrl: illustration && !missing ? urlOf(illustration.asset.path) : null,
      audioUrl: audioOf(node.pageNo, 'body'),
      missing,
      choice: node.choice
        ? {
            prompt: node.choice.prompt,
            promptAudioUrl: audioOf(node.pageNo, 'prompt'),
            options: [
              optionViewOf(node.choice.options[0], audioOf(node.pageNo, 'option-a')),
              optionViewOf(node.choice.options[1], audioOf(node.pageNo, 'option-b')),
            ],
          }
        : null,
    })
  }
  return views
}

/**
 * 一个选项 → 能直接渲染的那一份。
 *
 * 图标那一步是这里做的、在服务端：`iconUrlOf` 要查 `CHOICE_ICONS` 那张词表，
 *   而客户端组件收到的是已经算好的地址（与页图同一条口径——见文件头
 *   "客户端拿到的是已经算好的 URL 列表"）。
 */
function optionViewOf(option: ChoiceOption, audioUrl: string | null): StoryOptionView {
  return {
    label: option.label,
    spoken: option.spoken,
    emoji: option.emoji,
    iconUrl: iconUrlOf(option.iconKey),
    audioUrl,
  }
}
