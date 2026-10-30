/**
 * /api/notices —— 站内信：读、标已读、清空（2026-10-30）
 *
 * ```
 *   GET    /api/notices            → { unread, items }
 *   GET    /api/notices?count=1    → { unread }          ← 侧栏那颗红点只问这一个数
 *   POST  { id }                   → { unread }          ← 标一条已读
 *   POST  { all: true }            → { unread }          ← 全标已读
 *   DELETE                         → { removed, unread }  ← 清空（整片删）
 * ```
 *
 * 五条判断
 *
 * 1. **只要登录，不要任何能力。** 看"我的书好了没有"与权限那一位无关：
 *    权限收回去之后，手上已经做好的书还在书架上、也还读得到（`/shelf` 同一条口径）。
 *    这里要 `[]` 而不是 `['text']`，否则一个只读的家长会连通知都打不开。
 *
 * 2. **列表最多回 `NOTICE_LIMIT` 条**，但未读数是按**全部**算的。
 *    两个数来自同一次 `listNotices`：分两次读会出现"红点说 3、列表里只有 0 条"
 *    （保留期清理正好卡在两次读之间），而那个形状没人解释得清。
 *
 * 3. **标已读是幂等的。** 同一个 id 打两次，第二次不改时间（`markNoticeRead` 那段）。
 *    客户端用 `keepalive` 发这一下再跳转（点一条通知就去读那本书），
 *    所以"请求有没有到"与"跳转有没有发生"是两件独立的事——重复到达必须无害。
 *
 * 4. **`POST` 只认 `id` 与 `all`，别的一概不读。** 没有"标某本书的全部"这种入口：
 *    那需要书号 → 通知的反查，而通知列表本来就不长；多一个入口就多一处
 *    与"删一本书要删它全部通知"（`deleteNoticesOf`）重叠的语义。
 *
 * 5. **清空是 `DELETE`，不是 `POST { clear: true }`。** 它与"标已读"不是同一种改动：
 *    一个是改字段、一个是**让文件不再存在**，而且它删的是整片（连一屏之外、
 *    连读不出来的那些一起）。方法与后果对得上，路径上也就不用再解释"all 与 clear 谁先"。
 *    回报的 `removed` 是 `deletePrefix` **真删掉的条数**（`clearNotices` 那段）；
 *    `unread` 在删完**重新数一次**：正好有另一个标签页在画、并发写进来一条时，
 *    红点该按新的那一份亮，而不是按这一次删完的空目录想当然地回 0。
 */

import type { NextRequest } from 'next/server'

import { createUserStore } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import {
  clearNotices,
  listNotices,
  markAllNoticesRead,
  markNoticeRead,
  NOTICE_LIMIT,
  unreadCountOf,
} from '@/lib/notices.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status })
}

export async function GET(req: NextRequest): Promise<Response> {
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const store = await createUserStore(assetRoot(), guard.session.userId)
  const all = await listNotices(store)
  const unread = unreadCountOf(all)

  // 侧栏那颗红点只问这一个数：不回列表，省掉一份它用不上的载荷
  if (req.nextUrl.searchParams.get('count') === '1') {
    return Response.json({ unread })
  }
  return Response.json({ unread, items: all.slice(0, NOTICE_LIMIT) })
}

export async function POST(req: NextRequest): Promise<Response> {
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const body = (await req.json().catch(() => null)) as { id?: unknown; all?: unknown } | null
  const store = await createUserStore(assetRoot(), guard.session.userId)

  if (body?.all === true) {
    await markAllNoticesRead(store)
    return Response.json({ unread: unreadCountOf(await listNotices(store)) })
  }

  if (typeof body?.id !== 'string' || body.id === '') {
    return fail(400, 'bad-request', '要么给一个 id，要么给 all: true')
  }
  const one = await markNoticeRead(store, body.id)
  if (!one) return fail(404, 'notice-not-found', '这条通知不在了（也许已经被清掉了）')
  return Response.json({ unread: unreadCountOf(await listNotices(store)) })
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const store = await createUserStore(assetRoot(), guard.session.userId)
  const removed = await clearNotices(store)
  return Response.json({ removed, unread: unreadCountOf(await listNotices(store)) })
}
