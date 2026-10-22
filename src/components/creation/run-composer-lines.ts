/**
 * run-composer-lines.ts —— 底部那一条上的三句话（纯函数，无 React）
 *
 * 2026-10-21 从 `GenerationRun.tsx` 的 JSX 里拔出来（工单 D-34）。
 * 拔的理由与 `plan-lines.ts` / `run-phase-lines.ts` 是同一条：这三句话各有一个
 * **容易被顺手改坏、而屏幕上不会当场显形**的判断，而它们原来埋在 JSX 的三元表达式里。
 *
 * 1. `.gr__story` 那一句：这一格是**家长当初写的那一句话**（只读），不是"这一本现在什么状态"。
 *    ★ 没有 `plan` 时（从书架接着做一份草稿）它**不编一句话出来**：那句话
 *      **没有存在书里**（`Book` 上没有 theme / wish 两个字段），所以它照实说
 *      "这一本现在处于什么状态"——那是真的。
 *    ★ 2026-10-17（闸门）：故事**能改**了，但改的是 **①的产出**，不是这一格。
 *      这一格留在屏幕上，正是为了让家长改故事时**回看得见**自己原来要的是什么。
 * 2. 自动保存那行小字：只在闸门那一屏说，且只在有话说时说。★ `'rewritten'` 那一档
 *    （2026-10-18）说的是**另一件事**——自动保存说的是"你改的字存下去了"，
 *    而它是"整篇换成新的了"。重写成功是悄悄发生的（同一屏、同一批框，只是字不一样），
 *    刚等了 101 秒的人需要一个答案（用户原话：「这样用户怎么知道有没有重新生成故事呢」）。
 * 3. 「退出」那颗按钮的 `title`：分两句，因为这两件事真的不同——还在跑的时候这一本
 *    **还没有**落到书架上（清单是在收尾那一刻写的），跑完了才出现。说成一句就是假的。
 */

import type { Phase } from './phase.ts'
import type { SaveState } from './use-story-autosave.ts'

/**
 * 底部那一格（只读）。
 *
 * `null` = 这条路没有 `plan`（从书架接着做一份草稿），退回下面那几句话。
 * ★ 有 `plan` 时**照抄它那两样**，哪怕两样都是空串：那一格说的是"家长当初写的那句话"，
 *   而"他其实什么都没写"是一件真事——拿状态文案去盖住它，读起来像是他写过。
 */
export function storyLineOf(args: {
  /** 家长在 `/home` 写的那句话（愿望优先，空则退回主题）。没有 `plan` 时传 `null` */
  written: string | null
  atGate: boolean
  published: boolean
}): string {
  if (args.written !== null) return args.written
  if (args.atGate) return '这一段故事还没开始画。改完点「就按这个画」——图按你改好的这一版画。'
  if (args.published) return '这本已经装订好了，在书架上放着。'
  return '这一本还没装订。不满意哪一页就在那一页重做，都没问题再点确定。'
}

/** 自动保存那行小字。`idle`（还没动过笔）时一句话都不说 */
export function saveLineOf(state: SaveState): string | null {
  switch (state) {
    case 'saving':
      return '正在存…'
    case 'saved':
      return '改的已经存上了'
    case 'failed':
      return '没存上——检查一下网络，改动还在这一屏里'
    case 'rewritten':
      return '重写好了——上面这一屏已经是新的一版'
    default:
      return null
  }
}

/**
 * 「退出」那颗按钮悬停时说的话。
 *
 * ★ 它原来写的是「改故事，重做一本」并指向 `/home`——**那句话本身在骗人**：
 *   这一本已经写进盘上了（草稿态），点它并不会"丢掉"什么，只是先前的说法
 *   让人以为要重新开始。现在这一颗说的是它真正做的事：**离开这一屏**。
 * ★ 去 `/shelf` 而不是 `/home`（见 `GenerationRun` 的那个 `Link`）：
 *   用户接下来要处理的是**这一本**，而它在书架那一栏里。
 */
export function exitTitleOf(args: { phase: Phase; atGate: boolean }): string {
  if (args.phase === 'running') {
    return '离开这一屏。服务器上会把这一本做完，做完就出现在书架的「正在编辑」里'
  }
  if (args.atGate) {
    return '离开这一屏。这一段故事在书架的「正在编辑」里（还没开始画），点回去接着改'
  }
  return '这一本在书架的「正在编辑」里，那里可以制作为绘本，也可以删掉'
}
