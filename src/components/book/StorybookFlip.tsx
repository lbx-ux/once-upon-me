'use client'

/**
 * StorybookFlip —— 首页第二屏：滚动翻页绘本
 *
 * 首屏回答的是"能做什么"（12 个不同的孩子）；这一节回答的是产品真正的承诺 ——
 * **每一页都是同一个他**。论点不靠文字说，靠翻给人看。
 *
 * ---------------------------------------------------------------------------
 * 结构
 *
 *   <section.storybook>            高 340vh，只提供滚动距离与叠入量
 *     <div.storybook__stage ref>   sticky 满屏 —— useScrollDriver 的契约：
 *                                  **ref 指 sticky 那层，它的直接父元素是撑高的那一节**
 *       .storybook__book/.book     5 片叶，绕书脊 rotateY
 *       .book-spine                右侧刻度
 *       .storybook__end            最后一页才升起的 CTA
 *       .storybook__static ↗       静止模式（reduced-motion）那一套，两块 DOM 都渲染，
 *       .storybook__live  ↗        靠 CSS 的 display 切 —— 这样首帧就是对的
 *       .storybook__pager ↗
 *
 * ---------------------------------------------------------------------------
 * 滚动映射（p → q）写在 P_Q 表里，**成对的停顿让每一页真的停得住**：
 * 翻页只占一小段，其余是"停在这一页让你读完"。改这张表要连着看
 * useScrollDriver 的 enter-exit 区间（p=0 是书顶边触到视口下沿那一刻，
 * p=0.773 之后书开始被顶出去 —— 所以最后一页的停顿要**早于** 0.773 开始）。
 *
 * 角度一律用插值后的 qDisplay，不用 qTarget：鼠标滚轮是离散格，
 * 不插值就是一顿一顿（触控板连续，看不出这个问题，只有真拿滚轮滚才会暴露）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import useScrollDriver from '@/lib/useScrollDriver'
import BookSpine from './BookSpine'
import { flipState } from './flip'
import {
  BOOK_BYLINE,
  BOOK_CTA,
  BOOK_NOTE,
  BOOK_TITLE,
  COVER_IMAGE,
  DEFAULT_BRANCH,
  LEAF_COUNT,
  buildLeaves,
  pageImage,
  pageText,
  spineLabels,
  type PageFace,
} from './demoBook'

/* ---------------------------------------------------------------------------
 * 滚动预算：p → 已翻过多少叶
 *
 * p 的 0 与 1 都是"真实可达"的两端（useScrollDriver 把 enter-exit 夹到了文档尽头）：
 *   p = 0  书顶边触到视口下沿
 *   p ≈ 0.29 舞台钉住（从这一刻起书不再往上走）
 *   p = 1  本节底边触到视口下沿，也就是页面滚到底
 *
 * p 0.00–0.18  书从下面升上来（**合着**，封面这一拍要留出来）
 * p 0.18–0.32  封面翻开 —— 与"钉住"那一刻交错，"书落定，才翻第一页"
 * p 0.32–0.39  停 S1（像什么？）
 * p 0.39–0.48  翻到 S2
 * p 0.48–0.53  停 S2（上去了）
 * p 0.53–0.62  翻到 S3
 * p 0.62–0.76  停 S3 —— **选择点的窗口**（Step 5 的两个按钮挂在这一段）
 * p 0.76–0.86  翻到 S4（分支页）
 * p 0.86–1.00  停 S4 —— 正文 + 收尾 CTA
 * ------------------------------------------------------------------------- */
const P_Q: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0],
  [0.18, 0],
  [0.32, 1],
  [0.39, 1],
  [0.48, 2],
  [0.53, 2],
  [0.62, 3],
  [0.76, 3],
  [0.86, 4],
  [1.0, 4],
]

/** 每帧朝目标插值的系数。比 HeroOrbit 的 0.055 快一档 —— 翻页要跟手 */
const SMOOTHING = 0.12

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function qFromP(p: number): number {
  for (let i = 1; i < P_Q.length; i++) {
    const [p0, q0] = P_Q[i - 1]
    const [p1, q1] = P_Q[i]
    if (p <= p1) {
      const t = p1 === p0 ? 1 : clamp((p - p0) / (p1 - p0), 0, 1)
      return q0 + (q1 - q0) * t
    }
  }
  return P_Q[P_Q.length - 1][1]
}

/**
 * 每一面"停稳"时的 p —— 刻度点击与键盘 ← → 用它反推该滚到哪。
 * 取停顿段靠前 30% 处，而不是正中：停在中点会让刻度点完之后还往前飘一小截。
 * 表格里没有停顿面的（理论上不会有）退回第一次到达那一面的 p。
 */
const P_AT: readonly number[] = (() => {
  const out: number[] = []
  for (let q = 0; q <= LEAF_COUNT - 1; q++) {
    let first = -1
    let last = -1
    for (let i = 0; i < P_Q.length; i++) {
      if (P_Q[i][1] === q) {
        if (first < 0) first = i
        last = i
      }
    }
    const a = first < 0 ? 0 : P_Q[first][0]
    const b = last < 0 ? a : P_Q[last][0]
    out.push(a + (b - a) * 0.3)
  }
  return out
})()

/** 给元素挂上"这一叶"的三个变量（真值由 useScrollDriver 写在舞台元素上） */
function leafVars(i: number): CSSProperties {
  return {
    '--leaf-angle': `var(--leaf-${i}-a, 0deg)`,
    '--leaf-z': `var(--leaf-${i}-z, ${LEAF_COUNT - i})`,
    '--leaf-shade': `var(--leaf-${i}-shade, 0)`,
  } as unknown as CSSProperties
}

/* ---------------------------------------------------------------------------
 * 一面
 *
 * 半页不切文件：同一张 3:2 跨页图挂两次，data-half 决定取哪一半（见 CSS §2）。
 * 平衡性靠 .book__shade —— shade = sin(θ)，平放时 0、立起来时 1。
 * ------------------------------------------------------------------------- */
function Face({ face, side }: { face: PageFace; side: 'front' | 'back' }) {
  const cls = `book__face book__face--${side}`
  const shade = <i className="book__shade" aria-hidden="true" />

  if (face.kind === 'cover') {
    return (
      <div className={cls} style={{ backgroundImage: `url(${COVER_IMAGE})` }}>
        <div className="book__cover">
          <h3 className="book__title">{BOOK_TITLE}</h3>
          <p className="book__byline">{BOOK_BYLINE}</p>
        </div>
        {shade}
      </div>
    )
  }

  if (face.kind === 'back') {
    /* q 到 4 就停住了，封底在动画路径里其实翻不到；留着是为了叶模型完整
       （见 flip.ts 的叶表），W2 的阅读器会一路翻到底。 */
    return (
      <div className={cls} style={{ backgroundImage: `url(${COVER_IMAGE})` }}>
        <div className="book__back">
          <p className="book__note">{BOOK_NOTE}</p>
        </div>
        {shade}
      </div>
    )
  }

  return (
    <div className={cls} data-half={face.half} style={{ backgroundImage: `url(${face.image})` }}>
      {face.text ? (
        <div className="book__text">
          {face.text.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      {shade}
    </div>
  )
}

export default function StorybookFlip() {
  const stageRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLElement>(null)

  // ★ Step 5 的选择点会把 DEFAULT_BRANCH 换成 state（默认仍走 a），其余不动
  const leaves = useMemo(() => buildLeaves(DEFAULT_BRANCH), [])
  const labels = useMemo(() => spineLabels(DEFAULT_BRANCH), [])

  const [page, setPage] = useState(0)
  /** 只用来决定 ← → 是"滚动"还是"直接换页"，不参与渲染 —— 渲染那套的切换交给 CSS */
  const [reduced, setReduced] = useState(false)

  const qRef = useRef(0)
  const startedRef = useRef(false)
  const pageRef = useRef(0)

  const lastPage = leaves.length - 1

  useScrollDriver(stageRef, {
    range: 'enter-exit',
    // 这一段从书露头到滚出去全程都在动，别提前掉到 30fps
    fastWindow: [0.01, 0.99],
    onFrame: ({ progress, reduced: isReduced, setVar }) => {
      if (isReduced) {
        // 静止模式：这一节由按钮翻页，滚动不参与。顺手把插值重置，
        // 免得系统偏好切回来时从旧值慢慢追。
        startedRef.current = false
        return
      }

      const target = qFromP(progress)
      if (!startedRef.current) {
        // 首帧直接落位，不从 0 追 —— 刷新在页面中间时不该看到一本书自己翻开
        qRef.current = target
        startedRef.current = true
      } else {
        qRef.current += (target - qRef.current) * SMOOTHING
      }
      const q = qRef.current

      for (const [i, s] of flipState(q, leaves.length).entries()) {
        setVar(`--leaf-${i}-a`, `${s.angle.toFixed(2)}deg`)
        setVar(`--leaf-${i}-z`, String(s.zIndex))
        setVar(`--leaf-${i}-shade`, s.shade.toFixed(3))
      }

      const open = clamp(q, 0, 1)
      setVar('--book-x', `${((1 - open) * 25).toFixed(2)}%`)
      setVar('--ground-s', (0.6 + 0.4 * open).toFixed(3))
      setVar('--cover-title-o', (1 - smoothstep(0.12, 0.5, q)).toFixed(3))
      setVar('--book-end-o', smoothstep(lastPage - 0.38, lastPage - 0.06, q).toFixed(3))
      // 只给浏览器断言用，样式里没人读它
      setVar('--story-p', progress.toFixed(4))

      const next = clamp(Math.round(q), 0, lastPage)
      if (next !== pageRef.current) {
        pageRef.current = next
        setPage(next)
      }
    },
  })

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  /**
   * 到第 index 面去。
   * 正常模式 = 滚到那一面的停顿段（p ↔ scrollY 是线性的，反推即可，见 useScrollDriver）；
   * 静止模式 = 直接换页。
   */
  const goTo = useCallback(
    (index: number) => {
      const i = clamp(index, 0, lastPage)
      if (reduced) {
        pageRef.current = i
        setPage(i)
        return
      }
      const wrap = wrapRef.current
      if (!wrap) return
      const top = wrap.getBoundingClientRect().top + window.scrollY - window.innerHeight
      const height = wrap.offsetHeight + window.innerHeight
      window.scrollTo({ top: top + P_AT[i] * height, behavior: 'smooth' })
    },
    [lastPage, reduced],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goTo(pageRef.current + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goTo(pageRef.current - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo])

  const text = pageText(DEFAULT_BRANCH, page)
  const atEnd = page >= lastPage

  return (
    <section className="storybook" ref={wrapRef} aria-label={`滚动翻页绘本《${BOOK_TITLE}》`}>
      <div className="storybook__stage" ref={stageRef}>
        <div className="storybook__book">
          {/* 5 片 3D 叶对辅助技术是一团噪音（十个面里一半还是背朝外的），
              整块 aria-hidden，内容由下面那段 aria-live 的正文替代。 */}
          <div className="book" aria-hidden="true">
            {leaves.map((leaf, i) => (
              <div key={i} className="book__leaf" style={leafVars(i)}>
                <Face face={leaf.front} side="front" />
                <Face face={leaf.back} side="back" />
              </div>
            ))}
          </div>
          <div className="book__ground" aria-hidden="true" />
        </div>

        <BookSpine labels={labels} active={page} onJump={goTo} />

        {/* 最后一页升起的收尾。p 0.74 之后 —— 那一页是分支页，不是封底（封底翻不到） */}
        <div className="storybook__end" data-on={atEnd || undefined}>
          <p className="book__note">{BOOK_NOTE}</p>
          {/* TODO: 创作流程做出来后换成指向 /create 的 Link */}
          <button className="book-cta" type="button">
            {BOOK_CTA} →
          </button>
        </div>

        {/* ↓↓↓ 静止模式那一套。正常模式下三块都是 display: none，靠 CSS 切，不靠 JS ——
            这样首帧就是对的，不会先闪一下动效版。 */}
        <div
          className="storybook__static"
          data-cover={page === 0 || undefined}
          aria-hidden="true"
          style={{ backgroundImage: `url(${pageImage(DEFAULT_BRANCH, page)})` }}
        />
        <p className="storybook__live" aria-live="polite">
          {text.join(' ')}
        </p>
        <div className="storybook__pager">
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page === 0}
            aria-label="上一页"
          >
            ‹
          </button>
          <span>{page === 0 ? '封面' : `${page} / ${lastPage}`}</span>
          <button type="button" onClick={() => goTo(page + 1)} disabled={atEnd} aria-label="下一页">
            ›
          </button>
        </div>
      </div>
    </section>
  )
}
