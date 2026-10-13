'use client'

/**
 * HeroOrbit —— 3D 环形卡片轨道
 *
 * 视觉参考：design.minimax.cn 首页 hero 的「卡片环绕中心」构图（椭圆参数方程 +
 *          preserve-3d）。代码为独立实现，没有引入任何动画库。
 *
 * 三道视差同时叠加，是"有层次感"的全部原因：
 *   1. 点阵背景   反向微移  (-3u, -2v)
 *   2. 轨道容器   正向位移  (16u, 10v)
 *   3. 每张卡片   按深度加权 (18+22d)u —— 前排移动量是后排的 2.2 倍
 *
 * 用法（小主角 · Once Upon Me）：
 *   <HeroOrbit items={THEMES.map(t => ({ src: `/art/${t.key}.webp`, alt: t.label }))}>
 *     <h1 className="hero__brand">
 *       <span className="hero__brand-cn"><span className="mark">✦</span>小主角</span>
 *       <span className="sep" aria-hidden="true">·</span>
 *       <span className="serif">Once Upon Me</span>
 *     </h1>
 *     <HeroTypewriter lines={HERO_LINES} />
 *     <div className="hero__cta">
 *       <button className="btn" type="button">开始创作 →</button>
 *       <button className="btn btn--ghost" type="button">看一本成品</button>
 *     </div>
 *   </HeroOrbit>
 *
 * 真实用法以 app/page.tsx 为准（这份示例只是速查，改文案不用回来动这里）。
 *
 * 子元素的入场动画延迟写在 hero-orbit.css 的 :nth-child(2..4) 上，
 * 顺序变了要一起改。
 *
 * 注意：容器需要一个比视口高的父元素 + 内部 sticky，才能拿到 scrollProgress。
 *
 * 适用范围：**桌面 Web**。移动端不做（超出本项目范围），低于 1280px 由页面层
 * 用 `min-width` 兜底成横向滚动，所以组件里没有任何断点和 isMobile 分支 ——
 * 环上的卡片数和半轴都按宽屏调过，缩到手机宽度只会糊成一团，硬做不如不做。
 *
 * ---------------------------------------------------------------------------
 * ★ 首帧不靠 JS（2026-10-13 加的）
 *
 * 每张卡的 `<figure>` 带一份**预渲染内联样式**（`lib/orbit.ts` 的
 * `restInlineStyle`，t=0 那一帧）。理由有两条，第二条比第一条重：
 *
 *   1. 这 12 张图**就是这一页的 LCP**（见下面 img 上那条注释）。原来 CSS 写
 *      `opacity: 0` 等 JS 接管，等于把 LCP 从"图下载完"推到"hydration + 第一帧"。
 *   2. JS 挂了 / 用户禁了 JS，原来首屏只剩文案和一张空环。第三屏为同一件事
 *      删过一个 `rendered`（"内容缺失才是问题"），首屏现在同一条待遇。
 *
 * 摆位数学因此搬进 `lib/orbit.ts`，由**两个调用方**共用：这个组件的 frame()，
 * 与预渲染那一帧。半轴（rx/ry）是浏览器布局出来的数，构建期不知道，所以
 * 静态帧里写的是系数，由 `hero-orbit.css` 的 `--orbit-rx/--orbit-ry` 解 ——
 * 那对变量与这里的 `clientWidth × 0.56` / `clientHeight × 0.38` 是**契约**，
 * 改一处要改另一处。等价性由 `src/lib/orbit.test.ts` 摁着。
 */

import { useEffect, useRef } from 'react'
import { blurFilter, placeCard, restInlineStyle } from '@/lib/orbit'

export type OrbitItem = {
  /** 封面图。这一屏**刻意不放动效**，理由见 README §五「首屏卡片是静帧不是短片」 */
  src: string
  alt?: string
}

type Props = {
  items: OrbitItem[]
  /** 中心文案 */
  children?: React.ReactNode
  /** 自转角速度，rad/ms。默认 0.000072 ≈ 87 秒一圈 */
  angularSpeed?: number
  /**
   * 滚动到底时额外转过的角度（π 的倍数）。默认 0.34 → 61° ≈ 两张卡位
   *
   * 原来是 0.76（137°，转过去 4 张半）。转得太多会让"该走了"这一段读成
   * "还在转"：文案在 p=0.44 就该全部离场，之后每一分进度都属于交接段，
   * 轨道要做的是让位，不是继续表演。
   */
  scrollTurns?: number
  /**
   * 首屏自己的底色。
   *
   * `'bg'`（默认）＝ `.hero` 铺一层不透明的 `--bg`，首屏是"压在灰桌面上"的独立一层。
   * `'none'`＝ 底色让出去，露出页面级的背景层（<SceneBackdrop /> 那三幕场景）。
   *
   * ★ 为什么做成属性而不是让页面从外面覆盖：`.hero` 同时带着 `isolation: isolate`
   *   与满屏 sticky，从外面写 `.hero { background: transparent }` 要跨过组件边界去点
   *   别人的类名，改一次组件就得跟着改一次页面。属性选择器落在 hero-orbit.css 里，
   *   这件事就只有这一处知道。
   */
  backdrop?: 'bg' | 'none'
  className?: string
}

/* ------------------------------------------------------------------ 常量 */
const TAU = Math.PI * 2
/** 鼠标平滑系数：0.055 ≈ 0.3s 追上，丝滑不抖 */
const SMOOTHING = 0.055
/** 惯性衰减（每 16.67ms 保留的比例） */
const INERTIA_DECAY = 0.94
/** 拖拽灵敏度 */
const DRAG_SENSITIVITY = 0.0042

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

/** 平滑阶跃：t 在 [edge0, edge1] 内做 S 形过渡 */
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** 缓出：起步快、收尾慢 */
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 2)

/* -------------------------------------------------- 交接段（让位给下一节）
 * 与 hero-orbit.css §5 的文案离场时刻是**同一组数**，两处必须一起改。
 *
 * 三层文案在 --hero-copy-p 上依次离场（跨度 .30，最后一层 --out-start .20），
 * 走完 copy-p = .50；而 copy-p = smoothstep(.06, .84, p)，代回去得 p ≈ .45。
 * 所以交接段从 .45 起 —— 就是"三个差不多消失"的那一刻。
 *
 * 改这里任何一条时间，另一头的 .hero__copy 规则要跟着改，否则会出现
 * "文案还在、轨道已经开始下沉"这种两头不接的状态。 */
const HANDOFF_START = 0.45
const HANDOFF_END = 0.95
/** 卡片在交接段结束时保留的不透明度（不归零：留一点余影，下一节压上来时不是硬切） */
const HANDOFF_MIN_OPACITY = 0.08

/* ================================================================ 组件 */
export function HeroOrbit({
  items,
  children,
  angularSpeed = 0.000072,
  scrollTurns = 0.34,
  backdrop = 'bg',
  className,
}: Props) {
  const heroRef = useRef<HTMLDivElement>(null)
  const orbitRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    const heroEl = heroRef.current
    const orbitEl = orbitRef.current
    if (!heroEl || !orbitEl) return

    const itemEls = itemRefs.current.filter(Boolean) as HTMLElement[]
    const N = itemEls.length
    if (!N) return

    /* ------------------------------------------------------------ 状态 */
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    let rafId = 0
    let lastTs = 0
    let lastRenderTs = 0
    let inView = false
    let visible = true

    let phase = 0
    let dragOffset = 0
    let dragVelocity = 0
    let activePointer: number | null = null
    let dragLastX = 0
    let dragLastTs = 0

    /* 自转时钟的零点。★ 原来是 `ts * angularSpeed`，而 `ts` 是**从导航起点**算的：
       首帧会把环从"预渲染那一帧"（phase 0，见 lib/orbit.ts）直接跳到
       「加载耗时 × 角速度」那个角度 —— 1 秒 ≈ 0.072rad ≈ 前排卡 46px。
       改成相对这一刻取，第一帧 ≈ 0.9px，静态帧与 JS 第一帧接得上。
       ★ 转速、scrollTurns、交接段那三个数都不在这条路径上，一个没动。 */
    const phaseBase = performance.now()

    let targetX = 0, targetY = 0
    let sceneX = 0, sceneY = 0
    let scrollProgress = 0

    const lift = new Float32Array(N)
    const depths = new Float32Array(N)

    let rangeTop = 0
    let rangeHeight = 1

    /* ------------------------- CSS 变量写入去重（避免整棵样式树重算） */
    const lastVars = new Map<string, string>()
    function setVar(name: string, value: string) {
      if (lastVars.get(name) === value) return
      lastVars.set(name, value)
      heroEl!.style.setProperty(name, value)
    }

    /* ------------------- 逐卡写入去重（与上面 setVar 同一条理由）
       每帧无条件写 12 张卡的 4 个属性是 48 次 style 写入 —— 而 transform 之外的
       三个多数帧根本没变（filter 量化之后更是十几帧才动一档，见 lib/orbit.ts
       的 blurFilter）。比较字符串比让它走一遍样式重算便宜。 */
    const lastCardStyle = new WeakMap<HTMLElement, [string, string, string, string]>()
    function setCardStyle(el: HTMLElement, t: string, f: string, o: string, z: string) {
      let last = lastCardStyle.get(el)
      if (!last) {
        last = ['', '', '', '']
        lastCardStyle.set(el, last)
      }
      if (last[0] !== t) {
        last[0] = t
        el.style.transform = t
      }
      if (last[1] !== f) {
        last[1] = f
        el.style.filter = f
      }
      if (last[2] !== o) {
        last[2] = o
        el.style.opacity = o
      }
      if (last[3] !== z) {
        last[3] = z
        el.style.zIndex = z
      }
    }

    /* ------------------------------------------------ 几何测量与滚动量 */
    function measure() {
      const wrap = heroEl!.parentElement
      if (!wrap) return
      rangeTop = wrap.getBoundingClientRect().top + window.scrollY
      rangeHeight = Math.max(
        1,
        Math.min(
          Math.max(wrap.offsetHeight - heroEl!.offsetHeight, 1),
          heroEl!.offsetHeight * 0.92,
        ),
      )
    }

    function readScroll() {
      scrollProgress = clamp((window.scrollY - rangeTop) / rangeHeight)
    }

    /* ---------------------------------------------------------- 主循环 */
    function frame(ts: number) {
      rafId = 0

      const dt = lastTs ? Math.min(64, ts - lastTs) : 16
      lastTs = ts

      // 帧率节流：有内容在动的区间跑 60fps，其余 30fps（省电，肉眼几乎无感）。
      // 上界跟着交接段走 —— 交接段轨道在动，不能提前掉到 30fps。
      const activeScroll =
        scrollProgress > 0.015 && scrollProgress < HANDOFF_END + 0.02
      const minGap = 1000 / (activeScroll ? 60 : 30) - 1
      if (lastRenderTs && ts - lastRenderTs < minGap) {
        if (inView && visible) rafId = requestAnimationFrame(frame)
        return
      }
      lastRenderTs = ts

      /* 1. 鼠标平滑 */
      sceneX += (targetX - sceneX) * SMOOTHING
      sceneY += (targetY - sceneY) * SMOOTHING

      /* 2. 相位：自转 + 滚动 + 拖拽。自转是相对 phaseBase 的（见上） */
      phase =
        (reduced.matches ? 0 : (ts - phaseBase) * angularSpeed) +
        scrollProgress * Math.PI * scrollTurns +
        dragOffset

      /* 3. 惯性衰减 */
      if (activePointer === null && Math.abs(dragVelocity) > 1e-5) {
        dragOffset += dragVelocity * dt
        dragVelocity *= Math.pow(INERTIA_DECAY, dt / 16.67)
      }

      /* 3.5 交接进度：文案三层全离场后才开始动，0 = 照常表演，1 = 已经让位 */
      const out = smoothstep(HANDOFF_START, HANDOFF_END, scrollProgress)
      // 淡出写在每张卡片上，而不是轨道容器上 —— 容器带 preserve-3d，
      // 一旦 opacity < 1 就会把 3D 子元素压平，遮挡排序当场失效。
      const fadeOut = 1 - (1 - HANDOFF_MIN_OPACITY) * out

      /* 4. 椭圆半轴（都用 hero 自身的盒子，不用 window.innerWidth —
            窄于 min-width 的窗口会横向滚动，innerWidth 会比布局宽度小）
            ★ 这两个数与 hero-orbit.css 的 --orbit-rx / --orbit-ry 是同一对：
              静态帧的 transform 就是乘的那两个变量。改这里要同步改那里。 */
      const rx = Math.min(heroEl!.clientWidth * 0.56, 1420)
      const ry = Math.min(heroEl!.clientHeight * 0.38, 285)

      /* 5. 先算深度 —— 决定谁在最前面，也决定弹簧的目标值 */
      for (let i = 0; i < N; i++) {
        depths[i] = (Math.sin(phase + (i / N) * TAU) + 1) / 2
      }

      /* 6. 逐卡摆位。★ 数学在 lib/orbit.ts 的 placeCard 里，与预渲染那一帧
            （restInlineStyle）是**同一份** —— 这一屏的静态首帧就是靠这条
            不靠 JS 画出来的（见那个文件头）。搬动等价性由 orbit.test.ts 摁着。 */
      for (let i = 0; i < N; i++) {
        const el = itemEls[i]
        const d = depths[i]

        // 前冲弹簧：只有最前面那张被"顶"一下
        const liftTarget = 0.34 * smoothstep(0.92, 1, d)
        lift[i] += (liftTarget - lift[i]) * (1 - Math.pow(0.88, dt / 16.67))

        const c = placeCard({ i, n: N, phase, rx, ry, sceneX, sceneY, fadeOut, lift: lift[i] })

        setCardStyle(
          el,
          `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, ${c.z.toFixed(2)}px) ` +
            `translate(-50%, -50%) rotate(${c.rot.toFixed(2)}deg) scale(${c.scale.toFixed(4)})`,
          blurFilter(c.blur),
          c.opacity.toFixed(4),
          String(c.zIndex),
        )
      }

      /* 7. 三个不同量级的视差 = 层次感 */
      setVar('--hero-grid-opacity', (0.58 * (1 - easeOut(out))).toFixed(4))
      setVar('--hero-grid-x', `${(-3 * sceneX).toFixed(2)}px`)
      setVar('--hero-grid-y', `${(-2 * sceneY).toFixed(2)}px`)
      setVar('--hero-scene-x', `${(16 * sceneX).toFixed(2)}px`)
      setVar('--hero-scene-y', `${(10 * sceneY).toFixed(2)}px`)

      // 只发布一个总进度；逐个错开的淡出由 CSS 的 --out-start 决定（见 §5）。
      // 区间从 (.03,.24) 摊到 (.06,.84)：原来三层文案在头 19% 的滚动里就走完了，
      // 剩下 80% 只剩轨道空转 —— 那是"第一页转得太久"的真正原因。
      setVar('--hero-copy-p', smoothstep(0.06, 0.84, scrollProgress).toFixed(4))

      // 交接进度：轨道下沉 / 缩小由 CSS 消费（§3），淡出由 JS 逐卡消费（§3.5）
      setVar('--hero-out', out.toFixed(4))

      orbitEl!.dataset.orbitReady = 'true'
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
    const renderStatic = () => {
      inView = true
      visible = true
      frame(performance.now())
    }

    /* ------------------------------------------------------ 事件处理 */
    const onPointerMove = (e: PointerEvent) => {
      const r = heroEl!.getBoundingClientRect()
      targetX = 2 * clamp((e.clientX - r.left) / r.width) - 1
      targetY = 2 * clamp((e.clientY - r.top) / r.height) - 1

      if (e.pointerId === activePointer) {
        const now = performance.now()
        const dt = Math.max(8, now - dragLastTs)
        const delta = DRAG_SENSITIVITY * (e.clientX - dragLastX)
        dragOffset += delta
        dragVelocity = clamp(delta / dt, -0.0024, 0.0024)
        dragLastX = e.clientX
        dragLastTs = now
      }
    }

    const onPointerLeave = () => {
      targetX = 0
      targetY = 0
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      activePointer = e.pointerId
      dragLastX = e.clientX
      dragLastTs = performance.now()
      dragVelocity = 0
      orbitEl!.setPointerCapture(e.pointerId)
      heroEl!.dataset.orbitDragging = 'true'
      e.preventDefault()
    }

    const endDrag = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return
      activePointer = null
      delete heroEl!.dataset.orbitDragging
    }

    const onResize = () => {
      measure()
      readScroll()
      stop()
      if (reduced.matches) renderStatic()
      else start()
    }

    /** 藏起来的标签页不跑循环：没人看的时候不该占着机器。
     *  回到前台由 start() 重新起帧，首帧直接落位到当前滚动量。 */
    const onVisibility = () => {
      visible = !document.hidden
      if (visible) start()
      else stop()
    }

    const onBlur = () => {
      targetX = 0
      targetY = 0
    }

    const onReducedChange = () => {
      stop()
      if (reduced.matches) renderStatic()
      else start()
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting
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
    io.observe(heroEl.parentElement ?? heroEl)

    heroEl.addEventListener('pointermove', onPointerMove, { passive: true })
    heroEl.addEventListener('pointerleave', onPointerLeave, { passive: true })
    orbitEl.addEventListener('pointerdown', onPointerDown)
    orbitEl.addEventListener('pointerup', endDrag)
    orbitEl.addEventListener('pointercancel', endDrag)
    window.addEventListener('scroll', readScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    reduced.addEventListener('change', onReducedChange)

    /* ---------------------------------------------------------- 启动 */
    measure()
    readScroll()
    if (reduced.matches) renderStatic()

    return () => {
      stop()
      io.disconnect()
      heroEl.removeEventListener('pointermove', onPointerMove)
      heroEl.removeEventListener('pointerleave', onPointerLeave)
      orbitEl.removeEventListener('pointerdown', onPointerDown)
      orbitEl.removeEventListener('pointerup', endDrag)
      orbitEl.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('scroll', readScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      reduced.removeEventListener('change', onReducedChange)
      delete orbitEl.dataset.orbitReady
      delete heroEl.dataset.orbitDragging
    }
  }, [items, angularSpeed, scrollTurns])

  return (
    <section className={`hero-experience ${className ?? ''}`}>
      <div className="hero" ref={heroRef} data-hero-experience data-backdrop={backdrop}>
        {/* 点阵网格 */}
        <div className="hero__ambient" aria-hidden="true" />
        <div className="hero__glow" aria-hidden="true" />

        {/* 3D 轨道 */}
        <div className="hero-orbit" ref={orbitRef} data-hero-orbit aria-hidden="true">
          {items.map((item, i) => (
            <figure
              key={item.src}
              className="hero-orbit__item"
              data-orbit-index={i}
              /* ★ 预渲染那一帧（phase 0）：JS 跑起来之前，这一屏就该是一张完整的环，
                 而不是 12 张全透明、全叠在中心的卡 —— 这 12 张就是这一页的 LCP，
                 被 hydration 挡在门外等于 LCP 从"图加载完"退到"JS 执行完"。
                 x / y 存的是系数，半轴由 CSS 解（见 lib/orbit.ts 与 hero-orbit.css）。 */
              style={restInlineStyle(i, items.length)}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
            >
              {/* 静帧。这一屏曾经是 12 段 4 秒短片（只有转到前排才播、至多 4 条并发），
                  换回静帧的理由与实测见 README §五「首屏曾经有 12 段卡片动效」。
                  ★ 刻意**不写** loading="lazy"：这 12 张全都在首屏的环上，
                    一张不落，懒加载它们等于让首屏先画一个空环再去取图 ——
                    它们就是这一页的 LCP。fetchPriority 给浏览器排个先后。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.src}
                alt={item.alt ?? ''}
                decoding="async"
                fetchPriority={i < 4 ? 'high' : 'auto'}
              />
            </figure>
          ))}
        </div>

        {/* 中心文案 */}
        <div className="hero__copy">{children}</div>
      </div>
    </section>
  )
}

export default HeroOrbit
