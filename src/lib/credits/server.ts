/**
 * credits/server.ts —— Next 这一侧读额度；扣与退从这里转手到 `backend.ts`
 *
 * 三条判断：
 *
 * 1. **读不到就回 `null`，不抛。** 个人主页与创作页照常渲染，只是那一格显示
 *    「—」。这与 `currentUserId()` 的"判不出来就回 null"是同一条：
 *    额度读不出来不该让整页 500，那是"这一格坏了"，不是"这个人坏了"。
 * 2. **扣与退返回 `Result`，由调用方决定怎么回。** 出图那一路要拿到 402 的
 *    code 与 message 原样回给浏览器（`no-credits` 是界面分支的依据），
 *    所以那一层不把它变成一句本地文案。
 * 3. **读的那几个票是从 cookie 里拿的，不是参数传进来的。** 与 `admin/server.ts`
 *    同一条：服务端组件手上只有 `cookies()`，没有 request。
 *    ★ 而扣与退**收了参数票**（`backend.ts`）：它们还有第二个消费者——MCP，
 *    那边没有 cookie，票是登录换来的。
 */

import { cookies } from 'next/headers'

import { backendFetch } from '@/lib/auth/backend.ts'
import { SESSION_COOKIE } from '@/lib/auth/session.ts'
import {
  parseAdminCreditOverview,
  parseCreditView,
  type AdminCreditOverview,
  type CreditView,
} from './state.ts'

/** 服务端组件那一侧：这个人还剩几本 + 最近几十笔。未登录 / 读不到 → `null` */
export async function readCreditView(): Promise<CreditView | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const result = await backendFetch<unknown>('/api/credits', { method: 'GET', token })
  if (!result.ok) return null
  return parseCreditView(result.data)
}

/** 只要一个数。读不到 → `null`（界面显示「—」，不是 0） */
export async function readBalance(): Promise<number | null> {
  const view = await readCreditView()
  return view === null ? null : view.balance
}

/** 管理页那一张卡。★ 与 `readOverview` 分开：额度读不出来不该让整张用户表消失 */
export type AdminCreditsResult =
  { kind: 'ok'; overview: AdminCreditOverview } | { kind: 'error'; message: string }

export async function readAdminCredits(): Promise<AdminCreditsResult> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return { kind: 'error', message: '没登录' }
  const result = await backendFetch<unknown>('/api/admin/credits', { method: 'GET', token })
  if (!result.ok) return { kind: 'error', message: result.message }
  const overview = parseAdminCreditOverview(result.data)
  if (!overview) return { kind: 'error', message: '服务端回的额度表不是我们认识的形状' }
  return { kind: 'ok', overview }
}

/**
 * 扣一本 / 退一本。★ 实现在 `backend.ts`（那里不碰 `next/headers`，MCP 也能用）。
 *
 * 这里只是转个手：出图那条路由从本文件 import，是因为它同时还要
 * `readCreditView` 那几个读的；而读的要 `cookies()`，只能在 Next 里跑。
 */
export { refundOne, spendOne } from './backend.ts'
