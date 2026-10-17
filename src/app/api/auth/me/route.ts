/**
 * `/api/auth/me` —— 现在这个人是谁、能用什么；改昵称也走这里（BFF）
 *
 * ```
 *   GET   → { "user": {…}, "permissions": {…}, "configured": {…}, "speechModel": "…" }
 *   POST  { "nickname": "小满妈妈" }  → { "user": {…} }
 *   401   { "code": "not-signed-in", "message": "请先登录" }
 * ```
 *
 * ★ `GET` 回三样东西，而这三样**是三个不同的事实**，界面上要分开用：
 *   · `user`         —— 这个人是谁（昵称、头像、首次登录时间）
 *   · `permissions`  —— **站长给了他什么**（四个开关）
 *   · `configured`   —— **服务端自己配齐了什么**（`serverEnv()` 里有没有那个能力的密钥）
 * 一个能力真能用，是这两件事**同时**成立。合成一个布尔的那天起，
 * 界面上就再也说不出"你有权限，但站里还没配语音"这种真话。
 *
 * ★ `speechModel` 是**模型名**，不是密钥，所以它回给浏览器没有代价；而界面**非知道它不可**：
 *   克隆音色绑死在创建它时的那个模型上（实测跨模型 400 `[cosinevoice]Engine error [411]`），
 *   所以"我录的那条现在还能不能用"这条判据需要"现在的模型是哪一个"。
 *   这一栏在 ADR-0008 那会儿是用户在设置里填的，现在只有服务端知道。
 *   ★ 别顺手把 `LLM_MODEL` / `IMAGE_MODEL` 也加进来：那两条今天**没有读者**，
 *     多回一个字段就是多一个以后要维护的承诺。
 *
 * ★ `configured` 在这里算、不在 Java 那边：密钥在 Next 这一侧（ADR-0009），
 * Java 根本不知道有没有配 TTS。
 *
 * ★ 改昵称用 `POST` 而不是 `PATCH`：这一层与 Java 那张接口表**不是同一张**
 * （转发过去时用的是 `PATCH`）。选 POST 只为一个理由——少一类"某些代理不转发 PATCH"
 * 的意外，而我们没有 REST 洁癖要满足。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from '@/lib/auth/backend.ts'
import { badJson, failureResponse, jsonBody } from '@/lib/auth/bff.ts'
import {
  requireCapability,
  sessionOf,
  sessionTokenOf,
  type Permissions,
} from '@/lib/auth/session.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!sessionOf(request)) {
    return NextResponse.json({ code: 'not-signed-in', message: '请先登录' }, { status: 401 })
  }

  const result = await backendFetch<{ userId: string; permissions: Permissions }>('/api/auth/me', {
    method: 'GET',
    token: sessionTokenOf(request) ?? '',
  })
  if (!result.ok) return failureResponse(result)

  const env = serverEnv()
  return NextResponse.json({
    user: result.data,
    permissions: result.data.permissions,
    configured: {
      text: Boolean(env['LLM_MODEL'] && env['LLM_API_KEY']),
      image: Boolean(env['IMAGE_MODEL'] && env['IMAGE_API_KEY']),
      vision: Boolean(env['VISION_MODEL'] && env['VISION_API_KEY']),
      // 语音要"模型 + key"两样（音色是用户在界面上挑的，缺了会在挑那一格说）
      speech: Boolean(env['TTS_MODEL'] && env['TTS_API_KEY']),
    },
    /** ★ 见文件头：它是**模型名**不是密钥，而"我录的那条还能不能用"非要它不可 */
    speechModel: env['TTS_MODEL'] ?? '',
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 只要登录（不需要任何能力）：改自己的昵称不该要站长授权
  const guard = await requireCapability(request, [])
  if (!guard.ok) return guard.response

  const body = await jsonBody<{ nickname?: unknown }>(request)
  if (!body || typeof body.nickname !== 'string') return badJson()

  const result = await backendFetch<unknown>('/api/auth/me', {
    method: 'PATCH',
    token: sessionTokenOf(request),
    body: { nickname: body.nickname },
  })
  if (!result.ok) return failureResponse(result)

  return NextResponse.json({ user: result.data })
}
