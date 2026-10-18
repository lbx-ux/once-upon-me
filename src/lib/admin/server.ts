/**
 * admin/server.ts —— 管理页**首屏那份数据**（只在服务端跑）
 *
 * ★ 为什么这一步不走自己那个 BFF（`/api/admin/users`）：服务端组件要打自己家的 HTTP，
 *   得先知道自己的绝对地址（`headers()` 里那个 host 在反代后面未必是它以为的那个），
 *   还要把 cookie 手工接过去。而这一层与 BFF 那条路由**用的是同一个 `backendFetch`**——
 *   转发这件事的规则只有一份，绕开的那一步省掉的是"猜自己的地址"。
 *
 * ★ 判据一条不在这里：`role === 'ADMIN'` 由 Java 判（`AdminController#requireAdminFresh`）。
 *   这一层只把两种结果分开交给界面：
 *   · `forbidden` —— **确认过了他没有权限**（403，服务端说的）
 *   · `error`     —— 判不了（后端连不上、票过期），那不是"没有权限"
 *   ★ 这两件事混成一个布尔之后，界面上就再也说不出"服务暂时判不了，待会儿再来"
 *     —— 而那正是一个掌权限的人最需要看到的一句话。
 */

import { cookies } from 'next/headers'

import { backendFetch } from '@/lib/auth/backend.ts'
import { SESSION_COOKIE } from '@/lib/auth/session.ts'
import { parseOverview, type AdminOverview } from './state.ts'
import { modelConfigView } from '@/lib/settings/model-config.ts'
import type { ModelConfigView } from '@/lib/settings/model-config-state.ts'

export type OverviewResult =
  | { kind: 'ok'; overview: AdminOverview }
  /** 服务端明确说"这个人没权限"（403） */
  | { kind: 'forbidden'; message: string }
  /** 没登录（401）——与"没权限"分开：这一种去登录就有救 */
  | { kind: 'signed-out' }
  /** 判不了（后端连不上 / 票作废 / 形状不对）。★ 与上面三种都不是一件事 */
  | { kind: 'error'; message: string }

export async function readOverview(): Promise<OverviewResult> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return { kind: 'signed-out' }

  const result = await backendFetch<unknown>('/api/admin/users', { method: 'GET', token })
  if (!result.ok) {
    if (result.status === 403) return { kind: 'forbidden', message: result.message }
    if (result.status === 401) return { kind: 'signed-out' }
    return { kind: 'error', message: result.message }
  }

  const overview = parseOverview(result.data)
  if (!overview) return { kind: 'error', message: '服务端回的用户表不是我们认识的形状' }
  return { kind: 'ok', overview }
}

/**
 * 模型配置那一屏（首屏）。
 *
 * ★ **它一个请求都不发**，与上面两个不一样：那份配置就在 Next 这一侧
 *   （`.env.local` + 管理页写的那份文件，见 `settings/runtime-config.ts`），
 *   而"密钥只在 Next 一侧"正是 ADR-0009 定的形状。所以这里只是把两份读在一起，
 *   连 Java 都不用问。
 *
 * ★ 但**角色仍然要判**，只是判在调用方：`/admin` 那一页在 `readOverview` 说
 *   "不是管理员"时就已经 return 掉了（那一句是 Java 判的），根本走不到这里。
 *   这一层的纪律是"不要在没有理由的时候去碰秘密"——先确认了是管理员，
 *   再把这份配置读进内存。
 */
export function readModelConfig(): ModelConfigView {
  return modelConfigView()
}
