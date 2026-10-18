/**
 * auth/client.ts —— ★ **「接后端」那条缝就是这一个文件**（今天就是那一天）
 *
 * 上一版的文件头是这么写的：
 *
 *   > 现在**全是本地模拟，一个请求都不发**。接后端时把每个函数体换成 `fetch`，
 *   > 连返回类型一起换，**上层一行都不用改**。
 *
 * 这一天到了。这里是**换成了什么样**，以及换的时候**判断没变的地方**：
 *
 * ── 一个字都没变的 ────────────────────────────────────────────────────────
 *
 * · 函数名与它们的分工：`sendCode` / `verifyCode` / `setPassword` /
 *   `loginWithPassword` / `updateNickname`。
 * · **失败一律带一句能读给人看的话**（`AuthFail.message`），上层直接显示，
 *   不自己编文案。★ 现在那句话是**后端说的**（BFF 原样透传 Java 的 message），
 *   所以"验证码不对"与"发得太频，请等 60 秒"是后端才分得清的两件事。
 * · `verifyCode` 通过之后才谈得上"新用户还是老用户"（`CodeVerdict` 的两个 kind）。
 * · 演示账号 `123456` 能用密码直接进（这一轮它从"前端常量"变成了后端里的一个账号）。
 *
 * ── 变了的 ────────────────────────────────────────────────────────────────
 *
 * · **票不再经过这个文件**。会话与那张"设密码的票"都在 httpOnly cookie 里，
 *   由 BFF 下发，JS 读不到——上一版那句"本地一个口令都不存"现在升级成
 *   "**连令牌都不在这层出现**"。
 * · `setPassword(password)` **不再收手机号**：号码从票里读。上一版靠一个模块级变量
 *   `verifiedPhone` 记着"刚才验过哪个号"，现在这件事由票本身保证（它是签过名的）。
 * · `MOCK_LATENCY_MS` 连同那整套模拟规则**删掉了**。那个常数存在的理由是
 *   "让 pending 态真的会发生"——现在请求真的要几十到几百毫秒，理由自己成立了。
 *   ★ 而 60 秒倒计时仍然是**体验**，不是防线：真频控在后端（三层 + 每日硬顶）。
 */

import { readResult, unreachable, type Result } from './response.ts'
import {
  NO_PERMISSIONS,
  parsePermissions,
  parseUser,
  type AuthUser,
  type Permissions,
} from './state.ts'

/**
 * 打一次 BFF（**同源、相对路径**）。
 *
 * ★ 这里**不能**用 `backend.ts` 那个 `backendFetch`：那个是服务端用的，
 * 它会拼上 `BACKEND_URL`（Java 的地址）。浏览器照着打过去的话，
 * ① 后端地址进了浏览器，② **绕过 BFF 的 cookie**（httpOnly cookie 跨源不发），
 * ③ 撞 CORS。2026-10-16 就是被 `client.test.ts` 里那条
 * "打到 BFF 的 /api/auth/send-code" 逮出来的——它在服务端看起来一切正常。
 */
async function call<T>(path: string, body: unknown): Promise<Result<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      // ★ 不缓存：登录态相关的东西命中一份旧响应，症状是"登出了还是登录着"
      cache: 'no-store',
    })
  } catch (err) {
    return unreachable(err instanceof Error ? err.message : String(err))
  }
  return readResult<T>(response)
}

/** GET 那一支（只有 `/api/auth/me` 用） */
async function get<T>(path: string): Promise<Result<T>> {
  let response: Response
  try {
    response = await fetch(path, { method: 'GET', cache: 'no-store' })
  } catch (err) {
    return unreachable(err instanceof Error ? err.message : String(err))
  }
  return readResult<T>(response)
}

/**
 * 密码下限。★ 与服务器上 `AccountRules.PASSWORD_MIN` 是**同一个数**（那边注释里
 * 也写了这一条）。它管的是"自己设密码"那一步；**登录时不用它**
 * ——演示账号那个 6 位的口令就是靠这一条才登得进来。
 */
export const PASSWORD_MIN = 8

/** 失败一律带一句**能读给人看的话**。上层直接把它显示出来，不自己编文案 */
export type AuthFail = { ok: false; message: string }
/** 成功带一个登录态。`AuthUser` 的形状见 `state.ts` */
export type AuthOk = { ok: true; user: AuthUser }
export type AuthResult = AuthOk | AuthFail

/** 发验证码的结果。★ `devMode` 为真时 `hint` 里就是那句"没有真正发送" */
export type CodeResult = { ok: true; devMode: boolean; hint: string | null } | AuthFail

/**
 * 验证码通过之后的两种结局。
 * ★ `kind` 与后端的 `isNewUser` 一一对应：`signed-in` 是"老用户，登录完了"，
 *   `needs-password` 是"新用户，先去设密码"。★ 两种情况下浏览器都不拿到票。
 */
export type CodeVerdict =
  { ok: true; kind: 'signed-in'; user: AuthUser } | { ok: true; kind: 'needs-password' } | AuthFail

/** 这个人是谁 + 他能不能创作 + 服务端配齐了什么（三个不同的事实，见 BFF 那条路由的注释） */
export type MeResult =
  | {
      ok: true
      user: AuthUser
      /** 这个人此刻有没有创作权。★ 一位，与 `user.allowed` 是同一个值 */
      allowed: boolean
      configured: Permissions
      /**
       * 站里现在配的语音模型（`TTS_MODEL`）。★ 它是**模型名**不是密钥。
       * 界面非知道它不可：克隆音色绑死在创建它时的模型上（实测跨模型 400），
       * 所以"我录的那条还能不能用"这条判据要拿当前模型去比（见 `lib/voices/catalog.ts`）。
       */
      speechModel: string
    }
  | AuthFail

/** 把 BFF 的响应读成 `AuthUser`。认不出来时说一句"服务端回的东西不认识" */
function readUser(raw: unknown): AuthOk | AuthFail {
  const user = parseUser(raw)
  if (!user) {
    // ★ 这一句是给**排障**的：接口形状变了却没人发现时，这句话会直说是形状问题，
    //   而不是让界面上某处冒出一个 undefined
    return { ok: false, message: '服务端回的登录态不是我们认识的形状，请刷新一次试试' }
  }
  return { ok: true, user }
}

/** 发验证码。真频控在后端：同号 60 秒、同 IP、每日硬顶三层 */
export async function sendCode(account: string): Promise<CodeResult> {
  const result = await call<{ ok: boolean; devMode: boolean; hint: string | null }>(
    '/api/auth/send-code',
    { account },
  )
  if (!result.ok) return { ok: false, message: result.message }
  return { ok: true, devMode: result.data.devMode === true, hint: result.data.hint ?? null }
}

/**
 * 校验验证码。★ 通过之后浏览器就带着 cookie 了（老用户）或带着那张票（新用户），
 * 但**这一层两种都拿不到**——它只需要知道下一步该显示什么。
 */
export async function verifyCode(account: string, code: string): Promise<CodeVerdict> {
  const result = await call<{ kind: string; user?: unknown }>('/api/auth/verify-code', {
    account,
    code,
  })
  if (!result.ok) return { ok: false, message: result.message }

  if (result.data.kind === 'needs-password') return { ok: true, kind: 'needs-password' }

  const user = readUser(result.data.user)
  if (!user.ok) return user
  return { ok: true, kind: 'signed-in', user: user.user }
}

/**
 * 新用户设密码。
 *
 * ★ 参数里**没有手机号**：号码从那张票里读（票在 cookie 里，是服务端签的）。
 * 上一版那句"绕过它就等于任何一个人打开控制台就能给任意号码设密码"
 * 现在由**后端**保证——这一层已经没有可绕的东西了。
 */
export async function setPassword(password: string): Promise<AuthResult> {
  const result = await call<{ user?: unknown }>('/api/auth/set-password', { password })
  if (!result.ok) return { ok: false, message: result.message }
  return readUser(result.data.user)
}

/** 密码登录（含演示账号）。★ 长度不在这里判：判的是服务端的哈希 */
export async function loginWithPassword(account: string, password: string): Promise<AuthResult> {
  const result = await call<{ user?: unknown }>('/api/auth/login-password', { account, password })
  if (!result.ok) return { ok: false, message: result.message }
  return readUser(result.data.user)
}

/**
 * 现在这个人是谁。
 *
 * ★ 首屏调它一次。**401 是正常的一种结果**（没登录），不是错误——
 * 所以这里把它翻成 `{ ok: true, user: null }` 那一支，而不是让调用方去分辨
 * "401 是没登录还是后端挂了"（后者会回 503）。
 */
export async function fetchMe(): Promise<MeResult | { ok: true; signedOut: true }> {
  const result = await get<{
    user?: unknown
    configured?: unknown
    speechModel?: unknown
  }>('/api/auth/me')

  if (!result.ok) {
    if (result.status === 401) return { ok: true, signedOut: true }
    return { ok: false, message: result.message }
  }

  const user = readUser(result.data.user)
  if (!user.ok) return user

  return {
    ok: true,
    user: user.user,
    // ★ 一位，直接从那个人的形状上读——不另存一份（两份会漂，而漂的那一刻的症状
    //   是"界面说能用、服务端说不行"）
    allowed: user.user.allowed,
    // ★ `configured` 走一次形状检查（`parsePermissions`）：它虽然来自我们自己的 BFF，
    //   但那仍然是一次网络读取。认不出来时按**站里什么都没配**算——
    //   与那道闸"判不了就不放行"同一条：宁可显示"站里还没配好"（一句可以让站长去查的话），
    //   也不要拿一份读不懂的东西去当"配好了"
    configured: parsePermissions(result.data.configured) ?? NO_PERMISSIONS,
    speechModel: typeof result.data.speechModel === 'string' ? result.data.speechModel : '',
  }
}

/** 改昵称。★ 收的是"改后的名字"，不是"这个人"——人是谁由 cookie 说 */
export async function updateNickname(nickname: string): Promise<AuthResult> {
  const result = await call<{ user?: unknown }>('/api/auth/me', { nickname })
  if (!result.ok) return { ok: false, message: result.message }
  return readUser(result.data.user)
}

/**
 * 改密码。★ 要现在的密码——只要拿着会话就能改的话，
 * 一个被借走的 cookie 就等于账号本身（判据在服务端）。
 *
 * ★ 别处的旧会话会被服务端作废（按"密码代次"），而**当前这个人不被踢出去**：
 * BFF 会把 Java 回的新票写进 cookie。这一条在界面上不用说什么，
 * 但它是这个功能值不值得用的分界——只改不改撤销，等于没改。
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<AuthResult> {
  const result = await call<{ user?: unknown }>('/api/auth/change-password', {
    currentPassword,
    newPassword,
  })
  if (!result.ok) return { ok: false, message: result.message }
  return readUser(result.data.user)
}

/**
 * 退出登录。★ 成功与否**不看后端**：真正的登出动作是 BFF 把 cookie 删掉，
 * 而那一步不依赖账号服务活着（登不出去才是最坏的：一个人连"我不是谁了"都做不到）。
 */
export async function logout(): Promise<void> {
  await call('/api/auth/logout', {})
}
