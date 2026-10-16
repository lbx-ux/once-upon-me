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
  | { kind: 'narration'; voiceId: string; assetPath: string; reused: boolean }
  | { kind: 'book-ready'; bookId: string; path: string; stats: Record<string, number> }
  | { kind: 'error'; code: string; message: string; fatal: boolean }
) & { stage?: Stage; pageNo?: number; attempt?: number }

export type EngineEvent = EventHead & EngineEventPayload

/**
 * 事件工厂 —— 一个闭包，不是一个类。
 *
 * 存在的理由只有一个：`seq` 必须每本书从 1 开始且不漏号，
 * 而散在各处写 `seq: n++` 迟早有一处忘了带。
 */
export function createEventFactory(clock: () => number = () => Date.now()) {
  let seq = 0
  return function emit(payload: EngineEventPayload): EngineEvent {
    seq += 1
    const { stage = 'planning', ...rest } = payload
    return { seq, at: clock(), stage, ...rest } as EngineEvent
  }
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
      return `${page}不太像，正在重画（第 ${event.attempt ?? '?'} / ${event.maxAttempts} 次）：${event.reason}`
    case 'review':
      return `${page}${event.check === 'safety' ? '内容检查' : '前后连贯检查'}：${event.verdict}`
    case 'narration':
      return `${page}配好音了${event.reused ? '（复用已有录音）' : ''}`
    case 'book-ready':
      return `书做好了：${event.bookId}`
    case 'error':
      return `${page ? page + '：' : ''}${event.message}`
  }
}
