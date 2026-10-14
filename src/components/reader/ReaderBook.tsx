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
 *       `--book-x` 在合着时 25%、翻开时 0、纸感靠 shade = sin(θ)。
 *   不同：① 驱动量不是滚动，是**翻页动作**（点、滑、键盘、页码）；
 *        ② 每一面装的不是"跨页图的一半"，而是**一整页**：方形插画在上、正文在下；
 *        ③ 没有选择点、没有刻度盘（那是首页与共读版的东西）；
 *        ④ **末尾多一个合着态**：翻到头时全部叶都在左边，`--book-x` 要反向挪半幅
 *           （-25%）才让封底落在正中——首页只有开头一个合着态。
 *
 * ---------------------------------------------------------------------------
 * 三条刻意的约定，每条对应一次会真发生的事
 *
 * 1. **键盘只在容器上接**（`onKeyDown` + `tabIndex`），不在 `window` 上。
 *    首页那个已知 bug 就是 `window` 上无条件接键——书滚出屏幕照样翻页。
 *    新页面不许复制那个形状（README §五）。
 * 2. **图片按窗口挂载**：只给离当前 q 不超过一叶的面挂 `background-image`。
 *    一页是 1440² 的 PNG（三兆多），20 页全挂上就是几十兆——那不是"慢一点"，
 *    是首屏根本进不去（#12 的 LCP）。
 * 3. **缺口有缺口的样子**：没有图的那一页显示一张"这一页没做出来"的纸，
 *    不留裂图、不留空框（CLAUDE.md「不糊弄」）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flipState } from '@/components/book/flip.ts'
import { useReadingLog } from '@/lib/use-reading-log.ts'
import type { ReaderPage } from '@/lib/book-source.ts'

/** 每帧朝目标插值的系数。比首页第二屏的 0.12 略快：这一屏是"点一下就翻" */
const SMOOTHING = 0.16
/** 离当前 q 超过这么多叶的面就不挂图（见文件头第 2 条） */
const IMAGE_WINDOW = 1.6

type Face = { kind: 'cover' } | { kind: 'back' } | { kind: 'page'; page: ReaderPage }

export type ReaderBookProps = {
  bookId: string
  title: string
  pages: ReaderPage[]
  source: 'runtime' | 'demo'
}

export default function ReaderBook({ bookId, title, pages, source }: ReaderBookProps) {
  /** 面表：封面 + 每一页 + 封底。叶 k 的正面是 faces[2k]、背面是 faces[2k+1] */
  const faces = useMemo<Face[]>(
    () => [
      { kind: 'cover' },
      ...pages.map((page): Face => ({ kind: 'page', page })),
      { kind: 'back' },
    ],
    [pages],
  )
  const leafCount = Math.ceil(faces.length / 2)

  const [qTarget, setQTarget] = useState(0)
  const [q, setQ] = useState(0)
  const [reduced, setReduced] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  /* ── 朗读（工单 08）────────────────────────────────────────────────────── */

  /** 正在朗读的页码（null = 没在放）。★ 朗读属于"你正在看的那一页"，翻页就停 */
  const [speaking, setSpeaking] = useState<number | null>(null)
  /** 加载失败的那一页。**要说出来**，不许静默没声（工单 08 §一 判据 ②） */
  const [audioFailed, setAudioFailed] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  /**
   * ★ 判据 ①「要么整本都能响」（工单 08 §一）：**只要有一页没有朗读，这个控件就不出现**。
   *   理由与首页拆掉播放条同源——一个只对几分之一能响的按钮，证的是这一页想证的反面。
   *   所以这里不"按页显示/隐藏"，是**整本都行才给控件**。
   */
  const fullyNarrated = useMemo(
    () => pages.length > 0 && pages.every((page) => page.audioUrl !== null),
    [pages],
  )

  const stopSpeaking = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
    }
    setSpeaking(null)
  }, [])

  const toggleSpeaking = useCallback(
    (pageNo: number) => {
      const el = audioRef.current
      const page = pages.find((item) => item.pageNo === pageNo)
      if (!el || !page?.audioUrl) return
      if (speaking === pageNo) {
        stopSpeaking()
        return
      }
      // 换页必须重设 src：不重设就会从上一页的播放位置接着放（症状是"点了没声"）
      el.src = page.audioUrl
      setAudioFailed(null)
      // ★ `play()` 返回 promise；被手势打断或文件读不到时它会 reject。
      //   不接住的话控制台一条 unhandled rejection，而界面上什么都没发生——
      //   正是判据 ② 要挡的那种"静默没声"
      void el.play().catch(() => setAudioFailed(pageNo))
      setSpeaking(pageNo)
    },
    [pages, speaking, stopSpeaking],
  )

  /** 离开这一屏时把声音停掉。不然翻到别的页面，书还在念 */
  useEffect(() => () => audioRef.current?.pause(), [])

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
      // 翻页就停：朗读是"这一页的"，翻走了还在念上一页是错的。
      // （所以也**不做自动续读**——那要先解决"下一页没有音频怎么办"，
      //   而那是判据 ① 的问题，不是这一步的。）
      stopSpeaking()
      setQTarget((current) => Math.min(leafCount, Math.max(0, current + delta)))
    },
    [leafCount, stopSpeaking],
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

  /* ── 页码：当前"看着的那一页/那两页" ───────────────────────────────── */

  const readout = useMemo(() => {
    const near = Math.round(q)
    if (near <= 0) return { label: '封面', page: 0 }
    if (near >= leafCount) return { label: '封底', page: pages.length }
    const right = faces[2 * near]
    const left = faces[2 * near - 1]
    const numbers = [left, right]
      .flatMap((face) => (face?.kind === 'page' ? [face.page.pageNo] : []))
      .sort((a, b) => a - b)
    if (numbers.length === 0) return { label: `第 ${pages.length} 页`, page: pages.length }
    return {
      label: numbers.length === 1 ? `第 ${numbers[0]} 页` : `第 ${numbers[0]}–${numbers[1]} 页`,
      page: numbers[numbers.length - 1] ?? 0,
    }
  }, [q, leafCount, faces, pages.length])

  const showImage = useCallback((leaf: number) => Math.abs(leaf - q) <= IMAGE_WINDOW, [q])

  /**
   * 书脊的横向偏移。首页那套是「合着时 25%、翻开时 0」，让**右半幅**落在正中；
   * 阅读器多一个**末尾**的合着态：q 到头时全部叶都翻到了左边，封底落在左半幅，
   * 所以要往反方向挪半幅（-25%）才落在正中——否则封底那一页的右半幅是空白纸，
   * 看着像"书没合上"。两个端点在视觉上因此是对称的。
   */
  const bookX = q < 0.5 ? '25%' : q > leafCount - 0.5 ? '-25%' : '0%'

  /* ── 朗读：当前页是哪一页，以及"没有朗读"这件事怎么被说出来 ─────────────── */

  /** 当前看着的那一页。封面（0）与封底（pages.length）不是页，拿不到就是 null */
  const currentPage = pages.find((page) => page.pageNo === readout.page) ?? null

  // 阅读记录（工单 05）：只算页面可见的时长，翻页才算"读过"。规则见 use-reading-log.ts
  useReadingLog(bookId, readout.page)
  const canSpeak = currentPage !== null && currentPage.audioUrl !== null
  const narratedCount = pages.filter((page) => page.audioUrl !== null).length

  /**
   * 没有朗读控件时，**说清为什么**。放在这行小字里，因为那正是"这本书怎么了"
   * 该出现的地方（首页那条教训：宁可整节不做，也不要一个骗人的控件）。
   */
  const narrationNote =
    audioFailed !== null
      ? `第 ${audioFailed} 页的朗读没加载出来（音频读不到，这一页请自己念）`
      : narratedCount === 0
        ? '这本书没有朗读'
        : narratedCount < pages.length
          ? `这本书只有 ${narratedCount}/${pages.length} 页有朗读，所以没有给朗读控件——只对几页能响的按钮，证的是反面`
          : null

  return (
    <section
      className="reader"
      data-motion={reduced ? 'reduced' : 'full'}
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
                  <FaceView face={front} side="front" show={showImage(leaf)} bookTitle={title} />
                )}
                {back && (
                  <FaceView face={back} side="back" show={showImage(leaf)} bookTitle={title} />
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
            底栏在舞台之外，这两个问题都不存在。 */}
        {fullyNarrated && (
          <button
            type="button"
            className="reader__audio"
            onClick={() => currentPage && toggleSpeaking(currentPage.pageNo)}
            disabled={!canSpeak}
            aria-pressed={currentPage !== null && speaking === currentPage.pageNo}
            aria-label={
              canSpeak
                ? speaking === currentPage?.pageNo
                  ? '停止朗读这一页'
                  : '朗读这一页'
                : '封面与封底没有朗读'
            }
          >
            {currentPage !== null && speaking === currentPage.pageNo ? '■ 停止' : '▶ 朗读'}
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
        ref={audioRef}
        preload="none"
        aria-hidden="true"
        onEnded={() => setSpeaking(null)}
        onError={() => {
          setSpeaking((pageNo) => {
            if (pageNo !== null) setAudioFailed(pageNo)
            return null
          })
        }}
      />

      {/* 书号留在页面上：演示与排障都要能一眼说出"这是哪一本" */}
      <p className="reader__meta">
        {bookId} · {source === 'demo' ? '预生成演示书（不需要网络）' : '这一轮生成的'}
      </p>
      {narrationNote && <p className="reader__meta reader__meta--note">{narrationNote}</p>}
    </section>
  )
}

/* ───────────────────────── 每一面 ───────────────────────── */

function FaceView({
  face,
  side,
  show,
  bookTitle,
}: {
  face: Face
  side: 'front' | 'back'
  show: boolean
  bookTitle: string
}) {
  if (face.kind === 'cover') {
    return (
      <div className={`reader__face reader__face--${side}`}>
        <div className="reader__cover">
          <h1 className="reader__title">{bookTitle}</h1>
          <p className="reader__hint">用 → ← 或点右下角翻页</p>
        </div>
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

  const { page } = face
  return (
    <div className={`reader__face reader__face--${side}`}>
      {page.missing ? (
        // 缺图这一页的兜底：一张写清"为什么这里没有画"的纸，不是裂图
        <div className="reader__missing">
          <span className="reader__missing-no">第 {page.pageNo} 页</span>
          <span>这一页没做出来</span>
        </div>
      ) : (
        // 方形插画铺在页面上半部（contain，不裁），下半留一条纸色带放正文
        <div
          className="reader__art"
          style={show && page.imageUrl ? { backgroundImage: `url(${page.imageUrl})` } : undefined}
          role="img"
          aria-label={`第 ${page.pageNo} 页的插画`}
        />
      )}
      <div className="reader__text">
        {page.body.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  )
}
