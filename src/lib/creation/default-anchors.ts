/**
 * default-anchors.ts —— 第 3 步锚点表单的**预填值**
 *
 * 预填不是为了省事，是为了让家长知道"这一格该写什么"。空表单会得到两种情况：
 * 家长跳过它（于是没有形象依据，一致性变成抽奖），或者随手写一句页级的话
 * （"他很开心"——那会被校验拦下，因为下一页哭的时候这一页就不合格了）。
 *
 * ★ 这份预填是**中性**的：不假设孩子长什么样，只演示"一条锚点该细到什么程度"。
 *   硬锚点 5 条（骨相/眼睛/头发/身形/肤色）与软锚点 3 条（特征记号/常服/补充），
 *   与 `ANCHOR_STRENGTH` 的分档一致——分档本身是产品判断，写在引擎里，不在这里重说。
 *
 * ★ **预填的每一条都必须自己就能过 `checkAnchors`**（2026-10-15 修，见下）。
 *   这一条不是形式：预填是给家长看的**示范**，而家长的自然动作是"不动它，直接点生成"。
 *   一份自己不合法、却摆在那里当示范的预填，等于把一个错的东西教给每一个新用户，
 *   而错误现场在最后一刻才出现（而且见 `default-anchors.test.ts`：那次还白花了一次出图钱）。
 *
 * ★ 第八格 `extra`（"补充"）**预填空值**，这不是漏了（2026-10-16，用户要那一格）：
 *   补充是**家长自己加**的，给一个示例值等于往每张新卡里塞一条没人写过的特征
 *   （"左手腕上有一道疤"——一旦预填，它就会被画进每一页）。空值在软锚点上完全合法。
 */

import type { AnchorSlot, CharacterAnchor } from '@/lib/engine/domain.ts'

/**
 * 按 `ANCHOR_SLOTS` 的声明序给全八格，空的一格也不落——缺格会让校验报"锚点不完整"
 *
 * ★ `mark` 那一格原来写的是「**笑起来**右脸颊有一个小酒窝」，而 `checkAnchors` 的
 *   `PER_PAGE_WORDS` 里有「笑」——于是**预填值当场被引擎判不合格**：
 *   `buildCard` 抛 `card-invalid`，而它抛在 `/api/cards` **出图之后**——
 *   也就是说家长在创作流里不动这一格、直接点生成，会先花掉一次出图的钱，
 *   再收到一句"角色卡不合格：特征记号含页级概念「笑」"，而卡没建成。
 *   酒窝是**跨页不变**的特征，「笑起来」才是页级的条件，所以删掉那三个字就对了。
 */
export const DEFAULT_ANCHORS: readonly CharacterAnchor[] = [
  { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
  { slot: 'eyes', value: '深棕圆眼、眼距略宽、睫毛短' },
  { slot: 'hair', value: '黑发偏软，左侧总有一撮翘起来' },
  { slot: 'build', value: '头身比约 1:4，四肢圆润' },
  { slot: 'skin', value: '暖黄偏深的肤色' },
  { slot: 'mark', value: '右脸颊有一颗小酒窝' },
  { slot: 'wardrobe', value: '芥黄短袖 + 深蓝短裤 + 一双红雨鞋' },
  { slot: 'extra', value: '' },
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
