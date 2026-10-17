/**
 * verify-mirror.mts —— 本机那份镜像**自足吗**（工单 12）
 *
 * ```bash
 * node scripts/verify-mirror.mts --dir=D:/xiaozhujue-data/assets
 * node scripts/verify-mirror.mts --dir=.out/web        # 拿本机资产根当镜像也测同一件事
 * ```
 *
 * ★★ 判据是「**每本书清单引用的每个资产都在本机**」，不是"目录非空"、也不是
 *    "文件数对得上"。一份镜像最容易骗过人的样子是：目录看着挺满，
 *    而某一页的插画当初就没拉下来——恢复那天才发现，而那天没有服务器可问了。
 *    所以这里逐个读 `book.json`，把封面、每一页的插画、每一段朗读**一条条比**。
 *
 * ★ **在谁那一片里找，就是这一条的要害**：清单里记的是**逻辑路径**
 *    （`books/<书号>/page-1-a1.png`），而工单 16 之后它在磁盘上的真身是
 *    `u/<userId>/books/<书号>/page-1-a1.png`。所以判据是
 *    "**这本书自己那一片**里有这个文件"，不是"全树里找得到一个同名文件"——
 *    后者会把别人那张同名图当成自己的，而那种错在恢复之后**看不出来**。
 *
 * ★★ 这个文件的第一版**查错了字段**：它读 `book.pages`，而 `book.json` 里
 *    根本没有 `pages`（真身是 `tree.nodes` / `illustrations` / `narrations`）。
 *    于是它把封面之外的所有引用当成"不存在"跳过，报了一句
 *    "每一本清单引用的资产都在本机 ✓"——而它实际只查了 3 条封面。
 *    是"比过 3 条资产引用"那个数太小露的馅。
 *    ⇒ 所以现在多了一条**空手而归的闸**（见下面 `checked === 0` 那段），
 *    以及**逐本报数**：3 本书该有几十条引用，报出来 3 条就该有人问一句。
 *
 * ★ 拿不到清单的书（只有 `story.json` 的草稿）**不算失败**：草稿就是还没有图。
 *    它会被单独数出来念一句——"3 本有清单、1 本还是草稿"是一句实话，
 *    而把它们混成一个"4"就没人知道那 4 本里有 1 本其实什么都没有。
 */

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { Book } from '../src/lib/engine/domain.ts'

const dirArg = process.argv.find((item) => item.startsWith('--dir='))
const DIR = resolve(dirArg ? dirArg.slice('--dir='.length) : '.out/web')

type Missing = { book: string; slice: string; what: string; path: string }
type Suspect = { book: string; slice: string; note: string }

const missing: Missing[] = []
const suspects: Suspect[] = []
let books = 0
let drafts = 0
let checked = 0

/** 一个人那一片。★ 镜像里保住 `u/<id>/` 那一层是这套东西能不能用的前提（见 pull 脚本第 2 条） */
async function slices(): Promise<string[]> {
  const u = join(DIR, 'u')
  if (!existsSync(u)) return []
  const entries = await readdir(u, { withFileTypes: true })
  return entries.filter((one) => one.isDirectory()).map((one) => one.name)
}

async function checkBook(slice: string, bookId: string): Promise<void> {
  const rel = (path: string): string => join(DIR, 'u', slice, path)
  const manifest = rel(`books/${bookId}/book.json`)
  const raw = await readFile(manifest, 'utf8')

  let book: Book
  try {
    book = JSON.parse(raw) as Book
  } catch {
    // 半截 JSON（镜像时正在写）也算"这份不能用"——它是六年后要读的东西
    missing.push({ book: bookId, slice, what: '清单本身读不出来', path: manifest })
    return
  }
  books += 1

  const want = (path: string | undefined, what: string): void => {
    if (!path) return
    checked += 1
    if (!existsSync(rel(path))) missing.push({ book: bookId, slice, what, path: rel(path) })
  }

  want(book.cover?.asset?.path, '封面')
  for (const page of book.illustrations ?? []) {
    want(page.asset?.path, `第 ${page.pageNo} 页的插画`)
  }
  for (const clip of book.narrations ?? []) {
    want(clip.asset?.path, `第 ${clip.pageNo} 页的朗读`)
  }

  // ★ 逐本报数 + 一条"自相矛盾"的判据：计划了 N 页、出图只有 M < N、而 errors 是空的
  //   —— 那本书在自己说自己完整，而它缺页。镜像要照实把它标出来，
  //   因为它正是"目录看着挺满"的那一种
  const planned = book.tree?.nodes?.length ?? 0
  const drawn = book.illustrations?.length ?? 0
  const failed = book.errors?.length ?? 0
  const narrated = book.narrations?.length ?? 0
  console.log(
    `  u/${slice}/${bookId}\n` +
      `    计划 ${planned} 页 · 出图 ${drawn} · 朗读 ${narrated} · 失败 ${failed} 页` +
      ` · 封面 ${book.cover ? '有' : '没有'}`,
  )
  if (planned > 0 && drawn < planned && failed === 0) {
    suspects.push({
      book: bookId,
      slice,
      note: `计划 ${planned} 页、只有 ${drawn} 页有图，而 errors 是空的——它在自己说自己完整`,
    })
  }
}

async function main(): Promise<void> {
  if (!existsSync(DIR)) {
    console.log(`✗ 这个目录不存在：${DIR}`)
    process.exitCode = 1
    return
  }

  const sliceNames = await slices()
  if (sliceNames.length === 0) {
    console.log(`${DIR} 底下没有 u/ —— 要么镜像还没拉过，要么它是一个平铺的老目录。`)
    console.log('★ 平铺的那种现在**用不了**：代码只认 u/<userId>/ 底下那一片（见工单 12 与 16）。')
    process.exitCode = 1
    return
  }

  console.log(`镜像      ${DIR}`)
  console.log(
    `分片      ${sliceNames.length} 个人（${sliceNames.map((s) => `u/${s}`).join(' · ')}）`,
  )

  for (const slice of sliceNames) {
    const booksDir = join(DIR, 'u', slice, 'books')
    if (!existsSync(booksDir)) continue
    for (const entry of await readdir(booksDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (existsSync(join(booksDir, entry.name, 'book.json'))) await checkBook(slice, entry.name)
      else if (existsSync(join(booksDir, entry.name, 'story.json'))) drafts += 1
    }
  }

  console.log(
    `\n合计      ${books} 本有清单、${drafts} 本还只是故事草稿（草稿没有图，不算缺）` +
      `；比过 ${checked} 条资产引用`,
  )

  if (suspects.length > 0) {
    console.log(`\n⚠ ${suspects.length} 本自己说自己完整、实际缺页（镜像照实报，不算失败）：`)
    for (const one of suspects) console.log(`  u/${one.slice}/${one.book}：${one.note}`)
  }

  if (missing.length === 0) {
    // ★ 空手而归的闸：一本都没查到、或者一条引用都没比过，**不是通过**——
    //   这个脚本的第一版正是这么绿的（见文件头那段）
    if (books === 0 || checked === 0) {
      console.log('\n✗ 一条资产引用都没比过：这不是通过，是没查（镜像里没有可查的清单？）')
      process.exitCode = 1
      return
    }
    console.log('\n每一本清单引用的资产都在本机 ✓')
    return
  }

  console.log(`\n✗ 有 ${missing.length} 条对不上——这份镜像**现在恢复不了**：`)
  for (const one of missing.slice(0, 40)) {
    console.log(`  u/${one.slice}/${one.book} 的${one.what}：${one.path}`)
  }
  if (missing.length > 40) console.log(`  …还有 ${missing.length - 40} 条`)
  process.exitCode = 1
}

await main()
