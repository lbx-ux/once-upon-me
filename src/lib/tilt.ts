import { clamp, noNegZero } from './math'

/**
 * tilt.ts —— 指针位置 → 卡片倾斜量，纯函数
 *
 * 第三屏那个「卡片是一张被一角托起的纸」的全部数学都在这里。GSAP 只负责把
 * 输出平滑地写到元素上，**映射本身不碰 DOM** —— 因为符号这种东西
 * 在页面上是看不出错来的：方向反了，"纸被托起来"变成"纸往后仰"，
 * 而在 diff 里它只是少了一个负号。
 *
 * ## CSS 3D 的符号推导（写下来是为了下次不用重新推）
 *
 * 轴：`+X` 向右，`+Y` **向下**，`+Z` 指向观察者。右手系。
 *
 * | 变换 | 发生什么 |
 * | --- | --- |
 * | `rotateX(+θ)` | `+Y`（下缘）转向 `+Z` → 下缘抬起、上缘压下去 |
 * | `rotateY(+θ)` | `+Z` 转向 `+X` → 右缘压下去、左缘抬起 |
 *
 * 要「**光标那一角抬向观察者**」：光标在上（`ny = -1`）需要 `rotateX` 为负，
 * 光标在右（`nx = +1`）需要 `rotateY` 为负。所以两个输出都带负号，
 * 而 `artY` 不带 —— 插画是往**反**方向滑的（光标右上 → 插画左下），
 * 那一层反向位移才是"玻璃相框里的画"这个错觉的来源。
 */

export type TiltSize = { w: number; h: number }

export type TiltConfig = {
  /** 单轴最大倾角。±6° 是"一张纸被托起来"，±8° 往上就变成"一个玩具在手里转"。 */
  maxTiltDeg: number
  /** 插画层反向位移的上限（px）。比倾角更保守：超过 12px 会从视差变成跑偏。 */
  artShiftPx: number
  /** 命中时整卡抬起的高度，交给 hover 的补间用，不随指针位置变。 */
  liftPx: number
  /** 命中时的放大。1.015 ≈ 抬起 6px 后应有的透视补偿，再大就会顶到邻居卡。 */
  hoverScale: number
  /**
   * 暖光斑半径（px）。
   *
   * ★ 240 → **150**（2026-10-18，用户："鼠标的那个光圈效果小一点，不要这么亮"）。
   *   240 在 518 宽的卡面上接近半张卡，读起来是"手电筒打上去"而不是"一角被照亮"；
   *   150 约等于卡片宽度的三成，光落在光标那一角上，卡片其余部分还是纸。
   *
   * ★ 这个数是**这个字段唯一的家**：`.hl__glow` 的渐变读的是 `var(--hl-glow-r)`，
   *   由 `HighlightsReel` 从 `TILT` 写进 section 的行内样式。
   *   改之前 CSS 里另写着一份 240px，而这个字段**没有任何消费者**——
   *   两个手写的数会各自漂移，正是 README 反复警告的那种耦合。
   */
  glowRadiusPx: number
}

export const TILT: TiltConfig = {
  maxTiltDeg: 6,
  artShiftPx: 10,
  liftPx: 6,
  hoverScale: 1.015,
  glowRadiusPx: 150,
}

export type TiltState = {
  rotateX: number
  rotateY: number
  /** 插画层位移（CSS 坐标，+Y 向下） */
  artX: number
  artY: number
  /**
   * 光斑中心，**0–1 的比例**（0 = 左上，1 = 右下），不是像素。
   *
   * 为什么不是 px：这个值最终要落进 CSS 变量给 `radial-gradient(at …)` 用，
   * 而 GSAP 写自定义属性时是**按裸数字**序列化的 —— 写进去的 `280` 会变成
   * `at 280 280`，一条无效 CSS，光斑直接跑到框外。比例配合 CSS 那边的
   * `calc(var(--hl-gx) * 100%)` 就没有单位问题，而且窗口变窄、卡片跟着变窄时
   * 光斑仍然落在同一个相对位置上。
   */
  glowU: number
  glowV: number
}

/**
 * 卡片局部像素 → 归一化到 `[-1, 1]`（中心为原点，+Y 向下，与 CSS 一致）。
 *
 * ★ 零尺寸必须在这里挡住，不能留给除法：非当前卡在某个瞬间量出来是 0 宽
 *   （`display:none`、ResizeObserver 抢在布局之前、窄窗口刚过 `min-width`）。
 *   除零漏出去的 NaN 会顺着 `quickTo` 写进 transform，那张卡就**永久不见**了，
 *   而且刷新页面才好不了 —— 是最难查的一类 bug。
 */
export function normalizePointer(
  px: number,
  py: number,
  size: TiltSize,
): { nx: number; ny: number } {
  if (!(size.w > 0) || !(size.h > 0)) return { nx: 0, ny: 0 }
  return {
    nx: clamp((2 * px - size.w) / size.w, -1, 1),
    ny: clamp((2 * py - size.h) / size.h, -1, 1),
  }
}

/** 平放态。离开卡片、以及 `prefers-reduced-motion` 下的静止终态都是它。 */
export function neutralTilt(): TiltState {
  return { rotateX: 0, rotateY: 0, artX: 0, artY: 0, glowU: 0.5, glowV: 0.5 }
}

/**
 * 归一化指针 → 六个输出量。
 *
 * 两轴**各自独立线性**，不做向量长度的整体缩放：那样角上会变成 `6·√2 ≈ 8.5°`，
 * 恰好跨过"纸"变成"玩具"的那条线。`tilt.test.ts` 里那条角上等于 6° 的测试
 * 钉的就是这个决定。
 *
 * 输入超出 `[-1, 1]` 一律夹住：`pointermove` 会把坐标给到卡片外面
 * （快速移动、跨元素），不外推。
 */
export function tiltFromPointer(nx: number, ny: number, config: TiltConfig = TILT): TiltState {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return neutralTilt()

  const x = clamp(nx, -1, 1)
  const y = clamp(ny, -1, 1)

  return {
    rotateX: noNegZero(y * config.maxTiltDeg),
    rotateY: noNegZero(-x * config.maxTiltDeg),
    artX: noNegZero(-x * config.artShiftPx),
    artY: noNegZero(-y * config.artShiftPx),
    glowU: (x + 1) / 2,
    glowV: (y + 1) / 2,
  }
}
