/**
 * requests/state.ts —— 权限申请那一行的**形状**（纯函数，没有请求、没有 React）
 *
 * ★ 用户侧（「我那条还在不在」）与管理侧（「谁申请了什么」）共用这一份类型，
 *   因为它们是**同一行**：Java 那边两处都返回 `AdminRequestRow`。分成两个类型的话，
 *   两边各写一遍 parse，而字段名一漂，症状就是"申请在管理端看得见、在用户端显示为空"。
 *
 * ★ 与 `lib/admin/state.ts` 同一条纪律：**从服务端读回来的东西一律不信**。
 *   认不出来就整份拒绝（列表）或整条丢掉（见 `parseRequestList` 的注释），
 *   不伪造一个"看起来正常"的默认值——一行假的好数据，会让站长照着它做决定。
 */

import type { Permissions } from '@/lib/auth/state.ts'

/** 一条申请的状态。★ 与 Java 的 `PermissionRequest.PENDING/APPROVED/REJECTED` 逐字一致 */
export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export type PermissionRequestRow = {
  requestId: string
  /** 申请人的号。★ 字符串：它只用来当 key 与转发，不参与算术 */
  userId: string
  /** ★ 管理端那句「清楚的看到是谁发送的请求」全靠这三样 */
  account: string
  nickname: string
  phone: string | null
  /** 他**手里现在有的**能力（不是这次申请的） */
  current: Permissions
  /** 他这次**要的**能力 */
  wants: Permissions
  /** 他写的那句说明。没写就是 `null`（不是空串） */
  note: string | null
  status: RequestStatus
  createdAt: string
  decidedAt: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 没有就归成 `null`，**空串也算没有**（Java 那边 `""` 与 `null` 都出现过） */
function nullable(value: unknown): string | null {
  const s = str(value)
  return s === '' ? null : s
}

function parseWants(raw: unknown): Permissions | null {
  const value = asRecord(raw)
  if (!value) return null
  const keys = ['text', 'image', 'vision', 'speech'] as const
  // ★ 四个都要是布尔。缺一个就整条不认——"半个 wants"在管理端会画出一排
  //   看着像没勾的框，而站长分不清那是"他不要"还是"我读不出来"
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

const STATUSES: readonly RequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED']

function parseStatus(raw: unknown): RequestStatus | null {
  const s = str(raw)
  return STATUSES.includes(s as RequestStatus) ? (s as RequestStatus) : null
}

/**
 * 一行 → `PermissionRequestRow`。认不出来回 `null`（不抛）。
 *
 * ★ `requestId` 或 `account` 读不出来就是整条不认：这两个是那一行的**身份**。
 *   缺了号就没法批（点按钮要拼进 URL），缺了账号就看不出是谁——
 *   而"看不出是谁的申请"正是这一整个功能要替邮件补上的那一格。
 */
export function parseRequestRow(raw: unknown): PermissionRequestRow | null {
  const value = asRecord(raw)
  if (!value) return null

  const requestId = str(value['requestId'])
  const account = str(value['account'])
  if (requestId === '' || account === '') return null

  const wants = parseWants(value['wants'])
  if (!wants) return null
  // ★ `current`（他现在手里有什么）与 `wants` 同等重要，缺一不可：
  //   管理页上"这次批准会改变什么"靠的就是这两个的差。少了它那一格只能显示成空，
  //   而空与"他什么都没有"长得一样——那会让站长以为这次是从零开始。
  const current = parseWants(value['current'])
  if (!current) return null
  const status = parseStatus(value['status'])
  if (!status) return null

  return {
    requestId,
    userId: str(value['userId']),
    account,
    nickname: str(value['nickname']),
    phone: nullable(value['phone']),
    current,
    wants,
    note: nullable(value['note']),
    status,
    createdAt: str(value['createdAt']),
    decidedAt: nullable(value['decidedAt']),
  }
}

/**
 * 一个数组 → 若干行。★ **任意一行形状不对就整份拒绝**（与 `parseOverview` 同一条）：
 * 这是给管理员看的一列**要他做决定的东西**。跳过一条的后果不是"少一行"，
 * 是"他以为他把这一列都看完了"——而那条被跳过的申请还挂在待处理里。
 */
export function parseRequestList(raw: unknown): PermissionRequestRow[] | null {
  if (!Array.isArray(raw)) return null
  const rows: PermissionRequestRow[] = []
  for (const item of raw) {
    const row = parseRequestRow(item)
    if (!row) return null
    rows.push(row)
  }
  return rows
}

/** `GET /api/permission-requests/mine` → `{ request: … | null }` */
export function parseMine(raw: unknown): PermissionRequestRow | null {
  const value = asRecord(raw)
  if (!value) return null
  if (value['request'] === null) return null
  return parseRequestRow(value['request'])
}

/**
 * 要显示成「文字 / 图像 / 视觉 / 语音」中的哪几个。
 *
 * ★ 顺序固定在 `CAPABILITY_LABELS` 那一侧（这里不自己排）：管理端与用户端
 *   列的必须是同一组、同一个次序，否则"你申请的是这三项"与"站长看到的三项"
 *   会在两个屏幕上看起来不一样。
 */
export function wantsList(
  wants: Permissions,
  labels: { key: keyof Permissions; label: string }[],
): string[] {
  return labels.filter((l) => wants[l.key]).map((l) => l.label)
}
