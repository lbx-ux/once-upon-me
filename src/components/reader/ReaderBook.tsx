'use client'

/**
 * ReaderBook —— 独读版阅读器（工单 06）
 *
 * 一页一图一句，从封面翻到封底。几何**整块搬** `components/book/flip.ts`
 * （它是纯函数，当初就是为这一屏留的），一份不改。
 *
 * ---------------------------------------------------------------------------
 * 与首页第二屏那本演示书的**同与不同**
 *
 *   同：叶模型完全一样 —— 一张 3:2 的舞台、每半幅 3:4、叶绕书脊 rotateY、
 *       `--book-x` 在合着时 25%、翻开时 0、纸感靠 shade = sin(θ)；
 *       而且**一页 = 一个跨页 = 一张 3:2 的图**：左半挂上一叶的背面、右半挂下一叶的
 *       正面（`openingOf` 就是这条的推论），同一张图挂两次、靠 background-position
 *       各取一半，正文只跟左半走。
 *       ★ 这条是 2026-10-15 改对的，之前的形状是错的：每一面装的是一整页
 *         （方图在上、正文在下），于是翻开一屏是**左右各一张不同的图**。
 *         那不是绘本，是"一页图配一页字"两页并排——产品要的是首页那样：一张横图
 *         在书脊处切开，画面是连着的，左页叠正文。
 *       ★ 值得记一笔的是**改这一处没动几何**：`flip.ts` 一个字没改，舞台尺寸、
 *         `--book-x`、层序全一样。错的从来不是翻页几何，是"每一面装什么"。
 *   不同：① 驱动量不是滚动，是**翻页动作**（点、滑、键盘、页码）；
 *        ② 没有选择点、没有刻度盘（那是首页与共读版的东西）；
 *        ③ **末尾多一个合着态**：翻到头时全部叶都在左边，`--book-x` 要反向挪半幅
 *           （-25%）才让封底落在正中——首页只有开头一个合着态。
 *
 * ---------------------------------------------------------------------------
 * 三条刻意的约定，每条对应一次会真发生的事
 *
 * 1. **键盘只在容器上接**（`onKeyDown` + `tabIndex`），不在 `window` 上。
 *    首页那个已知 bug 就是 `window` 上无条件接键——书滚出屏幕照样翻页。
 *    新页面不许复制那个形状（README §五）。
 * 2. **图片按窗口挂载**：只给离当前跨页（opening）不超过一页的面挂 `background-image`。
 *    一张出图是 1536×1024 的 PNG（三兆多），20 页全挂上就是几十兆——那不是"慢一点"，
 *    是首屏根本进不去（#12 的 LCP）。
 *    ★ 左右半是**同一张图、同一个 URL**，浏览器只下一次——这也是"半页不切成两个文件"
 *      的一半理由（另一半在 flip.ts：切了之后 3:2 与 3:4 的比例就没人替你咬住了）。
 * 3. **缺口有缺口的样子**：没有图的那一页显示一张"这一页没做出来"的纸，
 *    不留裂图、不留空框（CLAUDE.md「不糊弄」）。它只出在**左半**（正文所在的那半），
 *    右半照实是一张白纸——那一页确实什么都没有。
 *
 * ---------------------------------------------------------------------------
 * 朗读（2026-10-17 起由 `use-narration.ts` 提供，两条路）
 *
 * · **我自己翻**（默认）—— 点一下念当前这一页，念完就停，页由人翻。
 * · **自动朗读** —— 按一次，从这一屏往后一页页自己念、念完自己翻；
 *   人一翻页它就停下（"翻页就停"那条规矩没变，只是多了一种走法）。
 *
 * 两个答案来自侧栏 设置 · 阅读偏好（`lib/reading-prefs.ts`），
 * 而这一屏**没有侧栏**（`(studio)` 路由组的 layout 文件头写了为什么），
 * 所以底下那行小字要说清"在哪儿改"。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flipState } from '@/components/book/flip.ts'
import { useReadingLog } from '@/lib/use-reading-log.ts'
import { useTurnMode } from '@/lib/use-reading-prefs.ts'
import {
  leafCountOf,
  openingOf,
  readerFaces,
  readoutOf,
  showsText,
  type ReaderFace,
} from './reader-model.ts'
import { useNarration } from './use-narration.ts'
import type { ReaderPage } from '@/lib/book-source.ts'

/** 每帧朝目标插值的系数。比首页第二屏的 0.12 略快：这一屏是"点一下就翻" */
const SMOOTHING = 0.16
/** 离当前跨页超过这么多页的面就不挂图（见文件头第 2 条） */
const IMAGE_WINDOW = 1.6

export type ReaderBookProps = {
  bookId: string
  title: string
  /** 封面图。null = 这本书没有封面（仓库里那本预生成的演示书就是），照实只出书名 */
  coverUrl: string | null
  pages: ReaderPage[]
  source: 'runtime' | 'demo'
}

export default function ReaderBook({ bookId, title, coverUrl, pages, source }: ReaderBookProps) {
  /**
   * 页模型（面表、叶数、opening、页码）全在 `reader-model.ts` 里，**这个组件只负责画**。
   * ★ 抽出去的理由写在那个文件头：那次返工错的不是几何，是"每一面装什么"，
   *   而那种错闸门抓不到——所以它得是一条能被断言的关系，不是散在 JSX 里的写法。
   */
  const faces = useMemo<ReaderFace[]>(() => readerFaces(pages), [pages])
  const leafCount = leafCountOf(pages)

  const [qTarget, setQTarget] = useState(0)
  const [q, setQ] = useState(0)
  const [reduced, setReduced] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  /* ── 朗读 ────────────────────────────────────────────────────────────────
   * 那一套（`speaking` / `audioFailed` / 音频元素 / 自动朗读那条链）整块在
   * `use-narration.ts` 里，与灵感书单那本样书**共用同一份**——理由写在那儿的文件头。
   * 这一层只提供两样它算不出来的东西：当前是第几屏（落定的那个），以及怎么翻页。
   */

  const { turnMode } = useTurnMode()
  /**
   * 补间**落定后**的那一屏：`0` = 封面，`leafCount` = 封底。
   * ★ 取 `Math.round(q)` 而不是 `readout.page`：后者在封面与封底都给 `null`，
   *   而自动朗读必须分得清这两端（一头是"从头念"，一头是"念完了"）。
   */
  const opening = Math.round(q)
  /** 页翻到位了没有。★ 是个布尔，所以 60fps 的 `q` 不会把它抖成每帧都变 */
  const settled = Math.abs(q - qTarget) < 0.02

  /** 第 k 屏的朗读（封面与封底不在内）。`useMemo`：不然每次渲染换一个新数组，
   *  hook 里那条链的依赖会跟着换身份，白跑一遍 */
  const narrationUrls = useMemo(() => pages.map((page) => page.audioUrl), [pages])

  const narration = useNarration({
    urls: narrationUrls,
    opening,
    settled,
    // ★ 直接把 `setQTarget` 递进去：它的身份是稳定的，而这条链会拿它当依赖。
    //   包一层匿名函数也能跑，但那个函数每次渲染都是新的，链就会每次渲染都重跑
    goTo: setQTarget,
    mode: turnMode,
  })
  // ★ `takeOver` 单独取出来：它自己是稳定的（`useCallback` 包着），而 `narration`
  //   这个对象每次渲染都是新的——`turn` 依赖前者才不会每次渲染都换身份
  const { takeOver } = narration

  /* ── 静止模式：读一次、订阅一次。reduced 下不跑补间，直接落在目标上 ───────── */

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(media.matches)
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  /* ── 补间：朝 qTarget 插值。reduced 下直接跳（不是"不翻页"，是"不播动画"） ── */

  /** 当前显示到的那一叶。★ 补间读它，不读 state：把副作用写进 setState 的更新函数里，
   *  严格模式下会起两条 rAF 链，而清理函数只知道其中一条——实测那会变成"翻页越来越快" */
  const qRef = useRef(0)

  useEffect(() => {
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
  }, [qTarget, reduced])

  const turn = useCallback(
    (delta: number) => {
      // ★ 翻页就停，这一条从第一天就在，自动朗读也没有把它推翻——
      //   只是现在有两种情形都落到它身上：
      //   · 手动模式下点“朗读”念着这一页，翻走了（念的是上一页的字，是错的）
      //   · 自动朗读这一趟正在念，人自己翻了一页 → **人接管，这一趟结束**
      //     （`takeOver()` 里那一句注释有为什么不是"声音跟着新页继续念"）
      //   ★ 自动朗读自己往下翻**不走这里**：它走 `use-narration.ts` 里的 `goTo`，
      //     否则每念完一页都会把自己关掉。
      // ★ 调的是解构出来那个 `takeOver`（身份稳定），不是 `narration.takeOver`：
      //   后者挂在每次渲染都新建的对象上，会让这个 `useCallback` 白写
      takeOver()
      setQTarget((current) => Math.min(leafCount, Math.max(0, current + delta)))
    },
    [leafCount, takeOver],
  )

  /** 焦点在容器里时，左右键与空格翻页。**不在 window 上接**（见文件头第 1 条） */
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

  /* ── 触摸滑动 ──────────────────────────────────────────────────────── */

  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (event: React.TouchEvent): void => {
    const touch = event.touches[0]
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY }
  }
  const onTouchEnd = (event: React.TouchEvent): void => {
    const start = touchStart.current
    touchStart.current = null
    const touch = event.changedTouches[0]
    if (!start || !touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    // 横向位移要明显大于纵向，否则会把"上下滚动"读成翻页
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1)
  }

  const states = useMemo(() => flipState(q, leafCount), [q, leafCount])

  /* ── 页码：当前"看着的那一页" ─────────────────────────────────────── */

  /**
   * 一屏就是一页：翻开的那一屏 = 第 near 页，所以不再是"左页几、右页几"——
   * 一屏里那两半本来就属于同一页（同一张图）。
   *
   * ★ `page` 是 `number | null`，不是拿 0 / `pages.length` 当哨兵：封底那个哨兵值
   *   **恰好等于最后一页的页码**，于是"看着封底"会被下游读成"在第 P 页"——
   *   朗读按钮亮着、`useReadingLog` 把停在封底的时间记成又读了一页。
   *   这一屏改页模型时一起修掉（推理与断言见 `reader-model.ts`）。
   */
  const readout = useMemo(() => readoutOf(q, pages), [q, pages])

  /** 这一个 opening 的面挂不挂图（见文件头第 2 条） */
  const inWindow = useCallback((opening: number) => Math.abs(opening - q) <= IMAGE_WINDOW, [q])

  /**
   * 书脊的横向偏移。首页那套是「合着时 25%、翻开时 0」，让**右半幅**落在正中；
   * 阅读器多一个**末尾**的合着态：q 到头时全部叶都翻到了左边，封底落在左半幅，
   * 所以要往反方向挪半幅（-25%）才落在正中——否则封底那一屏的右半幅是空白纸，
   * 看着像"书没合上"。两个端点在视觉上因此是对称的。
   */
  const bookX = q < 0.5 ? '25%' : q > leafCount - 0.5 ? '-25%' : '0%'

  /* ── 朗读：当前页是哪一页，以及"没有朗读"这件事怎么被说出来 ─────────────── */

  // 阅读记录（工单 05）：只算页面可见的时长，翻页才算"读过"。规则见 use-reading-log.ts
  useReadingLog(bookId, readout.page)
  const narratedCount = pages.filter((page) => page.audioUrl !== null).length

  /**
   * 出错的那一屏换算成**页码**。
   * ★ hook 报的是屏序号（第几屏），这里要的是这一页印的页号——两者只在页号
   *   恰好连续时才相等，而"恰好"不是这一条的依据（共读版的页号会跳）。
   */
  const failedPageNo =
    narration.audioFailed === null
      ? null
      : (pages[narration.audioFailed - 1]?.pageNo ?? narration.audioFailed)

  /**
   * 没有朗读控件时，**说清为什么**。放在这行小字里，因为那正是"这本书怎么了"
   * 该出现的地方（首页那条教训：宁可整节不做，也不要一个骗人的控件）。
   */
  const narrationNote =
    failedPageNo !== null
      ? `第 ${failedPageNo} 页的朗读没加载出来（音频读不到，这一页请自己念）`
      : narratedCount === 0
        ? '这本书没有朗读'
        : narratedCount < pages.length
          ? `这本书只有 ${narratedCount}/${pages.length} 页有朗读，所以没有给朗读控件——只对几页能响的按钮，证的是反面`
          : null

  /**
   * 自动朗读开着时多说一句"在哪儿改"。
   * ★ 这一屏**没有侧栏**（`(studio)` 路由组之外），所以这句话不是多嘴：
   *   不说的话，一个人只会觉得"这书怎么自己在翻"，而找不到关掉它的地方。
   * ★ 出错那一条优先（`narrationNote === null` 是前提）：那时"自动朗读开着"
   *   已经不成立了——上面那条链读到音频读不出来就把这一趟停掉了。
   */
  const autoNote =
    narration.fullyNarrated && turnMode === 'auto' && narrationNote === null
      ? '自动朗读开着（念完一页自己翻）。想自己翻，到工作台左下角的「设置」里选「我自己翻」。'
      : null

  return (
    <section
      className="reader"
      data-motion={reduced ? 'reduced' : 'full'}
      /* 有封面图 / 没有封面图，是两种版式（书名叠在图上 / 书名就是那一面）。
         ★ 写在 DOM 上而不是 CSS 里判断："这张图在不在"是数据说的事，样式不该去猜 */
      data-cover={coverUrl ? 'image' : 'plain'}
      data-source={source}
      aria-label={`${title} · 阅读器`}
    >
      <div
        className="reader__stage"
        ref={stageRef}
        tabIndex={0}
        role="group"
        aria-label="绘本翻页区（方向键或空格翻页）"
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        data-testid="reader-stage"
      >
        {/* 舞台宽 = 2 × 页宽（3:4 的一页）。--book-x 是首页那套，只是多了一个末尾的合着态 */}
        <div className="reader__book" style={{ ['--book-x' as string]: bookX }}>
          {Array.from({ length: leafCount }, (_, leaf) => {
            const state = states[leaf]
            if (!state) return null
            const front = faces[leaf * 2]
            const back = faces[leaf * 2 + 1]
            return (
              <div
                key={leaf}
                className="reader__leaf"
                style={{
                  ['--leaf-angle' as string]: `${state.angle}deg`,
                  ['--leaf-z' as string]: String(state.zIndex),
                }}
              >
                {front && (
                  <FaceView
                    face={front}
                    side="front"
                    show={inWindow(openingOf(leaf * 2))}
                    bookTitle={title}
                    coverUrl={coverUrl}
                  />
                )}
                {back && (
                  <FaceView
                    face={back}
                    side="back"
                    show={inWindow(openingOf(leaf * 2 + 1))}
                    bookTitle={title}
                    coverUrl={coverUrl}
                  />
                )}
                <i className="reader__shade" style={{ opacity: state.shade }} aria-hidden="true" />
              </div>
            )
          })}
        </div>
      </div>

      <div className="reader__bar">
        <button
          type="button"
          className="reader__btn"
          onClick={() => turn(-1)}
          disabled={qTarget === 0}
          aria-label="上一页"
        >
          ‹
        </button>
        <p className="reader__readout" aria-live="polite">
          {readout.label}
          <span className="reader__total"> · 共 {pages.length} 页</span>
        </p>
        {/* ★ 朗读按钮放在**底栏**，不是书页上：书页是 3D 旋转的叶，
            半翻状态下按钮会跟着转、点不准；而且它一旦落在 `.reader__stage` 里，
            空格键会**同时**触发它和舞台的翻页处理器（舞台的 onKeyDown 是容器级的）。
            底栏在舞台之外，这两个问题都不存在。
            ★ 文案、禁用态与 `aria-label` 来自 `use-narration.ts`：自动/手动两条路
            各有一套说法，而另一台阅读器（灵感书单那本样书）用的是**同一份** */}
        {narration.fullyNarrated && (
          <button
            type="button"
            className="reader__audio"
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
          className="reader__btn"
          onClick={() => turn(1)}
          disabled={qTarget >= leafCount}
          aria-label="下一页"
        >
          ›
        </button>
      </div>

      <div className="reader__progress" aria-hidden="true">
        <i style={{ width: `${leafCount === 0 ? 100 : (q / leafCount) * 100}%` }} />
      </div>

      {/* 朗读音频。`preload="none"`：一本 20 页的书就是两三兆，别在打开阅读器时全拉下来 */}
      <audio
        ref={narration.audioRef}
        preload="none"
        aria-hidden="true"
        onEnded={narration.onEnded}
        onError={narration.onError}
      />

      {/* 书号留在页面上：演示与排障都要能一眼说出"这是哪一本" */}
      <p className="reader__meta">
        {bookId} · {source === 'demo' ? '预生成演示书（不需要网络）' : '这一轮生成的'}
      </p>
      {narrationNote && <p className="reader__meta reader__meta--note">{narrationNote}</p>}
      {autoNote && <p className="reader__meta reader__meta--note">{autoNote}</p>}
    </section>
  )
}

/* ───────────────────────── 每一面 ───────────────────────── */

/**
 * 一面 = 一个半页。图挂在面的**背景**上（不是 `<img>`），因为要的就是
 * "同一张图挂两次、各取一半"——`data-half` 让样式表决定取哪半（见 css 那段）。
 */
function FaceView({
  face,
  side,
  show,
  bookTitle,
  coverUrl,
}: {
  face: ReaderFace
  side: 'front' | 'back'
  show: boolean
  bookTitle: string
  coverUrl: string | null
}) {
  if (face.kind === 'cover') {
    return (
      <div
        className={`reader__face reader__face--${side}`}
        style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
      >
        <div className="reader__cover">
          <h1 className="reader__title">{bookTitle}</h1>
        </div>
        <p className="reader__hint">用 → ← 或点右下角翻页</p>
      </div>
    )
  }

  if (face.kind === 'back') {
    return (
      <div className={`reader__face reader__face--${side}`}>
        <div className="reader__back">
          <p className="reader__back-line">读完啦</p>
          <p className="reader__back-sub">每一页，都是同一个他。</p>
        </div>
      </div>
    )
  }

  const { page, half } = face
  const art =
    !page.missing && show && page.imageUrl
      ? { backgroundImage: `url(${page.imageUrl})` }
      : undefined
  return (
    <div className={`reader__face reader__face--${side}`}>
      {!page.missing && (
        // 图单独一层，而不是挂在 `.reader__face` 上：`role="img"` 会把**子树整个**
        // 从辅助技术里摘掉，挂在外层就把同一面里的正文也一起摘了。
        // ★ 只有**左半**报出这一页的插画，右半 `aria-hidden`：两半是同一张图，
        //   两边都报，屏读会把同一页念两遍。
        <div
          className="reader__half"
          data-half={half}
          style={art}
          {...(half === 'left'
            ? { role: 'img' as const, 'aria-label': `第 ${page.pageNo} 页的插画` }
            : { 'aria-hidden': true as const })}
        />
      )}
      {page.missing && half === 'left' && (
        // 缺图这一页的兜底：一张写清"为什么这里没有画"的纸，不是裂图。
        // ★ 只出在左半：两半都出就是同一句话说两遍（一屏里并排两个虚线框），
        //   而右半照实是一张白纸——那一页确实什么都没有
        <div className="reader__missing">
          <span className="reader__missing-no">第 {page.pageNo} 页</span>
          <span>这一页没做出来</span>
        </div>
      )}
      {/* 正文只跟**左半**走（判据在 `reader-model.ts` 的 `showsText`），位置与出图时
          那条"左下方留出干净区"的构图约束对齐（见 css） */}
      {showsText(face) && (
        <div className="reader__text">
          {page.body.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}
