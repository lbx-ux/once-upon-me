/**
 * export-demo-book.mts —— 把一本书导出成**随仓库提交的预生成演示书**（工单 06）
 *
 * ```bash
 * node scripts/export-demo-book.mts --book=xiaoyu-r1-4fe055c5723b
 * ```
 *
 * ADR-0003 的原话是"一本已经生成好的书是资产，不是一次调用"，而它的**验收**是：
 * 断网也能从封面翻到封底。那句话在 W1 只写在文档里——
 * 因为录制器把资产写进了内存 store，manifest 说图在、字节从没落盘，
 * "演示路径"其实一次都没通过（README §五 第四类）。所以这一条要能被跑出来给人看。
 *
 * 做的事：把 `ASSET_ROOT/books/<id>/` 里的 `book.json` + 全部图 + `events.jsonl`
 * 拷进 `public/demo/books/<id>/`。路径拼法**不在这里重写**，
 * 从 `src/lib/book-source.ts` 拿（`assetPathInDemo`）——两边各拼一遍就是"演示那天图裂了"。
 *
 * ★ 导出的东西**不含任何密钥**（工单 03 §二 的那条自查要连着 `public/demo` 一起跑）。
 * ★ 书号是"卡 + 主题指纹"、不含时间戳，所以同一本书重复导出会覆盖同一个目录，
 *   不会长出第二份。
 *
 * ## 每张 `.png` 会多一个 `.webp` 兄弟文件（1024 档）
 *
 * 演示书那三页图实测 **3.4 + 3.8 + 4.2 = 11.5 MB**，而"看一本成品"是评委点开的第一屏。
 * 静态文件走不到 `/api/assets?w=`（Next 直接发盘上的字节，查询字符串它看不懂——
 * 挂个 `?w=` 上去会静悄悄回原图，那是个骗人的优化），所以这里**导出时就预生成**一份小的，
 * 由 `book-source.ts` 在磁盘上有 `.webp` 时优先用它。★ 原图仍然留在目录里：
 * 它是清单指的那份记录，缩略图只是给人看的那一层。
 * ★ 2026-10-18：这一段的实现搬进了 `webp-siblings.mts`，与示例卡
 *   （`export-demo-cards.mts`，768 档、`.jpg`）共用同一份——两边只差扩展名与档位两个参数。
 *
 * 只想补缩略图、不重拷整本书（比如图已经在了、只是第一次没有 webp）：
 *
 * ```bash
 * node scripts/export-demo-book.mts --book=xiaoyu-r1-4fe055c5723b --thumbs-only
 * ```
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { assetPathInDemo, DEMO_DIR } from '../src/lib/book-source.ts'
import { READER_PAGE_WIDTH, THUMB_QUALITY } from '../src/lib/thumbs.ts'
import { arg, readEnv } from './env.mts'
import { writeWebpSiblings } from './webp-siblings.mts'

type BookJson = {
  bookId: string
  cover?: { asset: { path: string } }
  illustrations: { asset: { path: string } }[]
  narrations?: { asset: { path: string } }[]
  errors: { pageNo: number }[]
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`

/** 逻辑路径（`books/<书号>/page-1-a1.png`）→ 目录里那个文件名 */
const fileNameOf = (path: string): string => path.split('/').pop() ?? ''

/**
 * 清单**引用到**的那些文件名。
 *
 * ★ 2026-10-18 加的，起因是一次真导出：8 个节点的书导出成 **34 MB**，其中
 *   5 张是**重画时的中间产物**（`page-3-a2`、`page-3-a3` 这些）——一致性核对
 *   打回重画过的页会在目录里留下每一次尝试，而清单只认最后留下的那一版。
 *   那些字节**没有任何东西会去读**（阅读器读的是清单里那几个名字），
 *   跟着进仓库就是把"这一轮的草稿"当资产提交上去。
 * ★ 这不是"替资产做决定"：`book.json` 仍然是**逐字节原样拷过去**的（ADR-0003 那条
 *   "资产要能被比对"管的是它），而 `.webp` 兄弟文件本来就是这个脚本生成的派生物
 *   ——导出从来不是"目录原样搬一份"，是"导出**这本书**"。
 */
function referencedFiles(book: BookJson): Set<string> {
  const wanted = new Set<string>(['book.json', 'events.jsonl'])
  if (book.cover) wanted.add(fileNameOf(book.cover.asset.path))
  for (const item of book.illustrations) wanted.add(fileNameOf(item.asset.path))
  for (const item of book.narrations ?? []) wanted.add(fileNameOf(item.asset.path))
  return wanted
}

/**
 * 一本书在盘上的目录。
 *
 * ★ 2026-10-18 修的：这个脚本原来只看 `<root>/books/<id>`，而工单 16（2026-10-17）
 *   之后书住在**每个人自己那一片**里（`<root>/u/<userId>/books/<id>`，中间那层
 *   是**数字 userId**）——于是它对**任何一本真书**都找不到源目录，
 *   报出来的是一句"要 --book=<bookId>"（看着像参数没给，其实是路径规则变了）。
 *   导出演示书这条路必须能走通（ADR-0003 的断网演示全靠它），所以两种布局都认。
 * ★ 同名书号落在好几片里只可能发生在"两个人做了同一个主题"（书号是指纹、不含人），
 *   那时候取 **mtime 最新**的那一份：那是最新的一次生成。
 */
async function bookDirsUnder(root: string): Promise<string[]> {
  const dirs: string[] = []
  const flat = join(root, 'books')
  if (existsSync(flat)) dirs.push(flat)
  const sliceRoot = join(root, 'u')
  for (const userId of await readdir(sliceRoot).catch(() => [] as string[])) {
    const dir = join(sliceRoot, userId, 'books')
    if (existsSync(dir)) dirs.push(dir)
  }
  return dirs
}

async function findBookDir(root: string, bookId: string): Promise<string | null> {
  const direct = join(root, 'books', bookId)
  if (existsSync(join(direct, 'book.json'))) return direct

  let best: string | null = null
  let newest = 0
  for (const dir of await bookDirsUnder(root)) {
    const candidate = join(dir, bookId)
    const info = await stat(join(candidate, 'book.json')).catch(() => null)
    if (info && info.mtimeMs > newest) {
      best = candidate
      newest = info.mtimeMs
    }
  }
  return best
}

/** 盘上都有哪些书（两种布局都算）。只用来把错话说全 */
async function listBookIds(root: string): Promise<string[]> {
  const found: string[] = []
  for (const dir of await bookDirsUnder(root)) {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!found.includes(name)) found.push(name)
    }
  }
  return found.sort()
}

async function main(): Promise<void> {
  const env = await readEnv()
  const root = resolve(env['ASSET_ROOT']?.trim() || '.out/web')
  const bookId = arg('book', '')
  const to = resolve('public', DEMO_DIR, bookId || 'x')
  const thumbsOnly = process.argv.includes('--thumbs-only') || arg('thumbs-only', '') !== ''

  if (!bookId) throw new Error('要 --book=<bookId>。可用：' + (await listBookIds(root)).join(' '))

  const from = await findBookDir(root, bookId)
  if (!from)
    throw new Error(`盘上找不到这本书：${bookId}。可用：${(await listBookIds(root)).join(' ')}`)

  if (!thumbsOnly) {
    const book = JSON.parse(await readFile(join(from, 'book.json'), 'utf8')) as BookJson

    // 覆盖式导出：先清掉旧的那一份，免得留下上一版的孤儿图
    await rm(to, { recursive: true, force: true })
    await mkdir(to, { recursive: true })

    const files = await readdir(from)
    const wanted = referencedFiles(book)
    let copied = 0
    let skipped = 0
    let skippedBytes = 0
    for (const name of files) {
      if (name === 'book.json') continue
      if (!wanted.has(name)) {
        // 重画时的中间产物、以及那份已经过时的草稿：清单里没有它们
        const info = await stat(join(from, name)).catch(() => null)
        skipped += 1
        skippedBytes += info?.size ?? 0
        continue
      }
      await copyFile(join(from, name), join(to, assetPathInDemo(bookId, `books/${bookId}/${name}`)))
      copied += 1
    }
    await writeFile(join(to, 'book.json'), JSON.stringify(book, null, 2), 'utf8')

    // 清单里指的每一张图**必须在磁盘上**——这一条就是 W1 那次没做到的事
    const missing: string[] = []
    for (const item of book.illustrations) {
      try {
        await readFile(join(to, assetPathInDemo(bookId, item.asset.path)))
      } catch {
        missing.push(item.asset.path)
      }
    }
    process.stdout.write(
      `导出 ${bookId}\n  源 ${from}\n  目标 ${to}\n` +
        `  文件 ${copied} 个（清单 ${book.illustrations.length} 页 · 页级失败 ${book.errors.length} 页）\n` +
        (skipped > 0
          ? `  跳过 ${skipped} 个清单里没有的文件（重画的中间产物 / 过时的草稿，共 ${kb(skippedBytes)}）\n`
          : '') +
        `  资产自洽：${missing.length === 0 ? '清单里每一张图都在盘上 ✓' : `★ 缺 ${missing.length} 张：${missing.join(' ')}`}\n`,
    )
    process.exitCode = missing.length === 0 ? 0 : 1
  }

  const thumbs = await writeWebpSiblings(to, { width: READER_PAGE_WIDTH })
  process.stdout.write(
    (thumbsOnly ? `补缩略图 ${bookId}\n` : '') +
      `  缩略图 ${thumbs.made} 张（${READER_PAGE_WIDTH}px webp q${THUMB_QUALITY}）：` +
      `原图合计 ${kb(thumbs.sourceBytes)} → 小的合计 ${kb(thumbs.webpBytes)}\n` +
      `  阅读器：/reader/${bookId}\n`,
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
