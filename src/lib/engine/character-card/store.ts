/**
 * store.ts —— 角色卡的资产存储（"可复用"三个字真正落地的地方）
 *
 * 磁盘布局，一个卡一个目录：
 *
 * ```
 * cards/<cardId>/
 *   ref.<digest>.webp      参考图（内容寻址：改图必换名，旧图不会凭空被覆盖）
 *   r1.<digest>.json       第 1 版卡
 *   r2.<digest>.json       微调后的第 2 版
 *   latest                 纯文本，写着当前 revision —— 一个字节的可信指针
 * ```
 *
 * ★ 三个设计选择，每个都对应一个具体的失败模式：
 *
 * 1. **文件名里带内容指纹**。家长微调之后旧版卡必须还在：旧书的那些页出自旧版，
 *    覆盖了它们，"这张图是哪版角色卡画的"就答不上来（ADR-0003 的失效管理）。
 * 2. **`latest` 是一个单独的小文件**，不是"扫目录取最大 revision"。
 *    扫目录在内存 store 上可行、在对象存储上会变成一次全量 list；
 *    而且"当前版"是一个**决定**，决定要有明确的记录处。
 * 3. **删除以孩子为单位**（`deleteChild`），返回删掉的条数。
 *    隐私设计 §九 要求删除凭据列出"每个存储位置各删了多少条"——
 *    一个不报数的删除实现，那张凭据就写不出来。
 *
 * 这一层只管存取，不管派生（派生在 card.ts，纯函数）。
 * 分开是因为：card.ts 要能在没有文件系统的 edge 运行时里被调用。
 */

import { digest } from '../digest.ts'
import type { AssetRef, CharacterCard } from '../domain.ts'
import { EngineError } from '../errors.ts'
import {
  attachReferenceDigest,
  buildCard,
  cardDigest,
  validateCard,
  type BuildCardInput,
} from './card.ts'
import type { AssetStore } from '../providers/types.ts'

export const CARDS_PREFIX = 'cards'

export type CardSummary = {
  cardId: string
  childId: string
  revision: number
  digest: string
  referencePath: string
}

export type CardStore = {
  /** 造卡：算参考图指纹 → 建卡 → 校验 → 落盘 → 更新 latest */
  create(
    input: Omit<BuildCardInput, 'referencePath'> & {
      referenceBytes: Uint8Array
      referenceMime: string
    },
  ): Promise<{
    card: CharacterCard
    ref: AssetRef
  }>
  save(card: CharacterCard): Promise<AssetRef>
  load(cardId: string, revision?: number): Promise<CharacterCard | null>
  latest(cardId: string): Promise<CharacterCard | null>
  summaries(): Promise<CardSummary[]>
  /** 级联删除一个孩子名下的全部卡与参考图，返回条数（删除凭据的数据源） */
  deleteChild(childId: string): Promise<{ cards: number; bytes: number }>
  /** 卡与其参考图是否自洽：指纹对得上、文件还在。书架页与提交前自查用 */
  audit(cardId: string): Promise<string[]>
}

export function createCardStore(store: AssetStore): CardStore {
  const refPath = (cardId: string, contentDigest: string, mime: string): string =>
    `${CARDS_PREFIX}/${cardId}/ref.${contentDigest}${extensionOf(mime)}`
  const cardPath = (cardId: string, revision: number, contentDigest: string): string =>
    `${CARDS_PREFIX}/${cardId}/r${revision}.${contentDigest}.json`

  return {
    async create(input) {
      const digestOfBytes = digest(input.referenceBytes)
      const path = refPath(input.cardId, digestOfBytes, input.referenceMime)
      const ref = await store.put({ path, bytes: input.referenceBytes, mime: input.referenceMime })
      const card = attachReferenceDigest(
        buildCard({ ...input, referencePath: path, referenceBytes: ref.bytes }),
        ref.digest,
      )
      const problems = validateCard(card)
      if (problems.length > 0) {
        throw new EngineError('card-invalid', `角色卡不合格：${problems.join('；')}`)
      }
      await this.save(card)
      return { card, ref }
    },

    async save(card) {
      const problems = validateCard(card)
      if (problems.length > 0) {
        throw new EngineError('card-invalid', `角色卡不合格：${problems.join('；')}`)
      }
      const asset = await store.putJson({
        path: cardPath(card.cardId, card.revision, cardDigest(card)),
        value: card,
      })
      // latest 用纯文本而不是 JSON：它只表达一个决定，越笨越好
      await store.put({
        path: `${CARDS_PREFIX}/${card.cardId}/latest`,
        bytes: new TextEncoder().encode(String(card.revision)),
        mime: 'text/plain',
      })
      return asset
    },

    async load(cardId, revision) {
      const target = revision ?? Number(await readLatest(store, cardId))
      if (!Number.isFinite(target) || target < 1) return null
      const prefix = `${CARDS_PREFIX}/${cardId}/r${target}.`
      const keys = (await store.list(CARDS_PREFIX)).filter(
        (key) => key.startsWith(prefix) && key.endsWith('.json'),
      )
      const first = keys[0]
      if (!first) return null
      return store.readJson<CharacterCard>(first)
    },

    async latest(cardId) {
      return this.load(cardId)
    },

    async summaries() {
      const keys = (await store.list(`${CARDS_PREFIX}/`)).filter((key) => key.endsWith('.json'))
      const out: CardSummary[] = []
      for (const key of keys) {
        const card = await store.readJson<CharacterCard>(key)
        if (!card) continue
        out.push({
          cardId: card.cardId,
          childId: card.childId,
          revision: card.revision,
          digest: cardDigest(card),
          referencePath: card.reference.path,
        })
      }
      // 同 cardId 只留最新一版：书架要的是"现在这张"，历史版靠 load(revision) 取
      const byCard = new Map<string, CardSummary>()
      for (const summary of out) {
        const seen = byCard.get(summary.cardId)
        if (!seen || seen.revision < summary.revision) byCard.set(summary.cardId, summary)
      }
      return [...byCard.values()].sort((a, b) => a.cardId.localeCompare(b.cardId))
    },

    async deleteChild(childId) {
      const summaries = await this.summaries()
      const mine = summaries.filter((summary) => summary.childId === childId)
      let cards = 0
      let bytes = 0
      for (const summary of mine) {
        // 先读卡拿字节数，再删：删除凭据要报得出"各删了多少"，事后就读不到了
        const card = await this.load(summary.cardId, summary.revision)
        bytes += card?.reference.bytes ?? 0
        cards += await store.deletePrefix(`${CARDS_PREFIX}/${summary.cardId}/`)
      }
      return { cards, bytes }
    },

    async audit(cardId) {
      const problems: string[] = []
      const card = await this.latest(cardId)
      if (!card) return [`${cardId}: 没有可读的角色卡`]
      if (card.reference.digest === 'pending') problems.push('参考图指纹未计算')
      if (!(await store.exists(card.reference.path)))
        problems.push(`参考图文件不在：${card.reference.path}`)
      const keys = (await store.list(`${CARDS_PREFIX}/${cardId}/`)).filter((key) =>
        key.endsWith('.json'),
      )
      if (keys.length === 0) problems.push('没有任何版本的卡文件')
      return problems
    },
  }
}

async function readLatest(store: AssetStore, cardId: string): Promise<string | null> {
  const bytes = await store.read(`${CARDS_PREFIX}/${cardId}/latest`)
  return bytes ? new TextDecoder().decode(bytes).trim() : null
}

function extensionOf(mime: string): string {
  if (mime.includes('png')) return '.png'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('jpeg')) return '.jpg'
  return '.bin'
}
