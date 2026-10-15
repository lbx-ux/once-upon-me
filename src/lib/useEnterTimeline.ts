/**
 * useEnterTimeline.ts —— 工作台每一屏进场那一下（GSAP core，不引插件）
 *
 * ★ 一条决定实现的事实：**CSS 持终态，GSAP 只做 `from()`**。
 *   首屏付过的学费（README §五「首屏的第一帧不靠 JS」）：预渲染 HTML 里 12 张卡一个
 *   inline style 都没有，而 CSS 写着 `opacity: 0`（"JS 接管前不可见"）——两条合起来，
 *   首帧是一张空环，而那张空环就是这一页的 LCP。
 *   所以这里反过来：默认状态就是**画完的样子**，GSAP 只负责"从哪儿来"。
 *   于是禁 JS、hydration 之前、`prefers-reduced-motion` 三种情形下，用户看到的都是
 *   完整的一页，而不是一页半成品。静止终态因此不需要单独写——它就是默认态。
 *
 * ★ 为什么不用 ScrollTrigger：工作台这几屏基本不滚动（`/home` 一屏装得下），
 *   而 README §五 记着一条闸门失效——GSAP 把插件类声明成**全局**，
 *   忘了 `import { ScrollTrigger } from 'gsap/ScrollTrigger'` 时 tsc 与 eslint 全绿，
 *   只有浏览器会抛 ReferenceError。不引插件，这条坑就不存在。
 *
 * ★ 为什么不做天空视差：满屏 fixed 大图上任何 transform 都是每帧重采样一整屏
 *   （§五 那条账）。这一层的动只有 opacity，且只在挂载时播一次。
 *
 * 时间线本身是**纯数据**（`ENTER_STEPS`），跑它的地方只有一处 `gsap.timeline()`。
 * 这样"哪一处什么时候进场"可测、可 review，而不必开浏览器。
 */

'use client'

import { useEffect, useRef } from 'react'

import gsap from 'gsap'

/** 单条进场步骤：`from` 是起点，终点永远是 CSS 里那个态 */
export type EnterStep = {
  /** 作用域内的选择器 */
  sel: string
  from: { opacity: number; y: number }
  duration: number
  /** 在时间线上的起点（秒） */
  at: number
  /** 多元素时的逐项间隔（秒），配合 `staggerFor` 用 */
  stagger?: (count: number) => number
}

/** 逐项间隔的上限档：≤ 这个数按每档 35ms，再多就压，避免最后一项迟到 */
export const STAGGER_CAP = 8
/** 整批交错的总预算：最后一项的**开始**不晚于这个数（秒） */
export const STAGGER_BUDGET = 0.28

/**
 * 交错间隔。★ 不是常数：12 项各 35ms 就是 420ms，
 * 最后一项会在整页已经就位之后才慢吞吞出现（首页轮播那条"6.5s 像页面卡住了"是同一类）。
 * 所以超过 `STAGGER_CAP` 项时按预算反推，让总时长封顶。
 */
export function staggerFor(count: number): number {
  if (count <= 1) return 0
  if (count <= STAGGER_CAP) return 0.035
  return STAGGER_BUDGET / (count - 1)
}

/** 时间线的形状。顺序即层级：笔 → 标题 → 说明 → 胶囊 → 纸 → 墙 */
export const ENTER_STEPS: readonly EnterStep[] = [
  { sel: '.cl__doodle', from: { opacity: 0, y: 0 }, duration: 0.5, at: 0 },
  { sel: '.cl__title', from: { opacity: 0, y: 14 }, duration: 0.5, at: 0.05 },
  { sel: '.cl__sub', from: { opacity: 0, y: 10 }, duration: 0.45, at: 0.16 },
  { sel: '.cl__pills', from: { opacity: 0, y: 10 }, duration: 0.4, at: 0.24 },
  { sel: '.cl__card', from: { opacity: 0, y: 18 }, duration: 0.55, at: 0.3 },
  {
    sel: '.cl__wall li',
    from: { opacity: 0, y: 12 },
    duration: 0.4,
    at: 0.42,
    stagger: staggerFor,
  },
]

/**
 * 挂载时跑一次。`ref` 是作用域根：所有选择器只在它内部找
 * （`gsap.context` 的 scope 就是这件事，顺带负责卸载时回滚）。
 */
export function useEnterTimeline(ref: React.RefObject<HTMLElement | null>): void {
  const played = useRef(false)

  useEffect(() => {
    const root = ref.current
    // 只播一次：路由内切换回同一屏时不该再演一遍（那是"页面刷新了"的感觉）
    if (!root || played.current) return
    played.current = true

    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      // 两笔手绘装饰先"被画出来"：描边的长度按真实路径量，不写死
      const strokes = root.querySelectorAll<SVGPathElement>('.cl__doodle path')
      strokes.forEach((path) => {
        const len = path.getTotalLength()
        gsap.set(path, { strokeDasharray: len, strokeDashoffset: len })
      })

      return gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
        for (const step of ENTER_STEPS) {
          const items = gsap.utils.toArray<HTMLElement>(step.sel)
          if (!items.length) continue
          tl.from(
            items,
            {
              ...step.from,
              duration: step.duration,
              stagger: step.stagger ? step.stagger(items.length) : 0,
            },
            step.at,
          )
        }
        tl.from(
          strokes,
          {
            strokeDashoffset: (i: number, el: SVGPathElement) => el.getTotalLength(),
            duration: 0.7,
            ease: 'power1.inOut',
          },
          0,
        )
      }, root)
    })

    return () => mm.revert()
  }, [ref])
}
