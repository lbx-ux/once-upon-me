/**
 * profile.ts —— 孩子的**档案**：他是谁（纯函数，不碰文件、不碰网络、不碰 React）
 *
 * ## 为什么档案与角色卡是两份东西
 *
 * 一句话：**卡回答"他长什么样"，档案回答"他是谁"。**
 *
 * | | 角色卡（ADR-0007） | 档案（这里） |
 * | --- | --- | --- |
 * | 存什么 | 锚点、参考图、画风、provenance | 名字、读音、年龄档、他喜欢什么 |
 * | 版本 | **有 revision，只能追加**——旧书那些页的出处挂在上面 | 没有版本，改就是改 |
 * | 变了会怎样 | 旧图与新卡混在一本书里，页面上看得出来（指纹变了） | 旧书里那几页的文字不会跟着变 |
 * | 谁在读 | 每一页的 prompt、比对清单 | 界面上的称呼、创作流第 1 步 |
 *
 * ★ 把名字塞进卡里是最省事的做法，也是这一层要挡住的做法：卡是**内容寻址**的
 *   （指纹只算 schemaVersion / cardId / revision / anchors / style），名字进去
 *   要么改变指纹语义（改个错别字就"换了一版形象"），要么落在指纹之外——
 *   那它就是一份**看起来在资产里、其实不受资产纪律管**的数据。
 *   所以名字另存一份；`CharacterCard.childId` 是两个文件之间**唯一**的那根线。
 *
 * ## ★ 字段表**不在这份文件里**，它已经存在
 *
 * 领域层早就有一个 `ChildProfile`（`engine/domain.ts`），注释写着"Step 1『孩子是谁』的输入"，
 * 字段是 childId / name / **nameReading** / ageBand / lookTags / interestTags。
 * 这一层第一版自己又写了一个 `ChildProfile`（把读音叫成 `reading`）——两处同时存在，
 * 闸门当场报了 `Duplicate identifier`。那不是命名问题，是**同一个概念被写了两遍**：
 * 表单收的、引擎认的、档案存的必须是同一组字段，否则"表单里能选的年龄档，
 * 档案里存不下"这类错会长出来（`creation/state.ts` 的文件头就为这条写过一次）。
 *
 * 所以这里只做一件事：**给那份领域类型加上"存在磁盘上"需要的三个数**。
 */

import { AGE_BANDS, type AgeBand, type ChildProfile } from '../domain.ts'
import { EngineError } from '../errors.ts'

/**
 * 磁盘上的那条记录 = 领域里的"他是谁" + 记录本身的三个数。
 *
 * `schemaVersion` 与卡一样是**结构**版本，不是内容版本——档案没有内容版本。
 */
export type ChildRecord = ChildProfile & {
  schemaVersion: 1
  createdAt: number
  updatedAt: number
}

/** `toChildRecord` 要拦的第一件事：childId 会被当成**路径的一段**用 */
const CHILD_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/

export type NewChildRecord = Omit<ChildRecord, 'schemaVersion' | 'createdAt' | 'updatedAt'> & {
  /** 只在**新建**时用得上：已存在的档案会保留原来的值（见 profile-store 的 `save`） */
  createdAt: number
  /** 改名时传当前时间；不传就等于没改过 */
  updatedAt?: number
}

/**
 * 造一条档案记录。**同一输入必然得到同一条**（时间由调用方给，不读系统时钟）——
 * 这是它能被测试、能被演示数据复现的前提。
 *
 * 违反约束时抛（这是给**我们的代码**用的：调用方应该已经校验过）；
 * 从磁盘读回来的那些走 `toChildRecord`，那条路是**容忍**的，见下面。
 */
export function buildChildRecord(input: NewChildRecord): ChildRecord {
  const record: ChildRecord = {
    schemaVersion: 1,
    childId: input.childId.trim(),
    name: input.name.trim(),
    nameReading: input.nameReading.trim(),
    ageBand: input.ageBand,
    lookTags: input.lookTags.map((tag) => tag.trim()).filter((tag) => tag !== ''),
    interestTags: input.interestTags.map((tag) => tag.trim()).filter((tag) => tag !== ''),
    createdAt: input.createdAt,
    // ★ 与 toChildRecord 用**同一条规则**（见那里）：没写 / 写了 0 都等于"没改过"。
    //   两边规则不一致的代价是实测出来的：造出来的记录再读回来会不相等（updatedAt
    //   是 createdAt 还是 0），而那种"写下去再读回来就变了"的字段最难查
    updatedAt: freshUpdate(input.updatedAt, input.createdAt),
  }
  const problems = validateChildRecord(record)
  if (problems.length > 0) {
    // 与 card.ts 同一条纪律：不合格的东西不许流进资产系统
    // ★ 用 EngineError 而不是自定义一个错误类：`userFailureOf` 是按 `EngineError.code`
    //   分流文案与状态码的，一个"长得像但不是"的错误会被规约成 `provider-call-failed`，
    //   于是"名字是空的"会回 502（平台故障）。这条在工单 02 的 reference-invalid 上踩过一次
    throw new EngineError('profile-invalid', `孩子档案不合格：${problems.join('；')}`)
  }
  return record
}

/** 返回人话的问题清单（空数组 = 合法）。给校验、给界面、给测试共用 */
export function validateChildRecord(record: ChildRecord): string[] {
  const problems: string[] = []
  if (text(record.name) === '') problems.push('名字是空的')

  // ★ 这条不只是"格式好看"。childId 直接拼进 `children/<childId>.json`，
  //   而它在界面上来自 URL 那一段（`/character/[childId]`）——
  //   一个 `..%2F..%2F` 就是一次目录穿越。**挡在数据层，不挡在路由层**：
  //   路由那层只转发字符串，它不知道 childId 会被拿去当路径。
  if (!CHILD_ID_SHAPE.test(text(record.childId))) {
    problems.push(
      `childId 只能由字母、数字、下划线、短横组成（收到：${text(record.childId) || '空'}）`,
    )
  }
  if (text(record.nameReading) === '') {
    problems.push('读音是空的（多音字读错家长第一秒就听得出来）')
  }
  if (!AGE_BANDS.includes(record.ageBand)) {
    problems.push(`年龄档要是 ${AGE_BANDS.join(' / ')} 之一`)
  }
  return problems
}

/**
 * 从**任意 JSON** 解析出一条记录，解析不出来就回 null。
 *
 * ★ 它与 `validateChildRecord` 是两个方向的东西，别合并：
 *   这一个面向"磁盘上那个文件可能是人手改的、旧 schema 的、写到一半被杀进程的"，
 *   所以它**对输入全函数**（任何值都不许抛），并且把"缺了的可选字段"补成合法的空值。
 *   那一个面向"我们自己造的记录还不合格"，它读的是已经成形的类型，不合格就是 bug。
 *   第一版只有后者，于是拿一份 `{childId:'broken'}` 去列目录就当场炸了——
 *   那条路的正确行为是**跳过这一份、继续列其余的**。
 *
 * `lookTags` / `interestTags` 缺了不算不合格（"他没说喜欢什么"是合法状态），
 * 但**必须补成数组**：类型上写着 `readonly string[]`，运行时给 undefined 就是类型在说谎。
 */
export function toChildRecord(raw: unknown): ChildRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const record: ChildRecord = {
    schemaVersion: 1,
    childId: text(source['childId']),
    name: text(source['name']),
    nameReading: text(source['nameReading']),
    ageBand: source['ageBand'] as AgeBand,
    lookTags: textList(source['lookTags']),
    interestTags: textList(source['interestTags']),
    createdAt: numberOf(source['createdAt']),
    // 文件里没写 updatedAt（旧 schema、人手写的）= 从没改过。与 buildChildRecord 同一条规则
    updatedAt: freshUpdate(numberOf(source['updatedAt']), numberOf(source['createdAt'])),
  }
  return validateChildRecord(record).length === 0 ? record : null
}

/**
 * 界面上怎么称呼他。**读不到就读不到**，不退回编一个名字。
 *
 * 卡面上 `名字 · 读音` 这一行的形状由它一处决定——两处各拼一遍的症状是
 * 卡片墙上是"小宇 · yǔ"、形象页上变成"小宇（yǔ）"。
 */
export function displayNameOf(record: ChildRecord | null, fallback: string): string {
  if (!record) return fallback
  const name = text(record.name)
  if (name === '') return fallback
  const reading = text(record.nameReading)
  return reading === '' ? name : `${name} · ${reading}`
}

/* ───────────────────────── 内部小工具：让上面两条都全函数 ───────────────────────── */

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => text(item)).filter((item) => item !== '')
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** "改过没有"的判据只有一处：0 与 undefined 都算没改过，于是 updatedAt = createdAt */
function freshUpdate(updatedAt: number | undefined, createdAt: number): number {
  return updatedAt !== undefined && updatedAt > 0 ? updatedAt : createdAt
}
