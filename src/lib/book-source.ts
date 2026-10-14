/**
 * book-source.ts —— 一本书**从哪读**：运行期产物，或随仓库提交的预生成演示书
 *
 * ADR-0003 的演示路径靠它成立："一本已经生成好的书是资产，不是一次调用"。
 * 所以查找顺序是**两个来源、一个函数**：
 *
 * ```
 *   1. 运行期：ASSET_ROOT/books/<id>/book.json        （家长刚做出来的那本）
 *   2. 预生成：public/demo/books/<id>/book.json        （随仓库提交，断网也在）
 * ```
 *
 * ★ 为什么必须是一个函数：两个来源、两种 URL 前缀。页面里各写一遍查找顺序，
 *   就是两份迟早会漂的真相——漂了以后的症状是"本地能翻，演示那台说图不存在"。
 *
 * ★ 服务端专用。客户端拿到的是**已经算好的 URL 列表**（见 `readerPages`），
 *   它不需要知道这本书来自哪儿，也不该知道。
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assetUrlOf } from './asset-url.ts'
import { assetRoot } from './books-runtime.ts'
import { isResizableImage, READER_PAGE_WIDTH } from './thumbs.ts'
import { linearOrder, manifestPathOf, type Book, type StoryNode } from './engine/index.ts'

/** 预生成演示书在 `public/` 下的位置。导出脚本与这一层**共用**这串字面量 */
export const DEMO_DIR = 'demo/books'

export type BookSource = 'runtime' | 'demo'

/** 阅读器要的一页：图 + 正文 + 朗读。`imageUrl` 为 null 表示**这一页没做出来**（书里标了） */
export type ReaderPage = {
  pageNo: number
  imageUrl: string | null
  /**
   * 这一页的朗读音频。null = 这一页没有朗读（书里没有 narrations，或这一页没配上）。
   * ★ 它与 `imageUrl` 为 null 是**两件事**，不许合并：图缺了这一页没法读，
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
  pages: ReaderPage[]
}

/**
 * 演示书里资产的相对位置：把 `books/<id>/` 前缀摘掉，剩下的挂在
 * `/demo/books/<id>/` 之下。导出脚本用同一个函数落盘，两边不会漂。
 */
export function assetPathInDemo(bookId: string, assetPath: string): string {
  const prefix = `books/${bookId}/`
  return assetPath.startsWith(prefix) ? assetPath.slice(prefix.length) : assetPath
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** 预生成书里那张图在浏览器里的地址（静态文件，由 Next 直接出，不经 API） */
export function demoAssetUrl(bookId: string, assetPath: string): string {
  return `/${DEMO_DIR}/${encodeURIComponent(bookId)}/${encodePath(assetPathInDemo(bookId, assetPath))}`
}

/**
 * 静态的演示图**不能**挂 `?w=`：Next 直接发盘上的字节，查询字符串它看不懂，
 * 挂上去会静悄悄回原图——一个骗人的优化比不优化更糟。
 * 所以演示书这一路换的是"导出时预生成的 `.webp` 兄弟文件"（见 `export-demo-book.mts`），
 * 磁盘上有就用它，没有就照旧用原图。★ 原图仍然留在目录里：它是清单指的那份记录。
 *
 * ★ 为什么单独抽成一个函数：本机常常同时存在同一本书的**运行期副本**与演示副本
 *   （书号是确定性的，同一份锚点 + 主题算出同一个号），于是 `resolveBook` 先命中运行期那条，
 *   演示这条分支在浏览器里根本走不到。没有测试的分支等于没有——而它恰好只在
 *   "评委那台只有 `public/` 的机器"上生效，那正是最需要它对的那一台。
 *
 * `webpSiblings` 是那一本目录里 `.webp` 的**文件名**集合（不是整条路径）。
 */
export function demoAssetPathFor(assetPath: string, webpSiblings: ReadonlySet<string>): string {
  if (!/\.png$/i.test(assetPath)) return assetPath
  const swapped = assetPath.replace(/\.png$/i, '.webp')
  return webpSiblings.has(swapped.split('/').pop() ?? '') ? swapped : assetPath
}

async function readBook(path: string): Promise<Book | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Book
  } catch {
    // 不存在、或半截 JSON（进程被杀时最后写的那一件）——都当作"这里没有这本书"
    return null
  }
}

export async function resolveBook(bookId: string): Promise<ResolvedBook | null> {
  const runtimePath = join(assetRoot(), manifestPathOf(bookId))
  const runtime = await readBook(runtimePath)
  if (runtime) {
    return {
      book: runtime,
      source: 'runtime',
      // ★ 图走 1024 档（`/api/assets` 现缩并落盘缓存），音频原样——
      //   判据是扩展名，所以"这一页有没有朗读"这件事不受缩放影响
      pages: readerPages(runtime, (path) =>
        assetUrlOf(path, isResizableImage(path) ? READER_PAGE_WIDTH : undefined),
      ),
    }
  }

  const demoDir = join(process.cwd(), 'public', DEMO_DIR, bookId)
  const demo = await readBook(join(demoDir, 'book.json'))
  if (demo) {
    // 目录里有哪些 `.webp` 兄弟文件。读不到目录就当都没有（回原图，不是回一张碎图）
    const siblings = new Set(
      (await readdir(demoDir).catch(() => [] as string[])).filter((name) => /\.webp$/i.test(name)),
    )
    return {
      book: demo,
      source: 'demo',
      pages: readerPages(demo, (path) => demoAssetUrl(bookId, demoAssetPathFor(path, siblings))),
    }
  }
  return null
}

/**
 * 书 → 阅读器的页表。
 *
 * ★ 这里要处理三种"这一页没有图"，而且它们**不是同一件事**（domain.ts 里写过一次，
 *   这里再落一次地）：① 有图且核对过；② 有图但没核对（`verdict: 'unavailable'`）；
 *   ③ **根本没有图**（在这本书的 `errors` 里）。阅读器只关心第三种——
 *   前两种的图都是好的，照样给孩子看。
 */
export function readerPages(book: Book, urlOf: (assetPath: string) => string): ReaderPage[] {
  const byPage = new Map(book.illustrations.map((item) => [item.pageNo, item]))
  const failed = new Map(book.errors.map((item) => [item.pageNo, item.message]))
  // ★ 按 pageNo 取，不按 asset.path 去重：同一段正文被共读版的主干页共用时，
  //   几个 pageNo 指向**同一份录音**，但每一页都要能拿到它（narrate.ts 就是这么写的）
  const narrationByPage = new Map(book.narrations.map((item) => [item.pageNo, item]))
  return linearOrder(book.tree).map((node: StoryNode) => {
    const illustration = byPage.get(node.pageNo)
    // 缺图判定要**同时**看两处：没有 illustration 条目，或者条目指向的那个占位资产
    const missing = !illustration || failed.has(node.pageNo)
    const narration = narrationByPage.get(node.pageNo)
    return {
      pageNo: node.pageNo,
      imageUrl: illustration && !missing ? urlOf(illustration.asset.path) : null,
      audioUrl: narration ? urlOf(narration.asset.path) : null,
      body: node.body,
      missing,
    }
  })
}
