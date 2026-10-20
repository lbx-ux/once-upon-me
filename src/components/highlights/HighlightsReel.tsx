'use client'

/**
 * HighlightsReel —— 第三屏：项目亮点。
 *
 * 五条亮点，横向轮播。视觉上它是首屏那个环的压平版：同样的近大远小、同样的后排糊、同样的
 * 陶土色只点一处，所以整页读起来是一套系统，不是三段拼起来的东西。
 *
 * 谁写 transform —— 这一屏最容易做错的一件事，先说清楚
 *
 * 一个元素只能有一个 transform 的主人。四层各管各的：
 *
 *   .hl__reel          CSS   拖拽位移（独立属性 `translate`，只吃 `--hl-drag`）
 *   .hl__slot          CSS   轮播位移 + 深度（scale/opacity/blur/z）
 *   .hl__card          GSAP  倾斜（rotationX/Y）与进场淡入（autoAlpha）
 *   .hl__card 的抬起   CSS translate —— 独立属性，与 transform 复合，不抢笔
 *   .hl__art           GSAP  插画层的反向视差（x/y）
 *   --hl-gx/gy         GSAP  暖光斑位置（CSS 变量，0–1 比例）
 *
 * 抬起一开始也走 GSAP 的 `y`，然后发现它和进场可能撞在同一个属性上：人在进场动画跑到一半时
 * 把鼠标放上卡片，两个 tween 就抢一个 y。换成 CSS 的独立 `translate` 属性之后，两者复合在
 * 一起，谁也不用让谁；卡片进场因此只淡入不位移，上升的重量感留给标题与控制条。
 * 把轮播位移和倾斜写进同一个 `transform` 是另一个等价的笑话：CSS 的 `transition` 会和 GSAP
 * 的每帧抢，结果是一种"糊但有延迟"的怪抖，从代码里看不出来。
 *
 * perspective 挂在 slot 上，不挂在 reel 上
 *
 * 首屏那个环（`hero-orbit.css`）记着一条已经付过学费的坑：带 `preserve-3d` 的祖先一旦
 * `opacity < 1` 或带 `filter`，就会把 3D 子元素压平，遮挡排序当场失效。这一屏的 slot 正是
 * 又 `opacity < 1` 又 `blur()` 的，所以不写 `preserve-3d`，perspective 挂在每个 slot 自己
 * 身上，卡与卡的前后关系交给 `z-index`。代价是"五张卡共用一个灭点"变成"各自一个灭点"：
 * 6° 的倾角下看不出差别，而各自一个灭点反而更接近"桌上摊着五张纸"的读法。
 *
 * 不做滚轮劫持；自动轮播有，但底下那排控件没有
 *
 * 上一屏整屏都在用滚轮翻页（340vh）。到这一屏偷偷改滚轮语义，是最恶劣的一种坏。
 * 自动轮播原先写过一条"不做"，后来按产品要求改成"一直走"，代价是必须配中断条件，
 * 见下面 `playing` 那四个输入（指针在本节内 / 键盘焦点在本节内 / 标签页在后台 / 正被拖着）。
 * 底部那排圆点 + 箭头 + 暂停键已经整条删掉（画面太碎），于是"停一下"这件事只剩三种给力的
 * 做法：
 *
 *   1. 指针一进这一节就停（鼠标用户）；
 *   2. 键盘焦点一进这一节就停——所以 `.hl__viewport` 自己带 `tabIndex={0}`：删掉圆点之后
 *      本节里没有任何可聚焦元素了，不给它一个 tab 落点，键盘用户就既进不来也翻不动
 *      （`onKeyDown` 挂在节上，焦点不在节内根本不触发）。Tab 进来 → 停住 → ← → / Home / End
 *      自己翻 → Tab 出去 → 恢复。只算键盘带来的焦点：Chrome 点一个 `tabindex` 元素也会给它
 *      焦点，那样"点邻居卡"会把自动播永久停住。见 `viaPointerRef`。
 *   3. `prefers-reduced-motion` 下一次都不启动。
 *
 * 记一条真实的让步：WCAG 2.2.2 要的是"看得见、点得到"的暂停手段，上面第 2 条只在键盘用户
 * 想到要 Tab 时成立。删掉那颗暂停键是产品决定，不是无障碍改进——已记进
 * docs/known-tradeoffs.md「已知取舍」，将来要恢复就照 git 里那一版拿回来。
 *
 * 键盘：只在本节内部接
 *
 * `onKeyDown` 挂在 `<section>` 上（不在 `window` 上）：焦点不在本节里就根本不触发，于是
 * ← → 只翻这一节的轮播，不影响别处。这里原先还有一句 `e.stopPropagation()`，挡的是首页
 * 第二屏那本书挂在 `window` 上的全局 ← →。2026-10-20 那一边把 bug 修在了根上（书只在自己
 * 铺在这一屏上时才接这两个键，`StorybookFlip` 里那个 `ownsArrowKeys`），于是这句拦截没有
 * 对象了——留着它就是留一句会过期的解释，连同它一起删掉。`preventDefault` 留着：那挡的是
 * 浏览器自己的横向滚动与回到页首。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import gsap from 'gsap'
/* ★ 这一行不能省，而且 `pnpm typecheck` 抓不到它被省掉。
   gsap 的 .d.ts 把插件类声明成了全局（为了让你在类型里写 `ScrollTrigger`），
   所以只写 `gsap.registerPlugin(ScrollTrigger)` 而不 import，
   tsc 一路绿灯、eslint 也不响，只有浏览器会抛 `ReferenceError: ScrollTrigger is not defined`。
   这条是实测撞出来的：删掉这行之后 typecheck 与 lint 全绿，页面第三屏整节白屏。 */
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { dragSteps, reelDepth, reelJumped, reelState, wrapActive } from '@/lib/reel'
import { TILT, normalizePointer, tiltFromPointer } from '@/lib/tilt'
import { HIGHLIGHTS, artPath } from './highlights'

/* ------------------------------------------------------------------ 常量 */

/** 指针跟随的平滑时长。0.4s ≈ "纸有重量"；再短像贴图，再长像拖泥带水。 */
const TILT_DURATION = 0.4
/** 插画层比卡片再慢一点 —— 两层不同速才有"框里的画"这个错觉。 */
const ART_DURATION = TILT_DURATION + 0.12
/**
 * 自动轮播的间隔。
 *
 * 6500 → 3200 → 2000（用户两次要求加快）。绕一圈 5 × 2 = 10 秒。
 * 2000ms 读不完任何一条：正文最长的那条（第 2 条）114 个汉字、三到四行，
 * 中文默读按 8–10 字/秒算是 11–15 秒。（这个数 2026-10-18 随文案重写复量过：那一版
 * 最长的是第 3 条约 110 字，现在最长的是第 2 条——五条都在 92–114 字之间，
 * 第 5 条的字符总数更大只是因为它里面有几个拉丁词。）
 * 这个缺口比 6.5s 那一版更大，不是更小 ——
 * 它是自动轮播的固有代价，写在这里而不是藏起来，补偿办法是"碰到就停"：
 * 指针一进这一节、键盘一进这一节、标签页一进后台，立刻停住。
 *
 * 与补间的关系：`.hl__slot` 的位移补间是 0.56s（CSS 里，两个数咬在一起）。
 * 2000 - 560 = 1.44 秒是停着的，占一轮 72%。再往下压间隔，先动的是补间
 * 而不是间隔 —— 否则卡片永远在滑，读起来就是"一直在飞"。
 */
const AUTOPLAY_MS = 2000
/**
 * 超过这个像素数才算"在拖"，否则算一次点击。
 * 6px 是浏览器自己判定拖拽的常用量级：再小就会把一次正常点击读成拖动，
 * 手抖一下邻居卡就不翻了 —— 那是更差的体验。
 */
const DRAG_SLOP_PX = 6

/**
 * 窄屏判定（2026-10-19 第二轮）。
 * 与 `highlights-reel.css` §11 里"藏轮播、显竖排列表"那条媒体查询是同一个数，
 *   而全仓的手机竖屏断点只有一个（640，见 `globals.css` 那条断点约定），
 *   新写的断点也照它走 —— 改一处要一起改。
 *
 * 这一档在手机上换成竖排五张全宽卡（`.hl__list`），理由见 CSS §11 与
 * `docs/known-tradeoffs.md`：轮播的卡宽是 `min(560px, 36vw)`，390px 上取 140px，
 * 正文列只有 94px、13px 的字一行放不下 8 个 —— 那不是"手机上小一点"，是读不了。
 * 这个常量管的是三件"不跑"的事（不自动播、不建进场时间线、不接指针倾斜），
 * 换形态本身由 CSS 决定（两套 DOM 都渲染、靠 display 二选一）。
 */
const NARROW_QUERY = '(max-width: 640px)'

/** 订阅一次窄屏判定。GSAP 那一条走 `gsap.matchMedia` 自己会跟着窗口变，
 *  这只给两个 `useEffect` 用（它们原本只在 `active` / `playing` 变时才重跑，
 *  转屏那一刻不会自己醒过来）。
 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

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
  /** 正在被拖着。只为"拖的时候别抢"而存在：画面上的拖拽态走 DOM 直写，
   *  每帧一次的量不进 React（同下面 tilt 那一段的理由）。
   */
  const [dragging, setDragging] = useState(false)
  /** 手动翻一次就换一颗种子，让 2s 从头计 —— 不然刚点到第 3 条，
   *  0.5 秒后就被自动播扔去第 4 条，等于把人刚做的选择吃掉。
   */
  const [timerSeed, setTimerSeed] = useState(0)
  const count = HIGHLIGHTS.length
  const slots = reelState(active, count)

  /** 手机竖屏（≤640）：轮播那三件事一件都不跑，见 NARROW_QUERY。 */
  const narrow = useNarrow()

  /** 上一次交互是指针还是键盘 —— 用来分辨 focus 是谁带来的，见 onFocusCapture。 */
  const viaPointerRef = useRef(false)
  /** 上一轮提交给 DOM 的那些偏移 —— 给下面判断"谁跨界了"用。 */
  const prevOffsetsRef = useRef<number[]>([])
  const reelRef = useRef<HTMLUListElement>(null)
  /** 一根没有 transform、也没有过渡的探针，用来量 `--hl-step` 到底是多少像素。 */
  const probeRef = useRef<HTMLSpanElement>(null)
  /** 本次拖拽的临时账：起点、当前位移、有没有越过"这算拖不算点"的阈值。 */
  const dragRef = useRef<{ id: number; x0: number; dx: number; moved: boolean } | null>(null)
  /** 拖完之后浏览器还会补一次 click，得记着把它吞掉，否则翻两下。 */
  const suppressClickRef = useRef(false)

  /**
   * 环形轮播绕回去那一下，恰好有一张卡要从最左跨到最右。
   * 不关掉它这一拍的补间，就会看到一张糊着的卡横穿整个轮播中央 —— 像页面坏了。
   * 判据（"位移超过半圈"）与它的推导在 `reelJumped` 里，有测试。
   *
   * ★ 必须在渲染时算出来、与新的 `--hl-offset` 同一个 commit 交出去。
   *   等 effect 跑完再关过渡就晚了：浏览器已经看见"旧位置 + 有 transition"，动画照跑。
   */
  const offsets = slots.map((s) => s.offset)
  const jumped = reelJumped(prevOffsetsRef.current, offsets, count)

  /** 每次提交之后记下这一轮的偏移，给下一次渲染判断"谁跨界了"用。 */
  useEffect(() => {
    prevOffsetsRef.current = offsets
  })

  /** 真的在走吗。四个"临时让路"任一成立就停。
   *  （原来还有一个：用户按暂停键。那排控件整条删掉了，理由与代价见文件头。）
   */
  const playing = !hovered && !focused && !behindTab && !dragging

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

  /* ---------------------------------------------------- 拖拽（横向抓取）
   *
   * 三条规矩决定了这套写法：
   *
   * 1. 每帧的位移不进 React。 拖拽量直接写成一个 CSS 变量 `--hl-drag`
   *    挂在 `.hl__reel` 上（那一层的 transform 没人认领，见文件头那张表），
   *    React 这边只留一个 `dragging` 布尔用来停自动播。
   * 2. 拖的时候关过渡，松手那一刻开回来。 也是直接写 dataset，不走 state ——
   *    否则 `--hl-drag: 0` 写下去时 `data-dragging` 还在（state 要到 commit 才掉），
   *    浏览器就会先把拖拽量瞬间抹掉、再让卡片走剩下的路，看着像弹了一下。
   *    同一个任务里改两处样式，浏览器只算一次"前后状态"，过渡就从当前拖到的位置起算。
   * 3. 这是环，所以不用橡皮筋。 直线轮播拖到端头要减速回弹，环上没有端头。
   */
  /**
   * 一次拖拽的收尾：画面回位、过渡开回来、按拖过的距离翻页。
   *
   * `advance = false` 给 `pointercancel` 用 —— 系统把这次手势接管了（比如它判定
   * 用户其实在纵向滚页面），那就只该把画面放回去，不该替他翻页。
   *
   * ★ 归零与去属性两句必须在同一个任务里写完，见上面第 2 条规矩：
   *   分开写就会先瞬间抹掉拖拽量、再让卡片补剩下的路。
   */
  const finishDrag = (reel: HTMLUListElement, dx: number, moved: boolean, advance: boolean) => {
    dragRef.current = null
    reel.style.setProperty('--hl-drag', '0px')
    delete reel.dataset.dragging
    setDragging(false)
    if (!moved) return // 没过阈值：当成一次点击，交给卡片的 onClick
    suppressClickRef.current = true
    if (!advance) return
    const steps = dragSteps(dx, probeRef.current?.offsetWidth ?? 0, count)
    if (steps !== 0) {
      setActive((cur) => wrapActive(cur, steps, count))
      setTimerSeed((n) => n + 1) // 刚拖过，2 秒从头计
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLUListElement>) => {
    // 只认主键：右键/中键（中键还带自动滚动）不该开始一次拖拽
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const reel = reelRef.current
    if (!reel) return
    /* 上一次拖拽没收尾就又开始了一次（pointerup 丢了：抓指针失败、或指针在
       reel 外面抬起）。不先结掉的话 `dragging` 会永远挂着 —— 自动播被无限期停住、
       拖拽量停在半路，而且再也修不好。所以先 heal，别往 window 挂监听兜这个。 */
    const stale = dragRef.current
    if (stale) finishDrag(reel, stale.dx, stale.moved, true)
    suppressClickRef.current = false
    dragRef.current = { id: e.pointerId, x0: e.clientX, dx: 0, moved: false }
    /* 顺序：先写"正在拖"的视觉状态，再去抓指针。
       反过来的话 setPointerCapture 一抛异常整段 handler 当场中断 —— 画面没进拖拽态、
       过渡没关，而 dragRef 已经建好了，于是得到"能拖但拖起来黏糊糊"的怪状态，
       比直接坏还难查。实测它会抛：合成事件里没有 active pointer → NotFoundError。 */
    reel.dataset.dragging = 'true'
    setDragging(true)
    try {
      // 抓住指针：后续 move/up 全部转给 reel，不会漏掉抬手
      reel.setPointerCapture(e.pointerId)
    } catch {
      /* 抓不住也照样能拖：move 只在指针还落在 reel 上时更新，
         漏掉的抬手由上面那个"下一次 down 先 heal"收尸。 */
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLUListElement>) => {
    const d = dragRef.current
    const reel = reelRef.current
    if (!d || !reel || d.id !== e.pointerId) return
    d.dx = e.clientX - d.x0
    if (!d.moved && Math.abs(d.dx) > DRAG_SLOP_PX) d.moved = true
    // 没过阈值前不动画面：不然"点一下邻居卡"会先抖一格，点击的手感就毁了
    if (d.moved) reel.style.setProperty('--hl-drag', `${d.dx}px`)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLUListElement>) => {
    const d = dragRef.current
    const reel = reelRef.current
    if (!d || !reel || d.id !== e.pointerId) return
    finishDrag(reel, d.dx, d.moved, true)
  }

  /** 手势被系统接管（滚成纵向页面滚动等）：画面回位，但不替他翻页。 */
  const onPointerCancel = (e: React.PointerEvent<HTMLUListElement>) => {
    const d = dragRef.current
    const reel = reelRef.current
    if (!d || !reel || d.id !== e.pointerId) return
    finishDrag(reel, d.dx, d.moved, false)
  }

  /* ------------------------------------------------ 自动轮播
   *
   * 这一条推翻了 spec 与 README 原先的"不做自动轮播"。理由是产品决定，
   *   不是技术发现，所以规矩改成了"碰到就停"，见下面三个中断条件。
   *
   * 用 setInterval 而不是 rAF：这是离散步进，不是连续量，
   * 拿 rAF 每帧算"到点了没"是白烧一帧。
   *
   * `prefers-reduced-motion` 下一次都不启动（不是启动后再停）：
   * 减少动效要的是"没有不该动的东西在动"，不是"动得很克制"。
   */
  useEffect(() => {
    if (!playing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    /* 窄屏一次都不启动（2026-10-19）：手机上这一屏是竖排五张全宽卡，
       没有"当前卡"这回事 —— 自动播只会每 2 秒把 `active` 推一格，
       同时把那条 aria-live 播报念一遍（"第 3 条，共 5 条…"），
       而画面上一个字都没变。那不是"跑了没看见"，是在替用户看一份不存在的东西。 */
    if (narrow) return

    const id = window.setInterval(() => {
      setActive((cur) => wrapActive(cur, 1, count))
    }, AUTOPLAY_MS)
    return () => window.clearInterval(id)
  }, [playing, count, timerSeed, narrow])

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
   * 卡片这一段只淡入，不带上移。
   *   倾斜的 quickTo 写的是 `.hl__card` 的 `transform`；进场若也写 `y`，
   *   两者就是同一个属性上的两个主人。一个元素一个 transform 主人，
   *   这条规矩在环那一屏与这里各值一次教训。
   *   标题没有倾斜，所以它可以安心用 `y` —— 进场需要那点上升的重量感。
   *   （底部控制条那一排本来也用它，现在整条删了，见文件头。）
   *
   * 初始的"藏"是 JS 做的，不是 CSS 做的：禁用 JS、或者爬虫抓静态 HTML 时，
   *   五张卡本来就是可见的完整内容。用 CSS 先藏起来再靠 JS 揭开，
   *   等于给「JS 没跑起来」这个状态准备了一份空白页。
   */
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    gsap.registerPlugin(ScrollTrigger)

    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia()

      mm.add('(prefers-reduced-motion: no-preference) and (min-width: 641px)', () => {
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
      // ★ 2026-10-19 起这条谓词还带一个宽度条件：手机上轮播整块是 `display: none`
      //   （换成了 §11 的竖排列表），时间线里那两个选择器在那时候**一张可见的卡都选不到**。
      //   写成 `min-width: 641px` 而不是在回调里读一次 NARROW_QUERY —— 前者由
      //   gsap.matchMedia 自己跟着窗口变（转屏、拖窗口宽度都会重算），后者只在挂载那一刻成立。
      //   640 / 641 那一对与 CSS 的 `max-width: 640px` 是同一条线，改一处要改另一处。
    }, section)

    return () => ctx.revert()
  }, [])

  /* ---------------------------------------------------- 指针跟随（hover 倾斜）
   *
   * 用原生监听而不是 React 的 onPointerMove：每帧一次的量不该走 React 调度，
   * 而且 handler 要能稳定命名，卸载时 removeEventListener 才拿得到同一个函数。
   *
   * 依赖只有 `active`：哪几张卡允许倾斜会跟着它变。
   */
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    /* 窄屏不接（2026-10-19）：这一整套是指针跟随，30 处注释里逐条写明了它
       只在"鼠标停在卡上"时成立。手机上轮播是 `display: none` 的，
       接上去只会给五张看不见的卡拉 quickTo —— 真正会命中的是 `pointermove`：
       手指拖动页面时它照样派发。 */
    if (narrow) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    /** rect 缓存。滚动/resize 只标脏，下一次真的有指针移动才重量 ——
     *  每次 pointermove 都读布局盒是在主动制造强制同步布局。
     */
    const rects = new Map<HTMLElement, Rect>()
    let dirty = true

    const measure = (card: HTMLElement): Rect => {
      const b = card.getBoundingClientRect()
      const r = { left: b.left, top: b.top, w: b.width, h: b.height }
      rects.set(card, r)
      return r
    }

    /**
     * 取 rect。指针落在缓存的框外面就直接重量一次。
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
      // 同一组属性反向补回。快速把鼠标甩出卡外时不写回的话，
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
    // 这里重新算一遍 slots，而不是用渲染作用域里那个 —— 后者每次渲染都是新数组，
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
  }, [active, count, narrow])

  /* ------------------------------------------------------------------ 键盘 */
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // 按过键就说明"下一次 focus 是键盘带来的"，把可能残留的指针标记清掉
    // （pointerdown 之后没跟 focus 的情形：点在卡片外的空白上）。
    viaPointerRef.current = false
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta && e.key !== 'Home' && e.key !== 'End') return
    /* `preventDefault` 挡的是浏览器自己的横向滚动与回到页首。
       这里原先还有一句 `stopPropagation`（挡第二屏那本书的全局 ← →）——
       2026-10-20 对方把它修在了根上，那句拦截没有对象了，连同理由一起删掉。 */
    e.preventDefault()
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
      /* 光斑半径由 `TILT` 说了算，写下来给 `.hl__glow` 的渐变用（`var(--hl-glow-r)`）。
         原来是 CSS 里另写着一份 240px，而 `TILT.glowRadiusPx` 没有任何消费者——
         两个手写的数会各自漂移。挂在这一层而不是每张卡上：一个值一个家。 */
      style={{ '--hl-glow-r': `${TILT.glowRadiusPx}px` } as CSSProperties}
      onKeyDown={onKeyDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDownCapture={() => {
        // 记住"接下来那次 focus 是点出来的"，见下面 onFocusCapture。
        viaPointerRef.current = true
      }}
      onFocusCapture={() => {
        /* 只有键盘带来的焦点才算"人停在这里"。
           `.hl__viewport` 带 tabIndex={0}，而 Chrome 点一个 tabindex 元素会给它焦点 ——
           于是"点邻居卡翻一条"这个动作会把 focused 打成 true，
           而它只有在焦点离开本节时才回 false，焦点却再也走不掉了（用户已经不动了）。
           结果就是：鼠标点过一次，自动播永久停住。
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
          刚才一页页翻到的那些，都出自下面这五件事：书、声音、岔路，还有把它们生出来的那台引擎。
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
        aria-label={`项目亮点，共 ${count} 条。可拖动、或用左右方向键翻看`}
      >
        {/* 一根探针，只为量出 `--hl-step` 到底是多少像素。
            为什么不自己按公式算（卡宽 + 缝宽）：那个公式在 CSS 里已经写了一遍，
            JS 再抄一遍就是两个手写的数 —— 本项目为这种耦合付过两次学费了。
            探针没有 transform、没有过渡，所以任何时候量都是准的。 */}
        <span className="hl__step-probe" ref={probeRef} aria-hidden="true" />
        <ul
          className="hl__reel"
          ref={reelRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
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
                  onClick={
                    s.advanceOnClick
                      ? () => {
                          // 刚拖完那一下浏览器还会补一次 click，不吞掉就会翻两下
                          if (suppressClickRef.current) return
                          goTo(i)
                        }
                      : undefined
                  }
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
                        /* 不关掉浏览器原生的"拖图片"，横向拖动会被它接走：
                           用户看到的是图片被拽起来、轮播一动不动。 */
                        draggable={false}
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

      {/* ------------------------------------------------------- 竖排五张全宽卡
          手机那一档（≤640，CSS §11 里换）。**两套 DOM 都渲染、靠 display 二选一** ——
          与首页其余几处"首帧就是对的"同一个做法：不用等 JS 读到 matchMedia 再换树
          上一版这条举的例子就是第二屏那本书的 `__static` / `__live`。

          ★ 内容与轮播那一套**同源**：同一份 `HIGHLIGHTS`、同一个 `artPath`、
            同一批 `.hl__frame` / `.hl__art` / `.hl__body` 样式类（见 CSS 里那条
            共用选择器列表）—— 换的是"一次看一张还是五张一起看"。
          ★ 这里**刻意不挂 `.hl__card`**：那个类名是 GSAP 与指针倾斜的选择器，
            挂上去等于让手机上这五张也进那两套（`section.querySelectorAll('.hl__card')`）。
          ★ `<ol>` 而不是一串 `<div>`：这是一份**有序清单**（01…05），
            屏读应该念"列表，5 项"。轮播那一版是"轮播"，两个形状说两件不同的事。 */}
      <ol className="hl__list">
        {HIGHLIGHTS.map((h, i) => {
          const num = pad2(i + 1)
          return (
            <li key={h.key} className="hl__item">
              <div className="hl__frame">
                <div className="hl__art" data-key={h.key} data-n={num} aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="hl__art-img"
                    src={artPath(h.key)}
                    alt=""
                    width={1280}
                    height={720}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                  <span className="hl__art-num">{num}</span>
                </div>
              </div>

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
            </li>
          )
        })}
      </ol>

      {/* 切换时播报。视觉上永远不进画面 —— 它说的每一句，画面上都有。 */}
      <p className="hl__sr-only" aria-live={playing ? 'off' : 'polite'}>
        第 {active + 1} 条，共 {count} 条：{current.title}
      </p>
    </section>
  )
}

export default HighlightsReel
