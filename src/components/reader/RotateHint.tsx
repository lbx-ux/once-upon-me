'use client'

/**
 * RotateHint —— 竖屏手机进阅读器时那层「把手机横过来」（2026-10-19 移动端适配）
 *
 * ---------------------------------------------------------------------------
 * 为什么要有它：竖屏那一版**真的读不动**
 *
 * 一跨页是 3:2 的一张图，竖屏时舞台只能按宽度撑（`92vw` / `94vw`），390px 的手机上
 * 半页只有 179px，正文按 12px 排下来约 **11 字一行**。横过来之后舞台改按**视口高**
 * 定尺寸，同一台手机从 359×239 变成 561×374 —— 是另一个量级。
 * （那两个数在 `reader-book.css` 的 §手机横屏 里，量法见 docs/known-tradeoffs.md。）
 *
 * ---------------------------------------------------------------------------
 * 五条判断，每条都有一个"为什么不那样写"
 *
 * 1. **它是提示，不是闸门。** 遮罩底下那本书照常渲染、照常能读（关掉这一层就是）。
 *    做成"不转屏就一行字都读不到"是另一条路，被否掉了：有人就是不想转手机，
 *    而那样的人**什么都得不到**。所以这里没有任何"未转屏就不挂载"的分支。
 *
 * 2. **显隐归 CSS，不归 JS**：`(orientation: portrait) and (max-width: 640px)`。
 *    转屏这件事浏览器自己知道（`orientation` 媒体特性），拿 `resize` / `matchMedia`
 *    在 JS 里再算一遍就是两个真相，而它们一定会在"地址栏收起的瞬间"漂。
 *    ★ 于是这一层在**桌面**上是 `display: none` 的，连首帧都不会闪。
 *
 * 3. **挂载之前什么都不画**。偏好那一支（`useRotateHint`）与另外几份一样：初值一律
 *    默认、挂载后读盘——服务端读不到 `localStorage`，首屏 HTML 只能是默认。
 *    但这一层比那些都更吃不起"读盘前那一帧"：它是**整屏的一层遮罩**，
 *    而"选过不再提示"的人下次翻开书还要被它闪一下，等于那个选择没记住。
 *    所以它多一条 `mounted` 门：SSR 与客户端第一次渲染都是 `null`（两趟一致，
 *    不违反 hydration），挂载后读到的偏好直接决定它出不出来。
 *    代价只有一个：`'ask'` 的人看到它比首帧晚一拍——一层浮层晚一拍，看不出来。
 *
 * 4. **`role="dialog"` 但**不写** `aria-modal`。** 它确实是一层浮在内容上的对话卡片，
 *    所以 `dialog` 是对的；可它**没有焦点陷阱**（Esc 与那颗按钮都能关掉它，关掉之后
 *    焦点回到书那边去），而声称 `aria-modal="true"` 又不把背后设成 `inert` 是撒谎。
 *    宁可少声明一个属性，也不留一句不该被相信的话。
 *
 * 5. **Esc 也能关**：手机上外接键盘不常见，但它是这一层唯一的"不用瞄屏幕"的出口，
 *    而这一屏本来就是睡前用的（`reader-book.css` 为同一件事给翻页钮补过焦点圈）。
 *
 * ---------------------------------------------------------------------------
 * 关掉之后去哪了
 *
 * 写进 `xiaozhujue.reader.rotate`（`lib/rotate-hint.ts`，与另外三份阅读偏好同一个
 * 名字空间）。**它是"这台设备的这个人"，不是"这一本书"**——不想转手机这件事与
 * 翻开的是哪一本无关，按书存的话每一本都要关一次。
 * 要改回"继续问"，去工作台左下角的「设置 · 阅读偏好」——那一行与另外两行排在一起。
 */

import { useEffect, useState } from 'react'

import { useRotateHint } from '@/lib/use-reading-prefs.ts'

export default function RotateHint() {
  const { rotateHint, setRotateHint } = useRotateHint()
  /**
   * ★ 挂载之前**什么都不画**（见文件头第 3 条）。这一条是它比另外几份偏好更讲究的地方：
   *
   *   偏好那个 hook 的初值一律是默认（服务端读不到 `localStorage`），所以"选过不再提示"
   *   的人在挂载后会被改回 `'off'` —— 而**改之前那一次渲染已经在屏幕上了**。
   *   在这一层身上，那一次渲染是**整屏的一层遮罩**：一个人刚说过"别问我了"，
   *   下次翻开书它还要闪一下。所以这里把"渲染"推迟到挂载之后：
   *   SSR 与客户端第一次渲染都是 `null`（一致，不违反 hydration），挂载后读到的偏好
   *   直接决定它出不出来 —— 对 `'off'` 的人**一帧都不闪**，
   *   对 `'ask'` 的人只是晚一帧出现（一层浮层晚一帧，看不出来）。
   */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  /* Esc 关掉（见文件头第 5 条）。★ 监听只在这一层真的渲染时才挂：
     关掉之后连监听都没有，不留一个"监听还在但元素没了"的中间态。 */
  useEffect(() => {
    if (!mounted || rotateHint === 'off') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setRotateHint('off')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mounted, rotateHint, setRotateHint])

  /* 这一层浮出来的那一刻，焦点**不抢**：抢焦点会把读屏从那本书上拽走，
     而这层东西只是一句建议。用户 Tab 过来时它自然接得住——
     那颗按钮是原生 `<button>`，键盘行为全是浏览器自己的。 */

  if (!mounted || rotateHint === 'off') return null

  return (
    <div className="rotate-hint" data-testid="rotate-hint">
      <div
        className="rotate-hint__card"
        role="dialog"
        aria-labelledby="rotate-hint-title"
        aria-describedby="rotate-hint-sub"
      >
        {/* 图标是内联 SVG，不引图标库（照 `AppShell` 那条约定：这个仓库只有一个前端依赖）。
            画的是「一部竖着的手机，外面一圈绕着它的旋转箭头」——
            ★ 圆的半径 22 比手机的半对角线（21.5）大一点点，所以那道弧**整个绕在外面**，
              不压到手机上；箭头单独画成一个实心小三角，落在弧的收尾处。
              下半圈刻意不画：断口就是"还在转"的意思，画满一圈会读成一个圈而不是一个动作。
            下半句由文字说清 —— 图标不承担全部意思，所以它 `aria-hidden`。 */}
        <svg
          className="rotate-hint__icon"
          viewBox="0 0 64 64"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="24" y="10" width="16" height="30" rx="3.5" />
          <path d="M15.1 44.1A22 22 0 1 1 48.9 44.1" />
          <path d="M49 45.5l2.6-8.9-8.9 2.6z" fill="currentColor" stroke="none" />
        </svg>

        <p className="rotate-hint__title" id="rotate-hint-title">
          把手机横过来
        </p>
        <p className="rotate-hint__sub" id="rotate-hint-sub">
          画面会大很多，书能整页铺满。
        </p>

        <button type="button" className="rotate-hint__ok" onClick={() => setRotateHint('off')}>
          仍然竖着看
        </button>

        {/* 说清"关掉之后会怎样"：不是这一次，是这台设备以后都不问了。
            ★ 这一句不是客套 —— 不说的话，"仍然竖着看"读起来像"这一次先算了"。
            ★ 而且要说清**在哪儿改回来**：这一屏上没有设置入口（阅读器不在 `.shell` 里
              拿不到侧栏），只说「设置 · 阅读偏好」等于指了一扇不在这儿的门。
              措辞与这一屏上另外两句同族（`ReaderBook` / `BooklistReader` 的自动朗读那条
              都写"到工作台左下角的「设置」里"）—— 三处指的是同一处，就得说成同一处。 */}
        <p className="rotate-hint__note">
          选过之后就不再提示了。想改回来，到工作台左下角的「设置 · 阅读偏好」里选「提示我横过来」。
        </p>
      </div>
    </div>
  )
}
