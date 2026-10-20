/**
 * /api/books/[bookId] —— 删掉书架上的一本书（`DELETE`，回一张"删掉了什么"的凭据）。
 *
 * 只有一个动词（2026-10-16 用户第二句话）。第一版照着 `/api/children/[childId]` 做了两步：
 * 先 `GET` 一张"将要失去什么"的凭据（一个字节都不动）、界面上列出来、确认，再 `DELETE`。
 * 用户看着那份逐行清单说「也不要写这么多，就一个确认是否删除，还是算了」——于是预演
 * 连同那条 `GET` 一起撤掉，确认框只剩一句"删掉《X》？"。撤掉的代价写在
 * `lib/book-deletion.ts` 的文件头：点确认之前不再知道"要失去多少张图"。
 *
 * 凭据仍然回，但只在出错时被人看：正常删完，界面上什么也不留。
 * 拒绝的两种情形话不一样：盘上没有这一本 → 404（书架是服务端渲染的，另一个标签页
 * 刚删掉它时"再删一次"就会走到这里）；删到一半失败 → 500，带上那张不完整的凭据。
 */

import { assetRoot } from '@/lib/books-runtime.ts'
import {
  bookOnDisk,
  deleteBookEverywhere,
  type BookDeletionDeps,
  type BookDeletionReceipt,
} from '@/lib/book-deletion.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'
import { createUserStore } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'

import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MISSING = '盘上没有这一本（也许已经在别处删掉了）。刷新一下书架看看——它多半已经不在了。'

async function depsOf(userId: string): Promise<BookDeletionDeps> {
  const store = await createUserStore(assetRoot(), userId)
  return { store }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  // 2026-10-17（工单 16）：这条路原来没有登录闸（实测确认）。现在删的是"你自己
  // 那一片里的那一本"——别人的书号在你这片里根本不存在，下面那个 404 天然就挡住了。
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { bookId } = await params
  const deps = await depsOf(guard.session.userId)
  if (!(await bookOnDisk(bookId, deps))) {
    return Response.json({ code: 'book-not-found', message: MISSING }, { status: 404 })
  }

  try {
    const receipt: BookDeletionReceipt = await deleteBookEverywhere(bookId, deps)
    if (!receipt.complete) {
      // 凭据跟着失败响应一起回去：只说"删除失败"会让人以为一样都没删，而"确实删了
      // 一半"与"什么都没删"要让用户做两件不同的事——前者不用重试（再删一次也不会更干净），
      // 后者可以（`deletePrefix` 对不存在的路径回 0）。
      // 这里不走 `userFailureOf`：手上没有异常，只有一张凭据，而这一句的意思是
      // "服务端写盘没写干净"，码与状态码写在跟前比硬造一个异常再翻译回来清楚。
      return Response.json(
        {
          code: 'asset-write-failed',
          message: '有些位置没删干净——下面标出来了。可以再删一次或者刷新看看。',
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
