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
 * 4. **客户端 IP 要显式带过去**（`init.clientIp`，取值用 `clientIpFrom()`）。
 *    ★ 不带的话，Java 那边的 `getRemoteAddr()` **恒为 `127.0.0.1`**——BFF 就在
 *    同一台机器上——于是它"按 IP"那两层频控（每小时 5 条 / 每日 20 条）会退化成
 *    **全站共用一个桶**：第 6 个注册的人收到"发得太频繁"，而症状长得像"用户手滑连点"。
 *    2026-10-19 在服务器上摸到过这个指纹：`sms_send_log` 里那唯一一行的 `ip`
 *    就是 `127.0.0.1`（那时前端还没上线，所以外面够不着）。
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

/**
 * 客户端 IP —— 从**进来的那个请求**读出来，交给 `backendFetch` 带到 Java 去。
 *
 * ★ 取值顺序是有讲究的，**不能直接把 `X-Forwarded-For` 的第一段抄过去**：
 *
 *   · Nginx 那条 `$proxy_add_x_forwarded_for` 是**追加**：客户端自己带一个
 *     `X-Forwarded-For: 1.2.3.4` 进来，那个值会排在**第一段**；而 Java 那侧
 *     （`ClientIp.of()`）读的正是第一段。照抄第一段 = 谁都能自己填一个 IP，
 *     换着填就绕过了按 IP 的频控 —— 而那一层是"一个人换 IP 刷"的唯一闸门。
 *   · `X-Real-IP` 相反：Nginx 用 `$remote_addr` **覆盖写**，客户端伪造不了。
 *     所以先认它（部署那份 conf 里两行都写了，见 `scripts/deploy-web.sh`）。
 *   · 没有它时取 `X-Forwarded-For` 的**最后一段**（离我们最近的那一跳加的那个），
 *     而不是第一段 —— 第一段就是上面那个洞。
 *
 * ★ 值必须是**长得像 IP** 的东西：不是就回 `null`。宁可退回"Java 用回环地址"
 *   这个已知现状，也不要让一个客户端随手编的字符串变成频控的键。
 *   这一条挡的是"没有 Nginx 挡在前面时直连 Next"（本地开发、或者哪天端口暴露了）。
 */
export function clientIpFrom(request: Request): string | null {
  const real = request.headers.get('x-real-ip')?.trim()
  if (real && looksLikeIp(real)) return real

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
    const last = parts.length > 0 ? parts[parts.length - 1] : undefined
    if (last !== undefined && looksLikeIp(last)) return last
  }
  return null
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

function looksLikeIp(value: string): boolean {
  if (IPV4.test(value)) {
    return value.split('.').every((part) => Number(part) <= 255)
  }
  // IPv6 只做形状判断（十六进制 + 冒号）。★ 它不是防线：防线是"只有 Nginx 能到 Next"，
  // 这里挡的是"一个随便什么字符串变成频控的键"。
  return value.includes(':') && /^[0-9a-fA-F:.]+$/.test(value)
}

const TIMEOUT_MS = 8000

/**
 * 打一次 Java。会话票走 `Authorization: Bearer`——
 * Java 那边就认这一个头（理由写在那儿：自己发明一个 header 名字，
 * 会在"以后加一层网关"时变成一个要单独配的东西）。
 */
export async function backendFetch<T>(
  path: string,
  init: { method: string; body?: unknown; token?: string | null; clientIp?: string | null } = {
    method: 'GET',
  },
): Promise<Result<T>> {
  const headers: Record<string, string> = {}
  const token = internalToken()
  if (token) headers['X-Internal-Token'] = token
  if (init.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8'
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`
  // ★ 见文件头第 4 条。Java 读这个头的**第一段**，所以这里只放一个值、
  //   而且它就是"客户端是谁"这个唯一答案。
  if (init.clientIp) headers['X-Forwarded-For'] = init.clientIp

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
