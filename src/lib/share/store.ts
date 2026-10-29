/**
 * share/store.ts —— 分享票的账本：签发过哪几条、哪一条被收回了
 *
 * 一份记录一个文件：`u/<userId>/shares/<sha256(token)>.json`。
 *
 * 为什么不是一张 `shares.json`：那是一份"读-改-写"。两个人同时点「发链接」
 *   （或者同一本在两个标签页里各点一次）时，后写的那一份会把前一条悄悄抹掉——
 *   而症状是"我明明发过一条，收回列表里没有它"。一个文件一条记录没有这个窗口：
 *   新建是写一个新名字，收回是改自己那一个名字。
 *
 * 为什么用 sha256(token) 当文件名：见 `token.ts` 文件头第 4 条——盘上不存票原文。
 *   文件名同时是"这张票签发过没有"的判据：验过的票算出一个哈希，读不到文件就是
 *   没签发过（或者早被清掉了），一律当无效。
 *
 * 记录里**不存 owner**：文件本来就在 `u/<userId>/` 那一片下，路径就是归属——
 *   与 `asset-scope.ts` 那条"前缀是归属的唯一记录"同一条纪律。多存一个字段
 *   就多一个会与被读的那一片不一致的字段。
 */

import type { AssetStore } from '../engine/providers/types.ts'

export const SHARE_DIR = 'shares/'
/** 文件名 = 64 位十六进制。不符合这个名字的一律不读（目录里混进别的文件时也不炸） */
const HASH_NAME = /^[0-9a-f]{64}$/

export type ShareRecord = {
  bookId: string
  /** 毫秒时间戳 */
  createdAt: number
  expiresAt: number
  /** 收回时间；null = 还活着。收回不删文件：删了就看不出"这条链接曾经存在过" */
  revokedAt: number | null
}

export function sharePathOf(hash: string): string {
  if (!HASH_NAME.test(hash)) throw new Error(`分享哈希不合法：${hash}`)
  return `${SHARE_DIR}${hash}.json`
}

export function isShareActive(record: ShareRecord, now = Date.now()): boolean {
  return record.revokedAt === null && record.expiresAt > now
}

export async function putShare(
  store: AssetStore,
  hash: string,
  record: ShareRecord,
): Promise<void> {
  await store.putJson({ path: sharePathOf(hash), value: record })
}

export async function readShare(store: AssetStore, hash: string): Promise<ShareRecord | null> {
  if (!HASH_NAME.test(hash)) return null
  try {
    const record = await store.readJson<ShareRecord>(sharePathOf(hash))
    if (!record || typeof record.bookId !== 'string') return null
    if (typeof record.expiresAt !== 'number' || typeof record.createdAt !== 'number') return null
    if (record.revokedAt !== null && typeof record.revokedAt !== 'number') return null
    return record
  } catch {
    // 半截 JSON（进程被杀时最后写的那一件）与"没有这个文件"是同一件事：
    //   这张票现在不能用。与 `book-source.ts` 对坏清单的口径一致
    return null
  }
}

/** 这一片里所有能读出来的记录。坏文件跳过，不因为一条坏记录让整页读不出来 */
export async function listShares(
  store: AssetStore,
): Promise<{ hash: string; record: ShareRecord }[]> {
  const paths = await store.list(SHARE_DIR).catch(() => [] as string[])
  const out: { hash: string; record: ShareRecord }[] = []
  for (const path of paths) {
    const name = path.slice(SHARE_DIR.length).replace(/\.json$/, '')
    if (!HASH_NAME.test(name)) continue
    const record = await readShare(store, name)
    if (record) out.push({ hash: name, record })
  }
  return out
}

/** 这本书还活着的那几条。签发新链接时要先把它们收回，所以调用方通常只关心长度 */
export async function activeSharesOf(
  store: AssetStore,
  bookId: string,
  now = Date.now(),
): Promise<{ hash: string; record: ShareRecord }[]> {
  return (await listShares(store)).filter(
    (one) => one.record.bookId === bookId && isShareActive(one.record, now),
  )
}

/** 书架要的那个数：这本书有没有活着的链接、最晚什么时候到期 */
export async function shareStateOf(
  store: AssetStore,
  bookId: string,
  now = Date.now(),
): Promise<{ active: boolean; expiresAt: number | null }> {
  const active = await activeSharesOf(store, bookId, now)
  if (active.length === 0) return { active: false, expiresAt: null }
  return {
    active: true,
    expiresAt: Math.max(...active.map((one) => one.record.expiresAt)),
  }
}

/** 整片一次读完，给书架那一屏用：`{ 书号: 最晚到期 }`。没有活链接的书不在表里 */
export async function shareStatesOf(
  store: AssetStore,
  now = Date.now(),
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const { record } of await listShares(store)) {
    if (!isShareActive(record, now)) continue
    out[record.bookId] = Math.max(out[record.bookId] ?? 0, record.expiresAt)
  }
  return out
}

/**
 * 收回这本书的全部活链接，返回收回了几条。
 *
 * 已收回的不重复写（`revokedAt` 保留第一次的时间）：收回是"从这一刻起不认了"，
 *   再点一次不该把那个时间改成今天。
 */
export async function revokeSharesOf(
  store: AssetStore,
  bookId: string,
  now = Date.now(),
): Promise<number> {
  let revoked = 0
  for (const { hash, record } of await listShares(store)) {
    if (record.bookId !== bookId || record.revokedAt !== null) continue
    await putShare(store, hash, { ...record, revokedAt: now })
    revoked += 1
  }
  return revoked
}

/**
 * 删掉这本书的**全部**分享记录（活着的、过期的、收回过的都删）。
 *
 * 删一本书时要调它（`book-deletion.ts`）。不调会有一个很安静的坏法：
 *   书删了，记录还在；书号是"卡 + 主题"的指纹，同一份表单重做一次就得到**同一个书号**
 *   ——于是那条早就发出去的链接在新建的书上**又活过来**（如果还没到期）。
 *   用户看到的是"我删过的书，家里人还能点开"。
 *
 * 这里用删而不是"全部收回"：书都没了，留一条"已收回"的记录只会在
 *   下一次同号重建时被误读成"这本书曾经分享过"。
 */
export async function deleteSharesOf(store: AssetStore, bookId: string): Promise<number> {
  let removed = 0
  for (const { hash, record } of await listShares(store)) {
    if (record.bookId !== bookId) continue
    removed += await store.deletePrefix(sharePathOf(hash))
  }
  return removed
}

/**
 * 清掉早就不该再被翻出来的记录：过期或收回超过 `retainMs` 的。
 *
 * 保留一段而不是立刻删，是为了"这条链接什么时候没的"还能查（排障与解释用）。
 * 返回删了几条；删除失败不抛——清理是尽力而为，不该让签发链接失败。
 */
export async function pruneShares(
  store: AssetStore,
  now = Date.now(),
  retainMs = 30 * 24 * 60 * 60 * 1000,
): Promise<number> {
  let removed = 0
  for (const { hash, record } of await listShares(store)) {
    const deadAt = record.revokedAt ?? record.expiresAt
    if (deadAt + retainMs > now) continue
    try {
      removed += await store.deletePrefix(sharePathOf(hash))
    } catch {
      /* 删不掉就下次再删 */
    }
  }
  return removed
}
