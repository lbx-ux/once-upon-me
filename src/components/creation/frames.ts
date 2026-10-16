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
 *    "20 格里画好了 7 格"是诚实的进度。
 *    ★ 2026-10-16 补一句：`drawnRatio()` 那根进度条**也不与它冲突**——两者是同一个数
 *      （`drawnCount / total`）的两种画法，一个是格数、一个是长度。原来这里写的是
 *      "不需要另编一根百分比条"，那句话反对的是**编出来的**分母，不是条本身；
 *      用户后来明确要一根条，于是它按真数补上了（见 `drawnRatio` 那段）。
 * 3. **不带 `pageNo` 的阶段事件不占格**。`planning` / `assembling` 不属于任何一页，
 *    它们要去上面那一行状态里。真把它们塞进格子，会出现"第 21 页：正在装订"。
 * 4. **`pageNo: 0` 是封面，不是"第 0 页"**，所以它**也不成格**（2026-10-16 补，工单 05）。
 *    封面是一次单独的出图（3:4 竖版、不比对、不重画，`illustrateCover`），
 *    它落进 `Cover.asset`。判据 3 只说了"不带 `pageNo` 的不成格"，而封面**带**着一个
 *    页号字段——`describeEvent` 早就把这条写成约定了（"`pageNo === 0` 是**封面**的约定"），
 *    这一层当时没跟上：每一处都只判 `=== undefined`，0 就一路当页号用了。
 *    ★ 症状**只有真跑一本才看得见**（stub 那条流里没有封面事件）：画桌最前面多一格
 *      写着「0」、里面是封面，而计数写着 `4 / 3 页画好了`。测出来的，不是推出来的。
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
 *   ★ 2026-10-16（工单 01）**配音那一边不再是同一回事了**：`narrateNode` 现在在合成
 *     前后各发一条**带 `pageNo`** 的 `stage(begin/end, narrating)`，所以"第 N 页正在配音"
 *     是事件说的，`busy` 因此多了 `'voicing'` 一档。**核对那一段一个字没改**——
 *     它仍然没有分页 stage，仍然不声称。两条判断的依据不同，所以结论也不同，
 *     别把这一条当成"那就顺手把 checking 也加上"。
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
   * 这一格**此刻**在做什么。终态是 null，静止模式下只有一个静态描边（见 CSS）。
   *
   * ★ `'drawing'` 只在引擎真的说了"开始画这一页"（`stage(begin, illustrating)`）或
   *   "正在重画"（`retry`）时才非 null。
   * ★ `'voicing'` 来自 `stage(begin, narrating)`——★ 那是 2026-10-16 新加的（工单 01），
   *   `narrateNode` 在合成前后各发一条**带页码**的。原来 `narrateAll` 只发不带页码的，
   *   于是没有任何东西说得清"这一页正在配音"（文件头那条）。
   * ★ **没有** `'checking'` 这一档：引擎不发核对的 stage 事件（理由见文件头）
   */
  busy: 'drawing' | 'voicing' | null
}

/** 不属于任何一页、但家长该看见的一句话（非致命的 error 主要落在这里） */
export type DeskNote = { key: string; text: string; tone: FrameTone }

export type DeskState = {
  /** `plan-ready` 说的书名。还没编好故事时是 null */
  title: string | null
  /**
   * 封面那张画。★ 它**不是第 0 页**，也不占格子（2026-10-16，工单 05）：
   * 封面是一次单独的出图（3:4 竖版、不比对、不重画，见 `illustrateCover`），
   * 它的事件带 `pageNo: 0`，而那是一个**约定**而不是页号。
   * ★ 实测抓出来的：真跑一本之后画桌上多了一格写着「0」、里面是封面，
   * 而计数写着 `4 / 3 页画好了`。原来每一处都只判 `=== undefined`，0 就漏了过去。
   */
  coverPath: string | null
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
  coverPath: null,
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

  /**
   * 这一条事件说的是**第几页**。★ 三种回答，其中一种是 2026-10-16 补的（工单 05）：
   *
   * - 一个 ≥ 1 的数：那是某一页，进它自己的格子
   * - `undefined`：不属于任何一页（规划、装订），去上面那一行状态
   * - **`0`：那是封面**，也**不进格子**（`describeEvent` 早就把这条约定写在注释里了：
   *   "`pageNo === 0` 是**封面**的约定，不是'第 0 页'"）
   *
   * ★ 第三条是**实测抓出来的**，不是推演：真跑一本之后 CDP 打开运行视图，
   *   画桌上多了一格写着「0」、里面是那张竖版封面，而上面的计数写着
   *   **`4 / 3 页画好了`**——3 页的书数出了 4 格。
   *   原来每一处都是 `if (event.pageNo === undefined) break`，于是 0 一路当成页号用。
   */
  const pageOf = (event: { pageNo?: number }): number | null =>
    event.pageNo === undefined || event.pageNo === 0 ? null : event.pageNo

  for (const event of events) {
    // 每一条事件的头部都带着"现在在第几段"，所以这一行永远跟着最新的一条走
    desk.stage = event.stage

    switch (event.kind) {
      case 'stage': {
        desk.stageLine = describeEvent(event)
        desk.stageRunning = event.phase === 'begin'
        // ★ 带页码的阶段事件：那是"这一页正在画"，落在**那一格**上。
        //   不带页码的（planning / assembling）只更新上面那一行
        const pageNo = pageOf(event)
        if (pageNo === null) break
        const frame = frameFor(pageNo)
        if (event.phase === 'end') frame.busy = null
        else if (event.stage === 'illustrating') frame.busy = 'drawing'
        else if (event.stage === 'narrating') frame.busy = 'voicing'
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
        // ★ 封面的那条 `illustration`（`pageNo: 0`）走这里，落在 `desk.coverPath`
        //   而不是某一格上。它是**一次单独的出图**，不是书的第 0 页
        if (event.pageNo === 0) {
          desk.coverPath = event.assetPath
          break
        }
        const pageNo = pageOf(event)
        if (pageNo === null) break
        const frame = frameFor(pageNo)
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
        const pageNo = pageOf(event)
        if (pageNo === null) {
          desk.notes.push({ key: `e${event.seq}`, text, tone: toneOf(event) })
          break
        }
        const frame = frameFor(pageNo)
        frame.note = text
        frame.noteTone = toneOf(event)
        break
      }

      case 'retry': {
        const text = describeEvent(event)
        const retryPage = pageOf(event)
        if (retryPage === null) {
          desk.notes.push({ key: `e${event.seq}`, text, tone: toneOf(event) })
          break
        }
        const frame = frameFor(retryPage)
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
        const reviewPage = pageOf(event)
        if (reviewPage === null) {
          desk.notes.push({ key: `e${event.seq}`, text, tone: toneOf(event) })
          break
        }
        const frame = frameFor(reviewPage)
        frame.note = text
        frame.noteTone = toneOf(event)
        break
      }

      case 'narration': {
        const pageNo = pageOf(event)
        if (pageNo === null) break
        frameFor(pageNo).narrated = true
        break
      }

      case 'book-ready': {
        desk.ready = {
          bookId: event.bookId,
          // ★ 优先用真的那张封面（`book.cover`，3:4 竖版）。**退回第 1 页那张画**
          //   是为了读**没有封面事件的旧日志**（封面字段是 2026-10-15 才加的）。
          //   当时那句"书里没有另一张单独的封面资产"今天不成立了——有了，
          //   但旧日志里没有它，所以退路留着，而不是把老的这一条删掉。
          coverPath: desk.coverPath ?? byPage.get(1)?.assetPath ?? null,
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
        const errorPage = pageOf(event)
        if (errorPage === null) {
          desk.notes.push({ key: `e${event.seq}`, text, tone: toneOf(event) })
          break
        }
        const frame = frameFor(errorPage)
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

/**
 * 进度条那一段该有多宽，`0..1`。
 *
 * ★ 分子分母**都是真数**（`drawnCount` / `total`）——这一点是这个函数唯一的职责。
 *   2026-10-16 用户要求"正在画那一块来点交互效果，比如加个进度条"，
 *   而 `Desk.tsx` 文件头第 1 条原来写的是**反对**进度条的（"一根 35% 的进度条是
 *   编出来的数"）。那条反对**不是反掉进度条**，是反掉"编出来的分母"：
 *   当时没有每页的进度事件，任何一根条都只能自己估。今天也不是估的——
 *   条的长度就是"几格有画 / 一共几格"，与那排空画框**是同一个数**。
 *   写成一个纯函数而不是在组件里算，是为了让它能被 `frames.test.ts` 钉住：
 *   它是这条新加的视觉里唯一会算错的地方（分母是 0、以及画好的格数会不会超过总数）。
 *
 * ★ `total` 为 0（`plan-ready` 还没到）时返回 0，不是 `NaN`，也不是"先给一半"——
 *   那时候**确实不知道**要做多少页，所以条是空的；空的条比一根假装走了几成的条诚实。
 */
export function drawnRatio(desk: DeskState): number {
  if (desk.total <= 0) return 0
  // 挡一下：`total` 只增不减，而格数是索引出来的，理论上画好的格数不会超过它
  return Math.min(1, drawnCount(desk) / desk.total)
}

/** 已经配好几格。与 `drawnCount` 对称，同样只有一处实现 */
export function narratedCount(desk: DeskState): number {
  return desk.frames.filter((frame) => frame.narrated).length
}

/* ───────────────────────── 阶段轨（工单 05） ───────────────────────── */

/**
 * 阶段轨 —— 运行视图顶上那一行「编故事 → 逐页画 → 配音 → 装订」。
 *
 * ★ 它是 **4 格，不是 5 格**，也**不是**原型里那 5 个节点。差别不在数量，在**有没有事实**：
 *
 * 1. **没有「核对」这一格**。引擎的核对是每页画完**立刻**比的（`illustrating` 与
 *    `checking` 逐页交替），做成节点会 20 页闪 40 次，而那个闪烁只说明我们在数事件。
 *    核对是**某一页的事**，所以它留在那一格的 `note` 上（`Desk.tsx` 的 `dk__note`
 *    本来就是干这个的）。与文件头那条"不声称第 N 页正在核对"是同一条纪律。
 * 2. **不放「内容审核」**这类节点：`auditing` 与 `review` 在全仓库**从未 emit**，
 *    摆一个永远不亮的节点是骗人（CLAUDE.md §不糊弄）。
 * 3. **「逐页画」那一格的 `k / N` 是真数**（`drawnCount` / `desk.total`），
 *    不是另画一根百分比条——`Desk.tsx` 文件头第 1 条已经写过这条判断。
 *
 * ★ 每一格的判据都来自 `desk` 里**已经成立的事实**（书名、每格有没有图/音、成品在不在），
 *   **不是**"事件走到哪一段了"那种推断。差别在**单页重画之后**才看得出来：
 *   重画第 3 页时事件的 stage 会回到 `illustrating`，按"走到哪一段"推的话
 *   装订那一格会**从完成退回未做**——而书明明已经装订好了。
 */
export type RailKey = 'planning' | 'illustrating' | 'narrating' | 'assembling'

export type RailState =
  /** 还没轮到 */
  | 'todo'
  /** 正在做这一件 */
  | 'now'
  /** 已经做完 */
  | 'done'
  /** 这一本**不做**这件事（关掉朗读时的配音） */
  | 'skipped'
  /** 这一本走到了，但没做全（有页没配上音）。★ 与 `skipped` 分开：那是"不做"，这是"没做成" */
  | 'partial'

export type RailNode = {
  key: RailKey
  label: string
  state: RailState
  /** 「逐页画」/「配音」那一格上的 `k / N`。其余节点没有 */
  note?: string
}

/** 四格的顺序与名字。**只在这里写一遍**，界面按它 map */
export const RAIL: readonly { key: RailKey; label: string }[] = [
  { key: 'planning', label: '编故事' },
  { key: 'illustrating', label: '逐页画' },
  { key: 'narrating', label: '配音' },
  { key: 'assembling', label: '装订' },
]

/** 「逐页画」这一格涵盖的三个 stage：画、核对、重画，都是"正在逐页做" */
const DRAWING_STAGES = new Set<Stage>(['illustrating', 'checking', 'retrying'])

function count(total: number, done: number): string | undefined {
  return total > 0 ? `${done} / ${total}` : undefined
}

/** 有没有**某一页**正在被画 / 正在被配音。单页重做时它是唯一的信号 */
function anyBusy(desk: DeskState, kind: NonNullable<Frame['busy']>): boolean {
  return desk.frames.some((frame) => frame.busy === kind)
}

/**
 * 一张画桌 → 那一行阶段轨。纯函数，`frames.test.ts` 钉着它。
 *
 * `voiceOn` 由调用方给（它来自这一次请求，不在事件流里）：关掉朗读时
 * 「配音」那一格是 `skipped` 并写着"不配音"，**不是**灰着不说。
 *
 * ★ 「画」与「配音」两格都先看**有没有某一页正在忙**，再看整本的计数。
 *   差别在单页重做时才看得见：那时候 20 页早就都有图了（`k === N`），
 *   按计数它永远停在 done，而屏幕上明明有一格在转。
 */
export function railOf(desk: DeskState, voiceOn: boolean): RailNode[] {
  const total = desk.total
  const drawn = drawnCount(desk)
  const narrated = narratedCount(desk)
  const stage = desk.stage

  return RAIL.map((node): RailNode => {
    switch (node.key) {
      case 'planning':
        // 书名是 `plan-ready` 说的，所以它一到这一步就真的做完了
        return {
          ...node,
          state: desk.title !== null ? 'done' : stage === 'planning' ? 'now' : 'todo',
        }

      case 'illustrating':
        return {
          ...node,
          state: anyBusy(desk, 'drawing')
            ? 'now'
            : total > 0 && drawn === total
              ? 'done'
              : stage !== null && DRAWING_STAGES.has(stage)
                ? 'now'
                : 'todo',
          ...(count(total, drawn) === undefined ? {} : { note: count(total, drawn) }),
        }

      case 'narrating': {
        // ★ 关掉朗读时它是 `skipped`：这一本**不做**这件事，界面要说得出来
        if (!voiceOn) return { ...node, state: 'skipped', note: '不配音' }
        const note = count(total, narrated)
        if (anyBusy(desk, 'voicing') || stage === 'narrating') {
          return { ...node, state: 'now', ...(note === undefined ? {} : { note }) }
        }
        if (total > 0 && narrated === total)
          return { ...node, state: 'done', ...(note === undefined ? {} : { note }) }
        // 书都装订完了还有页没配上音——那是"没做成"，不是"还没轮到"
        if (desk.ready)
          return { ...node, state: 'partial', ...(note === undefined ? {} : { note }) }
        return { ...node, state: 'todo' }
      }

      case 'assembling':
        return {
          ...node,
          state: desk.ready ? 'done' : stage === 'assembling' ? 'now' : 'todo',
        }
    }
  })
}
