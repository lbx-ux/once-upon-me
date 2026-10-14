/**
 * books-runtime.ts —— 服务端这一侧"这本书现在有没有人在跑"的那本账
 *
 * 三样东西，都是 Route Handler 要用、而引擎不该知道的：
 *
 * 1. **资产根**（`ASSET_ROOT`，缺省 `.out/web`）。引擎拿到的是 store，不是路径；
 *    路径这件事属于"这次跑在哪儿"，是运行时的决定。
 * 2. **在跑的这本书的集合**。书号是"卡 + 主题指纹"（不含时间戳），
 *    所以同一份表单连点两次会**写同一个目录**：一份日志被两轮事件交叉写入，
 *    后跑的那轮还会把前一轮的 `book.json` 覆盖掉。挡法只有一个——按书号串起来。
 * 3. **一份书的存在性查询**（`bookExists`），给重放的收尾帧用。
 *
 * ★★ 这本账挂在 `globalThis` 上，**不是模块级的 `const running = new Set()`**。
 *    这不是风格偏好，是实测：第一版就是模块级的，然后
 *    `POST /api/books`（另一个路由）正在跑时，`GET /api/books/<id>/events`
 *    回的是 `{"running": false}`——因为**每个 Route Handler 在 dev 下各自编译、
 *    各自实例化**，模块级变量不跨路由共享。同一个 `globalThis` 才是进程级的。
 *    症状本来会是"点两次按钮，两次都开跑，日志交叉写入、成品被覆盖"，
 *    而并发保护那行代码看上去完全正确。
 *
 * ★ 多实例部署时它退化成"每个实例各挡各的"，那时要换的是把这本书的租约放进资产里
 *   （一个文件 + 内容指纹 + 过期时间），不是加锁库。这一周的形态是单机演示。
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { manifestPathOf } from './engine/index.ts'

export const DEFAULT_ASSET_ROOT = '.out/web'

export function assetRoot(): string {
  const raw = process.env['ASSET_ROOT']?.trim()
  return resolve(raw && raw !== '' ? raw : DEFAULT_ASSET_ROOT)
}

const RUN_REGISTRY = Symbol.for('once-upon-me.running-books')

type RunningRegistry = Set<string>

/** 进程级的这本账。用 `Symbol.for` 做键：同一个符号在整个进程里只有一个，
 *  哪怕这个模块被编译进了两份 bundle、被实例化了两次。 */
function registry(): RunningRegistry {
  const host = globalThis as typeof globalThis & { [RUN_REGISTRY]?: RunningRegistry }
  host[RUN_REGISTRY] ??= new Set<string>()
  return host[RUN_REGISTRY]
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

/** 成品在不在。判据是**清单文件**（`book.json` 是最后写的那一件，见 runBook 的收尾顺序） */
export async function bookExists(bookId: string): Promise<boolean> {
  try {
    await readFile(join(assetRoot(), manifestPathOf(bookId)), 'utf8')
    return true
  } catch {
    return false
  }
}
