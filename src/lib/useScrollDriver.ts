'use client'

/**
 * useScrollDriver —— 滚动驱动机器
 *
 * 把「测区间 → 算进度 → 按需起停 rAF → 尊重系统偏好」这一整套从组件里抽出来，
 * 首屏轨道（HeroOrbit）与绘本那一节（StorybookFlip）共用。
 *
 * 这一份是**从 HeroOrbit 里原样搬出来的**，搬的时候没有顺手改行为 ——
 * 里面每一处细节（帧率窗口、visible/paused 的关系、reduced 下只画一帧）都是
 * 上一轮实测踩出来的，改之前请先读对应的注释。
 *
 * ---------------------------------------------------------------------------
 * 使用约定（重要）
 *
 *   **传入的 ref 指向「sticky 的那一层」，它的直接父元素是「撑高的那一节」。**
 *      <section class="xxx">          ← 高，提供滚动距离
 *        <div class="xxx__stage" ref> ← sticky: top 0
 *
 *   两种区间都由这个关系推出，见 ScrollRange。
 *
 *   回调（onFrame / onActiveChange）**存在 ref 里**，不是 effect 依赖 ——
 *   写成内联箭头也不会每渲染重建一次循环。effect 只依赖 range / fastWindow
 *   这些原始值，所以调用方可以放心传闭包。
 *
 * ---------------------------------------------------------------------------
 * 为什么 onActiveChange 是硬要求，不是锦上添花
 *
 *   循环一停，调用方就再也收不到帧；「从可见变成不可见」这个**下降沿**除了
 *   本 hook 内部没有任何人知道。HeroOrbit 原来把 pauseAll() 挂在 IO 与
 *   visibilitychange 回调上，抽出来之后必须由这个回调补回去，
 *   否则视频会在后台标签页里继续解码。
 */

import { useEffect, useRef, type RefObject } from 'react'

/** 滚动区间怎么算 */
export type ScrollRange =
  /**
   * 从「容器顶边贴到视口顶」滚到「sticky 元素被容器底边顶走」为止。
   * = 容器高 − sticky 高。首屏用这个：可滚 68vh。
   */
  | 'sticky'
  /**
   * 从「容器顶边升到视口下沿」滚到「整节滚出视口顶」为止。
   * = 容器高 + 视口高。书用这个 —— 翻页必须从书**进入视口**就开始动，
   * 不能等钉住才动，否则前面几十 vh 书只是往上飘、一页不翻。
   */
  | 'enter-exit'

export type ScrollFrame = {
  /** 0→1，已经夹过 */
  progress: number
  /** 距上一帧的毫秒数，已夹到 ≤64（切标签页回来时别一步跳过去） */
  dt: number
  /** performance.now() */
  ts: number
  /** prefers-reduced-motion 当前是否生效。每帧都给，因为用户可以中途改 */
  reduced: boolean
  /**
   * 写 CSS 变量，**同名同值不重复写**。这一层去重是性能关键：
   * 每帧无条件写 6 个变量会让整棵样式树重算，写了去重之后只有真的变了才动。
   */
  setVar: (name: string, value: string) => void
}

export type ScrollDriverOptions = {
  onFrame: (frame: ScrollFrame) => void
  /** 默认 'sticky' */
  range?: ScrollRange
  /** 「有内容在动」的进度区间，这段跑 60fps，其余 30fps。默认 [0.015, 0.97] */
  fastWindow?: [number, number]
  /**
   * range: 'sticky' 时的距离上限系数。默认 0.92 —— 容器高得离谱时，
   * 不让进度被拉成一条永远走不完的橡皮筋。
   */
  rangeCapRatio?: number
  /**
   * 「这一节现在是不是活跃的（在视口内 && 页面在前台）」发生翻转时调用。
   * 下降沿用来停视频 / 停一切没人看的东西。
   */
  onActiveChange?: (active: boolean) => void
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

export function useScrollDriver<T extends HTMLElement>(
  stageRef: RefObject<T | null>,
  options: ScrollDriverOptions,
): void {
  const { range = 'sticky', fastWindow = [0.015, 0.97], rangeCapRatio = 0.92 } = options

  // 回调走 ref：effect 不该因为调用方传了个内联箭头就重建整条循环
  const onFrameRef = useRef(options.onFrame)
  const onActiveChangeRef = useRef(options.onActiveChange)
  onFrameRef.current = options.onFrame
  onActiveChangeRef.current = options.onActiveChange

  const [fastStart, fastEnd] = fastWindow

  useEffect(() => {
    const stageEl = stageRef.current
    if (!stageEl) return

    /* ------------------------------------------------------------ 状态 */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    let rafId = 0
    let lastTs = 0
    let lastRenderTs = 0
    let inView = false
    let visible = true
    /** 上一个对外广播的活跃态，用来只报「翻转」，不报「每次求值」 */
    let active = false

    let progress = 0
    let rangeTop = 0
    let rangeHeight = 1

    /* ------------------------- CSS 变量写入去重（避免整棵样式树重算） */
    const lastVars = new Map<string, string>()
    function setVar(name: string, value: string) {
      if (lastVars.get(name) === value) return
      lastVars.set(name, value)
      stageEl!.style.setProperty(name, value)
    }

    /* ------------------------------------------------ 几何测量与滚动量 */
    function measure() {
      // 契约：ref 是 sticky 那层，它的父元素是撑高的那一节
      const wrap = stageEl!.parentElement
      if (!wrap) return
      rangeTop = wrap.getBoundingClientRect().top + window.scrollY

      if (range === 'enter-exit') {
        // 顶边进视口下沿 → 整节滚出视口顶
        rangeTop -= window.innerHeight
        const span = wrap.offsetHeight + window.innerHeight
        // ★ 但**页面最后一节滚不出视口顶** —— 文档到"它底边触到视口下沿"就结束了。
        //   不夹这一下，最后 100vh 是一段永远走不到的量程：进度到 0.77 就顶死，
        //   末尾那一页只分到一百多像素的停留，收尾等于没有。
        //   夹到文档真实可达的滚动量上；本节不是最后一节时这一夹不生效。
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
        rangeHeight = Math.max(1, Math.min(span, maxScroll - rangeTop))
      } else {
        rangeHeight = Math.max(
          1,
          Math.min(
            Math.max(wrap.offsetHeight - stageEl!.offsetHeight, 1),
            stageEl!.offsetHeight * rangeCapRatio,
          ),
        )
      }
    }

    function readScroll() {
      progress = clamp((window.scrollY - rangeTop) / rangeHeight)
    }

    function setActive(next: boolean) {
      if (next === active) return
      active = next
      onActiveChangeRef.current?.(next)
    }

    /* ---------------------------------------------------------- 主循环 */
    function frame(ts: number) {
      rafId = 0

      const dt = lastTs ? Math.min(64, ts - lastTs) : 16
      lastTs = ts

      // 帧率节流：有内容在动的区间跑 60fps，其余 30fps（省电，肉眼几乎无感）。
      // 上界要让调用方给足 —— 交接段也在动，不能提前掉到 30fps。
      const activeScroll = progress > fastStart && progress < fastEnd
      const minGap = 1000 / (activeScroll ? 60 : 30) - 1
      if (lastRenderTs && ts - lastRenderTs < minGap) {
        if (inView && visible) rafId = requestAnimationFrame(frame)
        return
      }
      lastRenderTs = ts

      onFrameRef.current({ progress, dt, ts, reduced: reduced.matches, setVar })

      if (inView && visible) rafId = requestAnimationFrame(frame)
    }

    const start = () => {
      if (!rafId && inView && visible) rafId = requestAnimationFrame(frame)
    }
    const stop = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
      lastRenderTs = 0
    }

    /**
     * reduced-motion 下画一帧。注意这里**刻意仍然让循环跑起来**：
     * 我们要停的是自转与视频，不是滚动驱动本身 —— 滚动驱动的那些量
     * （交接段下沉、文案离场、进度条）必须继续跟着滚动走。
     * 关掉循环就会连滚动一起冻住，那是另一个 bug。
     */
    const renderStatic = () => {
      inView = true
      visible = true
      setActive(true)
      frame(performance.now())
    }

    /* ------------------------------------------------------ 事件处理 */
    const onResize = () => {
      measure()
      readScroll()
      stop()
      if (reduced.matches) renderStatic()
      else start()
    }

    const onVisibility = () => {
      visible = !document.hidden
      setActive(inView && visible)
      if (visible) start()
      else stop()
    }

    const onReducedChange = () => {
      stop()
      if (reduced.matches) renderStatic()
      else start()
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting
        setActive(inView && visible)
        if (inView) {
          measure()
          readScroll()
          start()
        } else {
          stop()
        }
      },
      { rootMargin: '160px 0px', threshold: 0.01 },
    )
    io.observe(stageEl.parentElement ?? stageEl)

    window.addEventListener('scroll', readScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    reduced.addEventListener('change', onReducedChange)

    /* ---------------------------------------------------------- 启动 */
    measure()
    readScroll()
    if (reduced.matches) renderStatic()

    return () => {
      stop()
      io.disconnect()
      window.removeEventListener('scroll', readScroll)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      reduced.removeEventListener('change', onReducedChange)
      // 卸载时也要报下降沿：元素马上就没了，但视频元素在被回收前仍可能还在解码
      setActive(false)
    }
    // 回调刻意不在依赖里（走 ref）；这里只列真正影响循环形态的原始值
  }, [stageRef, range, fastStart, fastEnd, rangeCapRatio])
}

export default useScrollDriver
