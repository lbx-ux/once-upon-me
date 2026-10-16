/**
 * /api/books/[bookId] —— 删掉书架上的**一本书**
 *
 * ```
 *   GET     /api/books/<bookId>   预演：回一张"将要删掉什么"的凭据（一个字节都不动）
 *   DELETE  /api/books/<bookId>   真删：回一张"删掉了什么"的凭据
 * ```
 *
 * ★ 形状与 `/api/children/[childId]` 一样（预演走 GET、真删走 DELETE，两者共用同一个
 *   `refuse()`），因为界面上那两步是同一件事："列出要失去什么" → "确认"。
 *   分成两个文件的话，两种拒绝（没有这一本 / 删不干净）就要么复制一段、要么再抽一层，
 *   而复制的那天起，"预演说能删、真删说没有"就会开始出现。
 *
 * ★ 预演是**按需**取的（不是书架一渲染就去数一遍）：数一遍要遍历这本书的目录与
 *   `thumbs/` 的五个档位；大多数人永远不点删除，为每一次浏览都付一次目录遍历，
 *   是把代价放在最不该放的地方（同 `/api/children/[childId]`）。
 *
 * ★ 拒绝的两种情形话不一样：
 *   - 盘上没有这一本 → 404。**这不只是一句客气话**：用户看到的书架是服务端渲染的，
 *     另一个标签页刚删掉它时，"再删一次"就会走到这里。
 *   - 删到一半失败 → 500 + **带上那张不完整的凭据**（哪些删了、哪些没有）。
 */

import { assetRoot } from '@/lib/books-runtime.ts'
import { createFsStore } from '@/lib/engine/index.ts'
import {
  bookOnDisk,
  deleteBookEverywhere,
  planBookDeletion,
  type BookDeletionDeps,
  type BookDeletionReceipt,
} from '@/lib/book-deletion.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MISSING = '盘上没有这一本（也许已经在别处删掉了）。刷新一下书架看看——它多半已经不在了。'

async function depsOf(): Promise<BookDeletionDeps> {
  const store = await createFsStore(assetRoot())
  return { store }
}

/** 两个动词共用：不在盘上就只有一句话可说 */
async function refuse(bookId: string, deps: BookDeletionDeps): Promise<Response | null> {
  if (await bookOnDisk(bookId, deps)) return null
  return Response.json({ code: 'book-not-found', message: MISSING }, { status: 404 })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  const { bookId } = await params
  const deps = await depsOf()
  const denied = await refuse(bookId, deps)
  if (denied) return denied

  try {
    return Response.json({ receipt: await planBookDeletion(bookId, deps) })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  const { bookId } = await params
  const deps = await depsOf()
  const denied = await refuse(bookId, deps)
  if (denied) return denied

  try {
    const receipt: BookDeletionReceipt = await deleteBookEverywhere(bookId, deps)
    if (!receipt.complete) {
      // ★ 凭据**跟着失败响应一起回去**：只说"删除失败"会让人以为一样都没删，
      //   而"确实删了一半"与"什么都没删"要让用户做两件不同的事——前者不用重试
      //   （再删一次也不会更干净），后者可以重试（`deletePrefix` 对不存在的路径回 0）
      // ★ 这里不走 `userFailureOf`：它手上没有异常，只有一张凭据，而这一句的意思是
      //   "服务端写盘没写干净"，码与状态码都写在这儿比硬造一个异常再翻译回来清楚
      return Response.json(
        {
          code: 'asset-write-failed',
          message: '有些位置没删干净——凭据里逐行标出来了。',
          retryable: true,
          receipt,
        },
        { status: 500 },
      )
    }
    return Response.json({ receipt })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}
