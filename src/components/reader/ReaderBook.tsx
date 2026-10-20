'use client'

/**
 * ReaderBook —— 独读版阅读器（工单 06）
 *
 * 一页一图一句，从封面翻到封底。几何**整块搬** `components/book/flip.ts`
 * （它是纯函数，当初就是为这一屏留的），一份不改。
 *
 * ---------------------------------------------------------------------------
 * 与首页第二屏那本演示书的**同与不同**
 *
 *   同：叶模型完全一样 —— 一张 3:2 的舞台、每半幅 3:4、叶绕书脊 rotateY、
 *       `--book-x` 在合着时 25%、翻开时 0、纸感靠 shade = sin(θ)；
 *       而且**一页 = 一个跨页 = 一张 3:2 的图**：左半挂上一叶的背面、右半挂下一叶的
 *       正面（`openingOf` 就是这条的推论），同一张图挂两次、靠 background-position
 *       各取一半，正文只跟左半走。
 *       ★ 这条是 2026-10-15 改对的，之前的形状是错的：每一面装的是一整页
 *         （方图在上、正文在下），于是翻开一屏是**左右各一张不同的图**。
 *         那不是绘本，是"一页图配一页字"两页并排——产品要的是首页那样：一张横图
 *         在书脊处切开，画面是连着的，左页叠正文。
 *       ★ 值得记一笔的是**改这一处没动几何**：`flip.ts` 一个字没改，舞台尺寸、
 *         `--book-x`、层序全一样。错的从来不是翻页几何，是"每一面装什么"。
 *   不同：① 驱动量不是滚动，是**翻页动作**（点、滑、键盘、页码）；
 *        ② 没有选择点、没有刻度盘（那是首页与共读版的东西）；
 *        ③ **末尾多一个合着态**：翻到头时全部叶都在左边，`--book-x` 要反向挪半幅
 *           （-25%）才让封底落在正中——首页只有开头一个合着态。
 *
 * ---------------------------------------------------------------------------
 * ★ 2026-10-18 晚：这一屏**只剩底图与书**（与书单那台同一次改动，用户：
 *   「把书籍四周的仿真书效果删掉吧，只有背景就行」）。删掉的是：桌上的暖光
 *   `.reader__light`、书底下的两层接触影、书页内侧的明暗 `.reader__shade`。
 *   ★ 上面第 13 行那句"纸感靠 shade = sin(θ)"只对**首页第二屏**成立了 ——
 *     `flip.ts` 照旧交出 `shade`，这一屏不再渲染它（翻页看不到纸张厚度是取舍）。
 *   ★ 这一台**没有**染色层可删：它当初就没做（没有离线色表），所以删的是三层。
 *
 * ---------------------------------------------------------------------------
 * 三条刻意的约定，每条对应一次会真发生的事
 *
 * 1. **键盘只在容器上接**（`onKeyDown` + `tabIndex`），不在 `window` 上。
 *    首页那个已知 bug 就是 `window` 上无条件接键——书滚出屏幕照样翻页。
 *    新页面不许复制那个形状（docs/known-tradeoffs.md）。
 * 2. **图片按窗口挂载**：只给离当前跨页（opening）不超过一页的面挂 `background-image`。
 *    一张出图是 1536×1024 的 PNG（三兆多），20 页全挂上就是几十兆——那不是"慢一点"，
 *    是首屏根本进不去（#12 的 LCP）。
 *    ★ 左右半是**同一张图、同一个 URL**，浏览器只下一次——这也是"半页不切成两个文件"
 *      的一半理由（另一半在 flip.ts：切了之后 3:2 与 3:4 的比例就没人替你咬住了）。
 * 3. **缺口有缺口的样子**：没有图的那一页显示一张"这一页没做出来"的纸，
 *    不留裂图、不留空框（CLAUDE.md「不糊弄」）。它只出在**左半**（正文所在的那半），
 *    右半照实是一张白纸——那一页确实什么都没有。
 *
 * ---------------------------------------------------------------------------
 * 共读版（2026-10-18）：**同一台阅读器，形态是入参**
 *
 * 产品定义里"一个引擎、两种形态"，落到这一屏就是**一个组件**：ADR-0006 的原话是
 * "`form` 是入参不是两个入口函数，UI 那边不许出现 `runSoloBook()` / `runSharedBook()`
 * 这种分裂"。两台阅读器的坏处是具体的——`use-narration.ts` 的文件头为
 * "两份抄件迟早漂成两个脾气"付过一次学费。
 *
 * 所以这一屏多出来的东西只有四样：
 *  1. **阅读顺序是那条路**（`storyPath`），不是页号——这一条整块在 `reader-model.ts` 里，
 *     连"为什么不能平铺"都写在那儿；
 *  2. **选择点那一屏**：画面停住、两颗大按钮（图 + 字 + 语音双通道）；
 *  3. 没选之前 `›` 被挡住（`maxLeafOf`），因为"不选也能往下翻"会让共读版
 *     退化成独读版加一页；
 *  4. **上次选了哪一支记得住**（工单 07，`lib/reading-path.ts`）：存的是那一个字，
 *     不是整条路——第二天翻开同一本书，按下态还在、往下翻走的是那一支。
 *
 * 而 `flip.ts` 的几何、面表、叶数、挂图窗口、朗读那一套**一个字都没改**——
 * 它们本来就是"一屏一页"的机器，共读版换掉的只是"喂给它哪些页"。
 *
 * ---------------------------------------------------------------------------
 * 朗读（2026-10-17 起由 `use-narration.ts` 提供，两条路）
 *
 * · **我自己翻**（默认）—— 点一下念当前这一页，念完就停，页由人翻。
 * · **自动朗读** —— 按一次，从这一屏往后一页页自己念、念完自己翻；
 *   人一翻页它就停下（"翻页就停"那条规矩没变，只是多了一种走法）。
 *
 * 两个答案来自侧栏 设置 · 阅读偏好（`lib/reading-prefs.ts`），
 * 而这一屏**没有侧栏**（`(studio)` 路由组的 layout 文件头写了为什么），
 * 所以底下那行小字要说清"在哪儿改"。
 *
 * ★ 2026-10-20：这一屏两种形态**各读各的那条偏好**（`useTurnMode` / `useSharedTurnMode`），
 *   而自动朗读在共读版上多一段路：**走到还拦着路的选择点就停下来**，把提问与两个选项
 *   念给孩子听，选完那一支接着念（规则整段在 `use-narration.ts` 的文件头）。
 *   要停的那一屏由 `stopAt` 告诉 hook——它唯一的来源是 `blocked`（`reader-model.ts`
 *   的 `maxLeafOf` 用的是同一个判断），所以"能按 › 翻过去"与"这一趟会停在哪儿"
 *   永远是同一件事的两个说法。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flipState } from '@/components/book/flip.ts'
import { loadPick, savePick } from '@/lib/reading-path.ts'
import { useReadingLog } from '@/lib/use-reading-log.ts'
import { useReaderPaper, useSharedTurnMode, useTurnMode } from '@/lib/use-reading-prefs.ts'
import {
  choiceClipsOf,
  choiceScreenOf,
  leafCountOf,
  maxLeafOf,
  openingOf,
  pathPages,
  readoutOf,
  readerFaces,
  showsText,
  storyPath,
  type Pick,
  type ReaderFace,
} from './reader-model.ts'
import { useNarration } from './use-narration.ts'
import { useSwipeTurn } from './use-swipe-turn.ts'
import type { ResolvedStory, StoryChoiceView } from '@/lib/book-source.ts'

/** 每帧朝目标插值的系数。比首页第二屏的 0.12 略快：这一屏是"点一下就翻" */
const SMOOTHING = 0.16
/** 离当前跨页超过这么多页的面就不挂图（见文件头第 2 条） */
const IMAGE_WINDOW = 1.6

export type ReaderBookProps = {
  bookId: string
  title: string
  /** 封面图。null = 这本书没有封面（仓库里那本预生成的演示书就是），照实只出书名 */
  coverUrl: string | null
  /**
   * 这本书的**形状与每一页的视图**（`resolved.story`）。
   * ★ 拿它而不是 `resolved.pages`：后者是"按页号排的全表"，共读版要的是那条路。
   */
  story: ResolvedStory
  source: 'runtime' | 'demo'
}

export default function ReaderBook({ bookId, title, coverUrl, story, source }: ReaderBookProps) {
  /**
   * 页模型（面表、叶数、opening、页码）全在 `reader-model.ts` 里，**这个组件只负责画**。
   * ★ 抽出去的理由写在那个文件头：那次返工错的不是几何，是"每一面装什么"，
   *   而那种错闸门抓不到——所以它得是一条能被断言的关系，不是散在 JSX 里的写法。
   */
  /* ── 路径：共读版多出来的那一样 ────────────────────────────────────────────
   * `pick` 是"孩子选了哪一支"。★ 它**落盘**（工单 07）：同一本书第二天再翻开，
   * 上次选的那一支还在——按下态还在，往下翻走的也是那一支。
   * 落的是**这一个值**（不是整条路径：路径由树推得出来，存两份就是两个真相），
   * 家是 `lib/reading-path.ts`（`localStorage`，与阅读记录、阅读偏好同一族）。
   * 独读版没有选择点，`pick` 永远是 null，下面那一路就是恒等式。
   *
   * ★ **初值一律 null，挂载之后才读盘**。这一条是必须的：服务端渲染那一趟
   *   读不到 `localStorage`，首屏 HTML 只能是"没选过"；把初值写成"读得到就读"的
   *   样子，客户端第一次渲染就与那份 HTML 不一致（hydration 报错）。
   *   推理与代价与 `use-reading-prefs.ts` 文件头那一条相同，而这里的代价更小：
   *   选择点在好几屏之后，读盘那一瞬的替换孩子根本看不见。
   */
  const [pick, setPick] = useState<Pick>(null)
  useEffect(() => {
    setPick(loadPick(bookId))
  }, [bookId])
  const path = useMemo(() => storyPath(story, pick), [story, pick])
  const pages = useMemo(() => pathPages(path), [path])
  const leafCount = leafCountOf(pages)

  const [qTarget, setQTarget] = useState(0)
  const [q, setQ] = useState(0)
  const [reduced, setReduced] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  /* ── 朗读 ────────────────────────────────────────────────────────────────
   * 那一套（`speaking` / `audioFailed` / 音频元素 / 自动朗读那条链）整块在
   * `use-narration.ts` 里，与灵感书单那本样书**共用同一份**——理由写在那儿的文件头。
   * 这一层只提供两样它算不出来的东西：当前是第几屏（落定的那个），以及怎么翻页。
   */

  const { turnMode } = useTurnMode()
  /**
   * 共读版那一档（2026-10-20）。★ **两档各读各的键**：独读版是睡前自己听、
   * 共读版是白天陪玩（中间还要孩子选一支），一条偏好顺手改掉另一档不是我们要的。
   * 所以这里按 `story.form` 二选一，喂给朗读那一套的是**挑好的那一个**。
   */
  const { turnMode: sharedTurnMode } = useSharedTurnMode()
  const mode = story.form === 'shared' ? sharedTurnMode : turnMode
  /** §桌面那一层铺哪张底图。与书单那台**同一个偏好**（两台是同一张桌子） */
  const { paper } = useReaderPaper()
  /**
   * 补间**落定后**的那一屏：`0` = 封面，`leafCount` = 封底。
   * ★ 取 `Math.round(q)` 而不是 `readout.page`：后者在封面与封底都给 `null`，
   *   而自动朗读必须分得清这两端（一头是"从头念"，一头是"念完了"）。
   */
  const opening = Math.round(q)
  /** 页翻到位了没有。★ 是个布尔，所以 60fps 的 `q` 不会把它抖成每帧都变 */
  const settled = Math.abs(q - qTarget) < 0.02

  /**
   * 面表。★ 它跟着**路径**走（`pages`），所以选完之后翻了页、面表也跟着变长了——
   * 这正是"共读版没有第二台阅读器"那句话在代码里的样子。
   */
  const faces = useMemo<ReaderFace[]>(() => readerFaces(pages), [pages])

  /* ── 选择点 ────────────────────────────────────────────────────────────────
   * 几件事都从这一处派生，别在 JSX 里各算一遍：
   *  · `choice` —— 这一屏该浮出的选择点（不是那一屏就是 null）
   *  · `choiceClips` —— 这一屏要念的三段（提问 → A → B）
   *  · `blocked` —— 前面没路了，而拦住它的是**还没选过的那个选择点**
   *  · `maxTarget` —— `›` 能翻到的上界（`blocked` 时封底那一片叶不给）
   *  · `stopAt` —— 自动朗读要停在哪一屏等孩子选（与 `blocked` 同源，见下面）
   */
  const choice = useMemo(() => choiceScreenOf(path, opening), [path, opening])
  /**
   * 这一屏的选择点要念的三段（引导提问 → 选项 A → 选项 B）。`null` = 这一屏没有。
   * ★ 与"要不要停在这儿"**是两件事**：选过之后回到这一屏，那三段照样能按一下念一遍
   *   （那颗「🔊 念一遍」还在），只是不该再拦住自动朗读那一趟。
   */
  const choiceClips = useMemo(() => (choice ? choiceClipsOf(choice) : null), [choice])
  /**
   * 前面没路了，而拦住它的是**还没选过的那个选择点**。
   * 判据就一句：**这条路的最后一屏是个选择点**——`storyPath` 在没选时停在选择点上，
   * 于是"路走到了头"与"有个岔口在等"是同一件事。独读版与选过的共读版都为 false
   * （它们的路以叶子收尾），所以这一条也不改独读版的量程。
   */
  const blocked = useMemo(
    () => pick === null && (path[path.length - 1]?.choice ?? null) !== null,
    [pick, path],
  )
  const maxTarget = maxLeafOf(pages, blocked)

  /**
   * 自动朗读这一趟要停在哪一屏等孩子选（`null` = 一路念到底）。
   * ★ 判据只有一条：**这一屏还拦着路**——`storyPath` 走到没选过的选择点就停下，
   *   所以那时路的最后一屏恰好就是那个选择点，于是它就是 `pages.length`。
   * ★ 选过之后（昨天选过的也算）它为 `null`：那一屏就是一页普通的页，没有要决定的事。
   */
  const stopAt = blocked ? pages.length : null

  /** 第 k 屏的朗读（封面与封底不在内）。`useMemo`：不然每次渲染换一个新数组，
   *  hook 里那条链的依赖会跟着换身份，白跑一遍 */
  const narrationUrls = useMemo(() => pages.map((page) => page.audioUrl), [pages])

  const narration = useNarration({
    urls: narrationUrls,
    opening,
    settled,
    // ★ 直接把 `setQTarget` 递进去：它的身份是稳定的，而这条链会拿它当依赖。
    //   包一层匿名函数也能跑，但那个函数每次渲染都是新的，链就会每次渲染都重跑
    goTo: setQTarget,
    mode,
    choiceClips,
    stopAt,
  })
  // ★ `takeOver` 单独取出来：它自己是稳定的（`useCallback` 包着），而 `narration`
  //   这个对象每次渲染都是新的——`turn` 依赖前者才不会每次渲染都换身份
  const { takeOver, continueAfterPick } = narration

  /* ── 静止模式：读一次、订阅一次。reduced 下不跑补间，直接落在目标上 ───────── */

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(media.matches)
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  /** 当前显示到的那一叶。★ 补间读它，不读 state：把副作用写进 setState 的更新函数里，
   *  严格模式下会起两条 rAF 链，而清理函数只知道其中一条——实测那会变成"翻页越来越快" */
  const qRef = useRef(0)

  /**
   * 手指拖动期间**直接写** q（2026-10-19 移动端适配）。
   * ★ 这是跟手的全部机制：补间那条链是"朝 `qTarget` 插值"，而拖动要的是"手到哪儿
   *   画面到哪儿"，所以拖动期间绕开它、直接写；松手再把它交回去（见 `use-swipe-turn.ts`
   *   文件头末尾那条契约）。两个写者同时写同一个 q 就是画面抖。
   */
  const writeQ = useCallback((value: number) => {
    qRef.current = value
    setQ(value)
  }, [])

  /* ── 手指跟手翻页 ──────────────────────────────────────────────────────────
   * 整套在 `use-swipe-turn.ts` 里，与书单那台**共用同一份** —— 理由写在那儿的
   * 文件头："会漂成两个脾气的是行为，不是长相"。这一层只交三样它算不出来的东西：
   * 舞台（量宽度的基准）、上界（`maxTarget`，见 `reader-model.ts`）、
   * 以及"人已经在翻页了，朗读停下"。
   */
  const swipe = useSwipeTurn({
    stageRef,
    qRef,
    write: writeQ,
    // ★ 直接递 `setQTarget`：它的身份是稳定的（与 `goTo` 那条同一个理由）
    settle: setQTarget,
    maxTarget,
    onTakeOver: takeOver,
  })
  const { dragging } = swipe

  /* ── 补间：朝 qTarget 插值。reduced 下直接跳（不是"不翻页"，是"不播动画"） ── */

  useEffect(() => {
    /* ★ 手指正按着的时候**不起这条链**（见上面那条契约）：它和拖动都在写 q。
       拖动一开始 `dragging` 变真，这个 effect 重跑 → 清理函数把旧的那条 rAF 掐掉；
       松手后 `dragging` 变回假，effect 再跑一遍，带着新的 `qTarget` 从**当前**的 q
       平滑收尾 —— 所以落定那一下仍然是补间，不是硬切。 */
    if (dragging) return
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
  }, [qTarget, reduced, dragging])

  const turn = useCallback(
    (delta: number) => {
      // ★ 翻页就停，这一条从第一天就在，自动朗读也没有把它推翻——
      //   只是现在有两种情形都落到它身上：
      //   · 手动模式下点“朗读”念着这一页，翻走了（念的是上一页的字，是错的）
      //   · 自动朗读这一趟正在念，人自己翻了一页 → **人接管，这一趟结束**
      //     （`takeOver()` 里那一句注释有为什么不是"声音跟着新页继续念"）
      //   ★ 自动朗读自己往下翻**不走这里**：它走 `use-narration.ts` 里的 `goTo`，
      //     否则每念完一页都会把自己关掉。
      // ★ 调的是解构出来那个 `takeOver`（身份稳定），不是 `narration.takeOver`：
      //   后者挂在每次渲染都新建的对象上，会让这个 `useCallback` 白写
      takeOver()
      /**
       * ★ 上界是 `maxTarget` 不是 `leafCount`（2026-10-18）：共读版**没选之前**，
       *   封底那一片叶不给——一路点 `›` 翻到最后一屏「读完啦」而孩子一次都没选过，
       *   等于把共读版做成了独读版加一页。理由整段在 `reader-model.ts` 的 `maxLeafOf`。
       */
      setQTarget((current) => Math.min(maxTarget, Math.max(0, current + delta)))
    },
    [maxTarget, takeOver],
  )

  /**
   * 孩子按下了某一颗按钮。
   *
   * 三件事按顺序：**落下按下态 → 记住这一支 → 翻到那一支的第一页
   * （`pick` 一变，整条路跟着变）**。
   *
   * ★ 翻页走 `setQTarget` 而不是 `turn(1)`：`turn` 每次都会 `takeOver()`（人翻页 = 人接管），
   *   而在选择点上按按钮**本来就不是"人翻页"**——它是这一屏该做的事。
   *   走 `turn` 的话，按完按钮自动朗读会被莫名其妙地关掉。
   *   ★ 2026-10-20：连停声这一件事也换成了 `continueAfterPick()`——它停的是**声音**，
   *     不关这一趟。共读版的自动朗读是"念到选择点停下、选完接着念"（`use-narration.ts`
   *     规则 4），而"选完"这一步正好落在这里；走 `takeOver()` 的话，孩子选完，
   *     剩下半本书就不会自己念了。
   * ★ 按下态与路径是**同一个 state 的两个投影**（`pick`）：先落下再翻页，
   *   那一帧里按下态就在了，所以看不到"翻过去之后才亮起来"的闪。
   * ★ `savePick` 是"孩子选了哪一支"**唯一的写盘处**（工单 07）——所以那个值只有一个
   *   来源。改选走的也是这里（覆盖），没有第二条路会去写它。
   */
  const pickVia = useCallback(
    (via: 'a' | 'b') => {
      continueAfterPick()
      setPick(via)
      savePick(bookId, via)
      // 翻到那一支的第一页。`pick` 一变，`path` 就长了一截，所以 `current + 1` 是新路里的下一页
      setQTarget((current) => current + 1)
    },
    [bookId, continueAfterPick],
  )

  /**
   * 焦点在容器里时，左右键与空格翻页。**不在 window 上接**（见文件头第 1 条）。
   *
   * ★ 这里**不写**"焦点在按钮上就让路"那一类守卫（2026-10-18 删掉过一次）：
   *   舞台里根本没有按钮——选择点那两颗与朗读钮都刻意挂在舞台**之外**
   *   （见下面那个定位盒与 `ChoicePoint` 的注释）。所以那类守卫是**死代码**，
   *   而一条永远不会命中的守卫比没有更糟：它的注释会让人以为舞台里真有按钮。
   *   真正的机制是"控件不在这个子树里，事件就到不了这儿"——那是结构，不是判断。
   */
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
        setQTarget(maxTarget)
      }
    },
    [turn, maxTarget],
  )

  /* ── 触摸滑动 ────────────────────────────────────────────────────────
   * 2026-10-19：这一段原来住在这里（"划 44px 松手才翻一页"），现在整块搬去
   * `use-swipe-turn.ts` 并改成**跟手**——两台阅读器共用同一份，理由在那儿的文件头。
   * 这里不再留半截：翻页手势只有那一个来源。 */

  const states = useMemo(() => flipState(q, leafCount), [q, leafCount])

  /* ── 页码：当前"看着的那一页" ─────────────────────────────────────── */

  /**
   * 一屏就是一页：翻开的那一屏 = 第 near 页，所以不再是"左页几、右页几"——
   * 一屏里那两半本来就属于同一页（同一张图）。
   *
   * ★ `page` 是 `number | null`，不是拿 0 / `pages.length` 当哨兵：封底那个哨兵值
   *   **恰好等于最后一页的页码**，于是"看着封底"会被下游读成"在第 P 页"——
   *   朗读按钮亮着、`useReadingLog` 把停在封底的时间记成又读了一页。
   *   这一屏改页模型时一起修掉（推理与断言见 `reader-model.ts`）。
   */
  const readout = useMemo(() => readoutOf(q, pages), [q, pages])

  /**
   * 底栏那个总数（工单 04 §三）。
   *
   * ★ 共读版说的是「**这条路**共 N 页」，不是「共 N 页」：这个数**取决于孩子选了哪一支**
   *   （两支允许差 1 页，`tree.ts` 的判据），而整棵树比它长。不加这三个字的症状是
   *   家长拿它当整本页数，然后问"书里那几页去哪儿了"。
   * ★ 独读版不加：那里没有第二条路，加了反而像在说还有别的走法。
   */
  const totalNote =
    story.form === 'shared' ? `这条路共 ${pages.length} 页` : `共 ${pages.length} 页`

  /** 这一个 opening 的面挂不挂图（见文件头第 2 条） */
  const inWindow = useCallback((opening: number) => Math.abs(opening - q) <= IMAGE_WINDOW, [q])

  /**
   * 书脊的横向偏移。首页那套是「合着时 25%、翻开时 0」，让**右半幅**落在正中；
   * 阅读器多一个**末尾**的合着态：q 到头时全部叶都翻到了左边，封底落在左半幅，
   * 所以要往反方向挪半幅（-25%）才落在正中——否则封底那一屏的右半幅是空白纸，
   * 看着像"书没合上"。两个端点在视觉上因此是对称的。
   */
  const bookX = q < 0.5 ? '25%' : q > leafCount - 0.5 ? '-25%' : '0%'

  /* ── 朗读：当前页是哪一页，以及"没有朗读"这件事怎么被说出来 ─────────────── */

  // 阅读记录（工单 05）：只算页面可见的时长，翻页才算"读过"。规则见 use-reading-log.ts
  useReadingLog(bookId, readout.page)
  const narratedCount = pages.filter((page) => page.audioUrl !== null).length

  /**
   * 出错的那一屏换算成**页码**。
   * ★ hook 报的是屏序号（第几屏），这里要的是这一页印的页号——两者只在页号
   *   恰好连续时才相等，而"恰好"不是这一条的依据（共读版的页号会跳）。
   */
  const failedPageNo =
    narration.audioFailed === null
      ? null
      : (pages[narration.audioFailed - 1]?.pageNo ?? narration.audioFailed)

  /**
   * 没有朗读控件时，**说清为什么**。放在这行小字里，因为那正是"这本书怎么了"
   * 该出现的地方（首页那条教训：宁可整节不做，也不要一个骗人的控件）。
   */
  const narrationNote =
    failedPageNo !== null
      ? `第 ${failedPageNo} 页的朗读没加载出来（音频读不到，这一页请自己念）`
      : narratedCount === 0
        ? '这本书没有朗读'
        : narratedCount < pages.length
          ? `这本书只有 ${narratedCount}/${pages.length} 页有朗读，所以没有给朗读控件——只对几页能响的按钮，证的是反面`
          : null

  /**
   * 自动朗读开着时多说一句"在哪儿改"。
   * ★ 这一屏**没有侧栏**（`(studio)` 路由组之外），所以这句话不是多嘴：
   *   不说的话，一个人只会觉得"这书怎么自己在翻"，而找不到关掉它的地方。
   * ★ 出错那一条优先（`narrationNote === null` 是前提）：那时"自动朗读开着"
   *   已经不成立了——上面那条链读到音频读不出来就把这一趟停掉了。
   * ★ 2026-10-20 加了一档：停在选择点上时改说**为什么没声了**。那一刻这一趟确实
   *   开着（钮还是「■ 停止」），可书不再往下走——不说明白，家长会以为它卡住了。
   *   （"在哪儿改"那句这时可以不提：钮就在下面，按一下就停。）
   * ★ 判据用的是 `mode`（这一本书按形态挑好的那一个），不是 `turnMode`：共读版
   *   读的是另一个键，写成 `turnMode` 的话共读版选了自动朗读也不会有这行小字。
   */
  const autoNote =
    narration.fullyNarrated && mode === 'auto' && narrationNote === null
      ? narration.awaitingPick
        ? '自动朗读停在选择点上：选完一支，剩下的接着念。'
        : '自动朗读开着（念完一页自己翻）。想自己翻，到工作台左下角的「设置」里选「我自己翻」。'
      : null

  return (
    <section
      className="reader"
      data-motion={reduced ? 'reduced' : 'full'}
      /* 有封面图 / 没有封面图，是两种版式（书名叠在图上 / 书名就是那一面）。
         ★ 写在 DOM 上而不是 CSS 里判断："这张图在不在"是数据说的事，样式不该去猜 */
      data-cover={coverUrl ? 'image' : 'plain'}
      data-source={source}
      aria-label={`${title} · 阅读器`}
    >
      {/* §桌面那层底图（`reader-book.css`）。`fixed; inset: 0` —— 铺的是**整块视口**
          （与书单那台同一个改法、同一个理由）。
          ★ 上面那行「← 回…」在 `.reader-page` 里，够不到这个 div，所以它靠自己
            `position: relative` 站到底图上面（`globals.css`）。
          与书单那台是同一层、**同一个偏好**（用户挑哪张两台一起换），
          只是这一屏不做染色（理由在 CSS 里）。
          纯装饰，对辅助技术整块隐藏。 */}
      <div
        className="reader__desk"
        data-paper={paper.key}
        style={
          paper.url
            ? ({ ['--reader-paper' as string]: `url(${paper.url})` } as React.CSSProperties)
            : undefined
        }
        aria-hidden="true"
      />

      {/* ── 舞台 + 选择点 ────────────────────────────────────────────────────
          这两个共用一层定位盒，理由只有一条：**选择点要浮在书上、但不能进舞台**。

          · 它得有个"书有多高"的定位基准才能浮到书的下沿，而那个尺寸只有舞台有；
          · 它**不能**进 `.reader__stage`：舞台是滑动手势与键盘翻页（容器级 onKeyDown）
            的容器。控件落在里面，空格既激活按钮又翻页、在按钮上横扫一下还会翻页；
          · 它更不能进 `.reader__book`：那一支是 3D 旋转的叶，控件跟进去会跟着转、点不准
            （朗读钮放底栏是同一条）。

          所以这一层 div 是**纯几何**的：没有事件、没有样式之外的职责。
          ★ 于是"键盘：容器内翻页、容器外一点不翻"这条验收是**结构保证**的，
            不是靠 `onKeyDown` 里判 `event.target` 是不是按钮——那条守卫删掉了，
            理由写在 `onKeyDown` 上面。 */}
      <div className="reader__stagewrap">
        <div
          className="reader__stage"
          ref={stageRef}
          tabIndex={0}
          role="group"
          aria-label="绘本翻页区（方向键或空格翻页）"
          onKeyDown={onKeyDown}
          /* 手指跟手翻页那四个处理器整块来自 `use-swipe-turn.ts`
             （`onTouchCancel` 也要接：来电、系统手势打断时不接住的话，
             画面会停在半翻的那一帧上）。 */
          onTouchStart={swipe.onTouchStart}
          onTouchMove={swipe.onTouchMove}
          onTouchEnd={swipe.onTouchEnd}
          onTouchCancel={swipe.onTouchCancel}
          data-testid="reader-stage"
        >
          {/* 舞台宽 = 2 × 页宽（3:4 的一页）。--book-x 是首页那套，只是多了一个末尾的合着态 */}
          <div className="reader__book" style={{ ['--book-x' as string]: bookX }}>
            {Array.from({ length: leafCount }, (_, leaf) => {
              const state = states[leaf]
              if (!state) return null
              const front = faces[leaf * 2]
              const back = faces[leaf * 2 + 1]
              return (
                <div
                  key={leaf}
                  className="reader__leaf"
                  style={{
                    ['--leaf-angle' as string]: `${state.angle}deg`,
                    ['--leaf-z' as string]: String(state.zIndex),
                  }}
                >
                  {front && (
                    <FaceView
                      face={front}
                      side="front"
                      show={inWindow(openingOf(leaf * 2))}
                      bookTitle={title}
                      coverUrl={coverUrl}
                    />
                  )}
                  {back && (
                    <FaceView
                      face={back}
                      side="back"
                      show={inWindow(openingOf(leaf * 2 + 1))}
                      bookTitle={title}
                      coverUrl={coverUrl}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* DOM 顺序在底栏之前，所以 Tab 的顺序是「舞台 → 两颗按钮 → 底栏」，
            与眼睛看到的上下关系一致。它自己的开关在 `ChoicePoint` 里（`data-on`）。 */}
        {choice && (
          <ChoicePoint
            choice={choice}
            pressed={pick}
            settled={settled}
            onPick={pickVia}
            /* ★ 那三段的播放权在 `use-narration.ts` 里（2026-10-20 搬过去）：自动朗读
               走到选择点也要念它，而这一屏的声音只能有一个出处。这一层只把三样它
               算不出来的东西递进去——正在念没有、三段齐了没有、按下去干什么。 */
            speaking={narration.choiceSpeaking}
            canSpeak={narration.choiceCanSpeak}
            onToggleSpeak={narration.toggleChoice}
          />
        )}
      </div>

      <div className="reader__bar">
        <button
          type="button"
          className="reader__btn"
          onClick={() => turn(-1)}
          disabled={qTarget === 0}
          aria-label="上一页"
        >
          ‹
        </button>
        <p className="reader__readout" aria-live="polite">
          {readout.label}
          {/* ★ "共多少页"在共读版里**没选之前不报**（2026-10-18）。
              它取决于孩子选哪一条路，而两支的页数还可能差 1 页（那是判据允许的）——
              没选就报一个数，报的是猜的。`blocked` 正好就是"站在没选过的选择点上"，
              于是条件就是它取反：独读版与选过的共读版都照报。 */}
          {!blocked && <span className="reader__total"> · {totalNote}</span>}
        </p>
        {/* ★ 朗读按钮放在**底栏**，不是书页上：书页是 3D 旋转的叶，
            半翻状态下按钮会跟着转、点不准；而且它一旦落在 `.reader__stage` 里，
            空格键会**同时**触发它和舞台的翻页处理器（舞台的 onKeyDown 是容器级的）。
            底栏在舞台之外，这两个问题都不存在。
            ★ 文案、禁用态与 `aria-label` 来自 `use-narration.ts`：自动/手动两条路
            各有一套说法，而另一台阅读器（灵感书单那本样书）用的是**同一份** */}
        {narration.fullyNarrated && (
          <button
            type="button"
            className="reader__audio"
            onClick={narration.toggle}
            disabled={narration.button.disabled}
            aria-pressed={narration.button.pressed}
            aria-label={narration.button.ariaLabel}
          >
            {narration.button.label}
          </button>
        )}
        <button
          type="button"
          className="reader__btn"
          onClick={() => turn(1)}
          /* ★ 上界是 `maxTarget`：共读版没选之前，`›` 在这一屏就是按不动的
             （"不选也能往下翻"会让共读版退化成独读版加一页，见 `maxLeafOf`） */
          disabled={qTarget >= maxTarget}
          aria-label="下一页"
        >
          ›
        </button>
      </div>

      <div className="reader__progress" aria-hidden="true">
        <i style={{ width: `${leafCount === 0 ? 100 : (q / leafCount) * 100}%` }} />
      </div>

      {/* 朗读音频。`preload="none"`：一本 20 页的书就是两三兆，别在打开阅读器时全拉下来 */}
      <audio
        ref={narration.audioRef}
        preload="none"
        aria-hidden="true"
        onEnded={narration.onEnded}
        onError={narration.onError}
      />

      {/* 书号留在页面上：演示与排障都要能一眼说出"这是哪一本"。
          ★ 手机横屏那一档把它收进 `sr-only`（`reader-book.css` §手机横屏）：
            那是**排障用**的一行，而横屏下每一像素的高度都是书在用。
            下面那两句 `--note` 不动 —— 它们是**有实义**的说明（朗读怎么了、
            自动朗读开着），该占的地方照占。 */}
      <p className="reader__meta reader__meta--origin">
        {bookId} · {source === 'demo' ? '预生成演示书（不需要网络）' : '这一轮生成的'}
      </p>
      {narrationNote && <p className="reader__meta reader__meta--note">{narrationNote}</p>}
      {autoNote && <p className="reader__meta reader__meta--note">{autoNote}</p>}
    </section>
  )
}

/* ───────────────────────── 每一面 ───────────────────────── */

/**
 * 一面 = 一个半页。图挂在面的**背景**上（不是 `<img>`），因为要的就是
 * "同一张图挂两次、各取一半"——`data-half` 让样式表决定取哪半（见 css 那段）。
 */
function FaceView({
  face,
  side,
  show,
  bookTitle,
  coverUrl,
}: {
  face: ReaderFace
  side: 'front' | 'back'
  show: boolean
  bookTitle: string
  coverUrl: string | null
}) {
  if (face.kind === 'cover') {
    return (
      <div
        className={`reader__face reader__face--${side}`}
        style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
      >
        <div className="reader__cover">
          <h1 className="reader__title">{bookTitle}</h1>
        </div>
        <p className="reader__hint">用 → ← 或点右下角翻页</p>
      </div>
    )
  }

  if (face.kind === 'back') {
    return (
      <div className={`reader__face reader__face--${side}`}>
        <div className="reader__back">
          <p className="reader__back-line">读完啦</p>
          <p className="reader__back-sub">每一页，都是同一个他。</p>
        </div>
      </div>
    )
  }

  const { page, half } = face
  const art =
    !page.missing && show && page.imageUrl
      ? { backgroundImage: `url(${page.imageUrl})` }
      : undefined
  return (
    <div className={`reader__face reader__face--${side}`}>
      {!page.missing && (
        // 图单独一层，而不是挂在 `.reader__face` 上：`role="img"` 会把**子树整个**
        // 从辅助技术里摘掉，挂在外层就把同一面里的正文也一起摘了。
        // ★ 只有**左半**报出这一页的插画，右半 `aria-hidden`：两半是同一张图，
        //   两边都报，屏读会把同一页念两遍。
        <div
          className="reader__half"
          data-half={half}
          style={art}
          {...(half === 'left'
            ? { role: 'img' as const, 'aria-label': `第 ${page.pageNo} 页的插画` }
            : { 'aria-hidden': true as const })}
        />
      )}
      {page.missing && half === 'left' && (
        // 缺图这一页的兜底：一张写清"为什么这里没有画"的纸，不是裂图。
        // ★ 只出在左半：两半都出就是同一句话说两遍（一屏里并排两个虚线框），
        //   而右半照实是一张白纸——那一页确实什么都没有
        <div className="reader__missing">
          <span className="reader__missing-no">第 {page.pageNo} 页</span>
          <span>这一页没做出来</span>
        </div>
      )}
      {/* 正文只跟**左半**走（判据在 `reader-model.ts` 的 `showsText`），位置与出图时
          那条"左下方留出干净区"的构图约束对齐（见 css） */}
      {showsText(face) && (
        <div className="reader__text">
          {page.body.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── 选择点 ───────────────────────── */

/**
 * 选择点那一屏：画面停住，浮出两颗大按钮（产品定义原话）。
 *
 * 五条判断，每条都对着一个具体的坏法：
 *
 * 1. **两颗按钮是那朵云自己的小画，不是系统 emoji**——emoji 是扁平高饱和的 clip-art，
 *    与水彩是两套画法（docs/known-tradeoffs.md 那条判据的第三次应用）。图标没到位时 emoji 是**兜底**：
 *    `alt=""` 的 `<img>` 在 404 时什么都不画，所以兜底会正好露出来，不留碎图标。
 * 2. **`settled` 到了才浮出来**：翻页补间还没停就把控件亮起来，孩子会看着两颗按钮
 *    在转着的纸上飘（朗读也是同一条规矩，见 `use-narration.ts` 规则 3）。
 * 3. **关着的时候写 `visibility: hidden`**（在 CSS 里）：`opacity: 0` 不会把东西
 *    从辅助技术与点击里去掉——封面那一屏会照着把两个选项念一遍。
 * 4. **三段音频合成一句话念**（提问 → 选项 A → 选项 B），**按一下才念**。
 *    不做"浮出来就自己念"：浏览器不允许页面在没人点过的情况下出声，
 *    而拦掉的样子与"这本书没有朗读"一模一样（`use-narration.ts` 规则 1 的同一条）。
 *    三段里缺任何一段就**不给这颗按钮**，并且说清为什么——只对两个选项能响的按钮，
 *    证的是反面（首页那条拆掉的播放条）。
 *    ★ 2026-10-20：播放那三段的东西**整块搬去了 `use-narration.ts`**
 *      （自动朗读走到选择点也要念它，而这一屏的声音只能有一个出处）。
 *      这一层因此收三样 prop：正在念没有、三段齐了没有、按下去干什么——
 *      按钮的文案、位置、`aria-label` 一个字没变。
 * 5. **键盘**：两颗按钮是**原生 `<button>`**，所以 Tab 到、Enter/空格选中全是浏览器
 *    自己的行为，没有一处 `preventDefault`；只在**这一层里**补一条 ← →（在一颗上按
 *    → 走到另一颗），那是 `radiogroup` 的习惯而 `<button>` 不给。
 *    ★ 这一层不在 `.reader__stage` 里，所以这些键**不会被翻页抢走**——反过来说，
 *      "容器的翻页键与控件的键互不干扰"是靠位置保证的，挪进舞台就没了。
 */
function ChoicePoint({
  choice,
  pressed,
  settled,
  onPick,
  speaking,
  canSpeak,
  onToggleSpeak,
}: {
  choice: StoryChoiceView
  /** 孩子已经选过的那一支（没选过是 null）。选过再回翻时用它还原按下态 */
  pressed: Pick
  settled: boolean
  onPick: (via: 'a' | 'b') => void
  /** 那三段正念着（`use-narration.ts` 的 `choiceSpeaking`） */
  speaking: boolean
  /** 三段齐了没有（缺一段就换成一行小字，见上面第 4 条） */
  canSpeak: boolean
  onToggleSpeak: () => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  /**
   * ← → 在两颗按钮之间走。
   *
   * ★ 用 `document.activeElement` 而不是自己养一个"当前是第几颗"的 state：焦点是浏览器
   *   的事实，另存一份就是两个真相，而它们一定会漂（鼠标点完第二颗、state 还停在第一颗）。
   * ★ 焦点不在这两颗上的时候**什么都不做**：那时按 → 不该被这一层吃掉。
   */
  const onRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const buttons = Array.from(rowRef.current?.querySelectorAll('button') ?? [])
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    buttons[(at + delta + buttons.length) % buttons.length]?.focus()
  }

  return (
    <div className="book-choice" data-on={settled || undefined} role="group" aria-label="选择点">
      <p className="book-choice__ask">{choice.prompt}</p>
      <div className="book-choice__row" ref={rowRef} onKeyDown={onRowKeyDown}>
        {choice.options.map((option, index) => {
          const via: 'a' | 'b' = index === 0 ? 'a' : 'b'
          return (
            <button
              key={via}
              type="button"
              className="book-choice__btn"
              aria-pressed={pressed === via}
              onClick={() => onPick(via)}
            >
              <span className="book-choice__icon">
                <span className="book-choice__glyph" aria-hidden="true">
                  {option.emoji}
                </span>
                {/* 与首页那两枚同一条判断：不加 `loading="lazy"`——一枚约 2.6KB，
                    省不下什么，而懒加载会把它拖到这一屏快露出来时才取。
                    ★ 地址只可能来自 `iconUrlOf`，词表之外它给的是 null，
                      所以下面那个 `&&` 不是"可能 404 的图先挂着"，是"有图才画"。 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {option.iconUrl && <img className="book-choice__art" src={option.iconUrl} alt="" />}
              </span>
              <span className="book-choice__label">{option.label}</span>
            </button>
          )
        })}
      </div>
      {canSpeak ? (
        <button
          type="button"
          className="book-choice__speak"
          onClick={onToggleSpeak}
          aria-label={speaking ? '停下' : '念一遍这两个选项'}
        >
          {speaking ? '正在念…（点一下停下）' : '🔊 念一遍'}
        </button>
      ) : (
        <p className="book-choice__note">这一页的选项没有朗读，念给孩子听吧</p>
      )}
    </div>
  )
}
