/**
 * theme-handoff.ts —— 首页那 12 张画与工作台主题墙之间的**接力**（跨页）
 *
 * 首页 `app/page.tsx` 把 `THEMES` 摆成一个 3D 环，工作台「创作」那一屏
 * `components/studio/CreateLanding.tsx` 把**同一个 `THEMES`**摆成一面墙：
 * 同一批图、同一个顺序，中间只隔了一次客户端路由。这一层要做的就是
 * **别让那一次路由把这个连续性切断**——点「开始创作」时把 12 张此刻在视口里的位置记下来，
 * 到了墙上让那 12 格**从那些位置飞回自己的格子**。
 *
 * ★ 这里的 handoff 与 `HeroOrbit.tsx` 的 `HANDOFF_START` **不是一件事**，只是同一个词：
 *   那条讲的是"首屏把版面让给第二屏"（同一页内、按滚动量），这条讲的是
 *   "首页把这 12 张交给另一个页面"（跨路由、按一次点击）。两条互不影响，
 *   也**别把这里的数往那边抄**（那三个数是一组咬合的契约，见 README §五）。
 *
 * ## 三块，按"能不能在 node 里测"分开
 *
 *   1. `flightVars()` —— 纯函数，整条接力里唯一一处几何。`theme-handoff.test.ts` 摁着它。
 *   2. 载荷（`rememberThemes` / `peekThemes` / `forgetThemes`）—— 模块级的一次性数据。
 *      ★ 它**不进 localStorage / sessionStorage**：这是"一次点击 → 下一次渲染"之间的事。
 *        存下来不但没用，还会把上一屏的坐标用在这一屏上（刷新之后窗口都可能换了大小）。
 *   3. `captureRing()` / `themeArrival()` —— 要读 DOM 的那两半，只有真页面能验
 *      （README §五 那条"动效在这个环境里验不了"，与 `studio-sky` 工单 06 同一口径）。
 *
 * ## 下标是两边**共同**的约定
 *
 * 环按 `data-orbit-index` 写（`HeroOrbit.tsx` 渲染 `items` 的顺序），墙就是
 * `THEMES.map(...)` 的结果。两个数组都是 `THEMES` 的顺序，所以第 i 张对第 i 格。
 * **谁把其中一边重排了，这里就会错位**——两处各留了一条注释指回来。
 *
 * ## 四个退化路径（一个都不许停在半成品上）
 *
 * | 情形 | 会怎样 |
 * | --- | --- |
 * | 直接访问 / 刷新 `/home` | 没有载荷 → 走 `ENTER_STEPS` 原来那一步，一字不差 |
 * | `prefers-reduced-motion` | 调用方不记也不飞（见 `StartCreating.tsx`），瞬间切页 |
 * | 禁 JS / 中键 / ⌘ 点击 | 那仍然是一颗真 `<Link>`，浏览器自己走 |
 * | 载荷过期、或 12 张没量齐 | `peekThemes()` 返回 null → 退回默认进场 |
 */

import { clamp } from './math'
/* ★ 时间线那两个数（起点 / 时长）与两个类型从 useEnterTimeline 来：
   它们是"进场"的语言，不是接力的，所以那边是家。这个文件只借来用，不转发第二份。
   （只 import 类型是编译期的事，不会把 gsap 的运行时拖进这个模块的 node 测试。） */
import { ARRIVAL_AT, ARRIVAL_DURATION, type EnterArrival, type EnterVars } from './useEnterTimeline'

/** 环上一张卡在**这一刻**的样子。坐标一律是视口坐标（px） */
export type ThemeShot = {
  /** 卡片视觉中心 */
  cx: number
  cy: number
  /** 卡片的**视觉宽度**：把包围盒除回旋转之后的值。
   *  ★ 旋转不折算进来 —— 5.2° 的旋转让包围盒宽出约 4.7%，而这里要的是
   *    "这张图实际有多宽"，不是"它占了多大的方框"（见 `captureRing`） */
  w: number
  /** 这一刻它在环上的不透明度：后排那半圈是 0.28–1（`lib/orbit.ts` 按深度算的） */
  opacity: number
  /** 这一刻它在环上的旋转（deg），最外圈 ±5.2° */
  rot: number
}

export type Rect = { left: number; top: number; width: number; height: number }

/** 交给 GSAP 的起点。键名就是 GSAP 的（见 `useEnterTimeline.ts` 的 `EnterArrival`） */
export type FlightVars = {
  x: number
  y: number
  scale: number
  rotate: number
  opacity: number
}

/**
 * 缩放夹取。
 *
 * ★ 不是为了"好看"：墙上那一格量不到尺寸时（元素 `display: none`、或那一刻还没布局）
 *   比例会变成 `0/0` 或 `x/0`，而 GSAP 拿到 NaN / Infinity 会让**整条时间线静默失效**
 *   ——症状是"什么都没动"，这类 bug 最难查（同 `math.ts` 为什么给 `smoothstep`
 *   加一条退化区间的理由）。夹取之后最坏也只是"这张卡近了一点"。
 */
export const SCALE_MIN = 0.1
export const SCALE_MAX = 3

/** 载荷的寿命。见下面 `peekThemes` 那段：它挡的是"点了但导航没发生" */
export const HANDOFF_TTL_MS = 3000

/** 卡片的长宽比：`.hero-orbit__item` 与 `.cl__theme-art` 都是 16:9（两处都是 `aspect-ratio`） */
export const CARD_ASPECT = 16 / 9

/**
 * 16:9 的盒子转 `rotDeg` 之后，**包围盒**比它自己宽多少倍。
 *
 * 旋转会把包围盒撑大：宽 `w` 高 `h` 的矩形转 θ 之后，包围盒宽是
 * `w·|cosθ| + h·|sinθ|`，而 `h = w / (16/9)` —— 所以倍数是
 * `|cosθ| + (9/16)·|sinθ|`（θ = 0 时恰好是 1，90° 时是 9/16）。
 * `captureRing` 拿它把包围盒还原成"这张图自己有多宽"。
 */
export function rotInflation(rotDeg: number): number {
  const rad = (rotDeg * Math.PI) / 180
  return Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad)) / CARD_ASPECT
}

/* ------------------------------------------------------------------ 纯几何 */

/**
 * 起飞前该站在哪儿 —— 把**图**送回环上那张卡的位置。
 *
 * ★ 对齐的是"图心"，不是"卡心"。环上那张卡只有一张 16:9 的图；墙上这一格
 *   是"图 + 名字 + 主题词"，卡心比图心低约 22px。所以除了平移，还要把
 *   **缩放本身**造成的偏移补掉：元素绕自己的中心 C 缩放 s 倍时，点 P 会落到
 *   `C + s(P − C)`，于是要让 P 落在 R 上，平移量是 `R − C − s(P − C)`。
 *   （`theme-handoff.test.ts` 里那条"图心落在环上那张卡的中心"就是钉它的。）
 *
 * `card` 是**整格**（`li`）的盒子，`art` 是**图**的盒子——两个都要，因为
 * 上面那条式子里 C 来自前者、P 来自后者。
 */
export function flightVars(shot: ThemeShot, art: Rect, card: Rect): FlightVars {
  const s = clamp(art.width > 1 ? shot.w / art.width : 1, SCALE_MIN, SCALE_MAX)
  const artCx = art.left + art.width / 2
  const artCy = art.top + art.height / 2
  const cardCx = card.left + card.width / 2
  const cardCy = card.top + card.height / 2

  return {
    x: shot.cx - cardCx - s * (artCx - cardCx),
    y: shot.cy - cardCy - s * (artCy - cardCy),
    scale: s,
    rotate: shot.rot,
    opacity: clamp(shot.opacity, 0, 1),
  }
}

/* -------------------------------------------------------------------- 载荷 */

let pending: { at: number; shots: ThemeShot[] } | null = null

/** 记下这一刻的 12 张。`now` 是参数（不是 `Date.now()` 写死在里面），否则过期那条测不了 */
export function rememberThemes(shots: ThemeShot[], now: number = Date.now()): void {
  pending = { at: now, shots }
}

/**
 * 取一次载荷。**只看不认领** —— 认领由消费方那一屏自己来（`CreateLanding` 挂载时
 * `forgetThemes()`）：React 严格模式会重复调用 `useState` 的初始化器，
 * "读一次就没"的写法在 dev 下会读到一个空的（与"防双发用 ref 不用 state"同一类坑）。
 * ★ 认领**不放进 `useEnterTimeline`**：那条时间线是"工作台每一屏"的通用件，
 *   不该知道一个模块级的载荷；何况那会形成 useEnterTimeline ⇄ theme-handoff 的循环 import。
 *
 * ★ 过期的当场清掉，返回 null。挡的是这一种：点了「开始创作」但导航没发生
 *   （用户又点了别处 / 自己取消了），几十秒后他从侧栏进 `/home`——
 *   那时拿一份旧坐标去飞，12 张会从一个跟当下毫无关系的位置开始。
 */
export function peekThemes(now: number = Date.now()): ThemeShot[] | null {
  if (!pending) return null
  if (now - pending.at > HANDOFF_TTL_MS) {
    pending = null
    return null
  }
  return pending.shots
}

export function forgetThemes(): void {
  pending = null
}

/* ---------------------------------------------------------------- 读 DOM 那两半 */

export const RING_ITEM = '.hero-orbit__item'
export const WALL_ITEM = '.cl__wall li'
export const WALL_ART = '.cl__theme-art'

/**
 * 量下环上 12 张此刻在视口里的位置。
 *
 * 三个来源各管一件事，**不是取巧**：
 *   · 中心与宽度取 `getBoundingClientRect()` —— 它是**投影之后**的那一块。
 *     父层 `.hero-orbit` 的 `rotateX(-3deg)` 与 `.hero` 的 `perspective: 1400px`
 *     配上每张卡自己的深度（`z = (d − .5)·360`，最深 ±180），倍数就是
 *     `1400 / (1400 ∓ 180)`：**近的那半圈约 1.147、远的那半圈约 0.886**（这是推的）。
 *     ★ 1440×900 实测（逐张：`包围盒 ÷ 旋转撑大 ÷ 未投影宽`，2026-10-16）：
 *     `z=+180` 那张 **1.140**、`z=−180` 那张 **0.894**、`z=0` 的 1.02 ——
 *     也就是**前/后排各约 ±12%**。这一项要是不量，切页那一帧前排那 6 张会
 *     凭空缩小一成多，而接力的全部意义就是"你刚才看到的那 12 张接着走"。
 *   · 但包围盒**也被旋转撑大了**（最外圈 ±5.2°，16:9 的盒子宽出约 4.7%），
 *     所以用 `rotInflation()` 除回去。
 *   · 旋转本身取元素**自己**那条 `transform`（`DOMMatrixReadOnly`，`atan2(b, a)`）——
 *     包围盒里没有旋转这个概念，而父层那 3° 不是这张卡的旋转。
 *
 * ★ 12 张没量齐就整份作废（返回空数组）。宁可整批退回默认进场，
 *   也不要"11 张飞、1 张自己浮上来"——那看起来就是坏了。
 */
export function captureRing(hero: HTMLElement): ThemeShot[] {
  const figures = Array.from(hero.querySelectorAll<HTMLElement>(RING_ITEM))
  if (!figures.length) return []

  const shots: ThemeShot[] = []
  for (const el of figures) {
    const index = Number(el.dataset.orbitIndex)
    if (!Number.isInteger(index) || index < 0) continue
    const rect = el.getBoundingClientRect()
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    const rot = (Math.atan2(m.b, m.a) * 180) / Math.PI
    shots[index] = {
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      w: rect.width / rotInflation(rot),
      opacity: Number(getComputedStyle(el).opacity),
      rot,
    }
  }

  return shots.length === figures.length && shots.every(Boolean) ? shots : []
}

/**
 * 把"环上量到的那 12 张"变成 `useEnterTimeline` 能接的**接力**：
 * 墙上那一步的起点、时长、起始时刻全部由这里给。
 *
 * ★ 起点是**逐张算**的，所以 `vars` 里是 GSAP 的函数取值，不是一组常数；
 *   每格只量一次（`WeakMap` 缓存）—— 五个属性各调一次函数，不缓存就是 60 次
 *   包围盒读取，而它们本来只需要 12 次。
 *
 * ★ 量的是**当下**的几何，所以这个函数只能在 `/home` 已经布局之后调用
 *   （`useEnterTimeline` 的 effect 里，那时 DOM 就在那儿）。
 *   墙上那 12 格的图带着显式 `width/height` 与 `aspect-ratio`（见 `create-landing.css`），
 *   所以"图还没加载完"不会让这一刻的几何偏移。
 */
export function themeArrival(shots: ThemeShot[]): EnterArrival | null {
  if (!shots.length) return null

  const cache = new WeakMap<HTMLElement, FlightVars>()
  const varsOf = (index: number, el: HTMLElement): FlightVars => {
    const hit = cache.get(el)
    if (hit) return hit

    const shot = shots[index]
    const art = el.querySelector<HTMLElement>(WALL_ART)
    /* 兜底：缺一张就那一张走 `ENTER_STEPS` 原来那组起点（`from: {opacity: 0, y: 12}`），
       而不是留在原地——那会变成一格"已经就位却没动过"的卡，比不飞更像坏掉 */
    const vars: FlightVars =
      shot && art
        ? flightVars(shot, art.getBoundingClientRect(), el.getBoundingClientRect())
        : { x: 0, y: 12, scale: 1, rotate: 0, opacity: 0 }

    cache.set(el, vars)
    return vars
  }

  return {
    sel: WALL_ITEM,
    at: ARRIVAL_AT,
    duration: ARRIVAL_DURATION,
    vars: {
      x: (i: number, el: HTMLElement) => varsOf(i, el).x,
      y: (i: number, el: HTMLElement) => varsOf(i, el).y,
      scale: (i: number, el: HTMLElement) => varsOf(i, el).scale,
      rotate: (i: number, el: HTMLElement) => varsOf(i, el).rotate,
      opacity: (i: number, el: HTMLElement) => varsOf(i, el).opacity,
    } satisfies EnterVars,
  }
}
