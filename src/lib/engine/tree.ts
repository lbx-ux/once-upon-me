/**
 * tree.ts —— 扁平页表 → 故事树（纯函数）
 *
 * ★ 为什么"一棵树、两种形态"（GLOSSARY「形态」的判据在代码里的样子）：
 *   独读版 = **没有任何选择点**的树。它不是另一套结构、另一条流水线。
 *   如果两种形态各写一套，产品就成了"两个功能"，而本项目全部的主张
 *   （一个引擎、两种形态 → 平台而非聚合）当场失效。
 *   代价说清：独读版要走一遍树的校验，分支版能做的事独读版天然也能做——
 *   这个代价是我们主动付的，因为它换来的正是那句判据。
 *
 * 输入约定（见 schemas/story.ts）：`from` 是父节点在表里的 **1 起序号**，缺省 = 前一页。
 * 只允许**向前引用**（父序号必须小于自己），于是环在定义上不可能出现——
 * 与其写一个找环算法，不如让环无法被表达。这是选"序号"而不是"自造 ID"的第二个理由。
 */

import type { BookForm, ChoiceOption, Mood, StoryChoice, StoryNode, StoryTree } from './domain.ts'
import { MOODS } from './domain.ts'
import type { NodeDraft } from '../schemas/story.ts'

export type TreeProblem = { index: number; message: string }

export type BuildTreeResult =
  { ok: true; tree: StoryTree; problems: [] } | { ok: false; tree: null; problems: TreeProblem[] }

/**
 * 建一棵树。所有问题**一次全报**，不是遇到第一个就返回：
 * 规划失败时我们要把整份问题清单塞进重试提示（plan.ts），
 * 一次只报一条会让重试次数等于问题条数——那是拿钱换啰嗦。
 */
export function buildTree(
  form: BookForm,
  title: string,
  drafts: readonly NodeDraft[],
): BuildTreeResult {
  const problems: TreeProblem[] = []
  if (drafts.length === 0) {
    return { ok: false, tree: null, problems: [{ index: 0, message: '一页都没有' }] }
  }

  const nodes: StoryNode[] = []
  /** 1 起序号 → 该节点的子节点（下标） */
  const childOf = new Map<number, { index: number; via: string }[]>()

  drafts.forEach((draft, i) => {
    const pageNo = i + 1
    const parent = draft.from ?? (i === 0 ? null : i)
    if (i === 0 && draft.from !== undefined) {
      problems.push({ index: pageNo, message: '第一页不能有父节点' })
    } else if (parent !== null && (parent < 1 || parent >= pageNo)) {
      problems.push({ index: pageNo, message: `父节点序号 ${parent} 不合法（必须小于本页且存在）` })
    }

    if (parent !== null && parent >= 1 && parent < pageNo) {
      const siblings = childOf.get(parent) ?? []
      siblings.push({ index: i, via: draft.via ?? '' })
      childOf.set(parent, siblings)
    }

    const mood = (MOODS as readonly string[]).includes(draft.mood) ? (draft.mood as Mood) : 'calm'
    if (mood !== draft.mood) {
      problems.push({ index: pageNo, message: `mood「${draft.mood}」不在枚举里` })
    }

    nodes.push({
      nodeId: `n${pageNo}`,
      pageNo,
      scene: draft.scene,
      body: draft.body,
      imagePrompt: draft.imagePrompt,
      mood,
      choice: toChoice(draft, pageNo, problems, form),
      next: [],
      pathFromRoot: [],
    })
  })

  /* 形态约束：选择点必须恰好两条、且标了 a/b；非选择点不得有第二个孩子 */
  for (const [parentNo, children] of childOf) {
    const parent = nodes[parentNo - 1]
    if (!parent) continue
    if (parent.choice) {
      if (children.length !== 2) {
        problems.push({
          index: parentNo,
          message: `选择点有 ${children.length} 条分支，必须是 2 条`,
        })
      }
      const vias = children.map((c) => c.via)
      if (!vias.includes('a') || !vias.includes('b')) {
        problems.push({
          index: parentNo,
          message: `两条分支要分别标 via=a 与 via=b，实际是 ${vias.join(',') || '（空）'}`,
        })
      }
      // 顺序 = 选项顺序：via=a 的孩子对应 options[0]。反了的话孩子点"骑恐龙"
      // 却走到"上船"那一页，而页面上完全看不出来。
      const ordered = [...children].sort((a, b) => (a.via === 'a' ? -1 : b.via === 'a' ? 1 : 0))
      parent.next = ordered.map((child) => nodes[child.index]?.nodeId ?? '').filter(Boolean)
    } else if (children.length > 1) {
      problems.push({
        index: parentNo,
        message: `这一页没有 choice，却有 ${children.length} 个子节点`,
      })
    } else {
      parent.next = children.map((child) => nodes[child.index]?.nodeId ?? '').filter(Boolean)
    }
  }

  if (form === 'shared' && !nodes.some((n) => n.choice)) {
    problems.push({ index: 0, message: '共读版一个选择点都没有——那就是独读版，请改 form 或补分支' })
  }
  if (form === 'solo' && nodes.some((n) => n.choice)) {
    problems.push({ index: 0, message: '独读版不许有选择点（睡前越选越兴奋）' })
  }

  if (problems.length > 0) return { ok: false, tree: null, problems }

  const rootId = nodes[0]?.nodeId ?? ''
  const paths = computePaths(nodes, rootId)
  const withPaths = nodes.map((node) => ({ ...node, pathFromRoot: paths.get(node.nodeId) ?? [] }))
  return { ok: true, tree: { form, title, rootId, nodes: withPaths }, problems: [] }
}

function toChoice(
  draft: NodeDraft,
  pageNo: number,
  problems: TreeProblem[],
  form: BookForm,
): StoryChoice | undefined {
  const raw = draft.choice
  if (!raw) return undefined
  if (raw.options.length !== 2) {
    problems.push({
      index: pageNo,
      message: `选择点必须有 2 个选项，实际 ${raw.options.length} 个`,
    })
    return undefined
  }
  if (form === 'solo') {
    problems.push({ index: pageNo, message: '独读版不该出现 choice' })
    return undefined
  }
  const options: [ChoiceOption, ChoiceOption] = raw.options.slice(0, 2) as [
    ChoiceOption,
    ChoiceOption,
  ]
  return { prompt: raw.prompt, options }
}

/** 从根到每个节点的路径。父链唯一（上面已保证），所以这就是个 BFS，不需要访问集防环 */
function computePaths(nodes: readonly StoryNode[], rootId: string): Map<string, readonly string[]> {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const paths = new Map<string, readonly string[]>()
  const queue: string[] = [rootId]
  paths.set(rootId, [rootId])
  while (queue.length > 0) {
    const current = queue.shift() as string
    const node = byId.get(current)
    if (!node) continue
    const path = paths.get(current) ?? [current]
    for (const childId of node.next) {
      if (!childId || paths.has(childId)) continue
      paths.set(childId, [...path, childId])
      queue.push(childId)
    }
  }
  return paths
}

/** 选择点所在的页号，进度条要提前标出来（events.ts 的 plan-ready 带它） */
export function choicePagesOf(tree: StoryTree): number[] {
  return tree.nodes.filter((node) => node.choice).map((node) => node.pageNo)
}

/** 从根走到某个节点要经过哪些页 —— "走过的路"与"上次你走的是这条路"的数据源 */
export function pathOf(tree: StoryTree, nodeId: string): StoryNode[] {
  const byId = new Map(tree.nodes.map((node) => [node.nodeId, node]))
  const node = byId.get(nodeId)
  if (!node) return []
  return node.pathFromRoot
    .map((id) => byId.get(id))
    .filter((entry): entry is StoryNode => Boolean(entry))
}

/** 独读版的线性读法：按 pageNo 排。共读版按路径读，两者共用这一份数据 */
export function linearOrder(tree: StoryTree): StoryNode[] {
  return [...tree.nodes].sort((a, b) => a.pageNo - b.pageNo)
}
