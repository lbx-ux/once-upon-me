/**
 * auth/client.ts —— ★ **「接后端」那条缝就是这一个文件**
 *
 * 参考稿的 README 建议了四个接口，这里就是那四个（加一个改昵称的），
 * 一个不多一个不少：
 *
 *   sendCode(phone)                   → POST /auth/send-code
 *   verifyCode(phone, code)           → POST /auth/verify-code   （返回 isNewUser）
 *   setPassword(phone, password)      → POST /auth/set-password  （只在已验证的会话里可调）
 *   loginWithPassword(phone, password)→ POST /auth/login-password
 *   updateNickname(user, nickname)    → PATCH /auth/me
 *
 * ★ 现在**全是本地模拟，一个请求都不发**。接后端时把每个函数体换成 `fetch`，
 *   连返回类型一起换（下面那几个 `type` 就是契约），**上层一行都不用改**——
 *   页面、Provider、侧栏全都只认这五个函数的签名，不认它们内部干了什么。
 *
 * ── 模拟规则（要自洽，不能每个号码每次都被当成新用户）──────────────────────
 *
 * 1. 验证码：**任意 6 位数字都通过**（真实短信通道不在这一轮里）。
 * 2. 号码在册（设过密码）→ 验证码通过后直接登录；不在册 → 进「设置密码」。
 * 3. 设置密码成功后，这个号码进本机那张"在册表"（`state.ts`，**只记号码**）。
 * 4. 密码登录：在册 → 密码 ≥ 8 位就通过；不在册 → 回一句
 *    **「这个号码还没设过密码，先用验证码登录」**——这是一句真话，
 *    也正是真后端会说的话，所以它不是在糊弄。
 * 5. `13800138000` 是在册的（参考稿那个演示已有账号），走验证码能直接进。
 * 6. ★ **本地一个密码都不存**。表里那件事实是"这个号码在册"，不是一个凭据。
 *    即使只是模拟，把口令明写进 localStorage 也是坏示范——这个仓库的读者会照抄。
 *
 * ── 一处刻意造出来的东西 ─────────────────────────────────────────────────
 *
 * `MOCK_LATENCY_MS`：每个函数都先等一会儿。真接口**一定**是异步的，
 * 而一个立刻 resolve 的模拟会让界面上"正在发验证码""正在登录"那些 pending 态
 * **一次都走不到**——那些态于是永远没被验过，接后端那天才第一次出问题。
 * 这个数是这一层唯一凭空写下的东西，接后端时连同它一起删掉。
 */

import {
  addRegistered,
  browserStorage,
  isRegistered,
  loadProfile,
  loadUser,
  saveProfile,
  type AuthStorage,
  type AuthUser,
} from './state.ts'

/** 手机号：11 位大陆号 */
const PHONE_PATTERN = /^1\d{10}$/
/** 验证码：6 位数字 */
const CODE_PATTERN = /^\d{6}$/
/** 密码下限。★ 与界面上那句「至少 8 位」是同一个数，改要一起改 */
export const PASSWORD_MIN = 8

/** 见文件头「一处刻意造出来的东西」 */
const MOCK_LATENCY_MS = 320

/** 失败一律带一句**能读给人看的话**。上层直接把它显示出来，不自己编文案 */
export type AuthFail = { ok: false; message: string }
/** 成功带一个登录态。`AuthUser` 的形状见 `state.ts` */
export type AuthOk = { ok: true; user: AuthUser }
export type AuthResult = AuthOk | AuthFail

/**
 * 验证码通过之后的三种结局。
 * ★ `kind` 与真后端的 `isNewUser` 一一对应：`signed-in` 是"老用户，登录完了"，
 *   `needs-password` 是"新用户，先去设密码"。
 */
export type CodeVerdict =
  | { ok: true; kind: 'signed-in'; user: AuthUser }
  | { ok: true; kind: 'needs-password'; phone: string }
  | AuthFail

export type CodeResult = { ok: true } | AuthFail

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 本机这次的"已验证会话"。
 *
 * ★ 它是**模块级的一个变量**，而且不落盘——这正是"会话"该有的样子：
 *   刷新页面就没了（真后端那边对应一个短命的服务端 session）。
 *   它存在的唯一目的是兑现"`setPassword` 只在已通过验证码的会话里可调"这条：
 *   没有它，任何一个人打开控制台就能给任意号码设密码。
 */
let verifiedPhone: string | null = null

function fail(message: string): AuthFail {
  return { ok: false, message }
}

/**
 * 造一个登录态。
 *
 * ★ `createdAt` 与 `nickname` 取自**这个号码的底账**（`state.ts` 的
 *   `loadProfile`），退一步才看本机此刻的登录态：不这么做的话，同一个人重新登录
 *   会把"首次登录时间"刷成现在——一个写着"首次"的字段每次登录都变，是坏的。
 *
 * ★ **底账是必须的一层，不能只读 `loadUser()`**：登出会清掉登录态，
 *   所以"登出 → 用密码登回来"这条路上，登录态里什么都没有，
 *   昵称与首次登录时间就一起丢了。这是实测出来的症状，不是推想的
 *   （见 `state.ts` 里 `AuthProfile` 那段）。
 *
 * 真后端那边这个值存在服务端，这整段逻辑跟着删掉。
 */
function buildUser(phone: string, storage: AuthStorage | null): AuthUser {
  const session = loadUser(storage)
  const known =
    loadProfile(phone, storage) ??
    // 退路：底账还没写过、但登录态里正好是这个号码（老版本的数据）
    (session?.phone === phone
      ? { phone, nickname: session.nickname, createdAt: session.createdAt }
      : null)

  const user: AuthUser = {
    // ★ 看得出是本地造的（见 state.ts 里 `userId` 那条注释）
    userId: `local-${phone}`,
    phone,
    nickname: known?.nickname ?? '',
    createdAt: known?.createdAt ?? new Date().toISOString(),
  }
  // 第一次见到这个号码就把底账记下来。★ 写它和 `addRegistered` 是同一类事：
  //   本地模拟必须自己记着"这个号码来过"，真后端不需要
  saveProfile({ phone, nickname: user.nickname, createdAt: user.createdAt }, storage)
  return user
}

/** 发验证码。真接口那边服务端还要做频控，前端这 60 秒倒计时只是体验，不是防线 */
export async function sendCode(
  phone: string,
  storage: AuthStorage | null = browserStorage(),
): Promise<CodeResult> {
  void storage
  await wait(MOCK_LATENCY_MS)
  if (!PHONE_PATTERN.test(phone)) return fail('请输入 11 位大陆手机号')
  return { ok: true }
}

/** 校验验证码。★ 通过之后才谈得上"新用户还是老用户" */
export async function verifyCode(
  phone: string,
  code: string,
  storage: AuthStorage | null = browserStorage(),
): Promise<CodeVerdict> {
  await wait(MOCK_LATENCY_MS)
  if (!PHONE_PATTERN.test(phone)) return fail('请输入 11 位大陆手机号')
  if (!CODE_PATTERN.test(code)) return fail('请输入 6 位验证码')

  verifiedPhone = phone
  if (!isRegistered(phone, storage)) return { ok: true, kind: 'needs-password', phone }
  return { ok: true, kind: 'signed-in', user: buildUser(phone, storage) }
}

/** 新用户设密码。叫之前必须走过 `verifyCode` 且它认了同一个号码 */
export async function setPassword(
  phone: string,
  password: string,
  storage: AuthStorage | null = browserStorage(),
): Promise<AuthResult> {
  await wait(MOCK_LATENCY_MS)
  if (verifiedPhone !== phone) return fail('手机号还没验证过，请先用验证码登录')
  if (password.length < PASSWORD_MIN) return fail(`密码至少 ${PASSWORD_MIN} 位`)

  addRegistered(phone, storage)
  verifiedPhone = null // 用完即焚：一个已验证会话只够设一次密码
  return { ok: true, user: buildUser(phone, storage) }
}

/** 密码登录 */
export async function loginWithPassword(
  phone: string,
  password: string,
  storage: AuthStorage | null = browserStorage(),
): Promise<AuthResult> {
  await wait(MOCK_LATENCY_MS)
  if (!PHONE_PATTERN.test(phone)) return fail('请输入 11 位大陆手机号')
  // ★ 这一条要排在密码长度前面：对一个根本不在册的号码说"密码至少 8 位"，
  //   是在让人去改一个不存在的密码
  if (!isRegistered(phone, storage)) return fail('这个号码还没设过密码，先用验证码登录')
  if (password.length < PASSWORD_MIN) return fail(`密码至少 ${PASSWORD_MIN} 位`)
  return { ok: true, user: buildUser(phone, storage) }
}

/**
 * 改昵称。
 *
 * ★ 它进这个文件而不是留在 Provider 里，就一条理由：**账号的每一处写入都要走同一条缝**。
 *   留在 Provider 里的话，接后端那天要记得在两个地方加 `fetch`，而漏掉的那一处
 *   会安静地"改了但没存"——它不报错，只是刷新之后名字回去了。
 */
export async function updateNickname(
  user: AuthUser,
  nickname: string,
  storage: AuthStorage | null = browserStorage(),
): Promise<AuthResult> {
  await wait(MOCK_LATENCY_MS)
  // 空串是合法值（"还没起过"），所以这里只裁空白，不做非空校验
  const trimmed = nickname.trim()
  // ★ 底账也要跟着改。漏掉这一句的症状是"改完当场对、登出再登入变回旧名字"——
  //   它不报错，只是名字悄悄回去了，正是这个文件头要防的那一类
  saveProfile({ phone: user.phone, nickname: trimmed, createdAt: user.createdAt }, storage)
  return { ok: true, user: { ...user, nickname: trimmed } }
}
