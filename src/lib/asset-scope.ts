/**
 * asset-scope.ts —— 归属的那一道缝：把资产切成人各一片（工单 16，2026-10-17）
 *
 * 用户 2026-10-17 定的口径是「先做归属，字节仍在磁盘」，今天确认：**磁盘上
 * `u/<userId>/` 这个前缀就是归属的唯一记录**——不加一张 books 表，因为引擎写文件、
 * Java 写库，那两者之间没有事务，镜像表迟早会与盘上的字节不一致
 * （"行说是你的、字节不在"或反过来），而那种不一致最难查。
 *
 * 为什么是包装一个 store，而不是把前缀加进每一条路径表达式：
 *   `illustrate.ts` 写 `books/${bookId}/page-…`、`manifestPathOf` 拼
 *   `books/<id>/book.json`、`book-deletion` / `child-deletion` / `assetPathInDemo`
 *   各自摘前缀……这些地方有二十来处。让它们各自知道"账号"这件事，
 *   就是二十来处会漂的地方；而 `AssetStore` 本来就是一个接口
 *   （`createFsStore` / `createMemoryStore` 已经是它的两个实现，见
 *   `providers/stores.ts` 的文件头）。所以这里加第三个实现：按人加前缀。
 *   引擎里那些路径表达式一个字节都不用改。
 *
 * 三条纪律：
 *
 * 1. 引擎与清单不知道账号存在。 `put` 把带前缀的物理路径写下去，但返回给调用方的
 *    `AssetRef.path` 去掉前缀。于是一本新书的 `book.json` 里记的还是
 *    `books/<id>/page-1-a1.png`——导出脚本、`assetPathInDemo`、阅读器、
 *    清单审计全都照旧。★ 这一条是这一层最容易写错、也最难发现的地方：
 *    漏了它，路径会带着 `u/3/` 进清单，然后"演示书为什么读不出来"要查半天。
 *
 * 2. 权限是结构性的，不是过滤。 读取时拼的是请求者自己的前缀，
 *    别人的书 id 在你自己那一片里根本不存在 → 404。没有"先查出来再判是不是他的"
 *    这一步，也就没有"某处忘了判"这一步。
 *
 * 3. 越界仍然只由底层拒（`providers/stores.ts` 的 `resolve` 已经实现了
 *    `../` 那条，而且它的文件头就写着"这种事不能靠信任"）。这一层**不重复写
 *    那个检查——但它必须**多一条：见 `assertInsideScope` 上面那段。
 */

import { join } from 'node:path'

import { withDemoCards } from './card-source.ts'
import { EngineError } from './engine/errors.ts'
import { createFsStore } from './engine/index.ts'
import type { AssetRef } from './engine/domain.ts'
import type { AssetStore, PutEntry } from './engine/providers/types.ts'

/** 一个人的那一片。★ 结尾那个斜杠是承重的：`u/1/` 不会命中 `u/10/…` */
export function scopePrefixOf(userId: string): string {
  return `u/${userId}/`
}

/**
 * ★★ 没有 userId 就当场炸，绝不返回一个"没有主的"作用域。
 *
 * 这条不是防攻击者，是防我们自己忘了那道闸：路由少写一行 `requireCapability`，
 * `guard.session.userId` 就是 `undefined`，于是所有人共用一个 `u/undefined/`——
 * 那比"没有归属"还坏，因为它看起来是通的（东西存得下、读得回、
 * 界面上没有任何异常），而实际上两个陌生人在同一片里互相看得见。
 *
 * 工单 16 之前，`/api/children`、`/api/books/<id>`（DELETE）这些路由本来就没有登录闸
 * （2026-10-17 实测确认）——也就是说这个错法不是假想的，它就摆在那几个文件里。
 * 把这一条写成抛错之后，漏掉闸的症状从"悄悄串号"变成"500 + 一句说清的话"。
 */
function requireUserId(userId: string | null | undefined): string {
  const trimmed = (userId ?? '').trim()
  if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') {
    throw new EngineError(
      'asset-write-failed',
      '这一处资产没有主人：调用方没有拿到登录用户（多半是路由漏了登录闸）',
    )
  }
  return trimmed
}

/**
 * ★ 这一条是这一层自己的边界检查，而它不是"把底层那条抄一遍"。
 *
 * 底层防的是"跑出资产根"，`u/<id>/` 这个前缀一加，多了一层边界：
 * 而底层那条判据（"还在 base 之内"）对跑出自己那一片、落进根里这件事完全满意。
 *
 * 具体的那条攻击：`/api/assets/../u/7/books/x/book.json` 这种 URL 是攻击者随便写的。
 * 拼上前缀得到 `u/3/../u/7/books/x/book.json` —— `path.resolve` 之后正好是
 * `u/7/books/x/book.json`，在根之内，所以底层放行；于是 3 号读到了 7 号的书。
 * 这条路径 2026-10-17 是先被单元测试照出来的（当时那一条写的是
 * "put 越界会抛"，用了 `../../`：加了前缀之后它正好落在根上，没抛）——
 * 也就是说这个洞的第一版是"测试红了"，而红的原因不是测试写错了。
 *
 * 判据只拒 `..` 那一段，不是"路径里带两个点"：`a..b.png` 是合法文件名。
 * 这条路只对 `..` 响，而引擎生成的所有路径（`books/<id>/page-1-a1.png`、
 * `cards/<id>/ref.<指纹>.png`）里一个 `..` 段都没有——所以它不会误伤。
 *
 * 错误码复用 `asset-write-failed` 而不新增一个：这个条件永远不该有用户读到的文案
 * （读的时候 `/api/assets` 把它吞成 404，写的时候是一个编程错误）。
 * 往那个联合类型里加一个只为开发者的码，等于给错误→文案那条链加一处永远用不上的分支。
 */
function assertInsideScope(path: string, userId: string): void {
  // ★ 两种分隔符都要看。`path.resolve` 在 Windows 上把 `\` 也当分隔符，
  //   而 Next 会把 URL 里的 `%5c` 解码成 `\`。只按 `/` 切的话，
  //   `books/..\..\u\7\books\x/book.json` 在这里放行、到磁盘上却真的出了这一片。
  //   生产是 Linux（`\` 只是普通文件名字符），但这条边界写得是"结构上不许越界"，
  //   不该按宿主平台决定松紧。
  if (path.split(/[\\/]/).includes('..')) {
    throw new EngineError('asset-write-failed', `资产路径越界：${path} 不在 u/${userId}/ 之下`)
  }
}

/**
 * 把根 store 包成"只有这个人那一片"的 store。
 *
 * `base` 是可注入的（缺省是真的磁盘），所以这一层能被 `createMemoryStore`
 *   钉住——那些判据（返回的路径有没有前缀、list 会不会串到别人那片）用真磁盘
 *   测就得建目录、清目录，而它们与磁盘无关。
 */
export function scopedStore(base: AssetStore, rawUserId: string | null | undefined): AssetStore {
  const userId = requireUserId(rawUserId)
  const prefix = scopePrefixOf(userId)
  const physical = (path: string): string => {
    // 每一处进出口都过这一道（读、写、列、删），不是只在写上——
    //   最要紧的那条攻击恰好是读（`/api/assets` 的路径是攻击者写的）
    assertInsideScope(path, userId)
    return `${prefix}${path}`
  }
  /** `list` 拿回来的路径一定带这个前缀（前缀就是我们自己传下去的），所以直接切 */
  const logical = (path: string): string => path.slice(prefix.length)

  const store: AssetStore = {
    // id 里带上是谁那一片：日志与排障时"哪个用户在写"是第一个要问的问题
    id: `${base.id}#u${userId}`,

    async put(entry: PutEntry): Promise<AssetRef> {
      const ref = await base.put({ ...entry, path: physical(entry.path) })
      // 纪律 1：交回调用方的是逻辑路径（`originUrl` 那两个字段原样留着）
      return { ...ref, path: entry.path }
    },

    async putJson(entry: { path: string; value: unknown }): Promise<AssetRef> {
      const ref = await base.putJson({ path: physical(entry.path), value: entry.value })
      return { ...ref, path: entry.path }
    },

    async read(path: string): Promise<Uint8Array | null> {
      return base.read(physical(path))
    },

    async readJson<T>(path: string): Promise<T | null> {
      return base.readJson<T>(physical(path))
    },

    async exists(path: string): Promise<boolean> {
      return base.exists(physical(path))
    },

    async list(prefix: string): Promise<string[]> {
      const paths = await base.list(physical(prefix))
      return paths.map(logical)
    },

    async deletePrefix(prefix: string): Promise<number> {
      return base.deletePrefix(physical(prefix))
    },
  }

  return store
}

/**
 * 一个人那一片的根路径 —— 给那些"收根路径、自己在里面建 store"的入口用。
 *
 * 为什么需要第二个出口，而不是全用 `createUserStore`：
 *   `createFsEventLog(root)`、`listCardItems(root)`、`listChildPicker(root)`、
 *   `childProfileOf(id, root)` 这一批的入参本来就是路径（它们各自在里面
 *   `createFsStore(root)`）。把 store 塞进去要改它们所有人的签名——
 *   而那正是这一轮想避免的"二十来处会漂的地方"。
 *   两条出口拼出来的是同一个目录，`requireUserId` 那道闸也都过（空 userId 一样炸）。
 */
export function userSliceRoot(root: string, userId: string | null | undefined): string {
  return join(root, scopePrefixOf(requireUserId(userId)))
}

/**
 * 一个人那一片的 store（真的磁盘）。路由与页面用这个。
 *
 * 2026-10-17：它现在多垫了一层示例卡（`card-source.ts` 的 `withDemoCards`）。
 *   为什么垫在这里、而不是让每个路由自己记得加：这一层是唯一一个
 *   "请求读资产时走的那个 store"，而有十来条路由（建书、出图、重画一页、
 *   换一版、【/api/assets】……）都靠它。`createCardStore(store)` 与
 *   `providers.store.read(card.reference.path)` 两拨读法都会经过这里，
 *   少一处没垫的症状是"示例小主角选得中、一点生成就 404 找不到参考图"——
 *   那种错只在真去生成时才出现，而它恰好是这一条最该通的地方。
 *   只对 `cards/` 生效：书与档案各有各的收口函数（`resolveBook` /
 *   `listChildren`），在这里再开一个入口就是同一份字节有两条路。
 *   写与删永远落在你自己那一片（示例卡改不动、也删不掉）。
 */
export async function createUserStore(
  root: string,
  userId: string | null | undefined,
): Promise<AssetStore> {
  return withDemoCards(scopedStore(await createFsStore(root), userId))
}

/**
 * 没有主人的那片 store —— 给"管理员看全站"与"开发脚本"用。
 *
 * 名字里带 `unscoped` 是刻意的：每一次调用都应该是一个需要解释的决定。
 *   普通用户的那条路上看到这个名字，八成是写错了片。
 */
export async function createUnscopedStore(root: string): Promise<AssetStore> {
  return createFsStore(root)
}
