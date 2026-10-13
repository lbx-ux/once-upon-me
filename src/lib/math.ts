/**
 * 共用数学 —— 首页动效里被反复手抄的那三个小函数
 *
 * ## 为什么要单独一个文件
 *
 * `clamp` 与 `smoothstep` 在 `HeroOrbit.tsx` 里各有一份，`useScrollDriver.ts` 里
 * 又有一份 `clamp`。第三屏是第四个消费者。**四份手抄的同一个小函数**，
 * 改一处忘两处是迟早的事 —— 而这类函数的错误不会崩，只会让某条曲线悄悄不对。
 *
 * ## 但这一批**不迁移**前两屏
 *
 * `HeroOrbit` 与 `useScrollDriver` 继续用它们自己那份，本文件只服务新代码。
 * 理由是这条仓库已有的纪律（README §五「刻意未做」）：
 * 搬动已实测的代码要单独一个提交、行为必须一字不变，混进特性提交里
 * 出了问题分不清是谁带的。迁移是单独一件事，记在 README 的未做清单。
 *
 * ## 唯一的行为差别
 *
 * `smoothstep` 在**退化区间**（`edge0 === edge1`）上返回阶跃而不是 NaN。
 * `HeroOrbit` 那份会算 `0/0`，NaN 经 `Math.max/min` 一路传染到 opacity 与 transform。
 * 现有调用点从不传退化区间，所以那不是 bug；但一份要共用的函数不该留着这个坑。
 */

/** 夹到 `[lo, hi]`，默认 `[0, 1]`。 */
export function clamp(v: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * Hermite 三次平滑阶跃：在 `[edge0, edge1]` 内做 S 形过渡，区间外饱和在 0 / 1。
 *
 * 归一化后的 `t` 走 `3t² − 2t³`，两端导数为 0 —— 这就是它比 `linear` 好看的唯一原因：
 * 进场与离场没有"折角"。
 *
 * 退化区间（`edge0 === edge1`）走阶跃：`x` 到没到 `edge1` 就是 0/1，不出 NaN。
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x >= edge1 ? 1 : 0
  const t = clamp((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** 线性插值：`t=0` 得 `a`，`t=1` 得 `b`。不做夹取 —— 要外推的时候是故意的。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 把 `-0` 归一成 `+0`。
 *
 * 不是洁癖。`(-0).toFixed(2)` 是字符串 `"-0.00"`，于是
 * `rotateY(-0deg)` 与 `rotateY(0deg)` 在**数值上等价、在字符串上不等价**。
 * 而这一屏的写入路径靠字符串去重（`useScrollDriver` 的 `setVar` 是
 * `lastVars.get(name) === value` 才跳过），一个取不到的负号会退化成
 * 每帧一次无意义的样式重算 —— 正好是要避开的那件事。
 *
 * `v === 0` 对 `-0` 也为真，所以这一行同时吃掉两个零。
 */
export function noNegZero(v: number): number {
  return v === 0 ? 0 : v
}
