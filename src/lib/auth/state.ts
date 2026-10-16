/**
 * auth/state.ts —— 「谁在用」这件事里**与后端无关**的那一半
 *
 * 与 `lib/settings/state.ts` 同一层、同一条分工：这一层只管
 * **形状 + 本机存取 + 几个纯函数**，不碰网络、不碰 React。
 * 真接口那一段全在隔壁 `client.ts` 里，接后端时只动那一个文件。
 *
 * ★ 三条判断，每条都有理由：
 *
 * 1. **存储对象是参数，不是全局**。`loadUser(storage?)` 默认拿 `window.localStorage`，
 *    但**可以由调用方传进来**——因为 `vitest.config.mts` 跑的是 `environment: 'node'`，
 *    那里根本没有 localStorage。把存储当参数，这一层就能在 node 里真测
 *    （同一个理由让 `lib/shelf-order.ts` 收一个 `AssetStore`）。
 * 2. **读回来的东西一律不信**。`parseUser()` 逐字段验形状，坏数据返回 `null`
 *    而不是抛——localStorage 是用户能手改的地方，也是旧版本能留下的地方。
 *    与 `mergeStored()` 那句"不信任存储内容，而不是信任写入口"是同一条。
 * 3. ★ **本机那份"哪些号码设过密码"的表里，只有号码，没有密码**。
 *    这是个模拟（见 `client.ts`），但"把口令明写进 localStorage"即使只是模拟
 *    也是坏示范——这个仓库的读者会照抄。所以表里存的是一件**事实**
 *    （"这个号码在册"），不是一个**凭据**。
 */

/** 一个登录着的人。字段刻意少：前端此刻只需要这几件能显示出来的东西 */
export type AuthUser = {
  /**
   * ★ 本地模拟的 id 长这样：`local-13800138000`。
   *   刻意做成**看得出是本地造的**——真后端会返回一个不透明 id，
   *   在那之前，"这个人在这个站上还不存在"这件事应该写在数据里，而不是藏起来。
   */
  userId: string
  phone: string
  /**
   * 昵称。★ **空串是合法值**，意思是"还没起过"，不是"缺数据"。
   *   界面上它要长成一句能读的兜底（打码手机号），不是一块空白。
   */
  nickname: string
  /** 首次登录时间，ISO 8601。显示时按本地时区格式化 */
  createdAt: string
}

/** localStorage 的最小接口。★ 只要这三个方法——测试里给一个 Map 就够了 */
export type AuthStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const USER_STORAGE_KEY = 'xiaozhujue.auth.user'
export const REGISTERED_STORAGE_KEY = 'xiaozhujue.auth.registered'

/**
 * 演示用的已有账号（参考稿里那个 `13800138000`）。
 *
 * ★ 它**不写进存储**，是每次 `isRegistered()` 现算的一部分。
 *   写进去的话，第一次访问就会往用户的盘上留一条他没做过的记录，
 *   而且以后想把演示账号换掉就得写迁移。现在换一行常量就换完了。
 */
export const DEMO_REGISTERED_PHONE = '13800138000'

/**
 * 浏览器那份存储。**服务端与隐私模式一律给 `null`**——
 * `typeof window === 'undefined'` 是 SSR 那一半，`try` 是拿不到 `localStorage` 的
 * 沙箱 iframe（连读这个属性都会抛）。
 */
export function browserStorage(): AuthStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 手机号打码：`13800138000` → `138****8000` */
export function maskPhone(phone: string): string {
  // ★ 不是 11 位就**原样返回**，不套一个假的星号形状：
  //   往一个认不出来的字符串上盖四个 `*` 会让它看起来像"打码过了"，而它只是坏数据
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

/* ── 存储读写 ──────────────────────────────────────────────────────────────
   下面三个小函数是本文件唯一的 try/catch 所在。隐私模式、配额满、被禁用的存储，
   症状都是"抛"，而结论都是同一句：**这次会话照常能用，只是下次要重来**。 */

function readRaw(storage: AuthStorage | null, key: string): unknown {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function writeRaw(storage: AuthStorage | null, key: string, value: unknown): void {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存不下就算了（见上） */
  }
}

function removeRaw(storage: AuthStorage | null, key: string): void {
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    /* 同上 */
  }
}

/** 读回来的一坨 → `AuthUser`，认不出来就是 `null`（不抛） */
export function parseUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null
  const { userId } = raw as Record<string, unknown>
  // ★ `phone` 要过一遍格式：没有它，界面上那句"打码手机号"会拿一个垃圾字符串去展示，
  //   而 `maskPhone()` 会把它原样吐出来——看着像坏了，其实只是存进去时就没验
  if (typeof userId !== 'string' || !userId) return null
  const profile = parseProfile(raw)
  if (!profile) return null
  return { userId, ...profile }
}

/**
 * ★ 默认参数写 `= browserStorage()` 而不是 `= window.localStorage`：
 *   默认值在这里**求值一次、当场**，所以服务端渲染时拿到的是 `null`，
 *   不会因为"解析到这个函数时 window 还不存在"而抛。
 */
export function loadUser(storage: AuthStorage | null = browserStorage()): AuthUser | null {
  return parseUser(readRaw(storage, USER_STORAGE_KEY))
}

export function saveUser(user: AuthUser, storage: AuthStorage | null = browserStorage()): void {
  writeRaw(storage, USER_STORAGE_KEY, user)
}

export function clearUser(storage: AuthStorage | null = browserStorage()): void {
  removeRaw(storage, USER_STORAGE_KEY)
}

/**
 * 本机记着"设过密码"的那些号码（**不含**演示账号，那个是 `isRegistered()` 现算的）。
 * 认不出来的条目一律丢掉，只留 11 位数字串。
 */
export function loadRegistered(storage: AuthStorage | null = browserStorage()): string[] {
  const raw = readRaw(storage, REGISTERED_STORAGE_KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && /^\d{11}$/.test(item))
}

/** 这个号码在册吗（= 它设过密码，所以可以走密码登录） */
export function isRegistered(
  phone: string,
  storage: AuthStorage | null = browserStorage(),
): boolean {
  return phone === DEMO_REGISTERED_PHONE || loadRegistered(storage).includes(phone)
}

/** 把号码记进册。已经在了就原样返回，不重复写 */
export function addRegistered(
  phone: string,
  storage: AuthStorage | null = browserStorage(),
): string[] {
  const current = loadRegistered(storage)
  if (current.includes(phone)) return current
  const next = [...current, phone]
  writeRaw(storage, REGISTERED_STORAGE_KEY, next)
  return next
}

/* ── 账号底账：首次登录时间 + 昵称 ──────────────────────────────────────────
   ★ 它**单独一张表**，就为了一件事：**登出不该把它忘掉**。

   `AuthUser`（上面那份）是"**此刻**这个人是谁"——登出就该清，它是一次会话。
   而"这个号码第一次是什么时候来的、他给自己起了什么名字"是**这个账号的底账**，
   与此刻有没有人在用无关。（这与上面那张在册表同一个道理：登出不会让一个号码
   忘掉自己设过密码。）

   两张混在一张里的症状，是**实测出来的**、不是推想的：设了昵称「小满」→ 退出登录 →
   用密码登回来，名字没了，而且「首次登录」那个字段被刷成了刚才那一刻——
   一个写着"首次"的字段每次登录都变。

   ★ 真后端那边这两件东西存在服务端、跟着账号走，这整张表会连同
   `client.ts` 里那段补齐逻辑一起删掉。 */

export type AuthProfile = {
  phone: string
  nickname: string
  createdAt: string
}

export const PROFILES_STORAGE_KEY = 'xiaozhujue.auth.profiles'

function parseProfile(raw: unknown): AuthProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const { phone, nickname, createdAt } = raw as Record<string, unknown>
  if (typeof phone !== 'string' || !/^\d{11}$/.test(phone)) return null
  // ★ 昵称是空串时照样认——空串是"还没起过"，不是坏数据（同 `parseUser`）
  if (typeof nickname !== 'string') return null
  if (typeof createdAt !== 'string') return null
  return { phone, nickname, createdAt }
}

/** 整张底账。认不出来的条目一律丢掉，不抛 */
export function loadProfiles(storage: AuthStorage | null = browserStorage()): AuthProfile[] {
  const raw = readRaw(storage, PROFILES_STORAGE_KEY)
  if (!Array.isArray(raw)) return []
  const profiles: AuthProfile[] = []
  for (const item of raw) {
    const profile = parseProfile(item)
    if (profile) profiles.push(profile)
  }
  return profiles
}

/** 这个号码的底账，没有就是 `null` */
export function loadProfile(
  phone: string,
  storage: AuthStorage | null = browserStorage(),
): AuthProfile | null {
  return loadProfiles(storage).find((profile) => profile.phone === phone) ?? null
}

/** 写一个号码的底账。同一个号码只留一份（新的覆盖旧的） */
export function saveProfile(
  profile: AuthProfile,
  storage: AuthStorage | null = browserStorage(),
): void {
  const rest = loadProfiles(storage).filter((item) => item.phone !== profile.phone)
  writeRaw(storage, PROFILES_STORAGE_KEY, [...rest, profile])
}
