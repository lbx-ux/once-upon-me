/**
 * cards-list.ts —— 「有哪些角色卡」这一件事的**唯一**实现（服务端侧）
 *
 * 为什么单独一个文件：`/api/cards` 的 GET、工作台的「小主角」选择器、
 * 以后的角色档案页（工单 03）要的是同一份数据，差别只在给谁看。
 * 各写一遍循环的症状很具体：三处对"同 cardId 只留最新一版"的处理迟早会不一致，
 * 而那一条是 ADR-0007 的 revision 语义所在。
 *
 * ★ 与 `library.ts` 同一层：都是**服务端读资产根**的取数函数，不在引擎里
 *   （引擎不管"列出来给人看"，它只管造与校验）。
 */

import { assetRoot } from './books-runtime.ts'
import { assetUrlOf } from './asset-url.ts'
import { withDemoCards } from './card-source.ts'
import {
  cardDigest,
  checklistOf,
  createCardStore,
  createFsStore,
  promptFragmentOf,
  type CharacterAnchor,
} from './engine/index.ts'

/** 一张卡的界面视图：卡号 + 是谁 + 第几版 + 图 + 那几段派生文本 */
export type CardListItem = {
  cardId: string
  childId: string
  revision: number
  digest: string
  /** 走 `/api/assets` 那条只读出口，不是 public/ 下的文件。★ 这是**原图**（2.7 MB 那一档），
   *  界面上要小图请用下面的 `referencePath` 自己配档 */
  referenceUrl: string
  /** 资产根里的相对路径。给 `assetUrlOf(path, 768)` 用——缩略档由消费者决定，不在这里猜 */
  referencePath: string
  promptFragment: string
  /** ★ 两个数组都是 `readonly`：它们是引擎算出来的派生值（`checklistOf` / `card.anchors`），
   *  这一层不该有改它们的权力——要改就回到引擎里改那条规则 */
  checklist: readonly string[]
  /** 锚点原样带着（slot + value）。角色页要按部位列，`checklist` 是已经拼给人读的句子 */
  anchors: readonly CharacterAnchor[]
  modelId: string
  /**
   * 用过照片、且原图没留。隐私设计里这一条要能被界面看见。
   * ★ 界面上那句话是 `CharacterWall` 的「照照片画的，原图没留」（2026-10-16 第 22 刀改的，
   *   原来写「用过照片，已删除」——用户读成了"刚发生了一次删除"，而它是**每一张
   *   照片卡都有的状态**）。改的只是那几个字，这个字段与它的判据一个字没动。
   */
  photoDeleted: boolean
}

/**
 * 列出每个 cardId 的**最新一版**。
 *
 * 空列表是合法答案：一张卡都没有 = 那个目录还没建过，不是错误
 * （`summaries()` 在目录缺失时抛，这里吞掉——与 `/api/cards` 原来的处理一致）。
 *
 * ★ 2026-10-17：这一层**收的是根路径**（`userSliceRoot(...)`），而示例卡不在
 *   任何人的那一片里，所以这个 store 要自己垫上那一层（`withDemoCards`）。
 *   于是示例卡会出现在**每一个**人的卡表里——那是刻意的：它们是"先看看效果"的那两张，
 *   不是谁的作品。同一条垫底的还有 `createUserStore`（路由那一侧）与
 *   `childDetailOf`（详情那一侧），三处是同一个决定了（见 `card-source.ts` 文件头）。
 */
export async function listCardItems(root: string = assetRoot()): Promise<CardListItem[]> {
  const store = await withDemoCards(await createFsStore(root))
  const cardStore = createCardStore(store)

  let summaries
  try {
    summaries = await cardStore.summaries()
  } catch {
    return []
  }

  const items: CardListItem[] = []
  for (const summary of summaries) {
    const card = await cardStore.load(summary.cardId, summary.revision)
    if (!card) continue
    items.push({
      cardId: card.cardId,
      childId: card.childId,
      revision: card.revision,
      digest: cardDigest(card),
      referenceUrl: assetUrlOf(card.reference.path),
      referencePath: card.reference.path,
      // 同一份锚点的两种用法：画的时候按 A 画、查的时候按 B 查（ADR-0007）
      promptFragment: promptFragmentOf(card),
      checklist: checklistOf(card),
      anchors: card.anchors,
      modelId: card.provenance.modelId,
      photoDeleted: Boolean(card.sourcePhoto?.deletedAt),
    })
  }
  // 新的排前面：家长多半想接着用上一次那张
  items.sort((a, b) => b.revision - a.revision)
  return items
}
