/**
 * theme-handoff.test.ts —— 接力里**能在 node 里验**的那部分
 *
 * 与 `useEnterTimeline.test.ts` 同一条口径：只测纯函数与纯状态，
 * **不拉 jsdom**、不假装验过动效。所以这个文件里没有一处 `captureRing` /
 * `themeArrival` —— 它们要真 DOM、要真布局，只有真页面能验（README §五 那一条）。
 *
 * 三条值得钉住的：
 *   1. **图心对齐**。墙上那一格比环上那张卡多一行名字，卡心比图心低约 22px；
 *      `x/y` 里那条 `s·(artC − cardC)` 就是为它存在的。少写这一项，
 *      飞行不会崩，只会让每一张都稳稳地偏下一点点——"看起来差不多"是最难发现的那种错。
 *   2. **不出 NaN**。量不到尺寸时比例会变成 `x/0`，而 GSAP 拿到 NaN 会让
 *      **整条时间线静默失效**（症状：什么都没动）。
 *   3. **载荷是"看一眼"不是"拿走"**。`peek` 认领会让 React 严格模式下的第二次
 *      初始化器读到空的（dev 下动不动就复现、生产上不会，最难查的那种）。
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  CARD_ASPECT,
  HANDOFF_TTL_MS,
  SCALE_MAX,
  SCALE_MIN,
  WALL_ITEM,
  flightVars,
  forgetThemes,
  peekThemes,
  rememberThemes,
  rotInflation,
  themeArrival,
  type Rect,
  type ThemeShot,
} from './theme-handoff.ts'
import { ENTER_STEPS } from './useEnterTimeline.ts'

/** 一张 16:9 的图 + 下面一行名字：整格 200×160，图占顶上 200×112.5 */
const CARD: Rect = { left: 0, top: 0, width: 200, height: 160 }
const ART: Rect = { left: 0, top: 0, width: 200, height: 112.5 }

/** 把 `flightVars` 的解**代回**元素上，看图上某个点会落到哪儿（与 CSS 同一套算法） */
function project(point: { x: number; y: number }, vars: ReturnType<typeof flightVars>) {
  const cx = CARD.left + CARD.width / 2
  const cy = CARD.top + CARD.height / 2
  return {
    x: cx + vars.scale * (point.x - cx) + vars.x,
    y: cy + vars.scale * (point.y - cy) + vars.y,
  }
}

const shot = (over: Partial<ThemeShot> = {}): ThemeShot => ({
  cx: 500,
  cy: 300,
  w: 100,
  opacity: 0.5,
  rot: 4,
  ...over,
})

describe('flightVars：起飞前该站在哪儿', () => {
  it('★ 图心落回环上那张卡的中心', () => {
    const s = shot()
    const vars = flightVars(s, ART, CARD)
    const artCenter = { x: ART.left + ART.width / 2, y: ART.top + ART.height / 2 }
    const landed = project(artCenter, vars)
    expect(landed.x).toBeCloseTo(s.cx, 9)
    expect(landed.y).toBeCloseTo(s.cy, 9)
  })

  it('★ 少了 s·(artC − cardC) 那一项就偏下——这条钉的正是它', () => {
    const s = shot()
    const vars = flightVars(s, ART, CARD)
    const artCenter = { x: ART.left + ART.width / 2, y: ART.top + ART.height / 2 }
    // 只平移、不补缩放偏移：那是"把卡心对齐"的写法
    const naive = { ...vars, y: s.cy - (CARD.top + CARD.height / 2) }
    const landed = project(artCenter, naive)
    // 偏的就是「图心到卡心的距离 × (1 − 缩放)」，这里约 12px（s = 0.5）
    expect(landed.y - s.cy).toBeCloseTo(-(80 - 56.25) * (1 - 0.5), 6)
    expect(Math.abs(landed.y - s.cy)).toBeGreaterThan(10)
  })

  it('尺寸、旋转、透明度照抄环上那一刻', () => {
    const vars = flightVars(shot({ w: 300, rot: -5.2, opacity: 0.28 }), ART, CARD)
    expect(vars.scale).toBeCloseTo(1.5, 9)
    expect(vars.rotate).toBe(-5.2)
    expect(vars.opacity).toBeCloseTo(0.28, 9)
  })

  it('透明度夹在 0..1（环上那半圈是 0.28–1，但别指望上游永不越界）', () => {
    expect(flightVars(shot({ opacity: 1.4 }), ART, CARD).opacity).toBe(1)
    expect(flightVars(shot({ opacity: -0.2 }), ART, CARD).opacity).toBe(0)
  })

  it('★ 量不到尺寸时给退化值，绝不出 NaN / Infinity', () => {
    for (const art of [
      { ...ART, width: 0 },
      { ...ART, width: 1 },
      { ...ART, width: -3 },
    ]) {
      const vars = flightVars(shot(), art, CARD)
      expect(Number.isFinite(vars.scale), `art.width=${art.width}`).toBe(true)
      expect(Number.isFinite(vars.x)).toBe(true)
      expect(Number.isFinite(vars.y)).toBe(true)
      expect(vars.scale).toBeGreaterThanOrEqual(SCALE_MIN)
      expect(vars.scale).toBeLessThanOrEqual(SCALE_MAX)
    }
  })

  it('比例越界时夹到档上（前排那张环上约 2.1 倍，正常范围里不该被夹）', () => {
    expect(flightVars(shot({ w: 20_000 }), ART, CARD).scale).toBe(SCALE_MAX)
    expect(flightVars(shot({ w: 0.0001 }), ART, CARD).scale).toBe(SCALE_MIN)
    expect(flightVars(shot({ w: 337 }), ART, CARD).scale).toBeCloseTo(1.685, 3)
  })
})

describe('载荷：记住 / 看一眼 / 忘掉', () => {
  beforeEach(() => forgetThemes())

  it('记下来的原样拿得到，而且**看一眼不算拿走**（peek 两次都还在）', () => {
    const shots = [shot(), shot({ cx: 10 })]
    rememberThemes(shots, 1_000)
    expect(peekThemes(1_000)).toHaveLength(2)
    expect(peekThemes(1_500)?.[1]?.cx).toBe(10)
  })

  it('过期就当场清掉：拿不到，而且再拿一次也没有了', () => {
    rememberThemes([shot()], 1_000)
    expect(peekThemes(1_000 + HANDOFF_TTL_MS)).not.toBeNull()
    expect(peekThemes(1_000 + HANDOFF_TTL_MS + 1)).toBeNull()
    expect(peekThemes(1_000)).toBeNull()
  })

  it('forget 之后拿不到（首页挂载时会清一次那上一轮的坐标）', () => {
    rememberThemes([shot()], 1_000)
    forgetThemes()
    expect(peekThemes(1_000)).toBeNull()
  })

  it('没记过就是 null，不是空数组', () => {
    expect(peekThemes(1_000)).toBeNull()
  })
})

describe('themeArrival：空载荷不给接力', () => {
  it('一张都没有 → null（调用方因此走 ENTER_STEPS 原来那一步）', () => {
    expect(themeArrival([])).toBeNull()
  })

  it('★ 接力的选择器与 ENTER_STEPS 最后一步**必须是同一个字符串**', () => {
    /* 接管是按 `sel` 字符串对上的（`useEnterTimeline` 里那一句 `takeover.sel === step.sel`），
       所以这两个常量一旦各改各的，接力会**静默失效**：页面照样进场、什么都不报，
       只是那 12 张改成从下面浮上来了。这条断言就是那次静默的哨兵。 */
    const last = ENTER_STEPS[ENTER_STEPS.length - 1]
    expect(WALL_ITEM).toBe(last?.sel)
    // 而且必须是**带交错**的那一步：接力继承它的 `stagger()`，12 张才不是一起落地
    expect(last?.stagger).toBeTypeOf('function')
  })
})

describe('rotInflation：包围盒比"这张图自己"宽多少倍', () => {
  it('不转的时候恰好是 1', () => {
    expect(rotInflation(0)).toBeCloseTo(1, 12)
  })

  it('★ 16:9 的盒子转 90° 之后，包围盒的宽就是它的高（9/16）', () => {
    expect(rotInflation(90)).toBeCloseTo(1 / CARD_ASPECT, 12)
    expect(rotInflation(-90)).toBeCloseTo(1 / CARD_ASPECT, 12)
  })

  it('环上最外圈那 5.2°：撑大约 4.7%（这就是要除回去的那一项）', () => {
    expect(rotInflation(5.2)).toBeCloseTo(1.047, 3)
    expect(rotInflation(-5.2)).toBeCloseTo(rotInflation(5.2), 12)
  })

  it('★ 一除一乘能还原：拿它把包围盒还原成图本身的宽', () => {
    const w = 283.11 // 预览面板里量到的一个真实包围盒宽（前排那张，转 0°）
    expect(w / rotInflation(0)).toBeCloseTo(w, 9)
    const rotated = 238.59
    const deg = 1.91
    // 238.59 那张在面板里的旋转是 1.91°，除回去得 234.33（也是那次读数，两位小数）
    expect(rotated / rotInflation(deg)).toBeCloseTo(234.33, 1)
  })
})
