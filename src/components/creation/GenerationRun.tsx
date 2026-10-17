'use client'

/**
 * GenerationRun —— 运行视图：一句话进去，一页一页出来（工单 05）
 *
 * ```
 *   ①编故事 —— ②逐页画 —— ③配音 —— ④装订        ← 阶段轨（从事件推，4 格）
 *   《书名》                        k / N 页画好了
 *
 *   ┌─ 闸门（2026-10-17 起）：故事先摊出来给家长过一遍 ──────────────┐
 *   │  《书名》[可改]      想让故事怎么变？[ ] [让 AI 重写一版]      │
 *   │  第 1 页  正文[ ]  画面[ ]  情节[ ]                          │
 *   └───────────────────────────────────────────────────────────────┘
 *        ↓ 点「就按这个画」之后才换成画桌
 *   ┌──┐┌──┐┌──┐┌──┐
 *   │🖼││🖼││▨ ││▨ │                              ← 画桌（Desk.tsx）
 *   └──┘└──┘└──┘└──┘
 *   ┌──────────────────────────────────┐
 *   │ 朵朵抱着月亮…（只读）   [确定生成] │          ← 底部那条
 *   └──────────────────────────────────┘
 * ```
 *
 * 六条判断，每条都有一个具体的坏法：
 *
 * 1. **阶段轨是 4 格，不是原型里那 5 个节点**。引擎的核对是每页画完**立刻**比的，
 *    做成节点会 20 页闪 40 次——而那个闪烁只说明我们在数事件。核对是**某一页的事**，
 *    它留在那一格的 `note` 上。推导在 `frames.ts` 的 `railOf`，**不在这个组件里**：
 *    那是会错的那一半，它必须能在 node 里被钉住（`frames.test.ts` 钉着它）。
 * 2. ★★ **2026-10-17 改了**：故事正文现在**可以改**，而且改的位置是有讲究的——
 *    在**闸门那一屏**（`StorySheet`）改，改完点「就按这个画」，②才开跑。
 *    这一屏之前写的是"故事正文永远只读，它进了书号指纹，改了就**是另一本书**"。
 *    那句话**说错了一半**：`bookIdOf` 拼的是 `card|revision|form|theme`，
 *    **正文从来不在里面**（改了正文，书号不变——这正是这道闸门能成立的前提）。
 *    真正成立的那一半是：**主题**在指纹里，所以"改一个字的主题 = 另一本书"。
 *    ★ 而"运行期间不许改"这一条**没有变**：②开跑之后（`illustrating` 起），
 *      故事仍然是只读的——那时候每一页都在花钱，一个能改的入口会让人以为
 *      "改了就不用重跑"。所以闸门是**一道门**，不是一个随时能开的抽屉。
 * 3. **单页重做只在整本做完之后解锁**。用户的原话是"在此期间用户不能修改"——
 *    而这期间**正是**在花钱，一个能改的入口会让人以为改了就不用重跑。
 * 4. **每一帧重新派一次整张画桌**（`deskOf(events)`）。看着像浪费，但它是**幂等**的：
 *    只扫一遍事件、同一页覆盖同一格，所以第 k 帧的结果只取决于前 k 条事件。
 *    增量维护省下的是几十次循环，换来的是"同一页重画算一格还是两格"这种判断
 *    散进 setState 里——而那正是 `frames.test.ts` 现在钉住的东西。
 * 5. **刷新之后要能接着看**。这一轮的指针存进 `sessionStorage`（**只有书号**，
 *    任何凭据都不进那里），刷新后回来重放。★ 但它不再是**唯一**一条路：
 *    草稿在书架上有位置（工单 03），那才是被放弃之后还找得回来的那一条。
 *    ★ 2026-10-17：记这一笔的时机**提前到编完故事那一刻**（原来是 `book-ready`）——
 *      闸门那一屏可能停很久，而它刷新之后必须回得来。
 *    ★ 而"停在闸门上"这一支**也要读一遍日志**：闸门那一屏的正文确实来自 `story.json`，
 *      但阶段轨前两格读的是 `desk`（书名与格数都由①的 `plan-ready` 说了算，而那条事件
 *      **只在日志里**）。不读的话，点「就按这个画」之后第一帧一到，桌子就被折成
 *      "编故事 还没轮到 ｜ 逐页画 0 / 1"——这是实测抓出来的（根因写在那一支的注释里）。
 *    ★ 同理，**书名以 `story` 为准**（`withStoryTitle`）：家长在闸门上改了书名，
 *      而②的事件里没有新书名，所以折出来的桌子会一直顶着①那一版旧的。
 * 6. **改了的故事自动存**（`AUTOSAVE_MS`）。不存的话，家长改到第 5 页时刷一下，
 *    前四页的改动就没了——而"关掉标签页也找得回来"正是这一轮对用户的承诺
 *    （书架那一栏也是为它做的）。存盘走 `PUT /story`，判据与「就按这个画」
 *    那一关共用 `lib/story-problems.ts`，所以不存在"存上了但画不了"这种含糊。
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BookStreamFrame } from '@/lib/book-stream.ts'
import type { BookForm } from '@/lib/engine/domain.ts'
import type { EngineEvent } from '@/lib/engine/events.ts'
import type { StoryDoc } from '@/lib/schemas/story.ts'
import { storyProblemsOf, storyProblemText } from '@/lib/story-problems.ts'
import {
  createBook,
  fetchStory,
  illustrateBook,
  listRunPages,
  publishBook,
  replayFrames,
  rerunPage,
  rewriteStory,
  saveStory,
} from '@/lib/creation/api.ts'
import { rememberLastRun } from '@/lib/creation/last-run.ts'
import { toBookBody, type RunForm } from '@/lib/creation/state.ts'
import type { RunPageView } from '@/lib/run-pages.ts'

import Desk from './Desk.tsx'
import RedrawDialog from './RedrawDialog.tsx'
import RevoiceDialog from './RevoiceDialog.tsx'
import StorySheet from './StorySheet.tsx'
import {
  deskOf,
  EMPTY_DESK,
  railOf,
  storyDeskOf,
  withStoryTitle,
  type DeskState,
} from './frames.ts'

/**
 * 自动保存的静默期（毫秒）。★ 这个数只有一个读者：家长停手多久之后算"改完了一句"。
 * 太短（<500ms）会边打字边发请求；太长（>3s）会让"关掉标签页"这件事重新变得危险。
 * 1.2 秒是"读完自己写的这一句"的量级。
 */
const AUTOSAVE_MS = 1200

/**
 * 这一次生成的输入。★ 只有这几样——`wish` / `theme` 都在 `form.theme` 里，
 * 另立两个字段就是同一个值有两个家（`/home` 那颗药丸与设置的关系已经踩过这条）。
 */
export type RunPlan = {
  /** 这一轮的"他是谁 + 用哪张卡 + 讲什么"，由服务端按 URL 解出来 */
  form: RunForm
  /**
   * 形态（GLOSSARY「形态」）。★ 由调用方给，**不在这里写死 `'solo'`**——
   * 闸门那一屏的校验要拿它跑 `buildTree`，而"独读版不许有选择点"这条判据
   * 在共读版上是反的。写死的话症状是"共读版的每页都报'独读版不许有选择点'"。
   */
  bookForm: BookForm
  pages: number
  /** 这一本用哪个音色朗读。**undefined = 这一本不配音** */
  voiceId?: string
}

export type GenerationRunProps = {
  /** 新做一本：进来就开始跑（只跑①编故事，见 `createBook`） */
  plan?: RunPlan
  /** 接着做一份已经在盘上的：进哪一条路由 `story` 决定 */
  resume?: {
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
     * 盘上那一份**故事草稿**（`books/<id>/story.json`）。
     *
     * ★ 有它 = 这一本**故事写好了、还没开始画**：直接进闸门那一屏，
     *   **不重放事件日志**（这一屏的事实来源是 `story.json`，不是日志）。
     *   没有它 = 画好的那一本，照旧重放（工单 02 那条路）。
     */
    story?: StoryDoc
  }
}

/**
 * 这一屏现在处在哪一段。
 *
 * ★ `'story'` 是 2026-10-17 加的（故事闸门）：编完故事到点「就按这个画」之间。
 *   它与 `'replaying'` 是两个不同的东西：后者是"画过，但这次没连着看"。
 */
type Phase = 'planning' | 'story' | 'running' | 'ready' | 'failed' | 'replaying'

/** 自动保存那行小字的状态机。★ `'failed'` 是**必须存在**的一档：存不上要说得出来 */
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export default function GenerationRun({ plan, resume }: GenerationRunProps) {
  const [desk, setDesk] = useState<DeskState>(EMPTY_DESK)
  const [phase, setPhase] = useState<Phase>(
    resume ? (resume.story ? 'story' : 'replaying') : 'planning',
  )
  const [bookId, setBookId] = useState<string | null>(resume?.bookId ?? null)
  const [published, setPublished] = useState(resume?.published ?? false)
  const [fatal, setFatal] = useState<string | null>(null)
  const [busy, setBusy] = useState<{ pageNo: number; kind: 'image' | 'audio' } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /**
   * 闸门那一屏上**家长正在改的那一份故事**。`null` = 还没有故事（`planning` 阶段）
   * 或者这一本已经画完了（那时候故事在 `book.json` 里，这一屏不再碰它）。
   *
   * ★ 它是**这一屏里唯一的真相**（不是"服务端那份的副本"）：点「就按这个画」时
   *   发出去的就是它，请求体里带着，所以"屏幕上看到的"与"真拿去画的"永远是同一份。
   */
  const [story, setStory] = useState<StoryDoc | null>(resume?.story ?? null)
  /** 家长手改过没有。★ 它决定重写那颗按钮旁边说不说"会盖掉你手改的地方" */
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  /** 正在重写一版 / 正在逐页画。★ 与 `busy` 分开：那个是**单页**重做，粒度不一样 */
  const [working, setWorking] = useState<'rewriting' | 'illustrating' | null>(null)
  /** 配音开没开。★ 它**不是**从 `narrations` 推的——为空有两种成因（不做 / 没做成），
   *  混淆它们会把一次失败说成一个选择（见 `Book.voiceId`）。
   *  ★ 它是一条**推导**，不是 state：这一屏中途不会换音色（换要回 `/home` 重做一本），
   *    给它一个 setter 就是给一个不存在的变化留一个门 */
  const voiceOn = resume ? resume.voiceOn : plan?.voiceId !== undefined
  /** 服务端还在跑吗（只有重放那条路需要它，`status` 帧说的） */
  const [serverRunning, setServerRunning] = useState(false)
  /**
   * 这一本每一页现在长什么样（工单 08）。两个弹窗的内容都由它来。
   * ★ 它是**一次性取回、用完再取**的：整本跑完之后取一次；重做一页之后再取一次
   *   （正文/提示词/录音都可能变了）。跟着事件流一页一页更新是不必要的——
   *   画桌上那些格子的状态来自事件，而这两个弹窗只在用户点下去的那一刻才需要数据。
   */
  const [runPages, setRunPages] = useState<RunPageView[]>([])
  /** 现在开着的是哪个弹窗。`null` = 都关着 */
  const [editor, setEditor] = useState<{ kind: 'image' | 'audio'; pageNo: number } | null>(null)

  const voiceId = resume?.voiceId ?? plan?.voiceId
  /** 形态：新做一本由调用方给，接着做从盘上那一份读 */
  const bookForm: BookForm = resume?.bookForm ?? plan?.bookForm ?? 'solo'

  const loadRunPages = useCallback(async (id: string) => {
    try {
      setRunPages(await listRunPages(id))
    } catch {
      // 读不回来不是错误：画桌照旧能用，只是那两个弹窗点开时会说读不到内容
      setRunPages([])
    }
  }, [])

  /**
   * 事件攒在这里，**不进 state**：state 里只有从它派生的那张画桌。
   * 每帧 `deskOf(events)` 是幂等的（文件头第 4 条），所以不需要另存一份增量。
   */
  const eventsRef = useRef<EngineEvent[]>([])
  const startedRef = useRef(false)

  /**
   * 书号的**第二个家**，只在"①刚跑完、还没重渲染"这一小段时间里有人读。
   * ★ 为什么不直接读 `bookId` 这个 state：`setBookId(...)` 与紧接着读它的那段代码
   *   在**同一轮渲染**里（都属于那个帧回调后面的 promise 链），state 要到下一轮才更新
   *   ——症状是"编完故事却说没有书号"。写法上与 `eventsRef` 是同一条理由：
   *   事件也在 ref 里，因为它们是"这一轮里当场发生的事"，不是渲染的输入。
   */
  const bookIdRef = useRef<string | null>(resume?.bookId ?? null)

  /** 认下这一本：ref、state、`sessionStorage` 三处一起（只有书号，见文件头第 5 条） */
  const rememberBookId = useCallback((id: string) => {
    bookIdRef.current = id
    setBookId(id)
    // ★ 编完故事就记一笔（原来是 `book-ready` 才记）：闸门那一屏可能停很久，
    //   而它刷新之后必须回得来——那时候盘上还**没有** `book.json`
    rememberLastRun(id)
  }, [])

  /**
   * 闸门那一屏的问题（书名 / 每页三个框）。
   * ★ 判据**不是这里算的**：`lib/story-problems.ts` 与「就按这个画」那一关
   *   用的是同一个函数（那边在 `illustrate/route.ts` 里再跑一遍）。
   *   所以按钮亮不亮与服务端收不收永远是一致的——这正是把它做成纯函数的目的。
   */
  const problems = useMemo(() => (story ? storyProblemsOf(bookForm, story) : []), [story, bookForm])

  /** 一条帧进来：攒事件、重算画桌、按帧的种类改状态。实时与重放**共用这一个** */
  const onFrame = useCallback((frame: BookStreamFrame) => {
    if (frame.kind === 'engine') {
      eventsRef.current.push(frame.event)
      setDesk(deskOf(eventsRef.current))
    } else if (frame.kind === 'fatal') {
      setFatal(frame.message)
      setPhase('failed')
    } else if (frame.kind === 'status') {
      setServerRunning(frame.running)
      setPhase(frame.bookReady ? 'ready' : frame.running ? 'replaying' : 'failed')
    }
  }, [])

  /**
   * 「就按这个画」那一条流**只吃事件**，不吃 `status` 帧。
   *
   * ★ 为什么不能与上面那个共用（`onFrame`）：②这一条路的收尾帧是
   *   `{running: false, bookReady: false}`——那是它的**正常终态**（书才刚刚开始画），
   *   而 `onFrame` 会把 `bookReady: false + running: false` 读成 `'failed'`。
   *   用一个"看情况"的分支去区分它们，不如让这一条路自己说下一步是什么：
   *   流回来之后由 `illustrate()` 决定（出图的事件到了就是 `'running'`，
   *   拿到 `book-ready` 事件就是 `'ready'`）。
   */
  const onIllustrateFrame = useCallback((frame: BookStreamFrame) => {
    if (frame.kind !== 'engine') return
    eventsRef.current.push(frame.event)
    setDesk(deskOf(eventsRef.current))
    if (frame.event.kind === 'book-ready') setPhase('ready')
  }, [])

  /* ── 开跑 / 重放 / 摊故事 ─────────────────────────────────────────────── */

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    if (resume) {
      /* ① 只有故事：直接进闸门那一屏。这一屏的**正文**来自 `story.json`
         （它可以被家长改过），不是事件流——而日志在这一刻也可能压根不在
         （进程被杀过、目录被手工清过）。所以 `desk` 由 `storyDeskOf` 造。 */
      if (resume.story) {
        setDesk(storyDeskOf(resume.story))
        /* ★ 日志仍然**尽力读一遍**，但只用来备好"接下来那一段"（2026-10-17 补）。
           原来这一支直接 `return`，于是 `eventsRef` 从空的开始——点「就按这个画」
           之后第一帧一到（`stage(begin, illustrating)`，带 `pageNo: 1`），
           `deskOf` 手上只有这一条事件，`total` 就按 `pageNo` 兜到 1、`title` 是 null：
           屏幕上变成「编故事 **还没轮到** ｜ 逐页画 0 / 1」，大标题退回"开始创作中"，
           而家长明明刚改完那一版故事。**根因是①的 `plan-ready` 只在日志里**
           （它带着书名与格数，而那两样是阶段轨前两格的判据）。
           ★ 只填 `eventsRef`、**不动 `desk`**：闸门那一屏的桌子就该是"书名 + N 页、
             还没有格子"那一张（`storyDeskOf` 的理由），日志过一会儿才到，
             期间桌子若换来换去，家长会看见书名跳一下。
           ★ 顺手把 `status` 那一刻的服务端状态也认下来（同一份响应里，不要白不要）：
             它说的是"这一本此刻在不在跑"——上一次点了画、进程半路被杀的话就是它。 */
        void replayFrames(resume.bookId)
          .then(({ events, status }) => {
            /* ★ 只在"这一屏还没往下走"时认这份日志：点「就按这个画」快过这一次读盘的话，
               整份覆盖会把已经到的那几条新帧冲掉（重放回来的那一份里也有它们，
               于是画桌上会出现两条同一个 `seq` 的提醒）。 */
            if (eventsRef.current.length > 0) return
            eventsRef.current = events
            setServerRunning(status?.running ?? false)
          })
          // 读不回日志**不是**错误：故事在手，这一屏照旧能改、能画。
          // （走到②时服务端会自己读日志接 `startSeq`，客户端这一份只是显示用）
          .catch(() => undefined)
        return
      }

      void replayFrames(resume.bookId)
        .then(({ events, status }) => {
          eventsRef.current = events
          setDesk(deskOf(events))
          setServerRunning(status?.running ?? false)
          setPhase(status?.bookReady ? 'ready' : status?.running ? 'replaying' : 'failed')
          // 每页的内容（正文 / 提示词 / 录音）另取一次（工单 08）
          if (status?.bookReady) void loadRunPages(resume.bookId)
        })
        .catch(() => {
          // 读不回日志不是错误：如实说这一轮没了，不摆一个转下去的圈
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
      // ★ 跑出来的是**草稿**：成品要等「确定生成」那一下（工单 03）
      status: 'draft',
    })
    /* ★ 这一条流**只吃事件、不吃 status 帧**：它的收尾帧说的是"这一本还没有书"
       （`bookReady: false`），而那正是①的**正常终态**——闸门就停在这儿。
       照 `onFrame` 那条映射走会把它读成 `'failed'`，屏幕上会闪一下"这一本没做出来"。 */
    void createBook(body, (frame) => {
      if (frame.kind === 'engine') {
        eventsRef.current.push(frame.event)
        setDesk(deskOf(eventsRef.current))
        return
      }
      if (frame.kind === 'fatal') {
        setFatal(frame.message)
        setPhase('failed')
      }
      // ★ `status` 帧上的书号：①没有 `book-ready` 事件（书还没画完），
      //   而客户端从这一刻起就要知道书号——它要去取故事、要往 sessionStorage 记一笔
      if (frame.kind === 'status' && frame.bookId) rememberBookId(frame.bookId)
    })
      .then(async () => {
        /* 流结束 = ①做完了。故事已经落盘（服务端先写盘再发收尾帧），现在去取它。
           ★ 书号从收尾帧上来（见上面那一条），拿不到就当这一轮没成——
             没有书号就取不了故事，而"编完了但屏幕上什么都没有"比一句错话糟。 */
        const id = bookIdRef.current
        if (!id) {
          setFatal('编故事这一步没有回书号，这一本没做出来。回「创作」重来一次吧。')
          setPhase('failed')
          return
        }
        const doc = await fetchStory(id)
        setStory(doc)
        setDesk(storyDeskOf(doc))
        setPhase('story')
      })
      .catch((err: unknown) => {
        setFatal(err instanceof Error ? err.message : String(err))
        setPhase('failed')
      })
  }, [plan, resume, onFrame, loadRunPages, rememberBookId])

  /* ── 自动保存（文件头第 6 条） ───────────────────────────────────────── */

  /**
   * 手改之后静默 `AUTOSAVE_MS` 存一次。
   *
   * ★ 依赖数组里的 `working` 不是多余的：重写一版会**换掉**盘上那一份故事，
   *   而一个排着队的自动保存会在它之后落地，把家长改的旧文字盖回新故事上。
   *   把 `working` 放进依赖，重写一开始这个 effect 就重跑、cleanup 把计时器清掉。
   */
  useEffect(() => {
    if (phase !== 'story' || !dirty || !story || !bookId || working !== null) return
    setSaveState('saving')
    const timer = setTimeout(() => {
      void saveStory(bookId, story)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('failed'))
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [story, dirty, phase, bookId, working])

  /* ── 单页重做 ────────────────────────────────────────────────────────── */

  const rerun = useCallback(
    async (
      pageNo: number,
      kind: 'image' | 'audio',
      /** 重画那一句补充；重配那份改过的正文。两者只有一个会有值（见 `RerunOptions`） */
      extra: { fixNote?: string; body?: string[] } = {},
    ) => {
      if (!bookId || busy) return
      setBusy({ pageNo, kind })
      setNote(null)
      setEditor(null)
      try {
        await rerunPage(
          bookId,
          pageNo,
          {
            kind,
            ...(voiceId ? { voiceId } : {}),
            ...(extra.fixNote ? { fixNote: extra.fixNote } : {}),
            ...(extra.body ? { body: extra.body } : {}),
          },
          (frame) => {
            // ★ 同一个处理器：单页重做的帧与整本那条**是同一套协议**（文件头第 4 条）
            if (frame.kind === 'engine') {
              eventsRef.current.push(frame.event)
              setDesk(deskOf(eventsRef.current))
            } else if (frame.kind === 'fatal') {
              setNote(frame.message)
            }
          },
        )
        // 重做之后每页的内容可能变了（改过正文的话，书里那一页的字也变了），再取一次
        await loadRunPages(bookId)
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [bookId, busy, voiceId, loadRunPages],
  )

  /** 画桌上点「重画 / 重配」：**先开弹窗，不直接发请求**（工单 08）。
   *  ★ 这一下改动的是"花钱"这件事的入口：原来点一下就开始重画，现在点一下先看清楚
   *    上一版与原来那段提示词。用户要的正是这个中间那一步 */
  const openEditor = useCallback(
    (pageNo: number, kind: 'image' | 'audio') => {
      if (runPages.some((page) => page.pageNo === pageNo)) {
        setEditor({ kind, pageNo })
        return
      }
      // 还没取回这一页的内容（多半是刚跑完、请求还在路上）：直接说不出来由，别开一个空弹窗
      setNote('这一页的内容还没读到，等两秒再点一次。')
    },
    [runPages],
  )

  const editingPage = editor
    ? (runPages.find((page) => page.pageNo === editor.pageNo) ?? null)
    : null

  /* ── 闸门那一屏的两个动作 ────────────────────────────────────────────── */

  /**
   * 「让 AI 重写一版」。
   *
   * ★ 出发前**先把自动保存停掉**（依赖里的 `working`，见那个 effect）：
   *   否则排队中的那一笔会在重写写盘**之后**落地，把家长改的旧文字盖回新故事上。
   * ★ 回来之后重新取一次 `story.json`（而不是"把流里的事件拼一份出来"）：
   *   盘上那一份是服务端写的，与拿去画的那一份**必然**是同一个——
   *   在客户端再拼一次就是同一个值有第二个来源。
   */
  const rewrite = useCallback(
    async (rewriteNote: string) => {
      if (!bookId || working) return
      setWorking('rewriting')
      setNote(null)
      // 整篇都会被换掉，所以那一份"改过没改过"的记录跟着归零
      setDirty(false)
      try {
        await rewriteStory(bookId, rewriteNote, (frame) => {
          if (frame.kind === 'engine') {
            eventsRef.current.push(frame.event)
            setDesk(deskOf(eventsRef.current))
          } else if (frame.kind === 'fatal') {
            setNote(frame.message)
          }
        })
        const doc = await fetchStory(bookId)
        setStory(doc)
        setDesk(storyDeskOf(doc))
        setSaveState('saved')
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err))
      } finally {
        setWorking(null)
      }
    },
    [bookId, working],
  )

  /**
   * 「就按这个画」：把**家长刚改完的那一份**发出去，②开始跑。
   *
   * ★ 请求体里带的是 `story`（屏幕上这一份），不是"服务端自己去读盘"——
   *   自动保存可能差最后一拍，而"画出来的"必须就是"看着的那一份"。
   *   服务端仍然会在画之前再校验一次（同一个 `storyProblemsOf`），
   *   并把它写回盘上，所以两边不会各留一份。
   */
  const illustrate = useCallback(async () => {
    if (!bookId || !story || working) return
    setWorking('illustrating')
    setNote(null)
    setFatal(null)
    // ★ 下一条帧一到就是"在画了"：这一屏从闸门翻到画桌
    setPhase('running')
    try {
      await illustrateBook(bookId, story, onIllustrateFrame)
      // 流正常结束但没等到 `book-ready`（比如中途断线）：如实说，别停在"正在画"
      setPhase((current) => (current === 'ready' ? current : 'replaying'))
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
      // ★ 失败退回闸门那一屏（故事还在，改一改就能再点一次）：
      //   停在"正在画"会让人以为还在跑，而那时候服务端早就结束了
      setPhase('story')
    } finally {
      setWorking(null)
    }
  }, [bookId, story, working, onIllustrateFrame])

  /* ── 「确定生成」────────────────────────────────────────────────────── */

  const confirm = useCallback(async () => {
    if (!bookId || busy) return
    setNote(null)
    try {
      await publishBook(bookId)
      setPublished(true)
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    }
  }, [bookId, busy])

  /**
   * 屏幕上那一张桌子。与 `desk` 只差一件事：**书名以 `story` 为准**（见
   * `frames.ts` 的 `withStoryTitle`）。
   *
   * ★ 家长在闸门那一屏改了书名、点「就按这个画」之后，②每回一帧都把 `desk` 折回
   *   ①那一版书名（事件里没有新书名）。上面那个大标题与阶段轨都读它，
   *   所以这两个地方必须一起看这一份，不能一个读 `desk` 一个读 `shownDesk`。
   * ★ `story` 为 null 时它是 `desk` 本人（同一个对象），已经画完的那一本从书架
   *   进来走的正是这一条——那一刻日志就是唯一事实。
   */
  const shownDesk = useMemo(() => withStoryTitle(desk, story), [desk, story])
  const rail = railOf(shownDesk, voiceOn)
  /**
   * 服务端这一轮**还在跑**。★ 它是 `Desk` 那条进度条上要不要扫过一道光的唯一依据，
   * 而这件事只有**拿着连接的这一方**知道：画桌上的事件只说明"走到哪儿了"，
   * 一轮跑完与一轮卡住，在事件流里长得一模一样。
   *
   * ★ 判据是 `serverRunning`（`/api/books/<id>/events` 的 `status` 帧说的"这个书号
   *   此刻在不在跑"），**不是 `phase === 'replaying'`**。这一条是探针抓出来的：
   *   拿 phase 当判据时，**重跑一本已经存在的书**（同一个书号、清单还在盘上）会让
   *   `bookReady` 为真 → phase 判成 `'ready'` → 光不扫。而那一刻屏幕上明明有一格在画、
   *   进度条也在长——"清单在盘上"与"这一轮跑完了"是两件事，phase 把它们合成了一件。
   * ★ `phase === 'running'` 那一半仍然要留着：那一轮是我们自己发起的，还没有 status 帧。
   */
  const live = phase === 'running' || serverRunning
  const ready = phase === 'ready'
  /** 闸门那一屏开着吗。★ 到时候画桌**不渲染**：那一屏的正文是 `StorySheet` */
  const atGate = phase === 'story' && story !== null
  /** 闸门那一屏整屏只读（重写中 / 出图中） */
  const gateBusy = working !== null
  /** 「就按这个画」亮不亮。★ 判据来自 `problems`（与服务端那一关同一个函数） */
  const canDraw = atGate && !gateBusy && problems.length === 0

  return (
    <section className="gr">
      {/* ── 阶段轨 ─────────────────────────────────────────────────────── */}
      <ol className="gr__rail" aria-label="创作进度">
        {rail.map((node) => (
          <li key={node.key} className="gr__node" data-state={node.state}>
            <span className="gr__dot" aria-hidden="true">
              {node.state === 'done' ? '✓' : ''}
            </span>
            <span className="gr__name">{node.label}</span>
            {/* ★ `k / N` 是真数（`drawnCount` / `desk.total`），不是另编的百分比条 */}
            {node.note && <span className="gr__note">{node.note}</span>}
            {/* 读屏要能听见每一格是什么状态——颜色与圆点它看不见 */}
            <span className="gr__sr">{RAIL_SR[node.state]}</span>
          </li>
        ))}
      </ol>

      <h1 className="gr__title">
        {shownDesk.title
          ? `《${shownDesk.title}》`
          : phase === 'failed'
            ? '这一本没做出来'
            : '开始创作中'}
      </h1>
      <p className="gr__sub" role="status">
        {/* ★ 2026-10-16 用户划掉了原来那句「这期间先不用管它，**也别关这个页面**」，
            要求写成："如果不想等待，可以等生成好之后在书架里找到并编辑。"
            ★ 那句话不只是口气不好，它**在拦一件不必拦的事**：这一轮跑在服务端
              （`/api/books` 文件头第 2 条：浏览器关了照旧落盘），关掉页面既不会中断它，
              也不会丢掉已经画好的那些页。所以现在说的是**这一本怎么找回来**，
              而"没做完的书在书架那一栏里"正是上一单（工单 10）刚做出来的东西。
            ★ 「这一轮不会停」五个字留着不删：不说的话，"可以先离开"读起来像"放弃它"。 */}
        {phase === 'planning' && '正在编故事。编好之后会停下来让你先看一眼，你说画才开始画。'}
        {/* ★ 闸门那一屏的主句（2026-10-17）：说清**为什么停在这儿**——钱还没花 */}
        {atGate &&
          '故事写好了，先看一遍——不满意的地方直接改，改完点「就按这个画」才出图。图是按你改好的这一版画的。'}
        {phase === 'story' && !atGate && '正在重写这一版故事…'}
        {phase === 'running' &&
          '正在一页一页做。不想等的话可以先离开，这一轮不会停——做完之后在书架的「正在编辑」里找它，在那里接着编辑。'}
        {phase === 'replaying' &&
          (serverRunning
            ? '刷新把这条连接断了，但服务器上这一轮还在跑。它跑完之后刷新这一页就能看到。'
            : '这一轮没有跑完（刷新把连接断了）。下面是你已经做出来的部分。')}
        {phase === 'ready' &&
          (published
            ? '这本已经装订好了。'
            : '每一页都做完了。不满意哪一页就在那一页重做；都没问题再点「确定生成」。')}
        {phase === 'failed' && '下面这句话说了为什么。'}
      </p>

      {(fatal ?? shownDesk.fatal) && (
        <p className="gr__error" role="alert">
          {fatal ?? shownDesk.fatal}
        </p>
      )}
      {note && (
        <p className="gr__error" role="alert">
          {note}
        </p>
      )}

      {/* ── 闸门那一屏：故事摊开给家长改（工单 12） ───────────────────────── */}
      {atGate && story && (
        <StorySheet
          story={story}
          problems={problems}
          busy={gateBusy}
          dirty={dirty}
          onChange={(next) => {
            setStory(next)
            setDirty(true)
            // 之后的存盘由那个自动保存的 effect 排（它看 `dirty` 与 `story`）
            setSaveState('idle')
            // 书名改了，上面那个大标题与阶段轨要跟着走（那是同一份数据的两种显示）
            setDesk(storyDeskOf(next))
          }}
          onRewrite={(rewriteNote) => void rewrite(rewriteNote)}
        />
      )}

      {/* ── 画桌：出了闸门才出现 ─────────────────────────────────────────── */}
      {!atGate && (
        <Desk
          desk={shownDesk}
          published={published}
          live={live}
          {...(bookId
            ? {
                actions: {
                  ready: ready && !busy,
                  voiceOn,
                  busy,
                  // ★ 点下去**先开弹窗**（工单 08），不直接发请求——见 `openEditor`
                  onRerun: openEditor,
                },
              }
            : {})}
        />
      )}

      {/* ── 底部那条：这一轮那句话（只读）+ 按状态变的那一颗 ─────────────── */}
      <footer className="gr__composer">
        <div className="gr__composer-inner">
          {/* ★ **始终只读**，而且这里没有"改一句"的入口：那句话进了书号指纹
              （`bookIdOf` 用的是 card + form + theme），改了就是另一本书。
              要改走右边那条出口，它明说"这会丢掉这一本"。
              ★ 接着做一份草稿时（`plan` 没有）这一格**不编一句话出来**：
              那句话**没有存在书里**（`Book` 上没有 theme / wish 两个字段），
              所以这里写的是"这一本现在处于什么状态"，那是真的
              ★ 2026-10-17（闸门）：故事**能改**了，但改的是 **①的产出**，不是这一格。
                这一格仍然是"家长当初写的那一句话"——改它确实是另一本书
                （主题在书号指纹里）。闸门那一屏把它留在屏幕上，正是为了让家长
                改故事时**回看得见**自己原来要的是什么。 */}
          <p className="gr__story">
            {plan
              ? plan.form.theme.wish.trim() || plan.form.theme.theme.trim()
              : atGate
                ? '这一段故事还没开始画。改完点「就按这个画」——图按你改好的这一版画。'
                : published
                  ? '这本已经装订好了，在书架上放着。'
                  : '这一本还没装订。不满意哪一页就在那一页重做，都没问题再点确定。'}
            {/* 自动保存那行小字（文件头第 6 条）。★ 只在闸门那一屏说，且只在有话说时说 */}
            {atGate && saveState !== 'idle' && (
              <span className="gr__save" data-state={saveState}>
                {saveState === 'saving' && '正在存…'}
                {saveState === 'saved' && '改的已经存上了'}
                {saveState === 'failed' && '没存上——检查一下网络，改动还在这一屏里'}
              </span>
            )}
          </p>
          <div className="gr__composer-acts">
            {/* ★ 2026-10-16 用户："这改为退出……点退出之后这一本放到书架上，状态设为正在编辑，
                然后用户可以选择是删除还是制作为绘本"。
                ★ 它原来写的是「改故事，重做一本」并指向 `/home`——**那句话本身在骗人**：
                  这一本已经写进盘上了（草稿态），点它并不会"丢掉"什么，只是先前的说法
                  让人以为要重新开始。现在这一颗说的是它真正做的事：**离开这一屏**。
                ★ 去 `/shelf` 而不是 `/home`：用户接下来要处理的是**这一本**，
                  而它在书架那一栏里（`/home` 是"另起一本"的地方，那是第二件事）。
                ★ `title` 分两句，因为这两件事真的不同：还在跑的时候这一本**还没有**落到书架上
                  （清单是在收尾那一刻写的），跑完了才出现——说成一句就是假的。】 */}
            <Link
              className="gr__exit"
              href="/shelf"
              title={
                phase === 'running'
                  ? '离开这一屏。服务器上会把这一本做完，做完就出现在书架的「正在编辑」里'
                  : atGate
                    ? '离开这一屏。这一段故事在书架的「正在编辑」里（还没开始画），点回去接着改'
                    : '这一本在书架的「正在编辑」里，那里可以制作为绘本，也可以删掉'
              }
            >
              退出
            </Link>
            {/* ★ 闸门那一屏上这一颗是**另一个动作**（就按这个画），所以它不是
                「确定生成」的禁用态：那两件事之间隔着"要不要花这笔钱"。
                ★ 按不动时把原因写在 `title` 上：屏幕上那句"还有 N 处要改一改"
                  说的是同一件事，两处都不是哑的 */}
            {atGate ? (
              <button
                type="button"
                className="gr__primary"
                data-tone="go"
                disabled={!canDraw}
                title={storyProblemText(problems) ?? '按这一版故事开始画'}
                onClick={() => void illustrate()}
              >
                {working === 'illustrating' ? '开始画了…' : '就按这个画'}
              </button>
            ) : (
              <button
                type="button"
                className="gr__primary"
                data-tone={published ? 'done' : ready ? 'go' : 'busy'}
                disabled={!ready || busy !== null || published}
                onClick={() => void confirm()}
              >
                {published ? '已装订' : ready ? '确定生成' : '创作中'}
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* 两个弹窗（工单 08）。★ 挂在最后、与 `/home` 那个"这一本要怎么做"同一处规矩：
          它们是**整屏**的模态，不属于任何一块内容 */}
      {editor?.kind === 'image' && editingPage && (
        <RedrawDialog
          page={editingPage}
          busy={busy !== null}
          onCancel={() => setEditor(null)}
          onConfirm={(fixNote) => void rerun(editingPage.pageNo, 'image', { fixNote })}
        />
      )}
      {editor?.kind === 'audio' && editingPage && (
        <RevoiceDialog
          page={editingPage}
          busy={busy !== null}
          onCancel={() => setEditor(null)}
          onConfirm={(body) => void rerun(editingPage.pageNo, 'audio', { body })}
        />
      )}
    </section>
  )
}

/** 每一格的读屏说法。★ 颜色与圆点读屏看不见，所以状态要有一句话 */
const RAIL_SR: Record<string, string> = {
  todo: '还没轮到',
  now: '正在做',
  done: '已完成',
  skipped: '这一本不做',
  partial: '没做全',
}
