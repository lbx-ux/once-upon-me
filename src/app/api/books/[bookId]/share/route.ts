/**
 * /api/books/[bookId]/share —— 发给家人的那条只读链接（2026-10-29）
 *
 * ```
 *   POST   /api/books/<bookId>/share   { days?: number } → { token, url, expiresAt }
 *   GET    /api/books/<bookId>/share                    → { active, expiresAt }
 *   DELETE /api/books/<bookId>/share                    → { revoked }
 * ```
 *
 * 五条判断
 *
 * 1. **一次只留一条活链接。** `POST` 会先把这本书已有的活链接收回，再签新的。
 *    这不是偷懒：记录里只有哈希（`token.ts` 文件头第 4 条），旧票原文早就不在盘上，
 *    所以"再给我看一眼上次那条"这件事**做不到**。与其让家长手里攒着三条不知道
 *    哪条还有效的链接，不如"发一条新的 = 旧的作废"，界面上也只显示最新那条。
 *    先签新的、再收旧的：签失败（磁盘满、没配密钥）时旧链接还在，不会落空。
 *
 * 2. **链接只回一次。** 响应里有 `token`，盘上没有。刷新页面之后书架只知道
 *    "已分享、X 月 X 日到期"；要再拿到一条就重新生成（旧的那条随之作废）。
 *    这是哈希存储的直接后果，界面上必须这么说（`ShelfDashboard` 那个弹窗）。
 *
 * 3. **过期按天给，上限 90。** 缺省 30 天。下限 1 天：家长要"今晚给爷爷奶奶看"
 *    时用一个 1 天的链接，比记住去收回更可靠。
 *
 * 4. **只认自己那一片里的书，而且只认已经画完的。** 判据是清单文件在不在 +
 *    `isDraft`（`engine/domain.ts` 那唯一一处）。草稿在书架上不出现「分享」，
 *    服务端也要挡——界面那颗按钮不是判据，同一句话在 `publish` 那条路上写过一遍。
 *
 * 5. **收回是"改一个字段"，不是删文件。** 删了就看不出这条链接曾经存在过；
 *    保留超过 30 天之后由 `pruneShares` 清掉（签发新链接时顺手做，尽力而为）。
 *
 * 6. **同一账号的签发/收回排队走。** 两个标签页同时点「生成链接」会各写一条记录、
 *    再各自"收回除我以外的"——互把对方收回，两边都回成功而盘上一条活的都没有。
 *    锁在 `withUserLock` 里，键挂在 `globalThis` 上（dev 下每个 Route Handler
 *    各自实例化，模块级变量不跨实例共享；`books-runtime.ts` 为同一件事付过学费）。
 */

import type { NextRequest } from 'next/server'

import { createUserStore } from '@/lib/asset-scope.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { isBookId, isDraft, manifestPathOf, type Book } from '@/lib/engine/index.ts'
import { originFromHeaders, shareUrlOf } from '@/lib/share/access.ts'
import {
  activeSharesOf,
  pruneShares,
  putShare,
  revokeSharesOf,
  shareStateOf,
  type ShareRecord,
} from '@/lib/share/store.ts'
import { shareSecret, signShareToken } from '@/lib/share/token.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 30
const MAX_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
const MISSING = '书架上没有这一本（也许已经删了）。刷新一下书架看看。'

function fail(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status })
}

/** 把 `{ days }` 收成一个合法天数。不是数字、越界、缺省，一律落到缺省值 */
function daysOf(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_DAYS
  const days = Math.floor(raw)
  return Math.min(MAX_DAYS, Math.max(1, days))
}

/**
 * 同一个账号的签发/收回排队走。见 `POST` 里那段：两个标签页同时点会互把对方收回。
 *
 * 键挂在 `globalThis` 上而不是模块级变量：dev 下每个 Route Handler 各自编译、
 *   各自实例化（`books-runtime.ts` 为同一件事付过一次学费），模块级变量不跨实例共享。
 */
const LOCKS = Symbol.for('once-upon-me.share-locks')

function locks(): Map<string, Promise<void>> {
  const host = globalThis as typeof globalThis & { [LOCKS]?: Map<string, Promise<void>> }
  host[LOCKS] ??= new Map<string, Promise<void>>()
  return host[LOCKS]
}

async function withUserLock<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const map = locks()
  const previous = map.get(userId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  // 下一个人的 `previous` 是这一串（它在 `release()` 之后才 resolve），
  //   所以后来的人一定等在前一个人 `run()` 结束之后
  const queued = previous.then(() => gate)
  map.set(userId, queued)
  await previous.catch(() => undefined)
  try {
    return await run()
  } finally {
    release()
    if (map.get(userId) === queued) map.delete(userId)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  if (!shareSecret()) {
    // 与登录那条同一条纪律：服务端没配好，不是"这个人没权限"
    return fail(
      500,
      'share-misconfigured',
      '服务端没配 APP_JWT_SECRET / SHARE_SECRET，签不了分享链接',
    )
  }

  const { bookId } = await params
  if (!isBookId(bookId)) return fail(404, 'book-not-found', MISSING)

  /**
   * ★ 同一账号的签发/收回排队走（2026-10-29 复查补的）。
   *
   * 不排的话有一个真会撞上的坏法：两个标签页同时点「生成链接」，
   *   A 写了自己的记录、B 也写了自己的；然后两边各自"收回除我以外的活链接"
   *   ——**互把对方收回**，两个响应都说成功，盘上一条活的都没有。
   * 界面上的按钮会按灰，但两个标签页/一次网络重试绕得过那颗按钮；
   *   判据不能建立在"用户不会同时点"上。
   */
  const body = (await req.json().catch(() => null)) as { days?: unknown } | null
  return withUserLock(guard.session.userId, () =>
    issue(bookId, guard.session.userId, req.headers, body),
  )
}

/** `POST` 的正文，已经在锁里。 */
async function issue(
  bookId: string,
  userId: string,
  headers: Headers,
  body: { days?: unknown } | null,
): Promise<Response> {
  const store = await createUserStore(assetRoot(), userId)

  // 读清单：既判"有没有这一本"，也判"画完了没有"。两个判据都在盘上那份文件里，
  //   不另抄一遍（`isDraft` 是唯一的那一处，见 `engine/domain.ts`）
  const book = await store.readJson<Book>(manifestPathOf(bookId)).catch(() => null)
  if (!book || typeof book !== 'object') return fail(404, 'book-not-found', MISSING)
  if (isDraft(book)) {
    // 与书架那颗按钮同一个口径：草稿不出现「分享」。服务端不能只靠界面那一层挡
    return fail(409, 'book-not-ready', '这本还没画完。先点「制作为绘本」，再发给家人。')
  }

  const expiresAt = Date.now() + daysOf(body?.days) * DAY_MS

  let signed: ReturnType<typeof signShareToken>
  try {
    signed = signShareToken({ userId, bookId, expiresAt })
  } catch (err) {
    return fail(500, 'share-sign-failed', err instanceof Error ? err.message : String(err))
  }

  const record: ShareRecord = {
    bookId,
    createdAt: Date.now(),
    expiresAt: signed.expiresAt,
    revokedAt: null,
  }

  // 先签新的（上面已经签完），再写记录、再收旧的：见文件头第 1 条
  try {
    await putShare(store, signed.hash, record)
  } catch (err) {
    return fail(500, 'share-write-failed', err instanceof Error ? err.message : String(err))
  }

  const now = Date.now()
  for (const one of await activeSharesOf(store, bookId, now)) {
    if (one.hash === signed.hash) continue
    await putShare(store, one.hash, { ...one.record, revokedAt: now }).catch(() => undefined)
  }
  // 清理是尽力而为：删不掉不挡这一次签发（`pruneShares` 的文件头）
  await pruneShares(store, now).catch(() => 0)

  const origin = originFromHeaders(headers)
  return Response.json({
    token: signed.token,
    url: shareUrlOf(origin, signed.token),
    expiresAt: signed.expiresAt,
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { bookId } = await params
  if (!isBookId(bookId)) return fail(404, 'book-not-found', MISSING)

  const store = await createUserStore(assetRoot(), guard.session.userId)
  return Response.json(await shareStateOf(store, bookId))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> },
): Promise<Response> {
  const guard = await requireCapability(req, [])
  if (!guard.ok) return guard.response

  const { bookId } = await params
  if (!isBookId(bookId)) return fail(404, 'book-not-found', MISSING)

  // 与 POST 同一把锁：收回与签发同时来的时候，"收回全部"不该把刚发出去的那条漏掉
  return withUserLock(guard.session.userId, async () => {
    const store = await createUserStore(assetRoot(), guard.session.userId)
    return Response.json({ revoked: await revokeSharesOf(store, bookId) })
  })
}
