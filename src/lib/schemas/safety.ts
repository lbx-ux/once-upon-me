/**
 * safety.ts —— 语义复核那一次调用的输出形状（2026-10-30）
 *
 * 一份定义两个用途（与 `schemas/story.ts` 同一条纪律）：`describe()` 出 JSON Schema
 * 喂给模型，`parse()` 验收它回来的东西。分成两份迟早会漂，漂了的症状是"让它报 A、
 * 按 B 验收"，然后通过率莫名偏低。
 *
 * 形状刻意小：一条发现只要四样——哪一条（`clauseId`）、哪一页（`pageNo`）、
 * 原文哪一段（`quote`）、为什么（`why`）。没有"置信度"：这一档是兜底，不是判据，
 * 一个 0.63 的分数只会让人以为它是概率，而它不是。
 *
 * ★ `quote` 是这一档唯一的防幻觉手段：`review-judge.ts` 会拿它回原文里逐字找，
 *   找不到的条目一律丢掉。所以这里给它 2–60 字的范围，并在提示词里写死"必须连续引用"。
 *   模型改写过的、概括过的句子在这里过不了——那正是要的。
 */

import { array, number, object, string, type Codec } from './schema.ts'

/** 模型报回来的一条。字段名与提示词里的 JSON 例子逐字对应，改一处要同时改两处 */
export type SafetyFindingDraft = {
  clauseId: string
  pageNo: number
  quote: string
  why: string
}

export type SafetyFindings = {
  findings: SafetyFindingDraft[]
}

/**
 * 上限 12 条：一本 20 页的书如果真有 12 处要报，前面那 11 处已经足够让家长重写了。
 * 不设下限（`min` 缺省 0）：空清单是合法结果，也是绝大多数被触发时的结果。
 */
export const safetyFindingsCodec: Codec<SafetyFindings> = object<SafetyFindings>({
  findings: array(
    object<SafetyFindingDraft>({
      // `R-01`…`R-10` 都是 4–5 个字符；给到 8 是给模型写歪时留的余地（歪的也收，
      //   由 `clauseById` 去认；认不出归「适龄」，不丢——丢掉一条安全发现是这一档唯一不能犯的错）
      clauseId: string({ min: 2, max: 8 }),
      // 0 = 书名，与 `reviewStory` 的页码约定同一条
      pageNo: number({ integer: true, min: 0, max: 200 }),
      quote: string({ min: 2, max: 60 }),
      why: string({ min: 1, max: 120 }),
    }),
    { max: 12 },
  ),
})

export function safetyJsonSchema(): unknown {
  return safetyFindingsCodec.describe()
}
