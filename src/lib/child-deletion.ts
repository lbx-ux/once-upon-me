/**
 * child-deletion.ts —— 删一个孩子，**并给出一张凭据**（工单 03 第三刀）
 *
 * 这一层存在的理由只有一条：**"删掉了"这三个字必须能对着清单被检查。**
 * `store.deletePrefix` 是一句承诺，而承诺在这个仓库里的规矩是"要么有一条会红的用例撑着，
 * 要么它就是注释"。凭据就是那条用例的产物——它把"每个存储位置各删了多少条"逐条写出来，
 * 于是"删干净了没有"有一个答案，而不是只有一份信任。
 *
 * ## ★ 一个真实的漏（2026-10-15 实测，就在写这一层之前）
 *
 * 缩略图缓存在 `thumbs/<档>/<原图路径>.webp`，与 `cards/`、`books/` **平级**。
 * 于是"删掉一个孩子"如果只删 `cards/<cardId>/`，他的脸会以 WebP 的形式留在
 * `thumbs/240/cards/<cardId>/` 里——**删了卡，没删图**。
 * 这不是推理出来的：这一刀开工前，资产根里躺着 **9 个这样的残留**，
 * 全是我自己在前面几刀里删掉的探针留下的（删探针时缩略图已经生成过）。
 * 所以 `thumbs` 是这张清单里的一个**位置**，不是一个可选的清理步骤。
 *
 * ## 四个存储位置 + 一条"没落盘"的记录
 *
 * | 位置 | 里面是什么 | 为什么必须在清单里 |
 * | --- | --- | --- |
 * | `children/<id>.json` | 档案（他是谁） | 名字、读音、年龄档 |
 * | `cards/<cardId>/` | 全部版本的卡与参考图 | 旧书的那些页指着它们（ADR-0007） |
 * | `books/<bookId>/` | 他的书（含 `events.jsonl`） | 书里是他 20 页的形象 |
 * | `thumbs/<档>/…` | 上面两样的缩略缓存 | **派生内容也是他的脸**（见上） |
 * | （无） | 照片原图 | 从来没有落盘——但"处理过"这件事要报出来 |
 *
 * ## ★ 预演与真删报的是**两个不同的数**，而且这件事是刻意的
 *
 * `planDeletion` 报的是"删之前数出来的条数"，`deleteChildEverywhere` 报的是
 * **`deletePrefix` 真正删掉的条数**。两者在正常情况下相等，而"正常情况"正是
 * 不该被假定的东西：如果这两处共用一个数，凭据就变成了对枚举的信任，
 * 而凭据存在的全部意义是不需要那份信任。（`child-deletion.test.ts` 里有一条
 * 用例专门把两者拆开：删之前偷偷往里塞一个文件，看凭据报的是哪个数。）
 *
 * ## ★ 前缀一律以 `/` 结尾（这不是风格问题）
 *
 * `deletePrefix` 在内存 store 上是**键前缀**匹配，在 fs store 上是**目录**遍历 + rm。
 * 传一个文件路径进去，两边行为不一样：内存版回 1、fs 版回 **0**（它数的是 walk 到的文件），
 * 而文件照样被删掉——于是凭据会说"删了 0 条"而东西已经没了。
 * 两个实现不一致这件事 `library.ts` 已经踩过一次（`readJson` 对半截 JSON 的行为），
 * 所以这里只传**目录前缀**，那是两个实现语义相同的那一种输入。
 *
 * ## 他的书怎么找：走卡号，**不走命名约定**
 *
 * `Book` 里没有 `childId`（只有 `cardId` + `cardRevision`）。所以"他的书"是
 * **这个孩子的卡号集合 ∩ 所有书的 cardId**——一段真实的关系，
 * 而不是 `${childId}-sheet` 这个由建卡代码顺手拼出来的字符串。
 * 靠约定找的话，哪天建卡改用别的命名，删除会安静地漏掉全部旧书
 * （`store.ts` 的 `latestForChild` 为同一件事写过一次）。
 */

import type { AssetStore } from './engine/providers/types.ts'
import type { CardStore } from './engine/character-card/store.ts'
import type { ProfileStore } from './engine/character-card/profile-store.ts'
import { bookDirOf } from './engine/index.ts'
import { THUMB_PREFIX, THUMB_WIDTHS } from './thumbs.ts'

/** 清单里的一行。`deleted` 是**条数**（文件 / 记录），不是字节 */
export type DeletionPlace = {
  /** 给人看的位置名 */
  place: string
  /** 这个位置归谁管（资产路径前缀，或一句说明） */
  at: string
  deleted: number
  /**
   * 字节数。★ **量不到就不给这个字段**，不给一个估的。
   * 角色卡那份有：删卡本来就要读卡才知道参考图多大。
   * 书那份没有：`AssetStore` 没有 `stat`，要算字节得把几十张页图全读一遍，
   * 而那个数对家长没有用处（他的问题是"删干净了吗"，不是"删了多少 MB"）。
   */
  bytes?: number
  /** 说清这个数是什么意思。凡"0 条"都必须解释，否则读者分不清"没删到"与"本来就没有" */
  note?: string
  /** 这个位置删失败时的原话。有它就说明**没删干净**，凭据必须如实带着 */
  failed?: string
}

export type DeletionReceipt = {
  childId: string
  name: string
  at: number
  places: DeletionPlace[]
  /** 删掉的书（书号 + 书名）。★ 列出来而不是只报个数：家长要知道**丢的是哪几本** */
  books: { bookId: string; title: string }[]
  totalFiles: number
  totalBytes: number
  /** 这份凭据是"要删的"还是"删掉的"。界面文案要分开说，不许混 */
  stage: 'plan' | 'done'
  /** 有没有哪个位置失败。有就是这张凭据**不完整**，界面不许说"已清空" */
  complete: boolean
}

export type DeletionDeps = {
  store: AssetStore
  cardStore: CardStore
  profiles: ProfileStore
  /** 固定时间（测试要能复现；同 `buildCard` 的 `now`） */
  now?: number
}

/** 枚举出来的"该删什么"。预演与真删**共用它**，所以两边不会漏掉同一个位置 */
export type DeletionTargets = {
  hasProfile: boolean
  cardIds: string[]
  /** 卡目录下全部文件的条数（预演用；真删的数来自 `deletePrefix`） */
  cardFiles: number
  cardBytes: number
  books: { bookId: string; title: string }[]
  bookFiles: number
  /** 缩略图**目录**前缀（带尾斜杠）。★ 用目录不用文件，见文件头那一段 */
  thumbDirs: string[]
  thumbFiles: number
  /**
   * 有几张卡的形象** lineage 里有照片**（任一版带 `sourcePhoto`）。
   *
   * ★ 数的是**卡**，不是版本。理由不是省事，是这两个数回答的其实是同一个问题：
   *   凭据要答的是"这个孩子有没有真照片经手过"，而一张卡只要有一版来自照片，
   *   它后面每一版都是从那张照片画出来的图上改的——说"N 版来自照片"会把同一张照片
   *   数 N 次。实测到这一条是靠一个"1 版"的预期失败：改一版之后那个数变成了 2，
   *   因为 `store.create` 叠版本时把 `sourcePhoto` 一起继承了。
   *   ★ 继承本身是对的（隐私上宁可多认一层血缘，也不要漏），
   *     错的是拿它当"处理过几次"来数。
   */
  photoCards: number
}

export async function targetsOf(childId: string, deps: DeletionDeps): Promise<DeletionTargets> {
  const summaries = await deps.cardStore.summaries()
  // ★ 卡号来自 summaries（它扫的是目录、不是那个"当前版"指针），所以
  //   "指针坏掉的卡"也会被删掉——那种卡在界面上看不见，但它在磁盘上
  const cardIds = summaries.filter((one) => one.childId === childId).map((one) => one.cardId)

  let cardFiles = 0
  let cardBytes = 0
  let photoCards = 0
  for (const cardId of cardIds) {
    cardFiles += (await deps.store.list(`cards/${cardId}/`)).length
    // ★ 按**卡**数，不按版本数（见 `DeletionTargets.photoCards` 那段）
    const revisions = await deps.cardStore.revisions(cardId)
    if (revisions.some((card) => card.sourcePhoto)) photoCards += 1
    // 字节只数参考图：它是唯一有分量的那类文件（卡的 JSON 都只有几百字节）
    for (const path of await deps.store.list(`cards/${cardId}/`)) {
      if (!/\/ref\./.test(path)) continue
      cardBytes += (await deps.store.read(path))?.length ?? 0
    }
  }

  const books = await hisBooks(cardIds, deps)
  let bookFiles = 0
  for (const book of books) {
    bookFiles += (await deps.store.list(`${bookDirOf(book.bookId)}/`)).length
  }

  // ★ 缩略图：每个档位 × 每张卡 / 每本书，各是一个目录（见文件头）
  const thumbDirs: string[] = []
  let thumbFiles = 0
  for (const width of THUMB_WIDTHS) {
    for (const cardId of cardIds) thumbDirs.push(`${THUMB_PREFIX}${width}/cards/${cardId}/`)
    for (const book of books) {
      thumbDirs.push(`${THUMB_PREFIX}${width}/${bookDirOf(book.bookId)}/`)
    }
  }
  for (const dir of thumbDirs) thumbFiles += (await deps.store.list(dir)).length

  return {
    hasProfile: (await deps.profiles.load(childId)) !== null,
    cardIds,
    cardFiles,
    cardBytes,
    books,
    bookFiles,
    thumbDirs,
    thumbFiles,
    photoCards,
  }
}

/**
 * 这个孩子有哪些书。用**卡号**去认，不用命名约定（见文件头）。
 *
 * ★ 只列运行期的书：`public/demo/books/` 里那本是随仓库发布的演示书，
 *   不属于任何一个孩子——"删一个孩子"不该动它。
 */
async function hisBooks(
  cardIds: readonly string[],
  deps: DeletionDeps,
): Promise<{ bookId: string; title: string }[]> {
  if (cardIds.length === 0) return []
  const mine = new Set(cardIds)
  const paths = (await deps.store.list('books/')).filter((path) => path.endsWith('/book.json'))
  const out: { bookId: string; title: string }[] = []
  for (const path of paths) {
    // 书号先从路径取：它是"这本书在哪"的唯一答案，读不读得出 `book.json` 都不影响
    const fromPath = path.slice('books/'.length).split('/')[0] ?? ''
    if (fromPath === '') continue
    let raw: { cardId?: unknown; tree?: { title?: unknown } } | null = null
    try {
      raw = await deps.store.readJson(path)
    } catch {
      // 半截 JSON（进程被杀时最后写的那一件）。★ 这里**不能跳过**：
      //   跳过的症状是"删除漏了一本书"，而凭据上什么都看不出来。
      //   所以退回用路径上的书号，让它**照样被删**——但书名只能照实说不知道
      const listed = await deps.store.list(`${bookDirOf(fromPath)}/`)
      if (listed.length > 0) out.push({ bookId: fromPath, title: '(读不出来的一本)' })
      continue
    }
    if (!raw) continue
    const belongs = typeof raw.cardId === 'string' && mine.has(raw.cardId)
    // ★ 读不出来 `cardId` 时**不认领**这本书：宁可留着，也不要在"这本是谁的说不清"时删掉
    if (!belongs) continue
    const title = typeof raw.tree?.title === 'string' ? raw.tree.title : '(没有名字的书)'
    out.push({ bookId: fromPath, title })
  }
  return out.sort((a, b) => a.bookId.localeCompare(b.bookId))
}

/**
 * 一张凭据。**纯函数**，两个调用方给它两组数：
 * 预演给"数出来的"（`stage: 'plan'`），真删给"删掉的"（`stage: 'done'`）。
 *
 * ★ 凡是 0，都要有一句为什么。清单上孤零零一个"照片原图 0 条"读起来像"没删到"，
 *   而它真正的意思是"从来没有落盘"——这两件事必须分开。
 */
function receiptOf(
  childId: string,
  name: string,
  targets: DeletionTargets,
  numbers: { profile: number; cards: number; books: number; thumbs: number },
  at: number,
  stage: 'plan' | 'done',
  failures: Record<string, string>,
): DeletionReceipt {
  const places: DeletionPlace[] = [
    {
      place: '孩子的档案',
      at: `children/${childId}.json`,
      deleted: numbers.profile,
      ...(targets.hasProfile
        ? {}
        : { note: '这里本来就没有（示例孩子的档案在 public/ 里，不在这里）' }),
      ...(failures['profile'] ? { failed: failures['profile'] } : {}),
    },
    {
      place: '角色卡与参考图',
      at: `cards/{${targets.cardIds.join(',') || '没有'}}/`,
      deleted: numbers.cards,
      bytes: targets.cardBytes,
      ...(targets.cardIds.length === 0
        ? { note: '这个孩子还没有过形象' }
        : { note: `共 ${targets.cardIds.length} 张卡、全部版本与参考图` }),
      ...(failures['cards'] ? { failed: failures['cards'] } : {}),
    },
    {
      place: '他的书',
      at: 'books/{书号}/',
      deleted: numbers.books,
      ...(targets.books.length === 0
        ? { note: '还没有用他做过书' }
        : { note: `${targets.books.length} 本（含每本的过程日志 events.jsonl）` }),
      ...(failures['books'] ? { failed: failures['books'] } : {}),
    },
    {
      place: '缩略图缓存',
      at: `${THUMB_PREFIX}*/`,
      deleted: numbers.thumbs,
      note: `派生内容，删了能重算——但它也是他的脸，所以一起删（${targets.thumbDirs.length} 个缓存目录）`,
      ...(failures['thumbs'] ? { failed: failures['thumbs'] } : {}),
    },
    {
      place: '照片原图',
      at: '（不落盘）',
      deleted: 0,
      note:
        targets.photoCards === 0
          ? '这个孩子的形象不是从照片来的，所以没有过一次'
          : `从来没有落盘过；但这个孩子有 ${targets.photoCards} 张卡的形象是从照片画出来的（卡上只记着"用过、什么时候不再需要"这两个时间）`,
    },
  ]

  const complete = Object.keys(failures).length === 0
  return {
    childId,
    name,
    at,
    places,
    books: targets.books,
    totalFiles: places.reduce((sum, one) => sum + one.deleted, 0),
    totalBytes: targets.cardBytes,
    stage,
    complete,
  }
}

/** 预演：要删什么、各多少条。**一个字节都不动**（界面的二次确认要拿它说人话） */
export async function planDeletion(childId: string, deps: DeletionDeps): Promise<DeletionReceipt> {
  const profile = await deps.profiles.load(childId)
  const targets = await targetsOf(childId, deps)
  return receiptOf(
    childId,
    profile?.name ?? childId,
    targets,
    {
      profile: targets.hasProfile ? 1 : 0,
      cards: targets.cardFiles,
      books: targets.bookFiles,
      thumbs: targets.thumbFiles,
    },
    deps.now ?? Date.now(),
    'plan',
    {},
  )
}

/**
 * 真删。返回的凭据里是**`deletePrefix` 真正删掉的条数**。
 *
 * ★ 每个位置各自 try/catch：一个位置失败**不阻止**其它位置被删
 *   （删到一半停下，剩下的东西比删完更糟），但失败会记进 `failed`，
 *   于是 `complete: false`，界面**不许**说"已清空"。
 */
export async function deleteChildEverywhere(
  childId: string,
  deps: DeletionDeps,
): Promise<DeletionReceipt> {
  const profile = await deps.profiles.load(childId)
  const targets = await targetsOf(childId, deps)
  const failures: Record<string, string> = {}
  const numbers = { profile: 0, cards: 0, books: 0, thumbs: 0 }

  const attempt = async (key: keyof typeof numbers, run: () => Promise<number>): Promise<void> => {
    try {
      numbers[key] += await run()
    } catch (err) {
      failures[key] = err instanceof Error ? err.message : String(err)
    }
  }

  for (const cardId of targets.cardIds) {
    // 删卡走 store 那一层：`cards/<cardId>/` 这个前缀是它的事，
    // 在这一层重拼一遍就是第二份真相
    await attempt('cards', async () => (await deps.cardStore.deleteCard(cardId)).files)
  }
  for (const book of targets.books) {
    await attempt('books', () => deps.store.deletePrefix(`${bookDirOf(book.bookId)}/`))
  }
  for (const dir of targets.thumbDirs) {
    await attempt('thumbs', () => deps.store.deletePrefix(dir))
  }
  await attempt('profile', () => deps.profiles.delete(childId))

  return receiptOf(
    childId,
    profile?.name ?? childId,
    targets,
    numbers,
    deps.now ?? Date.now(),
    'done',
    failures,
  )
}

/**
 * 删到一半时给家长的那句话：**点名**是哪几个位置没删干净。
 *
 * ★ 为什么这句话在这一层、不在路由或界面里拼：位置名（"他的书"、"缩略图缓存"）
 *   是**凭据的词汇**，只有这一层知道一共有哪些位置。散到两处去拼，
 *   早晚会有一处漏掉某个位置——而漏掉的那一个恰好就是没删干净的那个。
 *
 * ★ 干净删完时回 `null`，不给一句兜底的人话：调用方拿到 `null` 就不该有这句话出现，
 *   于是"删干净了却还挂着一句'没删干净'"这种错**写不出来**。
 *   路由那边正是拿它当唯一判据的（见 `/api/children/<childId>` 的 DELETE）。
 *
 * ★ 底层原话（`places[].failed`）**不进这句话**：家长要问的是"哪儿没删干净"，
 *   不是在弹窗里读一句 `EACCES: permission denied`。原文仍随凭据一起回给调用方，
 *   排障时去响应体里看——这样这句话也不会随着底层换实现而变样。
 */
export function partialMessageOf(receipt: DeletionReceipt): string | null {
  const bad = receipt.places.filter((one) => one.failed).map((one) => one.place)
  if (bad.length === 0) return null
  return `这些位置没删干净：${bad.join('、')}。可以再删一次——重复删是安全的。`
}
