'use client'

/**
 * StartCreating —— 首页那颗「开始创作」，以及点下去到工作台上屏之间的那一段
 *
 * 这一颗是**首页唯一的出路**（另一颗「看一本成品」通向阅读器），所以它也是这条
 * 跨页接力唯一的发生点：点下去 → 退场 → 量下那 12 张此刻的位置 → 切页。
 * 落点那一边（`/home` 的主题墙从那些位置飞回自己的格子）在
 * `lib/theme-handoff.ts` 与 `lib/useEnterTimeline.ts` 的 `arrival` 里。
 *
 * ## 五条判断，每条都有一个"为什么不那样写"
 *
 * 1. **它仍然是一颗真链接。** 渲染出来的是 `<Link className="btn" href="/home">`——
 *    禁 JS、中键、⌘/Ctrl/Shift 点击走的都是浏览器自己那条路。所以 `onClick` 的第一件事
 *    是**判断这一下该不该拦**，而不是无条件 `preventDefault`。
 * 2. **退场走完才量、才 push**（`EXIT_MS` 之后），不是"点了立刻 push"。
 *    立刻 push 的话，生产环境里 `<Link>` 悬停已经预取过、RSC 三十几毫秒就回来，
 *    这两百毫秒的退场会被**腰斩**——过渡质量取决于缓存冷热，那不是一个能讲清的观感；
 *    而且那时刻量到的是"点击那一刻"的位置，环已经又转过十几像素。
 * 3. **CTA 那一行不跟着淡出。** 退场之后到工作台上屏之间还要等一次 RSC
 *    （dev 下实测 0.5–2.6s，见 `shell/AppShell.tsx` 文件头那组读数）。那时屏上若只剩
 *    一个转着的环、一个字都没有，读起来像坏了。所以这颗按钮留下来，
 *    `BUSY_AFTER_MS` 之后自己把话说成「正在打开…」——门槛数字与 `AppShell` 的
 *    `PENDING_SHOW_AFTER_MS` 是同一个道理：**报信要比人开始怀疑慢半拍**，
 *    快的导航因此一格都不闪。
 * 4. **防双发用 ref，不是 state。** 这是本仓库实测过的坑（`CreateLanding.tsx` 的
 *    `thinkingRef` 那段）：React 的重渲染是异步排的，同一帧里的第二下点击拿到的还是旧
 *    state，两个请求一起飞出去。`disabled` 也拦不住（它同样要等重渲染）。
 *    ★ 而且这里还有第二个后果：正在走的时候必须**依然 `preventDefault`**——
 *    否则第二下会真的让浏览器跳一次 `/home`，那是一次整页刷新。
 * 5. **静止模式下不拦。** `prefers-reduced-motion` 要的是"没有不该动的东西在动"：
 *    不演退场、不量位置、直接交给 `<Link>` 瞬间切页（也就没有接力，`/home`
 *    走它原本那条进场）。
 *
 * ★ 时长那个数（`EXIT_MS`）与 `hero-orbit.css` §8 的 `transition` 是**同一个数**，
 *   改一处要改另一处——与本仓库那几处"两处手写的数"同一类耦合，注释里都指了回来。
 *
 * ★ 它指 `/home` 而不是 `/create`（这条判断原来写在 `app/page.tsx` 里，跟着这一颗一起搬过来）：
 *   `/home` 是工作台的「创作」那一屏——一句话就能进去，比直接落在四步表单的第一格里轻。
 *   创作流本身仍在 `/create`，直接访问也照样能用；"我做过什么"那一屏叫 `/shelf`。
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { captureRing, forgetThemes, rememberThemes } from '@/lib/theme-handoff.ts'

/** 退场时长（ms）。★ 与 `hero-orbit.css` §8 那条 `transition: opacity .2s` 是同一个数。
 *  ★ **不 export**：一个组件模块同时导出值，Fast Refresh 只能退化成整页刷新
 *    （dev 控制台会念那条警告）。这个数只有这一处用，`theme-handoff` 那边也不该知道它。 */
const EXIT_MS = 200

/** 慢到这个数才换文案。与 `shell/AppShell.tsx` 的 `PENDING_SHOW_AFTER_MS` 同一条规矩 */
const BUSY_AFTER_MS = 120

/** 落点。一颗链接的 href 只该有一处 */
const HOME_HREF = '/home'

export default function StartCreating() {
  const router = useRouter()
  const leavingRef = useRef(false)
  const [busy, setBusy] = useState(false)

  /* 首页一挂上就把上一轮的坐标清掉：从 /home 退回首页（浏览器后退）时那份载荷
     不该还留着——它的寿命只有"一次点击到下一次渲染之间"（见 `peekThemes`） */
  useEffect(() => {
    forgetThemes()
  }, [])

  const onClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    /* 只拦"这一页的左键单击"。中键 / ⌘ / Ctrl / Shift 是"开新标签页"，
       那一下要交给浏览器——一个被劫持的链接不是链接（判断 1） */
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    const hero = document.querySelector<HTMLElement>('[data-hero-experience]')
    /* 静止模式、或这一屏根本不在（理论上不会）：交给浏览器自己跳（判断 5）。
       ★ 判据现读一次 `matchMedia` 就够——这里要的是"点下去那一刻的事实"，不是订阅 */
    if (!hero || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // ↓ 从这里往下这一下就归我们了：无论如何都不许放给浏览器（判断 4 的后半句）
    event.preventDefault()
    if (leavingRef.current) return

    leavingRef.current = true
    hero.dataset.leaving = 'true'
    window.setTimeout(() => setBusy(true), BUSY_AFTER_MS)

    window.setTimeout(() => {
      /* 量的是**退场之后那一帧**的位置（判断 2）：`captureRing` 读的是当下的几何，
         所以这一刻量到的就是用户最后看到的那一屏。
         ★ 量不齐时它返回空数组，`rememberThemes` 照样记——只是 `peekThemes` 那一边
           会走 `themeArrival([]) → null`，也就是默认进场（不接力），不会飞错位置 */
      rememberThemes(captureRing(hero))
      router.push(HOME_HREF)
    }, EXIT_MS)
  }

  return (
    <Link
      className="btn"
      href={HOME_HREF}
      onClick={onClick}
      data-busy={busy ? 'true' : undefined}
      aria-busy={busy || undefined}
    >
      {busy ? (
        <>
          <span className="btn__spin" aria-hidden="true" />
          正在打开…
        </>
      ) : (
        '开始创作 →'
      )}
    </Link>
  )
}
