/**
 * story-problems.ts —— 一份故事表**还能不能拿去画**（纯函数，浏览器安全）
 *
 * 它是「故事闸门」上的那道判据：家长在 `StorySheet` 上逐条改故事，而
 * 「就按这个画」那颗按钮**什么时候该亮**、亮不了时**为什么**，都由这里回答。
 *
 * ## 判据只有一处，两端都用它
 *
 * 校验跑的是**引擎发出去的那两个东西**，一个字都不重写：
 *
 * | 管什么 | 谁 | 查出来的问题长什么样 |
 * | --- | --- | --- |
 * | 形状（字段在不在、长度、枚举） | `schemas/story.ts` 的 `planDraftCodec` | `nodes[2].body[1]：过长（121 > 120）` |
 * | 语义（父节点引用、选择点分支数、形态约束） | `engine/tree.ts` 的 `buildTree` | `第 4 页：父节点序号 9 不合法` |
 *
 * ★ 为什么不能在两处各写一份"最短 4 个字、最长 200 个字"：那是**同一个判断的两个家**，
 *   而它们漂移的症状是"界面上说可以画了，服务端 400"。这个仓库已经为同一类事
 *   付过学费（`state.ts` 里 `toBookBody` 那段"两处一起改"）。
 * ★ 所以这个模块**只做两件事**：把两端的结果翻成人话、并把它们绑到界面上那一格去。
 *   它不新增任何一条校验规则。
 *
 * ## 为什么它不在 `story-draft.ts` 里（那个文件是服务端的）
 *
 * `StorySheet` 是客户端组件，而 `story-draft.ts` 要读盘（`node:fs`）。
 * 混在一起的那天起，客户端 bundle 会因为"只想调一个纯函数"而拖进文件系统
 * （eslint 那条 `engine/index` 规则的注释记着同一个事故）。两个模块各自只装
 * 自己那一半，是这条边界最省事的形状。
 */

import { buildTree } from './engine/tree.ts'
import { CHOICE_CELLS, planDraftCodec } from './schemas/story.ts'
import type { BookForm } from './engine/domain.ts'
import type { ParseFailure } from './schemas/schema.ts'
import type { NodeDraft, PlanDraft } from './schemas/story.ts'

/**
 * 问题落在书架那一屏的哪一格上。`nodes` 是"整篇"那一档（页数不够、整份不是数组）。
 */
export type StoryField = 'title' | 'scene' | 'body' | 'imagePrompt' | 'mood' | 'choice' | 'nodes'

export type StoryProblem = {
  /** 第几页（1 起）。★ **0 = 不属于任何一页**（书名、整篇的页数） */
  pageNo: number
  field: StoryField
  /** 正文的第几句（1 起）。只有 `body` 有 */
  line?: number
  /** 一句人话，直接印在那一格下面 */
  message: string
}

/** 字段在界面上的名字。★ 与 `StorySheet` 的标签是同一套词（改一处就得改两处的是**话**，
 *  而这里只能有一份：按钮上那句"第 3 页的正文…"与输入框旁边那句必须是同一句） */
const FIELD_LABELS: Record<StoryField, string> = {
  title: '书名',
  scene: '情节',
  body: '正文',
  imagePrompt: '画面',
  mood: '语气',
  choice: '选择点',
  nodes: '页数',
}

/** `nodes[2].body[1]` 这种路径。没带下标的那一段就是整篇（书名、nodes 本身） */
const NODE_PATH = /^nodes\[(\d+)\](?:\.(.+))?$/
const LINE_PATH = /^body\[(\d+)\]$/

/**
 * 一份故事表 → 一串问题。**空的数组 = 可以拿去画**。
 *
 * `form` 要传进来，是因为 `buildTree` 的形态约束（独读版不许有选择点、
 * 共读版至少一个）只有它知道——那一条**不是**形状问题，schema 查不出来。
 */
export function storyProblemsOf(form: BookForm, doc: PlanDraft): StoryProblem[] {
  const shape = planDraftCodec.parse(doc, '')
  const problems: StoryProblem[] = shape.ok ? [] : dedupe(shape.failures.map(shapeProblemOf))

  // 形状不对就不再往下走语义：`asPlanDraft` 会把缺的字段补成空串，
  // 于是 buildTree 会为同一个空字段再报一次（"这一页的正文是空的"+"情节过短"），
  // 而家长看到的是同一处坏了两遍
  if (!shape.ok) return problems

  const built = buildTree(form, doc.title, doc.nodes as readonly NodeDraft[])
  if (!built.ok) {
    for (const problem of built.problems) {
      problems.push({
        // `buildTree` 的 index 就是页号（1 起）；0 = 不属于任何一页
        pageNo: problem.index,
        field: problem.index === 0 ? 'nodes' : 'scene',
        message: problem.message,
      })
    }
  }
  return problems
}

/**
 * 同一个字段上叠了好几条时只留一条。
 *
 * ★ 不是"少报"，是**同一个格子上写不下第二句**：一行正文 121 个字又正好是空的
 *   （trim 之后），两句话会挤在同一个输入框下面，而它们说的是同一件事
 *   （"这一句不合规"）。留第一条——codec 是按字段顺序报的，第一条就是最靠前的那处。
 */
function dedupe(problems: StoryProblem[]): StoryProblem[] {
  const seen = new Set<string>()
  return problems.filter((problem) => {
    const key = `${problem.pageNo}:${problem.field}:${problem.line ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** `planDraftCodec` 的一条失败 → 界面上那一格。★ 认不出的路径**照实报成整篇的问题**，
 *  不许丢掉——丢掉的那一条正是"按钮亮着但服务端拒绝"的来源 */
function shapeProblemOf(failure: ParseFailure): StoryProblem {
  const path = failure.path === '$' ? '' : failure.path
  const match = NODE_PATH.exec(path)

  // 不带 `nodes[...]` 的路径：书名、或者整份 nodes 的条数
  if (!match) {
    const field: StoryField = path === 'title' ? 'title' : 'nodes'
    return { pageNo: 0, field, message: friendly(failure.message, field) }
  }

  const pageNo = Number(match[1]) + 1
  const rest = match[2] ?? ''
  const [head, tail] = splitField(rest)
  const line = tail === undefined ? undefined : Number(tail) + 1
  return {
    pageNo,
    field: head,
    ...(head === 'body' && line !== undefined ? { line } : {}),
    message: friendly(failure.message, head),
  }
}

/** `body[1]` → `['body', '1']`；`labelA` → `['choice', undefined]` */
function splitField(rest: string): [StoryField, string | undefined] {
  const line = LINE_PATH.exec(rest)
  if (line) return ['body', line[1]]
  const head = rest.split('.')[0] ?? ''
  // ★ 选择点那九格（平铺在节点上，见 `schemas/story.ts` 那段 ★★）都归到界面上那一组框。
  //   名字只有一份（`CHOICE_CELLS`），而且有一条用例拿 schema 逐个核对——
  //   漏掉一格，家长就会在**别的格子**下面读到一句关于这一格的话。
  if ((CHOICE_CELLS as readonly string[]).includes(head)) return ['choice', undefined]
  const known: StoryField[] = ['scene', 'body', 'imagePrompt', 'mood', 'choice']
  return [(known.find((field) => field === head) ?? 'nodes') as StoryField, undefined]
}

/**
 * codec 的原话 → 给家长看的一句。
 *
 * ★ **认不出来就原样回**（`return message`）。这一条是刻意的：翻译表只覆盖
 *   最常见的四种，而"看不懂的话"比"看不见的话"便宜得多——
 *   悄悄吞掉一条，症状是按钮亮着、服务端 400，而屏幕上没有一处说得清为什么。
 * ★ 量词要按字段换（"页" / "句" / "个字"）：`数量不足（0 < 3）` 那句话在**书名**上
 *   说不通，而"至少要 3 页"才是一句家长能照着改的话。
 */
function friendly(message: string, field: StoryField): string {
  const long = /^过长（(\d+) > (\d+)）$/.exec(message)
  if (long) return `太长了：最多 ${long[2]} 个字，现在是 ${long[1]} 个字`
  const short = /^过短（(\d+) < (\d+)）$/.exec(message)
  if (short) return `太短了：至少要 ${short[2]} 个字，现在是 ${short[1]} 个字`
  const many = /^数量过多（(\d+) > (\d+)）$/.exec(message)
  if (many) return about(field, '最多', many[2], '现在是', many[1])
  const few = /^数量不足（(\d+) < (\d+)）$/.exec(message)
  if (few) return about(field, '至少', few[2], '现在只有', few[1])
  return message
}

/** 数量的那句：`页数至少 3 页，现在只有 0 页` / `正文至少 1 句，现在只有 0 句` */
function about(
  field: StoryField,
  need: string,
  needValue: string,
  has: string,
  hasValue: string,
): string {
  const unit = field === 'nodes' ? '页' : field === 'body' ? '句' : '条'
  const who = field === 'nodes' ? '页数' : field === 'body' ? '正文' : '条数'
  return `${who}${need} ${needValue} ${unit}，${has} ${hasValue} ${unit}`
}

/** 一条问题在人话里的位置：「第 3 页的正文第 2 句」「书名」 */
export function whereOf(problem: StoryProblem): string {
  const label = FIELD_LABELS[problem.field]
  // ★ 书名与整篇的事不带页号：说成"第 1 页的书名"就是编一个位置出来
  if (problem.pageNo === 0) return label
  const at = `第 ${problem.pageNo} 页的${label}`
  return problem.line === undefined ? at : `${at}第 ${problem.line} 句`
}

/** 一整句：`第 3 页的正文第 2 句：太长了：最多 120 个字，现在是 121 个字` */
export function describeProblem(problem: StoryProblem): string {
  return `${whereOf(problem)}：${problem.message}`
}

/**
 * 全部问题合成一句话（按钮的 `title`、`role="alert"` 那一条）。
 * 没问题时是 `null`——**不是空串**：调用方要能一眼分开"没问题"与"问题说的是空"。
 */
export function storyProblemText(problems: readonly StoryProblem[], limit = 3): string | null {
  if (problems.length === 0) return null
  const head = problems.slice(0, limit).map(describeProblem)
  const rest = problems.length - head.length
  return rest > 0 ? [...head, `（另有 ${rest} 处）`].join('；') : head.join('；')
}
