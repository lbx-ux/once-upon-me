/**
 * notices.ts —— 站内信：一本书画好了、或者画到一半停了，回来能看见
 *
 * ```
 *   u/<userId>/notices/book-ready-<bookId>-<毫秒时间戳>.json
 *   u/<userId>/notices/book-failed-<bookId>-<毫秒时间戳>.json
 * ```
 *
 * 为什么要有它（`docs/business.md` §9.4）：一本书的生成用时实测 12–174 分钟，
 *   付费那一刻不能要求用户守着屏幕。今天"做好了"这个信号只有两条：
 *   自己回来刷新，或者从 `/api/books/<书号>/events` 把这一轮重放一遍——
 *   两条都要求他知道"该回来看了"。而短信那条路有每天 300 条的硬顶、
 *   `User` 表里也没有 email，所以能到达用户的地址**只有这个站本身**。
 *   站内信就是"下一次打开时能看见"的那份记录。
 *
 * 一份通知一个文件，不写一份 `notices.json`
 *
 * 与 `share/store.ts` 同一条理由：一份 `notices.json` 是"读-改-写"，而写入发生在
 *   **生成结束那一刻**——两个标签页各跑一本、或者一次进程被杀后的重试，
 *   后写的那一份会把前一条悄悄抹掉。症状是"明明画好了，通知里没有"。
 *   一个文件一条记录没有这个窗口：新建是写一个新名字。
 *
 * 文件名里带时间戳，所以同一本书重做（换了主题就是另一个书号；同一份输入不会
 *   重做——`book-exists` 那道闸）不会撞名；而万一同毫秒写了两次，
 *   两次写的是同一个名字、同一份内容，覆盖是无害的。
 *
 * 记录里存书名与失败原因，不存"现在去读一下书"
 *
 * 通知是**那一刻**的事实。书后来被删了、草稿被改了，都不该让这条记录变样或读不出来。
 *   代价是书名可能过时（家长在闸门上改过书名之后才画的，这里存的是改过的那一版，
 *   因为写入发生在装订之后）。不存 owner：文件就在 `u/<userId>/` 那一片下，
 *   路径就是归属（`asset-scope.ts` 那条"前缀是归属的唯一记录"）。
 *
 * 已读是改自己那一个字段
 *
 * `readAt` 从 `null` 变成一个时间戳，改的是**这一个文件**。两个标签页同时点同一条
 *   通知，写下去的是同一个值（差几毫秒），没有需要排队的地方。
 *   "全部标为已读"是逐个改——不做批量重写，因为批量重写就是回到"一份文件"那个坏形状。
 */

import type { AssetStore } from './engine/providers/types.ts'

/** 一片之下的目录。★ 结尾那个斜杠是承重的：`list` 按前缀匹配 */
export const NOTICE_DIR = 'notices/'

/**
 * 文件名 = `<kind>-<bookId>-<13 位毫秒>`。
 *
 * 只认自己写出来的形状：目录里混进别的文件（`.DS_Store`、半截文件、上一版的格式）
 *   一律不读。书号的形状是 `[A-Za-z0-9_-]{1,128}`（`engine/index.ts` 的
 *   `BOOK_ID_SHAPE`），这里不复刻那一份正则，只按"从结尾认时间戳"来切——
 *   书号里本来就可能带连字符，从前面切会把 `book-ready-xiaoyu-r1-abc-1700` 切成两半。
 */
const NOTICE_NAME = /^(book-ready|book-failed)-([A-Za-z0-9_-]{1,128})-(\d{13})$/

export type NoticeKind = 'book-ready' | 'book-failed'

export type Notice = {
  /** 文件名去掉 `.json`。它是标记已读时的地址 */
  id: string
  kind: NoticeKind
  bookId: string
  /** 画完那一刻的书名。之后书被删了也照旧显示这一句 */
  title: string
  /** `book-failed` 时那一句人话；`book-ready` 时是空串 */
  message: string
  /** 毫秒时间戳 */
  at: number
  /** 读过的时间；`null` = 还没读 */
  readAt: number | null
}

/** 保留多久。90 天与 `reading-log` 的保留期同一个数：再久的"书做好了"没有意义 */
const KEEP_MS = 90 * 24 * 60 * 60 * 1000

/** 一次最多看多少条。老的不删，只是这一屏不翻到那么远 */
export const NOTICE_LIMIT = 60

export function noticeIdOf(kind: NoticeKind, bookId: string, at: number): string {
  return `${kind}-${bookId}-${at}`
}

/**
 * 文件名 → 路径。形状不对当场抛：这个函数只应该被 id 的产出方调用，
 *   而"路径可以由外部字符串拼出来"正是这一层最该没有的能力。
 */
export function noticePathOf(id: string): string {
  if (!NOTICE_NAME.test(id)) throw new Error(`通知 id 不合法：${id}`)
  return `${NOTICE_DIR}${id}.json`
}

/** 读回来那一份的形状。`id` 由文件名给，不从正文里信 */
function asNotice(raw: unknown, id: string): Notice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const kind = record['kind']
  if (kind !== 'book-ready' && kind !== 'book-failed') return null
  if (typeof record['bookId'] !== 'string' || typeof record['title'] !== 'string') return null
  if (typeof record['at'] !== 'number' || !Number.isFinite(record['at'])) return null
  const message = typeof record['message'] === 'string' ? record['message'] : ''
  const readAt =
    record['readAt'] === null || typeof record['readAt'] === 'number'
      ? (record['readAt'] as number | null)
      : null
  return {
    id,
    kind,
    bookId: record['bookId'],
    title: record['title'],
    message,
    at: record['at'],
    readAt,
  }
}

/**
 * 写一条通知。`at` 缺省取现在——测试传固定值，判据才可复现。
 *
 * 写失败要抛（调用方决定吞不吞）：这一层不替调用方判断"通知重不重要"。
 *   生成那一条路会吞掉它（一本书画完了，不该因为一条通知写不进去而报失败），
 *   但那是调用方的决定，不是这里的默认。
 */
export async function addNotice(
  store: AssetStore,
  input: { kind: NoticeKind; bookId: string; title: string; message?: string; at?: number },
): Promise<Notice> {
  const at = input.at ?? Date.now()
  const id = noticeIdOf(input.kind, input.bookId, at)
  const notice: Notice = {
    id,
    kind: input.kind,
    bookId: input.bookId,
    title: input.title,
    message: input.message ?? '',
    at,
    readAt: null,
  }
  await store.putJson({ path: noticePathOf(id), value: notice })
  // 清理是尽力而为：删不掉不挡这一次写入（与 `pruneShares` 同一条口径）
  await pruneNotices(store, at).catch(() => 0)
  return notice
}

export async function readNotice(store: AssetStore, id: string): Promise<Notice | null> {
  if (!NOTICE_NAME.test(id)) return null
  try {
    const raw = await store.readJson<unknown>(noticePathOf(id))
    return asNotice(raw, id)
  } catch {
    // 半截 JSON 与"没有这个文件"是同一件事：这一条现在读不出来。
    //   与 `share/store.ts` / `book-source.ts` 对坏记录的口径一致
    return null
  }
}

/**
 * 这一片里所有能读出来的通知，新的在前。
 *
 * 坏文件跳过，不让一条坏记录把整页读不出来——`list` 本身失败时回空表，
 *   与 `listShares` 同一条口径（这一屏读不出来，不该让工作台整个 500）。
 */
export async function listNotices(store: AssetStore): Promise<Notice[]> {
  const paths = await store.list(NOTICE_DIR).catch(() => [] as string[])
  const out: Notice[] = []
  for (const path of paths) {
    const name = path.slice(NOTICE_DIR.length).replace(/\.json$/, '')
    if (!NOTICE_NAME.test(name)) continue
    const one = await readNotice(store, name)
    if (one) out.push(one)
  }
  out.sort((left, right) => right.at - left.at || right.id.localeCompare(left.id))
  return out
}

export function unreadCountOf(notices: readonly Notice[]): number {
  return notices.filter((one) => one.readAt === null).length
}

/**
 * 标记一条为已读，返回改完的那一条（找不到 / 形状不对 → null）。
 *
 * 已经读过的不改 `readAt`：那是"第一次读到它"的时间。再点一次把它刷新成今天，
 *   会让"我什么时候知道的"这件事变成"我最后一次点它是什么时候"。
 */
export async function markNoticeRead(
  store: AssetStore,
  id: string,
  now = Date.now(),
): Promise<Notice | null> {
  const notice = await readNotice(store, id)
  if (!notice) return null
  if (notice.readAt !== null) return notice
  const next: Notice = { ...notice, readAt: now }
  await store.putJson({ path: noticePathOf(id), value: next })
  return next
}

/** 全部标为已读，返回这一次真的改了几条。 */
export async function markAllNoticesRead(store: AssetStore, now = Date.now()): Promise<number> {
  let changed = 0
  for (const one of await listNotices(store)) {
    if (one.readAt !== null) continue
    await store.putJson({ path: noticePathOf(one.id), value: { ...one, readAt: now } })
    changed += 1
  }
  return changed
}

/**
 * 删掉这本书的全部通知。删一本书时要调它。
 *
 * 不删的话：书没了，通知还在，点进去 404。而书号是"卡 + 形态 + 主题"的指纹，
 *   同一份表单重做一本来会得到**同一个书号**（`bookIdOf` 那段），
 *   于是旧通知会挂在一本新书上——"我明明没做这本，它怎么画好了"。
 */
export async function deleteNoticesOf(store: AssetStore, bookId: string): Promise<number> {
  let removed = 0
  for (const one of await listNotices(store)) {
    if (one.bookId !== bookId) continue
    removed += await store.deletePrefix(noticePathOf(one.id))
  }
  return removed
}

/** 清掉超过保留期的。删不掉的不抛——清理不该让写入失败 */
export async function pruneNotices(
  store: AssetStore,
  now = Date.now(),
  retainMs = KEEP_MS,
): Promise<number> {
  let removed = 0
  for (const one of await listNotices(store)) {
    if (one.at + retainMs > now) continue
    try {
      removed += await store.deletePrefix(noticePathOf(one.id))
    } catch {
      /* 下次再删 */
    }
  }
  return removed
}
