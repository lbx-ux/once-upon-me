'use client'

/**
 * GenerationRun —— 运行视图：一句话进去，一页一页出来（工单 05）
 *
 * ```
 *   ①编故事 —— ②逐页画 —— ③配音 —— ④装订        ← 阶段轨（从事件推，4 格）
 *   《书名》                        k / N 页画好了
 *   ┌──┐┌──┐┌──┐┌──┐
 *   │🖼││🖼││▨ ││▨ │                              ← 画桌（Desk.tsx）
 *   └──┘└──┘└──┘└──┘
 *   ┌──────────────────────────────────┐
 *   │ 朵朵抱着月亮…（只读）   [确定生成] │          ← 底部那条
 *   └──────────────────────────────────┘
 * ```
 *
 * 五条判断，每条都有一个具体的坏法：
 *
 * 1. **阶段轨是 4 格，不是原型里那 5 个节点**。引擎的核对是每页画完**立刻**比的，
 *    做成节点会 20 页闪 40 次——而那个闪烁只说明我们在数事件。核对是**某一页的事**，
 *    它留在那一格的 `note` 上。推导在 `frames.ts` 的 `railOf`，**不在这个组件里**：
 *    那是会错的那一半，它必须能在 node 里被钉住（`frames.test.ts` 钉着它）。
 * 2. **故事正文在这里永远只读**。它进了书号指纹（`bookIdOf` 用的是 card+form+theme），
 *    改了就**是另一本书**。所以给一条明说的出口（「改故事＝重做一本」），
 *    不做就地编辑假装"只是改一句"。
 * 3. **单页重做只在整本做完之后解锁**。用户的原话是"在此期间用户不能修改"——
 *    而这期间**正是**在花钱，一个能改的入口会让人以为改了就不用重跑。
 * 4. **每一帧重新派一次整张画桌**（`deskOf(events)`）。看着像浪费，但它是**幂等**的：
 *    只扫一遍事件、同一页覆盖同一格，所以第 k 帧的结果只取决于前 k 条事件。
 *    增量维护省下的是几十次循环，换来的是"同一页重画算一格还是两格"这种判断
 *    散进 setState 里——而那正是 `frames.test.ts` 现在钉住的东西。
 * 5. **刷新之后要能接着看**。这一轮的指针存进 `sessionStorage`（**只有书号**，
 *    任何凭据都不进那里），刷新后回来重放。★ 但它不再是**唯一**一条路：
 *    草稿在书架上有位置（工单 03），那才是被放弃之后还找得回来的那一条。
 */

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookStreamFrame } from '@/lib/book-stream.ts'
import type { EngineEvent } from '@/lib/engine/events.ts'
import {
  createBook,
  listRunPages,
  publishBook,
  replayFrames,
  rerunPage,
} from '@/lib/creation/api.ts'
import { rememberLastRun } from '@/lib/creation/last-run.ts'
import { toBookBody, type RunForm } from '@/lib/creation/state.ts'
import type { RunPageView } from '@/lib/run-pages.ts'

import Desk from './Desk.tsx'
import RedrawDialog from './RedrawDialog.tsx'
import RevoiceDialog from './RevoiceDialog.tsx'
import { deskOf, EMPTY_DESK, railOf, type DeskState } from './frames.ts'

/**
 * 这一次生成的输入。★ 只有这三样——`wish` / `theme` 都在 `form.theme` 里，
 * 另立两个字段就是同一个值有两个家（`/home` 那颗药丸与设置的关系已经踩过这条）。
 */
export type RunPlan = {
  /** 这一轮的"他是谁 + 用哪张卡 + 讲什么"，由服务端按 URL 解出来 */
  form: RunForm
  pages: number
  /** 这一本用哪个音色朗读。**undefined = 这一本不配音** */
  voiceId?: string
}

export type GenerationRunProps = {
  /** 新做一本：进来就开始跑 */
  plan?: RunPlan
  /** 接着做一份已经存在的草稿：进来先重放，不重跑 */
  resume?: {
    bookId: string
    voiceOn: boolean
    published: boolean
    /**
     * 这一本在用的音色（清单上的 `Book.voiceId`）。
     * ★ 重配要它：改过正文之后那一页原来的录音还在，缺省能从它推；
     *   但**当初就没配上的那几页**（配音失败）没有前一份可推——那正是最需要重配的时候。
     */
    voiceId?: string
  }
}

type Phase = 'running' | 'ready' | 'failed' | 'replaying'

export default function GenerationRun({ plan, resume }: GenerationRunProps) {
  const [desk, setDesk] = useState<DeskState>(EMPTY_DESK)
  const [phase, setPhase] = useState<Phase>(resume ? 'replaying' : 'running')
  const [bookId, setBookId] = useState<string | null>(resume?.bookId ?? null)
  const [published, setPublished] = useState(resume?.published ?? false)
  const [fatal, setFatal] = useState<string | null>(null)
  const [busy, setBusy] = useState<{ pageNo: number; kind: 'image' | 'audio' } | null>(null)
  const [note, setNote] = useState<string | null>(null)
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

  /* ── 开跑 / 重放 ─────────────────────────────────────────────────────── */

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    if (resume) {
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
      ...(plan.voiceId ? { voiceId: plan.voiceId } : {}),
      // ★ 跑出来的是**草稿**：成品要等「确定生成」那一下（工单 03）
      status: 'draft',
    })
    void createBook(body, (frame) => {
      onFrame(frame)
      if (frame.kind === 'engine' && frame.event.kind === 'book-ready') {
        setBookId(frame.event.bookId)
        setPhase('ready')
        // ★ **只有书号**进 sessionStorage（文件头第 5 条），读写都在 `lib/creation/last-run.ts`
        rememberLastRun(frame.event.bookId)
        void loadRunPages(frame.event.bookId)
      }
    }).catch((err: unknown) => {
      setFatal(err instanceof Error ? err.message : String(err))
      setPhase('failed')
    })
  }, [plan, resume, onFrame, loadRunPages])

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

  const rail = railOf(desk, voiceOn)
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
        {desk.title ? `《${desk.title}》` : phase === 'failed' ? '这一本没做出来' : '开始创作中'}
      </h1>
      <p className="gr__sub" role="status">
        {/* ★ 2026-10-16 用户划掉了原来那句「这期间先不用管它，**也别关这个页面**」，
            要求写成："如果不想等待，可以等生成好之后在书架里找到并编辑。"
            ★ 那句话不只是口气不好，它**在拦一件不必拦的事**：这一轮跑在服务端
              （`/api/books` 文件头第 2 条：浏览器关了照旧落盘），关掉页面既不会中断它，
              也不会丢掉已经画好的那些页。所以现在说的是**这一本怎么找回来**，
              而"没做完的书在书架那一栏里"正是上一单（工单 10）刚做出来的东西。
            ★ 「这一轮不会停」五个字留着不删：不说的话，"可以先离开"读起来像"放弃它"。 */}
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

      {(fatal ?? desk.fatal) && (
        <p className="gr__error" role="alert">
          {fatal ?? desk.fatal}
        </p>
      )}
      {note && (
        <p className="gr__error" role="alert">
          {note}
        </p>
      )}

      <Desk
        desk={desk}
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

      {/* ── 底部那条：这一轮那句话（只读）+ 按状态变的那一颗 ─────────────── */}
      <footer className="gr__composer">
        <div className="gr__composer-inner">
          {/* ★ **始终只读**，而且这里没有"改一句"的入口：那句话进了书号指纹
              （`bookIdOf` 用的是 card + form + theme），改了就是另一本书。
              要改走右边那条出口，它明说"这会丢掉这一本"。
              ★ 接着做一份草稿时（`plan` 没有）这一格**不编一句话出来**：
              那句话**没有存在书里**（`Book` 上没有 theme / wish 两个字段），
              所以这里写的是"这一本现在处于什么状态"，那是真的 */}
          <p className="gr__story">
            {plan
              ? plan.form.theme.wish.trim() || plan.form.theme.theme.trim()
              : published
                ? '这本已经装订好了，在书架上放着。'
                : '这一本还没装订。不满意哪一页就在那一页重做，都没问题再点确定。'}
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
                  （清单是在收尾那一刻写的），跑完了才出现——说成一句就是假的。 */}
            <Link
              className="gr__exit"
              href="/shelf"
              title={
                phase === 'running'
                  ? '离开这一屏。服务器上会把这一本做完，做完就出现在书架的「正在编辑」里'
                  : '这一本在书架的「正在编辑」里，那里可以制作为绘本，也可以删掉'
              }
            >
              退出
            </Link>
            <button
              type="button"
              className="gr__primary"
              data-tone={published ? 'done' : ready ? 'go' : 'busy'}
              disabled={!ready || busy !== null || published}
              onClick={() => void confirm()}
            >
              {published ? '已装订' : ready ? '确定生成' : '创作中'}
            </button>
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
