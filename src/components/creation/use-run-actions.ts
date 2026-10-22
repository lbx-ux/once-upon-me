'use client'

/**
 * use-run-actions.ts —— 这一屏上会**花钱**的那几个出口（工单 D-34，2026-10-21 拆出）
 *
 * 五个动作，按"谁发起的"分两拨：
 *
 * | 动作        | 从哪儿点   | 花的是             |
 * | ----------- | ---------- | ------------------ |
 * | `rewrite`   | 闸门那一屏 | 一次文本调用（重编整篇故事） |
 * | `illustrate`| 闸门那一屏 | 整本出图——这一屏最贵的一下 |
 * | `confirm`   | 两屏都有   | 装订（不调模型，落的是清单） |
 * | `rerun`     | 画桌那一格 | 一页的图或一条录音 |
 * | `openEditor`| 画桌那一格 | **不花钱**：它只开弹窗（工单 08 的那个中间步） |
 *
 * 它们住在一起，是因为它们共享同一件事：**"这一屏上还允许再发起一个动作吗"**。
 *   那个判据是 `working !== null || busy` 这一对（整轮粒度与单页粒度），
 *   散在两个 hook 里的话，某一天会有第三个出口忘了问。
 *
 * 三条不显然的约定（都在原来那个大函数的注释里，跟着搬过来了）：
 *
 * 1. ★ **`rewrite` 的三条"不算成"都回 `false`**，其中一条最容易被漏掉：
 *    流里来了一条 `fatal` 帧时，**流仍然是正常收尾的**（服务端把这一轮终止了，
 *    但 HTTP 层没出错）。原来这里只看 promise 成没成，于是失败也会一路走到
 *    "换成新的了"——屏幕上刚说完"重写好了"，而盘上那份根本没动。
 * 2. ★ **`illustrate` 收尾那一句必须用函数式更新**：这个回调是 await 之前建的
 *    （那时还在闸门上），而 `book-ready` 可能已经到了。读闭包里的旧值会把
 *    "画完了"压回"这一轮没跑完"。
 * 3. ★ **409 `book-busy` 有自己的出路**：那一本已经在画了（多半是另一个标签页点的），
 *    这时候把人留在闸门上只会看到一句错话，而他想看的正是"画到哪儿了"——
 *    切到运行视图并把轮询交给 `use-run-poll.ts`。用户实测的原话是
 *    「他告诉我正在生成中，我看不到画的什么」。
 */

import { useCallback, useState } from 'react'

import {
  ApiError,
  fetchStory,
  illustrateBook,
  publishBook,
  replayFrames,
  rerunPage,
  rewriteStory,
} from '@/lib/creation/api.ts'
import type { StoryDoc } from '@/lib/schemas/story.ts'
import type { RunPageView } from '@/lib/run-pages.ts'

import { storyDeskOf } from './frames.ts'
import type { RunPlan, RunResume, RunStream } from './use-run-stream.ts'
import type { SaveState } from './use-story-autosave.ts'

/**
 * 单页重做的粒度（哪一页、哪一件事）。★ 与 `working` 分开：那个是整轮粒度
 *   （重写一版 / 逐页画），这个是"某一格正在换"。
 */
export type BusyPage = { pageNo: number; kind: 'image' | 'audio' }
/** 现在开着的是哪个弹窗。`null` = 都关着 */
export type OpenEditor = { kind: 'image' | 'audio'; pageNo: number } | null

export type RunActions = {
  rewrite: (rewriteNote: string) => Promise<boolean>
  illustrate: () => Promise<void>
  confirm: () => Promise<void>
  rerun: (
    pageNo: number,
    kind: 'image' | 'audio',
    extra?: { fixNote?: string; body?: string[] },
  ) => Promise<void>
  openEditor: (pageNo: number, kind: 'image' | 'audio') => void
  busy: BusyPage | null
  editor: OpenEditor
  setEditor: (next: OpenEditor) => void
  /** 弹窗要用的那一页（取不到就是 `null`，弹窗不渲染） */
  editingPage: RunPageView | null
}

export function useRunActions(args: {
  plan?: RunPlan | undefined
  resume?: RunResume | undefined
  /** `use-run-stream` 的返回值——动作要读它、也要改它 */
  stream: RunStream
  story: StoryDoc | null
  setStory: (next: StoryDoc) => void
  setDirty: (next: boolean) => void
  working: 'rewriting' | 'illustrating' | null
  setWorking: (next: 'rewriting' | 'illustrating' | null) => void
  setPublished: (next: boolean) => void
  setSaveState: (next: SaveState) => void
}): RunActions {
  const { plan, resume, stream, story, working } = args
  /** 那几个 setter 是 `useState` 的（身份恒定）：解构出来让下面依赖数组是普通标识符 */
  const { setStory, setDirty, setWorking, setPublished, setSaveState } = args
  const {
    bookId,
    setPhase,
    setFatal,
    setNote,
    setServerRunning,
    sink,
    setDesk,
    onIllustrateFrame,
    onRerunFrame,
    pushDelta,
    runPages,
    loadRunPages,
  } = stream

  const [busy, setBusy] = useState<BusyPage | null>(null)
  const [editor, setEditor] = useState<OpenEditor>(null)

  const voiceId = resume?.voiceId ?? plan?.voiceId

  /** 单页重做：画桌上点「重画 / 重配」之后真发出去的那一下 */
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
          onRerunFrame,
        )
        // 重做之后每页的内容可能变了（改过正文的话，书里那一页的字也变了），再取一次
        await loadRunPages(bookId)
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [bookId, busy, voiceId, loadRunPages, onRerunFrame, setNote],
  )

  /** 画桌上点「重画 / 重配」：先开弹窗，不直接发请求（工单 08）。
   *  这一下改动的是"花钱"这件事的入口：原来点一下就开始重画，现在点一下先看清楚
   *    上一版与原来那段提示词。用户要的正是这个中间那一步
   */
  const openEditor = useCallback(
    (pageNo: number, kind: 'image' | 'audio') => {
      if (runPages.some((page) => page.pageNo === pageNo)) {
        setEditor({ kind, pageNo })
        return
      }
      // 还没取回这一页的内容（多半是刚跑完、请求还在路上）：直接说不出来由，别开一个空弹窗
      setNote('这一页的内容还没读到，等两秒再点一次。')
    },
    [runPages, setNote],
  )

  const editingPage = editor
    ? (runPages.find((page) => page.pageNo === editor.pageNo) ?? null)
    : null

  /**
   * 「让 AI 重写一版」。
   *
   * 出发前先把自动保存停掉（`use-story-autosave.ts` 的 `enabled` 里那一条 `working`）：
   *   否则排队中的那一笔会在重写写盘之后落地，把家长改的旧文字盖回新故事上。
   * 回来之后重新取一次 `story.json`（而不是"把流里的事件拼一份出来"）：
   *   盘上那一份是服务端写的，与拿去画的那一份必然是同一个——
   *   在客户端再拼一次就是同一个值有第二个来源。
   * 返回 `true` 才算换成了新的一版（`StorySheet` 拿它决定清不清那一格，
   *   见那边文件头第 8 条②）。三条"不算成"的路都回 false：请求本身失败、
   *   流里来了一条 `fatal` 帧（见文件头第 1 条）、以及这一本已经有活干着。
   */
  const rewrite = useCallback(
    async (rewriteNote: string): Promise<boolean> => {
      if (!bookId || working) return false
      setWorking('rewriting')
      setNote(null)
      /* 客户端这一份事件日志跟着服务端一起截断（`rewrite/route.ts` 文件头第 2 条：
         重写第一步就是 `log.truncate`）——它是同一份日志的镜像，不跟着截就会错在页数上：
         16 页重写成 10 页之后，先前那条 `plan-ready`（`nodeCount: 16`）还留在数组里，
         而 `deskOf` 的 `total` 只增不减（`frames.ts` 判据 2，那一条是为乱序与重放
         写的），于是点「就按这个画」时折出来的桌子仍按 16 页摆格子，最后留下 6 个
         永远填不上的空框、上面写着 `10 / 16 页画好了`。服务端那一半是同一条纪律，
         只不过它那边防的是重放。
       desk 一起清：书名照旧有着落（`shownDesk` 读的是手上这一份 `story`，
         它到成功那一刻才被换掉），而"编故事正在做"这件事由阶段轨那一条说
         （见 `GenerationRun` 的 `rail`：重写是已经发生的事实，不等事件）。
       顺手把 desk 清成空的也让"上一版每页的正文"不留在折出来的桌子里——
         这一屏的正文本来就来自 `story`，不从 desk 来。 */
      sink.clear()
      /** 流里来的 `fatal`（服务端把这一轮终止了）。★ 它不算异常：流是正常收尾的。
       *  装在一个对象里而不是一个 `let` 变量：`let x: string | null = null` 在这里
       *    会被 TS 收窄成 `null`，底下那句判断就报"两个类型不重叠"——
       *    而属性上的收窄会在每次函数调用之后作废，正是这里要的。
       */
      const failure: { note: string | null } = { note: null }
      try {
        await rewriteStory(bookId, rewriteNote, (frame) => {
          if (frame.kind === 'engine') sink.push(frame.event)
          // ★ 重写这条路上增量比开一本那条更有用：家长刚写了一句"结局改成她带着
          //   全班一起飞"，他要看的就是那句话有没有被听进去（工单 D-04）
          else if (frame.kind === 'delta') pushDelta(frame.text)
          else if (frame.kind === 'fatal') {
            failure.note = frame.message
            setNote(frame.message)
          }
        })
        if (failure.note !== null) return false
        const doc = await fetchStory(bookId)
        setStory(doc)
        setDesk(storyDeskOf(doc))
        /* 整篇都换掉了，那一份"改过没改过"的记录跟着归零——但放在成功这一支：
           失败时家长手改的那些字还在屏幕上，`dirty` 一归零，自动保存就再也不会去存它们
           （他改的东西会在他离开这一屏之后真的没有）。 */
        setDirty(false)
        setSaveState('rewritten')
        return true
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err))
        return false
      } finally {
        setWorking(null)
      }
    },
    [
      bookId,
      working,
      sink,
      pushDelta,
      setNote,
      setDesk,
      setWorking,
      setStory,
      setDirty,
      setSaveState,
    ],
  )

  /**
   * 「就按这个画」：把家长刚改完的那一份发出去，②开始跑。
   *
   * 请求体里带的是 `story`（屏幕上这一份），不是"服务端自己去读盘"——
   *   自动保存可能差最后一拍，而"画出来的"必须就是"看着的那一份"。
   *   服务端仍然会在画之前再校验一次（同一个 `storyProblemsOf`），
   *   并把它写回盘上，所以两边不会各留一份。
   */
  const illustrate = useCallback(async () => {
    if (!bookId || !story || working) return
    setWorking('illustrating')
    setNote(null)
    setFatal(null)
    // 下一条帧一到就是"在画了"：这一屏从闸门翻到画桌
    setPhase('running')
    try {
      await illustrateBook(bookId, story, onIllustrateFrame)
      // 流正常结束但没等到 `book-ready`（比如中途断线）：如实说，别停在"正在画"
      // ★ 函数式更新读**当下**那一档（见文件头第 2 条）
      // ★ 2026-10-22：同时把轮询打开。流断了不等于服务端停了，而轮询的入口是
      //   `serverRunning`（`use-run-poll`）。不开的话屏幕会冻在"断线"那一句上，
      //   哪怕服务端还在画——只能刷新页面才回得来。
      setServerRunning(true)
      setPhase((current) => (current === 'ready' ? current : 'replaying'))
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
      // 409 `book-busy` 有自己的出路（见文件头第 3 条）
      if (err instanceof ApiError && err.code === 'book-busy' && bookId) {
        setServerRunning(true)
        setPhase('replaying')
        void replayFrames(bookId)
          .then(({ events }) => sink.replace(events))
          .catch(() => undefined)
      } else {
        // ★ 别的失败退回闸门那一屏（故事还在，改一改就能再点一次）：
        //   停在"正在画"会让人以为还在跑，而那时候服务端早就结束了
        setPhase('story')
      }
    } finally {
      setWorking(null)
    }
  }, [
    bookId,
    story,
    working,
    onIllustrateFrame,
    sink,
    setNote,
    setFatal,
    setPhase,
    setServerRunning,
    setWorking,
  ])

  /** 「确定生成」：装订。它不调模型，落的是清单那一步 */
  const confirm = useCallback(async () => {
    if (!bookId || busy) return
    setNote(null)
    try {
      await publishBook(bookId)
      setPublished(true)
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    }
  }, [bookId, busy, setNote, setPublished])

  return { rewrite, illustrate, confirm, rerun, openEditor, busy, editor, setEditor, editingPage }
}
