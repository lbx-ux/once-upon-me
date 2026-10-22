'use client'

/**
 * use-run-stream.ts —— 这一轮的**过程**（工单 D-34，2026-10-21 从 `GenerationRun.tsx` 拆出）
 *
 * 它管的是"这一轮跑成什么样"：事件流怎么落进画桌、现在停在哪一档、
 * 屏幕上那句硬失败是什么、这一本每一页此刻长什么样、书号是什么。
 * 不管的是"家长那份故事草稿"（那是 `use-story-autosave.ts`）与"阶流不在时怎么补"
 * （那是 `use-run-poll.ts`）—— 那一半的真相在 `story.json` 里，不在事件流里。
 *
 * 三个不显然的设计，每个都对应一处踩过的坑：
 *
 * 1. ★ **`sink` 把"一串事件 → 画桌"收成两个动作**（`replace` / `push`）。
 *    在这之前这句话在四个地方各抄了一遍（重放、轮询、逐页画、重写），
 *    四份里有两份是 `eventsRef.current = events; setDesk(deskOf(events))`，
 *    另两份是 `push + setDesk(deskOf(eventsRef.current))`。抄四遍本身不致命，
 *    致命的是它们**不总是一起改**：这一屏出过的两个 bug（阶流断了之后画桌停在旧帧、
 *    重写之后桌子里留着上一版的正文）都长在"有一处漏了重算"上。
 *    现在只有这里知道画桌是从事件折出来的。
 *
 * 2. ★ **事件攒在 ref 里，不进 state**（原文件头第 4 条）：state 里只有从它派生的那张画桌。
 *    每帧 `deskOf(events)` 是幂等的，所以不需要另存一份增量。
 *
 * 3. ★ **书号有两个家**（`bookId` state 与 `bookIdRef`）：`setBookId(...)` 与紧接着读它的
 *    那段代码在同一轮渲染里（都属于那个帧回调后面的 promise 链），state 要到下一轮才更新
 *    ——症状是"编完故事却说没有书号"。ref 是"这一轮里当场发生的事"，state 是渲染的输入。
 *    2026-10-21 这一条抽成 `bookIdRef` 之后，那个 promise 链仍然走 ref（见下面 boot 那一段），
 *    行为与拆之前逐字一致。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

import type { BookStreamFrame } from '@/lib/book-stream.ts'
import type { BookForm } from '@/lib/engine/domain.ts'
import type { EngineEvent } from '@/lib/engine/events.ts'
import type { StoryDoc } from '@/lib/schemas/story.ts'
import { createBook, fetchStory, listRunPages, replayFrames } from '@/lib/creation/api.ts'
import { rememberLastRun } from '@/lib/creation/last-run.ts'
import { toBookBody, type RunForm } from '@/lib/creation/state.ts'
import type { RunPageView } from '@/lib/run-pages.ts'

import { readPlanProgress } from '@/lib/engine/plan-stream.ts'

import { deskOf, EMPTY_DESK, storyDeskOf, type DeskState } from './frames.ts'
import { entryPhaseOf, type Phase } from './phase.ts'

/** 这一次生成的输入。★ 只有这几样——`wish` / `theme` 都在 `form.theme` 里，
 *  另立两个字段就是同一个值有两个家（`/home` 那颗药丸与设置的关系已经踩过这条）。 */
export type RunPlan = {
  /** 这一轮的"他是谁 + 用哪张卡 + 讲什么"，由服务端按 URL 解出来 */
  form: RunForm
  /**
   * 形态（GLOSSARY「形态」）。★ 由调用方给，不在这里写死 `'solo'`——
   * 闸门那一屏的校验要拿它跑 `buildTree`，而"独读版不许有选择点"这条判据
   * 在共读版上是反的。写死的话症状是"共读版的每页都报'独读版不许有选择点'"。
   */
  bookForm: BookForm
  pages: number
  /** 这一本用哪个音色朗读。undefined = 这一本不配音 */
  voiceId?: string
}

/**
 * 接着做一份已经在盘上的：进哪一条路由 `story` 决定。
 * （它的形状与 `GenerationRun` 那一份是同一个值，2026-10-21 搬进来因为它只有这里读。）
 */
export type RunResume = {
  bookId: string
  /** 配音开没开。★ 看 `voiceId`，不看 `narrations` 空不空（后者有两种成因） */
  voiceOn: boolean
  /** 这一本在用的音色（清单上的 `Book.voiceId`，或故事草稿里那个） */
  voiceId?: string
  /** 形态。与 `RunPlan.bookForm` 同一条理由，这里从盘上那一份读出来 */
  bookForm: BookForm
  /** 已经装订好了（只有"画完那一本"才有意义；只有故事的那一本恒为 false） */
  published: boolean
  /**
   * 盘上那一份故事草稿（`books/<id>/story.json`）。
   *
   * 有它 = 这一本故事写好了、还没开始画：直接进闸门那一屏，
   *   不重放事件日志（这一屏的事实来源是 `story.json`，不是日志）。
   *   没有它 = 画好的那一本，照旧重放（工单 02 那条路）。
   */
  story?: StoryDoc
}

/**
 * 正在写出来的那半截故事（工单 D-04）。
 *
 * 前三个字段就是 `engine/plan-stream.ts` 的产出。
 * ★ 2026-10-21 晚删掉了 `total`（"这一轮要写多少页"）：进度那一行不再报页数，
 *   统一改成「正在思考中」——分子是表里节点数、分母是请求页数，共读版上不是一个单位，
 *   而独读版那个数也不是家长关心的东西（见 `plan-lines.ts` 的 `writingLineOf`）。
 *   `pages` 只剩一个用处：判断"要不要说那句话"。
 */
export type PlanWriting = {
  title: string | null
  /** 已经闭合的正文句子，按到达顺序。每一句都是模型真写完的 */
  lines: readonly string[]
  /** 已经写完几格（只数闭合的节点）。**不再显示给用户**，只用来判断那句话说不说 */
  pages: number
}

/**
 * "一串事件 → 画桌"的唯一入口（见文件头第 1 条）。
 *
 * `replace` 用于"手上这份是完整的一份"（重放、轮询、逐页画之后重取）；
 * `push` 用于"这是一条刚到的新事件"（SSE 实时）。
 */
export type RunSink = {
  replace(events: readonly EngineEvent[]): void
  push(event: EngineEvent): void
  /** 把手上的事件与画桌一起清空（重写一版那一步要它，见 `rewrite`） */
  clear(): void
}

export type RunStream = {
  desk: DeskState
  setDesk: Dispatch<SetStateAction<DeskState>>
  phase: Phase
  setPhase: Dispatch<SetStateAction<Phase>>
  fatal: string | null
  setFatal: Dispatch<SetStateAction<string | null>>
  /** 一句话的提醒（逐页重做的失败、弹窗内容还没读到……）。与 `fatal` 分开：那个是整轮结束 */
  note: string | null
  setNote: Dispatch<SetStateAction<string | null>>
  /** 服务端这一刻还在跑吗（`status` 帧说的）。★ 进度条上那道光的唯一依据 */
  serverRunning: boolean
  setServerRunning: Dispatch<SetStateAction<boolean>>
  bookId: string | null
  sink: RunSink
  /**
   * ★ 收到一段令牌增量（2026-10-21，工单 D-04）。
   *
   * 两条路都调它：开一本那条流（本文件内）与重写那条流（`use-run-actions.ts`）。
   * 它把增量累起来、用 `readPlanProgress` 读成"已经写完的标题 / 正文行 / 页数"，
   * 落在 `writing` 上。
   *
   * ★ 为什么它住在**这一轮的过程**里，而不是闸门那一屏：它说的是"模型正在写"，
   *   与"家长手上那一份故事"（`story.json`）是两件事 —— 后者是闸门上的真相（可改、
   *   可存、拿去画的就是它），而这一份是一次性的、**不落盘**的
   *   （见 `book-stream.ts` 的 `delta` 那一条：重放一段打字机动画没有意义）。
   */
  pushDelta: (text: string) => void
  /** 正在写出来的那半截。`null` = 这一刻没有字在流（还没开始 / 写完了 / 又从头写了一遍） */
  writing: PlanWriting | null
  /**
   * 「就按这个画」那一条流**只吃事件，不吃 `status` 帧**。
   *
   * ★ 为什么不做成一个"看情况分派"的总处理器：②这一条路的收尾帧是
   *   `{running: false, bookReady: false}`——那是它的正常终态（书才刚刚开始画），
   *   照"`bookReady: false + running: false` = 失败了"那条映射走会把它读成 `'failed'`，
   *   屏幕上会闪一下"这一本没做出来"。与其用一个分支去猜这一刻是谁在说话，
   *   不如让每一条路自己说下一步是什么：出图的事件到了就是 `'running'`，
   *   拿到 `book-ready` 事件就是 `'ready'`。
   *   ★ 2026-10-21（D-34）这里删掉了一个 `onFrame`：原来那个"整本流的总处理器"
   *   **一次都没有被调用过**（两条活着的路各自需要不同的映射，各自写了内联回调），
   *   它只在 boot 那个 effect 的依赖数组里出现过。删掉而不是原样搬进来：
   *   一个没人读的分支比没有分支更容易骗过下一个人。
   */
  onIllustrateFrame: (frame: BookStreamFrame) => void
  /**
   * 单页重做那一条流。与上面两个的差别只有一处：失败落到 `note` 而不是 `fatal`
   *   （一页没重做成不等于这一轮结束了）。
   */
  onRerunFrame: (frame: BookStreamFrame) => void
  /** 这一本每一页现在长什么样（工单 08）。两个弹窗的内容都由它来 */
  runPages: RunPageView[]
  loadRunPages: (bookId: string) => Promise<void>
}

export function useRunStream(args: {
  plan?: RunPlan | undefined
  resume?: RunResume | undefined
  /**
   * ①刚跑完、故事取回来了。★ 故事落在调用方那边（它是家长要改的那一份，
   *   与"这一轮跑到哪儿了"不是一件事），所以这里只报一声。
   */
  onStory: (doc: StoryDoc) => void
}): RunStream {
  const { plan, resume } = args
  const [desk, setDesk] = useState<DeskState>(EMPTY_DESK)
  /**
   * 初始那一档故意不叫 `entryPhaseOf`：`status` 要等日志读回来才知道，
   * 在那之前只能说"接着做"（`'replaying'` 是那一屏的中性态）——照"没有日志 =
   * 这一轮没成"渲染，会在读盘那几百毫秒里闪一句错话。
   * 故事在手时例外：闸门那一屏不必等日志（它的正文来自 `story.json`），
   *   所以那一种立刻就能定下来。
   */
  const [phase, setPhase] = useState<Phase>(
    resume ? (resume.story ? 'story' : 'replaying') : 'planning',
  )
  const [bookId, setBookId] = useState<string | null>(resume?.bookId ?? null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /** 服务端还在跑吗（只有重放那条路需要它，`status` 帧说的） */
  const [serverRunning, setServerRunning] = useState(false)
  const [runPages, setRunPages] = useState<RunPageView[]>([])
  /** 正在写出来的那半截（工单 D-04）。它**不落盘**，刷新即失——那是协议的规定 */
  const [writing, setWriting] = useState<PlanWriting | null>(null)
  /** 这一遍尝试攒下来的原始文本。`readPlanProgress` 是纯函数，每段都整段重扫一次 */
  const deltaRef = useRef('')

  /**
   * 事件攒在这里，不进 state（见文件头第 2 条）。
   * 每帧 `deskOf(events)` 是幂等的，所以不需要另存一份增量。
   */
  const eventsRef = useRef<EngineEvent[]>([])
  const startedRef = useRef(false)

  /**
   * 书号的第二个家（见文件头第 3 条），只在"①刚跑完、还没重渲染"这一小段时间里有人读。
   * 写法上与 `eventsRef` 同一条理由：它是"这一轮里当场发生的事"，不是渲染的输入。
   */
  const bookIdRef = useRef<string | null>(resume?.bookId ?? null)

  /**
   * 这一条流有没有**已经说过**具体原因。
   *
   * ★ 2026-10-22（用户踩到的那一次）：服务端在流里发的是
   *   「你写的那句话里有不适合放进孩子的书里的内容：主题：暴力（R-02）——出现了「流血」」，
   *   而流结束时下面那句兜底又拿"没有回书号"盖了一遍——因为那条判断只看书号。
   *   一句兜底盖掉一句具体，是这一屏最坏的一种错法：它把"该改哪个词"换成了"重来一次"。
   *   所以兜底只在**这一轮一句话都没说过**时才说。
   */
  const fatalRef = useRef<string | null>(null)

  /** `onStory` 装进 ref：boot 那个 effect 只许跑一次，而它不该因为父组件换了一个回调就重跑 */
  const onStoryRef = useRef(args.onStory)
  onStoryRef.current = args.onStory

  /**
   * ★ `useMemo` 不是装饰：`sink` 是下面几个回调的依赖，每轮重建一个新对象的话，
   *   `onFrame` / `onIllustrateFrame` / `onRerunFrame` 的身份就每轮都变
   *   ——接在它们后面的每一个 `useCallback` 与 `useEffect` 都会跟着重跑。
   *   三个成员本身是 `useCallback([])`（身份恒定），所以这个对象也就恒定了。
   */
  const replaceAll = useCallback((events: readonly EngineEvent[]) => {
    eventsRef.current = [...events]
    setDesk(deskOf(events))
  }, [])
  const pushOne = useCallback((event: EngineEvent) => {
    /**
     * ★ 这里是**每一条到达的事件**的唯一入口，所以它管的不只是画桌。
     *
     * 规划那一步每试一遍都在开头发一条 `{stage:'planning', phase:'begin'}` 事件
     *   （`plan.ts` 的 `for` 循环第一行）。那意味着**模型从头又写了一遍**：
     *   上一遍的半截必须清掉，否则"已写 6 / 20 页"会在第二遍写到第 3 页时
     *   变成 9 / 20 —— 而屏幕上的页数只许增不许清，那是 `frames.ts` 判据 2
     *   为**画桌**立的规矩；这里恰好相反，它数的是"这一次尝试写出来多少"。
     */
    if (event.kind === 'stage' && event.stage === 'planning' && event.phase === 'begin') {
      deltaRef.current = ''
      setWriting(null)
    }
    eventsRef.current.push(event)
    setDesk(deskOf(eventsRef.current))
  }, [])
  const clearAll = useCallback(() => {
    eventsRef.current = []
    setDesk(EMPTY_DESK)
  }, [])
  const sink: RunSink = useMemo(
    () => ({ replace: replaceAll, push: pushOne, clear: clearAll }),
    [replaceAll, pushOne, clearAll],
  )

  /**
   * 收到一段增量：累起来、读一遍、**只在屏幕上看得见的东西变了时**才换 state。
   *
   * ★ 去重那一条是必须的：增量的粒度是 token，一次规划几百上千段，
   *   每段都 `setState` 就是几百次重渲染 —— 而屏幕上没有一个像素会因此不同
   *   （`readPlanProgress` 只认**已经闭合**的字符串与对象，所以"看得见的"只可能
   *   在标题出来、或某一页的 `}` 落下的那一刻变）。
   *   返回 `current` 时 React 会跳过这一次重渲染，这是它的官方写法。
   */
  const pushDelta = useCallback((text: string) => {
    if (text === '') return
    deltaRef.current += text
    const progress = readPlanProgress(deltaRef.current)
    setWriting((current) => {
      const next = progress
      if (
        current !== null &&
        current.title === next.title &&
        current.pages === next.pages &&
        current.lines.length === next.lines.length &&
        current.lines[current.lines.length - 1] === next.lines[next.lines.length - 1]
      ) {
        return current
      }
      return next
    })
  }, [])

  const loadRunPages = useCallback(async (id: string) => {
    try {
      setRunPages(await listRunPages(id))
    } catch {
      // 读不回来不是错误：画桌照旧能用，只是那两个弹窗点开时会说读不到内容
      setRunPages([])
    }
  }, [])

  /** 认下这一本：ref、state、`sessionStorage` 三处一起（只有书号，见原文件头第 5 条） */
  const rememberBookId = useCallback((id: string) => {
    bookIdRef.current = id
    setBookId(id)
    // 编完故事就记一笔（原来是 `book-ready` 才记）：闸门那一屏可能停很久，
    //   而它刷新之后必须回得来——那时候盘上还没有 `book.json`
    rememberLastRun(id)
  }, [])

  const onIllustrateFrame = useCallback(
    (frame: BookStreamFrame) => {
      if (frame.kind === 'engine') {
        sink.push(frame.event)
        if (frame.event.kind === 'book-ready') setPhase('ready')
        return
      }
      /**
       * ★ 2026-10-22 审查：这里原来把所有非 engine 帧直接丢掉。
       *   服务端在失败时发的就是 `{kind:'fatal', message:"…流血…"}`，丢掉之后
       *   屏幕上只剩兜底那句"这一轮没有跑完（连接断了）"——正是本文件 `fatalRef`
       *   那段注释说的"一句兜底盖掉一句具体"，在「就按这个画」这条路上又犯了一次。
       *   `status` 帧同理：它是"服务端还在不在跑"的唯一来源，丢掉之后
       *   `use-run-poll` 永远不启动，断线就再也自己接不回来。
       */
      if (frame.kind === 'fatal') {
        fatalRef.current = frame.message
        setFatal(frame.message)
        setPhase('failed')
        return
      }
      // `delta` 是打字机增量，不落盘、也不带运行状态；只认 `status`
      if (frame.kind === 'status') setServerRunning(frame.running)
    },
    [sink, setFatal, setPhase, setServerRunning],
  )

  const onRerunFrame = useCallback(
    (frame: BookStreamFrame) => {
      // 单页重做的帧与整本那条是同一套协议（原文件头第 4 条）
      if (frame.kind === 'engine') sink.push(frame.event)
      else if (frame.kind === 'fatal') setNote(frame.message)
    },
    [sink],
  )

  /* 开跑 / 重放 / 摊故事 */

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    // 新的一轮：上一轮说过的话不许压住这一轮的兜底（这个 ref 活在组件实例上）
    fatalRef.current = null

    if (resume) {
      /* ① 只有故事：默认进闸门那一屏（正文来自 `story.json`，不是事件流——
         而日志在这一刻也可能压根不在，进程被杀过、目录被手工清过）。
         但判据不在这里：`entryPhaseOf`（`phase.ts`，纯函数、有测试）说了算，
           它带着"服务器上正在跑就进运行视图"那一条（用户实测报的 bug）。
           这一支的 `desk` 先按故事造一张，等日志回来之后若判成别的屏再换。 */
      if (resume.story) setDesk(storyDeskOf(resume.story))

      void replayFrames(resume.bookId)
        .then(({ events, status }) => {
          /* 只在"这一屏还没往下走"时认这份日志：点「就按这个画」快过这一次读盘的话，
             整份覆盖会把已经到的那几条新帧冲掉（重放回来的那一份里也有它们，
             于是画桌上会出现两条同一个 `seq` 的提醒）。 */
          if (eventsRef.current.length > 0) return
          sink.replace(events)
          setServerRunning(status?.running ?? false)

          const next = entryPhaseOf({ hasStory: resume.story !== undefined, status })
          if (next === 'story') return // 闸门：桌子就是上面那张（书名 + N 页、没有格子）
          // 运行视图 / 成品：桌子交给日志折——哪几页画好了都在里面
          setDesk(deskOf(events))
          setPhase(next)
          if (next === 'ready') void loadRunPages(resume.bookId)
        })
        .catch(() => {
          // 读不回日志：故事在手就不是错误（这一屏照旧能改、能画，走到②时
          //   服务端会自己读日志接 `startSeq`，客户端这一份只是显示用）；
          //   没有故事可依靠才如实说这一轮没了，不摆一个转下去的圈
          if (resume.story !== undefined) return
          setFatal('读不回这一轮的过程日志。回「创作」重新做一本吧。')
          setPhase('failed')
        })
      return
    }

    if (!plan) return
    const body = toBookBody(plan.form, {
      pages: plan.pages,
      form: plan.bookForm,
      ...(plan.voiceId ? { voiceId: plan.voiceId } : {}),
      // 跑出来的是草稿：成品要等「确定生成」那一下（工单 03）
      status: 'draft',
    })
    /* 这一条流只吃事件、不吃 status 帧：它的收尾帧说的是"这一本还没有书"
       （`bookReady: false`），而那正是①的正常终态——闸门就停在这儿。
       照 `onFrame` 那条映射走会把它读成 `'failed'`，屏幕上会闪一下"这一本没做出来"。 */
    void createBook(body, (frame) => {
      if (frame.kind === 'engine') {
        sink.push(frame.event)
        return
      }
      // ★ 令牌级增量（工单 D-04）：`plan-ready` 之前屏幕上唯一会动的东西
      if (frame.kind === 'delta') {
        pushDelta(frame.text)
        return
      }
      if (frame.kind === 'fatal') {
        fatalRef.current = frame.message
        setFatal(frame.message)
        setPhase('failed')
      }
      // `status` 帧上的书号：①没有 `book-ready` 事件（书还没画完），
      //   而客户端从这一刻起就要知道书号——它要去取故事、要往 sessionStorage 记一笔
      if (frame.kind === 'status' && frame.bookId) rememberBookId(frame.bookId)
    })
      .then(async () => {
        /* 流结束 = ①做完了。故事已经落盘（服务端先写盘再发收尾帧），现在去取它。
           书号从收尾帧上来（见上面那一条），拿不到就当这一轮没成——
             没有书号就取不了故事，而"编完了但屏幕上什么都没有"比一句错话糟。 */
        const id = bookIdRef.current
        if (!id) {
          // 这一轮已经说过具体原因（比如那句话越线了）就留着它：书号缺席只是它的后果
          if (fatalRef.current === null) {
            setFatal('编故事这一步没有回书号，这一本没做出来。回「创作」重来一次吧。')
          }
          setPhase('failed')
          return
        }
        const doc = await fetchStory(id)
        onStoryRef.current(doc)
        setDesk(storyDeskOf(doc))
        setPhase('story')
      })
      .catch((err: unknown) => {
        // 同一条：已经有一句具体原因时，别让"读流失败"这种次生错误把它顶掉
        if (fatalRef.current === null) {
          setFatal(err instanceof Error ? err.message : String(err))
        }
        setPhase('failed')
      })
  }, [plan, resume, sink, loadRunPages, rememberBookId, pushDelta])

  return {
    desk,
    setDesk,
    phase,
    setPhase,
    fatal,
    setFatal,
    note,
    setNote,
    serverRunning,
    setServerRunning,
    bookId,
    sink,
    pushDelta,
    writing,
    onIllustrateFrame,
    onRerunFrame,
    runPages,
    loadRunPages,
  }
}
