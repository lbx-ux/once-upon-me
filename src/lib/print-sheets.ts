/**
 * print-sheets.ts —— 一本书摊成几张纸（2026-10-29）
 *
 * 打印/存 PDF 的那一屏要什么、按什么顺序摆，全部在这一层算完。它不碰 React，
 * 也不碰文件系统：进来的是**已经读出来的书**（`resolveBook` 的产物），
 * 出去是一串"第几张纸上画什么"。理由与 `reader-model.ts` 同一条——
 * 版式里"会错的那一半"（共读版两条支谁先谁后、缺图那一页还占不占一张纸）
 * 要能被单测钉住，而不是埋在组件里跟着浏览器一起难测。
 *
 * 三条判断
 *
 * 1. **共读版按"主干 → 甲支 → 乙支"摊，不按 `pageNo` 平铺。**
 *    `pageNo` 是资产编号（`page-7-a1.png` 可能是孩子读到的第 2 页），
 *    平铺顺序里两条支的页可以互相穿插——照它印出来，家长翻到一半会突然跳进另一条路。
 *    归属用 `pathFromRoot` 判（`tree.ts` 的 `branchPagesOf` 同一条判据），
 *    不用"选择点之后的每一页都算岔路"：那会把主干上排在后面的页误标成支线。
 * 2. **两条支都印，各带一行小字说清"如果孩子选了哪一边"。**
 *    只印一条等于替孩子做了选择，而这本书的卖点恰恰是"一棵树"；
 *    两支混着印而不标，读起来就是一本前后矛盾的书。
 * 3. **没图的那一页照样占一张纸，纸上说清楚"这一页的图没有生成出来"。**
 *    跳过它，印出来的书就少一页，而且没有任何痕迹能让人发现少了；
 *    补一张空白页，等于假装这一页本来就没有图。
 *
 * 封面单独一张，哪怕这本书没有封面（`coverUrl` 为 null）：那张纸就是书名页，
 * 上面只有书名——与阅读器"没有封面就照实只显示书名"是同一条口径。
 */

import type { ResolvedStory, StoryView } from './book-source.ts'
import type { Book, StoryNode } from './engine/domain.ts'

export type PrintChoice = {
  /** 给家长念的引导提问 */
  prompt: string
  /** 顺序 = 选项顺序，`options[0]` 对应 `via: 'a'` 那一支 */
  options: readonly { label: string; emoji: string }[]
}

export type PrintPage = {
  kind: 'page'
  nodeId: string
  /** 资产编号（`page-<N>` 那个 N），★ 不是"第几页"。见文件头第 1 条 */
  pageNo: number
  imageUrl: string | null
  body: readonly string[]
  /** 这一页的图没有生成出来（缺图），纸上要照实说 */
  missing: boolean
  /** 这一页属于哪条支（共读版）；null = 主干 */
  branch: 'a' | 'b' | null
  /** 这条支是哪个选项引出来的（那行小字）；主干页为 null */
  branchLabel: string | null
  /** 这一页是选择点时才有 */
  choice: PrintChoice | null
}

export type PrintCover = {
  kind: 'cover'
  title: string
  imageUrl: string | null
  form: Book['form']
}

export type PrintSheet = PrintCover | PrintPage

/** 一张书脊上那一行小字的原料：这一页在哪条支、那条支的选项叫什么 */
type BranchMark = { branch: 'a' | 'b' | null; branchLabel: string | null }

/**
 * 每一页归哪条支。
 *
 * 判据是"从根走过来的路经不经过这一支的头一页"，与 `branchPagesOf` 逐字同一条。
 * 选择点那一页自己不属于任何一支：两条路都要经过它，它在主干上。
 */
function branchMarksOf(nodes: readonly StoryNode[]): Map<string, BranchMark> {
  const marks = new Map<string, BranchMark>()
  const choice = nodes.find((node) => node.choice)
  const headA = choice?.next[0] ?? ''
  const headB = choice?.next[1] ?? ''
  const labelA = choice?.choice?.options[0]?.label ?? null
  const labelB = choice?.choice?.options[1]?.label ?? null

  for (const node of nodes) {
    let mark: BranchMark = { branch: null, branchLabel: null }
    if (choice && node !== choice && headA !== '' && headB !== '') {
      if (node.pathFromRoot.includes(headA)) mark = { branch: 'a', branchLabel: labelA }
      else if (node.pathFromRoot.includes(headB)) mark = { branch: 'b', branchLabel: labelB }
    }
    marks.set(node.nodeId, mark)
  }
  return marks
}

/**
 * 摊在纸上的顺序：主干（按页号）→ 甲支（按页号）→ 乙支（按页号）。
 * 见文件头第 1 条。
 */
function printOrder(nodes: readonly StoryNode[], marks: Map<string, BranchMark>): StoryNode[] {
  const byPageNo = (left: StoryNode, right: StoryNode): number => left.pageNo - right.pageNo
  const main: StoryNode[] = []
  const a: StoryNode[] = []
  const b: StoryNode[] = []
  for (const node of nodes) {
    const branch = marks.get(node.nodeId)?.branch ?? null
    if (branch === 'a') a.push(node)
    else if (branch === 'b') b.push(node)
    else main.push(node)
  }
  return [...main.sort(byPageNo), ...a.sort(byPageNo), ...b.sort(byPageNo)]
}

/** 选择点的两份读法（视图里带着的那份优先，缺了就从树上抄一份） */
function choiceOf(node: StoryNode, view: StoryView | null): PrintChoice | null {
  if (view?.choice) {
    return {
      prompt: view.choice.prompt,
      options: view.choice.options.map((one) => ({ label: one.label, emoji: one.emoji })),
    }
  }
  if (!node.choice) return null
  return {
    prompt: node.choice.prompt,
    options: node.choice.options.map((one) => ({ label: one.label, emoji: one.emoji })),
  }
}

/**
 * 一本书 → 要印的那几张纸。
 *
 * `story` 给的是"每一页长什么样"（图 / 正文 / 选择点），`book.tree` 给的是
 *   "这一页在哪条支上"——两个都得有：前者的 `pageNo` 是资产编号，
 *   后者才有 `pathFromRoot`。
 */
export function printSheetsOf(input: {
  book: Book
  story: ResolvedStory
  coverUrl: string | null
}): PrintSheet[] {
  const { book, story, coverUrl } = input
  const nodes = book.tree.nodes
  const marks = branchMarksOf(nodes)
  const views = new Map(story.nodes.map((view) => [view.nodeId, view]))

  const sheets: PrintSheet[] = [
    { kind: 'cover', title: book.tree.title, imageUrl: coverUrl, form: book.form },
  ]

  const seen = new Set<string>()
  for (const node of printOrder(nodes, marks)) {
    // 同一页在树里出现两次是不可能的（`buildTree` 按 ID 建表），但印两遍的代价是
    //   一本书里多出一张重复的纸，所以这里按 ID 去一次重——便宜、且让上面那句话不必依赖
    if (seen.has(node.nodeId)) continue
    seen.add(node.nodeId)

    const view = views.get(node.nodeId) ?? null
    const mark = marks.get(node.nodeId) ?? { branch: null, branchLabel: null }
    sheets.push({
      kind: 'page',
      nodeId: node.nodeId,
      pageNo: node.pageNo,
      imageUrl: view?.imageUrl ?? null,
      body: view?.body ?? node.body,
      // `missing` 只认视图那一份（`readerStory` 说图缺了就是缺了）；
      //   视图整条读不到（树上有一页、页表里没有）同样算缺——纸上照实说，不留一张空图
      missing: view ? view.missing : true,
      branch: mark.branch,
      branchLabel: mark.branchLabel,
      choice: choiceOf(node, view),
    })
  }

  return sheets
}
