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
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { describeEvent, isDisplayable, type EngineEvent } from '@/lib/engine/events.ts'
import {
  AGE_BANDS,
  ANCHOR_LABELS,
  ANCHOR_SLOTS,
  ANCHOR_STRENGTH,
  type AnchorSlot,
} from '@/lib/engine/domain.ts'
import { THEMES } from '@/lib/themes'
import {
  ApiError,
  createBook,
  createCard,
  listCards,
  replayFrames,
  type CardSummary,
} from '@/lib/creation/api.ts'
import { anchorsWith } from '@/lib/creation/default-anchors.ts'
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

const LOOK_TAGS = ['短发', '圆脸', '爱笑', '戴眼镜', '马尾', '小酒窝', '高个', '瘦小']
const INTEREST_TAGS = ['恐龙', '画画', '足球', '小猫', '太空', '云', '船', '音乐']

/** 刷新后接着看的那一条指针。**只有书号与页数**——任何凭据都不进这里 */
const LAST_RUN_KEY = 'once-upon-me:last-run'
/** 产品定义的独读版是 20 页；演示要能缩小规模，所以它是可选的 */
const PAGE_CHOICES = [5, 8, 12, 20]

type CardState = {
  busy: boolean
  error: string | null
  retryable: boolean
}

type RunRow = { key: string; text: string; tone: 'info' | 'ok' | 'warn' | 'bad' }

type RunState = {
  phase: 'idle' | 'running' | 'done' | 'failed' | 'replaying'
  rows: RunRow[]
  bookId: string | null
  /** 收尾帧说的两件事：服务端还在跑吗、成品在不在 */
  serverRunning: boolean
  bookReady: boolean
  skippedLines: number
  fatal: string | null
}

const EMPTY_RUN: RunState = {
  phase: 'idle',
  rows: [],
  bookId: null,
  serverRunning: false,
  bookReady: false,
  skippedLines: 0,
  fatal: null,
}

type Action =
  | { type: 'goto'; step: number }
  | { type: 'child'; patch: Partial<CreationState['child']> }
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
    case 'theme':
      return { ...state, theme: { ...state.theme, ...action.patch } }
    case 'anchors':
      return { ...state, card: { ...state.card, anchors: action.anchors } }
    case 'card-ready':
      return { ...state, card: { ...state.card, ...action.result } }
  }
}

/** 一条事件 → 一行（该不该占行、写什么话，都由引擎决定；这里只定"长什么样"） */
function rowsOf(events: readonly EngineEvent[]): RunRow[] {
  const rows: RunRow[] = []
  for (const event of events) {
    if (!isDisplayable(event)) continue
    rows.push({
      key: `e${event.seq}`,
      text: describeEvent(event),
      tone: toneOf(event),
    })
  }
  return rows
}

function toneOf(event: EngineEvent): RunRow['tone'] {
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

export type CreateFlowProps = {
  /** 工作台主题模板带进来的那个 key（`?theme=dino`）。只当**初值**用，之后由用户说了算 */
  initialThemeKey?: string
  /** 工作台「创作」那一屏写的那句话（`?wish=…`）。同样是初值，不是第二套表单 */
  initialWish?: string
  /** 工作台「小主角」那一格挑的卡（`?card=…`）。兑现的是 ADR-0007 的可复用 */
  initialCardId?: string
}

export default function CreateFlow({
  initialThemeKey,
  initialWish,
  initialCardId,
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
          rows: rowsOf(events),
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

  /* ── 第 4 步：已有的卡（ADR-0007 的可复用） ───────────────────────────── */

  const [existing, setExisting] = useState<CardSummary[]>([])
  useEffect(() => {
    void listCards().then(setExisting)
  }, [])

  /* ── 工作台「小主角」那一格带进来的卡：预置成"就用这张" ─────────────────── */

  // ★ 只在**第一次**拿到卡列表时应用：它是初值，不是一条持续生效的规则。
  //   持续应用会把用户后来自己换的那张卡又抢回去（实测过同类 bug：
  //   参数驱动的初值写成"每次都对齐参数"，用户改不动那个字段）。
  const seededCard = useRef(false)
  useEffect(() => {
    if (!initialCardId || seededCard.current || existing.length === 0) return
    seededCard.current = true
    const item = existing.find((each) => each.cardId === initialCardId)
    if (!item) {
      // 认不出来（卡删了、或地址是手打的）：说清楚为什么，然后让这一步照原样工作。
      //   ★ 不静默当成"没带参数"——那会让人以为选了就是选了
      setCard({
        busy: false,
        error: `找不到角色卡 ${initialCardId}，大概是删过了。现出一张就行。`,
        retryable: false,
      })
      return
    }
    dispatch({
      type: 'card-ready',
      result: {
        cardId: item.cardId,
        revision: item.revision,
        referenceUrl: item.referenceUrl,
        promptFragment: item.promptFragment,
        checklist: item.checklist,
        modelId: item.modelId,
      },
    })
  }, [existing, initialCardId])

  /* ── 第 4 步：出一张形象 ─────────────────────────────────────────────── */

  const generateCard = useCallback(async () => {
    setCard({ busy: true, error: null, retryable: false })
    try {
      const result = await createCard(toCardBody(state, settingsEnv))
      dispatch({ type: 'card-ready', result })
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
          setRun((prev) => ({ ...prev, rows: rowsOf(events) }))
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

  const anchorsBySlot = useMemo(() => {
    const map = new Map<AnchorSlot, string>()
    for (const anchor of state.card.anchors) map.set(anchor.slot, anchor.value)
    return map
  }, [state.card.anchors])

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
            <Field label="孩子的名字" required>
              <input
                className="cf__input"
                value={state.child.name}
                maxLength={20}
                placeholder="小宇"
                onChange={(event) =>
                  dispatch({ type: 'child', patch: { name: event.target.value } })
                }
              />
            </Field>

            <Field label="名字怎么读" required hint="多音字最容易念错——「乐乐」是 lè 还是 yuè">
              <input
                className="cf__input"
                value={state.child.nameReading}
                maxLength={20}
                placeholder="yǔ"
                onChange={(event) =>
                  dispatch({ type: 'child', patch: { nameReading: event.target.value } })
                }
              />
            </Field>

            <Field label="年龄" required>
              <div className="cf__chips">
                {AGE_BANDS.map((band) => (
                  <Chip
                    key={band}
                    active={state.child.ageBand === band}
                    onClick={() => dispatch({ type: 'child', patch: { ageBand: band } })}
                  >
                    {band === '4-' ? '不到 4 岁' : band === '8+' ? '8 岁以上' : `${band} 岁`}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="他长什么样" hint="多选，用来生成形象">
              <div className="cf__chips">
                {LOOK_TAGS.map((tag) => (
                  <Chip
                    key={tag}
                    active={state.child.lookTags.includes(tag)}
                    onClick={() =>
                      dispatch({
                        type: 'child',
                        patch: { lookTags: toggle(state.child.lookTags, tag) },
                      })
                    }
                  >
                    {tag}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="他喜欢什么" hint="多选，故事会用到">
              <div className="cf__chips">
                {INTEREST_TAGS.map((tag) => (
                  <Chip
                    key={tag}
                    active={state.child.interestTags.includes(tag)}
                    onClick={() =>
                      dispatch({
                        type: 'child',
                        patch: { interestTags: toggle(state.child.interestTags, tag) },
                      })
                    }
                  >
                    {tag}
                  </Chip>
                ))}
              </div>
            </Field>

            <p className="cf__note cf__note--muted">
              这一版还没有「上传孩子的照片」这一格：我们用的图像接口不支持参考图
              （实测七个候选字段名全被平台挡回），传上来的照片没有消费方。
              形象由后面「角色卡」那一步的七条外貌描述决定——改一条描述就换一版。
              没有的东西直说没有，比摆一个传上去没用的框好。
            </p>
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
              <div className="cf__card-form">
                {ANCHOR_SLOTS.map((slot) => (
                  <Field
                    key={slot}
                    label={ANCHOR_LABELS[slot]}
                    hint={
                      ANCHOR_STRENGTH[slot] === 'hard'
                        ? '硬锚点：每页都要对上'
                        : '软锚点：允许合理变化'
                    }
                  >
                    <input
                      className="cf__input"
                      value={anchorsBySlot.get(slot) ?? ''}
                      onChange={(event) =>
                        dispatch({
                          type: 'anchors',
                          anchors: anchorsWith(state.card.anchors, slot, event.target.value),
                        })
                      }
                    />
                  </Field>
                ))}
              </div>

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
                              referenceUrl: item.referenceUrl,
                              promptFragment: item.promptFragment,
                              checklist: item.checklist,
                              modelId: item.modelId,
                            },
                          })
                        }
                      >
                        {/* 缩略图，旁边就是"第 N 版"，读屏不必再念一遍 → alt="" */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="cf__reuse-thumb" src={item.referenceUrl} alt="" />
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
                  : run.rows.length > 0
                    ? '再做一本'
                    : '开始生成'}
              </button>
            </div>

            {run.rows.length === 0 && run.phase === 'idle' && (
              <p className="cf__empty">
                还没有开始。点「开始生成」之后，这里会一条一条写出它正在做什么——
                编故事、画第几页、哪一页不像正在重画。这个过程本身就是我们想给你看的东西。
              </p>
            )}

            {run.rows.length > 0 && (
              <ol className="cf__log" aria-live="polite">
                {run.rows.map((row) => (
                  <li key={row.key} className="cf__log-row" data-tone={row.tone}>
                    {row.text}
                  </li>
                ))}
              </ol>
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

            {run.fatal && (
              <p className="cf__error" role="alert">
                {run.fatal}
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

/* ───────────────────────── 小零件（只在这个文件里用） ───────────────────────── */

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

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="cf__field">
      <span className="cf__label">
        {label}
        {required && <span className="cf__req">必填</span>}
      </span>
      {hint && <span className="cf__field-hint">{hint}</span>}
      {children}
    </label>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="cf__chip"
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}
