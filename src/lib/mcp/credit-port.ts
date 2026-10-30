/**
 * mcp/credit-port.ts —— MCP 那条路上"花钱那一关"：用谁的身份扣、扣在哪本书上
 *
 * ★ 为什么要有这个文件：`illustrate_book` 原来直接调引擎，绕开了 BFF 路由上那一次
 * 扣减——它是一条**能白嫖的路**（`docs/known-tradeoffs.md` 里记着）。
 * 现在这一关补上了，判据与网页那条一模一样：开画之前扣一本，一页都没画出来就退。
 *
 * 四条决定：
 *
 * 1. **身份来自账号口令，不来自一张手抄的票。** MCP 没有登录，而扣额度必须要一张
 *    会话票。两条路里选了"用 `MCP_ACCOUNT` / `MCP_PASSWORD` 现登"：票 7 天就过期，
 *    剪一张贴进 `.env.local` 的做法在第八天会变成一个只有自己看得懂的 401。
 *    口令与模型密钥同一个落点、同一条纪律（`.env.local`，永不入库）。
 * 2. **登录回来的人必须就是 `--user` 那一个人。** 不是的话直接拒：那意味着
 *    "花 A 的额度、往 B 的目录里画"，而这两个都看不出来。
 * 3. **票缓存，401 了重登一次。** 一个进程能活几小时；7 天到期的票在与后端
 *    聊到一半时失效是正常的，不该让用户去重启进程。
 * 4. **失败不抛，返回 `Result`。** 与 `lib/auth/backend.ts` 同一条：
 *    工具那一层要把这句话原样喂回模型（`tools.ts` 文件头第 3 条）。
 *
 * ★ 这一层只给 `--mode=live` 用。`stub` / `offline` 出的图不花钱，
 *   那两档不扣额度——与"这两档不进任何供应商的账"是同一条口径。
 */

import type { Failure, Result } from '../auth/response.ts'
import { backendFetch } from '../auth/backend.ts'
import { refundOne, spendOne } from '../credits/backend.ts'

/** MCP 那一侧要的两件事。★ 注入进 `ToolContext`，这一层因此可以被测 */
export type CreditPort = {
  /** 开画之前扣一本。不 ok 就不许开画 */
  spend: (bookId: string) => Promise<Result<{ balance: number }>>
  /** 一页都没画出来时退一本 */
  refund: (bookId: string) => Promise<Result<{ balance: number }>>
}

export type CreditPortOptions = {
  /** 登录名（手机号或演示账号的 123456） */
  account: string
  password: string
  /** `--user` 那一个（不带 `u/` 前缀） */
  userId: string
}

type Session = { token: string; userId: string }

/** 不是后端回的话，是我们自己这一侧的判据没过。`status: 0` = 没有状态码 */
function denied(code: string, message: string): Failure {
  return { ok: false, status: 0, code, message }
}

export function createCreditPort(opts: CreditPortOptions): CreditPort {
  let session: Session | null = null

  async function signIn(): Promise<Result<Session>> {
    if (session) return { ok: true, data: session }
    const res = await backendFetch<unknown>('/api/auth/login', {
      method: 'POST',
      body: { account: opts.account, password: opts.password },
    })
    if (!res.ok) return res

    const parsed = sessionOf(res.data)
    if (!parsed) {
      return denied('bad-login', '登录回来的响应不是一个认识的形状（缺 token 或 userId）')
    }
    if (parsed.userId !== opts.userId) {
      return denied(
        'wrong-user',
        `登录的是账号 ${opts.account}（userId ${parsed.userId}），而这一轮 --user=${opts.userId}。` +
          '两个人的话，额度会从一个人身上扣、书画进另一个人的目录——先让两者对上再跑。',
      )
    }
    session = parsed
    return { ok: true, data: parsed }
  }

  /** 登一次（或复用）、打一发；401 = 票过期，清掉重登再打一次 */
  async function withSession<T>(run: (token: string) => Promise<Result<T>>): Promise<Result<T>> {
    const first = await signIn()
    if (!first.ok) return first

    const result = await run(first.data.token)
    if (!result.ok && result.status === 401) {
      session = null
      const again = await signIn()
      if (!again.ok) return again
      return run(again.data.token)
    }
    return result
  }

  return {
    spend: (bookId) => withSession((token) => spendOne(token, bookId)),
    refund: (bookId) => withSession((token) => refundOne(token, bookId)),
  }
}

/** `POST /api/auth/login` 回的 `{token, user:{userId, …}}` */
function sessionOf(payload: unknown): Session | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const token = typeof record['token'] === 'string' ? record['token'] : ''
  const user = record['user']
  const userId =
    user && typeof user === 'object' ? (user as Record<string, unknown>)['userId'] : undefined
  if (token === '' || typeof userId !== 'string' || userId === '') return null
  return { token, userId }
}
