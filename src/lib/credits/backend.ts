/**
 * credits/backend.ts —— 扣一本、退一本：打 Java 的那两次请求
 *
 * ★ **纯的**：不碰 `cookies()`、不碰 Next。它有两个消费者，跑在两个世界里：
 *
 *   · BFF 的出图路由（经 `credits/server.ts` 转手）——带着浏览器那张票；
 *   · MCP 的 `illustrate_book`（经 `mcp/credit-port.ts`）——带着登录换来的票。
 *
 * 分成两个文件是为了这第二个消费者：`server.ts` 顶部 import 了 `next/headers`，
 * 而 `node mcp/server.mts` 是一个裸 node 进程，import 那一行就等于要求一个
 * 请求作用域（没有就炸）。★ 这一层里所有 import 都必须是相对路径——`@/` 是
 * tsconfig 的别名，node 不认识（`mcp/server.mts` 只跑得动能直接解析的那种）。
 */

import { backendFetch } from '../auth/backend.ts'
import type { Result } from '../auth/response.ts'

/**
 * 扣一本。★ 出图那一路在**所有 4xx 检查之后、真正开画之前**调它。
 *
 * 成功回 `{balance}`；不够时 Java 回 402 + `no-credits` + 那句人话，
 * 这一层原样透传（调用方决定怎么回给前端）。
 */
export async function spendOne(
  token: string,
  bookId: string,
): Promise<Result<{ balance: number }>> {
  return backendFetch<{ balance: number }>('/api/credits/spend', {
    method: 'POST',
    token,
    body: { books: 1, ref: bookId },
  })
}

/**
 * 退一本。★ 只在"这一次一页都没画出来"时调。
 *
 * Java 那边按书号把"扣过几次、退过几次"两个合计对齐（封顶在扣过的数上），
 * 所以重连、重试打两次无害；而同一本书失败两次、重试两次，两笔都退得回来。
 */
export async function refundOne(
  token: string,
  bookId: string,
): Promise<Result<{ balance: number }>> {
  return backendFetch<{ balance: number }>('/api/credits/refund', {
    method: 'POST',
    token,
    body: { books: 1, ref: bookId },
  })
}
