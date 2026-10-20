/**
 * events.ts —— 引擎与 UI 之间的那道 seam。
 *
 * 引擎不返回一本书，引擎一边跑一边吐事件，最后一个是 `book-ready`。为什么是这个方向：
 *
 * 1. 生成一本书要几分钟，而"正在画第 7 页""第 9 页不太像，正在重画"这句话本身就是产品要
 *    展示的东西（#2 Agent 8 分 + #17 AI 交互 3 分共 11 分压在这里）。一次性返回结果，
 *    这 11 分没有载体。
 * 2. 同一串事件喂三个消费者：前端可视化、MCP 工具返回、技术文档里的过程日志。所以它是协议，
 *    不是 React 回调（ADR-0004 的第 3 条理由）。
 * 3. 失败语义：一步失败不终止整条流（tech-selection §5 第 3 条）。于是 `error` 带 `fatal`，
 *    非致命的继续走，前端显示"这一页退回了"而不是整页白屏。
 *
 * 传输（SSE / ReadableStream）不在这里，在 app/api 那一层。本文件只定义事件形状——这样
 * node 脚本与 Route Handler 消费的是同一个接口，"引擎不碰 React"这条约束才有可验证的意义。
 *
 * `stage` / `pageNo` / `attempt` 在头部，不在各变体里：tech-selection §5 要求事件至少能表达
 * `{page, stage, attempt, reason, score}` 五个字段。前三个是每条事件都有的坐标，放进头部
 * 就不会出现"某个变体忘了带页号"。
 */

import { NARRATION_PART_LABELS } from './domain.ts'
import type { NarrationPart } from './domain.ts'

/** 流水线阶段。人话文案由 UI 决定，这里只给语义名 */
export const STAGES = [
  'planning',
  /**
   * 2026-10-19 加（`.scratch/rag`）。它是编故事内部的一步，不是与它并列的第五个阶段——
   * 所以 `frames.ts` 那条 4 格阶段轨一格都不加，它落在「编故事」那一格的 `note` 上
   * （与规划期的 `retry` 同一条处置）。摆一个只亮一次的节点，就是那个文件点名的「骗人」。
   */
  'retrieving',
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
  retrieving: '正在翻以前写过的故事',
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
       * 加它的理由与 `choicePages` 同一条：画桌只吃事件，而"这一格属于哪一支"这件事只从
       * 草稿的 `via` 里读得出来——事件流里没有草稿。从草稿读的话，同一串事件会折出两张
       * 不同的桌子，重放（从书架进来，没有草稿）又什么都不标。
       *
       * 可选：2026-10-18 之前落盘的日志没有这个字段（那是历史，不重录），读的时候没有就不标
       * ——`Frame.via` 为 null，画桌上一条色带都不挂。
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
      kind: 'retrieved'
      /**
       * 这一轮用的语料指纹（`rag/corpus.ts` 的 `corpusVersion`）。
       * 检索没跑成时是 `null`——不是空串，也不是"某个默认语料"。这两件事的处置完全不同：
       * `null` 说"这一轮等于没检索"，空串会被读成"语料名叫空"。
       */
      corpusVersion: string | null
      examples: number
      avoids: number
      /** 最高分。`null` = 一条都没取到（合法结果，不是失败） */
      topScore: number | null
    }
  | {
      /**
       * 模型调了一次工具（2026-10-19，`.scratch/mcp` 工单 06）。
       *
       * 它落在「编故事」那一格里，与 `retrieved` 同一条处置（见 `frames.ts`）——它是规划
       * 内部的一步，不是与规划并列的阶段，所以阶段轨一格都不加。
       * `ok` 是"这一次调用有没有跑成"，不是"模型满不满意"：工具抛错时 `ok:false`，
       * 而那不终止整条循环（错误原文喂回去，模型自己改）——所以它必须出现在过程里，
       * 否则"模型在改"与"什么都没发生"分不出来。
       */
      kind: 'tool'
      name: string
      ok: boolean
      ms: number
      /** 出错时的一句话（给人看的）。成功时不给，不给一个"OK"占位 */
      note?: string
    }
  | {
      kind: 'narration'
      voiceId: string
      assetPath: string
      reused: boolean
      /**
       * 这一份是这一页的哪一段（缺省 = 正文）。见 `domain.ts` 的 `Narration.part`。
       * 一页最多四段（正文 / 引导提问 / 选项 A / 选项 B），所以过程面板得说得出是哪一段——
       * 四条"第 6 页配好音了"并排出现在屏幕上，等于什么都没说。
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
 * 存在的理由只有一个：`seq` 必须每本书从 1 开始且不漏号，而散在各处写 `seq: n++`
 * 迟早有一处忘了带。
 *
 * `startSeq` 是给单页重做留的（工单 01 §3.2）。重做时事件是往同一个 `events.jsonl`
 * 追加的（`log.truncate` 只在一轮整本开始时才截断），而序号从 1 重来的话，日志里会出现
 * 两条 `seq: 1`——`seq` 正是"重放能重建同一串界面状态"与"SSE 断线重连后对齐"的依据。
 * 所以调用方要按日志里已有的最大号接上去（`maxSeqOf`）。缺省仍是 0（下一号是 1），
 * 整本那一轮一个字都不用改。
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
 * 一串事件里最大的 `seq`（空的一串给 0）。接续序号只走这一个函数——
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
    case 'retrieved':
    // 工具调用占行（2026-10-19）：它是"模型这一轮去查了什么"，而家长看了会改变对进度的
    // 理解——`isDisplayable` 的判据就是这一句。与通过的核对不同：那一条不占行是因为它 20 页
    // 要刷 20 条一模一样的话。
    case 'tool':
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
  // `pageNo === 0` 是封面的约定，不是"第 0 页"。封面是一次单独的出图（见 domain.ts 的
  // Cover），它没有页号，但事件通道是同一套。不在这里翻译的话，过程面板会显示"第 0 页画
  // 好了"——那句话在界面上是噪音，而且会让人以为页号从 0 开始数。
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
      // 2026-10-18：这条文案原来只有一句「${page}不太像，正在重画（第 k / N 次）：reason」，
      // 而规划阶段的失败也走这条事件（`plan.ts` 的两条：schema 没过、树形不合法）。于是家长在
      // 画桌上读到的是「不太像，正在重画（第 1 / 3 次）：故事结构不对（1 处）」——那一刻一张图
      // 都还没画，"不太像"说的是谁、在重画什么，两句话都对不上。抓它的是一次真跑：用户圈出来的
      // 正是屏幕上那一行（他以为某张图出了错）。又因为规划期的 `retry` 没有页号，它只能落进画桌
      // 底部那一栏"不属于任何一页的提醒"，离它说的事最远——所以 `frames.ts` 把它单独收进
      // `desk.planning`，摆回"正在编故事"那一行底下。
      //
      // 2026-10-19 加了第三个分枝，起因是同一句假话又长出来一次：画面审核也会触发重画，而那一页
      // 可能画得很像，只是图里有个不该出现的东西。套上"不太像"会让家长去找一个根本不存在的相似度
      // 问题。分辨它靠的仍然是 `stage`，所以那条 `retry` 发的是 `'auditing'` 而不是 `'retrying'`。
      // 第三个分枝加在这里，而不是给事件载荷加一个 `why` 字段：`stage` 已经是这条事件上现成的
      // 判别位，再立一个就是"同一件事有两个说法"。
      return event.stage === 'planning'
        ? `这一版故事没通过校验，正在重写（第 ${event.attempt ?? '?'} / ${event.maxAttempts} 次）：${event.reason}`
        : event.stage === 'auditing'
          ? `${page}的画里有不该给孩子看的东西，正在重画（第 ${event.attempt ?? '?'} / ${event.maxAttempts} 次）：${event.reason}`
          : `${page}不太像，正在重画（第 ${event.attempt ?? '?'} / ${event.maxAttempts} 次）：${event.reason}`
    case 'review': {
      // 2026-10-19（`.scratch/rag` 工单 05）：这条分支到这一天为止从未被走到过（`review` 事件
      // 全仓库没有 emit 过，`frames.ts` 那条注释原来指的就是这件事）。闸门接上之后它第一次会
      // 出现在屏幕上，所以原来那句直接把枚举值印出来的 `${event.verdict}`（屏幕上会长出
      // "内容检查：flag"这种半句英文）必须换掉。
      // `reason` 有值就原样用它：它是 `reviewProblemText` 给的一整句，已经带着页码、条款 id 与
      // 命中的词。再加前缀会变成「第 1 页内容检查没过：第 1 页：恐怖（R-01）…」——同一件事说两遍。
      if (event.reason) return event.reason
      const what = event.check === 'safety' ? '内容检查' : '前后连贯检查'
      const verdict =
        event.verdict === 'pass'
          ? '通过'
          : event.verdict === 'block'
            ? '没过，这一版不能给孩子看'
            : event.verdict === 'unavailable'
              ? '没法查（这一档今天没跑）'
              : '没过，要改一版'
      return `${page}${what}${verdict}`
    }
    case 'tool':
      // 一句人话，与日志/MCP 返回同源（文件头那条）。两个分支都要说得出"是哪一步"：
      // `name` 是工具名，`note` 只在失败时有。
      return event.ok
        ? `查了一下「${event.name}」（${(event.ms / 1000).toFixed(1)} 秒）`
        : `查「${event.name}」没成：${event.note ?? '没说原因'}（模型会自己改，接着往下编）`
    case 'retrieved': {
      // 这一句要说得清"空"是什么：`[]` 是合法结果（"这次没有可参考的"），不是失败。写成
      // "检索失败"或干脆不显示，都会让家长以为出了故障，而"这次没翻到"本身是有信息量的
      // （新主题、头一本书）。语料指纹是 `null` 时才真的是"没检索成"（见那个字段的注释）。
      if (event.corpusVersion === null) return '这次没翻成以前的故事（照常往下编）'
      const found = [
        event.examples > 0 ? `${event.examples} 段可以照着写的` : '',
        event.avoids > 0 ? `${event.avoids} 段他读过的（这本避开）` : '',
      ].filter(Boolean)
      return found.length > 0
        ? `翻到了 ${found.join('、')}`
        : '以前的故事里没有相近的（这次没有可参考的）'
    }
    case 'narration': {
      // 一页最多四段，所以"第 6 页配好音了"要带上是哪一段——四条一模一样的句子并排出现在过程
      // 面板里，等于什么都没说。正文那一档不带后缀：那是绝大多数情况，加一个"的正文"只是噪音。
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
