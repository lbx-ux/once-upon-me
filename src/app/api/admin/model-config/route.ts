/**
 * `GET /api/admin/model-config` —— 现在生效的模型配置（BFF，2026-10-17）
 *
 * ```
 *   → { file, effective: { text, image, vision, voice }, sections: [ { id, label, fields: [...] } ] }
 *   403 { "code": "not-admin", "message": "这一屏只有管理员能看" }
 * ```
 *
 * API key 的值不在这份响应里，一个字节都没有：秘密那一格只回
 *   "配没配 + 从哪儿来的（管理页 / 环境变量 / 没有）"。理由与
 *   `AdminController#resetPassword` 不回显口令是同一条——回显出去就多了一份
 *   要删的副本（浏览器内存、开发者工具、一张截图）。代价是站长看不出
 *   "现在这把 key 是哪一个"，而那是故意选的那一边：key 填错会立刻 401
 *   暴露，key 泄出去不会。要确定就用新的那把再填一次。
 *
 * 这一层自己不做角色判断（与 `/api/admin/users` 同一条纪律）：
 *   `lib/auth/session.ts` 的 `requireAdmin` 会去问 Java 的
 *   `/api/admin/check`，判据仍然只有 Java 那一份。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/auth/session.ts'
import { modelConfigView } from '@/lib/settings/model-config.ts'

// ★ 段配置必须是字面量：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdmin(request)
  if (!gate.ok) return gate.response

  return NextResponse.json(modelConfigView())
}
