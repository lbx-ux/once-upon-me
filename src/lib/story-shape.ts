/**
 * story-shape.ts —— 一份故事草稿**长什么形状**（纯函数，浏览器安全，工单 05）
 *
 * 它回答闸门那一屏要说的两件事（§二 的"钱要说在花钱的那一刻"）：
 *
 * | 数 | 是什么 | 独读版 | 共读版 |
 * | --- | --- | --- | --- |
 * | `pathPages` | 孩子**读到的**长度 | 等于节点数 | 两条路各一个数（差 ≤ 1） |
 * | `drawPages` | **要画的**页数 | 等于节点数 | 全表节点数，**含走不到的那一支** |
 *
 * 两个数在独读版上相等、在共读版上差着那条走不到的路——这正是这一屏要说的话：
 * 家长在闸门那一屏按下去的是**一笔钱**，而共读版多花在哪儿，屏幕上得看得见。
 *
 * ★ 与 `story-problems.ts` 的分工：那个回答"**能不能**拿去画"（按钮亮不亮、
 *   亮不了是为什么），这个回答"拿去画**是什么样**"。两者都从**同一个** `buildTree`
 *   出来——各算一份的症状是"闸门说 8 页，书里是 9 页"。
 * ★ 树建不起来（这一版有错）时回 `null`：那一屏上有问题清单在说话，
 *   这时候摆一个"要画几页"只是噪音，而**改完就有了**。
 * ★ 它不算封面那一张：封面两种形态都要画、与有没有分支无关，
 *   而这一行要说的正是**分支多出来的那一部分**。
 */

import { buildTree, pathLengthsOf } from './engine/tree.ts'
import type { BookForm } from './engine/domain.ts'
import type { NodeDraft, PlanDraft } from './schemas/story.ts'

export type StoryShape = {
  /** 从根走到叶的那些路各有多少页。去重升序，共读版最多两个（两支差 ≤ 1） */
  pathPages: number[]
  /** 一共要画多少页的图 = 表里的节点数（含走不到的那一支） */
  drawPages: number
}

/** 一份草稿 → 它的形状。树建不起来时 `null` */
export function storyShapeOf(form: BookForm, doc: PlanDraft): StoryShape | null {
  const built = buildTree(form, doc.title, doc.nodes as readonly NodeDraft[])
  if (!built.ok) return null
  return {
    pathPages: pathLengthsOf(built.tree),
    drawPages: built.tree.nodes.length,
  }
}

/**
 * 那一行数字。**两个数一样时回 `null`**（独读版就是这样）——
 * "读下来 5 页，一共要画 5 页"是同一句话说两遍，而这一屏上每一行字都要有人读。
 *
 * ★ 页数说成区间（`8–9 页`）而不是取一个数：共读版有**两条**路，
 *   两支差 1 页是常态，而"读下来 9 页"在走了短那一支的孩子身上就是假的。
 */
export function shapeLineOf(shape: StoryShape): string | null {
  const first = shape.pathPages[0]
  const last = shape.pathPages[shape.pathPages.length - 1]
  if (first === undefined || last === undefined) return null
  if (last === shape.drawPages) return null
  const read = first === last ? `${first} 页` : `${first}–${last} 页`
  return `读下来 ${read}，一共要画 ${shape.drawPages} 页的图（含走不到的那一支）`
}
