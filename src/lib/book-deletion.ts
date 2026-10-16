/**
 * book-deletion.ts —— 从书架上删掉**一本书**，并给出一张凭据
 *
 * 与 `child-deletion.ts` 是同一条纪律的第二个实例（那一层的文件头写了为什么
 * "删掉了"这三个字必须能对着清单被检查）。两处不合并，因为清单不一样：
 * 删一个孩子要动档案、卡、书、缩略图四类；删一本书只动**这本书自己的东西**。
 *
 * ## 三个存储位置
 *
 * | 位置 | 里面是什么 | 为什么必须在清单里 |
 * | --- | --- | --- |
 * | `books/<bookId>/` | 页图、封面、朗读 mp3、过程日志 `events.jsonl`、`book.json` | 册子本体 |
 * | `thumbs/<档>/books/<bookId>/` | 上面那些图的缩略缓存（5 档各一个目录） | **派生内容也是这本书**；`child-deletion.ts` 记的那个真实的漏（"删了卡没删图"）在这里是同一件事 |
 * | `shelf/order.json` | 书架上那一排的次序（`shelf-order.ts`） | 不划掉的话，这个文件会一直记着几个已经不存在的书号 |
 *
 * ## 四条与那一层逐字相同的约定
 *
 * 1. **前缀一律以 `/` 结尾**：`deletePrefix` 在内存 store 上是键前缀匹配、在 fs store 上是
 *    目录遍历 + rm。传一个文件路径进去，两边报数不一样（内存回 1、fs 回 0），
 *    而文件照样被删掉——凭据会说"删了 0 条"而东西已经没了。
 * 2. **预演与真删报两个不同的数**（数出来的 vs `deletePrefix` 真删的），不共用。
 * 3. **每个位置各自 try/catch**：一个位置失败不阻止其它位置被删（删到一半停下，
 *    剩下的东西比删完更糟），但失败记进 `failed` → `complete: false`，
 *    界面**不许**说"删掉了"。
 * 4. **不报字节**：`AssetStore` 没有 `stat`，要算字节得把几十张页图读一遍，
 *    而用户要问的是"删干净了吗"，不是"删了多少 MB"（`child-deletion.ts` 对书那一行的原话）。
 *
 * ## ★ 盘上一条文件都没有时不抛
 *
 * 这一层**不判断 HTTP 状态**（那是路由的事）。书不在盘上时它给一张数字全是 0 的凭据，
 * 每一行都带一句"为什么是 0"；路由用 `bookOnDisk` 看见没东西就回 404。
 * 这样"回什么码"只有一个地方决定，"盘上到底有什么"也只有一个地方数。
 *
 * ## ★ 这一层不抛"删到一半"的异常
 *
 * `complete: false` 与每个位置的 `failed` 原话就写在凭据里，路由照着它回码。
 * （`child-deletion.ts` 那边导出了一个 `DeletionPartialError`，但它的
 * `deleteChildEverywhere` 从头到尾不抛它——那个 `instanceof` 分支是够不着的。
 * 这里不复制一个没人抛的类：多一个永远走不到的分支，就多一处会骗人的代码。）
 */

import { bookDirOf, manifestPathOf } from './engine/index.ts'
import type { AssetStore } from './engine/providers/types.ts'
import { loadOrder, saveOrder } from './shelf-order.ts'
import { THUMB_PREFIX, THUMB_WIDTHS } from './thumbs.ts'

/**
 * 凭据里的一行。**复用 `child-deletion.ts` 的类型**：删一个孩子与删一本书的"一行"
 * 是同一件事（位置 / 路径 / 删了几条 / 字节 / 一句解释 / 失败原话），
 * 界面那边的渲染也就只有一套。这里转出去，是为了让界面只 import 一个地方。
 */
import type { DeletionPlace } from './child-deletion.ts'
export type { DeletionPlace }

export type BookDeletionReceipt = {
  bookId: string
  /** 书名。读不出来时是"（读不出来的一本）"——照实说，不编 */
  title: string
  at: number
  places: DeletionPlace[]
  totalFiles: number
  /** 这份凭据是"要删的"还是"删掉的"。界面文案要分开说，不许混 */
  stage: 'plan' | 'done'
  /** 有没有哪个位置失败。有就是这张凭据**不完整**，界面不许说"删掉了" */
  complete: boolean
}

export type BookDeletionDeps = {
  store: AssetStore
  /** 固定时间（测试要能复现；同 `child-deletion.ts` 的 `now`） */
  now?: number
}

/** 枚举出来的"该删什么"。预演与真删**共用它**，所以两边不会漏掉同一个位置 */
export type BookTargets = {
  bookFiles: number
  /** 这本书里各类文件各几个（凭据那句解释用，不参与删除） */
  images: number
  audios: number
  logs: number
  others: number
  /** 缩略图**目录**前缀（带尾斜杠）。★ 用目录不用文件，见文件头第 1 条 */
  thumbDirs: string[]
  thumbFiles: number
  /** 这本书在不在顺序清单里（删完要划掉；报 0/1 条） */
  inOrder: boolean
}

const IMAGE_EXT = /\.(?:png|jpe?g|webp)$/i
const AUDIO_EXT = /\.(?:mp3|m4a|wav)$/i

/**
 * 这本书**在不在盘上**。路由用它回 404，这一层自己不用它做判断。
 *
 * ★ 与"预演"分开、不合并成一次遍历：预演要逐类数（图几 张、朗读几段），
 *   这里只要"有没有"——把它塞进 `bookTargets` 的返回值里，就等于说
 *   "想回 404 的人必须先把整本书数一遍"。
 */
export async function bookOnDisk(bookId: string, deps: BookDeletionDeps): Promise<boolean> {
  return (await deps.store.list(`${bookDirOf(bookId)}/`)).length > 0
}

/**
 * 这本书的路径 → 后几段。`books/<bookId>/page-1-a1.png` → `page-1-a1.png`
 * （数扩展名用，别把目录名里的点算进去）
 */
const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

export async function bookTargets(bookId: string, deps: BookDeletionDeps): Promise<BookTargets> {
  const files = await deps.store.list(`${bookDirOf(bookId)}/`)
  const names = files.map(fileNameOf)
  const thumbDirs = THUMB_WIDTHS.map((width) => `${THUMB_PREFIX}${width}/${bookDirOf(bookId)}/`)
  let thumbFiles = 0
  for (const dir of thumbDirs) thumbFiles += (await deps.store.list(dir)).length

  return {
    bookFiles: files.length,
    images: names.filter((name) => IMAGE_EXT.test(name)).length,
    audios: names.filter((name) => AUDIO_EXT.test(name)).length,
    logs: names.filter((name) => name === 'events.jsonl').length,
    others: names.filter(
      (name) => !IMAGE_EXT.test(name) && !AUDIO_EXT.test(name) && name !== 'events.jsonl',
    ).length,
    thumbDirs,
    thumbFiles,
    inOrder: (await loadOrder(deps.store)).includes(bookId),
  }
}

/** 书名。读不出来就照实说读不出来（同 `child-deletion.ts` 的 `hisBooks`） */
async function titleOf(bookId: string, deps: BookDeletionDeps): Promise<string> {
  try {
    const raw = await deps.store.readJson<{ tree?: { title?: unknown } }>(manifestPathOf(bookId))
    if (!raw) return '（读不出来的一本）'
    return typeof raw.tree?.title === 'string' ? raw.tree.title : '（没有名字的书）'
  } catch {
    // 半截 JSON（进程被杀时最后写的那一件）。★ 这里**不能跳过**：跳过的症状是
    // "删除漏了一本书"，而凭据上什么都看不出来
    return '（读不出来的一本）'
  }
}

/** 那一行"这本书里有什么"的解释。数字全来自上面那次枚举，不估 */
function contentsNote(targets: BookTargets): string {
  const parts: string[] = []
  if (targets.images > 0) parts.push(`${targets.images} 张图`)
  if (targets.audios > 0) parts.push(`${targets.audios} 段朗读`)
  if (targets.logs > 0) parts.push('1 份过程日志')
  if (targets.others > 0) parts.push(`${targets.others} 份清单`)
  if (parts.length === 0) return '盘上没有这一本了（也许已经删过）'
  return parts.join(' + ')
}

function receiptOf(
  bookId: string,
  title: string,
  targets: BookTargets,
  numbers: { book: number; thumbs: number; order: number },
  at: number,
  stage: 'plan' | 'done',
  failures: Record<string, string>,
): BookDeletionReceipt {
  const places: DeletionPlace[] = [
    {
      place: '这本书',
      at: `${bookDirOf(bookId)}/`,
      deleted: numbers.book,
      note: contentsNote(targets),
      ...(failures['book'] ? { failed: failures['book'] } : {}),
    },
    {
      place: '缩略图缓存',
      at: `${THUMB_PREFIX}*/${bookDirOf(bookId)}/`,
      deleted: numbers.thumbs,
      note:
        targets.thumbFiles === 0
          ? '这本书的图还没有被缩过，所以没有缓存'
          : `派生内容，删了能重算——但它也是这本书的图（${THUMB_WIDTHS.length} 个档位各一个目录）`,
      ...(failures['thumbs'] ? { failed: failures['thumbs'] } : {}),
    },
    {
      place: '书架上的顺序记录',
      at: 'shelf/order.json',
      deleted: numbers.order,
      note: targets.inOrder
        ? '把这一本从这个文件里划掉；文件本身留着'
        : '这本不在顺序清单里（从来没被拖动过），所以没有要划掉的',
      ...(failures['order'] ? { failed: failures['order'] } : {}),
    },
  ]

  return {
    bookId,
    title,
    at,
    places,
    totalFiles: places.reduce((sum, one) => sum + one.deleted, 0),
    stage,
    complete: Object.keys(failures).length === 0,
  }
}

/** 预演：要删什么、各多少条。**一个字节都不动**（确认框里的那句人话就是它） */
export async function planBookDeletion(
  bookId: string,
  deps: BookDeletionDeps,
): Promise<BookDeletionReceipt> {
  const targets = await bookTargets(bookId, deps)
  return receiptOf(
    bookId,
    await titleOf(bookId, deps),
    targets,
    {
      book: targets.bookFiles,
      thumbs: targets.thumbFiles,
      order: targets.inOrder ? 1 : 0,
    },
    deps.now ?? Date.now(),
    'plan',
    {},
  )
}

/**
 * 真删。返回的凭据里是**`deletePrefix` 真正删掉的条数**。
 *
 * 顺序清单那一行不走 `deletePrefix`：它要的是"把书名划掉、别的项留着"，`saveOrder`
 * 正好干这件事（而且剪枝是它自己的事）。
 */
export async function deleteBookEverywhere(
  bookId: string,
  deps: BookDeletionDeps,
): Promise<BookDeletionReceipt> {
  const targets = await bookTargets(bookId, deps)
  const title = await titleOf(bookId, deps)
  const failures: Record<string, string> = {}
  const numbers = { book: 0, thumbs: 0, order: 0 }

  const attempt = async (key: keyof typeof numbers, run: () => Promise<number>): Promise<void> => {
    try {
      numbers[key] += await run()
    } catch (err) {
      failures[key] = err instanceof Error ? err.message : String(err)
    }
  }

  await attempt('book', () => deps.store.deletePrefix(`${bookDirOf(bookId)}/`))
  for (const dir of targets.thumbDirs) {
    await attempt('thumbs', () => deps.store.deletePrefix(dir))
  }
  await attempt('order', async () => {
    const order = await loadOrder(deps.store)
    if (!order.includes(bookId)) return 0
    await saveOrder(
      deps.store,
      order.filter((id) => id !== bookId),
      deps.now,
    )
    return 1
  })

  return receiptOf(bookId, title, targets, numbers, deps.now ?? Date.now(), 'done', failures)
}
