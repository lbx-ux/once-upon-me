/**
 * credits/settle.ts —— 启动时那一次对账（2026-10-30）
 *
 * 它补的是这样一种窟窿：**扣额度发生在开画之前，而一本要跑十几分钟到几小时。**
 * 这中间服务重启（部署、OOM、systemd 拉起），出图那个 Promise 随进程消失，
 * `catch` 与 `finally` 都轮不到——退款那一行根本没机会执行。账上已经 −1，
 * 盘上没有书，而用户回来只看到"没在跑"。
 *
 * 判据三条，缺一条都会退错：
 *
 * 1. **盘上没有 `book.json`**（有 = 这本书画成了，不该退）。
 * 2. **事件日志里一条 `illustration` 都没有**（有一页就不退——那几页真花过钱，
 *    这一条与出图路由上的 `pagesDrawn === 0` 是同一句话）。
 * 3. **`story.json` 还在**。★ 这一条看着多余，其实是防线：删一本书会把整个
 *    `books/<书号>/` 删掉（`book-deletion.ts` 的 `deletePrefix`），事件日志也一样。
 *    少了它，一本"画了 8 页、用户删掉、又用同一个主题重开"的书会被当成
 *    "一页都没画出来"，白退一本——而书号是"卡 + 形态 + 主题"的指纹，同号重做是常态。
 *
 * 三件事不做：
 *
 * - **不自己算账**：退多少由 Java 那段（`CreditService#settle`）按账本算，
 *   只退"这个书号扣过、还没退过"的那部分；已经结算过的回 `refunded: false`。
 *   所以这个函数跑多少次都无害，也不需要它记住跑过。
 * - **不抛**：启动期的一个异常不该让服务起不来。失败的书记进 `failed`，留一行日志。
 * - **不猜用户在不在线**：它退的是"上一轮没结算"，与此刻有没有人在用这台机器无关。
 *
 * ★ 跨进程那条边界的说明：本进程启动时，同机的另一个 Next 进程可能正在画同一本书
 * （开发机上就有这种局面）。那种情况下这里会把"别人正在画"当成"没人画成"退掉。
 * 判据 2 挡住了大部分（正在画的书日志里已经有 illustration 了），剩下的是
 * "刚扣完、第一页还没落盘"那几秒的窗口。单进程部署下不存在；多进程部署要另想办法，
 * 这一条写进 `docs/known-tradeoffs.md`，不假装解决了。
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { createUserStore, userSliceRoot } from '@/lib/asset-scope.ts'
import { backendFetch } from '@/lib/auth/backend.ts'
import { assetRoot, bookExists } from '@/lib/books-runtime.ts'
import { createFsEventLog } from '@/lib/event-log.ts'
import { storyPathOf } from '@/lib/story-draft.ts'

/** 一个书号的处理结果。三态，不是布尔：`none` 与 `failed` 的差别是"没事"与"没办成" */
export type SettleOne = (userId: string, bookId: string) => Promise<'refunded' | 'none' | 'failed'>

export type SettleReport = {
  /** 扫了几个 userId 的资产片 */
  users: number
  /** 有多少本书落进了"该看一眼"这一档（满足三条判据） */
  books: number
  /** 其中真退回来几本 */
  refunded: number
  /** 其中几本没办成（后端没通、账本拒绝…） */
  failed: number
}

export type SettleOptions = {
  /** 资产根。缺省走 `assetRoot()`（`ASSET_ROOT` / `.out/web`） */
  root?: string
  /** 打一次内部对账端点。★ 注入是为了能测：这一层不该知道 HTTP 长什么样 */
  settleOne?: SettleOne
  /** 每个用户切片失败时不抛，记一行 */
  note?: (line: string) => void
}

/** 默认那一条：打 Java 的 `/api/internal/credits/settle`（走 `X-Internal-Token`） */
const settleOverHttp: SettleOne = async (userId, bookId) => {
  const result = await backendFetch<{ refunded: boolean; balance: number }>(
    '/api/internal/credits/settle',
    { method: 'POST', body: { userId: Number(userId), ref: bookId } },
  )
  if (!result.ok) return 'failed'
  return result.data?.refunded === true ? 'refunded' : 'none'
}

export async function settleOrphanBooks(options: SettleOptions = {}): Promise<SettleReport> {
  const root = options.root ?? assetRoot()
  const settleOne = options.settleOne ?? settleOverHttp
  const note = options.note ?? (() => undefined)
  const report: SettleReport = { users: 0, books: 0, refunded: 0, failed: 0 }

  for (const userId of await userIdsUnder(root, note)) {
    report.users += 1
    try {
      await settleSlice(root, userId, settleOne, report)
    } catch (err) {
      // 一个用户的切片读不动，不该挡住其余的人
      note(`对账：u/${userId} 这一片读不动（${err instanceof Error ? err.message : String(err)}）`)
      report.failed += 1
    }
    /* ★ 连着三本都没办成、又一本都没退成 ⇒ 多半是后端没通。
       这时候继续扫只是把 8 秒的超时乘上书的数量，所以停手并说一声。 */
    if (report.failed >= 3 && report.refunded === 0) {
      note(`对账：连着 ${report.failed} 本都没办成，后端大概没通——这次先不扫了`)
      break
    }
  }
  return report
}

async function settleSlice(
  root: string,
  userId: string,
  settleOne: SettleOne,
  report: SettleReport,
): Promise<void> {
  const store = await createUserStore(root, userId)
  const log = await createFsEventLog(userSliceRoot(root, userId))

  // 只认 `books/<书号>/…` 里第一段是书号的那些路径（`store.list` 回的是相对路径）
  const bookIds = new Set<string>()
  for (const path of await store.list('books/')) {
    const bookId = path.split('/')[1]
    if (bookId !== undefined && bookId !== '') bookIds.add(bookId)
  }

  for (const bookId of bookIds) {
    // 同一个账号下也可能有一堆书：停手的判据要在这一层也看一眼
    if (report.failed >= 3 && report.refunded === 0) return
    if (await bookExists(store, bookId)) continue // 判据 1：画成了
    if (!(await store.exists(storyPathOf(bookId)))) continue // 判据 3：删过的书没有证据
    const { events } = await log.read(bookId)
    if (events.some((event) => event.kind === 'illustration')) continue // 判据 2

    report.books += 1
    const outcome = await settleOne(userId, bookId)
    if (outcome === 'refunded') {
      report.refunded += 1
      continue
    }
    if (outcome === 'failed') {
      report.failed += 1
      continue
    }
    // `none` = 这本书没扣过额度、或者上一轮已经结算过。两种情况都是常态，不记日志
  }
}

/** `u/` 下面那几个数字目录。★ 不是数字的一律跳过：userId 就是数字，别的都是别的什么 */
async function userIdsUnder(root: string, note: (line: string) => void): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(root, 'u'), { withFileTypes: true })
  } catch {
    // 资产根还不存在（全新部署、或本地还没跑过）：这不是错，是"没有可对账的"
    return []
  }
  const ids = entries
    .filter((one) => one.isDirectory() && /^\d+$/.test(one.name))
    .map((o) => o.name)
  if (ids.length === 0) note('对账：u/ 下面没有数字目录，跳过')
  return ids.sort()
}
