/**
 * books-runtime.ts —— 服务端这一侧"这本书现在有没有人在跑"的那本账
 *
 * 三样东西，都是 Route Handler 要用、而引擎不该知道的：
 *
 * 1. 资产根（`ASSET_ROOT`，缺省 `.out/web`）。引擎拿到的是 store，不是路径；
 *    路径这件事属于"这次跑在哪儿"，是运行时的决定。
 * 2. 在跑的这本书的集合。书号是"卡 + 主题指纹"（不含时间戳），
 *    所以同一份表单连点两次会写同一个目录：一份日志被两轮事件交叉写入，
 *    后跑的那轮还会把前一轮的 `book.json` 覆盖掉。挡法只有一个——按书号串起来。
 * 3. 一份书的存在性查询（`bookExists`），给重放的收尾帧用。
 *    它收的是 store（工单 16 起）：查的是"你这一片里有没有"，不是"盘上有没有"。
 *
 * ★ 这本账挂在 `globalThis` 上，不是模块级的 `const running = new Set()`。
 *    这不是风格偏好，是实测：第一版就是模块级的，然后
 *    `POST /api/books`（另一个路由）正在跑时，`GET /api/books/<id>/events`
 *    回的是 `{"running": false}`——因为**每个 Route Handler 在 dev 下各自编译、
 *    各自实例化**，模块级变量不跨路由共享。同一个 `globalThis` 才是进程级的。
 *    症状本来会是"点两次按钮，两次都开跑，日志交叉写入、成品被覆盖"，
 *    而并发保护那行代码看上去完全正确。
 *
 * 多实例部署时它退化成"每个实例各挡各的"，那时要换的是把这本书的租约放进资产里
 *   （一个文件 + 内容指纹 + 过期时间），不是加锁库。这一周的形态是单机演示。
 */

import { resolve } from 'node:path'
import { manifestPathOf } from './engine/index.ts'
import type { AssetStore } from './engine/providers/types.ts'

export const DEFAULT_ASSET_ROOT = '.out/web'

export function assetRoot(): string {
  const raw = process.env['ASSET_ROOT']?.trim()
  return resolve(raw && raw !== '' ? raw : DEFAULT_ASSET_ROOT)
}

const RUN_REGISTRY = Symbol.for('once-upon-me.running-books')

type RunningRegistry = Set<string>

/** 进程级的这本账。用 `Symbol.for` 做键：同一个符号在整个进程里只有一个，
 *  哪怕这个模块被编译进了两份 bundle、被实例化了两次。
 */
function registry(): RunningRegistry {
  const host = globalThis as typeof globalThis & { [RUN_REGISTRY]?: RunningRegistry }
  host[RUN_REGISTRY] ??= new Set<string>()
  return host[RUN_REGISTRY]
}

/**
 * 这本书这一轮的租约键。
 *
 * 为什么键里要带上是谁：书号是"卡 + 版 + 形态 + 主题"的指纹，
 *   既不含时间戳也不含账号（`bookIdOf` 那段）。所以两个账号给同名孩子
 *   配同一个主题，推出来是同一个书号。不带这一截的话，甲在跑的时候
 *   乙点"开一本"会收到 409「这本书正在生成中」——
 *   一句关于别人的、他看不见的那本书的拒绝。
 *   它不是第二份归属记录（归属只在磁盘的 `u/<id>/` 前缀上）：
 *   这是一把进程内的锁的名字，锁的名字里带主人是常态。
 */
export function runKeyOf(userId: string, bookId: string): string {
  return `${userId}/${bookId}`
}

/** 拿这本书的租约。已经在跑就返回 false（调用方给一句人话，别静默排队） */
export function tryStartRun(bookId: string): boolean {
  const books = registry()
  if (books.has(bookId)) return false
  books.add(bookId)
  return true
}

export function finishRun(bookId: string): void {
  registry().delete(bookId)
}

export function isRunning(bookId: string): boolean {
  return registry().has(bookId)
}

/**
 * 成品在不在。判据是清单文件（`book.json` 是最后写的那一件，见 runBook 的收尾顺序）。
 *
 * 2026-10-17（工单 16）：收 store，不收书号。原来它自己 `readFile(join(assetRoot(), …))`，
 *   也就是永远问"根上有没有这本"。加了归属之后那会坏在两处：
 *   `POST /api/books` 的 409「这个主题你已经有一本了」会变成"别人有过这个主题，所以你不许做"
 *   ——既是误伤，也是把别人的存在性泄漏给一个陌生人。
 *   改成走 store 之后这件事写不错：读者手上就是那一片。
 */
export async function bookExists(store: AssetStore, bookId: string): Promise<boolean> {
  return store.exists(manifestPathOf(bookId))
}
