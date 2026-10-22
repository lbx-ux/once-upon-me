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
 * 三个设计选择，每个都对应一个具体的失败模式：
 *
 * 1. 文件名里带内容指纹。家长微调之后旧版卡必须还在：旧书的那些页出自旧版，
 *    覆盖了它们，"这张图是哪版角色卡画的"就答不上来（ADR-0003 的失效管理）。
 * 2. `latest` 是一个单独的小文件，不是"扫目录取最大 revision"。
 *    扫目录在内存 store 上可行、在对象存储上会变成一次全量 list；
 *    而且"当前版"是一个决定，决定要有明确的记录处。
 * 3. 删除以孩子为单位（`deleteChild`），返回删掉的条数。
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
  normalizeAnchors,
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
    input: // ★ `referenceBytes` 要一起 Omit 掉再重声明：`BuildCardInput.referenceBytes` 是
    //   字节数（`number`，卡里存的是长度），而这一层的入参是字节本身
    //   （`Uint8Array`）。只 Omit 'referencePath' 的话，交叉类型会得到
    //   `number & Uint8Array` —— 一个没有任何值能满足的类型。
    //   它一直没被闸门抓到的原因很具体：调它的三个调用方都在 `scripts/*.mts` 里，
    //   而 `tsconfig.json` 的 include 是 `**/*.ts`，.mts 不在其中。
    Omit<BuildCardInput, 'referencePath' | 'referenceBytes'> & {
      referenceBytes: Uint8Array
      referenceMime: string
      /**
       * 「换一版」：在旧卡上叠一个新 revision，不覆盖（ADR-0007）。
       *
       * 为什么要有这个入参，而不是让调用方自己 `save` 一张改过 revision 的卡：
       *   参考图是内容寻址的（`ref.<指纹>.webp`），换图必须同时换文件名、
       *   换 `reference` 三件套、并且知道 store 算出来的指纹——那三件事全在这一层，
       *   调用方拿不到也拼不对。没有它，界面上的"换一版"只有两条歪路：
       *   覆盖旧版（旧书的图来源被抹掉），或者从 `load` 拿到旧版自己改（拼错指纹）。
       */
      previous?: CharacterCard
      /**
       * 家长写下的那句「想改哪里」（工单 03）。进 `provenance.suggestion`。
       *
       * 它进 provenance 而不是进 anchors：锚点是"他长什么样"的判据，
       *   这句话是"这一版是怎么来的"。混进锚点会当场撞上 card.ts 文件头那条
       *   不变式——锚点里的每一项都必须跨页不变，而"眼睛再大一点"只属于这一版。
       */
      suggestion?: string
    },
  ): Promise<{
    card: CharacterCard
    ref: AssetRef
  }>
  save(card: CharacterCard): Promise<AssetRef>
  load(cardId: string, revision?: number): Promise<CharacterCard | null>
  latest(cardId: string): Promise<CharacterCard | null>
  summaries(): Promise<CardSummary[]>
  /**
   * 这张卡的全部版本，按 revision 升序（工单 03 的版本历史）。
   *
   * 与 `summaries()` 分开而不是给它加个开关：那两个问题的答案形状不一样——
   *   一个是"每个卡现在长什么样"（跨卡，同 cardId 只留最新），
   *   一个是"这一张卡走过哪些版本"（单卡，全都留着）。合并成一个函数加 flag，
   *   调用方就要读文档才知道自己拿到的是哪种。
   */
  revisions(cardId: string): Promise<CharacterCard[]>
  /**
   * 这个孩子现在的形象。没有就 `null`。
   *
   * 它不靠"卡号 = `${childId}-sheet`"这个约定去找：那是 `/api/cards` 建卡时
   *   顺手拼的字符串，不是领域规则。靠约定找的话，哪天建卡改用别的命名，
   *   所有已经建好的孩子会一起"没有形象"，而错误现场是一句
   *   "这个孩子还没有形象"——看不出是命名改了。
   * 由 `childId` 反查也是档案与卡之间唯一那根线的另一端：
   *   档案说"他是谁"，卡说"他长什么样"，两边靠 childId 对上。
   */
  latestForChild(childId: string): Promise<CharacterCard | null>
  /**
   * 把 `latest` 指回旧的一版（工单 03 的"切回这一版"）。
   *
   * 它只动那个一字节的指针，不删新图、不改任何一版的内容。
   *   语义是"从现在起用第 N 版形象"，不是"第 N 版之后那些没发生过"——
   *   已经做出来的书仍然指着它们各自那一版（ADR-0007）。
   * ★ 目标版不存在就抛，不写一个指不到东西的指针：那种指针的症状是
   *   下一次 `latest()` 回 null，而界面会说"这个孩子没有形象"。
   */
  setLatest(cardId: string, revision: number): Promise<void>
  /**
   * 删掉一张卡的全部版本（含参考图与 `latest` 指针），返回删掉的条数与参考图字节数。
   *
   * 与 `deleteChild` 分开的理由：删除的凭据要逐位置报数
   *   （"每个存储位置各删了多少条"），而一张卡的条数是那笔账里的一行。
   *   让调用方拿 `deleteChild` 去凑一行，它就得自己拼 `cards/<cardId>/` 这个前缀——
   *   而那正是这个文件管的约定（`CARDS_PREFIX`）。
   * 返回的 `files` 是真的删掉了几条（`deletePrefix` 数的），不是预估：
   *   凭据的全部意义就是不依赖预估。
   */
  deleteCard(cardId: string): Promise<{ files: number; bytes: number }>
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

      /**
       * ★ 先校验，再落盘（2026-10-22 审查）。
       *   原来第一件事就是 `store.put` 参考图，然后才 `validateCard`——
       *   一张不合格的卡（比如照片推出来的硬锚点缺一格）被拒时，
       *   参考图已经躺在 `cards/<id>/` 里了，而 `summaries()` / `deleteCard()`
       *   只认卡片文件，那份孤图谁也看不见、也删不掉。
       *   指纹用 `digestOfBytes`，与 `store.put` 返回的是同一个函数算的。
       */
      const fresh = buildCard({
        ...input,
        referencePath: path,
        referenceBytes: input.referenceBytes.byteLength,
      })
      // 「换一版」：新 revision + 新锚点 + 新参考图，旧版文件一个字节都不动
      // （ADR-0007：旧书的那些页出自旧版卡，覆盖了它们，"这张图是哪版画的"就答不上来）
      const card = attachReferenceDigest(
        input.previous
          ? {
              ...input.previous,
              revision: input.previous.revision + 1,
              anchors: normalizeAnchors(input.anchors),
              style: input.style,
              reference: fresh.reference,
              provenance: {
                modelId: input.modelId,
                promptVersion: input.promptVersion,
                cardRevision: input.previous.revision + 1,
                generatedAt: input.now,
                // 只有"换一版"才可能有这句话：第一版没有上一版可比
                ...(input.suggestion ? { suggestion: input.suggestion } : {}),
              },
            }
          : fresh,
        digestOfBytes,
      )

      const problems = validateCard(card)
      if (problems.length > 0) {
        throw new EngineError('card-invalid', `角色卡不合格：${problems.join('；')}`)
      }
      const ref = await store.put({
        path,
        bytes: input.referenceBytes,
        mime: input.referenceMime,
      })
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
      // 卡号从路径取（`cards/<cardId>/r<rev>.<指纹>.json`），不必先把每个文件都读一遍
      const cardIds = new Set<string>()
      for (const key of keys) {
        const rest = key.slice(`${CARDS_PREFIX}/`.length)
        const slash = rest.indexOf('/')
        if (slash > 0) cardIds.add(rest.slice(0, slash))
      }

      const out: CardSummary[] = []
      for (const cardId of cardIds) {
        // ★ 必须走 `load`：它读的是 `latest` 那个指针。
        //
        //   这一版之前用的是"扫目录取最大 revision"——在"切回旧版"这个动作出现之前，
        //   两者永远一致，所以看不出区别。工单 03 做了「从现在起用这一版」之后，
        //   实测到症状：指针已经写成 1 了，页面上还说第 2 版是当前——
        //   因为"当前版"是一个决定（`latest` 文件头第 2 条就是这么写的），
        //   而"revision 最大"只是那个决定在没人改过它时的样子。
        //
        //   指针指不到东西时退回最大 revision：那是资产被手改过的情形，
        //   "退一步照样能列出这张卡"比"这个孩子从此没有形象"好。
        const card = (await this.load(cardId)) ?? (await newestRevision(store, cardId))
        if (!card) continue
        out.push({
          cardId: card.cardId,
          childId: card.childId,
          revision: card.revision,
          digest: cardDigest(card),
          referencePath: card.reference.path,
        })
      }
      return out.sort((a, b) => a.cardId.localeCompare(b.cardId))
    },

    async latestForChild(childId) {
      const mine = (await this.summaries()).find((summary) => summary.childId === childId)
      return mine ? this.load(mine.cardId, mine.revision) : null
    },

    async revisions(cardId) {
      const prefix = `${CARDS_PREFIX}/${cardId}/r`
      const keys = (await store.list(prefix)).filter((key) => key.endsWith('.json'))
      const out: CharacterCard[] = []
      for (const key of keys) {
        const card = await store.readJson<CharacterCard>(key)
        if (card) out.push(card)
      }
      return out.sort((a, b) => a.revision - b.revision)
    },

    async setLatest(cardId, revision) {
      const target = await this.load(cardId, revision)
      if (!target) {
        throw new EngineError('card-not-found', `第 ${revision} 版不在，指针不动`)
      }
      await store.put({
        path: `${CARDS_PREFIX}/${cardId}/latest`,
        bytes: new TextEncoder().encode(String(revision)),
        mime: 'text/plain',
      })
    },

    async deleteCard(cardId) {
      // 字节在删之前读：`reference.bytes` 是建卡时记下的参考图长度，
      // 删完就没人记得了，而删除凭据要报得出"各删了多少"
      const card = (await this.load(cardId)) ?? (await newestRevision(store, cardId))
      const bytes = card?.reference.bytes ?? 0
      const files = await store.deletePrefix(`${CARDS_PREFIX}/${cardId}/`)
      return { files, bytes }
    },

    async deleteChild(childId) {
      const summaries = await this.summaries()
      const mine = summaries.filter((summary) => summary.childId === childId)
      let cards = 0
      let bytes = 0
      // 逐张卡删，与 `deleteCard` 同一处实现：两处各写一遍前缀，
      // 早晚会出现"孩子那一侧删得干净、单张卡那一侧漏了 latest"
      for (const summary of mine) {
        const one = await this.deleteCard(summary.cardId)
        cards += one.files
        bytes += one.bytes
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

/** 兜底：指针指不到东西时（资产被手改过）退回 revision 最大的那一版 */
async function newestRevision(store: AssetStore, cardId: string): Promise<CharacterCard | null> {
  const keys = (await store.list(`${CARDS_PREFIX}/${cardId}/r`)).filter((key) =>
    key.endsWith('.json'),
  )
  let best: CharacterCard | null = null
  for (const key of keys) {
    const card = await store.readJson<CharacterCard>(key)
    if (card && (!best || best.revision < card.revision)) best = card
  }
  return best
}

function extensionOf(mime: string): string {
  if (mime.includes('png')) return '.png'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('jpeg')) return '.jpg'
  return '.bin'
}
