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
 */

import { useEffect, useRef } from 'react'

export type OrbitItem = {
  /** 静态图（与 video 二选一） */
  src?: string
  /** 视频地址；会懒加载，且只在转到最前面时才播放 */
  video?: string
  /** 视频封面（必填，避免加载前空白） */
  poster?: string
  alt?: string
}

type Props = {
  items: OrbitItem[]
  /** 中心文案 */
  children?: React.ReactNode
  /** 自转角速度，rad/ms。默认 0.000072 ≈ 87 秒一圈 */
  angularSpeed?: number
  /** 滚动到底时额外转过的角度（π 的倍数）。默认 0.76 → 137° */
  scrollTurns?: number
  className?: string
}

/* ------------------------------------------------------------------ 常量 */
const TAU = Math.PI * 2
/** 同时播放的视频数量上限（只有最靠前的这几张会播） */
const MAX_CONCURRENT_VIDEOS = 4
/** 深度高于此值才播视频 */
const VIDEO_PLAY_DEPTH = 0.72
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

/* ================================================================ 组件 */
export function HeroOrbit({
  items,
  children,
  angularSpeed = 0.000072,
  scrollTurns = 0.76,
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

    /* ------------------------------------------------------ 视频懒加载 */
    function syncVideo(el: HTMLElement, shouldPlay: boolean) {
      const v = el.querySelector('video')
      if (!v) return
      if (shouldPlay) {
        // 除了「本组件还没让它播」，还要看元素**当前**是不是真的在播：
        // 浏览器会在标签页隐藏、省电模式、系统抢占时自己把画面停掉，
        // 而 dataset 是我们自己的账本，不会跟着变。只看账本的话，
        // 回到前台就会以为「已经在播」而不再调 play()，前排这几张永久停住。
        if (v.dataset.playing !== 'true' || v.paused) {
          // 首次要播时才真正下载（模板里用 preload="none"）
          if (!v.getAttribute('src') && v.dataset.orbitSrc) {
            v.src = v.dataset.orbitSrc
            v.load()
          }
          v.dataset.playing = 'true'
          v.play()?.catch(() => { v.dataset.playing = 'false' })
        }
      } else if (v.dataset.playing === 'true') {
        v.pause()
        v.dataset.playing = 'false'
      }
    }

    function pauseAll() {
      itemEls.forEach((el) => syncVideo(el, false))
    }

    /* ---------------------------------------------------------- 主循环 */
    function frame(ts: number) {
      rafId = 0

      const dt = lastTs ? Math.min(64, ts - lastTs) : 16
      lastTs = ts

      // 帧率节流：滚动活跃区跑 60fps，其余 30fps（省电，肉眼几乎无感）
      const activeScroll =
        scrollProgress > 0.015 && scrollProgress < 0.52
      const minGap = 1000 / (activeScroll ? 60 : 30) - 1
      if (lastRenderTs && ts - lastRenderTs < minGap) {
        if (inView && visible) rafId = requestAnimationFrame(frame)
        return
      }
      lastRenderTs = ts

      /* 1. 鼠标平滑 */
      sceneX += (targetX - sceneX) * SMOOTHING
      sceneY += (targetY - sceneY) * SMOOTHING

      /* 2. 相位：自转 + 滚动 + 拖拽 */
      phase =
        (reduced.matches ? 0 : ts * angularSpeed) +
        scrollProgress * Math.PI * scrollTurns +
        dragOffset

      /* 3. 惯性衰减 */
      if (activePointer === null && Math.abs(dragVelocity) > 1e-5) {
        dragOffset += dragVelocity * dt
        dragVelocity *= Math.pow(INERTIA_DECAY, dt / 16.67)
      }

      /* 4. 椭圆半轴（都用 hero 自身的盒子，不用 window.innerWidth —
            窄于 min-width 的窗口会横向滚动，innerWidth 会比布局宽度小） */
      const rx = Math.min(heroEl!.clientWidth * 0.56, 1420)
      const ry = Math.min(heroEl!.clientHeight * 0.38, 285)

      /* 5. 先算深度，决定谁在最前面 */
      for (let i = 0; i < N; i++) {
        depths[i] = (Math.sin(phase + (i / N) * TAU) + 1) / 2
      }
      const frontSet = new Set(
        [...depths.keys()].sort((a, b) => depths[b] - depths[a]).slice(0, MAX_CONCURRENT_VIDEOS),
      )

      /* 6. 逐卡摆位 */
      for (let i = 0; i < N; i++) {
        const el = itemEls[i]
        const a = phase + (i / N) * TAU
        const d = depths[i]

        // X：椭圆横向 × 近大远小补偿 + 按深度加权的视差
        const x =
          Math.cos(a) * rx * (0.82 + 0.18 * d) * (1.2 + 0.06 * smoothstep(0.72, 0.96, d)) +
          sceneX * (18 + 22 * d)

        // Y：椭圆纵向 + 后排上抬（避免被中心文案压住）
        let y = Math.sin(a) * ry * 0.89 + sceneY * (10 + 12 * d) - 16 * Math.pow(1 - d, 1.7)
        // 前排把弧线压平一点，让最前面那张稳稳落在视线下方
        const frontY = 0.89 * ry + 22 * sceneY
        y += (frontY - y) * smoothstep(0.68, 0.9, d)

        // Z：真实深度，浏览器据此做遮挡排序
        const z = (d - 0.5) * 360

        // 前冲弹簧：只有最前面那张被"顶"一下
        const liftTarget = 0.34 * smoothstep(0.92, 1, d)
        lift[i] += (liftTarget - lift[i]) * (1 - Math.pow(0.88, dt / 16.67))

        const scale = 0.58 + 0.58 * d + lift[i]
        const rot = 5.2 * Math.sin(1.6 * a + 0.8 * i) * Math.pow(1 - d, 0.72)
        const blur = d < 0.5 ? 5.2 * Math.pow(0.5 - d, 1.3) : 0
        const opacity = d >= 0.5 ? 1 : 0.28 + (d / 0.5) * 0.72

        el.style.transform =
          `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) ` +
          `translate(-50%, -50%) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`
        el.style.filter = blur > 0.08 ? `blur(${blur.toFixed(2)}px)` : 'none'
        el.style.opacity = opacity.toFixed(4)
        el.style.zIndex = String(Math.round(10 + 80 * d))

        syncVideo(
          el,
          !reduced.matches && inView && visible && d > VIDEO_PLAY_DEPTH && frontSet.has(i),
        )
      }

      /* 7. 三个不同量级的视差 = 层次感 */
      setVar(
        '--hero-grid-opacity',
        (0.58 * (1 - easeOut(clamp((scrollProgress - 0.36) / 0.32)))).toFixed(4),
      )
      setVar('--hero-grid-x', `${(-3 * sceneX).toFixed(2)}px`)
      setVar('--hero-grid-y', `${(-2 * sceneY).toFixed(2)}px`)
      setVar('--hero-scene-x', `${(16 * sceneX).toFixed(2)}px`)
      setVar('--hero-scene-y', `${(10 * sceneY).toFixed(2)}px`)

      // 只发布一个总进度；逐个错开的淡出由 CSS 的 --out-start 决定（见 §5）
      setVar('--hero-copy-p', smoothstep(0.03, 0.24, scrollProgress).toFixed(4))

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

    const onVisibility = () => {
      visible = !document.hidden
      if (visible) start()
      else {
        stop()
        // 标签页藏起来就该停解码，别用电池换一个没人看的画面。
        // 回到前台时主循环会重新 syncVideo，靠上面那句 v.paused 恢复播放。
        pauseAll()
      }
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
          pauseAll()
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
      pauseAll()
      delete orbitEl.dataset.orbitReady
      delete heroEl.dataset.orbitDragging
    }
  }, [items, angularSpeed, scrollTurns])

  return (
    <section className={`hero-experience ${className ?? ''}`}>
      <div className="hero" ref={heroRef} data-hero-experience>
        {/* 点阵网格 */}
        <div className="hero__ambient" aria-hidden="true" />
        <div className="hero__glow" aria-hidden="true" />

        {/* 3D 轨道 */}
        <div className="hero-orbit" ref={orbitRef} data-hero-orbit aria-hidden="true">
          {items.map((item, i) => (
            <figure
              key={item.video ?? item.src ?? i}
              className="hero-orbit__item"
              data-orbit-index={i}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
            >
              {item.video ? (
                <video
                  data-orbit-src={item.video}
                  poster={item.poster}
                  muted
                  loop
                  playsInline
                  preload="none"
                  disablePictureInPicture
                  tabIndex={-1}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.src} alt={item.alt ?? ''} loading="lazy" decoding="async" />
              )}
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
