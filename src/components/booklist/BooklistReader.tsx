'use client'

/**
 * BooklistReader —— 灵感书单那 12 本样书的阅读器
 *
 * 一跨页 = 一张图。这是这一屏与 `/reader/[bookId]` 那台阅读器唯一但根本的差别
 *
 *   翻开一屏 = 1 张 3:2 的连续画面，横跨左右两个书页，正文叠在左页下角 ——
 *   与首页第二屏那本《小宇的云》同一个形状（也是用户 2026-10-15 明确要的那个形状）。
 *   8 个跨页 = 16 个书页。
 *
 *   半页不切文件：同一张图挂两次，靠 `background-size: 200% 100%` +
 *     `background-position` 各取一半（`book/flip.ts` 顶部那段叶模型）。所以这一屏
 *     不会出现"一页两张图"——那是一张图跨两个书页。
 *   另一台阅读器（`reader/ReaderBook.tsx`）那一屏是"一页一图一句"那条产品定义的形状。
 *     两台不吃同一份 DOM，也不共用样式的类名；**共用的只有 `reader/use-narration.ts`**
 *     那一份朗读逻辑（含 2026-10-17 的自动朗读）——两份会漂成两个脾气的是行为，
 *     不是长相，所以分界线画在这里。
 *
 * 四条实现上的讲究，每条对应一处真会发生的错
 *
 * 1. **几何整块搬 `book/flip.ts`**，一行不改。叶表：8 个跨页 → 9 叶
 *    （L0 正面=封面、背面=S1 左半 … L8 背面=封底）。
 * 2. 键盘只在容器上接（`tabIndex` + `onKeyDown`），不上 `window`——
 *    首页那个 `window` 无条件接键的已知 bug 不复制（`ReaderBook.tsx` 文件头第 1 条）。
 * 3. 图按窗口挂载：只给离当前 q 不超过一叶的面挂 `background-image`。
 *    一张跨页 1536×1024，9 叶全挂上在自动播放式的连翻里会卡。
 * 4. 缺图有缺图的样子：那一页显示一张写着"这一页的画还没到位"的纸 + 主题 emoji，
 *    不留裂图、不留空框（CLAUDE.md「不糊弄」；emoji 兜底那套沿用书里的做法）。
 *
 * 朗读则照 `ReaderBook.tsx` 判据 ① 那条：8 段音频全在才给控件。
 * 一本只有 5 段能响的书，那个按钮证的是反面。
 *
 * 2026-10-18 晚：这一屏只剩底图与书。
 *   用户看了铺满整屏的那一版说「把书籍四周的仿真书效果删掉吧，只有背景就行」，
 *   并选了"连书页明暗也删"那一档。于是书周围四层全删：桌上的暖光
 *   `.blr__light`、随页染色 `.blr__tint`（连它那张离线色表 `booklistTints.ts`）、
 *   书底下的两层接触影、书页内侧的明暗 `.blr__shade`。
 *   于是 `flip.ts` 交出来的 `shade`（纸感 = sin θ）这一屏不再用 ——
 *     首页第二屏仍在用，那边一个字没动。翻页看起来就是"图在换"，没有纸张的
 *     厚度与弯折；这是点过头的取舍，不是漏渲染。
 *   同一处删除也把 `.blr` 上那条 `overflow-x: clip` 带走了：它当初是为了挡住
 *     暖光/染色负 inset 的外溢（390×844 上 `scrollWidth = 444`），外溢的东西没了，
 *     那条补丁的理由也就没了。
 *   与朗读那一套不同：这四层是删掉，不是"留着不跑"——
 *     `chk-reader-desk.mjs` 里量染色的四条判据跟着一起删了（不糊弄那一节）。
 *
 * 朗读那一套（含"自动朗读"这一趟）2026-10-17 起搬去 `reader/use-narration.ts`：
 * 两台的类名不同、屏的口径也不同（这边一个跨页 = 两页），但行为必须一样——
 * 侧栏那个阅读偏好说的是"两个阅读器都算"。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { flipState } from '@/components/book/flip.ts'
import FullscreenButton from '@/components/reader/FullscreenButton.tsx'
import { useNarration } from '@/components/reader/use-narration.ts'
import { useSwipeTurn } from '@/components/reader/use-swipe-turn.ts'
import { useReaderPaper, useTurnMode } from '@/lib/use-reading-prefs.ts'
import { THEMES } from '@/lib/themes.ts'

import { SPREADS_PER_BOOK, PAPER_PAGES_PER_BOOK, type BooklistBook } from './booklist.ts'

/** 每帧朝目标插值的系数。与 `/reader` 那台同一个数：这一屏也是"点一下就翻" */
const SMOOTHING = 0.16
/** 离当前 q 超过这么多叶的面就不挂图（见文件头第 3 条） */
const IMAGE_WINDOW = 1.6

const THEME_BY_KEY = new Map(THEMES.map((theme) => [theme.key, theme]))

/**
 * 面表。与 `flip.ts` 的叶表咬死：叶 k 的正面是 `faces[2k]`、背面是 `faces[2k+1]`。
 *
 *   L0 封面 / S1左    L1 S1右 / S2左    …    L8 S8右 / 封底
 */
type Face =
  { kind: 'cover' } | { kind: 'back' } | { kind: 'half'; spread: number; side: 'left' | 'right' }

function buildFaces(): Face[] {
  const faces: Face[] = [{ kind: 'cover' }]
  for (let spread = 1; spread <= SPREADS_PER_BOOK; spread++) {
    // 左半在前：它在上一叶的背面，右半在同一叶的正面（见上面那张叶表）
    faces.push({ kind: 'half', spread, side: 'left' })
    faces.push({ kind: 'half', spread, side: 'right' })
  }
  faces.push({ kind: 'back' })
  return faces
}

export type BooklistReaderProps = {
  book: BooklistBook
  /** 3:4 的封面。`null` = 还没画（露一张写着书名的纸，不是空框） */
  coverUrl: string | null
  /** 8 项，下标 0 = 第 1 个跨页。`null` = 这一跨页的画还没到位 */
  art: (string | null)[]
  /** 8 项，与 `art` 同名同序。`null` = 这一段还没有录音 */
  audio: (string | null)[]
}

export default function BooklistReader({ book, coverUrl, art, audio }: BooklistReaderProps) {
  const faces = useMemo(buildFaces, [])
  const leafCount = faces.length / 2

  const [qTarget, setQTarget] = useState(0)
  const [q, setQ] = useState(0)
  const [reduced, setReduced] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const qRef = useRef(0)

  const theme = THEME_BY_KEY.get(book.key)

  /* 朗读
   * 整块在 `reader/use-narration.ts` 里，与 `/reader/<bookId>` 那台共用同一份
   * （文件头那段写了为什么）。这一层只提供两样它算不出来的东西：
   * 当前是第几屏（落定的那个），以及怎么翻页。
   */

  const { turnMode } = useTurnMode()
  /** §桌面那一层铺哪张底图。★ 只在设置里选（不在这屏），所以它照 useTurnMode 的分法读 */
  const { paper } = useReaderPaper()
  /** 落定后的那一屏：`0` = 封面，`leafCount` = 封底（= 跨页数 + 1） */
  const opening = Math.round(q)
  /** 页翻到位了没有。★ 是个布尔，所以 60fps 的 `q` 不会把它抖成每帧都变 */
  const settled = Math.abs(q - qTarget) < 0.02

  const narration = useNarration({
    urls: audio,
    opening,
    settled,
    // 直接把 `setQTarget` 递进去：它的身份是稳定的（见 `ReaderBook` 里那条注释）
    goTo: setQTarget,
    mode: turnMode,
  })
  /** 单独取出来：`narration` 每次渲染都是新对象，而 `turn` 的依赖要的是稳定身份 */
  const { takeOver } = narration

  /* 静止模式：读一次、订阅一次。reduced 下不跑补间，直接落在目标上 */

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(media.matches)
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  /* 补间 */

  /**
   * 手指拖动期间直接写 q（2026-10-19 移动端适配）。
   * 跟手的全部机制：补间那条链是"朝 `qTarget` 插值"，而拖动要的是"手到哪儿
   *   画面到哪儿"，所以拖动期间绕开它直接写；松手再交回去
   *   （见 `use-swipe-turn.ts` 文件头末尾那条契约）。两个写者同时写 q 就是画面抖。
   */
  const writeQ = useCallback((value: number) => {
    qRef.current = value
    setQ(value)
  }, [])

  /* 手指跟手翻页
   * 整套在 `reader/use-swipe-turn.ts` 里，与 `/reader/<bookId>` 那台共用同一份
   * （理由写在那儿的文件头）。这一层交三样：舞台、上界（这一台就是 `leafCount`）、
   * 以及"人已经在翻页了，朗读停下"。
   */
  const swipe = useSwipeTurn({
    stageRef,
    qRef,
    write: writeQ,
    settle: setQTarget,
    maxTarget: leafCount,
    onTakeOver: takeOver,
  })
  const { dragging } = swipe

  useEffect(() => {
    /* 手指正按着的时候不起这条链（见 `writeQ` 上面那条契约）：
       拖动一开始 `dragging` 变真 → 这个 effect 重跑、旧 rAF 被掐掉；
       松手后它再跑一遍，带着新的 `qTarget` 从当前的 q 平滑收尾。 */
    if (dragging) return
    if (reduced) {
      qRef.current = qTarget
      setQ(qTarget)
      return
    }
    let raf = 0
    let last = performance.now()
    const frame = (now: number): void => {
      const dt = Math.min(64, now - last)
      last = now
      const next = qRef.current + (qTarget - qRef.current) * Math.min(1, (dt / 16) * SMOOTHING)
      if (Math.abs(qTarget - next) < 0.002) {
        qRef.current = qTarget
        setQ(qTarget)
        return
      }
      qRef.current = next
      setQ(next)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [qTarget, reduced, dragging])

  const turn = useCallback(
    (delta: number) => {
      // 翻页就停：朗读属于"你正看着的那一跨页"，翻走了还在念上一段是错的。
      // 自动朗读那一趟正在念时人自己翻页 = 人接管，这一趟结束
      //   （`takeOver()` 里的注释写了为什么不是"声音跟着新页继续念"）。
      //   自动朗读自己往下翻不走这里：它走 hook 里的 `goTo`，
      //     否则每念完一页都会把自己关掉。
      takeOver()
      setQTarget((current) => Math.min(leafCount, Math.max(0, current + delta)))
    },
    [leafCount, takeOver],
  )

  /** 焦点在容器里时，左右键与空格翻页。不在 window 上接（见文件头第 2 条） */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault()
        turn(1)
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        turn(-1)
      } else if (event.key === 'Home') {
        setQTarget(0)
      } else if (event.key === 'End') {
        setQTarget(leafCount)
      }
    },
    [turn, leafCount],
  )

  /* 触摸滑动
   * 2026-10-19：这一段原来住在这里（"划 44px 松手才翻一页"），现在整块搬去
   * `reader/use-swipe-turn.ts` 并改成跟手——两台阅读器共用同一份，
   * 理由在那儿的文件头。这里不再留半截。
   */

  const states = useMemo(() => flipState(q, leafCount), [q, leafCount])

  /* 页码：读作**书页号**（8 个跨页 = 16 页），与"一本至少 16 页"同一个口径 */

  /**
   * 只剩一个字符串，不再带 `spread` 那个字段：翻页这件事现在归 `opening`
   *   （hook 用它），而旧那份里封底给的是 `spread: 0`——0 既不是"没有跨页"
   *   也不是"第 0 个跨页"，正是一个会被下游读成别的东西的哨兵值
   *   （`reader-model.ts` 的 `readoutOf` 为同一类坑记过一次账）。
   */
  const readout = useMemo(() => {
    if (opening <= 0) return '封面'
    if (opening >= leafCount) return '封底'
    const first = opening * 2 - 1
    return `第 ${first}–${first + 1} 页`
  }, [opening, leafCount])

  const showImage = useCallback((leaf: number) => Math.abs(leaf - q) <= IMAGE_WINDOW, [q])

  /**
   * 书脊的横向偏移。首页那套是"合着时 25%、翻开时 0"（让右半幅落在正中）；
   * 这一屏多一个末尾的合着态：q 到头时全部叶都翻到了左边、封底落在左半幅，
   * 要往反方向挪半幅（-25%）才落在正中。
   */
  const bookX = q < 0.5 ? '25%' : q > leafCount - 0.5 ? '-25%' : '0%'

  const narratedCount = audio.filter((url) => url !== null).length

  /** 没有朗读控件时说清为什么（与 `/reader` 那条同一个写法，宁可不给也不骗人） */
  const narrationNote =
    narration.audioFailed !== null
      ? // hook 报的就是屏序号，这一屏的口径正好也是"第几个跨页"——不用换算
        `第 ${narration.audioFailed} 个跨页的朗读没加载出来（音频读不到，这一页请自己念）`
      : narratedCount === 0
        ? '这本书还没有录朗读'
        : narratedCount < SPREADS_PER_BOOK
          ? `这本书只有 ${narratedCount}/${SPREADS_PER_BOOK} 段有朗读，所以没有给朗读控件——只对几段能响的按钮，证的是反面`
          : null

  /**
   * 自动朗读开着时多说一句"在哪儿改"。
   * 与 `/reader` 那条同一个理由：这一屏也没有侧栏，那句话不是多嘴。
   * 出错那一条优先（`narrationNote === null` 是前提）：那时这一趟已经被停掉了
   *   （`use-narration.ts` 读到音频读不出来就不往下走）。
   */
  const autoNote =
    narration.fullyNarrated && turnMode === 'auto' && narrationNote === null
      ? '自动朗读开着（念完一页自己翻）。想自己翻，到工作台左下角的「设置」里选「我自己翻」。'
      : null

  return (
    <section
      className="blr"
      data-motion={reduced ? 'reduced' : 'full'}
      aria-label={`《${book.title}》· 样书阅读器`}
    >
      {/* §桌面那一层底图（`booklist-reader.css`）。`fixed; inset: 0` —— 铺的是**整块视口**，
          不再是一条收在书附近的横幅（用户 2026-10-18：「背景铺平整个屏幕呀」）。
          ★ 它现在**盖得到**上面那行「← 回灵感书单」：那一行在 `.reader-page` 里，
            够不到这个 div，所以它自己靠 `position: relative` 站上来（`globals.css`）。
          图是用户在设置里挑的那一张（`lib/reader-paper.ts`）：走 CSS 变量塞进来，
          `纯色` 那一档是空的（不设变量 → 这一层没有图）。
          纯装饰，对辅助技术整块隐藏。 */}
      <div
        className="blr__desk"
        data-paper={paper.key}
        style={
          paper.url
            ? ({ ['--blr-paper' as string]: `url(${paper.url})` } as React.CSSProperties)
            : undefined
        }
        aria-hidden="true"
      />

      <div
        className="blr__stage"
        ref={stageRef}
        tabIndex={0}
        role="group"
        aria-label="绘本翻页区（方向键或空格翻页）"
        onKeyDown={onKeyDown}
        /* 手指跟手翻页那四个处理器整块来自 `reader/use-swipe-turn.ts`
           （`onTouchCancel` 也要接：来电、系统手势打断时不接住的话，
           画面会停在半翻的那一帧上）。 */
        onTouchStart={swipe.onTouchStart}
        onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd}
        onTouchCancel={swipe.onTouchCancel}
        data-testid="booklist-stage"
      >
        {/* 舞台宽 = 2 × 页宽（3:4 的一页），合起来正好 3:2 —— 一张跨页图铺满两页 */}
        <div className="blr__book" style={{ ['--book-x' as string]: bookX }}>
          {Array.from({ length: leafCount }, (_, leaf) => {
            const state = states[leaf]
            if (!state) return null
            const front = faces[leaf * 2]
            const back = faces[leaf * 2 + 1]
            return (
              <div
                key={leaf}
                className="blr__leaf"
                style={{
                  ['--leaf-angle' as string]: `${state.angle}deg`,
                  ['--leaf-z' as string]: String(state.zIndex),
                }}
              >
                {front && (
                  <FaceView
                    face={front}
                    side="front"
                    show={showImage(leaf)}
                    book={book}
                    emoji={theme?.emoji ?? '📖'}
                    coverUrl={coverUrl}
                    art={art}
                  />
                )}
                {back && (
                  <FaceView
                    face={back}
                    side="back"
                    show={showImage(leaf)}
                    book={book}
                    emoji={theme?.emoji ?? '📖'}
                    coverUrl={coverUrl}
                    art={art}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="blr__bar">
        <button
          type="button"
          /* 两颗翻页钮带明确的修饰类（`--prev` / `--next`），不是靠 `:first-of-type`：
             手机横屏那一档要把它们分别摆进左右两条页边（`booklist-reader.css` §手机横屏），
             而"第几个孩子"这种写法在朗读钮缺席（没录朗读的书）那天会静悄悄地错位——
             与 `.reader__meta--origin` 那条注释同一条理由。 */
          className="blr__btn blr__btn--prev"
          onClick={() => turn(-1)}
          disabled={qTarget === 0}
          aria-label="上一页"
        >
          ‹
        </button>
        <p className="blr__readout" aria-live="polite">
          {readout}
          <span className="blr__total"> · 共 {PAPER_PAGES_PER_BOOK} 页</span>
        </p>
        {/* 文案、禁用态与 `aria-label` 来自 `use-narration.ts`：这一屏与
            `/reader/<bookId>` 那台**共用同一份**（文件头那段写了为什么） */}
        {narration.fullyNarrated && (
          <button
            type="button"
            className="blr__audio"
            onClick={narration.toggle}
            disabled={narration.button.disabled}
            aria-pressed={narration.button.pressed}
            aria-label={narration.button.ariaLabel}
          >
            {narration.button.label}
          </button>
        )}
        <button
          type="button"
          className="blr__btn blr__btn--next"
          onClick={() => turn(1)}
          disabled={qTarget >= leafCount}
          aria-label="下一页"
        >
          ›
        </button>
        {/* 全屏那一颗（只解决"手机横屏时地址栏吃掉的那一条"）。
            它自己不写版面：摆哪儿由 `fullscreen-button.css` 说了算，
            横屏时这一档的网格里正好是右上那一格。 */}
        <FullscreenButton />
      </div>

      <div className="blr__progress" aria-hidden="true">
        <i style={{ width: `${(q / leafCount) * 100}%` }} />
      </div>

      {/* 朗读音频。`preload="none"`：8 段音频不该在打开这一屏时全拉下来 */}
      <audio
        ref={narration.audioRef}
        preload="none"
        aria-hidden="true"
        onEnded={narration.onEnded}
        onError={narration.onError}
      />

      <p className="blr__meta">
        《{book.title}》 · {theme?.label ?? book.key}主题的样书 · {SPREADS_PER_BOOK} 个跨页（
        {PAPER_PAGES_PER_BOOK} 页）
      </p>
      {narrationNote && <p className="blr__meta blr__meta--note">{narrationNote}</p>}
      {autoNote && <p className="blr__meta blr__meta--note">{autoNote}</p>}
    </section>
  )
}

/* 每一面 */

function FaceView({
  face,
  side,
  show,
  book,
  emoji,
  coverUrl,
  art,
}: {
  face: Face
  side: 'front' | 'back'
  show: boolean
  book: BooklistBook
  emoji: string
  coverUrl: string | null
  art: (string | null)[]
}) {
  const cls = `blr__face blr__face--${side}`

  if (face.kind === 'cover') {
    return (
      <div
        className={`${cls} blr__face--cover`}
        style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
      >
        <div className="blr__cover">
          <h1 className="blr__title">{book.title}</h1>
          <p className="blr__hint">用 → ← 或点右下角翻页</p>
        </div>
        {!coverUrl && (
          <span className="blr__glyph" aria-hidden="true">
            {emoji}
          </span>
        )}
      </div>
    )
  }

  if (face.kind === 'back') {
    return (
      <div className={cls}>
        <div className="blr__back">
          <p className="blr__back-line">完</p>
          <p className="blr__back-sub">《{book.title}》 · 12 本样书之一</p>
        </div>
      </div>
    )
  }

  const url = art[face.spread - 1] ?? null
  const first = face.spread * 2 - 1
  const spread = book.spreads[face.spread - 1]

  return (
    <div
      className={cls}
      data-half={face.side}
      // 图按窗口挂载（见文件头第 3 条）。没图时这里什么都不挂，露的是纸色
      style={show && url ? { backgroundImage: `url(${url})` } : undefined}
    >
      {/* 缺图：**只在左半**说这件事。右半留一张干净的纸，合起来读作"这一跨页还是一张白纸" */}
      {!url && face.side === 'left' && (
        <div className="blr__missing">
          <span className="blr__glyph" aria-hidden="true">
            {emoji}
          </span>
          <span className="blr__missing-no">
            第 {first}–{first + 1} 页
          </span>
          <span>这一页的画还没到位</span>
        </div>
      )}

      {/* 正文只跟着**左半**走：右半是同一张图的另一半，不该重复出字（与首页同一条） */}
      {face.side === 'left' && spread && (
        <div className="blr__text">
          {spread.text.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}
