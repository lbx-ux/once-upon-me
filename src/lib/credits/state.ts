/**
 * credits/state.ts —— 额度这一套的形状与读法（纯函数，没有请求、没有 React）
 *
 * 与 `admin/state.ts`、`voices/state.ts` 同一条分工：这里只放"长什么样、怎么读回来"，
 *   请求分别在 `client.ts`（浏览器）与 `server.ts`（服务端）里。
 *   混在一起的代价这个仓库付过一次：纯函数被绑在浏览器 API 上，就只能靠手点去测。
 *
 * ★ 从服务端读回来的东西一律不信（`parseCreditView` / `parseAdminCreditOverview`）：
 *   Java 那边加字段、改字段名、或者中间某个代理插了一手，症状都不该是
 *   "界面上某一格变成 undefined"。而额度是钱——半份额度比没有更坏，
 *   它会让"我还能画几本"变成一个看渲染顺序的答案。
 */

/** 一笔流水。★ `reason` 是机读的四个值之一（见 Java 的 `BookCredit`），界面上再用 `reasonLabelOf` 翻 */
export type CreditEntry = {
  id: string
  delta: number
  reason: string
  ref: string | null
  note: string
  createdAt: string
}

/** 一个人自己的额度：剩几本 + 最近几十笔 */
export type CreditView = { balance: number; entries: CreditEntry[] }

/** 一个批次（同一批生成的码） */
export type AdminCodeBatch = {
  batch: string
  booksPerCode: number
  count: number
  redeemed: number
  createdAt: string
  note: string
}

/** 管理页那一张卡要的全部数 */
export type AdminCreditOverview = {
  totalBalance: number
  usersWithCredits: number
  codesTotal: number
  codesRedeemed: number
  /** 账本 SUM(delta) 与余额 SUM(balance) 的差。正常恒为 0 */
  ledgerDrift: number
  batches: AdminCodeBatch[]
}

/** 一批码生成完的结果（明文只出现这一次） */
export type CodeBatchResult = {
  batch: string
  booksPerCode: number
  codes: string[]
  expiresAt: string | null
}

/** 兑换成功：换到几本、现在还剩几本、这张码的后四位 */
export type RedeemOutcome = { books: number; balance: number; codeTail: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 读一笔流水。★ 认不出就整条不认，不猜 */
function parseEntry(raw: unknown): CreditEntry | null {
  const value = asRecord(raw)
  if (!value) return null
  const id = asString(value['id'])
  const delta = asNumber(value['delta'])
  const reason = asString(value['reason'])
  const createdAt = asString(value['createdAt'])
  if (id === '' || delta === null || reason === '' || createdAt === '') return null
  return {
    id,
    delta,
    reason,
    ref: typeof value['ref'] === 'string' && value['ref'] !== '' ? value['ref'] : null,
    note: asString(value['note']),
    createdAt,
  }
}

export function parseCreditView(raw: unknown): CreditView | null {
  const value = asRecord(raw)
  if (!value) return null
  const balance = asNumber(value['balance'])
  if (balance === null || !Array.isArray(value['entries'])) return null
  const entries: CreditEntry[] = []
  for (const item of value['entries']) {
    const entry = parseEntry(item)
    if (!entry) return null
    entries.push(entry)
  }
  return { balance, entries }
}

function parseBatch(raw: unknown): AdminCodeBatch | null {
  const value = asRecord(raw)
  if (!value) return null
  const batch = asString(value['batch'])
  const booksPerCode = asNumber(value['booksPerCode'])
  const count = asNumber(value['count'])
  const redeemed = asNumber(value['redeemed'])
  if (batch === '' || booksPerCode === null || count === null || redeemed === null) return null
  return {
    batch,
    booksPerCode,
    count,
    redeemed,
    createdAt: asString(value['createdAt']),
    note: asString(value['note']),
  }
}

export function parseAdminCreditOverview(raw: unknown): AdminCreditOverview | null {
  const value = asRecord(raw)
  if (!value) return null
  const number = (key: string): number | null => asNumber(value[key])
  const fields = {
    totalBalance: number('totalBalance'),
    usersWithCredits: number('usersWithCredits'),
    codesTotal: number('codesTotal'),
    codesRedeemed: number('codesRedeemed'),
    ledgerDrift: number('ledgerDrift'),
  }
  for (const field of Object.values(fields)) {
    if (field === null) return null
  }
  if (!Array.isArray(value['batches'])) return null
  const batches: AdminCodeBatch[] = []
  for (const item of value['batches']) {
    const batch = parseBatch(item)
    if (!batch) return null
    batches.push(batch)
  }
  return {
    totalBalance: fields.totalBalance as number,
    usersWithCredits: fields.usersWithCredits as number,
    codesTotal: fields.codesTotal as number,
    codesRedeemed: fields.codesRedeemed as number,
    ledgerDrift: fields.ledgerDrift as number,
    batches,
  }
}

/** 兑换成功那条响应。★ 形状与服务端逐字对应（books / balance / codeTail） */
export function parseRedeemOutcome(raw: unknown): RedeemOutcome | null {
  const value = asRecord(raw)
  if (!value) return null
  const books = asNumber(value['books'])
  const balance = asNumber(value['balance'])
  const codeTail = asString(value['codeTail'])
  if (books === null || balance === null || codeTail === '') return null
  return { books, balance, codeTail }
}

/** 一批码。★ `codes` 里每一项都必须是字符串——半份码比没有更坏 */
export function parseCodeBatchResult(raw: unknown): CodeBatchResult | null {
  const value = asRecord(raw)
  if (!value) return null
  const batch = asString(value['batch'])
  const booksPerCode = asNumber(value['booksPerCode'])
  if (batch === '' || booksPerCode === null || !Array.isArray(value['codes'])) return null
  const codes: string[] = []
  for (const item of value['codes']) {
    if (typeof item !== 'string' || item === '') return null
    codes.push(item)
  }
  return {
    batch,
    booksPerCode,
    codes,
    expiresAt: typeof value['expiresAt'] === 'string' ? value['expiresAt'] : null,
  }
}

/**
 * 用户输入的码 → 规范形。
 *
 * ★ 与 Java 的 `CodeFactory#normalize` **逐字同一条规则**（转大写、只留字母数字）。
 *   两边都做不是为了保险：前端这一份是为了在发请求之前就能把"长度不对"说清楚，
 *   服务端那一份才是判据。前端这份永远不能替服务端做决定。
 */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** 分成四组，便于人读与手抄。长度不对时原样回 */
export function formatCode(code: string): string {
  const clean = normalizeCode(code)
  if (clean.length !== 16) return clean
  return clean.replace(/(.{4})(?=.)/g, '$1-')
}

/** 账本那一行的中文说法。★ 认不出的 reason 原样显示，不编一个 */
export function reasonLabelOf(reason: string): string {
  switch (reason) {
    case 'grant':
      return '补发'
    case 'redeem':
      return '兑换码'
    case 'consume':
      return '画了一本'
    case 'refund':
      return '退回'
    default:
      return reason
  }
}

/** `+2 本` / `-1 本`。★ 符号是给人看的，0 不画 */
export function deltaTextOf(delta: number): string {
  if (delta > 0) return `+${delta} 本`
  return `${delta} 本`
}

/** 分 → 元（两位小数）。管理页只显示，不参与计算 */
export function yuanOf(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * 额度不够时那句人话。★ 与 Java 的 `CreditService#spend` 那一句**一模一样**：
 *   同一个失败在服务端与界面上各说一遍、两句不同，用户会以为是两件事。
 */
export const NO_CREDITS_MESSAGE =
  '这一本的额度用完了。已经做好的书还在书架里，随时能读；要再做一本，去「兑换」输入一张码。'
