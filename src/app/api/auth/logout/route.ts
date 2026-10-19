/**
 * `POST /api/auth/logout` —— 退出登录（BFF）
 *
 * ★ **真正的登出动作就在这一层**：把 cookie 删掉。Java 那边那条 `/api/auth/logout`
 * 只是记一笔（它一行逻辑都没有）——因为这一轮**没有 token 黑名单**：
 * 一张已经发出去的票，在 7 天之内仍然有效。
 *
 * ★ 这条代价要说两遍，因为它容易被当成 bug：docs/known-tradeoffs.md 写着一条，
 * 这里写着一条。要真撤销，需要一张"失效票"表（票号 + 过期时间，每次请求对一下），
 * 而那是下一轮的事——现在没有它，是因为"内容站 + 演示阶段"里，
 * 一张七天有效的票的风险小于多一张表、多一次查询、多一个备份对象。
 */

import { NextResponse } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'

import { clearedCookie, SESSION_COOKIE, TICKET_COOKIE } from '@/lib/auth/session.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(): Promise<NextResponse> {
  // 通知后端一声（它只记日志）。★ 失败**不影响**登出：
  // cookie 清掉之后这个人在这台浏览器上就已经不是谁了，
  // 而后端收不到那一笔通知并不改变这件事。反过来（后端不通就登不出去）才是坏的
  await backendFetch('/api/auth/logout', { method: 'POST' })

  const response = NextResponse.json({ ok: true })
  response.cookies.set(clearedCookie(SESSION_COOKIE))
  response.cookies.set(clearedCookie(TICKET_COOKIE))
  return response
}
