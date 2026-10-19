'use client'

/**
 * use-swipe-turn.ts —— 手指**跟手**翻页（2026-10-19 移动端适配）
 *
 * ---------------------------------------------------------------------------
 * 它替掉的那一版，以及为什么要替
 *
 * 两台阅读器原来各有一份一模一样的手势：`onTouchStart` 记一个起点、
 * `onTouchEnd` 比 `|dx| > 44 && |dx| > |dy| * 1.5` 才算一次翻页。也就是说
 * **手指在屏幕上划的时候画面一动不动**，松手才播一次补间 —— 那是"滑一下等于点一下"，
 * 而用户要的是"手动滑动屏幕"。
 *
 * 现在：拖动期间 `dx` 按舞台宽换算成叶数**直接写进 q**（绕过补间，画面跟手），
 * 松手落定到最近的一叶，交给各台自己那条补间收尾。
 *
 * ---------------------------------------------------------------------------
 * 为什么是**共用一份**而不是两台各写一遍
 *
 * 与 `use-narration.ts` 同一条分界：**会漂成两个脾气的是行为，不是长相**。
 * 两台阅读器的 DOM 与类名各一套（那是长相，分开是对的），但"手指划过去应该发生什么"
 * 必须是同一件事 —— 分成两份的那天，一台会带阻尼、另一台不会，而那种差别
 * 没有任何人会在评审时指出来，只会让两台机器读起来不像同一个产品。
 *
 * ---------------------------------------------------------------------------
 * 七条判断，每条都对着一个具体的坏法
 *
 * 1. **先判方向，锁定了才开始跟手**（`LOCK_PX` / `LOCK_RATIO`）。竖屏时页面还要能
 *    上下滚（舞台那条 `touch-action: pan-y` 就是这个意思），所以一次**竖向**的手势
 *    必须原样让给页面。分岔点取"位移超过 10px 且横向明显压过纵向"——与旧版那条
 *    44px 的判据相比，这一条只决定"往哪个方向走"，不决定"够不够翻一页"
 *    （后者现在由落定的取整说了算，见第 4 条）。
 * 2. **锁定那一刻重新取基准**（`startX` / `startQ` 都往后挪）。不挪的话，
 *    前 10px 的位移会在锁定的一瞬间被算进去，画面**跳**一下。
 * 3. **绕不过上界**（`maxTarget`）。共读版没选之前封底那一片叶不给 ——
 *    那一条是产品定义（"不选也能往下翻"会让共读版退化成独读版加一页），
 *    手势不能变成绕过它的第二条路。
 * 4. **落定取整，不是取阈值**：`Math.round` 最近的一叶。这是跟手拖动的自然收尾
 *    ——拖过一半就是下一页，与 `highlights-reel` 那条"过半就认"同一条判断。
 * 5. **两端有阻尼**（`EDGE_DAMPING`）。这一屏是**有端头**的，与本仓库那条
 *    "环上没有端头、所以不需要橡皮筋"（`highlights-reel`）**正好相反**：
 *    直线翻页的两头是墙，手划过去要先感到墙、再弹回来。
 * 6. **`prefers-reduced-motion` 下拖动照旧**。那是**用户自己的手势**，不是播给谁看的
 *    动效（`shelf.css` 对"拖动那件事不需要另写静止终态"写过同一条理由）。
 *    变的只有松手那一下：`reduced` 时各台那条补间会直接把 q 落到目标上，
 *    所以这里不用管——**收尾归各台，不归这里**。
 * 7. **不碰 `event.preventDefault()`**。React 把 `touchmove` 挂在 root 上、而且是
 *    passive 的，`preventDefault()` 在那里**不生效**。真正决定"这一下算不算滚动手势"
 *    的是 CSS 的 `touch-action`（竖屏 `pan-y`、横屏 `none`，见两台阅读器的样式表）。
 *    ★ 这一条写在这里是因为它是这一整个文件里最容易"顺手加一句然后发现没用"的地方。
 *
 * ---------------------------------------------------------------------------
 * 与调用方的那条契约：**拖动期间必须把补间停掉**
 *
 * `write()` 直接写 q，而各台那条补间（`useEffect` 里的 rAF 链）也在写同一个 q ——
 * 两条链同时写就是"画面抖"。所以这个 hook 交出 `dragging`，调用方那条补间
 * **把它接进依赖并早退**：拖动一开始补间就被清理掉，松手后 `dragging` 变回 false、
 * 补间带着新的 `qTarget` 重新起一条。把这件事留给调用方而不是在这里硬停，
 * 是因为那条补间本来就住在那儿（它还要管键盘、按钮、自动朗读三条路）。
 */

import { useCallback, useRef, useState, type RefObject } from 'react'

/** 位移超过这么多 px 才算"这一下是往某个方向走的" */
const LOCK_PX = 10
/** 横向位移要比纵向大这么多倍，才认成横滑（否则让给页面滚动） */
const LOCK_RATIO = 1.2
/** 划过端头之后的位移按这个比例记（橡皮筋）。0.35 是"挡得住、掰得动" */
const EDGE_DAMPING = 0.35

type Touches = { clientX: number; clientY: number }

/** 一次手势的账。`null` = 这一下已经让给页面滚动了 */
type Gesture = {
  /** 锁定那一刻的手指位置（见文件头第 2 条：不是按下那一刻） */
  x: number
  /** 锁定那一刻的 q */
  q: number
}

export type SwipeTurnArgs = {
  /** 舞台那一层：量宽度用，`dx → 叶数` 的换算基准就是它 */
  stageRef: RefObject<HTMLElement | null>
  /** 当前那一叶（**由 ref 读**，不读渲染期的闭包值：拖动期间它每帧都在变） */
  qRef: RefObject<number>
  /** 拖动期间直接写 q（绕过补间） */
  write: (value: number) => void
  /** 松手落定到某一叶（调用方走它自己那条补间 / `qTarget`） */
  settle: (target: number) => void
  /** 上界（见文件头第 3 条） */
  maxTarget: number
  /** 拖动一开始就调：人已经在翻页了，朗读该停下（与点按钮那条同一个规矩） */
  onTakeOver: () => void
}

export type SwipeTurn = {
  /** 拖动中。★ 调用方那条补间要**把它接进依赖并早退**（见文件头末尾那条契约） */
  dragging: boolean
  onTouchStart: (event: React.TouchEvent) => void
  onTouchMove: (event: React.TouchEvent) => void
  onTouchEnd: (event: React.TouchEvent) => void
  onTouchCancel: () => void
}

export function useSwipeTurn({
  stageRef,
  qRef,
  write,
  settle,
  maxTarget,
  onTakeOver,
}: SwipeTurnArgs): SwipeTurn {
  const [dragging, setDragging] = useState(false)
  /** 按下那一刻的手指位置。只在"还没锁定"时有意义 */
  const originRef = useRef<Touches | null>(null)
  /** 锁定之后的账；`null` = 这一下不归我们（竖向滚动或已经结束） */
  const gestureRef = useRef<Gesture | null>(null)
  /** 这一下已经判过方向了（不管判成哪一边） */
  const decidedRef = useRef(false)

  const reset = useCallback(() => {
    originRef.current = null
    gestureRef.current = null
    decidedRef.current = false
    setDragging(false)
  }, [])

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0]
    if (!touch) return
    originRef.current = { clientX: touch.clientX, clientY: touch.clientY }
    gestureRef.current = null
    decidedRef.current = false
  }, [])

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      const origin = originRef.current
      const touch = event.touches[0]
      if (!origin || !touch) return

      /* ── 还没判方向：先看这一下是往哪边走的（文件头第 1 条） ───────────── */
      if (!decidedRef.current) {
        const dx0 = touch.clientX - origin.clientX
        const dy0 = touch.clientY - origin.clientY
        if (Math.abs(dx0) < LOCK_PX && Math.abs(dy0) < LOCK_PX) return
        decidedRef.current = true
        if (Math.abs(dx0) <= Math.abs(dy0) * LOCK_RATIO) {
          // 让给页面滚动：这一下**从头到尾**都不再管
          originRef.current = null
          return
        }
        /* ★ 锁定这一刻重新取基准（文件头第 2 条）：不挪的话，
           前 10px 会在一瞬间被算进去，画面跳一下。 */
        gestureRef.current = { x: touch.clientX, q: qRef.current }
        setDragging(true)
        onTakeOver()
      }

      const gesture = gestureRef.current
      if (!gesture) return
      const width = stageRef.current?.clientWidth ?? 0
      if (width <= 0) return

      // 手指往左 = 往后翻（内容跟着手走），与 `highlights-reel` 那条一致
      const delta = -(touch.clientX - gesture.x) / width
      let next = gesture.q + delta

      // 端头阻尼（文件头第 5 条）
      if (next < 0) next *= EDGE_DAMPING
      else if (next > maxTarget) next = maxTarget + (next - maxTarget) * EDGE_DAMPING

      write(next)
    },
    [maxTarget, onTakeOver, qRef, stageRef, write],
  )

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const gesture = gestureRef.current
      const moving = decidedRef.current
      reset()
      /* ★ 这一下**没锁定**过（竖向滚动，或松手太快没走到 `LOCK_PX`）就什么都不做：
         后者是"点了一下书"，那本来就不是翻页动作。 */
      if (!gesture || !moving) return
      const touch = event.changedTouches[0]
      const raw = touch
        ? gesture.q + -(touch.clientX - gesture.x) / (stageRef.current?.clientWidth || 1)
        : qRef.current
      /* ★ 落定取整（文件头第 4 条）。先夹进 [0, maxTarget] 再取整：
         阻尼之后的值可能落在端头外面一点，先取整会把它变成越界的那一叶。
         ★ 落在原地也照样喊一声：拖动期间是**直接写**的 q，不交回给补间的话
           它会停在一个小数上，永远回不到整数位（画面半翻着不动的样子）。 */
      const clamped = Math.max(0, Math.min(maxTarget, raw))
      settle(Math.round(clamped))
    },
    [maxTarget, qRef, reset, settle, stageRef],
  )

  const onTouchCancel = useCallback(() => {
    const gesture = gestureRef.current
    reset()
    if (gesture) settle(Math.round(Math.max(0, Math.min(maxTarget, qRef.current))))
  }, [maxTarget, qRef, reset, settle])

  return { dragging, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}
