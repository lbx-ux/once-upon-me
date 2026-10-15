/**
 * frames.ts —— 一串引擎事件 → 一张「画桌」（纯函数，无 React）
 *
 * 生成页从"一行一行的文字日志"改成"一格一格的画框"之后，**唯一**需要小心的地方
 * 就是这一层：它把事件流折叠成"第 N 页现在长什么样"。所以它是纯函数、有测试，
 * 不塞进组件的 `useState` 里——那样只能开浏览器才能验。
 *
 * ★ 一句话概括它做的事：**按 `pageNo` 归格**，与 `pageNo` 无关的事件不进格子。
 *
 * 三条判据（每条都对应一种真的会错的写法）：
 *
 * 1. **`illustration` 是覆盖，不是追加**。同一页重画时引擎会再发一条 `illustration`
 *    （`illustrate.ts:145`，带 `attempt`），而它说的是**同一格**。写成 push 的话，
 *    重画一次就多出一格——20 页的书重画 3 页会变成 23 格，而标题上写着 20 页。
 * 2. **`plan-ready` 一到就把空画框全摆出来**。它带 `nodeCount` 但不带 `pageNo`，
 *    所以格子是**索引**出来的（1..N），不是等事件来才长。摆空框是这件事的意义所在：
 *    "20 格里画好了 7 格"是诚实的进度，不需要另编一根百分比条。
 * 3. **不带 `pageNo` 的阶段事件不占格**。`planning` / `assembling` 不属于任何一页，
 *    它们要去上面那一行状态里。真把它们塞进格子，会出现"第 21 页：正在装订"。
 *
 * ★ 「哪一格正在画」是**事件说的，不是猜的**：引擎在每一页动手之前会发一条带
 *   `pageNo` 的 `stage(begin, illustrating)`（`illustrate.ts:97`）。所以这里不需要用
 *   "第一个还没有图的格子"那种推测去代替它——那种推测在乱序到达时会指错格子，
 *   而屏幕上没有任何东西会显示它指错了。
 *   ★ 反过来说清楚**没有**的东西：**核对阶段没有对应的 stage 事件**
 *     （`illustrate.ts` 在 `checking` 那一段发的是 `consistency`，而它带着判定结果，
 *     意思是"核对完了"）。所以这一层**不声称**"第 N 页正在核对"——
 *     那是从"刚画完、还没核对完"推出来的，而推理的结论没人能证伪。
 *     录下来的真实事件流（`scripts/engine-run.mts --mode=stub`，19 条）里
 *     只有 `illustrating` 的 begin，一条 `checking` 的 stage 都没有。
 *
 * ★ 文案一个字都不在这里写：能用 `describeEvent` 的就用它的（README：同一句话
 *   要出现在屏幕、MCP 返回与日志三处，各写一份必然漂）。
 */

import { describeEvent, type EngineEvent, type Stage } from '@/lib/engine/events.ts'

/** 一格上那句话的语气。与原来 `cf__log` 的 `data-tone` 同一套值 */
export type FrameTone = 'info' | 'ok' | 'warn' | 'bad'

export type Frame = {
  /** 页码，从 1 起。它在 `plan-ready` 之后就是确定的（1..total） */
  pageNo: number
  /** 图落库之后才有。**有它才叫画好了** */
  assetPath: string | null
  /** 到过第几次（`illustration` / `retry` 里带的 `attempt`）。1 = 第一次就成了 */
  attempt: number
  /** 配过音了（`narration` 到的页） */
  narrated: boolean
  /** 这一格上的那句话：核对不过、正在重画、内容检查被标了……没有就是 null */
  note: string | null
  noteTone: FrameTone
  /**
   * 这一格**此刻**在画。终态是 null，静止模式下只有一个静态描边（见 CSS）。
   * ★ 它只在引擎真的说了"开始画这一页"（`stage(begin, illustrating)`）或
   *   "正在重画"（`retry`）时才非 null。**没有** `checking` 这一档：
   *   引擎不发核对的 stage 事件（理由见文件头）
   */
  busy: 'drawing' | null
}

/** 不属于任何一页、但家长该看见的一句话（非致命的 error 主要落在这里） */
export type DeskNote = { key: string; text: string; tone: FrameTone }

export type DeskState = {
  /** `plan-ready` 说的书名。还没编好故事时是 null */
  title: string | null
  /** 这一本要做多少格。`plan-ready` 之前是 0（＝还不知道） */
  total: number
  frames: Frame[]
  /** 画桌上方那一行状态（`describeEvent` 对 stage 的原话） */
  stageLine: string | null
  /** 上面那一行说的那件事**还在做**（`phase: 'begin'`） */
  stageRunning: boolean
  /**
   * **最新一条事件**所处的阶段。★ 它取的是每条事件都带的头部 `stage`，不是
   * `kind === 'stage'` 那种——真实事件流里 `narrating` / `assembling` 两段
   * **没有 stage 事件**（只有 `error` 与 `book-ready` 的头部标着它们），
   * 只看 stage 事件的话，画完之后这一行会一直停在"正在画"。
   */
  stage: Stage | null
  notes: DeskNote[]
  /** 书做好了：收起整排，只留封面与那一条路 */
  ready: { bookId: string; coverPath: string | null; stats: Record<string, number> } | null
  /** 致命错误：原样带着，由界面用 `role="alert"` 摊开——**不藏进任何一格** */
  fatal: string | null
}

export const EMPTY_DESK: DeskState = {
  title: null,
  total: 0,
  frames: [],
  stageLine: null,
  stageRunning: false,
  stage: null,
  notes: [],
  ready: null,
  fatal: null,
}

/** 一条事件 → 一句话的语气。纯函数，从 `CreateFlow` 搬过来的（它要用它定格子的样式） */
export function toneOf(event: EngineEvent): FrameTone {
  switch (event.kind) {
    case 'error':
      // 非致命的那类（"配音未接入"这种）标成提醒，不标成红：红是留给"这一轮真的坏了"的
      return event.fatal ? 'bad' : 'warn'
    case 'retry':
      return 'warn'
    case 'consistency':
      return event.verdict === 'fail' ? 'warn' : 'info'
    case 'book-ready':
      return 'ok'
    default:
      return 'info'
  }
}

/**
 * 一串事件 → 一张画桌。**只扫一遍**，后到的事件覆盖先到的（同一页重画就是覆盖）。
 *
 * ★ 名字叫 `deskOf` 而不是计划里写的 `framesOf`：它返回的是**整张桌子**
 *   （书名、总格数、上面那行状态、不属于任何一页的提醒、成品），不只是那排画框。
 *   叫 `framesOf` 会让调用方以为还要自己再拼一遍剩下的部分——拼的那一遍就是漂移开始的地方。
 */
export function deskOf(events: readonly EngineEvent[]): DeskState {
  const desk: DeskState = { ...EMPTY_DESK, frames: [], notes: [] }
  const byPage = new Map<number, Frame>()

  /**
   * 取这一格的引用，没有就补一格。
   * ★ `total` 一起抬到至少 `pageNo`：否则会出现"上面写着 3 页、下面有 4 格"，
   *   而那一句"k / N 页"里的 N 就是从 `total` 来的
   */
  const frameFor = (pageNo: number): Frame => {
    const existing = byPage.get(pageNo)
    if (existing) return existing
    const frame: Frame = {
      pageNo,
      assetPath: null,
      attempt: 0,
      narrated: false,
      note: null,
      noteTone: 'info',
      busy: null,
    }
    byPage.set(pageNo, frame)
    desk.frames.push(frame)
    desk.total = Math.max(desk.total, pageNo)
    return frame
  }

  for (const event of events) {
    // 每一条事件的头部都带着"现在在第几段"，所以这一行永远跟着最新的一条走
    desk.stage = event.stage

    switch (event.kind) {
      case 'stage': {
        desk.stageLine = describeEvent(event)
        desk.stageRunning = event.phase === 'begin'
        // ★ 带页码的阶段事件：那是"这一页正在画"，落在**那一格**上。
        //   不带页码的（planning / assembling）只更新上面那一行
        if (event.pageNo === undefined) break
        const frame = frameFor(event.pageNo)
        if (event.phase === 'end') frame.busy = null
        else if (event.stage === 'illustrating') frame.busy = 'drawing'
        break
      }

      case 'plan-ready': {
        desk.title = event.title
        // ★ 只增不减。乱序或重放时 total 变小会让已经画好的格子被"裁掉"
        desk.total = Math.max(desk.total, event.nodeCount)
        // 空画框立刻摆出来——**这才是进度**：N 个框、k 个有画
        for (let pageNo = 1; pageNo <= desk.total; pageNo += 1) frameFor(pageNo)
        break
      }

      case 'illustration': {
        if (event.pageNo === undefined) break
        const frame = frameFor(event.pageNo)
        // ★ 覆盖同一格（理由见文件头判据 1）
        frame.assetPath = event.assetPath
        frame.attempt = Math.max(frame.attempt, event.attempt ?? 1)
        frame.busy = null
        // 上一条"不太像 / 正在重画"说的是**上一张图**，新图到了它就该让位
        frame.note = null
        frame.noteTone = 'info'
        break
      }

      case 'consistency': {
        // ★ 通过的核对不占格——`isDisplayable` 就是这么定的，别再自己判一遍
        if (event.verdict === 'pass') break
        const text = describeEvent(event)
        if (event.pageNo === undefined) {
          desk.notes.push({ key: `e${event.seq}`, text, tone: toneOf(event) })
          break
        }
        const frame = frameFor(event.pageNo)
        frame.note = text
        frame.noteTone = toneOf(event)
        break
      }

      case 'retry': {
        const text = describeEvent(event)
        if (event.pageNo === undefined) {
          desk.notes.push({ key: `e${event.seq}`, text, tone: toneOf(event) })
          break
        }
        const frame = frameFor(event.pageNo)
        frame.note = text
        frame.noteTone = toneOf(event)
        frame.attempt = Math.max(frame.attempt, event.attempt ?? frame.attempt)
        // "正在重画"是这条事件字面上的意思，所以这一格确实是忙的
        frame.busy = 'drawing'
        break
      }

      case 'review': {
        if (event.verdict === 'pass') break
        const text = describeEvent(event)
        if (event.pageNo === undefined) {
          desk.notes.push({ key: `e${event.seq}`, text, tone: toneOf(event) })
          break
        }
        const frame = frameFor(event.pageNo)
        frame.note = text
        frame.noteTone = toneOf(event)
        break
      }

      case 'narration': {
        if (event.pageNo === undefined) break
        frameFor(event.pageNo).narrated = true
        break
      }

      case 'book-ready': {
        desk.ready = {
          bookId: event.bookId,
          // 封面就是**第 1 页那张画**：书里没有另一张单独的封面资产，
          // 编一个不存在的路径出来会在界面上变成一个碎图标
          coverPath: byPage.get(1)?.assetPath ?? null,
          stats: event.stats,
        }
        desk.stageLine = describeEvent(event)
        desk.stageRunning = false
        break
      }

      case 'error': {
        if (event.fatal) {
          // ★ 致命错误**不进格子**也不进 notes：它整轮结束了，得摊在最上面
          desk.fatal = event.message
          break
        }
        const text = describeEvent(event)
        if (event.pageNo === undefined) {
          desk.notes.push({ key: `e${event.seq}`, text, tone: toneOf(event) })
          break
        }
        const frame = frameFor(event.pageNo)
        frame.note = text
        frame.noteTone = toneOf(event)
        frame.busy = null
        break
      }
    }
  }

  /**
   * ★ 格子按页码升序，**不按到达顺序**。
   *   正常顺序（plan-ready 先到）下两者一样；但页码来得比计划早或晚时，
   *   按到达顺序排会让第 2 页画在第一个格子里——屏幕上没有任何东西会提示这件事，
   *   只有家长自己发现"第 1 页和第 2 页的顺序反了"。
   *   （这条是测试逼出来的：`illustration` 早于 `plan-ready` 的用例里，
   *     数组长成了 [2, 1, 3]。）
   */
  desk.frames.sort((left, right) => left.pageNo - right.pageNo)

  return desk
}

/** 已经画好几格。界面上的"k / N"就是它 */
export function drawnCount(desk: DeskState): number {
  return desk.frames.filter((frame) => frame.assetPath !== null).length
}
