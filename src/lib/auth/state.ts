/**
 * auth/state.ts —— 「谁在用」这件事里**与后端无关**的那一半
 *
 * 与上一版相比，这个文件**去掉了一大半**，而那正是它该有的样子：
 * 在册号码表、账号底账（首次登录时间 + 昵称）、"哪些号码设过密码"、
 * 演示账号常量——那些都是在浏览器里替后端记账。后端落地之后它们全都不需要了：
 * 库里的那一行就是账，而 cookie 里的票就是"此刻这个人是谁"。
 *
 * ★ 剩下三个纯函数，恰好是"浏览器这一侧真正独有"的三件事：
 *   · `maskPhone`  —— 显示用的打码（服务端不该关心我们怎么把它显示出来）
 *   · `safeNext`   —— `?next=` 的白名单（防的是把人送到站外，纯前端的一条判据）
 *   · `parseUser`  —— **读回来的东西一律不信**：接口回的东西也可能变形状
 *     （比如后端某次改动少了一个字段），而界面拿一个缺字段的对象去渲染
 *     会以"某个地方显示了 undefined"的形式出现，那是最难查的一类。
 *
 * ★ 存储对象是参数、`localStorage` 那套东西整体退场的理由：**cookie 是唯一真相**。
 * 从前 `AuthProvider` 首屏要先渲染"未登录"再补读 localStorage（那个"闪一下"
 * 写在它的文件头里）；现在身份在服务端 cookie 里，服务端第一次就渲染对了——
 * 那一条待办（"等后端落地，这件事会自然消失"）到今天就消了。
 */

/**
 * 四项能力。★ 它现在**只有一个用途**：`configured`（站里配没配那一项密钥）。
 *
 * ★ 2026-10-18：它原来还表示"站长给了这个人哪几项"，而那一半收成了一位
 * （`AuthUser.allowed`）——四项同真同假，所以那四个布尔只是同一句话说了四遍。
 * 收掉的是"这个人"，不是"站里"：密钥那一侧仍然四项各自独立
 * （配了文本没配语音是常事，而"站里没配好"与"你没有权限"必须分开说）。
 */
export type Permissions = {
  text: boolean
  image: boolean
  vision: boolean
  speech: boolean
}

export const NO_PERMISSIONS: Permissions = {
  text: false,
  image: false,
  vision: false,
  speech: false,
}

/** 一个登录着的人。字段与 BFF 回的 `user` 对齐 */
export type AuthUser = {
  /** 服务端的主键（字符串：JS 的 number 装不下 BIGINT 的全精度） */
  userId: string
  /** 登录名：11 位手机号，或一个短账号（演示账号 `123456` 是后者） */
  account: string
  /** 手机号。★ 短账号没有它，所以是 `null` 而不是空串 */
  phone: string | null
  /**
   * 昵称。★ **空串是合法值**，意思是"还没起过"，不是"缺数据"。
   * 界面上它要长成一句能读的兜底（打码手机号），不是一块空白。
   */
  nickname: string
  role: string
  /** 首次登录时间，带时区的 ISO 8601（服务端补的 `+08:00`） */
  createdAt: string
  /**
   * **这个人此刻能不能创作**。★ 一位。
   *
   * ★ 2026-10-18 之前这里是四个布尔（站长按账号发能力）。现在注册即全开，
   *   站长手里留的是"把某个人的权限收回来"——所以它只剩一位，
   *   而它**每次都由后端现给**（`GET /api/auth/me`），不是票里的快照。
   */
  allowed: boolean
}

/**
 * 手机号打码：`13800138000` → `138****8000`。
 *
 * ★ 不是 11 位就**原样返回**（短账号、`null`、坏数据都一样），不套一个假的星号形状：
 * 往一个认不出来的字符串上盖四个 `*` 会让它看起来像"打码过了"，而它只是坏数据。
 */
export function maskPhone(phone: string | null | undefined): string {
  if (typeof phone !== 'string') return ''
  return /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone
}

/**
 * `?next=` 能不能当落点。★ 只收**站内单斜杠路径**。
 *
 * `//evil.com` 与 `https://evil.com` 都是**协议相对**的写法，浏览器会把它们当外站——
 * 一个登录页把你送到站外，是这整件事里最经典的一个洞。所以判据是白名单式的：
 * 必须 `/` 开头、第二个字符不能又是 `/`、不能带协议、不能带反斜杠
 * （`/\evil.com` 在部分浏览器里同样被当外站）。
 */
export function safeNext(value: string | undefined | null): string | null {
  if (!value) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  if (value.includes('\\')) return null
  return value
}

/**
 * 站里配齐了做一本书要的那两项吗：**文本 + 图像**。★ 这两个是那件事的最小集合。
 *
 * ★ 2026-10-18：它的入参现在**只可能是 `configured`**（"站里那份"）——
 *   "这个人有没有权限"已经是单独的一位（`AuthUser.allowed`），不再从四项里推。
 *   一处调用点的形状是 `allowed && canCreate(configured)`：
 *   前半句是"他可以创作吗"，后半句是"站里能画能写吗"，两句各自能说清是哪一半不行。
 */
export function canCreate(configured: Permissions): boolean {
  return configured.text && configured.image
}

/**
 * 读一份四项能力的形状（现在只有 `configured` 走它）。
 *
 * ★ 导出它是因为它有一个**真的读者**：`lib/auth/client.ts` 拿它验 `configured`。
 *   那四个布尔虽然来自我们自己的 BFF，但那仍然是一次网络读取——"读回来的一律不信"
 *   是这一层唯一的纪律（同文件头那条）。
 * ★ 四个都要是布尔：缺一个就当整份认不出来——半个能力表比没有更坏，
 *   它会让"站里到底配没配"变成一个看调用顺序的答案。
 */
export function parsePermissions(raw: unknown): Permissions | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const keys = ['text', 'image', 'vision', 'speech'] as const
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

/**
 * 读回来的一坨 → `AuthUser`，认不出来就是 `null`（不抛）。
 *
 * ★ `account` 要过一遍形状：没有它，界面上那句"打码手机号"会拿一个垃圾字符串去展示，
 * 而 `maskPhone()` 会把它原样吐出来——看着像坏了，其实只是存进去时就没验。
 *
 * ★ `allowed` **必须是布尔**，缺了就整份不认（2026-10-18 加的那一位）。
 *   不把它当成 `false`：那会让"服务端少回了一个字段"显示成"你没有权限，请联系管理员"
 *   ——一句要人去找站长的假话。认不出来的症状应该是那句"登录态不是我们认识的形状"。
 */
export function parseUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>

  const userId = value['userId']
  const account = value['account']
  const nickname = value['nickname']
  const role = value['role']
  const createdAt = value['createdAt']
  const phone = value['phone']
  const allowed = value['allowed']

  if (typeof userId !== 'string' || userId === '') return null
  if (typeof account !== 'string' || !/^\d{6,11}$/.test(account)) return null
  // ★ 昵称是空串时照样认——空串是"还没起过"，不是坏数据（与后端那条同名判断同一个口径）
  if (typeof nickname !== 'string') return null
  if (typeof role !== 'string') return null
  if (typeof createdAt !== 'string') return null
  // ★ 手机号可空，但**给了就必须是个号**：一个 `"abc"` 会让打码那一格吐出原样
  if (phone !== null && (typeof phone !== 'string' || !/^\d{11}$/.test(phone))) return null
  if (typeof allowed !== 'boolean') return null

  return {
    userId,
    account,
    phone: phone as string | null,
    nickname,
    role,
    createdAt,
    allowed,
  }
}
