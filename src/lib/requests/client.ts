/**
 * requests/client.ts —— 权限申请那四条请求（**只在浏览器里跑**）
 *
 * ★ 与 `lib/admin/client.ts`、`lib/auth/client.ts` 同一条纪律：打的是**同源的 BFF**
 *   （`/api/permission-requests/*`、`/api/admin/requests`），不是 Java 那个地址。
 *   理由写在 `auth/client.ts` 里那段（后端地址不进浏览器、票在 httpOnly cookie 里、
 *   跨源就没有 cookie）——对这几条一字不差地成立。
 *
 * ★ 失败一律带一句能直接显示的话（`AdminFail` 里那个 `message`），上层不自己编文案：
 *   这里唯一有判别力的事是「一样都没勾」（400，用户能自己修）与「后端连不上」
 *   （503，用户只能等）是两件事，而那句话只有服务端说得准。
 *
 * ★ 用户侧与管理侧的请求放在同一个文件里，但**分成两段**：它们打的是两条不同的路
 *   （一条谁都能打、一条只有管理员打得通），混在一段里会看不出这条边界。
 */

import { readResult, unreachable, type Result } from '@/lib/auth/response.ts'
import { parseMine, parseRequestList, parseRequestRow, type PermissionRequestRow } from './state.ts'

export type RequestOk<T> = { ok: true; data: T }
export type RequestFail = { ok: false; message: string; status: number }

/** 打一次 BFF 并把响应体读成一个 `Result`。★ 五条请求里那句 `catch` 只写一遍 */
async function call(path: string, init: RequestInit): Promise<Result<unknown> | RequestFail> {
  let response: Response
  try {
    response = await fetch(path, { cache: 'no-store', ...init })
  } catch (err) {
    const failure = unreachable(err instanceof Error ? err.message : String(err))
    return { ok: false, message: failure.message, status: 0 }
  }
  const result: Result<unknown> = await readResult<unknown>(response)
  return result.ok ? result : { ok: false, message: result.message, status: result.status }
}

function isFail(value: Result<unknown> | RequestFail): value is RequestFail {
  return 'ok' in value && value.ok === false
}

/* ── 用户侧 ───────────────────────────────────────────────────────────────── */

/**
 * 「我那条还在不在」。
 *
 * ★ 三种结果要分得开，因为界面上是三句不同的话：
 *   · `{ ok: true, data: null }` —— 没申请过（**正常状态**，那句提示不该出现）
 *   · `{ ok: true, data: {…} }` —— 申请过了，显示"等站长处理"
 *   · `{ ok: false }`           —— 没查成（没登录 / 后端连不上）
 *   ★ 第三种**不能**显示成"你没申请过"：那会让一个已经提过的人再提一次，
 *     而"一个人堆三条一样的申请"正是这一整个功能要防的那种东西。
 */
export async function fetchMine(): Promise<RequestOk<PermissionRequestRow | null> | RequestFail> {
  const result = await call('/api/permission-requests/mine', { method: 'GET' })
  if (isFail(result)) return result
  return { ok: true, data: parseMine(result.data) }
}

/**
 * 提一条。★ 只送一句说明——**没有"要哪几项"这个参数**了。
 *
 * 从 2026-10-17 起申请一律是四项一起开通（用户的原话：「申请的时候这些功能
 * 是一起发放的，申请的时候申请一下就行了」），所以这个函数连 `wants` 都不收：
 * 留着那个参数的话，调用方会以为它有意义，而服务端根本不看。
 *
 * ★ 已经有一条待处理时服务端是**改那一条**，所以这里不看返回的是新是旧。
 */
export async function submitRequest(
  note: string,
): Promise<RequestOk<PermissionRequestRow> | RequestFail> {
  const result = await call('/api/permission-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ note }),
  })
  if (isFail(result)) return result

  const row = parseRequestRow(result.data)
  if (!row) return { ok: false, message: '提交上去了，但服务端回的那一条读不出来', status: 200 }
  return { ok: true, data: row }
}

/* ── 管理侧 ───────────────────────────────────────────────────────────────── */

export async function fetchRequests(): Promise<RequestOk<PermissionRequestRow[]> | RequestFail> {
  const result = await call('/api/admin/requests', { method: 'GET' })
  if (isFail(result)) return result

  const rows = parseRequestList(result.data)
  if (!rows) {
    // ★ 认不出来时说**形状**的问题，不伪造一份空的——那会显示成"一条申请都没有"，
    //   而真实情况可能是"有二十条，一条都没画出来"
    return { ok: false, message: '服务端回的申请列表不是我们认识的形状，刷新一次试试', status: 200 }
  }
  return { ok: true, data: rows }
}

/** 批 / 拒。返回的是**处理完之后那一行**，界面照它整行替换 */
export async function decideRequest(
  requestId: string,
  approve: boolean,
): Promise<RequestOk<PermissionRequestRow> | RequestFail> {
  const result = await call(`/api/admin/requests/${encodeURIComponent(requestId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ approve }),
  })
  if (isFail(result)) return result

  const row = parseRequestRow(result.data)
  if (!row) return { ok: false, message: '处理完了，但服务端回的那一条读不出来', status: 200 }
  return { ok: true, data: row }
}
