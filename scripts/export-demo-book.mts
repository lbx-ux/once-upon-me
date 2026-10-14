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
 *
 * 只想补缩略图、不重拷整本书（比如图已经在了、只是第一次没有 webp）：
 *
 * ```bash
 * node scripts/export-demo-book.mts --book=xiaoyu-r1-4fe055c5723b --thumbs-only
 * ```
 */

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import sharp from 'sharp'

import { assetPathInDemo, DEMO_DIR } from '../src/lib/book-source.ts'
import { READER_PAGE_WIDTH, THUMB_QUALITY } from '../src/lib/thumbs.ts'
import { arg, readEnv } from './env.mts'

type BookJson = {
  bookId: string
  illustrations: { asset: { path: string } }[]
  errors: { pageNo: number }[]
}

/**
 * 给目录里每张 `.png` 生成一个 1024 档的 `.webp` 兄弟文件。
 * 返回省下的字节数——打印出来是为了"这一屏快了多少"有个数，不是一句"优化过了"。
 */
async function writeWebpSiblings(
  dir: string,
): Promise<{ made: number; pngBytes: number; webpBytes: number }> {
  let made = 0
  let pngBytes = 0
  let webpBytes = 0
  for (const name of await readdir(dir)) {
    if (!/\.png$/i.test(name)) continue
    const source = join(dir, name)
    pngBytes += (await stat(source)).size
    const out = await sharp(source)
      .resize({ width: READER_PAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer()
    webpBytes += out.length
    await writeFile(join(dir, name.replace(/\.png$/i, '.webp')), out)
    made += 1
  }
  return { made, pngBytes, webpBytes }
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`

async function main(): Promise<void> {
  const env = await readEnv()
  const root = resolve(env['ASSET_ROOT']?.trim() || '.out/web')
  const bookId = arg('book', '')
  const to = resolve('public', DEMO_DIR, bookId || 'x')
  const thumbsOnly = process.argv.includes('--thumbs-only') || arg('thumbs-only', '') !== ''

  if (!bookId)
    throw new Error('要 --book=<bookId>。可用：' + (await readdir(join(root, 'books'))).join(' '))

  if (!thumbsOnly) {
    const from = join(root, 'books', bookId)
    const book = JSON.parse(await readFile(join(from, 'book.json'), 'utf8')) as BookJson

    // 覆盖式导出：先清掉旧的那一份，免得留下上一版的孤儿图
    await rm(to, { recursive: true, force: true })
    await mkdir(to, { recursive: true })

    const files = await readdir(from)
    let copied = 0
    for (const name of files) {
      if (name === 'book.json') continue
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
        `  资产自洽：${missing.length === 0 ? '清单里每一张图都在盘上 ✓' : `★ 缺 ${missing.length} 张：${missing.join(' ')}`}\n`,
    )
    process.exitCode = missing.length === 0 ? 0 : 1
  }

  const thumbs = await writeWebpSiblings(to)
  process.stdout.write(
    (thumbsOnly ? `补缩略图 ${bookId}\n` : '') +
      `  缩略图 ${thumbs.made} 张（${READER_PAGE_WIDTH}px webp q${THUMB_QUALITY}）：` +
      `原图合计 ${kb(thumbs.pngBytes)} → 小的合计 ${kb(thumbs.webpBytes)}\n` +
      `  阅读器：/reader/${bookId}\n`,
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
