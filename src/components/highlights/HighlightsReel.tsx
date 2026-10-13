'use client'

/**
 * HighlightsReel —— 第三屏：项目亮点
 *
 * 五条亮点，横向轮播。视觉上它是**首屏那个环的压平版**：同样的近大远小、
 * 同样的后排糊、同样的陶土色只点一处，所以整页读起来是一套系统，不是三段拼起来的东西。
 *
 * =========================================================================
 * ## 谁写 transform —— 这一屏最容易做错的一件事，先说清楚
 *
 * 一个元素只能有一个 transform 的主人。四层各管各的：
 *
 * | 层 | 主人 | 管什么 |
 * | --- | --- | --- |
 * | `.hl__slot` | **CSS** | 轮播位移 + 深度（scale/opacity/blur/z） |
 * | `.hl__card` | **GSAP** | 倾斜（rotationX/Y）与进场淡入（autoAlpha） |
 * | `.hl__card` 的抬起 | **CSS `translate`** | 独立属性，与 transform 复合，不抢笔 |
 * | `.hl__art` | **GSAP** | 插画层的反向视差（x/y） |
 * | `--hl-gx/gy` | **GSAP** | 暖光斑位置（CSS 变量，0–1 比例） |
 *
 * 抬起一开始也走 GSAP 的 `y`，然后发现它和进场可能撞在同一个属性上：
 * 人在进场动画跑到一半时把鼠标放上卡片，两个 tween 就抢一个 y。
 * 换成 CSS 的独立 `translate` 属性之后，两者复合在一起，谁也不用让谁；
 * 卡片进场因此**只淡入不位移**，上升的重量感留给标题与控制条。
 *
 * 把轮播位移和倾斜写进同一个 `transform` 是另一个等价的笑话：CSS 的 `transition`
 * 会和 GSAP 的每帧抢，结果是一种"糊但有延迟"的怪抖，从代码里看不出来。
 *
 * ## ★ `perspective` 挂在 slot 上，不挂在 reel 上
 *
 * `hero-orbit.css` 记着一条已经付过学费的坑：带 `preserve-3d` 的祖先一旦
 * `opacity < 1` 或带 `filter`，就会把 3D 子元素压平，遮挡排序当场失效。
 * 这一屏的 slot 正是又 `opacity < 1` 又 `blur()` 的，所以：
 *
 * - **不写 `preserve-3d`**，perspective 挂在每个 slot 自己身上；
 * - 每张卡只在自己那层 3D 空间里转，卡与卡的前后关系交给 `z-index`。
 *
 * 代价是"五张卡共用一个灭点"变成"各自一个灭点"。6° 的倾角下看不出差别，
 * 而各自一个灭点反而更接近"桌上摊着五张纸"的读法。
 *
 * ## 不做滚轮劫持；自动轮播有，但底下那排控件没有
 *
 * 上一屏整屏都在用滚轮翻页（340vh）。到这一屏偷偷改滚轮语义，是最恶劣的一种坏。
 *
 * 自动轮播原先写过一条"不做"，后来按产品要求改成"一直走"，代价是**必须**配中断条件，
 * 见下面 `playing` 那三个输入。底部那排圆点 + 箭头 + 暂停键**已经整条删掉**（画面太碎），
 * 于是"停一下"这件事只剩三种给力的做法：
 *
 *   1. 指针一进这一节就停（鼠标用户）；
 *   2. **键盘焦点一进这一节就停** —— 所以 `.hl__viewport` 自己带 `tabIndex={0}`：
 *      删掉圆点之后本节里没有任何可聚焦元素了，不给它一个 tab 落点，
 *      键盘用户就既进不来也翻不动（`onKeyDown` 挂在节上，焦点不在节内根本不触发）。
 *      Tab 进来 → 停住 → ← → / Home / End 自己翻 → Tab 出去 → 恢复。
 *      ★ 只算**键盘**带来的焦点：Chrome 点一个 `tabindex` 元素也会给它焦点，
 *        那样"点邻居卡"会把自动播永久停住（焦点再也走不掉）。见 `viaPointerRef`。
 *   3. `prefers-reduced-motion` 下一次都不启动。
 *
 * ★ 记一条真实的让步：WCAG 2.2.2 要的是"看得见、点得到"的暂停手段，
 *   上面第 2 条只在键盘用户**想到要 Tab** 时成立。删掉那颗暂停键是产品决定，
 *   不是无障碍改进 —— 已记进 README §五「已知取舍」，将来要恢复就照 git 里那一版拿回来。
 *
 * ## 键盘：只在本节内部接，并且 stopPropagation
 *
 * `StorybookFlip` 在 `window` 上无条件接 ← →（**哪怕书在屏幕外也会翻一页**）。
 * React 的监听器挂在 root container 上，位置在 window 之前，
 * 所以本节里的 `e.stopPropagation()` 挡得住它 —— 这是不改对方文件的唯一办法，
 * 而那个文件此刻正被另一条会话编辑。对方那个全局接法本身是 bug，
 * 已记进 README「已知取舍」，等那一边落地再单独修。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import gsap from 'gsap'
/* ★ 这一行不能省，而且 **`pnpm typecheck` 抓不到它被省掉**。
   gsap 的 .d.ts 把插件类声明成了全局（为了让你在类型里写 `ScrollTrigger`），
   所以只写 `gsap.registerPlugin(ScrollTrigger)` 而不 import，
   tsc 一路绿灯、eslint 也不响，只有浏览器会抛 `ReferenceError: ScrollTrigger is not defined`。
   这条是实测撞出来的：删掉这行之后 typecheck 与 lint 全绿，页面第三屏整节白屏。 */
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { reelDepth, reelJumped, reelState, wrapActive } from '@/lib/reel'
import { normalizePointer, tiltFromPointer } from '@/lib/tilt'
import { HIGHLIGHTS, artPath } from './highlights'

/* ------------------------------------------------------------------ 常量 */

/** 指针跟随的平滑时长。0.4s ≈ "纸有重量"；再短像贴图，再长像拖泥带水。 */
const TILT_DURATION = 0.4
/** 插画层比卡片再慢一点 —— 两层不同速才有"框里的画"这个错觉。 */
const ART_DURATION = TILT_DURATION + 0.12
/**
 * 自动轮播的间隔。
 *
 * 6500 → 3200 → **2000**（用户两次要求加快）。绕一圈 5 × 2 = 10 秒。
 * 2000ms **读不完任何一条**：正文最长的那条（第 3 条）约 110 个汉字、三到四行，
 * 中文默读按 8–10 字/秒算是 11–14 秒。这个缺口比 6.5s 那一版更大，不是更小 ——
 * 它是自动轮播的固有代价，写在这里而不是藏起来，补偿办法是"碰到就停"：
 * 指针一进这一节、键盘一进这一节、标签页一进后台，立刻停住。
 *
 * 与补间的关系：`.hl__slot` 的位移补间是 0.56s（CSS 里，两个数咬在一起）。
 * 2000 - 560 = 1.44 秒是**停着的**，占一轮 72%。再往下压间隔，先动的是补间
 * 而不是间隔 —— 否则卡片永远在滑，读起来就是"一直在飞"。
 */
const AUTOPLAY_MS = 2000

type CardCtl = {
  rotX: gsap.QuickToFunc
  rotY: gsap.QuickToFunc
  artX: gsap.QuickToFunc
  artY: gsap.QuickToFunc
  glowX: gsap.QuickToFunc
  glowY: gsap.QuickToFunc
}

type Rect = { left: number; top: number; w: number; h: number }

const pad2 = (n: number) => String(n).padStart(2, '0')

/* ================================================================== 组件 */

export function HighlightsReel() {
  const [active, setActive] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [behindTab, setBehindTab] = useState(false)
  /** 手动翻一次就换一颗种子，让 2s 从头计 —— 不然刚点到第 3 条，
   *  0.5 秒后就被自动播扔去第 4 条，等于把人刚做的选择吃掉。 */
  const [timerSeed, setTimerSeed] = useState(0)
  const count = HIGHLIGHTS.length
  const slots = reelState(active, count)

  /** 上一次交互是指针还是键盘 —— 用来分辨 focus 是谁带来的，见 onFocusCapture。 */
  const viaPointerRef = useRef(false)
  /** 上一轮提交给 DOM 的那些偏移 —— 给下面判断"谁跨界了"用。 */
  const prevOffsetsRef = useRef<number[]>([])

  /**
   * 环形轮播绕回去那一下，恰好有**一张**卡要从最左跨到最右。
   * 不关掉它这一拍的补间，就会看到一张糊着的卡横穿整个轮播中央 —— 像页面坏了。
   * 判据（"位移超过半圈"）与它的推导在 `reelJumped` 里，有测试。
   *
   * ★ 必须在**渲染时**算出来、与新的 `--hl-offset` 同一个 commit 交出去。
   *   等 effect 跑完再关过渡就晚了：浏览器已经看见"旧位置 + 有 transition"，动画照跑。
   */
  const offsets = slots.map((s) => s.offset)
  const jumped = reelJumped(prevOffsetsRef.current, offsets, count)

  /** 每次提交之后记下这一轮的偏移，给下一次渲染判断"谁跨界了"用。 */
  useEffect(() => {
    prevOffsetsRef.current = offsets
  })

  /** 真的在走吗。三个"临时让路"任一成立就停。
   *  （原来还有第四个：用户按暂停键。那排控件整条删掉了，理由与代价见文件头。） */
  const playing = !hovered && !focused && !behindTab

  const sectionRef = useRef<HTMLElement>(null)

  const go = useCallback(
    (delta: number) => {
      // 键盘也走环形：这是轮播，第 5 条再按 → 就该回到第 1 条（与画面一致）。
      setActive((cur) => wrapActive(cur, delta, count))
      setTimerSeed((n) => n + 1)
    },
    [count],
  )
  const goTo = useCallback((index: number) => {
    setActive(index)
    setTimerSeed((n) => n + 1)
  }, [])

  /* ------------------------------------------------ 自动轮播
   *
   * ★ 这一条推翻了 spec 与 README 原先的"不做自动轮播"。理由是产品决定，
   *   不是技术发现，所以规矩改成了"**碰到就停**"，见下面三个中断条件。
   *
   * 用 setInterval 而不是 rAF：这是离散步进，不是连续量，
   * 拿 rAF 每帧算"到点了没"是白烧一帧。
   *
   * `prefers-reduced-motion` 下**一次都不启动**（不是启动后再停）：
   * 减少动效要的是"没有不该动的东西在动"，不是"动得很克制"。
   */
  useEffect(() => {
    if (!playing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const id = window.setInterval(() => {
      setActive((cur) => wrapActive(cur, 1, count))
    }, AUTOPLAY_MS)
    return () => window.clearInterval(id)
  }, [playing, count, timerSeed])

  /* ------------------------------------------- 后台标签页要停
   *
   * 与首屏停视频解码同一条理由：没人看的时候不该耗机器。
   * 这里省的虽然是几个毫秒的 setState，规矩是同一个。
   */
  useEffect(() => {
    const onVis = () => setBehindTab(document.hidden)
    onVis()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  /* ------------------------------------------------- 进场编排（ScrollTrigger）
   *
   * 只动 GSAP 拥有的那一层（`.hl__card` 的 autoAlpha），CSS 拥有的 `.hl__slot` 一律不碰。
   *
   * ★ 卡片这一段**只淡入，不带上移**。
   *   倾斜的 quickTo 写的是 `.hl__card` 的 `transform`；进场若也写 `y`，
   *   两者就是同一个属性上的两个主人。一个元素一个 transform 主人，
   *   这条规矩在 `hero-orbit.css` 与这里各值一次教训。
   *   标题没有倾斜，所以它可以安心用 `y` —— 进场需要那点上升的重量感。
   *   （底部控制条那一排本来也用它，现在整条删了，见文件头。）
   *
   * ★ 初始的"藏"是 JS 做的，不是 CSS 做的：禁用 JS、或者爬虫抓静态 HTML 时，
   *   五张卡本来就是可见的完整内容。用 CSS 先藏起来再靠 JS 揭开，
   *   等于给「JS 没跑起来」这个状态准备了一份空白页。
   */
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    gsap.registerPlugin(ScrollTrigger)

    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia()

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline({
          defaults: { ease: 'power3.out' },
          scrollTrigger: { trigger: section, start: 'top 88%', once: true },
        })
        tl.from('.hl__head > *', { autoAlpha: 0, y: 26, duration: 0.6, stagger: 0.09 }).from(
          '.hl__card',
          { autoAlpha: 0, duration: 0.62, stagger: { each: 0.07, from: 'center' } },
          '-=0.34',
        )
      })
      // reduce 分支刻意什么都不写：不建 tween，卡片就停在终态（可见、平放）。
    }, section)

    return () => ctx.revert()
  }, [])

  /* ---------------------------------------------------- 指针跟随（hover 倾斜）
   *
   * 用**原生**监听而不是 React 的 onPointerMove：每帧一次的量不该走 React 调度，
   * 而且 handler 要能稳定命名，卸载时 removeEventListener 才拿得到同一个函数。
   *
   * 依赖只有 `active`：哪几张卡允许倾斜会跟着它变。
   */
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    /** rect 缓存。滚动/resize 只标脏，下一次真的有指针移动才重量 ——
     *  每次 pointermove 都读布局盒是在主动制造强制同步布局。 */
    const rects = new Map<HTMLElement, Rect>()
    let dirty = true

    const measure = (card: HTMLElement): Rect => {
      const b = card.getBoundingClientRect()
      const r = { left: b.left, top: b.top, w: b.width, h: b.height }
      rects.set(card, r)
      return r
    }

    /**
     * 取 rect。**指针落在缓存的框外面就直接重量一次。**
     *
     * `dirty` 那个标记只挡得住"滚动事件已经派发过"的情形：同一次同步代码里
     * `scrollIntoView()` 之后立刻读，scroll 事件还没 fire，拿到的是旧位置。
     * 实测就是这样：指针在右上角本该 `ny = −0.97`，却读到 `−0.478`，
     * 倾斜角因此少了一半（−5.83° 变 −2.87°）；同一帧光斑的 `glowV` 给出 0.261，
     * 两个互不相干的量指向同一个错误的 ny —— 所以那不是手感问题，是真的用了旧框。
     * 真人操作撞不到（滚轮滚动时 scroll 事件早就 fire 了），
     * 但这几行把这一整类问题关掉，比记住"别在同一个 tick 里滚完就摸"便宜。
     */
    const rectFor = (card: HTMLElement, clientX: number, clientY: number) => {
      const cached = rects.get(card)
      if (cached) {
        const px = clientX - cached.left
        const py = clientY - cached.top
        if (px >= 0 && py >= 0 && px <= cached.w && py <= cached.h) return { px, py, cached }
      }
      const r = measure(card)
      return { px: clientX - r.left, py: clientY - r.top, cached: r }
    }

    const ctls = new WeakMap<HTMLElement, CardCtl>()
    const ctlFor = (card: HTMLElement): CardCtl => {
      let c = ctls.get(card)
      if (!c) {
        const art = card.querySelector<HTMLElement>('.hl__art') ?? card
        const q = (el: HTMLElement, prop: string, duration: number) =>
          gsap.quickTo(el, prop, { duration, ease: 'power2.out' })
        c = {
          rotX: q(card, 'rotationX', TILT_DURATION),
          rotY: q(card, 'rotationY', TILT_DURATION),
          artX: q(art, 'x', ART_DURATION),
          artY: q(art, 'y', ART_DURATION),
          glowX: q(card, '--hl-gx', TILT_DURATION * 0.6),
          glowY: q(card, '--hl-gy', TILT_DURATION * 0.6),
        }
        ctls.set(card, c)
      }
      return c
    }

    /** 回到平放态。离开卡片、以及不允许倾斜的那几张，都是这个状态。 */
    const rest = (card: HTMLElement) => {
      const t = tiltFromPointer(0, 0)
      const c = ctlFor(card)
      c.rotX(t.rotateX)
      c.rotY(t.rotateY)
      c.artX(t.artX)
      c.artY(t.artY)
      c.glowX(t.glowU)
      c.glowY(t.glowV)
    }

    const onEnter = (e: PointerEvent) => {
      if (reduced.matches) return
      const card = e.currentTarget as HTMLElement
      // 抬起交给 CSS（`translate` 独立属性），这里只留一个状态标记。
      card.dataset.hover = 'true'
      measure(card)
    }

    const onLeave = (e: PointerEvent) => {
      const card = e.currentTarget as HTMLElement
      delete card.dataset.hover
      // ★ 同一组属性反向补回。快速把鼠标甩出卡外时不写回的话，
      //   卡片会永久停在甩出去那一刻的角度上 —— 这类效果最常见的破绽就是它。
      rest(card)
    }

    const onMove = (e: PointerEvent) => {
      if (reduced.matches) return
      const card = e.currentTarget as HTMLElement
      if (dirty) {
        rects.clear()
        dirty = false
      }
      const { px, py, cached } = rectFor(card, e.clientX, e.clientY)
      const { nx, ny } = normalizePointer(px, py, cached)
      const t = tiltFromPointer(nx, ny)
      const c = ctlFor(card)
      c.rotX(t.rotateX)
      c.rotY(t.rotateY)
      c.artX(t.artX)
      c.artY(t.artY)
      // 光斑用 0–1 比例而不是像素：GSAP 把自定义属性按裸数字序列化，
      // px 会写出 `at 280 140` 这种无效 CSS。比例配 CSS 里的 *100% 没有单位问题。
      c.glowX(t.glowU)
      c.glowY(t.glowV)
    }

    // 只有当前卡与左右两张允许倾斜：更外面那两张糊成一条缝，转起来只会显得脏。
    // ★ 这里重新算一遍 slots，而不是用渲染作用域里那个 —— 后者每次渲染都是新数组，
    //   进了依赖就等于每次渲染都重绑一遍监听。active 才是这件事唯一的输入。
    const allowed = new Set(
      reelState(active, count)
        .filter((s) => s.isCurrent || s.advanceOnClick)
        .map((s) => s.index),
    )
    const off = new Map<HTMLElement, () => void>()

    section.querySelectorAll<HTMLElement>('.hl__card').forEach((card, i) => {
      if (!allowed.has(i)) {
        delete card.dataset.tilt
        rest(card)
        return
      }
      card.dataset.tilt = 'true'
      if (off.has(card)) return
      card.addEventListener('pointerenter', onEnter)
      card.addEventListener('pointerleave', onLeave)
      card.addEventListener('pointermove', onMove, { passive: true })
      off.set(card, () => {
        card.removeEventListener('pointerenter', onEnter)
        card.removeEventListener('pointerleave', onLeave)
        card.removeEventListener('pointermove', onMove)
      })
    })

    const markDirty = () => {
      dirty = true
    }
    window.addEventListener('scroll', markDirty, { passive: true })
    window.addEventListener('resize', markDirty)

    return () => {
      for (const fn of off.values()) fn()
      window.removeEventListener('scroll', markDirty)
      window.removeEventListener('resize', markDirty)
      section.querySelectorAll<HTMLElement>('.hl__card').forEach((card) => {
        delete card.dataset.hover
        delete card.dataset.tilt
      })
    }
  }, [active, count])

  /* ------------------------------------------------------------------ 键盘 */
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // 按过键就说明"下一次 focus 是键盘带来的"，把可能残留的指针标记清掉
    // （pointerdown 之后没跟 focus 的情形：点在卡片外的空白上）。
    viaPointerRef.current = false
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta && e.key !== 'Home' && e.key !== 'End') return
    // ★ 两个都要挡：preventDefault 是给浏览器自己的横向滚动 / 回到页首，
    //   stopPropagation 是给 StorybookFlip 那个 window 上的全局 ← →（见文件头）。
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Home') goTo(0)
    else if (e.key === 'End') goTo(count - 1)
    else go(delta)
  }

  const current = HIGHLIGHTS[active]

  return (
    <section
      className="hl"
      id="highlights"
      ref={sectionRef}
      aria-labelledby="hl-title"
      onKeyDown={onKeyDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDownCapture={() => {
        // 记住"接下来那次 focus 是点出来的"，见下面 onFocusCapture。
        viaPointerRef.current = true
      }}
      onFocusCapture={() => {
        /* ★ 只有**键盘带来的**焦点才算"人停在这里"。
           `.hl__viewport` 带 tabIndex={0}，而 Chrome 点一个 tabindex 元素会给它焦点 ——
           于是"点邻居卡翻一条"这个动作会把 focused 打成 true，
           而它只有在焦点离开本节时才回 false，焦点却再也走不掉了（用户已经不动了）。
           结果就是：**鼠标点过一次，自动播永久停住**。
           这里用"上一次交互是不是指针"区分两种焦点。 */
        if (viaPointerRef.current) {
          viaPointerRef.current = false
          return
        }
        setFocused(true)
      }}
      onBlurCapture={(e) => {
        // 焦点还在本节里面就不算离开
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      {/* 与第二屏 §1.5 同一套点阵。这一节不满屏，所以挂在节上、用遮罩在中间挖洞。 */}
      <div className="hl__ambient" aria-hidden="true" />

      <header className="hl__head">
        <p className="hl__eyebrow">
          <span className="hl__eyebrow-cn">项目亮点</span>
          <span className="hl__eyebrow-en" aria-hidden="true">
            / HIGHLIGHTS
          </span>
        </p>
        <h2 className="hl__title" id="hl-title">
          这本书是怎么长出来的
        </h2>
        <p className="hl__sub">
          刚才一页页翻到的那些，都出自下面这五件事。它们有的已经在这两屏里露过面，有的还在路上。
        </p>
      </header>

      {/* ---------------------------------------------------------------- 轮播
          tabIndex 挂在这一层而不是别处：底部那排控件删掉之后，本节里没有任何可聚焦
          元素了。没有 tab 落点，键盘用户既进不来（onKeyDown 挂在 section 上，
          焦点不在本节内它根本不触发）也停不下自动播。 */}
      <div
        className="hl__viewport"
        role="region"
        tabIndex={0}
        aria-roledescription="轮播"
        aria-label={`项目亮点，共 ${count} 条。用左右方向键翻看`}
      >
        <ul className="hl__reel">
          {HIGHLIGHTS.map((h, i) => {
            const s = slots[i]
            const depth = reelDepth(s.offset)
            const num = pad2(i + 1)

            return (
              <li
                key={h.key}
                className="hl__slot"
                data-depth={depth}
                data-current={s.isCurrent || undefined}
                data-jump={jumped[i] || undefined}
                style={{ '--hl-offset': s.offset, zIndex: 10 - depth } as CSSProperties}
              >
                <article
                  className="hl__card"
                  aria-roledescription="亮点"
                  aria-label={`第 ${i + 1} 条，共 ${count} 条：${h.title}`}
                  aria-hidden={s.exposed ? undefined : true}
                  onClick={s.advanceOnClick ? () => goTo(i) : undefined}
                >
                  <div className="hl__frame">
                    {/* 五张图都已落盘。这一层仍然自带一张 CSS 暖纸底纹**当退路**：
                        图挂了/被网络掐了的时候，读起来是"这一条有一张图"，不是"这里坏了"。 */}
                    <div className="hl__art" data-key={h.key} data-n={num} aria-hidden="true">
                      {/* `alt=""` 的 <img> 在 404 时什么都不画，所以不会留一个碎图标；
                          图在的时候是一张不透明的画，正好盖住下面那层底纹。
                          —— 与选择点那两枚小云图同一个机制、同一个理由。 */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="hl__art-img"
                        src={artPath(h.key)}
                        alt=""
                        width={1280}
                        height={720}
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="hl__art-num">{num}</span>
                    </div>
                  </div>

                  {/* 光斑挂在**卡片**上而不是插画上：它要跟着光标扫过整张纸，
                      而且 --hl-gx/gy 是相对卡片矩形算出来的。 */}
                  <div className="hl__glow" aria-hidden="true" />

                  <div className="hl__body">
                    <p className="hl__meta">
                      <span className="hl__index">
                        {num}
                        <span className="hl__index-of"> / {pad2(count)}</span>
                      </span>
                      <span className="hl__cat">
                        / {h.category} · <span className="hl__tag">{h.tag}</span>
                      </span>
                    </p>

                    <h3 className="hl__card-title">{h.title}</h3>
                    <p className="hl__card-text">{h.body}</p>

                    <footer className="hl__foot">
                      <ul className="hl__chips">
                        {h.chips.map((c) => (
                          <li key={c} className="hl__chip">
                            {c}
                          </li>
                        ))}
                      </ul>
                    </footer>
                  </div>
                </article>
              </li>
            )
          })}
        </ul>
      </div>

      {/* 切换时播报。视觉上永远不进画面 —— 它说的每一句，画面上都有。 */}
      <p className="hl__sr-only" aria-live={playing ? 'off' : 'polite'}>
        第 {active + 1} 条，共 {count} 条：{current.title}
      </p>
    </section>
  )
}

export default HighlightsReel
