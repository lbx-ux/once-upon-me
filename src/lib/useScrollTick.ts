'use client'

import { useEffect, useRef } from 'react'

/**
 * useScrollTick —— 页面级的滚动刻度（不属于任何一节）
 *
 * 它算的是视口中心落在整页的哪个位置：那一层不属于任何一节，
 * 也不该被任何一节的区间牵着走（场景背景要的就是这件事）。
 *
 * 为什么没有并进 `useScrollDriver`（`E:/ui/README.md` 移植清单第 1 条原本要求并进去）：
 *   那一台的生命周期是「这一节在视口里」。而第三屏（`.hl`）**一个 `useScrollDriver`
 *   实例都没有**（它的滚动效果走 GSAP，见 HighlightsReel.tsx 文件头与 docs/known-tradeoffs.md）。
 *   把这一层挂到驱动上广播，滚到第三屏时场景就会冻在最后一帧：
 *   那不是少一个动效，是"入夜"这一幕永远不出现。所以这一层必须自己活到全页。
 *
 * 它也不是「第二条常驻 rAF」：只有 scroll / resize 事件才会排一次帧，
 *   静止时一个 rAF 都不排（见 `schedule()` 里那句 `if (!raf)`）。
 *   这与 `useScrollDriver` 的「可见就常驻」是两种东西，也正是能接受的理由
 *   （那台驱动 2026-10-19 随首页前两节一起下架了；这条判断留着，因为将来若
 *     某一节又需要"进/出视口的区间"，它仍然是对的）。
 *
 * 两条纪律都是从 `useScrollDriver` 那儿搬过来的（各自对应一次实测踩坑，别改）：
 *   · `setTickVar` 同名同值不重复写 —— 满屏 fixed 层改一个变量会触发整页重绘判定
 *   · `prefers-reduced-motion` 下照跑 —— 要停的是动效，不是滚动本身；
 *     停在任何位置看到的都必须是正确的终态
 */
export function useScrollTick(effect: (vh: number, reduced: boolean) => void): void {
  // 回调走 ref：调用方传内联箭头也不会重建监听（与 useScrollDriver 同一手法）
  const latest = useRef(effect)
  latest.current = effect

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0

    const run = () => {
      raf = 0
      latest.current(window.innerHeight, reduced.matches)
    }
    /** 一帧最多算一次：连发多个 scroll 事件不叠加 */
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(run)
    }

    // 挂载时立刻算一次 —— 页面可能从中间位置加载（刷新恢复 / 带 hash 进入）
    run()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])
}

/** 元素 → 变量名 → 已写入的数。WeakMap：组件卸载后不留痕 */
const written = new WeakMap<HTMLElement, Map<string, number>>()

/**
 * 写一个 0–1 的权重，按 0.001 取整后去重：值没变就不碰 style。
 *
 * 0.001 这个粒度来自 `useScrollDriver` 的同一条口径：整页约 6 屏滚动量，
 * 0.001 ≈ 6px 一档，肉眼看不出台阶。而去重是必须的 —— 三层满屏 fixed 的
 * opacity 每帧都写，等于每帧给浏览器一次「整页重绘」的判定机会。
 */
export function setTickVar(el: HTMLElement | null, name: string, value: number): void {
  if (!el) return
  const q = Math.round(value * 1000) / 1000
  let map = written.get(el)
  if (!map) {
    map = new Map()
    written.set(el, map)
  }
  if (map.get(name) === q) return
  map.set(name, q)
  el.style.setProperty(name, String(q))
}

export default useScrollTick
