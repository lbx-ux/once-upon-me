/**
 * admin/client.ts —— 管理页那几条请求（只在浏览器里跑）
 *
 * 与 `lib/auth/client.ts` 同一条纪律：打的是同源的 BFF
 *   （`/api/admin/*`），不是 Java 那个地址。理由写在 `auth/client.ts` 里那段
 *   （后端地址不进浏览器、票在 httpOnly cookie 里、跨源就没有 cookie）——
 *   那三条对这几个接口一字不差地成立。
 *
 * 失败一律带一句能直接显示的话（`AdminFail` 里那个 `message`），上层不自己编文案：
 *   这一层唯一有判别力的事就是"403 与 500 是两件事"，而那句话只有服务端说得准。
 *
 * **管理动作全部走"送一个动作、回一行/空"**，并且返回的都是服务端说的那个人现在的样子。
 *   界面照它整行替换，而不是自己把本地状态改掉：两张纸之间只要有一次不一致
 *   （比如服务端顺手动了别的字段，或者干脆失败了），界面就会停在一个
 *   "我以为我改成了"的假象上，而它看起来完全正常。
 */

import { readResult, unreachable, type Result } from '@/lib/auth/response.ts'
import {
  parseModelCandidates,
  parseModelConfigView,
  parseModelTestResult,
  type ModelCandidates,
  type ModelConfigView,
  type ModelTestResult,
} from '@/lib/settings/model-config-state.ts'
import {
  parseOverview,
  parseUserRow,
  type AdminOverview,
  type AdminUser,
  type AdminUserStatus,
} from './state.ts'

export type AdminFail = { ok: false; message: string; status: number }
export type AdminOk<T> = { ok: true; data: T }

/** 管理页那几条请求的结果 */
type Outcome<T> = AdminOk<T> | AdminFail

/**
 * 打一次 BFF。
 *
 * 它把三件事收在一处：同源相对路径、`cache: 'no-store'`（管理页的每一格都是
 *   权限，命中一份缓存就是"关掉的权限看起来还开着"）、以及"网络层抛出来的异常"
 *   与"服务端回了 403"分开。★ 这个文件里有六个调用方，各写一遍 `try/catch`
 *   的话，早晚有一处会把 `unreachable` 记成 `403`——而那句话会显示成
 *   "你没有权限"，让一个管理员去怀疑自己的账号。
 */
async function call<T>(path: string, init: RequestInit): Promise<Result<T>> {
  let response: Response
  try {
    response = await fetch(path, { cache: 'no-store', ...init })
  } catch (err) {
    return unreachable(err instanceof Error ? err.message : String(err))
  }
  return readResult<T>(response)
}

/** 发一个 JSON 体。★ 六个管理动作里有五个是这种形状 */
function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }
}

export async function fetchOverview(): Promise<Outcome<AdminOverview>> {
  const result = await call<unknown>('/api/admin/users', { method: 'GET' })
  if (!result.ok) return { ok: false, message: result.message, status: result.status }

  const overview = parseOverview(result.data)
  if (!overview) {
    // 认不出来时说形状的问题，不伪造一份空的（那会显示成"这个站上一个人都没有"）
    return { ok: false, message: '服务端回的用户表不是我们认识的形状，刷新一次试试', status: 200 }
  }
  return { ok: true, data: overview }
}

/**
 * 开 / 关一个人的创作权限。★ 送的是一位（全量），理由在 BFF 那条路由与
 * Java 的 `PermissionPatch` 上各写了一遍。
 */
export async function setAllowed(userId: string, allowed: boolean): Promise<Outcome<AdminUser>> {
  return readUser(
    await call<unknown>(
      `/api/admin/users/${encodeURIComponent(userId)}/permissions`,
      json('PATCH', { allowed }),
    ),
    '改完了，但服务端回的那一行读不出来',
  )
}

/**
 * 建一个号。
 *
 * 口令只在这个参数里存在：不写进任何模块级变量、不进 localStorage、
 *   出错时的 `message` 里也不会带上它（那句话是服务端给的，服务端也不回显口令）。
 * 新号默认就有创作权——那是服务端定的（见 `AdminService#createUser`），
 *   界面上的那句提示要照这个说，而不是照"先给他关着吧"。
 */
export async function createUser(account: string, password: string): Promise<Outcome<AdminUser>> {
  return readUser(
    await call<unknown>('/api/admin/users', json('POST', { account, password })),
    '账号建出来了，但服务端回的那一行读不出来',
  )
}

/**
 * 停号 / 复号。
 *
 * 停用对这个人已经登着的会话当场生效（服务端会顺手顶密码代次），
 *   所以界面上按下去之后不需要再说一句"让他重新登录"——那件事已经发生了。
 *   要说的是相反的那句：这一步是立刻的，别以为他会慢慢掉线。
 */
export async function setStatus(
  userId: string,
  status: AdminUserStatus,
): Promise<Outcome<AdminUser>> {
  return readUser(
    await call<unknown>(
      `/api/admin/users/${encodeURIComponent(userId)}/status`,
      json('PATCH', { status }),
    ),
    '状态改了，但服务端回的那一行读不出来',
  )
}

/**
 * 删一个号。
 *
 * 成功时没有那一行可回（响应是 204 空体），所以这一条的 `data` 就是 `true`。
 *   一个已经删掉的东西的快照不是"真相"，是一份过了期的真相——界面要的是
 *   "这一行从列表里去掉"，而那件事由调用方整页重取一次来完成。
 */
export async function deleteUser(userId: string): Promise<Outcome<true>> {
  const result = await call<unknown>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  return { ok: true, data: true }
}

/** 替一个人重置密码。★ 口令从参数进来、不被回显，与 `createUser` 同一条 */
export async function resetPassword(userId: string, password: string): Promise<Outcome<AdminUser>> {
  return readUser(
    await call<unknown>(
      `/api/admin/users/${encodeURIComponent(userId)}/password`,
      json('PATCH', { password }),
    ),
    '密码改了，但服务端回的那一行读不出来',
  )
}

/** 「这一行读出来了吗」那一步，五处一样，所以只有一份 */
function readUser(result: Result<unknown>, whenUnreadable: string): Outcome<AdminUser> {
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  const row = parseUserRow(result.data)
  if (!row) return { ok: false, message: whenUnreadable, status: 200 }
  return { ok: true, data: row }
}

/* 模型配置（2026-10-17） */

/**
 * 现在生效的模型配置。
 *
 * 拿回来的东西里没有 API key 的值（服务端不给，见 `model-config.ts` 文件头），
 *   所以这一层也永远不可能把它写进界面。这不是"前端小心一点"，
 *   是那条数据根本到不了浏览器。
 */
export async function fetchModelConfig(): Promise<Outcome<ModelConfigView>> {
  const result = await call<unknown>('/api/admin/model-config', { method: 'GET' })
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  const view = parseModelConfigView(result.data)
  if (!view) {
    return { ok: false, message: '服务端回的模型配置不是我们认识的形状，刷新一次试试', status: 200 }
  }
  return { ok: true, data: view }
}

/**
 * 改一个能力的那几格。空的字段表示"这次不改"（服务端也是这么理解的）。
 *
 * 送上去的 `apiKey` 只在这一次请求的请求体里存在：不写进任何模块级变量、
 *   不进 localStorage、出错时那句话也不会带上它（服务端不回显）。
 */
export async function saveModelConfig(
  capability: string,
  patch: Record<string, string>,
): Promise<Outcome<ModelConfigView>> {
  return readView(
    await call<unknown>(
      `/api/admin/model-config/${encodeURIComponent(capability)}`,
      json('PUT', patch),
    ),
    '改完了，但服务端回的配置读不出来',
  )
}

/** 恢复默认：把这个能力那几格从覆盖里去掉，回到 `.env.local` 里的值 */
export async function clearModelConfig(capability: string): Promise<Outcome<ModelConfigView>> {
  return readView(
    await call<unknown>(`/api/admin/model-config/${encodeURIComponent(capability)}`, {
      method: 'DELETE',
    }),
    '恢复默认了，但服务端回的配置读不出来',
  )
}

/**
 * 「这一格的接口地址那边有哪些模型」（2026-10-17，站长那句
 * 「不是输入地址，就可以获取模型列表了吗」）。
 *
 * 客户端送的只有能力名，不送地址、不送 key：让浏览器指定"服务端带着 key
 *   去打哪个地址"是一个洞（见那条路由的文件头）。地址由服务端按 `CAPABILITIES` 取。
 * 拿回来的 `endpoint` 给界面显示（"候选来自 https://…"），它里面没有 key。
 * 拉不到是 `ok: true` + `data.ok === false`：那是"这一格没有候选"，不是请求出错
 *   ——两件事在界面上长得不一样（一句灰字 vs 一句红字）。
 */
export async function fetchModelCandidates(capability: string): Promise<Outcome<ModelCandidates>> {
  const result = await call<unknown>(
    `/api/admin/model-list?capability=${encodeURIComponent(capability)}`,
    { method: 'GET' },
  )
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  const candidates = parseModelCandidates(result.data)
  if (!candidates) {
    return { ok: false, message: '服务端回的候选表不是我们认识的形状', status: 200 }
  }
  return { ok: true, data: candidates }
}

function readView(result: Result<unknown>, whenUnreadable: string): Outcome<ModelConfigView> {
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  const view = parseModelConfigView(result.data)
  if (!view) return { ok: false, message: whenUnreadable, status: 200 }
  return { ok: true, data: view }
}

/**
 * 「测试连通」：拿现在生效的那份配置真打一次厂商接口（2026-10-18）。
 *
 * 送上去的只有能力名与（图像/视觉那两项的）一点输入，不送地址、不送 key：
 *   地址与 key 由服务端按 `CAPABILITIES` 从它自己那份环境里取。
 *   让浏览器指定"服务端带着 key 去打哪个地址"是一个洞（与 `fetchModelCandidates`
 *   那条注释同一条理由）。
 *
 * 没配全与打不通在这一层是两种结果，而不是两种错误：
 *   · `ok: false`（非 2xx）：这一按根本没发出去（没登录、没权限、缺一格配置）；
 *   · `ok: true` + `data.ok === false`：真发出去了，厂商那边说不行（key 不对、模型名不存在…），
 *     而那句话是 `adminFailureOf` 翻的、带着厂商的原文。
 *   界面把前者显示成"这一项还没配好"，后者显示成"试了，不通，原因如下"。
 *
 * 图像那一支会慢（2026-10-21 实测一页 6–12 秒）且一次一张图的钱，
 *   所以这里不加自己的短超时：服务端那条 `IMAGE_TIMEOUT_MS`（缺省 180 s）说了算。
 *   客户端抢先超时只会让站长在"其实已经出图了"的时候看到一句"超时"。
 */
export async function testModelCapability(
  capability: string,
  input: { prompt?: string; photo?: string } = {},
): Promise<Outcome<ModelTestResult>> {
  const result = await call<unknown>(
    '/api/admin/model-test',
    json('POST', { capability, ...input }),
  )
  if (!result.ok) return { ok: false, message: result.message, status: result.status }
  const tested = parseModelTestResult(result.data)
  if (!tested) {
    return { ok: false, message: '服务端回的测试结果不是我们认识的形状', status: 200 }
  }
  return { ok: true, data: tested }
}
