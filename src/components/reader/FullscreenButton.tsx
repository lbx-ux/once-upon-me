'use client'

/**
 * FullscreenButton —— 手机横屏时那一条地址栏的补法（2026-10-20）
 *
 * ---------------------------------------------------------------------------
 * 它解决的是哪一件事
 *
 * 用户拿手机横过来读绘本，截图里圈着 `123.56.148.105` 那一条问"这个能不能去掉"。
 * **那是浏览器自己的地址栏，网页碰不到它** —— CSS 也碰不到浏览器界面。能碰到它的
 * 只有两条路，这一颗走的是第一条：
 *
 *   ① **全屏 API**（就是这里）。一次**用户手势**之内 `requestFullscreen()`，
 *      Chrome 会把地址栏（以及 Android 上的系统栏）一起收走。
 *   ② **加到主屏幕**（manifest `display: fullscreen`）。最彻底，但要**安全来源** ——
 *      现在站点跑在 `http://123.56.148.105`（没有域名也没有证书），Chrome 不给装。
 *      这一条与 README 里"域名与 HTTPS 是下一步"是同一件事，不是这一屏能修的。
 *
 * ★ 这是**平台差异**，不是"没做全"：`document.fullscreenEnabled` 在 iOS Safari 上
 *   是 `undefined`（那一支里元素全屏只对 `<video>` 生效）—— 于是**那颗钮在 iOS 上
 *   根本不出现**。宁可它不在，也不留一颗按下去没反应的按钮。
 * ★ 也不顺手 `screen.orientation.lock('landscape')`：锁了之后「仍然竖着看」
 *   那条路就在全屏里没了，而那是用户在提示卡上明确点过的选项。这里只收地址栏。
 *
 * ---------------------------------------------------------------------------
 * 三条实现上的讲究
 *
 * 1. **能力探测放在 `useEffect` 里**（初值 `false`）。服务端读不到 `document`，
 *    而"这台机器支不支持全屏"只有浏览器知道。首帧不渲染 = SSR 与客户端第一趟一致
 *    （不违反 hydration），挂载后才知道要不要出现 —— 与 `RotateHint` 那条
 *    "挂载之前什么都不画"同一个手法，理由比它轻（这颗钮不会整屏闪）。
 *
 * 2. **状态取 `document.fullscreenElement`，不自己存一个布尔**：用户按 Esc、
 *    系统手势退出、或者浏览器自己退出全屏，都不会经过我们的 `onClick` ——
 *    自己存一个的话，那个布尔会与真相漂开（漂开之后按钮的图标就反了）。
 *    监听 `fullscreenchange` 是唯一一个"真的变了才变"的来源。
 *
 * 3. **`requestFullscreen()` 的 promise 要吞掉拒绝**：它会在没有用户手势、
 *    或者被 Permissions-Policy 挡住时 reject。吞掉不是掩盖 —— 唯一的后果是
 *    "没进全屏"，而那正是用户看得见的现状；不吞的话控制台上会多一条
 *    未处理的 rejection，看起来像这一屏坏了。
 *
 * ---------------------------------------------------------------------------
 * 形状：一颗 44px 的圆钮，与它旁边的 `‹` `›` 同族
 *
 * 一开始想过做成带字的药丸（照「朗读」那颗）。否掉的理由是**竖屏 + 全屏**那一态：
 * 横屏进的全屏，转回竖屏时得退得出来，于是这颗钮必须也能出现在竖屏的底栏里 ——
 * 而那一行本来就紧（`‹` `页码` `朗读` `›` 已经排满），再塞一颗 100px 宽的药丸
 * 会把页码挤没。圆钮在两种方向下都放得下，而且与左右两颗翻页钮是同一个形状、
 * 同一条 44px 的命中线。意思由 `aria-label` 说全（"全屏阅读" / "退出全屏"）。
 */

import { useEffect, useState } from 'react'

export default function FullscreenButton() {
  /** 这台浏览器支不支持（iOS Safari 上是 `undefined`，见文件头） */
  const [supported, setSupported] = useState(false)
  /** 现在在不在全屏里 —— 唯一来源是 `document.fullscreenElement`（见文件头第 2 条） */
  const [on, setOn] = useState(false)

  useEffect(() => {
    setSupported(document.fullscreenEnabled === true)
    const sync = (): void => setOn(document.fullscreenElement !== null)
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  if (!supported) return null

  const toggle = (): void => {
    if (document.fullscreenElement) {
      const asked: Promise<void> | undefined = document.exitFullscreen()
      asked?.catch(() => {})
      return
    }
    const asked: Promise<void> | undefined = document.documentElement.requestFullscreen()
    asked?.catch(() => {})
  }

  return (
    <button
      type="button"
      className="fullscreen-button"
      /* ★ 这个属性同时管两件事：横屏那一档的面板摆位，与**转回竖屏之后的出口**
         （`fullscreen-button.css` 里那两条规则）。 */
      data-on={on ? 'true' : 'false'}
      aria-pressed={on}
      aria-label={on ? '退出全屏' : '全屏阅读'}
      onClick={toggle}
    >
      {/* 图标是内联 SVG，不引图标库（照 `AppShell` 那条约定：这个仓库只有一个前端依赖）。
          四个角**朝外** = 进全屏，**朝内** = 退全屏 —— 同一套笔画换个朝向，
          两态看起来才是同一个控件的两个状态，而不是两颗不同的钮。 */}
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {on ? (
          <path d="M3 7h3a1 1 0 0 0 1-1V3M17 7h-3a1 1 0 0 1-1-1V3M17 13h-3a1 1 0 0 0-1 1v3M3 13h3a1 1 0 0 1 1 1v3" />
        ) : (
          <path d="M7 3H4a1 1 0 0 0-1 1v3M13 3h3a1 1 0 0 1 1 1v3M17 13v3a1 1 0 0 1-1 1h-3M3 13v3a1 1 0 0 0 1 1h3" />
        )}
      </svg>
    </button>
  )
}
