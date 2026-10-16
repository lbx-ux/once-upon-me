/**
 * profile-store.ts —— 档案的落盘（一个孩子一个文件）
 *
 * 磁盘布局：
 *
 * ```
 * children/<childId>.json     档案本体，一份，**没有版本**
 * ```
 *
 * ★ 为什么是单文件、而不是像角色卡那样一个目录 + `r1 / r2 / latest`：
 *   卡的目录形状是 ADR-0007 的 revision 语义逼出来的（旧书那些页要能指着旧版卡）。
 *   档案没有这个约束——没有一本书的任何一个字节来自"名字的某一版"。
 *   给它套上版本，代价是每次改名都长出一个文件，而收益是零。
 *
 * ★ 为什么 childId 的**形状校验在 profile.ts 里、不在这里**：
 *   这一层拿 childId 拼路径，所以它必须有保证。但"什么样的 childId 合法"是
 *   领域问题，而这一层只该负责存取（与 store.ts 的分工同一条：那一层也不校验锚点，
 *   校验在 card.ts）。★ 于是这里是**最后一处**能挡住目录穿越的地方，不是第一处：
 *   `save()` 造档案走 buildChildRecord（会挡），但 `load()` 直接收一个字符串。
 *   所以 load 里也挡一次，见下面 `pathOf`。
 */

import {
  buildChildRecord,
  toChildRecord,
  type ChildRecord,
  type NewChildRecord,
} from './profile.ts'
import { EngineError } from '../errors.ts'
import type { AssetStore } from '../providers/types.ts'

export const CHILDREN_PREFIX = 'children'

/** 与 profile.ts 的 CHILD_ID_SHAPE 同一条规则。这里再挡一次的理由见文件头 */
const SAFE_CHILD_ID = /^[A-Za-z0-9_-]{1,64}$/

export type ProfileStore = {
  save(input: NewChildRecord): Promise<ChildRecord>
  load(childId: string): Promise<ChildRecord | null>
  /** 全部档案，按 childId 排序。空目录 = 空表，不是错误 */
  list(): Promise<ChildRecord[]>
  /** 删一个孩子的档案，返回删掉的条数（删除凭据要报数，与 cards 那侧同一条纪律） */
  delete(childId: string): Promise<number>
}

export function createProfileStore(store: AssetStore): ProfileStore {
  const pathOf = (childId: string): string => {
    // ★ 见文件头：load 收的是**界面上传来的一段 URL**，不能假定它已经在别处被查过
    if (!SAFE_CHILD_ID.test(childId)) {
      throw new EngineError('profile-invalid', `childId 不合法：${childId || '空'}`)
    }
    return `${CHILDREN_PREFIX}/${childId}.json`
  }

  return {
    async save(input) {
      // ★ createdAt **不可被改写**：它的意思是"这个孩子是什么时候建的"，
      //   不是"这个文件是什么时候写的"。改名传进来的 createdAt 一律忽略——
      //   于是调用方不需要知道"这是新建还是改名"，也不可能不小心把创建时间刷掉。
      const existing = await this.load(input.childId)
      const record = buildChildRecord({
        ...input,
        createdAt: existing?.createdAt ?? input.createdAt,
      })
      await store.putJson({ path: pathOf(record.childId), value: record })
      return record
    },

    async load(childId) {
      return toChildRecord(await store.readJson<unknown>(pathOf(childId)))
    },

    async list() {
      const keys = (await store.list(`${CHILDREN_PREFIX}/`)).filter((key) => key.endsWith('.json'))
      const out: ChildRecord[] = []
      for (const key of keys) {
        const record = toChildRecord(await store.readJson<unknown>(key))
        // 半截 JSON 由 readJson 回 null；形状不对的（人手改过、旧 schema）在这里挡掉，
        // 界面上"少一个孩子"比"整页崩掉"好——与 `children-source.ts` 读预生成档案
        // 那条路同一条纪律（`kid-names.ts` 在 2026-10-16 删掉之前也是这么写的）
        if (!record) continue
        out.push(record)
      }
      return out.sort((a, b) => a.childId.localeCompare(b.childId))
    },

    async delete(childId) {
      return store.deletePrefix(pathOf(childId))
    },
  }
}
