/**
 * admin/usage.ts —— 管理页那一列「每个人做了多少东西」（工单 16，2026-10-17）
 *
 * ★ 为什么这一列的数在 **Next 这一侧**算，而不是在 Java 里：
 *   作品是**磁盘上的文件**（`ASSET_ROOT/u/<id>/…`），而 Java 只看得见 MySQL——
 *   让它去数，要么给它挂同一份磁盘，要么让它回头调 Next，两条都是把
 *   "引擎写文件、Java 写库"这两件事重新绑在一起。
 *   ★ 这一列数的因此是**字节**：盘上真有什么，就报什么。
 *   它与 `asset-scope.ts` 那条"磁盘前缀就是归属的唯一记录"是同一个决定的两面——
 *   既然归属只记在路径上，数归属就只能数路径。
 *
 * ★ 一次遍历、内存里分组，**不是每人走一遍**：几十个用户时那是几十次全树遍历
 *   （`store.list` 每一次都要从根走完）。写法与 `child-deletion.ts` 里
 *   "列前缀再筛"同源。资产量级是几十到几百个文件，一次走完整个人群也够。
 *
 * ★★ 这个文件**不许被客户端组件 import**（它间接带了 `node:fs/promises`）。
 *   形状与那句文案因此住在 `state.ts` 里——`AdminScreen` 只从那里拿。
 *   踩过一次：`AdminScreen` 顺手从这里 import 了 `usageTextOf`，typecheck / lint /
 *   单元测试全绿，而 `/admin` 整页 500（webpack 的 `UnhandledSchemeError`）。
 *
 * ★ 数不出来时回**空表**而不是抛：磁盘读不到不该把整张用户表一起带走
 *   （这条判据原来对着 `readRequests` 写过一遍——权限申请那一列 2026-10-18 拆了，
 *   所以这里不再举那个例子）。空表在界面上是「—」，不是「0」。
 */

import { createUnscopedStore } from '@/lib/asset-scope.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import type { AdminUsage } from './state.ts'

/** 归属那一片的根目录名。★ 与 `asset-scope.ts` 的 `scopePrefixOf` 同一个字面量 */
export const SCOPE_DIR = 'u'

/**
 * 纯函数：从**盘上的路径清单**数出每个人几本几卡几个孩子。
 *
 * ★ 分成两半（这里纯、外面那一层列目录）是为了它能被测试钉住——
 *   与这个仓库一贯的做法一样：判据是纯的，IO 只是把它接上。
 *
 * 计数口径是**去重后的目录名**，不是文件数：一本书有 20 页图 + 1 份清单 +
 * 一段段朗读，数文件会报出"512 本"这种话。
 * `children/` 那一项是档案，一个客户一个文件，所以按文件数。
 */
export function usageFromPaths(paths: readonly string[]): Record<string, AdminUsage> {
  const bookIds = new Map<string, Set<string>>()
  const cardIds = new Map<string, Set<string>>()
  const kidIds = new Map<string, Set<string>>()
  const out: Record<string, AdminUsage> = {}

  for (const path of paths) {
    const parts = path.split('/')
    if (parts[0] !== SCOPE_DIR) continue
    const userId = parts[1]
    // `u/3` 这种半截路径（不可能由 `list` 给出，但纯函数不该赌调用方）跳过
    if (!userId || parts.length < 3) continue

    const [kind, name] = [parts[2], parts[3]]
    if (kind === 'books' && name) add(bookIds, userId, name)
    else if (kind === 'cards' && name) add(cardIds, userId, name)
    // ★ 孩子数的是 `children/<childId>.json` 这个**文件**本身（一个档案一个文件），
    //   所以 parts.length 必须正好是 3 段以后那一个名字
    else if (kind === 'children' && name && parts.length === 4) add(kidIds, userId, name)

    if (!out[userId]) out[userId] = { books: 0, cards: 0, children: 0 }
  }

  for (const userId of Object.keys(out)) {
    out[userId] = {
      books: bookIds.get(userId)?.size ?? 0,
      cards: cardIds.get(userId)?.size ?? 0,
      children: kidIds.get(userId)?.size ?? 0,
    }
  }
  return out
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key)
  if (set) set.add(value)
  else map.set(key, new Set([value]))
}

/** 数一遍磁盘（管理页首屏用）。盘上没有 `u/` 这一层时回空表，不是抛 */
export async function usageByUser(root: string = assetRoot()): Promise<Record<string, AdminUsage>> {
  try {
    const store = await createUnscopedStore(root)
    return usageFromPaths(await store.list(`${SCOPE_DIR}/`))
  } catch {
    return {}
  }
}
