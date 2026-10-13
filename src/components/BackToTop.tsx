'use client'

/**
 * BackToTop —— 右下角一颗"回到页首"
 *
 * 首页三屏加起来约 6 屏滚动量（首屏 + 绘本 340vh + 亮点），滚到底想回头看第一屏
 * 只能一路往上滚 —— 所以给一个直接回去的落点。
 *
 * ## 为什么是一颗纸片，不是一个深色圆钮
 *
 * 深色实心圆在浅灰底上是这一屏最重的一个元素，会把视线从内容上抢走。
 * 这里用的是与卡片同一张纸（`#fffdf7` + 1px 极淡描边 + 紧投影），
 * 它该读起来像"桌上多放了一枚书签"，不是"网页控件浮在顶上"。
 *
 * ## 只在离开首屏之后出现
 *
 * 在页首时"回到页首"是个无意义的按钮，而且它会压在首屏那两句主张上面。
 * 所以滚过 0.6 视口高才升起来。
 *
 * ★ 藏起来用的是 `visibility: hidden`，不是只写 opacity ——
 *   与 `.book-choice` 同一条理由：opacity 不会把东西从辅助技术与点击里去掉，
 *   只淡出的话 Tab 会停在一颗看不见的按钮上。
 */

import { useEffect, useState } from 'react'

/** 滚过多少才开始出现。0.6 视口高 ≈ 首屏文案基本走完那一刻。 */
const SHOW_AFTER = 0.6

export default function BackToTop() {
  const [on, setOn] = useState(false)

  useEffect(() => {
    const sync = () => setOn(window.scrollY > window.innerHeight * SHOW_AFTER)
    sync() // 刷新在页面中间时首帧就该是对的
    window.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  const toTop = () => {
    // 减少动效下不"平滑滚回去"：那是一段没人要求它动的长位移。
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }

  return (
    <button
      type="button"
      className="to-top"
      data-on={on || undefined}
      aria-label="回到页面顶部"
      /* 藏起来时 CSS 已经写了 visibility: hidden（对辅助技术与点击都有效）。
         这里再给一个 tabIndex=-1，是因为 visibility 那条过渡有 0.28s 的延迟，
         淡出途中它技术上还在 tab 序里 —— 别让人 Tab 到一颗正在消失的按钮。 */
      tabIndex={on ? undefined : -1}
      onClick={toTop}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          d="M10 15.5V4.5M10 4.5 5 9.5M10 4.5 15 9.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
