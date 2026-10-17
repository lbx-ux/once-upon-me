/**
 * admin/client.ts —— 管理页那两条请求（**只在浏览器里跑**）
 *
 * ★ 与 `lib/auth/client.ts` 同一条纪律：打的是**同源的 BFF**
 *   （`/api/admin/*`），不是 Java 那个地址。理由写在 `auth/client.ts` 里那段
 *   （后端地址不进浏览器、票在 httpOnly cookie 里、跨源就没有 cookie）——
 *   那三条对这两个接口一字不差地成立。
 *
 * ★ 失败一律带一句能直接显示的话（`Result` 里那个 `message`），上层不自己编文案：
 *   这一层唯一有判别力的事就是"403 与 500 是两件事"，而那句话只有服务端说得准。
 */

import { readResult, unreachable, type Result } from '@/lib/auth/response.ts'
import { parseOverview, parseUserRow, type AdminOverview, type AdminUser } from './state.ts'
import type { Permissions } from '@/lib/auth/state.ts'

export type AdminFail = { ok: false; message: string; status: number }
export type AdminOk<T> = { ok: true; data: T }

export async function fetchOverview(): Promise<AdminOk<AdminOverview> | AdminFail> {
  let response: Response
  try {
    response = await fetch('/api/admin/users', { method: 'GET', cache: 'no-store' })
  } catch (err) {
    const failure = unreachable(err instanceof Error ? err.message : String(err))
    return { ok: false, message: failure.message, status: 0 }
  }

  const result: Result<unknown> = await readResult<unknown>(response)
  if (!result.ok) return { ok: false, message: result.message, status: result.status }

  const overview = parseOverview(result.data)
  if (!overview) {
    // ★ 认不出来时说**形状**的问题，不伪造一份空的（那会显示成"这个站上一个人都没有"）
    return { ok: false, message: '服务端回的用户表不是我们认识的形状，刷新一次试试', status: 200 }
  }
  return { ok: true, data: overview }
}

/**
 * 改一个人的四个开关。★ 送的是**四个**（全量），不是"改了哪一个"——
 * 理由在 BFF 那条路由与 Java 的 `PermissionPatch` 上各写了一遍。
 */
export async function setPermissions(
  userId: string,
  permissions: Permissions,
): Promise<AdminOk<AdminUser> | AdminFail> {
  let response: Response
  try {
    response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/permissions`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(permissions),
      cache: 'no-store',
    })
  } catch (err) {
    const failure = unreachable(err instanceof Error ? err.message : String(err))
    return { ok: false, message: failure.message, status: 0 }
  }

  const result: Result<unknown> = await readResult<unknown>(response)
  if (!result.ok) return { ok: false, message: result.message, status: result.status }

  const row = parseUserRow(result.data)
  if (!row) return { ok: false, message: '改完了，但服务端回的那一行读不出来', status: 200 }
  return { ok: true, data: row }
}
