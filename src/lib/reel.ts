import { clamp } from './math'

/**
 * reel.ts —— 轮播的状态，纯函数，不碰 DOM 也不碰 React
 *
 * 与 `book/flip.ts` 同一个先例：把"算位置"这件事从组件里剥出来，
 * 因为它**恰好是那种在页面上看不出对错**的逻辑 —— 可见性、tab 序列、读屏
 * 三者不一致时，画面完全正常，只有键盘党和读屏用户会发现有些卡永远到不了。
 *
 * ## 三个"可见性"是三件事，不许合并
 *
 * | 量 | 含义 | 判据 |
 * | --- | --- | --- |
 * | `advanceOnClick` | 点它该不该翻过去 | 不是当前卡，且 `|offset| <= CLICK_RADIUS` |
 * | `exposed` | 该不该被读到 / 能 tab 到 | **只有当前卡** |
 *
 * 把这两个混成一个是最自然的写法，也是最容易出事的写法：露出半张的卡
 * 视觉上明摆着可以点，但对读屏必须藏起来（不然一次念五条）。
 *
 * ## 这里**没有** "该不该进 DOM" 这一项，是刻意删掉的
 *
 * 第一版有第三个量 `rendered`（`|offset| <= STAGE_RADIUS` 才进 DOM），
 * 用来给未来的长列表兜住节点数。实测把它去掉的理由：
 * 首页是静态预渲染的，`active` 初值 0 → 左边没有卡位 → 5 条里只有 3 条进了 HTML。
 * **另外两条亮点在爬虫与禁用 JS 的人眼里根本不存在**，而页面上完全看不出来。
 * 五条（以后就算十条）绝对定位的卡片不是性能问题；内容缺失才是。
 * 舞台半径仍然要留，但它管的是**视觉窗口**（超出多少张就钉在最深一档），
 * 不管 DOM 里有没有这张卡；超出窗口的卡片由 CSS 按深度夹紧外观、
 * 再由 `.hl` 的 `overflow: hidden` 裁掉。
 */

/** 视觉舞台半径：当前卡左右各几张还"看得见"。只喂给 CSS 的深度档位，不决定 DOM 里有没有这张卡。 */
export const STAGE_RADIUS = 2
/** 露出边的那几张里，点得动的半径。比舞台半径小 —— 最外圈那张只露一条缝，点它翻不过去。 */
export const CLICK_RADIUS = 1

export type ReelSlot = {
  /** 在内容数组里的下标 */
  index: number
  /** 相对当前卡的卡位：0 = 当前，负 = 左，正 = 右。像素换算留给 CSS 与组件。 */
  offset: number
  isCurrent: boolean
  /** 点它应该翻到这一条 */
  advanceOnClick: boolean
  /** 暴露给辅助技术与 tab 序列 */
  exposed: boolean
}

/**
 * 每张卡的状态。
 *
 * ★ `offset` 走的是**环形最短位移**，不是 `index - active`。
 *   第一版用的是后者，于是 active=0（第 1 条）时偏移是 `[0,1,2,3,4]` ——
 *   **左边一个卡位都没有**，第 4、5 条全堆在右边缘外被裁掉。
 *   截图上就是"轮播图左边空一大片"。既然是轮播，第 1 条的**前面**就该是第 5 条。
 *   现在 active=0 的偏移是 `[0,1,2,-2,-1]`，左右各两张，永远对称。
 *
 * 非有限值（NaN 会从键盘事件与 `scrollY` 那条路漏进来）退回 0，
 * 绝不让 NaN 顺着 `offset` 流进 transform 字符串 —— 那会让整排卡当场消失。
 */
export function reelState(active: number, count: number): ReelSlot[] {
  if (count <= 0) return []

  const current = Number.isFinite(active) ? Math.round(clamp(active, 0, count - 1)) : 0

  return Array.from({ length: count }, (_, index) => {
    const offset = ringOffset(current, index, count)
    const isCurrent = offset === 0
    const distance = Math.abs(offset)

    return {
      index,
      offset,
      isCurrent,
      advanceOnClick: !isCurrent && distance <= CLICK_RADIUS,
      exposed: isCurrent,
    }
  })
}

/**
 * `from` 这一位上，`to` 那张卡的**环形带符号位移**：0 = 就是它，负 = 在左，正 = 在右。
 *
 * 取的是两条路里短的那条，所以结果永远落在 `(-count/2, +count/2]`。
 * 偶数张时正对面那张（差半圈）算在**右**边 —— 没有物理理由，只要它确定：
 * 两边都算得通却每次结果不同，比固定一边难查得多。
 *
 * 那两步取模不是防御性代码，与 `wrapActive` 同一个理由：JS 的 `%` 跟着被除数符号走。
 */
export function ringOffset(from: number, to: number, count: number): number {
  if (count <= 0) return 0
  const forward = ((((to - from) % count) + count) % count) | 0
  return forward > count / 2 ? forward - count : forward
}

/**
 * 给 CSS 用的**夹紧深度**：`min(|offset|, STAGE_RADIUS)`。
 *
 * 超出舞台半径的卡仍然在 DOM 里（理由见文件头），但外观钉在最深那一档，
 * 再由 `.hl` 的 `overflow: hidden` 把它们裁掉。
 * 有了这个函数，CSS 只需要 0 / 1 / 2 三档规则，不必为第 3、4 张补选择器。
 */
export function reelDepth(offset: number): number {
  return Math.min(Math.abs(offset), STAGE_RADIUS)
}

/**
 * 哪些卡这一拍**跨过了接缝**（从最右跳到最左，或反过来）。
 *
 * 环形轮播绕回去时必然有一张卡走的是"长的那条路"：它的 offset 一步跳掉大半圈。
 * 组件据此**只关掉那一张的补间** —— 不关就会看见一张模糊的卡横穿整个轮播中央，
 * 像页面坏了。
 *
 * 判据是 `|Δ| > count / 2`：环上短的那条路永远不超过半圈，所以超过半圈的
 * 一定是跨界。一步跨好几格（Home / End）时同样只有真正跨过接缝的那一张满足。
 *
 * `prev` 比 `next` 短（首帧、或以后张数变了）时一律 false —— 没有上一次就不算跨界。
 */
export function reelJumped(prev: number[], next: number[], count: number): boolean[] {
  return next.map((offset, index) => {
    const before = prev[index]
    if (before === undefined) return false
    return Math.abs(offset - before) > count / 2
  })
}

/**
 * 拖了多少像素 → 该翻到第几条（相对当前卡的位移）。
 *
 * 方向：**往左拖 = 前进**（内容跟着手走，右边那张被拉进来），所以是 `-dx`。
 * 用 `round` 不是 `floor`：过半就认，不过半就弹回 —— 拖到 0.5 格时用户已经
 * 表达了意图，卡在中间不上不下是最坏的结果。
 *
 * 上限夹在 `floor(count / 2)`：环上最远就是半圈，往右绕 4 格与往左绕 1 格是同一张卡，
 * 让它绕两圈落回同一处只会让人以为拖动了别的卡。
 *
 * `step <= 0`（探针还没量到、或 CSS 出错）返回 0 —— 宁可什么都不翻，
 * 也不要除零算出 `Infinity` 再被 `wrapActive` 夹成 0，那等于凭空跳到第一条。
 */
export function dragSteps(dx: number, step: number, count: number): number {
  if (!Number.isFinite(dx) || !(step > 0) || count <= 0) return 0
  const cap = Math.floor(count / 2)
  return clamp(Math.round(-dx / step), -cap, cap)
}

/**
 * 环形步进：手动（键盘 ← →）与自动轮播**共用这一个函数**。
 *
 * 原先这里有两个函数：`stepActive`（夹在两端，给箭头按钮用，到头就 disable）
 * 与 `wrapActive`（环形，只给自动播）。分两套的理由是"到头了是说给人听的信息"。
 * 那排箭头与圆点已经删掉，剩下的唯一手动入口是键盘，而键盘在**环形轮播**上
 * 按到第 5 条再按 → 就该回到第 1 条 —— 与画面一致。所以夹两端那套没有调用者了，
 * 连同它的测试一起删掉，不留"以后可能用得上"的死代码。
 *
 * 绕回去那一下的观感问题（有一张卡要横跨整圈）不在这里解决，
 * 在组件那边用 `data-jump` 关掉那一张的补间。
 *
 * 取模那两步不是防御性代码：JS 的 `%` 跟着被除数的符号走，
 * `(-1) % 5` 是 `-1` 而不是 `4`，少加一次 `+ count` 就会算出负下标，
 * 然后 `HIGHLIGHTS[-1]` 是 `undefined`，整节当场渲染崩掉。
 */
export function wrapActive(active: number, delta: number, count: number): number {
  if (count <= 0) return 0
  const base = Number.isFinite(active) ? Math.round(clamp(active, 0, count - 1)) : 0
  if (!Number.isFinite(delta)) return base
  const step = Math.trunc(delta)
  return (((base + step) % count) + count) % count
}
