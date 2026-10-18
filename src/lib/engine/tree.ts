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
 *
 * ★★ **两条分支不可能汇合（2026-10-18 才说清的一条推论）**：
 *   下面那三条规则（每节点最多一个父；选择点恰好两子；非选择点不得有第二个孩子）
 *   合起来意味着"某个节点由两条支共同接上"**无法被表达**——汇合节点要么需要两个父
 *   （撞第一条），要么得挂回选择点（撞第二条）。不是没实现，是**无法表达**。
 *   所以：一条支必须自带到结尾的全部页，**每加一层分支就要多付一整条尾巴**。
 *   这是"共读版恰好一个选择点"（见下面的形态约束）以及不做 2 层的根因，
 *   也是 ADR-0006 Comments 里那段"为什么不扩 `from`"的由来。
 *   ★ 别被 `FORM_RULES.shared` 旧版那句"两条分支走回同一个结尾附近"误导——
 *     那是提示词层面的一句近似（靠叙事做到），不是结构上的承诺。
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

  /*
   * ★ 共读版**恰好一个**选择点（2026-10-18）。
   *
   * 产品定义里写的是"2–3 层分支"，落地时收窄成一档，理由是**钱**：
   * 两条支不能汇合（见文件头那条 ★），所以一条支必须自带到结尾的全部页，
   * 于是每加一层要多付一整条尾巴——路长 8 页时 1 层 ≈11 张图、2 层 ≈14
   * （**43% 的书那个孩子永远读不到**）、3 层 ≈22（64%）。
   * 而选择的上界本来也不是页数给的，是年龄给的（`StoryChoice` 那条注释：
   * 「两个选项（孩子不识字，两个已经够）」）。多做几层不等于多做几次选择。
   *
   * ★ 这一条**只在结构上拦**（多于一个就报错、让模型重试）。它不是审美：
   *   多出来的那个选择点会让"两条路各自收尾"这句话变成假话——
   *   第一条岔路的某一支会被第二条岔路接走，于是有一支只走了半截。
   */
  if (form === 'shared') {
    const choices = nodes.filter((node) => node.choice)
    if (choices.length === 0) {
      problems.push({
        index: 0,
        message: '共读版一个选择点都没有——那就是独读版，请改 form 或补分支',
      })
    } else if (choices.length > 1) {
      problems.push({
        index: 0,
        message:
          `共读版这一版只支持一个选择点，实际有 ${choices.length} 个` +
          `（第 ${choices.map((node) => node.pageNo).join('、')} 页）——` +
          '两条支各自要收出一个完整的结尾，多出来的岔路会把其中一支截断',
      })
    }
    const only = choices.length === 1 ? choices[0] : undefined
    if (only) {
      const [headA, headB] = only.next
      // 两个头都有才量深度：分支数不对时上面已经报过，这里不重复报第三遍
      if (headA && headB) {
        const pagesA = branchPagesOf(nodes, headA)
        const pagesB = branchPagesOf(nodes, headB)
        if (Math.abs(pagesA - pagesB) > 1) {
          problems.push({
            index: only.pageNo,
            message:
              `两条分支的页数差太多（一支 ${pagesA} 页、另一支 ${pagesB} 页）——` +
              '一半的孩子读到的东西会明显更少，而书上没有任何东西提示这件事',
          })
        }
      }
    }
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

/**
 * 一条分支**有多少页**：从这个头节点往下走到它自己那条链的末端，节点个数。
 *
 * ★ 它量的是"这一支的孩子会读到几页"，不是树的深度（两者在单链上相等，
 *   但**页**才是家长与孩子能看见的那个量）。所以名字里写 `pages` 不写 `depth`。
 * ★ 不会死循环：父引用只许向前（`from < 自己`），所以图是一条有向森林，
 *   走不到回头路——这也是当初选"序号"而不是自造 ID 的第二个理由。
 *   节点数上界是 schema 给的 40，递归深度跟着它，不需要改成迭代。
 */
function branchPagesOf(nodes: readonly StoryNode[], startId: string): number {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  let deepest = 0
  const walk = (id: string, depth: number): void => {
    if (depth > deepest) deepest = depth
    const node = byId.get(id)
    if (!node) return
    for (const childId of node.next) walk(childId, depth + 1)
  }
  walk(startId, 1)
  return deepest
}

/**
 * 一侧选项的四个平铺格子 → `ChoiceOption`。
 *
 * `label` 与 `spoken` 缺一不可——它们是孩子**在按钮上看见**与**从耳朵里听见**的东西；
 * 图标是装饰，缺了就用兜底值（与 codec 的 `withDefault` 是同一对默认值）。
 * 收 `null` 而不是抛：这一层负责把"写了几个格子"翻译成一句**能照着改的话**，
 * 抛出去的话，家长看到的是一句关于内部字段的错误码。
 */
function optionOf(draft: NodeDraft, side: 'A' | 'B'): ChoiceOption | null {
  const label = (side === 'A' ? draft.labelA : draft.labelB)?.trim() ?? ''
  const spoken = (side === 'A' ? draft.spokenA : draft.spokenB)?.trim() ?? ''
  if (label === '' || spoken === '') return null
  const iconKey = (side === 'A' ? draft.iconA : draft.iconB)?.trim() ?? ''
  const emoji = (side === 'A' ? draft.emojiA : draft.emojiB)?.trim() ?? ''
  return {
    iconKey: iconKey === '' ? 'generic' : iconKey,
    emoji: emoji === '' ? '✨' : emoji,
    label,
    spoken,
  }
}

/**
 * 九个平铺格子 → `choice`。
 *
 * ★ 为什么线格式是平铺的、而这里又组装成嵌套的 `StoryChoice`：见 `schemas/story.ts`
 *   里 `nodeDraftCodec` 上方那段 ★★——旧写法（`choice.options` 是个对象数组）
 *   实测单次通过率 17%，而失败里七成是"`options` 交回一个空数组"。
 *   模型写不好的那一层留在**线格式**里少写，领域模型该是什么样还是什么样。
 * ★ **一个格子都没写 = 这一页不是选择点**（不写是常态，不报错）；
 *   写了但没写全 = 报错，而且报的那句话要点名缺哪几格。
 */
function toChoice(
  draft: NodeDraft,
  pageNo: number,
  problems: TreeProblem[],
  form: BookForm,
): StoryChoice | undefined {
  const ask = draft.ask?.trim() ?? ''
  const a = optionOf(draft, 'A')
  const b = optionOf(draft, 'B')

  if (ask === '' && !a && !b) return undefined
  if (form === 'solo') {
    problems.push({ index: pageNo, message: '独读版不该出现 choice' })
    return undefined
  }
  if (ask !== '' && a && b) return { prompt: ask, options: [a, b] }

  const missing: string[] = []
  if (ask === '') missing.push('ask（给家长念的那句提问）')
  if (!a) missing.push('labelA / spokenA（A 那颗按钮，走 via=a 那一支）')
  if (!b) missing.push('labelB / spokenB（B 那颗按钮，走 via=b 那一支）')
  problems.push({
    index: pageNo,
    message: `选择点写了一半：缺 ${missing.join('、')}——一个选择点 = 一句提问 + 两个选项，一个都不能少`,
  })
  return undefined
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
