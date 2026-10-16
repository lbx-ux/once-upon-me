'use client'

/**
 * BooklistReader —— 灵感书单那 12 本样书的阅读器
 *
 * ---------------------------------------------------------------------------
 * 一跨页 = 一张图。这是这一屏与 `/reader/[bookId]` 那台阅读器**唯一但根本**的差别
 *
 *   翻开一屏 = **1 张 3:2 的连续画面**，横跨左右两个书页，正文叠在左页下角 ——
 *   与首页第二屏那本《小宇的云》同一个形状（也是用户 2026-10-15 明确要的那个形状）。
 *   8 个跨页 = 16 个书页。
 *
 *   ★ 半页**不切文件**：同一张图挂两次，靠 `background-size: 200% 100%` +
 *     `background-position` 各取一半（`book/flip.ts` 顶部那段叶模型）。所以这一屏
 *     不会出现"一页两张图"——那是**一张图跨两个书页**。
 *   ★ 另一台阅读器（`reader/ReaderBook.tsx`）每一面装的是一整页（方形插画 + 下文），
 *     那是"一页一图一句"那条产品定义的形状。两台不吃同一份 DOM，也不共用样式的类名。
 *
 * ---------------------------------------------------------------------------
 * 四条实现上的讲究，每条对应一处真会发生的错
 *
 * 1. **几何整块搬 `book/flip.ts`**，一行不改。叶表：8 个跨页 → 9 叶
 *    （L0 正面=封面、背面=S1 左半 … L8 背面=封底）。
 * 2. **键盘只在容器上接**（`tabIndex` + `onKeyDown`），不上 `window`——
 *    首页那个 `window` 无条件接键的已知 bug 不复制（`ReaderBook.tsx` 文件头第 1 条）。
 * 3. **图按窗口挂载**：只给离当前 q 不超过一叶的面挂 `background-image`。
 *    一张跨页 1536×1024，9 叶全挂上在自动播放式的连翻里会卡。
 * 4. **缺图有缺图的样子**：那一页显示一张写着"这一页的画还没到位"的纸 + 主题 emoji，
 *    不留裂图、不留空框（CLAUDE.md「不糊弄」；emoji 兜底那套沿用书里的做法）。
 *
 * 朗读则照 `ReaderBook.tsx` 判据 ① 那条：**8 段音频全在才给控件**。
 * 一本只有 5 段能响的书，那个按钮证的是反面。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { flipState } from '@/components/book/flip.ts'
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
    // ★ 左半在前：它在**上一叶的背面**，右半在同一叶的正面（见上面那张叶表）
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

  /* ── 朗读 ─────────────────────────────────────────────────────────────── */

  /** 正在朗读的那个跨页（null = 没在放）。★ 朗读属于"你正在看的那一跨页" */
  const [speaking, setSpeaking] = useState<number | null>(null)
  const [audioFailed, setAudioFailed] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  /** ★ 判据 ①：**只要有一段没有朗读，这个控件就不出现**（与 `/reader` 同一条） */
  const fullyNarrated = audio.length === SPREADS_PER_BOOK && audio.every((url) => url !== null)

  const stopSpeaking = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
    }
    setSpeaking(null)
  }, [])

  const toggleSpeaking = useCallback(
    (spread: number) => {
      const el = audioRef.current
      const url = audio[spread - 1] ?? null
      if (!el || !url) return
      if (speaking === spread) {
        stopSpeaking()
        return
      }
      // 换一段必须重设 src：不重设就会从上一段的播放位置接着放（症状是"点了没声"）
      el.src = url
      setAudioFailed(null)
      // `play()` 返回 promise，被手势打断或文件读不到时会 reject。
      // 不接住就是"界面上什么都没发生"，而那是这一屏最不该有的失败方式
      void el.play().catch(() => setAudioFailed(spread))
      setSpeaking(spread)
    },
    [audio, speaking, stopSpeaking],
  )

  useEffect(() => () => audioRef.current?.pause(), [])

  /* ── 静止模式：读一次、订阅一次。reduced 下不跑补间，直接落在目标上 ───────── */

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(media.matches)
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  /* ── 补间 ─────────────────────────────────────────────────────────────── */

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
      // 翻页就停：朗读是"这一跨页的"，翻走了还在念上一段是错的
      stopSpeaking()
      setQTarget((current) => Math.min(leafCount, Math.max(0, current + delta)))
    },
    [leafCount, stopSpeaking],
  )

  /** 焦点在容器里时，左右键与空格翻页。**不在 window 上接**（见文件头第 2 条） */
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

  /* ── 页码：读作**书页号**（8 个跨页 = 16 页），与"一本至少 16 页"同一个口径 ── */

  const readout = useMemo(() => {
    const near = Math.round(q)
    if (near <= 0) return { label: '封面', spread: 0 }
    if (near >= leafCount) return { label: '封底', spread: 0 }
    const first = near * 2 - 1
    return { label: `第 ${first}–${first + 1} 页`, spread: near }
  }, [q, leafCount])

  const showImage = useCallback((leaf: number) => Math.abs(leaf - q) <= IMAGE_WINDOW, [q])

  /**
   * 书脊的横向偏移。首页那套是"合着时 25%、翻开时 0"（让右半幅落在正中）；
   * 这一屏多一个**末尾**的合着态：q 到头时全部叶都翻到了左边、封底落在左半幅，
   * 要往反方向挪半幅（-25%）才落在正中。
   */
  const bookX = q < 0.5 ? '25%' : q > leafCount - 0.5 ? '-25%' : '0%'

  const currentSpread = readout.spread
  const canSpeak = currentSpread > 0 && (audio[currentSpread - 1] ?? null) !== null
  const narratedCount = audio.filter((url) => url !== null).length

  /** 没有朗读控件时**说清为什么**（与 `/reader` 那条同一个写法，宁可不给也不骗人） */
  const narrationNote =
    audioFailed !== null
      ? `第 ${audioFailed} 个跨页的朗读没加载出来（音频读不到，这一页请自己念）`
      : narratedCount === 0
        ? '这本书还没有录朗读'
        : narratedCount < SPREADS_PER_BOOK
          ? `这本书只有 ${narratedCount}/${SPREADS_PER_BOOK} 段有朗读，所以没有给朗读控件——只对几段能响的按钮，证的是反面`
          : null

  return (
    <section
      className="blr"
      data-motion={reduced ? 'reduced' : 'full'}
      aria-label={`《${book.title}》· 样书阅读器`}
    >
      <div
        className="blr__stage"
        ref={stageRef}
        tabIndex={0}
        role="group"
        aria-label="绘本翻页区（方向键或空格翻页）"
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
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
                <i className="blr__shade" style={{ opacity: state.shade }} aria-hidden="true" />
              </div>
            )
          })}
        </div>
      </div>

      <div className="blr__bar">
        <button
          type="button"
          className="blr__btn"
          onClick={() => turn(-1)}
          disabled={qTarget === 0}
          aria-label="上一页"
        >
          ‹
        </button>
        <p className="blr__readout" aria-live="polite">
          {readout.label}
          <span className="blr__total"> · 共 {PAPER_PAGES_PER_BOOK} 页</span>
        </p>
        {fullyNarrated && (
          <button
            type="button"
            className="blr__audio"
            onClick={() => currentSpread > 0 && toggleSpeaking(currentSpread)}
            disabled={!canSpeak}
            aria-pressed={speaking !== null && speaking === currentSpread}
            aria-label={canSpeak ? '朗读这一页' : '封面与封底没有朗读'}
          >
            {speaking !== null && speaking === currentSpread ? '■ 停止' : '▶ 朗读'}
          </button>
        )}
        <button
          type="button"
          className="blr__btn"
          onClick={() => turn(1)}
          disabled={qTarget >= leafCount}
          aria-label="下一页"
        >
          ›
        </button>
      </div>

      <div className="blr__progress" aria-hidden="true">
        <i style={{ width: `${(q / leafCount) * 100}%` }} />
      </div>

      {/* 朗读音频。`preload="none"`：8 段音频不该在打开这一屏时全拉下来 */}
      <audio
        ref={audioRef}
        preload="none"
        aria-hidden="true"
        onEnded={() => setSpeaking(null)}
        onError={() =>
          setSpeaking((spread) => {
            if (spread !== null) setAudioFailed(spread)
            return null
          })
        }
      />

      <p className="blr__meta">
        《{book.title}》 · {theme?.label ?? book.key}主题的样书 · {SPREADS_PER_BOOK} 个跨页（
        {PAPER_PAGES_PER_BOOK} 页）
      </p>
      {narrationNote && <p className="blr__meta blr__meta--note">{narrationNote}</p>}
    </section>
  )
}

/* ───────────────────────── 每一面 ───────────────────────── */

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
