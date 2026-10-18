/**
 * events.ts —— 引擎与 UI 之间的那道 seam
 *
 * 引擎**不返回**一本书，引擎一边跑**一边吐**事件，最后一个是 `book-ready`。
 * 为什么是这个方向：
 *
 * 1. 生成一本书要几分钟，而"正在画第 7 页""第 9 页不太像，正在重画"这句话
 *    本身就是产品要展示的东西（#2 Agent 8 分 + #17 AI 交互 3 分共 11 分压在这里）。
 *    一次性返回结果，这 11 分没有载体。
 * 2. 同一串事件喂三个消费者：前端可视化、MCP 工具返回、技术文档里的过程日志。
 *    所以它是**协议**，不是 React 回调（ADR-0004 的第 3 条理由）。
 * 3. 失败语义：一步失败**不终止整条流**（tech-selection §5 第 3 条）。
 *    于是 `error` 带 `fatal`，非致命的继续走，前端显示"这一页退回了"而不是整页白屏。
 *
 * ★ 传输（SSE / ReadableStream）不在这里，在 app/api 那一层。
 *   本文件只定义事件形状 —— 这样 node 脚本与 Route Handler 消费的是同一个接口，
 *   "引擎不碰 React"这条约束才有可验证的意义。
 *
 * ★ `stage` / `pageNo` / `attempt` 在**头部**，不在各变体里：
 *   tech-selection §5 要求事件至少能表达 `{page, stage, attempt, reason, score}` 五个字段。
 *   前三个是每条事件都有的坐标，放进头部就不会出现"某个变体忘了带页号"。
 */

import { NARRATION_PART_LABELS } from './domain.ts'
import type { NarrationPart } from './domain.ts'

/** 流水线阶段。人话文案由 UI 决定，这里只给语义名 */
export const STAGES = [
  'planning',
  'illustrating',
  'checking',
  'retrying',
  'auditing',
  'narrating',
  'assembling',
] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABELS: Record<Stage, string> = {
  planning: '正在编故事',
  illustrating: '正在画',
  checking: '正在核对是不是同一个孩子',
  retrying: '正在重画',
  auditing: '正在检查适不适合孩子看',
  narrating: '正在配音',
  assembling: '正在装订',
}

/** 每条事件都带的坐标；`seq` 与 `at` 由工厂填，调用方不许自己编 */
export type EventHead = {
  /** 单调递增，每本书从 1 起。SSE 断线重连与日志对齐靠它，不靠时间戳（同一毫秒会撞） */
  seq: number
  /** epoch ms */
  at: number
  stage: Stage
  /** 不针对某一页的阶段（planning / assembling）不填 */
  pageNo?: number
  attempt?: number
}

/** 调用方 emit 时能写的部分：变体载荷 + 头部里那三个可填坐标 */
export type EngineEventPayload = (
  | { kind: 'stage'; phase: 'begin' | 'end'; total?: number }
  | {
      kind: 'plan-ready'
      form: 'solo' | 'shared'
      title: string
      nodeCount: number
      choicePages: readonly number[]
      /**
       * 两条支各自的页码（工单 05 §三）。`a` = 第一个选项那一支。
       *
       * ★ 加它的理由与 `choicePages` 同一条：**画桌只吃事件**（`frames.ts` 那条
       *   "一张桌子只取决于事件流"），而"这一格属于哪一支"这件事只从
       *   草稿的 `via` 里读得出来——事件流里没有草稿。
       *   从草稿读的话，同一串事件会折出两张不同的桌子，重放（从书架进来，
       *   没有草稿）又什么都不标。
       * ★ **可选**：2026-10-18 之前落盘的日志没有这个字段（那是历史，不重录），
       *   读的时候没有就不标——`Frame.via` 为 null，画桌上一条色带都不挂。
       */
      branchPages?: { a: readonly number[]; b: readonly number[] }
    }
  | { kind: 'illustration'; assetPath: string; modelId: string; costCny?: number }
  | {
      kind: 'consistency'
      score: number | null
      verdict: 'pass' | 'fail' | 'unavailable'
      threshold: number
      missedAnchors: readonly string[]
    }
  | { kind: 'retry'; maxAttempts: number; reason: string }
  | {
      kind: 'review'
      check: 'safety' | 'coherence'
      verdict: 'pass' | 'flag' | 'block' | 'unavailable'
      reason?: string
    }
  | {
      kind: 'narration'
      voiceId: string
      assetPath: string
      reused: boolean
      /**
       * 这一份是这一页的哪一段（缺省 = 正文）。见 `domain.ts` 的 `Narration.part`。
       * ★ 一页最多四段（正文 / 引导提问 / 选项 A / 选项 B），所以过程面板得说得出是哪一段——
       *   四条"第 6 页配好音了"并排出现在屏幕上，等于什么都没说。
       */
      part?: NarrationPart
    }
  | { kind: 'book-ready'; bookId: string; path: string; stats: Record<string, number> }
  | { kind: 'error'; code: string; message: string; fatal: boolean }
) & { stage?: Stage; pageNo?: number; attempt?: number }

export type EngineEvent = EventHead & EngineEventPayload

/**
 * 事件工厂 —— 一个闭包，不是一个类。
 *
 * 存在的理由只有一个：`seq` 必须每本书从 1 开始且不漏号，
 * 而散在各处写 `seq: n++` 迟早有一处忘了带。
 *
 * ★ `startSeq` 是给**单页重做**留的（工单 01 §3.2）。重做时事件是往**同一个**
 *   `events.jsonl` **追加**的（`log.truncate` 只在一轮整本开始时才截断），
 *   而序号从 1 重来的话，日志里会出现两条 `seq: 1`——`seq` 正是
 *   "重放能重建同一串界面状态"与"SSE 断线重连后对齐"的依据。
 *   所以调用方要按日志里已有的**最大号**接上去（`maxSeqOf`）。
 *
 * ★ 缺省仍是 0（下一号是 1）：整本那一轮一个字都不用改。
 */
export function createEventFactory(clock: () => number = () => Date.now(), startSeq = 0) {
  let seq = startSeq
  return function emit(payload: EngineEventPayload): EngineEvent {
    seq += 1
    const { stage = 'planning', ...rest } = payload
    return { seq, at: clock(), stage, ...rest } as EngineEvent
  }
}

/**
 * 一串事件里最大的 `seq`（空的一串给 0）。**接续序号只走这一个函数**——
 * 调用点自己写 `Math.max(...events.map(e => e.seq))` 的话，空数组会得到 `-Infinity`，
 * 而那个值会让下一条事件拿到一个负号，界面上不会有任何东西提示这件事。
 */
export function maxSeqOf(events: readonly EngineEvent[]): number {
  return events.reduce((max, event) => (event.seq > max ? event.seq : max), 0)
}

/**
 * 这条事件该不该在"过程可视化"里占一行。纯函数，UI 与测试共用。
 *
 * 判据是"家长看了会改变对进度的理解"，不是"引擎内部发生了事"：
 * 通过的核对不占行（否则 20 页会刷出 20 条 0.93，真正的异常被埋掉），
 * 落盘的插画占行（那是看得见的产出）。
 */
export function isDisplayable(event: EngineEvent): boolean {
  switch (event.kind) {
    case 'stage':
    case 'illustration':
    case 'narration':
    case 'retry':
    case 'error':
    case 'book-ready':
      return true
    case 'consistency':
      return event.verdict !== 'pass'
    case 'review':
      return event.verdict !== 'pass'
    default:
      return false
  }
}

/** 一句话人话。放在引擎侧而不是 UI 侧：MCP 返回与日志也要同一句话，不能各翻一遍 */
export function describeEvent(event: EngineEvent): string {
  // ★ `pageNo === 0` 是**封面**的约定，不是"第 0 页"。封面是一次单独的出图
  //   （见 domain.ts 的 Cover），它没有页号，但事件通道是同一套。
  //   不在这里翻译的话，过程面板会显示"第 0 页画好了"——那句话在界面上是噪音，
  //   而且会让人以为页号从 0 开始数。
  const page =
    event.pageNo === undefined ? '' : event.pageNo === 0 ? '封面' : `第 ${event.pageNo} 页`
  switch (event.kind) {
    case 'stage':
      return `${STAGE_LABELS[event.stage]}${event.phase === 'begin' ? '…' : '完成'}`
    case 'plan-ready':
      return `故事编好了：《${event.title}》，${event.nodeCount} 页${event.choicePages.length ? `，${event.choicePages.length} 个选择点` : ''}`
    case 'illustration':
      return `${page}画好了`
    case 'consistency':
      return event.score === null
        ? `${page}没法核对（比对模型不可用）`
        : `${page}的小主角${event.verdict === 'pass' ? '是他' : `不太像（${event.score.toFixed(2)} < ${event.threshold.toFixed(2)}）`}`
    case 'retry':
      // ★ 2026-10-18：这条文案原来只有一句「${page}不太像，正在重画（第 k / N 次）：reason」，
      //   而**规划阶段的失败也走这条事件**（`plan.ts` 的两条：schema 没过、树形不合法）。
      //   于是家长在画桌上读到的是「不太像，正在重画（第 1 / 3 次）：故事结构不对（1 处）」——
      //   那一刻一张图都还没画，"不太像"说的是谁、在重画什么，两句话都对不上。
      //   抓它的是一次真跑：用户圈出来的正是屏幕上那一行（他以为某张图出了错）。
      //   ★ 又因为规划期的 `retry` **没有页号**，它只能落进画桌底部那一栏"不属于任何一页的提醒"，
      //     离它说的事最远——所以 `frames.ts` 把它单独收进 `desk.planning`，
      //     摆回"正在编故事"那一行底下（那边有注释）。
      return event.stage === 'planning'
        ? `这一版故事没通过校验，正在重写（第 ${event.attempt ?? '?'} / ${event.maxAttempts} 次）：${event.reason}`
        : `${page}不太像，正在重画（第 ${event.attempt ?? '?'} / ${event.maxAttempts} 次）：${event.reason}`
    case 'review':
      return `${page}${event.check === 'safety' ? '内容检查' : '前后连贯检查'}：${event.verdict}`
    case 'narration': {
      // ★ 一页最多四段，所以"第 6 页配好音了"要带上**是哪一段**——
      //   四条一模一样的句子并排出现在过程面板里，等于什么都没说。
      //   正文那一档不带后缀：那是绝大多数情况，加一个"的正文"只是噪音。
      const what =
        event.part && event.part !== 'body' ? `的${NARRATION_PART_LABELS[event.part]}` : ''
      return `${page}${what}配好音了${event.reused ? '（复用已有录音）' : ''}`
    }
    case 'book-ready':
      return `书做好了：${event.bookId}`
    case 'error':
      return `${page ? page + '：' : ''}${event.message}`
  }
}
