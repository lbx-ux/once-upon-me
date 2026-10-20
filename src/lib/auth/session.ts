/**
 * auth/session.ts —— 服务端那半：票是谁签的、这个人能不能干这件事（工单 04）
 *
 * 与 `backend.ts` 同一层，分工是：那一个负责"怎么跟 Java 说话"，
 * 这一个负责"这个请求到底能不能放行"。全部只在服务端跑（`node:crypto`）。
 *
 * 三条判断，每条都值一段解释：
 *
 * 1. 自己验签名，不引 jose。令牌是 HS256，而 `node:crypto` 里就有 HMAC。
 *    引一个库要多一个依赖、多一次版本升级、多一处"它的默认行为和以为的不一样"
 *    （算法混淆那一类洞几乎全出在宽松的默认值上）。自己写一共二十行，
 *    而且 `alg` 只认 `HS256` 一条——这个判断是显式写出来的，
 *    因为"不检查 alg"正是那种库帮你挡了、你自己写就漏掉的东西。
 *
 * 2. 权限每次都问后端（`GET /api/auth/me`），不从票里读。
 *    站长在管理页勾掉一个开关之后，那个人下一次点「开始创作」就该看见变化，
 *    而不是等 7 天票过期。代价是每个要花钱的请求多一跳（服务器上那条是回环，
 *    几十毫秒），换来的是"权限是当下的事实，不是一张七天前的快照"。
 *
 * 3. 判不了就不放行。后端连不上时回 503 并说清是账号服务的问题——
 *    这一条是刻意的：默认拒绝。反过来（连不上就放行）会让"后端挂了"
 *    变成一个"所有人都能白用你的密钥"的窗口，而那个窗口没有人看得见。
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

import { backendFetch } from './backend.ts'

/** 会话票放哪儿。★ httpOnly：浏览器脚本读不到它（那段"前端拿着 token 到处走"的写法就此消失） */
export const SESSION_COOKIE = 'xzj_session'
/**
 * 设密码那张短命票。★ 它也走 cookie 而不是回给浏览器：
 * 前端只需要知道"现在是设密码那一步"，不需要拿着那张票——少一次"令牌出现在 JS 里"。
 */
export const TICKET_COOKIE = 'xzj_ticket'

/** 与 Java 的 `app.jwt.ttl-hours` 对齐（7 天）。★ 改要两边一起改 */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
/** 与 Java 的 `app.jwt.ticket-minutes` 对齐（5 分钟） */
const TICKET_MAX_AGE_SECONDS = 5 * 60

export type Capability = 'text' | 'image' | 'vision' | 'speech'

/**
 * 四项能力。★ 它现在只有一个读者：`configured`（站里配没配那一项密钥）。
 *
 * 2026-10-18：它原来还表示"站长给了这个人哪几项"，而那一半收成了一位
 * （{@code AuthUser.allowed}）——见 docs/known-tradeoffs.md与 ADR-0010。所以这个类型不是在说
 * "这个人有什么"，别再拿它装人。
 */
export type Permissions = Record<Capability, boolean>

export type Session = {
  userId: string
  account: string
  role: string
}

/** 服务端配齐了哪几个能力（来自 `serverEnv()`，与"这个人有没有权限"是两件事） */
export type Configured = Permissions

/* 验票 */

/**
 * 令牌密钥。★ 必须与 Java 的 `APP_JWT_SECRET` 逐字一样（同一个值喂给 HMAC，
 * 两边都不做任何派生——派生一次就多一种"两边算得不一样"的可能，
 * 而它的症状是"登录明明成功，下一个请求就 401"）。
 */
function secret(): string | null {
  const raw = process.env.APP_JWT_SECRET?.trim()
  return raw && raw !== '' ? raw : null
}

type Claims = { sub: string; acc: string; role: string; scope: string; exp: number }

/** 验签名 + 有效期。只认 HS256，认不出来一律 `null`（不抛） */
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
  // 只认 HS256：`alg: none` 与把 HS256 换成 RS256 这类混淆，全靠这一行挡住。
  //   而"另一侧自己挑算法"是可以实测撞上的：Java 那边原来只写 `signWith(key)`，
  //   jjwt 按密钥长度挑成了 HS512（密钥 65 字节时），症状是"登录成功、
  //   下一个请求 401"（2026-10-16）。所以两边现在都写死 HS256，
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
  // 常量时间比较：`===` 在第一个不同的字节就返回，理论上能把签名一个字节一个字节试出来
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

/* 问后端：这个人现在能用什么 */

/** `GET /api/auth/me` 拿回来的东西（BFF 自己的路由也用这个形状回给浏览器） */
export type MeView = {
  user: {
    userId: string
    account: string
    phone: string | null
    nickname: string
    role: string
    createdAt: string
    /** 有没有创作权。★ 一位（2026-10-18 由四项收成一位，见 ADR-0010） */
    allowed: boolean
  }
  allowed: boolean
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
    // 顶部那一位与 `user.allowed` 是同一个值的两种读法（与上一版 `permissions` 一样）：
    //   票的契约是"`sub` 就是 userId"，而"有没有权限"是后端现算的，所以缺了就按没有算——
    //   这一处的不一致只可能是后端少回了一个字段，那时把人放进去才是更坏的那一半
    me: { user: result.data, allowed: result.data.allowed === true },
  }
}

/**
 * 服务端组件那一侧的"这是谁"（工单 16）。
 *
 * Route Handler 手上有一个 `NextRequest`，`sessionOf(request)` 直接就能读；
 * 而 server component 手上只有 `cookies()`，没有 request——所以补这一条出口。
 *
 * 两条纪律：
 *
 * 1. 判不出来就回 `null`，不抛。页面照常渲染，只是"我的那部分"是空的
 *    （与今天的行为一致：未登录时书架仍然打得开，架上是空的）。
 *    回 null 与 `sessionOf` 回 null 是同一件事的两种入口，不是两套判断。
 * 2. 验的是同一张票、同一个 `verifyToken`（不是"再问一次 Java"）：
 *    所以它不可能与上面那道闸说出不同的话来。多一跳问 `/api/auth/me`
 *    只会多一处可能漂的地方，而 `sub` 就是 userId 这件事是票的契约。
 *    ★ 代价说清楚：票还没过期、但人在后端已经被删掉时，这里回的是一个
 *    已经不存在的 userId，读出来是一片空的目录——空是对的答案，
 *    而"这个人不存在"要由真正要动钱的那条路去说（那时 `requireCapability`
 *    会问后端，问到 401）。
 */
export async function currentUserId(): Promise<string | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const claims = verifyToken(token)
  if (!claims || claims.scope !== 'session') return null
  return claims.sub
}

/* 那道闸 */

export type Guard =
  /** `allowed` = 这个人此刻有没有创作权（一位）。★ 要花大钱的路由可以再判它一次 */
  { ok: true; session: Session; allowed: boolean } | { ok: false; response: NextResponse }

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
 * 要花钱的接口前面那道闸：登录了吗、有没有创作权。
 *
 * 用返回值而不是抛异常：这三个失败各自要回不同的状态码与不同的那句话，
 * 而 route handler 里 `if (!guard.ok) return guard.response` 是最不容易写错的形式。
 *
 * `caps` 是"这条路由要什么能力"，不是"这个人有没有这一项"
 *   （2026-10-18，权限收成一位之后）。政策是"有权限 = 四项都能用"，
 *   所以这里实际判的是一位（`allowed`），`caps` 只是把这条路由的需求写下来。
 *   为什么不让三十个调用点改成 `requireAllowed(req)`：那会把"这条路要图像"
 *     这件事从代码里抹掉——而它是下一次调整政策时唯一还留着的信息
 *     （回到按能力授权时，改的是这一处，不是三十处）。
 *   空数组 = 只要登录（比如"读自己的东西"）。
 *
 * @param caps 需要的能力。★ 见上：它是需求，不是判据
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
    // 默认拒绝（见文件头第 3 条）：判不了权限就不放行，而且说清是账号服务的问题
    return fail(503, 'permission-unavailable', `暂时判不了权限（${me.message}），请稍后再试`)
  }

  if (caps.length > 0 && !me.me.user.allowed) {
    // 这一句是产品要求的那一句（用户 2026-10-16），一个字都不改
    return fail(403, 'no-permission', NO_PERMISSION_MESSAGE)
  }

  return { ok: true, session, allowed: me.me.user.allowed }
}

/* 管理员那道闸（2026-10-17） */

export type AdminGate = { ok: true } | { ok: false; response: NextResponse }

/**
 * 「这个人是管理员吗」——问 Java。
 *
 * 为什么不在这一层判 `session.role === 'ADMIN'`：那张票里的 role 是签发时的，
 *   而判据必须按"此刻"来——他被停用了、或者他的密码刚被改过，旧票就不该还能
 *   改全站的模型配置。那两条判据（角色 + 新鲜度）都只写在
 *   `AdminController#requireAdminFresh` 里。
 * 更要紧的一条：这里要守的不是"给不给看"，而是给不给写
 *   （`/api/admin/model-config` 会把 api-key 写进磁盘上那份文件）。
 *   前端说"我是管理员"不是证据，所以这条路必须有一个服务端的"是"才算数。
 *
 * 用它的是只在 Next 一侧存在的管理资源（模型配置）。
 *   转发给 Java 就能做完的那些（用户表、权限申请）不需要它——
 *   那些路由直接把请求转过去，Java 自己会拒。
 */
export async function requireAdmin(request: NextRequest): Promise<AdminGate> {
  if (!secret()) {
    return fail(500, 'server-misconfigured', '服务端没配 APP_JWT_SECRET，登录态认不出来')
  }
  if (!sessionOf(request)) {
    return fail(401, 'not-signed-in', '请先登录')
  }

  const result = await backendFetch<unknown>('/api/admin/check', {
    method: 'GET',
    token: sessionTokenOf(request) ?? '',
  })
  if (result.ok) return { ok: true }

  // Java 给的那句话原样用（`not-admin` / 「这一屏只有管理员能看」）——
  //   与 `lib/admin/server.ts` 里那四种结果同一条纪律：这一层不编文案
  if (result.status === 401 || result.status === 403) {
    return { ok: false, response: failureJson(result.status, result.code, result.message) }
  }
  // 判不了 ≠ 不是管理员。说清是判不了（见 `requireCapability` 里同样那一条）
  return {
    ok: false,
    response: failureJson(
      503,
      'permission-unavailable',
      `暂时判不了权限（${result.message}），请稍后再试`,
    ),
  }
}

function failureJson(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ code, message }, { status })
}

/* 写 cookie */

/**
 * 会话 cookie 的选项。
 *
 * `httpOnly` + `sameSite: 'lax'`：脚本读不到（XSS 拿走不了），
 * 而 `lax` 仍然允许从外站"点进来"那种导航（登录完跳回来那一步要靠它）。
 * ★ `secure` 现在不能开：这一轮是 `http://` 的 IP 访问（用户选的），
 * 加了它就等于"登录成功但 cookie 存不下来"。等有了域名与 HTTPS 再打开——
 * 这一条写在 docs/known-tradeoffs.md 的取舍里，标记了一个明确的"以后要改这里"。
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
