/**
 * auth/session.ts —— 服务端那半：**票是谁签的、这个人能不能干这件事**（工单 04）
 *
 * 与 `backend.ts` 同一层，分工是：那一个负责"怎么跟 Java 说话"，
 * 这一个负责"**这个请求到底能不能放行**"。全部只在服务端跑（`node:crypto`）。
 *
 * ★ 三条判断，每条都值一段解释：
 *
 * 1. **自己验签名，不引 jose**。令牌是 HS256，而 `node:crypto` 里就有 HMAC。
 *    引一个库要多一个依赖、多一次版本升级、多一处"它的默认行为和以为的不一样"
 *    （算法混淆那一类洞几乎全出在宽松的默认值上）。自己写一共二十行，
 *    而且 `alg` 只认 `HS256` 一条——**这个判断是显式写出来的**，
 *    因为"不检查 alg"正是那种库帮你挡了、你自己写就漏掉的东西。
 *
 * 2. **权限每次都问后端**（`GET /api/auth/me`），不从票里读。
 *    站长在管理页勾掉一个开关之后，那个人下一次点「开始创作」就该看见变化，
 *    而不是等 7 天票过期。代价是每个要花钱的请求多一跳（服务器上那条是回环，
 *    几十毫秒），换来的是"权限是当下的事实，不是一张七天前的快照"。
 *
 * 3. **判不了就不放行**。后端连不上时回 503 并说清是账号服务的问题——
 *    ★ 这一条是刻意的：**默认拒绝**。反过来（连不上就放行）会让"后端挂了"
 *    变成一个"所有人都能白用你的密钥"的窗口，而那个窗口没有人看得见。
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from './backend.ts'

/** 会话票放哪儿。★ httpOnly：浏览器脚本读不到它（那段"前端拿着 token 到处走"的写法就此消失） */
export const SESSION_COOKIE = 'xzj_session'
/**
 * 设密码那张短命票。★ 它**也走 cookie 而不是回给浏览器**：
 * 前端只需要知道"现在是设密码那一步"，不需要拿着那张票——少一次"令牌出现在 JS 里"。
 */
export const TICKET_COOKIE = 'xzj_ticket'

/** 与 Java 的 `app.jwt.ttl-hours` 对齐（7 天）。★ 改要两边一起改 */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
/** 与 Java 的 `app.jwt.ticket-minutes` 对齐（5 分钟） */
const TICKET_MAX_AGE_SECONDS = 5 * 60

export type Capability = 'text' | 'image' | 'vision' | 'speech'

/** 四个能力开关。形状与 Java 的 `Permissions`、与界面上的判断逐字段一样 */
export type Permissions = Record<Capability, boolean>

export type Session = {
  userId: string
  account: string
  role: string
}

/** 服务端配齐了哪几个能力（来自 `serverEnv()`，与"你有没有权限"是两件事） */
export type Configured = Permissions

const NONE: Permissions = { text: false, image: false, vision: false, speech: false }

/* ── 验票 ────────────────────────────────────────────────────────────────── */

/**
 * 令牌密钥。★ 必须与 Java 的 `APP_JWT_SECRET` **逐字一样**（同一个值喂给 HMAC，
 * 两边都**不做任何派生**——派生一次就多一种"两边算得不一样"的可能，
 * 而它的症状是"登录明明成功，下一个请求就 401"）。
 */
function secret(): string | null {
  const raw = process.env.APP_JWT_SECRET?.trim()
  return raw && raw !== '' ? raw : null
}

type Claims = { sub: string; acc: string; role: string; scope: string; exp: number }

/** 验签名 + 有效期。**只认 HS256**，认不出来一律 `null`（不抛） */
export function verifyToken(token: string): Claims | null {
  const key = secret()
  if (!key) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts as [string, string, string]

  let headerJson: { alg?: unknown }
  try {
    headerJson = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: unknown }
  } catch {
    return null
  }
  // ★ 只认 HS256：`alg: none` 与把 HS256 换成 RS256 这类混淆，全靠这一行挡住。
  //   而"另一侧自己挑算法"是可以实测撞上的：Java 那边原来只写 `signWith(key)`，
  //   jjwt 按密钥长度挑成了 **HS512**（密钥 65 字节时），症状是"登录成功、
  //   下一个请求 401"（2026-10-16）。所以两边现在都**写死** HS256，
  //   而且这里留一句日志——下次真撞上时，一眼看得出是算法对不上
  if (headerJson.alg !== 'HS256') {
    console.warn(`[auth] 拒了一个 alg=${String(headerJson.alg)} 的令牌：这一侧只认 HS256`)
    return null
  }

  const expected = createHmac('sha256', key).update(`${header}.${payload}`).digest()
  let actual: Buffer
  try {
    actual = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  // ★ 常量时间比较：`===` 在第一个不同的字节就返回，理论上能把签名一个字节一个字节试出来
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  let claims: Claims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims
  } catch {
    return null
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null
  if (typeof claims.sub !== 'string' || typeof claims.scope !== 'string') return null
  return claims
}

/** 这个请求带着的会话（没有/无效就是 `null`）。`scope` 必须是 `session` */
export function sessionOf(request: NextRequest): Session | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null
  const claims = verifyToken(token)
  // ★ 拿"设密码那张票"当会话用必须在这里被挡住——那是这一轮唯一一处不设防的门
  if (!claims || claims.scope !== 'session') return null
  return { userId: claims.sub, account: claims.acc, role: claims.role }
}

/** 设密码那一步带着的票（`scope` 必须是 `ticket`）。返回值就是它签给哪个登录名 */
export function ticketAccountOf(request: NextRequest): string | null {
  const token = ticketTokenOf(request)
  if (!token) return null
  const claims = verifyToken(token)
  if (!claims || claims.scope !== 'ticket') return null
  return claims.sub
}

/** 设密码那张票的原文（要转发给 Java 时用） */
export function ticketTokenOf(request: NextRequest): string | null {
  return request.cookies.get(TICKET_COOKIE)?.value ?? null
}

/** 会话票的原文（要转发给 Java 时用） */
export function sessionTokenOf(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE)?.value ?? null
}

/* ── 问后端：这个人现在能用什么 ─────────────────────────────────────────── */

/** `GET /api/auth/me` 拿回来的东西（BFF 自己的路由也用这个形状回给浏览器） */
export type MeView = {
  user: {
    userId: string
    account: string
    phone: string | null
    nickname: string
    avatar: string
    role: string
    createdAt: string
    permissions: Permissions
  }
  permissions: Permissions
}

export async function fetchMe(
  token: string,
): Promise<
  { ok: true; me: MeView } | { ok: false; status: number; code: string; message: string }
> {
  const result = await backendFetch<MeView['user']>('/api/auth/me', { method: 'GET', token })
  if (!result.ok) return result
  return {
    ok: true,
    me: { user: result.data, permissions: result.data.permissions ?? NONE },
  }
}

/* ── 那道闸 ──────────────────────────────────────────────────────────────── */

export type Guard =
  { ok: true; session: Session; permissions: Permissions } | { ok: false; response: NextResponse }

/** 统一的一句人话。★ 界面与文档里引用的都是这一句，改文案只有这一处 */
export const NO_PERMISSION_MESSAGE = '当前用户没有权限，请联系管理员'

function fail(
  status: number,
  code: string,
  message: string,
): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ code, message }, { status }) }
}

/**
 * 要花钱的接口前面那道闸：**登录了吗、有这个能力吗**。
 *
 * ★ 用返回值而不是抛异常：这三个失败各自要回不同的状态码与不同的那句话，
 * 而 route handler 里 `if (!guard.ok) return guard.response` 是最不容易写错的形式。
 *
 * @param caps 需要的能力。空数组 = 只要登录（比如"读自己的东西"）
 */
export async function requireCapability(request: NextRequest, caps: Capability[]): Promise<Guard> {
  if (!secret()) {
    // ★ 服务端自己没配好，不是"这个人没登录"。说清楚，别伪装成 401——
    //   那会让人一直去重新登录
    return fail(500, 'server-misconfigured', '服务端没配 APP_JWT_SECRET，登录态认不出来')
  }

  const session = sessionOf(request)
  if (!session) {
    return fail(401, 'not-signed-in', '请先登录')
  }

  const me = await fetchMe(sessionTokenOf(request) ?? '')
  if (!me.ok) {
    // ★ 默认拒绝（见文件头第 3 条）：判不了权限就不放行，而且说清是账号服务的问题
    return fail(503, 'permission-unavailable', `暂时判不了权限（${me.message}），请稍后再试`)
  }

  const missing = caps.filter((cap) => !me.me.permissions[cap])
  if (missing.length > 0) {
    // ★ 这一句是产品要求的那一句（用户 2026-10-16），一个字都不改
    return fail(403, 'no-permission', NO_PERMISSION_MESSAGE)
  }

  return { ok: true, session, permissions: me.me.permissions }
}

/* ── 写 cookie ───────────────────────────────────────────────────────────── */

/**
 * 会话 cookie 的选项。
 *
 * ★ `httpOnly` + `sameSite: 'lax'`：脚本读不到（XSS 拿走不了），
 * 而 `lax` 仍然允许从外站"点进来"那种导航（登录完跳回来那一步要靠它）。
 * ★ `secure` 现在**不能开**：这一轮是 `http://` 的 IP 访问（用户选的），
 * 加了它就等于"登录成功但 cookie 存不下来"。等有了域名与 HTTPS 再打开——
 * 这一条写在 README §五 的取舍里，标记了一个明确的"以后要改这里"。
 */
export function sessionCookie(token: string): {
  name: string
  value: string
  httpOnly: true
  sameSite: 'lax'
  path: string
  maxAge: number
} {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}

export function ticketCookie(token: string): ReturnType<typeof sessionCookie> {
  return { ...sessionCookie(token), name: TICKET_COOKIE, maxAge: TICKET_MAX_AGE_SECONDS }
}

/** 清 cookie 用（退出登录 / 设完密码之后那张票就作废） */
export function clearedCookie(name: string): ReturnType<typeof sessionCookie> {
  return { ...sessionCookie(''), name, maxAge: 0 }
}
