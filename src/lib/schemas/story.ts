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

/** 一个选项：图标语义名 + emoji 兜底 + 给人看的短标签 + 给耳朵听的口语句 */
const optionCodec = object<{ [k: string]: unknown }>({
  iconKey: withDefault(string({ max: 24 }), 'generic'),
  emoji: withDefault(string({ max: 4 }), '✨'),
  label: string({ min: 2, max: 12 }),
  spoken: string({ min: 2, max: 40 }),
})

export const choiceCodec = object<{ [k: string]: unknown }>({
  prompt: string({ min: 4, max: 60 }),
  options: array(optionCodec, { min: 2, max: 2 }),
})

/** 一页 = 一个节点 */
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
  /** 这一页是不是选择点 */
  choice: optional(choiceCodec),
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
  choice?: {
    prompt: string
    options: { iconKey: string; emoji: string; label: string; spoken: string }[]
  }
}

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
  const choice = record['choice'] as Record<string, unknown> | undefined
  return {
    scene: String(record['scene'] ?? ''),
    body: (record['body'] as string[] | undefined) ?? [],
    imagePrompt: String(record['imagePrompt'] ?? ''),
    mood: String(record['mood'] ?? 'calm'),
    from: typeof record['from'] === 'number' ? record['from'] : undefined,
    via: record['via'] === undefined ? undefined : String(record['via']),
    choice: choice
      ? {
          prompt: String(choice['prompt'] ?? ''),
          options:
            (choice['options'] as Record<string, unknown>[] | undefined)?.map((option) => ({
              iconKey: String(option['iconKey'] ?? 'generic'),
              emoji: String(option['emoji'] ?? '✨'),
              label: String(option['label'] ?? ''),
              spoken: String(option['spoken'] ?? ''),
            })) ?? [],
        }
      : undefined,
  }
}
