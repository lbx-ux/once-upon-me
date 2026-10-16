/**
 * make-probe-library.mts —— 造一个**隔离的资产根**，给会写盘的探针用
 *
 * 为什么需要它：`scripts/probe-shelf.mts` 从 2026-10-16 起会**拖动换位**（写
 * `shelf/order.json`）并**真删一本书**（删 `books/<id>/` 与它的缩略图）。
 * 直接对着 `.out/web`（缺省资产根）跑，删掉的就是用户自己做的那本书——
 * 一次"验收"把作品删了。所以：探针跑在这个夹子上，夹子随手可弃。
 *
 * ```bash
 * node scripts/make-probe-library.mts --out=.out/shelf-probe
 * ASSET_ROOT=.out/shelf-probe node scripts/dev-preview.mjs --dist=.next-shelfprobe --port=3333
 * node scripts/probe-shelf.mts
 * ```
 *
 * ★ **它会先把关掉的目录删掉**（`rm -rf` 那个 `<out>`），所以有两道闸门：
 *   1. 指到缺省资产根（`.out/web`）直接拒绝——那是用户的书架；
 *   2. 指到 `public/` 里面也拒绝——那是随仓库提交的内容。
 *   这两条不是"防御性编程"：这个脚本的用法就是"传一个目录给我删干净"，
 *   而一个人手滑把 `.out/web` 敲进去的代价是他自己做的书没了。
 *
 * ## 夹子里有什么
 *
 * 九本 `probe-01 … probe-09`（`--count` 可改），从 `public/demo/books/` 那本演示书
 * 抄来 `book.json` 的故事树，逐个改：书号、书名、`createdAt`（**递减**，
 * 于是默认序就是 01…09，一眼看得出拖动有没有生效）。
 *
 * | 文件 | 01（封面那本） | 02…09 |
 * | --- | --- | --- |
 * | `book.json` | ✅ | ✅ |
 * | `events.jsonl` | ✅ 一行合成的（这份夹子不跑生成，日志只是"这里有一个文件"） | ✅ |
 * | `cover.webp` | ✅ 抄演示书那一页（162 KB，**真的图**，缩一下就有真缩略图） | ❌ |
 * | `page-1-a1.mp3` | ✅ 抄演示书那一段（101 KB） | ❌ |
 *
 * ★ 02…09 **故意没有封面**：书架那一屏这时露出的是那张 `--card-paper` 的相纸 + 📖，
 *   那正是"图没到位就留一个诚实的兜底"那条规矩的现场，探针顺路把它也看一遍。
 * ★ 01 的封面走 `.webp`（不是 `.png`）：`isResizableImage` 认它，
 *   而它比那张 3.4 MB 的 PNG 小二十倍——这个夹子的存在意义之一是"随手可弃"。
 * ★ 页图与朗读**只给 01 抄一份真的**，其余几页不落盘：书架那一屏不读它们
 *   （它只读 `book.json` 与封面），而探针要验的是次序与删除。
 *   代价说清楚：**别拿这个夹子开阅读器**，那几页本来就该报"缺页"。
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { arg } from './env.mts'

const OUT = resolve(arg('out', '.out/shelf-probe'))
const COUNT = Number(arg('count', '9'))
const DEMO = resolve('public/demo/books/xiaoyu-r1-4fe055c5723b')

/** 缺省资产根（`lib/books-runtime.ts` 的 `DEFAULT_ASSET_ROOT`）——这里写死一份是有意的 */
const REAL_ROOT = resolve('.out/web')

function refuse(reason: string): never {
  console.error(`✗ ${reason}`)
  console.error('  这个脚本会先删掉 --out 指的那个目录，所以它只肯往一个专门造出来的夹子里写。')
  process.exit(1)
}

async function main(): Promise<void> {
  // ① 不许指着用户真正的书架
  if (OUT === REAL_ROOT)
    refuse(`--out 指的是缺省资产根（${REAL_ROOT}）——那里面是用户自己做过的书。`)
  // ② 不许指着仓库内容
  const publicDir = resolve('public') + sep
  if (OUT.startsWith(publicDir) || OUT === resolve('public')) {
    refuse(`--out 落在 public/ 里面（${OUT}）——那是随仓库提交的内容。`)
  }
  if (!Number.isInteger(COUNT) || COUNT < 2 || COUNT > 40)
    refuse(`--count 要是 2–40 的整数：${COUNT}`)
  if (!existsSync(DEMO)) refuse(`找不到演示书 ${DEMO}（这个脚本从它抄故事树）。`)

  const demo = JSON.parse(await readFile(join(DEMO, 'book.json'), 'utf8')) as Record<
    string,
    unknown
  > & { tree?: { title?: unknown }; bookId?: unknown }

  // ★ 先删干净：上一轮留下的 shelf/order.json 会让这一次的默认序不是"01…09"
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  /** 时间戳递减，默认序（新的在前）就正好是 01…09 */
  const base = 1_700_000_000_000
  for (let i = 1; i <= COUNT; i += 1) {
    const bookId = `probe-${String(i).padStart(2, '0')}`
    const dir = join(OUT, 'books', bookId)
    await mkdir(dir, { recursive: true })

    const withCover = i === 1
    const book = {
      ...demo,
      bookId,
      createdAt: base - i * 1000,
      tree: { ...(demo.tree as object), title: `探针样书 ${String(i).padStart(2, '0')}` },
      // ★ 只留**真的落了盘**的那几项（见文件头那张表）：指着不存在的文件比空数组更糟
      cover: withCover
        ? {
            asset: {
              path: `books/${bookId}/cover.webp`,
              digest: 'probe',
              bytes: 162564,
              mime: 'image/webp',
            },
          }
        : undefined,
      illustrations: withCover
        ? [
            {
              pageNo: 1,
              attempt: 1,
              asset: {
                path: `books/${bookId}/cover.webp`,
                digest: 'probe',
                bytes: 162564,
                mime: 'image/webp',
              },
              provenance: {
                modelId: 'probe',
                promptVersion: 'probe',
                cardRevision: 1,
                generatedAt: base,
              },
              needsHumanReview: false,
            },
          ]
        : [],
      narrations: withCover
        ? [
            {
              pageNo: 1,
              voiceId: 'probe',
              textHash: 'probe',
              asset: {
                path: `books/${bookId}/page-1-a1.mp3`,
                digest: 'probe',
                bytes: 101851,
                mime: 'audio/mpeg',
              },
            },
          ]
        : [],
    }
    await writeFile(join(dir, 'book.json'), `${JSON.stringify(book, null, 2)}\n`, 'utf8')
    // 日志是**合成的**一行，不是从演示书抄的：这份夹子没有跑过生成，
    // 抄一份别人的过程日志进来，等于给这个文件里塞一段没发生过的历史
    await writeFile(
      join(dir, 'events.jsonl'),
      `${JSON.stringify({ kind: 'probe', at: base - i * 1000, note: '探针夹子：这里有一个日志文件' })}\n`,
      'utf8',
    )

    if (withCover) {
      await cp(join(DEMO, 'page-1-a1.webp'), join(dir, 'cover.webp'))
      await cp(join(DEMO, 'page-1-a1.mp3'), join(dir, 'page-1-a1.mp3'))
    }
  }

  console.log(`✓ ${OUT}`)
  console.log(`  ${COUNT} 本：probe-01（有封面、有朗读）… probe-${String(COUNT).padStart(2, '0')}`)
  console.log(`  默认序就是 01…${String(COUNT).padStart(2, '0')}（createdAt 递减）`)
  console.log(
    `\n下一步：\n  ASSET_ROOT=${OUT} node scripts/dev-preview.mjs --dist=.next-shelfprobe --port=3333`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
