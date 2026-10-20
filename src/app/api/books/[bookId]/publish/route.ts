/**
 * /api/books/[bookId]/publish —— 「确定生成」那一下（工单 03）
 *
 * ```
 *   POST  /api/books/<bookId>/publish   草稿 → 成品
 * ```
 *
 * 为什么需要它：书号是"卡 + 版 + 形态 + 主题"的指纹（不含时间戳），
 *   所以 `runBook` 收尾把 `book.json` 写下去的那一刻，这本书在磁盘上就已经是完整的了。
 *   用户要的「确定生成」要有可见的后果，只能靠清单上这个状态：
 *   跑完写 `draft`，这一步翻成 `published`，书架按它分两排。
 *
 * 四条：
 *
 * 1. 是 `POST` 一个动作，不是 `PATCH` 一个字段。调用方手上没有"整本书"，
 *   而 `PATCH` 的形状会让人以为什么字段都能改。这一个动作只有一种结果。
 * 2. 幂等。已经发布的再发一次就回同一张凭据——不做"已发布所以报错"，
 *   用户连点两下不该看见一句红字。
 * 3. 回的是凭据，不是整本书（`bookId` + 新的 `status`）。书架那一屏自己会重读；
 *   把 20 页的清单塞回响应里是白搬。
 * 4. ★ 不校验"这本书做完了没有"。有些页没出图的书照样能发——引擎的语义本来
 *   就是"一页失败不等于一本书失败"（`index.ts` 接口约定 3），书里标着哪几页缺。
 *   在这里加一道闸门就等于替用户决定"缺一页就不算一本书"，而他没有要求过这件事。
 */

import type { NextRequest } from 'next/server'
import { manifestPathOf, type Book } from '@/lib/engine/index.ts'
import { createUserStore } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { assetRoot } from '@/lib/books-runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MISSING = '盘上没有这一本（也许已经在别处删掉了）。刷新一下书架看看——它多半已经不在了。'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  // ★ 2026-10-17（工单 16）：这条路原来没有登录闸——谁都能把别人的草稿翻成成品。
  //   闸门放在最前面（与别的路由同一条次序：先认人，再动盘）
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { bookId } = await params
  const store = await createUserStore(assetRoot(), guard.session.userId)
  const path = manifestPathOf(bookId)

  let book: Book | null
  try {
    book = await store.readJson<Book>(path)
  } catch {
    // 半截 JSON（进程被杀时最后写的那一件）——当作"这里没有这本书"，
    // 与 `book-source.ts` / `library.ts` 对同一件事的处理一样
    book = null
  }
  if (!book) {
    return Response.json({ code: 'book-not-found', message: MISSING }, { status: 404 })
  }

  if (book.status === 'published') {
    return Response.json({ bookId, status: 'published' })
  }

  try {
    // 展开原对象再盖一个字段：清单上还有 `cardDigest` 之类不在 `Book` 类型里的东西
    //   （那是 `runBook` 收尾写的），只挑字段重建会把它悄悄抹掉
    await store.putJson({ path, value: { ...book, status: 'published' } })
  } catch (err) {
    return Response.json(
      {
        code: 'asset-write-failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }

  return Response.json({ bookId, status: 'published' })
}
