/**
 * default-anchors.ts —— 第 3 步锚点表单的**预填值**
 *
 * 预填不是为了省事，是为了让家长知道"这一格该写什么"。空表单会得到两种情况：
 * 家长跳过它（于是没有形象依据，一致性变成抽奖），或者随手写一句页级的话
 * （"他很开心"——那会被校验拦下，因为下一页哭的时候这一页就不合格了）。
 *
 * ★ 这份预填是**中性**的：不假设孩子长什么样，只演示"一条锚点该细到什么程度"。
 *   七条里硬锚点 5 条（骨相/眼睛/头发/身形/肤色）与软锚点 2 条（特征记号/常服），
 *   与 `ANCHOR_STRENGTH` 的分档一致——分档本身是产品判断，写在引擎里，不在这里重说。
 */

import type { AnchorSlot, CharacterAnchor } from '@/lib/engine/domain.ts'

/** 按 `ANCHOR_SLOTS` 的声明序给全七格，空的一格也不落——缺格会让校验报"锚点不完整" */
export const DEFAULT_ANCHORS: readonly CharacterAnchor[] = [
  { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
  { slot: 'eyes', value: '深棕圆眼、眼距略宽、睫毛短' },
  { slot: 'hair', value: '黑发偏软，左侧总有一撮翘起来' },
  { slot: 'build', value: '头身比约 1:4，四肢圆润' },
  { slot: 'skin', value: '暖黄偏深的肤色' },
  { slot: 'mark', value: '笑起来右脸颊有一个小酒窝' },
  { slot: 'wardrobe', value: '芥黄短袖 + 深蓝短裤 + 一双红雨鞋' },
]

export function anchorsWith(
  anchors: readonly CharacterAnchor[],
  slot: AnchorSlot,
  value: string,
): CharacterAnchor[] {
  const next = anchors.filter((anchor) => anchor.slot !== slot)
  next.push({ slot, value })
  return next
}
