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
 * 翻页只占一小段，其余是"停在这一页让你读完"。改这张表要连着看两件事：
 *
 *   1. useScrollDriver 的 enter-exit 区间（p=0 是书顶边触到视口下沿那一刻）；
 *   2. ★ `PUSH_OUT_P` —— 书被顶出视口那一刻的 p = 0.7727。
 *      **每一个要让人读的停顿都必须落在它之前。** 这一条以前只是注释，
 *      表还是排到了 0.86，于是最后一页整个是在书已经离场之后才翻开的
 *      （症状就是"最后一页展开了，书不在中间"）。现在有常量，也有开发期断言。
 *
 * 角度一律用插值后的 qDisplay，不用 qTarget：鼠标滚轮是离散格，
 * 不插值就是一顿一顿（触控板连续，看不出这个问题，只有真拿滚轮滚才会暴露）。
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import useScrollDriver, { enterExitSpan } from '@/lib/useScrollDriver'
import BookSpine from './BookSpine'
import { flipState } from './flip'
import { SPREAD_TINTS } from './spreadTints'
import {
  BOOK_BYLINE,
  BOOK_CHOICE_ASK,
  BOOK_CTA,
  BOOK_NOTE,
  BOOK_TITLE,
  BRANCHES,
  BRANCH_ORDER,
  CHOICE_PAGE,
  COVER_IMAGE,
  DEFAULT_BRANCH,
  LEAF_COUNT,
  buildLeaves,
  pageImage,
  pageText,
  spineLabels,
  type BranchKey,
  type PageFace,
} from './demoBook'

/**
 * 书被顶出视口那一刻的 p —— **所有"要让人读"的停顿都必须排在这个数之前**。
 *
 * 推导（与 useScrollDriver 的 enter-exit 同一套几何）：
 *
 *     本节高 H、视口高 V、本节顶边在文档里位于 T
 *     rangeTop = T − V，span = H + V                    ← enterExitSpan 未夹时的值
 *     stage 从 y = T 起钉住，到"本节底边贴住视口底"被顶走：y = T + H − V
 *     ⟹ p = (T + H − V − (T − V)) / (H + V) = H / (H + V)
 *
 * 本节 H = 340vh、V = 100vh ⟹ 340/440 = **0.7727**。vh 上下同约，V 消掉了，
 * 所以这个数与视口高度无关；1440×900 下在浏览器里量到 0.7727，对得上。
 *
 * ★ 也就是说 enter-exit 这个量程**最后 23% 天生是退场**，不是"停在最后一页"。
 *   把最后一个跨页排在 0.86，等于排在书已经往屏幕外走的路上 ——
 *   p=1 时 stage 的顶边在 −900px，整本书在视口上方。这就是
 *   "最后一页展开完整了，绘本却在中间偏上、还被切掉一截"的根因。
 *
 * ★ 这个数与 CSS 是咬死的：它由 `.storybook { height: 340vh }` 推出来。
 *   改那一行必须同时改这里。另外它假设**本节下面还有内容**（第三屏），
 *   所以 enterExitSpan 不会被夹到文档尽头（实测 clamped=false）；
 *   若哪天本节又成最后一页，量程会被夹短，这个数要重新量。
 */
const PUSH_OUT_P = 340 / (340 + 100)

/* ---------------------------------------------------------------------------
 * 滚动预算：p → 已翻过多少叶
 *
 * p 的 0 与 1 都是"真实可达"的两端（useScrollDriver 把 enter-exit 夹到了文档尽头）：
 *   p = 0  书顶边触到视口下沿
 *   p ≈ 0.29 舞台钉住（从这一刻起书不再往上走）
 *   p = 1  本节底边触到视口下沿，也就是页面滚到底
 *
 * ★ 但**书真正开始离开屏幕比 p = 1 早得多**，见下面 P_PUSH_OUT 的推导。
 *   这一条以前写在注释里（"最后一页的停顿要早于 0.773 开始"），
 *   然后 P_Q 还是把最后一个跨页排到了 0.86 —— 注释没拦住表，实测也没人看：
 *   结果就是"最后一页翻开时书不在中间"（它已经被顶上去 165px，顶边切掉）。
 *   现在这个数变成一个常量，并且有开发期断言摁着。
 *
 * 现在的分段（p 值，括号里是 1440×900 下的实际像素滚动量）：
 * p 0.00–0.18  书从下面升上来（**合着**，封面这一拍要留出来）
 * p 0.18–0.32  封面翻开 —— 与"钉住"那一刻交错，"书落定，才翻第一页"
 * p 0.32–0.37  停 S1（像什么？）
 * p 0.37–0.43  翻到 S2
 * p 0.43–0.465 停 S2（上去了）
 * p 0.465–0.525 翻到 S3
 * p 0.525–0.615 停 S3 —— **选择点的窗口**（两个按钮挂在这一段）
 * p 0.615–0.68  翻到 S4（分支页）
 * p 0.68–0.7727 停 S4 —— 正文 + 收尾 CTA，**全部留在钉住的那一段里**
 * p 0.7727–1.0  书被顶出视口；这一段是"退场"，不是"给人读的一页"
 * ------------------------------------------------------------------------- */
const P_Q: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0],
  [0.18, 0],
  [0.32, 1],
  [0.37, 1],
  [0.43, 2],
  [0.465, 2],
  [0.525, 3],
  [0.615, 3],
  [0.68, 4],
  [PUSH_OUT_P, 4],
]

/** 每帧朝目标插值的系数。比 HeroOrbit 的 0.055 快一档 —— 翻页要跟手 */
const SMOOTHING = 0.12

/**
 * 选择点的窗口。**与 P_Q 里 p 0.525–0.615 那段停顿对齐**，前面留 .02 的余量：
 * 按钮要比"停稳"早一点浮出来（不然人还没看见就过去了）。
 * ★ 后面**不留**余量：收口正好压在 0.615（开始翻走那一刻）——
 *   上一版收到 0.78，比翻走的 0.76 还晚，等于让按钮跟着书一起被翻出去。
 *   而且 0.78 已经在 PUSH_OUT_P 之后，那一段书正在离场，按钮还亮着。
 */
const CHOICE_FROM = 0.505
const CHOICE_TO = 0.615

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

/* 开发期自检：选择点窗口的中点必须落在"停在第 CHOICE_PAGE 个跨页"那一段上。
   窗口与 P_Q 是两处手写的数 —— 改了 P_Q 忘了改窗口，按钮就会挂到别的页上去，
   而那种错要滚到半路才看得见，值得在这里摁一下。

   ★ 第二条自检是这次踩出来的：P_Q 与 PUSH_OUT_P 也是两处手写的数
     （后者由 CSS 的 340vh 推出来），排晚了不会报错、只会让最后几页
     在书已经离场之后才翻开 —— 上一版正是这样（0.86 > 0.7727）。
     这类"两个数各改一处"的耦合，注释挡不住，得摁着。 */
if (process.env.NODE_ENV !== 'production') {
  const mid = (CHOICE_FROM + CHOICE_TO) / 2
  const at = Math.round(qFromP(mid))
  if (at !== CHOICE_PAGE) {
    console.error(
      `[StorybookFlip] 选择点窗口的中点落在 q=${at}，不是第 ${CHOICE_PAGE} 个跨页 —— 请与 P_Q 对齐`,
    )
  }

  // 每一次"翻到新的一页"都必须发生在书被顶出视口之前。
  const late = P_Q.filter(([, q], i) => i > 0 && P_Q[i - 1][1] !== q && P_Q[i][0] > PUSH_OUT_P)
  if (late.length) {
    console.error(
      `[StorybookFlip] 有 ${late.length} 次翻页排在 p=${PUSH_OUT_P.toFixed(4)}（书开始离场）之后：` +
        late.map(([p, q]) => `p=${p} → 第 ${q} 页`).join('、') +
        ' —— 那些页是在书往屏幕外走的路上翻开的，见 PUSH_OUT_P 的推导',
    )
  }
  if (CHOICE_TO > PUSH_OUT_P) {
    console.error(
      `[StorybookFlip] 选择点窗口收到 p=${CHOICE_TO}，已在书离场（${PUSH_OUT_P.toFixed(4)}）之后`,
    )
  }
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
 *
 * `showImage` 是跨页图什么时候挂上去的开关（见组件里 spreadsReady 那段）：
 * 关着的时候这一面露的是 `.book__face` 自己的纸色（#fbf7ef）—— 一张还没印上
 * 画的纸，不是"坏了"。封面与封底不走这个开关：封面是第二屏的第一拍，等不起。
 * ------------------------------------------------------------------------- */
function Face({
  face,
  side,
  showImage,
}: {
  face: PageFace
  side: 'front' | 'back'
  showImage: boolean
}) {
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
    <div
      className={cls}
      data-half={face.half}
      style={showImage ? { backgroundImage: `url(${face.image})` } : undefined}
    >
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

  /** ★ 全页唯一一处用 React state 驱动图片切换的地方 —— 其余全部 DOM 直写 */
  const [branch, setBranch] = useState<BranchKey>(DEFAULT_BRANCH)
  const leaves = useMemo(() => buildLeaves(branch), [branch])
  const labels = useMemo(() => spineLabels(branch), [branch])

  /**
   * 每一面（0 = 封面，1–4 = 跨页）的三朵主色，给"整个阅读器被当前页染一层色"用。
   *
   * 表是 `scripts/sample-tints.py` 从图里取出来的生成物，**换了图要重跑**
   * （命令写在生成文件的头上）。按 `pageImage(branch, k)` 查，所以分支一切换
   * （4a ↔ 4b）染的就是新那一页的颜色，不用另写映射。
   * 查不到就是 undefined → 那一面**不染色**，而不是染一个猜出来的颜色。
   */
  const tints = useMemo(
    () => Array.from({ length: LEAF_COUNT }, (_, k) => SPREAD_TINTS[pageImage(branch, k)]),
    [branch],
  )

  const [page, setPage] = useState(0)
  /** 只用来决定 ← → 是"滚动"还是"直接换页"，不参与渲染 —— 渲染那套的切换交给 CSS */
  const [reduced, setReduced] = useState(false)
  /** 选择点窗口开没开。用布尔而不是透明度：关着的时候那几个按钮不能是可点的 */
  const [choiceOn, setChoiceOn] = useState(false)

  /**
   * 跨页图挂上去没有。**这是首屏的带宽账**，不是省事：
   * 四条跨页（去重后 4 个文件、约 370KB）原来在预渲染 HTML 里就以
   * `background-image` 出现 —— 它不受 `loading="lazy"` 管，元素一进布局就请求，
   * 于是在**初次加载的关键窗口里和首屏那 12 张封面（1.16MB）抢带宽**，
   * 而要看它们得先滚过一屏半。关着的时候露的是纸色（见 Face 上面那段）。
   *
   * 两个开闸条件，各管一种走法：
   *   · 第一次滚动 —— 正常模式下要看到跨页必须滚，滚动就是"他要看了"；
   *   · 页码离开封面 —— 静止模式（reduced-motion）不滚动，靠按钮翻页，
   *     那种走法下 `page > 0` 就是同一个信号。
   * 刷新落在页面中间（scrollY > 0）直接算就绪，不然会先看见一页纸。
   *
   * ★ 这不算"内容缺失"：跨页图只能靠 JS 翻出来（翻页本身是 JS 驱动的），
   *   禁 JS 的人看到的是合着的书 + 封面，那两张图本来就取不到。
   *   正文另有 `.storybook__live` 那段 aria-live 在，不依赖这些图。
   */
  const [spreadsReady, setSpreadsReady] = useState(false)

  useEffect(() => {
    if (window.scrollY > 0) {
      setSpreadsReady(true)
      return
    }
    const onScroll = () => setSpreadsReady(true)
    window.addEventListener('scroll', onScroll, { passive: true, once: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (page > 0) setSpreadsReady(true)
  }, [page])

  const qRef = useRef(0)
  const startedRef = useRef(false)
  const pageRef = useRef(0)
  const choiceRef = useRef(false)

  const lastPage = leaves.length - 1

  useScrollDriver(stageRef, {
    range: 'enter-exit',
    // 这一段从书露头到滚出去全程都在动，别提前掉到 30fps
    fastWindow: [0.01, 0.99],
    /* 刻意**不传** onActiveChange：它是给"循环一停就再收不到帧"的收尾用的
       —— 典型场景是节里有长跑的媒体，下降沿必须有人去掐断它。
       这一节里没有那种东西：每一帧要写的都是纯量，停了就是停在原地。
       日后往这一节加音频/视频时把它接回来。 */
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

      const inChoice = progress > CHOICE_FROM && progress < CHOICE_TO
      if (inChoice !== choiceRef.current) {
        choiceRef.current = inChoice
        setChoiceOn(inChoice)
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
   * 选择点上换的是**另一张**图（4a ↔ 4b）。到窗口打开才预取：
   * 放进首屏会白拉 60KB；等点了再拉，翻页那一拍会看得见白。
   */
  useEffect(() => {
    if (!choiceOn) return
    const other = BRANCH_ORDER.find((k) => k !== branch)
    if (!other) return
    const img = new Image()
    img.src = BRANCHES[other].image
  }, [choiceOn, branch])

  /**
   * 到第 index 面去。
   * 正常模式 = 滚到那一面的停顿段（p ↔ scrollY 是线性的，反推即可，见 useScrollDriver）；
   * 静止模式 = 直接换页。
   *
   * ★ 反推用的量程必须与 hook 算进度用的是**同一套算法**（enterExitSpan），
   *   不能在这里自己加 wrap.offsetHeight + innerHeight 了事：这一节是页面最后一节，
   *   量程要夹到文档滚得到的地方，不夹的话每一格都多滚约 30% ——
   *   点刻度第 3 格会直接跳到第 4 页上。
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
      const span = enterExitSpan(
        wrap.offsetHeight,
        window.innerHeight,
        document.documentElement.scrollHeight,
        top,
      )
      window.scrollTo({ top: top + P_AT[i] * span, behavior: 'smooth' })
    },
    [lastPage, reduced],
  )

  /**
   * 选定一朵云，并**当场替他翻过去**。
   *
   * 停在原地等他自己往下滚，读起来像是没生效 —— 按钮的语义是"去那一朵"，
   * 那就该出发。这跟"不阻塞"不冲突：不点照样能一路滚到底（默认 A），
   * 滚过头之后往回滚，窗口会再出现、按下态还在。
   */
  const pick = useCallback(
    (key: BranchKey) => {
      setBranch(key)
      goTo(CHOICE_PAGE + 1)
    },
    [goTo],
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

  const text = pageText(branch, page)
  const atEnd = page >= lastPage
  /** 静止模式没有滚动，窗口只能由页码决定；动效模式由 onFrame 里那对边界决定 */
  const showingChoice = reduced ? page === CHOICE_PAGE : choiceOn

  return (
    <section className="storybook" ref={wrapRef} aria-label={`滚动翻页绘本《${BOOK_TITLE}》`}>
      <div className="storybook__stage" ref={stageRef}>
        {/* 四周的点阵与那团"落在桌面上的光"。两层都挂在 stage 而不是这一节上，
            所以永远正好铺满视口、不会有条边切过画面 —— 推导见
            storybook-flip.css §1.5。纯装饰，对辅助技术整块隐藏。 */}
        <div className="storybook__ambient" aria-hidden="true" />
        <div className="storybook__light" aria-hidden="true" />

        {/* 被当前页染上的那一层色（CSS §1.6）。五面各一张铺底，靠 opacity 交叉淡入，
            所以翻页时背景是"换色"而不是"跳色"。
            挂在 stage 上与点阵、光斑同一层理由：sticky 满屏，永远正好铺满视口。
            纯装饰，整块对辅助技术隐藏。 */}
        <div className="storybook__tint" aria-hidden="true">
          {tints.map((t, k) =>
            t ? (
              <i
                key={k}
                className="storybook__tint-face"
                data-on={page === k || undefined}
                style={{ '--t1': t[0], '--t2': t[1], '--t3': t[2] } as CSSProperties}
              />
            ) : null,
          )}
        </div>

        <div className="storybook__book">
          {/* 5 片 3D 叶对辅助技术是一团噪音（十个面里一半还是背朝外的），
              整块 aria-hidden，内容由下面那段 aria-live 的正文替代。 */}
          <div className="book" aria-hidden="true">
            {leaves.map((leaf, i) => (
              <div key={i} className="book__leaf" style={leafVars(i)}>
                <Face face={leaf.front} side="front" showImage={spreadsReady} />
                <Face face={leaf.back} side="back" showImage={spreadsReady} />
              </div>
            ))}
          </div>
          <div className="book__ground" aria-hidden="true" />
        </div>

        <BookSpine labels={labels} active={page} onJump={goTo} />

        {/* 最后一页升起的收尾。p 0.74 之后 —— 那一页是分支页，不是封底（封底翻不到） */}
        <div className="storybook__end" data-on={atEnd || undefined}>
          <p className="book__note">{BOOK_NOTE}</p>
          {/* ★ 2026-10-17 接线（原 TODO 是"创作流程做出来后换成指向 /create 的 Link"）。
              落点选了 `/home` 而不是 `/create`，与首屏那颗「开始创作」同一处 —— 理由见
              `components/hero/StartCreating.tsx` 文件头：`/home` 是工作台的「创作」那一屏，
              一句话就能进去，比直接落在四步表单的第一格里轻；创作流本身仍在 `/create`。
              ★ 这里是一颗**普通** `<Link>`，不带首屏那一颗的退场与跨页接力：接力量的是
              环上那 12 张此刻在视口里的位置，而翻到最后一页时那个环早就不在画面里了。 */}
          <Link className="book-cta" href="/home">
            {BOOK_CTA} →
          </Link>
        </div>

        {/* ↓↓↓ 静止模式那一套。正常模式下三块都是 display: none，靠 CSS 切，不靠 JS ——
            这样首帧就是对的，不会先闪一下动效版。 */}
        <div
          className="storybook__static"
          data-cover={page === 0 || undefined}
          aria-hidden="true"
          style={{
            backgroundImage:
              spreadsReady || page === 0 ? `url(${pageImage(branch, page)})` : undefined,
          }}
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

        {/* ------------------------------------------------------------------
            选择点。**不阻塞滚动** —— 不点也能一路滚到底，默认走分支 A。
            阻塞式（不选就不让走）会把人困在原地，评审尤其容易以为页面坏了。
            但**点了就当场翻过去**（见 pick）：不阻塞说的是"不逼你选"，
            不是"选了也没反应"。

            两个按钮的左右方位必须与 P4 那张图、P1 封面严格一致：
            左 = 🦕 恐龙云，右 = ⛵ 帆船云。方向反了，孩子看图、看按钮会读成两件事。
            顺序就是 BRANCH_ORDER，不许改。
            ------------------------------------------------------------------ */}
        <div
          className="book-choice"
          data-on={showingChoice || undefined}
          role="group"
          aria-label={BOOK_CHOICE_ASK}
        >
          <p className="book-choice__ask">{BOOK_CHOICE_ASK}</p>
          <div className="book-choice__row">
            {BRANCH_ORDER.map((key) => {
              const b = BRANCHES[key]
              return (
                <button
                  key={key}
                  type="button"
                  className="book-choice__btn"
                  aria-pressed={branch === key}
                  onClick={() => pick(key)}
                >
                  <span className="book-choice__icon">
                    {/* 图标是**那朵云自己的小插画**（出图文档 P7），不是系统 emoji ——
                        emoji 是扁平高饱和的 clip-art，与水彩是两套画法，而且和画面里
                        那两朵云只有语义对应、没有视觉对应。
                        glyph 是兜底：图还没进来时按得见的是一块有东西的纸片，
                        而不是一个空框；图一到就是一张不透明的小画，正好盖住它。 */}
                    <span className="book-choice__glyph" aria-hidden="true">
                      {b.emoji}
                    </span>
                    {/* 刻意**不**加 loading="lazy"：两张图一共 2.6KB，省不下什么，
                        而懒加载会让它们拖到面板快出现时才取 —— 选择点只有 18% 的
                        滚动窗口，慢一点就是一帧空框。宁可白拿 2.6KB。 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="book-choice__art" src={b.icon} alt="" />
                  </span>
                  <span className="book-choice__label">{b.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
