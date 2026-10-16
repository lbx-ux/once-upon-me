/**
 * shelf-order.ts —— 书架那一排的**顺序**（用户拖动之后记在哪儿、怎么读回来）
 *
 * 与 `library.ts` 的关系：那个回答"一共有哪些本"（按默认规则排：新的在前），
 * 这个回答"**按什么次序摆**"。两件事分开写，是因为默认序是一条真规则
 * （`listBooks` 那条 `createdAt` 降序），而手排是它的**覆盖**——
 * 覆盖只覆盖它认识的那几本，见下。
 *
 * ## 为什么落在资产根（`shelf/order.json`），不是 `localStorage`
 *
 * 书架那一屏是**服务端渲染**的（`shelf/page.tsx` 读盘直接给 HTML）。
 * 顺序要是只存在浏览器里，首屏就只能按默认序渲染、挂载之后再跳一次——
 * 那正是 `ShelfDashboard.tsx` 文件头刚说过的"挂载前后两副面孔"。
 * 落盘还顺带让"换一台设备打开，排好的顺序还在"这件事自然成立。
 *
 * ```jsonc
 * // .out/web/shelf/order.json
 * { "order": ["xiaolu-r1-bf84901c4fcd", "probe-01"], "at": 1792076443362 }
 * ```
 *
 * ## 三条规则（每一条都有一条用例钉着）
 *
 * 1. **清单没见过的书排在最前面**（新的还是在前）。
 *    想清楚这一条花了点功夫：默认规则只有"新的在前"，手排是它的**覆盖**；
 *    而一份覆盖只对它写下的那几本负责。刚做完一本书回到书架、发现它在最右边
 *    （甚至翻过一屏才看见），比"排列被顶掉一格"糟得多——后者是用户自己刚做的动作，
 *    前者是"我的书是不是没存上"。
 * 2. **死 id 一律忽略**（删掉的书留在清单里）。写盘时顺手剪掉，读的时候也不认。
 *    这个文件**不因为空了就删**：删文件与写空清单在这一层是同一件事，
 *    多一个"文件在不在"的状态就多一处要判断。
 * 3. **清单只管次序，不管存在**：`applyOrder` 认识的 id 就是 `books` 里那几本，
 *    多余的丢、缺的补（补到最前面）。
 */

import type { AssetStore } from './engine/providers/types.ts'

/**
 * 顺序清单的路径。★ 它在 `books/` **外面**：`listBooks` 扫的是 `books/`
 * 前缀下的 `book.json`，同一棵树里再塞一个非书的文件，迟早会被某次遍历当成书数进去。
 */
export const SHELF_ORDER_PATH = 'shelf/order.json'

/** 盘上那个文件的形状。`at` 是最后一次拖动的时间（排障用，不参与判断） */
export type ShelfOrderFile = { order: string[]; at: number }

/** 只留下"非空字符串"。`unknown` → `string[]` 的唯一入口（盘上的东西不可信） */
function idsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((one): one is string => typeof one === 'string' && one !== '')
}

/**
 * 读顺序。**读不出来就退回默认序**（空数组），不抛。
 *
 * ★ `try/catch` 不是防御性编程，是这里两个 store 实现的一个真实分歧：
 *   `readJson` 对半截 JSON（进程被杀时最后写的那一件）——**内存 store 抛错，
 *   fs store 回 null**。`library.ts` 为同一件事写过一次（"这条是 library.test.ts
 *   抓出来的"）。一个排不上顺序的书架该照常显示，不该整页 500。
 */
export async function loadOrder(store: AssetStore): Promise<string[]> {
  let raw: unknown = null
  try {
    raw = await store.readJson<unknown>(SHELF_ORDER_PATH)
  } catch {
    return []
  }
  if (!raw || typeof raw !== 'object') return []
  return idsOf((raw as { order?: unknown }).order)
}

/**
 * 写顺序。**先剪、后写**：传进来的 id 里盘上已经没有的那些（删了的那几本）
 * 不该被写回文件。剪的是"这次要写的这一份"，不是"文件里原有的别的项"。
 *
 * `now` 显式可传：删书那一刀会顺手把书名从这个文件里划掉，而那条路要能复现
 * （与 `child-deletion.ts` 的 `DeletionDeps.now` 同一个理由）。
 */
export async function saveOrder(
  store: AssetStore,
  order: readonly string[],
  now: number = Date.now(),
): Promise<string[]> {
  const clean = [...new Set(order.filter((id) => id !== ''))]
  const file: ShelfOrderFile = { order: clean, at: now }
  await store.putJson({ path: SHELF_ORDER_PATH, value: file })
  return clean
}

/**
 * `books`（默认序）与清单 → 摆好的次序。**纯函数**。
 *
 * 泛型只要求 `bookId`：这一层不该认识 `BookSummary`（它连"封面多大"都不关心），
 * 测试也就不必造一份完整的摘要。
 */
export function applyOrder<T extends { bookId: string }>(
  books: readonly T[],
  order: readonly string[],
): T[] {
  const byId = new Map(books.map((book) => [book.bookId, book]))
  const placed = new Set<string>()
  const listed: T[] = []
  for (const id of order) {
    const book = byId.get(id)
    // 死 id（书已经删了）与重复 id 都在这里被吃掉
    if (!book || placed.has(id)) continue
    placed.add(id)
    listed.push(book)
  }
  // ★ 清单没见过的排最前面（文件头规则 1）。传进来的 `books` 已经是默认序，
  //   所以这几本之间保持"新的在前"，不用再排一次
  const unlisted = books.filter((book) => !placed.has(book.bookId))
  return [...unlisted, ...listed]
}

/** 清单里那些盘上已经没有的 id（预演与写盘前的剪枝共用同一段判断） */
export function pruneOrder(order: readonly string[], ids: Iterable<string>): string[] {
  const alive = new Set(ids)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of order) {
    if (!alive.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * 把 `id` 挪到**结果里的第 `index` 位**（0 开始，越界夹到两端）。
 *
 * ★ 这个签名是给拖动挑的，不是随手定的：拖动时算出来的目标位置是
 *   "在**去掉被拖的那一本之后**的那一列里数出来的第几个"——
 *   `rest` 与那个假想的列一模一样，所以调用方那边的下标可以直接传进来，
 *   不必再想"抽掉的那一本在目标前面还是后面"（那种偏移是这类代码最常见的一处错）。
 *   `id` 不在 `order` 里时不动（返回原数组）。
 */
export function moveTo(order: readonly string[], id: string, index: number): string[] {
  if (!order.includes(id)) return [...order]
  const rest = order.filter((one) => one !== id)
  const at = Math.max(0, Math.min(rest.length, Math.trunc(index)))
  rest.splice(at, 0, id)
  return rest
}
