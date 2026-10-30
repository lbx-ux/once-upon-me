/**
 * credits/client.ts —— 浏览器那一侧的额度请求（有余额、兑换、管理页发码）
 *
 * 与 `admin/client.ts` 同一条纪律：打的是同源的 BFF，不是 Java 那个地址。
 * 失败一律带一句能直接显示的话，上层不自己编文案——403 与 500 的下一步完全不同，
 * 而那句话只有服务端说得准。
 *
 * ★ 发码那条的响应里有**明文码**。它只在这一次响应里存在：这一层把它交给界面
 *   立刻渲染成 CSV，不写 localStorage、不写模块级变量、不进日志。
 */

import { readResult, unreachable, type Result } from '@/lib/auth/response.ts'
import {
  parseAdminCreditOverview,
  parseCodeBatchResult,
  parseCreditView,
  parseRedeemOutcome,
  type AdminCreditOverview,
  type CodeBatchResult,
  type CreditView,
  type RedeemOutcome,
} from './state.ts'

export type CreditsFail = { ok: false; message: string; status: number }
export type CreditsOk<T> = { ok: true; data: T }
type Outcome<T> = CreditsOk<T> | CreditsFail

async function call<T>(path: string, init: RequestInit): Promise<Result<T>> {
  let response: Response
  try {
    response = await fetch(path, { cache: 'no-store', ...init })
  } catch (err) {
    return unreachable(err instanceof Error ? err.message : String(err))
  }
  return readResult<T>(response)
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }
}

/* ── 用户 ─────────────────────────────────────────────────────────────── */

export async function fetchCreditView(): Promise<Outcome<CreditView>> {
  const result = await call<unknown>('/api/credits', { method: 'GET' })
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  const view = parseCreditView(result.data)
  if (!view) {
    return { ok: false, message: '服务端回的额度不是我们认识的形状，刷新一次试试', status: 200 }
  }
  return { ok: true, data: view }
}

/** 兑换一张码。★ 失败那句是服务端给的（三种失败同一句），这一层不改写 */
export async function redeemCode(code: string): Promise<Outcome<RedeemOutcome>> {
  const result = await call<unknown>('/api/credits/redeem', json('POST', { code }))
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  const outcome = parseRedeemOutcome(result.data)
  if (!outcome) {
    return { ok: false, message: '兑换成功了，但服务端回的结果读不出来，刷新看看余额', status: 200 }
  }
  return { ok: true, data: outcome }
}

/* ── 管理页 ───────────────────────────────────────────────────────────── */

export async function fetchAdminCredits(): Promise<Outcome<AdminCreditOverview>> {
  const result = await call<unknown>('/api/admin/credits', { method: 'GET' })
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  const overview = parseAdminCreditOverview(result.data)
  if (!overview) {
    return { ok: false, message: '服务端回的额度表不是我们认识的形状，刷新一次试试', status: 200 }
  }
  return { ok: true, data: overview }
}

export type IssueCodesInput = {
  batch: string
  count: number
  booksPerCode: number
  expiresInDays: number
  note: string
}

/**
 * 生成一批码。★ 返回值里的 `codes` 是明文，调用方必须当场给下载入口——
 * 刷新一下就没有了，库里查不回来。
 */
export async function issueCodes(input: IssueCodesInput): Promise<Outcome<CodeBatchResult>> {
  const result = await call<unknown>('/api/admin/credits/codes', json('POST', input))
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  const batch = parseCodeBatchResult(result.data)
  if (!batch) {
    return { ok: false, message: '码生成出来了，但服务端回的结果读不出来', status: 200 }
  }
  return { ok: true, data: batch }
}

/** 给一个人补几本 */
export async function grantCredits(
  userId: string,
  books: number,
  note: string,
): Promise<Outcome<{ balance: number }>> {
  const result = await call<unknown>(
    '/api/admin/credits/grant',
    json('POST', { userId: Number(userId), books, note }),
  )
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  const balance =
    result.data && typeof result.data === 'object' && 'balance' in result.data
      ? Number((result.data as { balance: unknown }).balance)
      : NaN
  if (!Number.isFinite(balance)) {
    return { ok: false, message: '补发完了，但服务端回的余额读不出来', status: 200 }
  }
  return { ok: true, data: { balance } }
}
