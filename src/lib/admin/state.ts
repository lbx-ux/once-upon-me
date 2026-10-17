/**
 * admin/state.ts —— 管理页那一屏的**形状**（纯函数，没有请求、没有 React）
 *
 * ★ 与 `lib/voices/state.ts` 同一条分工：这里只放"长什么样、怎么读回来"，
 *   请求走 `lib/admin/client.ts`。分成两份是因为前者能在 node 里跑、能被测试钉住，
 *   而后者要浏览器。混在一起的代价是这个仓库已经付过一次的那一种：
 *   一个纯函数被绑在浏览器 API 上，就只能靠手点去测。
 *
 * ★ 从服务端读回来的东西**一律不信**（`parseOverview`）：Java 那边加了字段、
 *   改了字段名、或者中间某个代理插了一手，症状都不该是"管理页上某一格变成 undefined"。
 *   认不出来就整份拒绝——**半个权限表比没有更坏**，它会让"这个人能不能用"变成一个
 *   看渲染顺序的答案（同 `auth/state.ts` 的 `parsePermissions` 那条注释）。
 */

import { NO_PERMISSIONS, type Permissions } from '@/lib/auth/state.ts'

/** 一行：一个人。★ 字段与 Java 的 `AdminUserRow` 逐字对应 */
export type AdminUser = {
  userId: string
  account: string
  phone: string | null
  nickname: string
  avatar: string
  role: string
  createdAt: string
  lastLoginAt: string | null
  permissions: Permissions
}

export type AdminOverview = {
  users: AdminUser[]
  /** 今天发出去的短信条数（本地那张 `sms_send_log` 数的） */
  smsToday: number
  /** 每日硬顶 */
  smsDailyCap: number
  registrationOpen: boolean
  /**
   * 「那个口令公开的账号」的登录名。★ 由后端给，不让前端写死 `'123456'`：
   *   演示账号是哪一个是**后端的事实**，前端再写一遍就多了一处会漂的字面量
   *   （换掉那个账号时，界面上会继续标高亮一个已经不存在的行）。
   *   为 `null` 时就是不标——不是"没找到"。
   */
  demoAccount: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parsePermissions(raw: unknown): Permissions | null {
  const value = asRecord(raw)
  if (!value) return null
  const keys = ['text', 'image', 'vision', 'speech'] as const
  // ★ 四个都要是布尔：缺一个就整份不认（理由见文件头）
  for (const key of keys) {
    if (typeof value[key] !== 'boolean') return null
  }
  return {
    text: value['text'] as boolean,
    image: value['image'] as boolean,
    vision: value['vision'] as boolean,
    speech: value['speech'] as boolean,
  }
}

function parseUser(raw: unknown): AdminUser | null {
  const value = asRecord(raw)
  if (!value) return null
  const str = (key: string): string =>
    typeof value[key] === 'string' ? (value[key] as string) : ''
  const userId = str('userId')
  const account = str('account')
  if (userId === '' || account === '') return null
  const permissions = parsePermissions(value['permissions'])
  if (!permissions) return null
  const phone = typeof value['phone'] === 'string' && value['phone'] !== '' ? value['phone'] : null
  const lastLoginAt =
    typeof value['lastLoginAt'] === 'string' && value['lastLoginAt'] !== ''
      ? value['lastLoginAt']
      : null
  return {
    userId,
    account,
    phone,
    nickname: str('nickname'),
    avatar: str('avatar'),
    role: str('role') || 'USER',
    createdAt: str('createdAt'),
    lastLoginAt,
    permissions,
  }
}

/**
 * 读回来的一坨 → `AdminOverview`。认不出来就是 `null`（不抛），调用方说一句人话。
 *
 * ★ 一条用户的形状不对时**整份拒绝**，不是"跳过那一条"：这是一屏**权限**。
 *   跳过一条的症状是"某个人的开关在页面上不见了"，而管理员会以为他没有那一行，
 *   于是那四个开关维持原样——他以为自己看过了全部人。
 */
export function parseOverview(raw: unknown): AdminOverview | null {
  const value = asRecord(raw)
  if (!value) return null
  if (!Array.isArray(value['users'])) return null

  const users: AdminUser[] = []
  for (const item of value['users']) {
    const user = parseUser(item)
    if (!user) return null
    users.push(user)
  }

  const number = (key: string): number =>
    typeof value[key] === 'number' ? (value[key] as number) : 0
  return {
    users,
    smsToday: number('smsToday'),
    smsDailyCap: number('smsDailyCap'),
    registrationOpen: value['registrationOpen'] === true,
    demoAccount: typeof value['demoAccount'] === 'string' ? value['demoAccount'] : null,
  }
}

/** 四个开关在界面上的名字。★ 与 `Capability` 同一组，四处（这里 / session.ts / Java / 权限表）逐字一致 */
export const CAPABILITY_LABELS: { key: keyof Permissions; label: string; hint: string }[] = [
  { key: 'text', label: '文字', hint: '写故事' },
  { key: 'image', label: '图像', hint: '画插画' },
  { key: 'vision', label: '视觉', hint: '核对面孔' },
  { key: 'speech', label: '语音', hint: '朗读' },
]

/**
 * 一次改动的结果 → 那一行**换掉**。
 *
 * ★ 服务端回的是"改完之后这个人长什么样"，界面照它整行替换，而不是**自己把
 *   勾选状态改掉**：两张纸之间只要有一次不一致（比如服务端顺手动了别的字段），
 *   界面就会停在一个"我以为我改成了"的假象上，而它看起来完全正常。
 * ★ 认不出来的响应 → 回 `null`，调用方**整页重取一次**（见组件的 `refresh`）。
 */
export function parseUserRow(raw: unknown): AdminUser | null {
  return parseUser(raw)
}

/** 没有权限时界面上那一屏的判据。★ 与后端那句 `NO_PERMISSION_MESSAGE` 是同一件事的两种说法 */
export function isAdmin(role: string | undefined | null): boolean {
  return role === 'ADMIN'
}

export { NO_PERMISSIONS }
