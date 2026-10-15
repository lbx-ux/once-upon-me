'use client'

/**
 * CreateFlow —— 创作流的五步（工单 04）与它的三态（#16 的验收面）
 *
 * 结构：
 *
 *   <section.cf>
 *     <ol.cf__steps>          步骤条（已走过的步骤可点回去）
 *     <div.cf__body>          当前这一步
 *     <footer.cf__nav>        上一步 / 下一步（不满足判据时**当场说清缺什么**）
 *
 * 三条不显然的约定：
 *
 * 1. **状态只活在这里**（`useReducer`），不装全局 store。跨页面的活状态只有"这一轮生成"，
 *    而它落在磁盘上（`books/<id>/`）。见 lib/creation/state.ts 文件头。
 * 2. **刷新之后要能接着看**：这一轮的书号存进 `sessionStorage`（**只有书号与页数**，
 *    没有 key、没有孩子信息），刷新后回到生成那一步并重放日志。
 *    ★ 存的是书号不是"进度"：进度是服务端的事实，客户端存一份就会有两份。
 * 3. **事件文案不在这里翻**：一行写什么人话由引擎的 `describeEvent` 决定，
 *    该不该占一行由 `isDisplayable` 决定。界面只决定它长什么样
 *    （`data-tone`）。写第二份文案表的那天起，MCP 返回与屏幕上就会出现两句不一样的话。
 */

import Link from 'next/link'
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { assetUrlOf } from '@/lib/asset-url.ts'
import type { EngineEvent } from '@/lib/engine/events.ts'
import { THEMES } from '@/lib/themes'
import { AGE_BAND_LABELS } from '@/lib/engine/domain.ts'
import {
  ApiError,
  createBook,
  createCard,
  listCards,
  listChildren,
  replayFrames,
  type CardSummary,
  type ChildPickerItem,
} from '@/lib/creation/api.ts'
import { DEFAULT_ANCHORS } from '@/lib/creation/default-anchors.ts'
// 表单零件（`Field` / `Chip` / `ChildFields` / `AnchorFields`）在 fields.tsx：
// /character/new 是第二个问"他是谁"的入口，选项与必填项只能有一份（工单 03 第二刀）
import { AnchorFields, Chip, ChildFields, Field } from './fields.tsx'
// 画桌：一串事件 → 一格一格。纯函数搬在 `frames.ts`（有测试，见 frames.test.ts），
// 组件只管它长什么样。★ 这两件事分开的理由：归格规则（重画算一格、复习合并……）
// 是**会错的**那一半，它必须能在 node 里被钉住
import Desk from './Desk.tsx'
import { deskOf, drawnCount, EMPTY_DESK, type DeskState } from './frames.ts'
import {
  STEPS,
  initialState,
  stepProblems,
  toBookBody,
  toCardBody,
  type CreationState,
  type StepKey,
} from '@/lib/creation/state.ts'
import { missingRequired } from '@/lib/settings/state.ts'
import { useSettings } from '@/components/settings/SettingsProvider.tsx'

/** 只有主题、没有那句话时，把主题名当愿望的起点（第 2 步的输入框里它仍可改） */
function wishFrom(
  base: { theme: { theme: string; wish: string } },
  theme?: { label: string },
): string {
  return base.theme.wish || (theme ? `关于${theme.label}的故事` : '')
}

/** 刷新后接着看的那一条指针。**只有书号与页数**——任何凭据都不进这里 */
const LAST_RUN_KEY = 'once-upon-me:last-run'
/** 产品定义的独读版是 20 页；演示要能缩小规模，所以它是可选的 */
const PAGE_CHOICES = [5, 8, 12, 20]

type CardState = {
  busy: boolean
  error: string | null
  retryable: boolean
}

type RunState = {
  phase: 'idle' | 'running' | 'done' | 'failed' | 'replaying'
  /**
   * 这一轮的**画桌**：一页一格，由 `deskOf(events)` 从原始事件派生。
   * ★ 原来这里存的是 `rowsOf(events)`——一串已经翻成人话的**文本行**，
   *   而原始事件在 `startRun` 的局部变量里，函数一返回就没了。
   *   那样"按页看"这件事就再也做不成（文本行里没有结构化页码），
   *   所以现在留下的是事件，文案在渲染时由 `deskOf` + `describeEvent` 现取。
   */
  desk: DeskState
  bookId: string | null
  /** 收尾帧说的两件事：服务端还在跑吗、成品在不在 */
  serverRunning: boolean
  bookReady: boolean
  skippedLines: number
  fatal: string | null
}

const EMPTY_RUN: RunState = {
  phase: 'idle',
  desk: EMPTY_DESK,
  bookId: null,
  serverRunning: false,
  bookReady: false,
  skippedLines: 0,
  fatal: null,
}

type Action =
  | { type: 'goto'; step: number }
  | { type: 'child'; patch: Partial<CreationState['child']> }
  /** 整份换掉（选中另一个小主角、或换到"新建一个"） */
  | { type: 'child-reset'; child: CreationState['child'] }
  /** 把卡那半份清空（只留锚点）。换孩子时**必须**清：见 `pickChild` 那段 */
  | { type: 'card-reset'; anchors: CreationState['card']['anchors'] }
  | { type: 'theme'; patch: Partial<CreationState['theme']> }
  | { type: 'anchors'; anchors: CreationState['card']['anchors'] }
  | {
      type: 'card-ready'
      result: {
        cardId: string
        revision: number
        referenceUrl: string
        promptFragment: string
        checklist: string[]
        /**
         * ★ 这一张卡**自己的**锚点（工单 03 第 4 刀补上的）。
         *
         * 原来是漏的：选定一张已有的卡之后，第 3 步的表单里躺着的还是
         * `DEFAULT_ANCHORS`，而卡里是它自己那七条。症状很安静——
         * 界面看着正常，但此时点"换一版"发出去的锚点是**表单里那份**，
         * 于是"换一版"实际上把卡改成了另一套锚点（revision +1，形象依据全变），
         * 而家长以为自己只是重画了一张。
         */
        anchors: CreationState['card']['anchors']
        /** 复用旧卡时才知道：这张卡是哪个模型画的。界面要如实说，不能都说成"你填的模型" */
        modelId?: string
      }
    }

function reducer(state: CreationState, action: Action): CreationState {
  switch (action.type) {
    case 'goto':
      return { ...state, step: action.step }
    case 'child':
      return { ...state, child: { ...state.child, ...action.patch } }
    case 'child-reset':
      return { ...state, child: action.child }
    case 'card-reset':
      // 卡那半份整体丢开：`cardId`/`revision`/`referenceUrl`/派生文本都是**上一张卡**的
      return { ...state, card: { anchors: action.anchors } }
    case 'theme':
      return { ...state, theme: { ...state.theme, ...action.patch } }
    case 'anchors':
      return { ...state, card: { ...state.card, anchors: action.anchors } }
    case 'card-ready':
      // 锚点跟着卡一起换：见 `card-ready.anchors` 那段
      return {
        ...state,
        card: { ...state.card, ...action.result, anchors: action.result.anchors },
      }
  }
}

/** 一条事件 → 一行（该不该占行、写什么话，都由引擎决定；这里只定"长什么样"）
 *  —— 这段搬去 `frames.ts` 了：画桌要的**不是"一行一行"**，而是"一页一格"，
 *  而后者要先按页码把事件归拢。两份实现会在"重画时算几行"这件事上立刻分家。 */

export type CreateFlowProps = {
  /** 工作台主题模板带进来的那个 key（`?theme=dino`）。只当**初值**用，之后由用户说了算 */
  initialThemeKey?: string
  /** 工作台「创作」那一屏写的那句话（`?wish=…`）。同样是初值，不是第二套表单 */
  initialWish?: string
  /** 工作台「小主角」那一格挑的卡（`?card=…`）。兑现的是 ADR-0007 的可复用 */
  initialCardId?: string
  /**
   * 第 1 步直接选中的孩子（`?child=…`，工单 03 第 4 刀）。
   *
   * ★ 与 `initialCardId` 的关系是"两个人称指同一件事"：卡上带着 `childId`，
   *   所以 `?card=` 也能反查出是谁。两个参数都留着，是因为 `?card=` 已经在用
   *   （工作台那张卡上的「用它做一本」），而 `?child=` 才是这一屏自己的说法——
   *   这一屏是**按孩子**组织的，卡只是他的形象。
   */
  initialChildId?: string
}

export default function CreateFlow({
  initialThemeKey,
  initialWish,
  initialCardId,
  initialChildId,
}: CreateFlowProps = {}) {
  const [state, dispatch] = useReducer(
    reducer,
    { themeKey: initialThemeKey, wish: initialWish },
    (seed) => {
      const base = initialState()
      const theme = THEMES.find((item) => item.key === seed.themeKey)
      const wish = (seed.wish ?? '').trim()
      if (!theme && wish === '') return base
      return {
        ...base,
        theme: {
          theme: theme?.label ?? '',
          wish: wish !== '' ? wish : wishFrom(base, theme),
        },
      }
    },
  )
  const [card, setCard] = useState<CardState>({ busy: false, error: null, retryable: false })
  const [run, setRun] = useState<RunState>(EMPTY_RUN)
  const [pages, setPages] = useState(PAGE_CHOICES[1] as number)
  const [problems, setProblems] = useState<string[]>([])

  // ★ 模型与密钥不再来自创作流的状态，来自设置抽屉（工单 04）。
  //   所以这里**不再有** ModelKeyForm 那一份状态——一个值只有一个家，
  //   不会出现"抽屉里改了、创作流还拿着旧的一份"。
  const { settings, env: settingsEnv, openSettings, canNarrate } = useSettings()
  const stepKey = (STEPS[state.step - 1]?.key ?? 'child') as StepKey

  /* ── 刷新之后：回到生成那一步，重放已经发生过的过程 ───────────────────── */

  useEffect(() => {
    const saved = sessionStorage.getItem(LAST_RUN_KEY)
    if (!saved) return
    let bookId = saved
    let savedPages: number | null = null
    try {
      const parsed = JSON.parse(saved) as { bookId?: string; pages?: number }
      if (parsed.bookId) bookId = parsed.bookId
      if (typeof parsed.pages === 'number') savedPages = parsed.pages
    } catch {
      /* 旧格式（就是个书号）：按书号读 */
    }
    if (savedPages !== null) setPages(savedPages)
    setRun((prev) => ({ ...prev, phase: 'replaying', bookId }))
    // ★ 光设 `run` 不够：刷新之后组件是新挂载的，步骤停在 1，
    //   而过程面板只在生成那一步渲染——于是"重放了，但看不见"。
    //   实测就是这么翻出来的：日志读到了、rows 也填了，屏幕上还是第 1 步。
    dispatch({ type: 'goto', step: STEPS.length })

    void replayFrames(bookId)
      .then(({ events, status }) => {
        setRun({
          phase: status?.bookReady ? 'done' : 'replaying',
          desk: deskOf(events),
          bookId,
          serverRunning: status?.running ?? false,
          bookReady: status?.bookReady ?? false,
          skippedLines: status?.skippedLines ?? 0,
          fatal: null,
        })
      })
      .catch(() => {
        // 读不回日志不是错误：就当这一轮没开始过，回到空态
        setRun(EMPTY_RUN)
      })
  }, [])

  /* ── 第 1 步：有哪些小主角（工单 03 第 4 刀） ──────────────────────────── */

  const [children, setChildren] = useState<ChildPickerItem[]>([])
  /** 选中的是谁。null = 没选（在"新建一个"那一栏里填） */
  const [picked, setPicked] = useState<string | null>(null)
  /** 在"新建一个"那一栏（而不是在看列表）。它与 `picked === null` 一起决定这一步显示什么 */
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    void listChildren().then(setChildren)
  }, [])

  const pickedChild = children.find((item) => item.childId === picked) ?? null

  /**
   * 选一个已有的小主角：**把"他是谁"整份填进表单，并把他的形象一起选上**。
   *
   * ★ 为什么连 `card` 一起选：这一屏（和 `toBookBody`）是"孩子 + 卡"两个坐标，
   *   只填一半会让第 3 步显示"还没选形象"，而家长明明刚选了一个有形象的孩子——
   *   那一步会让他以为还得重出一张。
   * ★ 反过来，**他没有形象时要清掉上一张卡**：不清的话 `cardId` 还挂着上一个人的，
   *   而"这一步选了谁"与"这本书用谁的卡"就分家了——那种错没有报错，
   *   只有"这本说是小满的书里全是小宇"。
   */
  const pickChild = useCallback((item: ChildPickerItem): void => {
    setPicked(item.childId)
    setCreating(false)
    dispatch({
      type: 'child',
      patch: {
        childId: item.childId,
        name: item.name,
        nameReading: item.nameReading,
        ageBand: item.ageBand,
        lookTags: [...item.lookTags],
        interestTags: [...item.interestTags],
      },
    })
    dispatch(
      item.card
        ? {
            type: 'card-ready',
            result: {
              cardId: item.card.cardId,
              revision: item.card.revision,
              // 预览取 768 档（原图是 2.7 MB 的 1440² PNG）；列表里那张小图是 240
              referenceUrl: item.card.previewUrl,
              promptFragment: item.card.promptFragment,
              checklist: [...item.card.checklist],
              // ★ 用卡自己的锚点，不是表单里那份默认值（见 `card-ready.anchors`）
              anchors: [...item.card.anchors],
              modelId: item.card.modelId,
            },
          }
        : // 他还没有形象：第 3 步会现出一张。锚点回到这份中性预填
          { type: 'card-reset', anchors: [...DEFAULT_ANCHORS] },
    )
  }, [])

  /** 换到"新建一个"：清掉选中的人与他的卡，回到一张空表单（新 childId） */
  const startCreating = useCallback((): void => {
    setPicked(null)
    setCreating(true)
    dispatch({ type: 'child-reset', child: initialState().child })
    dispatch({ type: 'card-reset', anchors: [...DEFAULT_ANCHORS] })
  }, [])

  /* ── 第 4 步：已有的卡（ADR-0007 的可复用） ───────────────────────────── */

  const [existing, setExisting] = useState<CardSummary[]>([])
  useEffect(() => {
    void listCards().then(setExisting)
  }, [])

  /* ── 带参数进来的初值：`?child=` 或 `?card=` 都归到"选中谁"这一件事 ─────── */

  // ★ 只在**第一次**拿到孩子列表时应用：它是初值，不是一条持续生效的规则。
  //   持续应用会把用户后来自己换的那个人又抢回去（实测过同类 bug：
  //   参数驱动的初值写成"每次都对齐参数"，用户改不动那个字段）。
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || children.length === 0) return
    if (!initialChildId && !initialCardId) return
    seeded.current = true

    // ① `?child=` 优先：它是这一屏自己的说法（这一屏按**孩子**组织，卡只是他的形象）
    if (initialChildId) {
      const item = children.find((each) => each.childId === initialChildId)
      if (item) {
        pickChild(item)
        return
      }
      setCard({
        busy: false,
        error: `找不到小主角 ${initialChildId}，大概是删过了。下面挑一个，或者新建一个。`,
        retryable: false,
      })
      return
    }

    // ② `?card=` 反查是谁：卡上带着 childId。★ 不靠"卡号 = `${childId}-sheet`"那个约定
    const owner = children.find((each) => each.card?.cardId === initialCardId)
    if (owner) {
      pickChild(owner)
      return
    }
    // 认不出来（卡删了、属于的孩子删了、或地址是手打的）：说清楚为什么，然后让这一步照原样工作。
    //   ★ 不静默当成"没带参数"——那会让人以为选了就是选了
    setCard({
      busy: false,
      error: `找不到角色卡 ${initialCardId}，大概是删过了。现出一张就行。`,
      retryable: false,
    })
  }, [children, initialChildId, initialCardId, pickChild])

  /* ── 第 4 步：出一张形象 ─────────────────────────────────────────────── */

  const generateCard = useCallback(async () => {
    setCard({ busy: true, error: null, retryable: false })
    try {
      const result = await createCard(toCardBody(state, settingsEnv))
      // ★ 锚点用服务端回的那份（`result.anchors`）：卡里生效的就是它。
      //   这里展开而不是直接塞 `result`，是因为状态里那份是可变的（表单要就地改）
      dispatch({ type: 'card-ready', result: { ...result, anchors: [...result.anchors] } })
      setCard({ busy: false, error: null, retryable: false })
    } catch (err) {
      const failure =
        err instanceof ApiError
          ? { message: err.message, retryable: err.retryable }
          : { message: err instanceof Error ? err.message : String(err), retryable: true }
      setCard({ busy: false, error: failure.message, retryable: failure.retryable })
    }
  }, [state, settingsEnv])

  /* ── 第 5 步：跑一本书 ───────────────────────────────────────────────── */

  const startRun = useCallback(async () => {
    const events: EngineEvent[] = []
    let fatal: string | null = null
    setRun({ ...EMPTY_RUN, phase: 'running' })
    try {
      await createBook(toBookBody(state, settingsEnv, pages), (frame) => {
        if (frame.kind === 'engine') {
          events.push(frame.event)
          // ★ 每一帧重新派一次整张画桌。看着像浪费（O(事件数) 每帧），
          //   但它是**幂等**的：`deskOf` 只扫一遍事件、同一页覆盖同一格，
          //   所以第 k 帧的结果只取决于前 k 条事件，与"怎么走到这里的"无关。
          //   增量维护（在 setState 里手改上一格的引用）省下的是几十次循环，
          //   换来的是"同一页重画算一格还是两格"这种判断散进 setState 里——
          //   而那正是 `frames.test.ts` 现在钉住的东西。
          setRun((prev) => ({ ...prev, desk: deskOf(events) }))
        } else if (frame.kind === 'fatal') {
          fatal = frame.message
        }
      })
      // 书号从 `book-ready` 事件拿。拿不到就没有成品——**如实说**，不给一个转下去的圈
      const ready = events.find((event) => event.kind === 'book-ready')
      const bookId = ready?.kind === 'book-ready' ? ready.bookId : null
      setRun((prev) => ({
        ...prev,
        bookId,
        phase: fatal ? 'failed' : bookId ? 'done' : 'failed',
        fatal,
        bookReady: bookId !== null,
      }))
      if (bookId) sessionStorage.setItem(LAST_RUN_KEY, JSON.stringify({ bookId, pages }))
    } catch (err) {
      setRun((prev) => ({
        ...prev,
        phase: 'failed',
        fatal: err instanceof ApiError ? err.message : String(err),
      }))
    }
  }, [state, settingsEnv, pages])

  // ★ 「跑不动」的判据也从设置来（只有文本与图像两组是必需的）
  const cardMissing = missingRequired(settings)

  return (
    <section className="cf">
      <header className="cf__head">
        <h1 className="cf__title">做一本自己的绘本</h1>
        <p className="cf__lede">五步，几分钟。中间那一步会让你先看见孩子变成绘本主角的样子。</p>
        {/* ★ 共读版不摆灰掉的入口：整套交互（图+语音按钮、树枝可视化）在 W3，
            摆一个进不去的入口等于提前承诺。但也不能不提——产品定义里它是一半。 */}
        <p className="cf__lede cf__lede--muted">
          这一版做的是<b>独读版</b>：一页一图一句，睡前安静听完的那种。
          共读版——孩子自己选着走、不同路径通向不同结局的那种——正在做。
        </p>
        {/* ★ 模型与密钥的入口在**头部**，不在流程里（工单 04）：它是"用之前"的事。
            配了没有一眼可见——不配的代价也写明，而不是等点生成时才发现。 */}
        <div className="cf__settings-row">
          <button type="button" className="cf__btn cf__btn--ghost" onClick={openSettings}>
            模型与密钥
          </button>
          <span className="cf__settings-state" data-ok={cardMissing.length === 0}>
            {cardMissing.length === 0
              ? canNarrate
                ? '已配齐，这一本会有朗读'
                : '文本与图像已配齐；语音没配齐，这一本不会有朗读'
              : '还没配齐——点左边的「模型与密钥」把模型和 key 填上'}
          </span>
        </div>
      </header>

      <ol className="cf__steps">
        {STEPS.map((step, index) => {
          const no = index + 1
          const reached = no <= state.step
          return (
            <li
              key={step.key}
              className="cf__step"
              data-current={no === state.step ? 'true' : 'false'}
              data-reached={reached ? 'true' : 'false'}
            >
              <button
                type="button"
                className="cf__step-btn"
                disabled={!reached}
                onClick={() => dispatch({ type: 'goto', step: no })}
              >
                <span className="cf__step-no">{no}</span>
                <span className="cf__step-title">{step.title}</span>
              </button>
            </li>
          )
        })}
      </ol>

      <div className="cf__body">
        {stepKey === 'child' && (
          <StepShell step={stepKey}>
            {pickedChild ? (
              /* ── 已经选了谁：一行摘要，加一个"换一个" ─────────────────────
                 ★ 摘要里只写**这一轮真的要用**的三件事：名字、年龄、有没有形象。
                    把锚点、模型名都摊在这一行是把第 3 步的内容提前抄一遍，
                    而抄的那一份迟早会与卡里那份不一样 */
              <div className="cf__picked">
                {pickedChild.card ? (
                  /* 原生 <img>：图经 /api/assets 出来，next/image 要另配 loader（README §五）。
                     ★ eslint-disable 紧贴 <img> 那一行：写在三元**外面**的那一行
                     盖住的是 `{pickedChild.card ? (`，图本身照样被规则点名（实测 lint 警告） */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="cf__picked-art"
                    src={pickedChild.card.thumbUrl}
                    alt={`${pickedChild.name}的形象`}
                    width={96}
                    height={96}
                  />
                ) : (
                  <span className="cf__picked-none" aria-hidden="true">
                    ？
                  </span>
                )}
                <div className="cf__picked-what">
                  <p className="cf__picked-name">
                    {pickedChild.name}
                    <span className="cf__picked-reading">{pickedChild.nameReading}</span>
                    {pickedChild.source === 'demo' ? (
                      <span className="cf__picked-demo">示例</span>
                    ) : null}
                  </p>
                  <p className="cf__picked-meta">
                    {AGE_BAND_LABELS[pickedChild.ageBand]} ·
                    {pickedChild.card
                      ? ` 形象是第 ${pickedChild.card.revision} 版，第 3 步直接用这张`
                      : ' 还没有形象，第 3 步会现出一张'}
                  </p>
                  <button type="button" className="cf__btn cf__btn--ghost" onClick={startCreating}>
                    换一个人 / 新建一个
                  </button>
                </div>
              </div>
            ) : creating || children.length === 0 ? (
              /* ── 新建：五格表单在 `fields.tsx`，与 `/character/new` 共用同一份 ── */
              <ChildFields
                child={state.child}
                onPatch={(patch) => dispatch({ type: 'child', patch })}
                extra={
                  <p className="cf__note cf__note--muted">
                    传孩子照片那条路<strong>不在这一步</strong>：它在
                    <Link href="/character/new">「新建小主角」</Link>
                    那一屏上，与&ldquo;从零描述&rdquo;并列摆着，两条路都会住进同一份档案。 ★
                    挪走的理由不是位置好看：那一条路要一次<strong>单独同意</strong>、
                    要说出我们拿照片做了什么，而这一屏是&ldquo;填完往下走&rdquo;的节奏，
                    塞一个需要停下来读的同意框在这里，两边都做不好。
                    这一步的七条锚点仍然是形象唯一的判据——照片那条路也一样，它换的是
                    <strong>第一张插画怎么来</strong>，不是锚点由谁定。
                  </p>
                }
              />
            ) : (
              /* ── 默认：先问"用哪个小主角" ─────────────────────────────────
                 这一屏从"填孩子"变成"选孩子"，兑现的是 ADR-0007 那句
                 「角色卡是**可复用的资产**」：孩子不是每一本书的表单字段，
                 他是磁盘上一个有档案、有版本、能被很多本书指着的人。 */
              <>
                <p className="cf__note">
                  下面这些是已经建好的小主角。选一个，他的名字、读音、年龄和形象会一路带到
                  最后一步——<strong>下次做新书不用重填</strong>。
                </p>
                <ul className="cf__pick">
                  {children.map((item) => (
                    <li key={item.childId}>
                      <button
                        type="button"
                        className="cf__pick-item"
                        onClick={() => pickChild(item)}
                      >
                        {item.card ? (
                          /* 240 档：这一格在界面上只有 64px，原图是 2.7 MB 的 1440² PNG。
                             没有形象的那些不是图片，是下面那个问号框 */
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className="cf__pick-art"
                            src={item.card.thumbUrl}
                            alt=""
                            width={64}
                            height={64}
                          />
                        ) : (
                          <span className="cf__pick-none" aria-hidden="true">
                            ？
                          </span>
                        )}
                        <span className="cf__pick-text">
                          <span className="cf__pick-name">
                            {item.name}
                            <span className="cf__pick-reading">{item.nameReading}</span>
                            {item.source === 'demo' ? (
                              /* ★ "示例"是**说明**不是标签：它由数据来源决定，点不动 */
                              <span className="cf__pick-demo">示例</span>
                            ) : null}
                          </span>
                          <span className="cf__pick-meta">
                            {AGE_BAND_LABELS[item.ageBand]} ·
                            {item.card
                              ? ` 第 ${item.card.revision} 版形象`
                              : // ★ 前导空格不是强迫症：JSX 会吃掉换行与缩进，`·` 与这句之间
                                //   没有别的东西了，少这一个空格就渲染成「4-6 岁 ·还没有形象」
                                ' 还没有形象（第 3 步会现出一张）'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="cf__btn cf__btn--ghost" onClick={startCreating}>
                  ＋ 新建一个小主角
                </button>
                <p className="cf__note cf__note--muted">
                  新建会走同一份表单：名字、读音、年龄，然后到第 3 步给他出形象。 想用
                  <strong>他的照片</strong>来出第一张，去
                  <Link href="/character/new">「新建小主角」</Link>那一屏——那条路要一次单独同意。
                </p>
              </>
            )}
          </StepShell>
        )}

        {stepKey === 'theme' && (
          <StepShell step={stepKey}>
            <Field label="想讲什么" required hint="挑一个，或者在下面自己写一句">
              <div className="cf__themes">
                {THEMES.map((theme) => (
                  <Chip
                    key={theme.key}
                    active={state.theme.theme === theme.label}
                    onClick={() => dispatch({ type: 'theme', patch: { theme: theme.label } })}
                  >
                    {theme.label}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="或者，自己写一句">
              <input
                className="cf__input"
                value={state.theme.wish}
                maxLength={200}
                placeholder="第一次离开家也不怕"
                onChange={(event) =>
                  dispatch({ type: 'theme', patch: { wish: event.target.value } })
                }
              />
            </Field>
          </StepShell>
        )}

        {stepKey === 'card' && (
          <StepShell step={stepKey}>
            <p className="cf__note">
              下面七条会<b>逐条</b>成为每一页画面的依据，也会成为画完之后核对的清单——
              画的与查的是同一份锚点，这是「每一页都是同一个他」能成立的原因。 写进来的一律是
              <b>跨页不变</b>的东西；姿势、表情、场景、光线属于每一页，不写在这里。
            </p>

            <div className="cf__card">
              {/* 七格锚点在 `fields.tsx`，与 `/character/new` 共用（顺序即 ANCHOR_SLOTS 声明序） */}
              <AnchorFields
                anchors={state.card.anchors}
                onChange={(anchors) => dispatch({ type: 'anchors', anchors })}
              />

              <div className="cf__card-preview">
                {state.card.referenceUrl ? (
                  <>
                    {/* 生成物不在 public/ 里，走 /api/assets 这个只读出口。
                        ★ 原生 <img> 是刻意的（README §五「刻意未做」那一条）：
                        图不在 public/ 下，next/image 要另配 loader */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="cf__sheet"
                      src={state.card.referenceUrl}
                      alt={`${state.child.name || '孩子'}的角色标准像`}
                    />
                    <p className="cf__card-meta">
                      第 {state.card.revision} 版 ·{' '}
                      {state.card.modelId
                        ? `这张卡是 ${state.card.modelId} 画的`
                        : '由你填的模型画出'}
                      （形象可换，锚点不变就换形象）
                    </p>
                    <div className="cf__split">
                      <div>
                        <h4>每一页会按这段画</h4>
                        <pre className="cf__pre">{state.card.promptFragment}</pre>
                      </div>
                      <div>
                        <h4>画完会按这几条核对</h4>
                        <ul className="cf__checklist">
                          {(state.card.checklist ?? []).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="cf__empty">
                    还没出形象。点下面的按钮，用你填的模型画一张标准像——
                    它会成为后面每一页的参照物。
                  </p>
                )}

                <button
                  type="button"
                  className="cf__btn cf__btn--primary"
                  disabled={card.busy}
                  onClick={() => void generateCard()}
                >
                  {card.busy ? '正在画…' : state.card.referenceUrl ? '换一版' : '出一张形象'}
                </button>
                {card.busy && (
                  <p className="cf__hint">一张标准像十几秒。这一步只画一张，不满意再换。</p>
                )}
                {card.error && (
                  <p className="cf__error" role="alert">
                    {card.error}
                    {card.retryable ? '（可以再点一次）' : ''}
                  </p>
                )}

                {/* 已有的卡：ADR-0007 说角色卡是可复用资产，"下次做新书不用重来" */}
                {existing.length > 0 && (
                  <div className="cf__reuse">
                    <h4>或者，用一张已有的角色卡</h4>
                    {existing.map((item) => (
                      <button
                        key={`${item.cardId}-r${item.revision}`}
                        type="button"
                        className="cf__reuse-item"
                        data-active={state.card.cardId === item.cardId ? 'true' : 'false'}
                        onClick={() =>
                          dispatch({
                            type: 'card-ready',
                            result: {
                              cardId: item.cardId,
                              revision: item.revision,
                              referenceUrl: assetUrlOf(item.referencePath, 768),
                              promptFragment: item.promptFragment,
                              checklist: item.checklist,
                              // ★ 用卡自己的锚点，不是表单里那份默认值（见 `card-ready.anchors`）
                              anchors: [...item.anchors],
                              modelId: item.modelId,
                            },
                          })
                        }
                      >
                        {/* 缩略图，旁边就是"第 N 版"，读屏不必再念一遍 → alt=""。
                            240 档：这张图在界面上只有 48px，原图 2.7 MB 是 280 倍浪费 */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="cf__reuse-thumb"
                          src={assetUrlOf(item.referencePath, 240)}
                          alt=""
                        />
                        <span className="cf__reuse-text">
                          {item.childId} · 第 {item.revision} 版
                          <span className="cf__reuse-sub">用 {item.modelId} 画的</span>
                        </span>
                      </button>
                    ))}
                    <p className="cf__hint">
                      同一张卡可以被很多本书引用——这就是「下次做新书不用重来」。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </StepShell>
        )}

        {stepKey === 'generate' && (
          <StepShell step={stepKey}>
            <div className="cf__run-head">
              {/* ★ 朗读会不会有，说在**生成之前**（那一刻是真话所在的地方），
                  不等书做完才发现——那是判据 ②「失败可理解」在界面上的那一半 */}
              <p className="cf__note" data-narrate={canNarrate}>
                {canNarrate
                  ? '这一本会有朗读（用的是设置里选的音色）。'
                  : '这一本不会有朗读（设置里语音没配齐）。做完的书在阅读器里会如实说明。'}
              </p>
              {/* ★ 缺什么就在这儿说，并给一个**直接打开设置**的按钮。
                  （原来这句长在"模型与密钥"那一步的末尾，而那一步已经搬进抽屉了——
                   一句指向已经不存在的位置的错误文案，比没有更糟。） */}
              {cardMissing.length > 0 && (
                <p className="cf__error" role="alert">
                  还差：{cardMissing.join('、')}。
                  <button type="button" className="cf__link" onClick={openSettings}>
                    打开模型与密钥
                  </button>
                </p>
              )}
              <Field label="这一本做多少页" hint="页数越多越久；一次出图 + 一次核对大约要一两分钟">
                <div className="cf__chips">
                  {PAGE_CHOICES.map((count) => (
                    <Chip key={count} active={pages === count} onClick={() => setPages(count)}>
                      {count} 页
                    </Chip>
                  ))}
                </div>
              </Field>
              <button
                type="button"
                className="cf__btn cf__btn--primary"
                disabled={run.phase === 'running' || !state.card.cardId}
                onClick={() => {
                  // ★ 一键之差：这里**不**抛一句"还差：文本 API key"就完事，
                  //   而是直接把设置抽屉打开——缺的东西在哪里，就把哪里打开
                  //   （原来那句错误文案指向的是创作流的第 3 步，而这一步已经搬走了）
                  if (cardMissing.length > 0) {
                    openSettings()
                    return
                  }
                  void startRun()
                }}
              >
                {run.phase === 'running'
                  ? '正在生成…'
                  : run.desk.frames.length > 0
                    ? '再做一本'
                    : '开始生成'}
              </button>
            </div>

            {run.desk.frames.length === 0 &&
              run.desk.notes.length === 0 &&
              run.phase === 'idle' && (
                <p className="cf__empty">
                  还没有开始。点「开始生成」之后，这里会摆出一排空画框，然后一页一页填上——
                  编故事、画第几页、哪一页不像正在重画。这个过程本身就是我们想给你看的东西。
                </p>
              )}

            {/* ★ 画桌替掉了原来那串 `cf__log` 文字日志。
                它说的每一件事现在都在**某一格**上（那一格自己的图、那一句"不太像"），
                重复一遍的地方只有"不属于任何一页"的那几条——它们没有格子可去，
                所以由 `Desk` 收在下面那一小块里 */}
            <Desk desk={run.desk} drawn={drawnCount(run.desk)} />

            {/* 引擎报的致命错误与传输层的收尾帧，**同一句话只说一次** */}
            {(run.fatal ?? run.desk.fatal) && (
              <p className="cf__error" role="alert">
                {run.fatal ?? run.desk.fatal}
              </p>
            )}

            {run.phase === 'running' && <p className="cf__hint">这一轮还没结束，别关这个页面。</p>}

            {run.phase === 'done' && run.bookReady && run.bookId && (
              <p className="cf__done" role="status">
                书做好了。
                <Link className="cf__done-link" href={`/reader/${run.bookId}`}>
                  翻开来看看 →
                </Link>
              </p>
            )}

            {run.phase === 'replaying' && (
              <p className="cf__warn" role="status">
                {run.serverRunning
                  ? '刷新把这条连接断了，但服务器上这一轮还在跑。等它跑完之后刷新这一页就能看到成品。'
                  : '上面是这一轮已经发生过的过程。这一轮没有跑完（刷新把连接断了），重新开始一次即可。'}
              </p>
            )}

            {run.skippedLines > 0 && (
              <p className="cf__warn">
                日志里有 {run.skippedLines} 行读不出来，已跳过（多半是上次进程被中断留下的半行）。
              </p>
            )}
          </StepShell>
        )}
      </div>

      {problems.length > 0 && (
        <p className="cf__error cf__error--block" role="alert">
          {problems.join('；')}
        </p>
      )}

      <footer className="cf__nav">
        <button
          type="button"
          className="cf__btn cf__btn--ghost"
          disabled={state.step === 1}
          onClick={() => {
            setProblems([])
            dispatch({ type: 'goto', step: state.step - 1 })
          }}
        >
          上一步
        </button>
        {state.step < STEPS.length && (
          <button
            type="button"
            className="cf__btn cf__btn--primary"
            onClick={() => {
              // 缺什么当场说清，而不是让"下一步"灰着不给理由
              const found = [...stepProblems(state, stepKey)]
              if (found.length === 0) {
                setProblems([])
                dispatch({ type: 'goto', step: state.step + 1 })
              } else {
                setProblems(found)
              }
            }}
          >
            下一步
          </button>
        )}
      </footer>
    </section>
  )
}

/* ───────────────────────── 小零件 ───────────────────────── */

/**
 * ★ `Field` / `Chip` / `toggle` / `LOOK_TAGS` 已经搬去 `fields.tsx`（工单 03 第二刀）：
 *   `/character/new` 是第二个问"他是谁"的入口了，选项与必填项有两份的那天起，
 *   两个入口会开始收不一样的孩子。这里保留 `StepShell`——它只服务于创作流的四步。
 */
function StepShell({ step, children }: { step: StepKey; children: ReactNode }) {
  const meta = STEPS.find((item) => item.key === step)
  return (
    <div className="cf__panel">
      <h2 className="cf__panel-title">{meta?.title}</h2>
      <p className="cf__panel-hint">{meta?.hint}</p>
      {children}
    </div>
  )
}
