/**
 * /api/books/[bookId]/pages —— 这一本每一页现在长什么样（工单 08）
 *
 * ```
 *   GET  /api/books/<bookId>/pages
 * ```
 *
 * 运行视图上那两个弹窗（重画 / 重配）要的东西一次给全：正文、页级描述、场景、
 * 组装好的提示词、这一页现在的图与录音。形状与那些"为什么要这个字段"的判断
 * 都在 [`lib/run-pages.ts`](../../../../../../lib/run-pages.ts)，这里只做取数。
 *
 * 2026-10-17（工单 16）：这条路原来没有登录闸，而且读的是根上那一份。
 *   它回的是整本的正文与逐页提示词，是"我的东西"里最像草稿的一件——
 *   所以现在：匿名 401，登录的人只看得见自己那一片（别人的书号在这里不存在 → 404）。
 */

import type { NextRequest } from 'next/server'
import { createUserStore } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { runtimeAssetUrl } from '@/lib/book-source.ts'
import { runPagesOf } from '@/lib/run-pages.ts'
import { createCardStore, type Book } from '@/lib/engine/index.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 弹窗里那张预览图的档位。★ 与"选一个小主角"那一屏的预览同一档
 * （`ChildPickerItem.card.previewUrl`），不另发明一个数：
 * 档位是一张封闭表，权威在 `lib/thumbs.ts`，写一个表外的值会被向上归。
 * （录音走同一个数——mp3 不在可缩放的档位里，`runtimeAssetUrl` 会原样回它。）
 */
const PREVIEW_WIDTH = 768

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  // 不要任何能力：读自己已经做出来的东西不需要"再开一项权限"
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { bookId } = await ctx.params
  const store = await createUserStore(assetRoot(), guard.session.userId)

  let book: Book | null
  try {
    book = await store.readJson<Book>(`books/${bookId}/book.json`)
  } catch {
    book = null
  }
  if (!book) {
    return Response.json(
      { code: 'book-not-found', message: `盘上没有这本书（${bookId}）。刷新一下书架看看` },
      { status: 404 },
    )
  }

  // 按清单说的那一版卡组装提示词——与单页重做那条同一个判据
  //   （用最新版会让屏幕上显示的提示词与这一本真正用的那一版对不上）
  const card = await createCardStore(store).load(book.cardId, book.cardRevision)
  if (!card) {
    return Response.json(
      { code: 'card-not-found', message: `这本书要用的角色卡（${book.cardId}）不在了` },
      { status: 404 },
    )
  }

  return Response.json({ pages: runPagesOf(book, card, runtimeAssetUrl, PREVIEW_WIDTH) })
}
