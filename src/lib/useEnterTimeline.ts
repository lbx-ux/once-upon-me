/**
 * useEnterTimeline.ts —— 工作台每一屏进场那一下（GSAP core，不引插件）
 *
 * 一条决定实现的事实：CSS 持终态，GSAP 只做 `from()`。
 *   首屏付过的学费（README §五「首屏的第一帧不靠 JS」）：预渲染 HTML 里 12 张卡一个
 *   inline style 都没有，而 CSS 写着 `opacity: 0`（"JS 接管前不可见"）——两条合起来，
 *   首帧是一张空环，而那张空环就是这一页的 LCP。
 *   所以这里反过来：默认状态就是画完的样子，GSAP 只负责"从哪儿来"。
 *   于是禁 JS、hydration 之前、`prefers-reduced-motion` 三种情形下，用户看到的都是
 *   完整的一页，而不是一页半成品。静止终态因此不需要单独写——它就是默认态。
 *
 * 为什么不用 ScrollTrigger：工作台这几屏基本不滚动（`/home` 一屏装得下），
 *   而 README §五 记着一条闸门失效——GSAP 把插件类声明成全局，
 *   忘了 `import { ScrollTrigger } from 'gsap/ScrollTrigger'` 时 tsc 与 eslint 全绿，
 *   只有浏览器会抛 ReferenceError。不引插件，这条坑就不存在。
 *
 * 为什么不做天空视差：满屏 fixed 大图上任何 transform 都是每帧重采样一整屏
 *   （§五 那条账）。这一层的动只有 opacity，且只在挂载时播一次。
 *
 * 时间线本身是纯数据（`ENTER_STEPS`），跑它的地方只有一处 `gsap.timeline()`。
 * 这样"哪一处什么时候进场"可测、可 review，而不必开浏览器。
 *
 * 2026-10-16 多了一条接力（`arrival`）：从首页点「开始创作」进来的那一次，
 *   主题墙那一步的起点不是"从下面浮上来"，而是从环上那 12 张刚才所在的位置飞回来
 *   （`lib/theme-handoff.ts`）。接力只接管 `ENTER_STEPS` 里选择器对得上的那一步的
 *   `at` / `duration` / 起点，其余各步一字不动；没有接力时（直接访问 / 刷新 /
 *   `prefers-reduced-motion`）走的就是原来那条，一个数都没动。
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

/**
 * 逐元素的起点。键名直接是 GSAP 的（`x` / `y` / `scale` / `rotate` / `opacity`）——
 * 我们不再发明一套自己的名字，那样等于把 GSAP 的属性表抄第二遍。
 * 值一律是函数：接力那 12 张的起点各不相同，给不了常数。
 *
 * 刻意不去 import GSAP 的 `TweenVars`：那是一个全局声明的类型
 *   （README §五 记过"GSAP 把插件类声明成全局"那条闸门失效），取它要么把
 *   `gsap` 的运行时拖进 node 测试、要么写一个跨模块的深路径。
 *   这里要的键就这五个，写死比取巧清楚。GSAP 收得下这个类型（结构上兼容）。
 */
export type EnterVars = {
  x?: (index: number, el: HTMLElement) => number
  y?: (index: number, el: HTMLElement) => number
  scale?: (index: number, el: HTMLElement) => number
  rotate?: (index: number, el: HTMLElement) => number
  opacity?: (index: number, el: HTMLElement) => number
}

/**
 * 接力：某一步的起点由调用方接管（现在只有一处用户 —— `theme-handoff.ts`）。
 */
export type EnterArrival = {
  /** 接管 `ENTER_STEPS` 里哪一步（按选择器对上；对不上就不接管） */
  sel: string
  /** 起点 */
  vars: EnterVars
  /** 那一步什么时候开始（秒），默认 `ARRIVAL_AT` */
  at?: number
  /** 那一步跑多久（秒），默认 `ARRIVAL_DURATION` */
  duration?: number
}

/**
 * 接力的起点是 0，不是 `ENTER_STEPS` 里那个 `.42`。
 *
 * 这 12 张在切页那一刻已经在屏幕上了（就在刚才那个位置）——
 *   让它们原地等 0.42s 再起飞，看起来就是"环突然停住半秒"（环是转的，停住就穿帮）。
 *   于是这一条路上层级反过来：内容先动（它本来就在场），
 *   标题与输入卡随后在它下面浮起来。
 */
export const ARRIVAL_AT = 0

/**
 * 接力那一步的时长。比默认的 0.4 长一点：它要走的路是几百像素，
 * 而且这一下就是整条接力最想让人看见的部分。
 * 整场仍然收在 1.2s 内（`ARRIVAL_AT + ARRIVAL_DURATION + 12 项的错峰尾巴 = 0.90s`），
 * 由 `useEnterTimeline.test.ts` 钉着。
 */
export const ARRIVAL_DURATION = 0.62

/** 逐项间隔的上限档：≤ 这个数按每档 35ms，再多就压，避免最后一项迟到 */
export const STAGGER_CAP = 8
/** 整批交错的总预算：最后一项的开始不晚于这个数（秒） */
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

/** 时间线的形状。顺序即层级：笔 → 标题 → 胶囊 → 纸 → 墙
 *  原来「说明」那一行（`.cl__sub`）在标题与胶囊之间，2026-10-15 按用户要求撤了，
 *    它那一步跟着删。`at` 都是绝对秒数，所以删一步不会挪动别步的时序——
 *    留下一个选不中任何元素的选择器只会让下一个人以为那一行还在。
 *  2026-10-16 加过「书的形态」（`.cl__forms`，标题上方那一行）那一步，排在最前；
 *    那一行 2026-10-18 拆掉（形态搬进 `/home` 的弹窗），这一步按同一条删掉。
 */
export const ENTER_STEPS: readonly EnterStep[] = [
  { sel: '.cl__doodle', from: { opacity: 0, y: 0 }, duration: 0.5, at: 0 },
  { sel: '.cl__title', from: { opacity: 0, y: 14 }, duration: 0.5, at: 0.05 },
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
 *
 * `arrival` 是可选的接力：给了就说明"这一屏是从别处飞过来的"
 * （见 `EnterArrival`），只影响它 `sel` 对得上的那一步。
 */
export function useEnterTimeline(
  ref: React.RefObject<HTMLElement | null>,
  arrival?: EnterArrival | null,
): void {
  const played = useRef(false)
  /* 用 ref 拿着它、并让 effect 不依赖它：接力是"进这一屏那一次"的事，
     换一个值重播整条进场时间线是错的（那是"页面刷新了"的感觉）。
     而它在调用方那边是一次性算出来的（`useState` 的初始化器），
     所以这个 ref 不是为了躲开"每次渲染都变"，是为了把这条意思写死。 */
  const arrivalRef = useRef(arrival)
  arrivalRef.current = arrival

  useEffect(() => {
    const root = ref.current
    // 只播一次：这一场在一个组件实例上只跑一遍
    if (!root || played.current) return
    played.current = true

    const takeover = arrivalRef.current

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
          /* 接力只接管选择器对得上的那一步：起点（逐元素）、时长、起始时刻一起换。
             `vars` 放在 `step.from` 之后 —— 它要盖掉 `{opacity: 0, y: 12}` 那两个数，
               而它盖不到的键（万一将来 `step.from` 长了别的）仍然按默认那条走。 */
          const take = takeover && takeover.sel === step.sel ? takeover : null
          tl.from(
            items,
            {
              ...step.from,
              ...(take ? take.vars : null),
              duration: take?.duration ?? step.duration,
              stagger: step.stagger ? step.stagger(items.length) : 0,
            },
            take?.at ?? step.at,
          )
        }
        /* ★ 这一条必须是 `to(0)`，不能写成 `from(len)`（2026-10-18 修的）。
           上面那句 `gsap.set` 已经把当前的 `strokeDashoffset` 写成了 `len`，
           而 `from()` 的意思是"从这个值动到当前值"——当前值正好也是 `len`，
           于是这一条动了个寂寞：两笔装饰被 `stroke-dasharray = len` 整条 dash 掉之后
           再也没画回来，屏幕上什么都不剩。用户报的原话是
           "「今天想讲一个什么样的故事？」这几个字四周的图标怎么没有了"。
           量到的现场（1280×900，`/home`）：四条 path 的
             `stroke-dashoffset` 分别等于各自的 `stroke-dasharray`（66/29/86/29px），
             即"整条描边都在空隙里"；把 offset 手动改成 0，两笔立刻出现。
           起手仍然是"没画出来"（`gsap.set` 那一步留着），终点是 0 —— 这与本文件
             开头那条"默认态就是画完的样子"不冲突：`prefers-reduced-motion` 与禁 JS
             时这一段根本不会跑，用户看到的就是画完的两笔。 */
        tl.to(
          strokes,
          {
            strokeDashoffset: 0,
            duration: 0.7,
            ease: 'power1.inOut',
          },
          0,
        )
      }, root)
    })

    /* 「只播一次」这个闸门必须和 cleanup 配成一对（2026-10-16 修的一个真 bug）
     *
     * 原来它只写了一半：闸门立着，而 cleanup 里的 `mm.revert()` 会把这条时间线整条撤回。
     * 于是只要 effect 跑第二遍（dev 的 StrictMode 就是这样：挂载 → 卸载 → 再挂载），
     * 第二遍撞上闸门直接 return，画面停在撤回之后的状态 —— 什么都不演。
     *
     * 实测（headless Chrome 直连 CDP，真帧）：从首页点「开始创作」进来的那一趟
     *   `runs: 2, earlyReturn: 1, mmCallback: 1`，而墙上那 12 格的读数从第一帧起就是终态
     *   （`opacity: 1` / `transform: none`）—— 整屏一次动画都没有。
     *   也就是说"接力看起来没接上"的真正原因不是起点不对，是整条时间线根本没跑；
     *   直接打开 `/home` 那一趟（`runs: 1`）的对照组里，同一格读得到 `opacity 0.7 → 1`、
     *   `y 3.6 → 0` —— 同一个 effect，只因为它没跑第二遍。
     *
     * 修法就是把闸门在 cleanup 里放回去：`played` 从此是"这一刻有没有一条活的时间线"，
     * 不是"这辈子演过没有"。
     * ★ 它本来就管不到"路由内切回这一屏要不要重播"—— 组件一卸载 ref 就没了，
     *   回来是全新的实例，那一刻重播是对的：每一屏都该有它自己的进场。
     */
    return () => {
      mm.revert()
      played.current = false
    }
  }, [ref])
}
