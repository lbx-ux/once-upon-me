/**
 * auth/backend.ts —— ★ **Next 服务端跟 Java 说话的唯一一个地方**
 *
 * 注意"服务端"三个字：浏览器**不经过这里**。浏览器那一侧打的是同源的 BFF
 * （`src/app/api/auth/*`），走 `client.ts`。两者分开是必须的，理由在
 * 2026-10-16 被一次测试逮出来（写在这里，因为它是一个很容易再犯的错）：
 *
 *   > `client.ts` 一度直接 import 了这里的 `backendFetch`，于是浏览器会去请求
 *   > `http://127.0.0.1:8080/api/auth/...` —— 那意味着 ① 后端地址被塞进浏览器，
 *   > ② **绕过 BFF 的 cookie**（票在 httpOnly cookie 里，跨了源就根本不发），
 *   > ③ 撞 CORS。而它在服务端看起来一切都对，只有浏览器里全坏。
 *   > `client.test.ts` 里那条"打到 BFF 的 /api/auth/send-code"当场就红了。
 *
 * 三件事：
 *
 * 1. **地址是环境变量**（`BACKEND_URL`）。默认 `127.0.0.1:8080`——服务器上
 *    Nginx 与 Next 之间的那条路（Java 只监听回环）。
 *    ★ 不加 `NEXT_PUBLIC_` 前缀：加了就会被打进浏览器 bundle，而浏览器不该知道后端在哪。
 * 2. **`X-Internal-Token`**：BFF 是唯一合法调用方。★ 弱保险不是防线
 *    （公网那一跳是明文），真正挡住陌生人的是"Java 只听回环"。
 * 3. **超时 8 秒**。正常登录请求是几十毫秒；真卡住时，一句"稍后再试"比转 30 秒好。
 */

import { readResult, type Result, unreachable } from './response.ts'

function backendBase(): string {
  const raw = process.env.BACKEND_URL?.trim()
  // 末尾斜杠会让拼出来的路径变成 `//api/auth/me`，有些反向代理会把它当另一个路由
  return (raw && raw !== '' ? raw : 'http://127.0.0.1:8080').replace(/\/+$/, '')
}

function internalToken(): string | null {
  const raw = process.env.INTERNAL_TOKEN?.trim()
  return raw && raw !== '' ? raw : null
}

const TIMEOUT_MS = 8000

/**
 * 打一次 Java。会话票走 `Authorization: Bearer`——
 * Java 那边就认这一个头（理由写在那儿：自己发明一个 header 名字，
 * 会在"以后加一层网关"时变成一个要单独配的东西）。
 */
export async function backendFetch<T>(
  path: string,
  init: { method: string; body?: unknown; token?: string | null } = { method: 'GET' },
): Promise<Result<T>> {
  const headers: Record<string, string> = {}
  const token = internalToken()
  if (token) headers['X-Internal-Token'] = token
  if (init.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8'
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`

  let response: Response
  try {
    response = await fetch(`${backendBase()}${path}`, {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      // ★ 不吃任何缓存：登录态与权限绝不能命中一份缓存住的响应
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    return unreachable(err instanceof Error ? err.message : String(err))
  }

  return readResult<T>(response)
}
