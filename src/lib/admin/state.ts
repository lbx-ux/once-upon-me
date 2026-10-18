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
 *   认不出来就整份拒绝——**半份权限表比没有更坏**，它会让"这个人能不能用"变成一个
 *   看渲染顺序的答案（同 `auth/state.ts` 的 `parsePermissions` 那条注释）。
 *
 * ★ 2026-10-18：一个人那一行的 `permissions`（四个布尔）收成 `allowed`（一位），
 *   与库里那一列、与 Java 的 `AdminUserRow` 同名。管理页上因此只有**一列**开关。
 */

/**
 * 一个号的状态。★ 与 Java 的 `User.STATUS_ACTIVE` / `STATUS_DISABLED` 逐字一致。
 *
 * ★ 只有两个值，而不是"五个状态"：这个产品里账号只有"能用"与"停用"两件事。
 *   多出来的状态（待验证、锁定…）每一个都意味着界面上要多一种显示方式，
 *   而此刻没有任何一条规则要求它们。
 */
export type AdminUserStatus = 'ACTIVE' | 'DISABLED'

/** 一行：一个人。★ 字段与 Java 的 `AdminUserRow` 逐字对应 */
export type AdminUser = {
  userId: string
  account: string
  phone: string | null
  nickname: string
  /**
   * 库里的头像 id。**现在没有任何地方读它**（2026-10-17：用户要求"只提供一个默认
   * 头像、不可以切换"，于是头像不再是用户数据，前端也没有了那条挑头像的通路）。
   *
   * ★ 它**留在这里是刻意的**，与 `AuthUser.avatar` 那次删除（`lib/auth/state.ts`）
   *   不是同一条判断：那一份是"界面上那个人是谁"，字段只该有读者；而这一份的
   *   文件头写着**逐字对应 Java 的 `AdminUserRow`**——它是后端那张表的镜子。
   *   从镜子里抹掉一格，镜子里的人和真人就对不上了，而下一个照镜子的人
   *   （比如要查"这个人库里到底存的什么"）会以为那一格不存在。
   * ★ 真要清掉它，得连着 Java 的 DTO 与 `avatars` 那一列一起清——那是迁移，不是这一轮。
   */
  avatar: string
  role: string
  /** `ACTIVE` / `DISABLED`。★ 认不出来的一律当 `ACTIVE`（与 `User.isActive` 同一口径） */
  status: AdminUserStatus
  createdAt: string
  lastLoginAt: string | null
  /**
   * 有没有创作权。★ **一位**（2026-10-18）。
   *
   * ★ 它与 `status` 是两件事，别把它们读成同一个：这个人是**关着**的（他点开始创作会被拦），
   *   那个是**登不进来**的（会话当场作废）。
   */
  allowed: boolean
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

function parseUser(raw: unknown): AdminUser | null {
  const value = asRecord(raw)
  if (!value) return null
  const str = (key: string): string =>
    typeof value[key] === 'string' ? (value[key] as string) : ''
  const userId = str('userId')
  const account = str('account')
  if (userId === '' || account === '') return null
  // ★ 这一位必须是布尔，缺了就整份不认（理由见文件头）。不把它当 `false`：
  //   那会让"服务端少回了一个字段"看起来像"这个人被关了权限"，
  //   而站长会据此去点那个开关——点完才发现本来就是关着的。
  if (typeof value['allowed'] !== 'boolean') return null
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
    // ★ 只认确切的 `DISABLED`，别的一律当 `ACTIVE`：这一列是后来才加的，
    //   老响应里根本没有它（`undefined`），而把"读不出来"当成"停用"会让管理页上
    //   整张表看起来都被停过——那是比"少显示一条信息"严重得多的一种假象。
    //   与 Java 的 `User.isActive`（null/空/ACTIVE 都算 active）是同一条口径。
    status: str('status') === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    createdAt: str('createdAt'),
    lastLoginAt,
    allowed: value['allowed'] as boolean,
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

/**
 * 「这个用户做了多少东西」——管理页那一列的数（工单 16，2026-10-17）。
 *
 * ★★ 它**必须住在这一份文件里**，而不是住在算它的那一个（`usage.ts`）里：
 *   界面上要显示它，而显示它的 `AdminScreen` 是**客户端组件**；
 *   算它的那个模块要读磁盘（`asset-scope` → 引擎 → `node:fs/promises`），
 *   被客户端组件 import 的后果是**整页 500**：
 *
 * ```
 *   Module build failed: UnhandledSchemeError: Reading from "node:fs/promises"
 *   ./src/lib/engine/providers/stores.ts ← usage.ts ← AdminScreen.tsx
 * ```
 *
 *   ★ 这条是**端到端那一步照出来的**（`.out/verify-ownership.mjs` 里那条
 *   "管理页打得开 → 200"），而在此之前 typecheck / lint / 单元测试全绿——
 *   因为静态检查管不着"这个 import 把 node 带进了浏览器包"。
 *   形状与文案在这里、数数的活儿在那边，这条界线与 `lib/voices/state.ts`
 *   对 `client.ts` 的分工是同一条。
 */
export type AdminUsage = { books: number; cards: number; children: number }

/**
 * 那一列上的一句话。
 *
 * ★ 三种情形是三件不同的事，不能用一个写法糊过去：
 *   · 数不出来（`undefined`）→「—」：这一列坏了，别说"0 本"（那是假数）
 *   · 全零 →「还没有」：照实，而且比「0 本 · 0 张卡 · 0 个孩子」少一屏噪音
 *   · 有东西 →「3 本 · 2 张卡 · 1 个孩子」
 */
export function usageTextOf(usage: AdminUsage | undefined): string {
  if (!usage) return '—'
  if (usage.books === 0 && usage.cards === 0 && usage.children === 0) return '还没有'
  return `${usage.books} 本 · ${usage.cards} 张卡 · ${usage.children} 个孩子`
}

/**
 * 那一列在界面上的名字。
 *
 * ★ 2026-10-18 之前这里是四个（文字/图像/视觉/语音），一个人一格。
 *   权限收成一位之后只剩这一列，而它问的问题也变了：不再是"他能用哪几项"，
 *   而是"站长有没有把他的权限收回去"。
 */
export const ACCESS_COLUMN = { label: '权限', hint: '能否创作' } as const

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
