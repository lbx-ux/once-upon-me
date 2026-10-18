/**
 * story.ts —— 故事规划的输出契约（判据 1 测的就是它）
 *
 * ★ 四个必填字段 = tech-selection §9.2 判据 1 里"每页 4 字段"的那四个：
 *   `scene`（场景描述）/ `body`（正文）/ `imagePrompt`（画面 prompt）/ `mood`（情绪标签）。
 *   横评报告的通过率按这四个算，多出来的树形字段不计入通过率——
 *   它们是共读版才要的东西，把它算进判据会让同一批候选在不同形态下得出不同结论。
 *
 * ★ 为什么是**扁平节点表**而不是嵌套 JSON 树：
 *   模型写嵌套结构的失败率明显高（少一个闭合括号整本作废），而扁平表 + `from` 引用
 *   既让 4 字段的通过率干净可测，又让"跳到第 7 页""级联删除"这类操作不用递归。
 *   树的有效性由 engine/tree.ts 在解析**之后**校验——结构错是数据问题，
 *   不该混进 Schema 通过率里。
 */

import { MOODS } from '../engine/domain.ts'
import {
  array,
  enumOf,
  number,
  object,
  optional,
  string,
  stringList,
  withDefault,
  type Codec,
} from './schema.ts'

const CHOICE_VIA = ['a', 'b'] as const
export type ChoiceVia = (typeof CHOICE_VIA)[number]

/**
 * ★★ 选择点**平铺在节点上**，不写成 `choice: { prompt, options: [{…},{…}] }`（2026-10-18）。
 *
 * 这不是审美，是把一个实测出来的失败率改掉。旧的嵌套写法下，共读版规划的
 * **单次尝试通过率只有 2/12 = 17%**，而 8 次失败里有 7 次的症状是同一个：
 *
 *     nodes[4].choice.options：数量不足（0 < 2）
 *
 * ——模型把 `choice` 开着、`prompt` 写好了，**`options` 交回一个空数组**。
 * 而这个 schema 里唯一的"对象数组"就是 `options`（`body` 是字符串数组，从来没出过错）。
 * 这正对上本文件文件头那句早就写着的话：「模型写嵌套结构的失败率明显高」。
 *
 * 所以线格式拍平、**领域类型一个字段都不动**：`engine/tree.ts` 的 `toChoice()`
 * 把下面这九个平铺格子组装成 `StoryChoice`。这条路本来就是这个模块的既定招式
 * （扁平表 + `from` 引用 → 树在**解析之后**由 `tree.ts` 校验并组装），
 * 只是 `choice` 一个地方当初没照着走。
 *
 * 命名与对应关系（`tree.ts` 会按这个把两支排好）：
 * - `ask`      → `choice.prompt`（给家长念的引导提问）
 * - `*A` 那四个 → `options[0]`，也就是 `via: "a"` 那一支
 * - `*B` 那四个 → `options[1]`，也就是 `via: "b"` 那一支
 * ★ `iconKey` / `emoji` 仍然宽容（`withDefault`），`label` / `spoken` 必须有值——
 *   前者是装饰，后者是孩子在按钮上看见与听见的东西。
 * ★ 九个格子**只在选择点那一页写**，其余页一个都不写（写了就是形态错误，`tree.ts` 会报）。
 */
export const nodeDraftCodec: Codec<Record<string, unknown>> = object<{ [k: string]: unknown }>({
  scene: string({ min: 4, max: 200 }),
  body: stringList({ min: 1, max: 4, itemMax: 120 }),
  imagePrompt: string({ min: 8, max: 400 }),
  mood: enumOf(MOODS),
  /**
   * 父节点是**表里的第几页**（1 起）。
   *
   * ★ 用序号不用自造 ID：让模型自己编 `node_a7f3` 这种串，它会开始复用、笔误、
   *   或者引用一个还不存在的节点。"接在第 3 页后面"是它本来就会说的话。
   *   树的有效性由 engine/tree.ts 校验，Schema 只管形状。
   */
  from: optional(number({ integer: true, min: 1, max: 40 })),
  /** 从父节点的选择点走的是哪条边 */
  via: optional(enumOf(CHOICE_VIA)),

  /* ── 选择点：给家长念的那句 + 两侧各四个格子 ─────────────────────────── */
  ask: optional(string({ min: 4, max: 60 })),
  labelA: optional(string({ min: 2, max: 12 })),
  spokenA: optional(string({ min: 2, max: 40 })),
  iconA: withDefault(string({ max: 24 }), 'generic'),
  emojiA: withDefault(string({ max: 4 }), '✨'),
  labelB: optional(string({ min: 2, max: 12 })),
  spokenB: optional(string({ min: 2, max: 40 })),
  iconB: withDefault(string({ max: 24 }), 'generic'),
  emojiB: withDefault(string({ max: 4 }), '✨'),
})

export const planDraftCodec: Codec<Record<string, unknown>> = object<{ [k: string]: unknown }>({
  title: string({ min: 2, max: 20 }),
  nodes: array(nodeDraftCodec, { min: 3, max: 40 }),
})

/** 给模型的 json_schema 档用（registry 里 LLM_JSON_MODE=schema 时才真的发出去） */
export function planJsonSchema(): Record<string, unknown> {
  return planDraftCodec.describe()
}

/**
 * 选择点那一页多出来的九个格子。**其余页一个都不写**（写了就是形态错误）。
 *
 * ★ 它平铺在这里而不是嵌在 `choice.options` 里，理由在 `nodeDraftCodec` 上方那段 ★★。
 * ★ 九个格子都写成可选，是因为"这一页是不是选择点"这件事**由有没有写明**决定，
 *   而"写了几个"是语义问题（缺哪个、够不够两个），归 `engine/tree.ts` 判——
 *   那条界线与本模块文件头那条（Schema 管形状、tree.ts 管语义）是同一条。
 */
/**
 * 选择点那九格的名字，**按线格式里的字段名**。
 *
 * ★ 它是给**读路径的那一侧**用的：`story-problems.ts` 拿它把 `nodes[4].labelA`
 *   这类失败路径翻回界面上那一组框（不认得的路径会被报成"整篇"的问题，
 *   于是家长会在"页数"那一格下面读到一句关于选项的话）。
 * ★ 与 `nodeDraftCodec` 的键**必须同名**，而那件事**只有能自动红的判据才算数**——
 *   所以 `story-problems.test.ts` 里有一条拿 `planJsonSchema()` 逐个核对的用例。
 *   只写在注释里的约定，一定会有人违反它（这份仓库为这一条付过学费）。
 */
export const CHOICE_CELLS = [
  'ask',
  'labelA',
  'spokenA',
  'iconA',
  'emojiA',
  'labelB',
  'spokenB',
  'iconB',
  'emojiB',
] as const

export type ChoiceDraft = {
  /** 给家长念的引导提问 */
  ask?: string
  labelA?: string
  spokenA?: string
  iconA?: string
  emojiA?: string
  labelB?: string
  spokenB?: string
  iconB?: string
  emojiB?: string
}

/**
 * 模型吐回来的原始形状。
 * 校验之后由 tree.ts 变成 StoryTree —— 中间这一层是"还没相信过的数据"，
 * 所以它的字段全是宽松类型，不给它任何行为方法。
 */
export type NodeDraft = {
  scene: string
  body: string[]
  imagePrompt: string
  mood: string
  /** 父节点在表里的 1 起序号；undefined = 接在前一页后面 */
  from?: number
  via?: string
} & ChoiceDraft

export type PlanDraft = { title: string; nodes: NodeDraft[] }

/**
 * 同一份东西的**另一个名字**（2026-10-17，故事闸门）。
 *
 * ★ 为什么值得一个别名而不是到处写 `PlanDraft`：从"编故事"这一步开始，
 *   这张表同时是**三个东西**——模型吐回来的原始输出、家长在 `StorySheet` 上看到并
 *   逐条改的那一份、以及 `books/<id>/story.json` 里躺着的那一份。
 *   名字跟着**用途**走（那是"故事"，不是"plan 的内部草案"），而形状必须是同一个：
 *   一旦有人为界面另立一个类型，转换那一层就是"改的东西"与"画的东西"分家的地方。
 */
export type StoryDoc = PlanDraft

/** 把已校验的对象收窄成上面那个形状（校验器只保证形状，不替我们做类型体操） */
export function asPlanDraft(value: Record<string, unknown>): PlanDraft {
  return {
    title: String(value['title'] ?? ''),
    nodes: (Array.isArray(value['nodes']) ? value['nodes'] : []).map(asNodeDraft),
  }
}

function asNodeDraft(value: unknown): NodeDraft {
  const record = (value ?? {}) as Record<string, unknown>
  /** 没有就是没有——不把缺失补成空串，否则"没写"与"写了个空的"就分不出来了 */
  const text = (key: keyof ChoiceDraft): string | undefined =>
    record[key] === undefined ? undefined : String(record[key])
  return {
    scene: String(record['scene'] ?? ''),
    body: (record['body'] as string[] | undefined) ?? [],
    imagePrompt: String(record['imagePrompt'] ?? ''),
    mood: String(record['mood'] ?? 'calm'),
    from: typeof record['from'] === 'number' ? record['from'] : undefined,
    via: record['via'] === undefined ? undefined : String(record['via']),
    ask: text('ask'),
    labelA: text('labelA'),
    spokenA: text('spokenA'),
    iconA: text('iconA'),
    emojiA: text('emojiA'),
    labelB: text('labelB'),
    spokenB: text('spokenB'),
    iconB: text('iconB'),
    emojiB: text('emojiB'),
  }
}
