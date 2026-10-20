import { describe, expect, it } from 'vitest'

import { TILT, neutralTilt, normalizePointer, tiltFromPointer } from './tilt'

/**
 * lib/tilt.ts 的测试
 *
 * 这个文件存在的唯一理由是符号。
 * 倾斜方向反了，观感从「纸被一角托起」变成「纸往后仰」，
 * 而它在代码 diff 里只是少了一个负号 —— 眼睛看页面看不出来，看 diff 也看不出来。
 * 所以下面这张符号表用中文写出观感，让人能核对，而不是只写数字。
 *
 * CSS 3D 的推导（写在这里，是为了下次不用重新推）：
 *   轴：+X 向右，+Y 向下，+Z 指向观察者。右手系。
 *   rotateX(+θ)：+Y（下缘）转向 +Z → 下缘抬起、上缘压下去
 *   rotateY(+θ)：+Z 转向 +X → 右缘压下去、左缘抬起
 *   要「光标那一角抬向观察者」，光标在上（ny=-1）就得 rotateX 为负，
 *   光标在右（nx=+1）就得 rotateY 为负。
 */

describe('tiltFromPointer —— 符号表（观感）', () => {
  it('光标在右上角：上缘与右缘都抬向观察者 → rotateX、rotateY 都是负', () => {
    const t = tiltFromPointer(1, -1)
    expect(t.rotateX).toBeLessThan(0)
    expect(t.rotateY).toBeLessThan(0)
  })

  it('光标在左下角：下缘与左缘抬起 → 两者都是正', () => {
    const t = tiltFromPointer(-1, 1)
    expect(t.rotateX).toBeGreaterThan(0)
    expect(t.rotateY).toBeGreaterThan(0)
  })

  it('★ 插画往**反**方向滑：光标右上 → 插画往左下（CSS 的 +Y 是向下）', () => {
    const t = tiltFromPointer(1, -1)
    expect(t.artX).toBeLessThan(0) // 往左
    expect(t.artY).toBeGreaterThan(0) // 往下
  })

  it('光标在正中心：卡片完全平放，光斑在正中间', () => {
    expect(tiltFromPointer(0, 0)).toEqual({
      rotateX: 0,
      rotateY: 0,
      artX: 0,
      artY: 0,
      glowU: 0.5,
      glowV: 0.5,
    })
  })

  it('上下左右四个中点各自只动一根轴', () => {
    expect(tiltFromPointer(0, -1).rotateY).toBe(0)
    expect(tiltFromPointer(0, -1).rotateX).not.toBe(0)
    expect(tiltFromPointer(1, 0).rotateX).toBe(0)
    expect(tiltFromPointer(1, 0).rotateY).not.toBe(0)
  })
})

describe('tiltFromPointer —— 上限与夹取', () => {
  it('角上恰好是上限（不是 √2 倍）', () => {
    // 这条抓的是"两轴各自独立线性"这个决定：如果实现改成按向量长度整体缩放，
    // 角上就会变成 6·√2 ≈ 8.5°，观感立刻从"纸"变成"玩具"。
    const t = tiltFromPointer(1, -1)
    expect(t.rotateX).toBeCloseTo(-TILT.maxTiltDeg, 10)
    expect(t.rotateY).toBeCloseTo(-TILT.maxTiltDeg, 10)
  })

  it('指针跑到卡外面也不外推：6° 就是天花板', () => {
    // 上游是 pointermove，浏览器会把坐标给到卡片外面（快速移动、跨元素）。
    // 不夹的话 3 倍出界就是 18°，卡片当场翻面。
    const t = tiltFromPointer(3, -3)
    expect(Math.abs(t.rotateX)).toBeLessThanOrEqual(TILT.maxTiltDeg)
    expect(Math.abs(t.rotateY)).toBeLessThanOrEqual(TILT.maxTiltDeg)
    expect(Math.abs(t.artX)).toBeLessThanOrEqual(TILT.artShiftPx)
  })

  it('线性：走到一半就是上限的一半', () => {
    expect(tiltFromPointer(0.5, 0).rotateY).toBeCloseTo(-TILT.maxTiltDeg * 0.5, 10)
  })

  it('NaN 进来当作"没在卡上"，全零而不是把 NaN 写进 transform', () => {
    expect(tiltFromPointer(Number.NaN, Number.NaN)).toEqual(neutralTilt())
  })
})

describe('光斑位置', () => {
  // 光斑是 0–1 的比例，不是像素 —— 因为 GSAP 把自定义属性按裸数字序列化，
  // 像素值落进 `radial-gradient(at 280 140)` 是一条无效 CSS。
  // 类型上写清楚了吗：写了，在 TiltState.glowU 的注释里。这里钉住行为。
  it('四角与中心', () => {
    expect(tiltFromPointer(1, -1)).toMatchObject({ glowU: 1, glowV: 0 })
    expect(tiltFromPointer(-1, 1)).toMatchObject({ glowU: 0, glowV: 1 })
    expect(tiltFromPointer(0, 0)).toMatchObject({ glowU: 0.5, glowV: 0.5 })
  })

  it('出界的光斑也夹在框内，暖光不该漏到卡外面', () => {
    const t = tiltFromPointer(9, 9)
    expect(t.glowU).toBe(1)
    expect(t.glowV).toBe(1)
  })

  it('比例与倾角同源：同一个 nx 给出同一个方向', () => {
    // 抓的是"光斑和倾斜各算一套坐标"这种分裂：两者必须由同一对 nx/ny 推出。
    const right = tiltFromPointer(1, 0)
    expect(right.glowU).toBe(1)
    expect(right.rotateY).toBeLessThan(0) // 右缘抬起，光也在右边
  })
})

describe('normalizePointer', () => {
  const SIZE = { w: 560, h: 315 }

  it('中心 → 0,0；四角 → ±1', () => {
    expect(normalizePointer(280, 157.5, SIZE)).toEqual({ nx: 0, ny: 0 })
    expect(normalizePointer(560, 0, SIZE)).toEqual({ nx: 1, ny: -1 })
    expect(normalizePointer(0, 315, SIZE)).toEqual({ nx: -1, ny: 1 })
  })

  it('★ 零尺寸（display:none / ResizeObserver 抢跑）返回 0,0 而不是 NaN', () => {
    // 这是真会撞上的：非当前卡在某个瞬间量出来是 0 宽，
    // 除零漏出去的 NaN 会顺着 quickTo 写进 transform，那张卡就永久不见了，
    // 而且要刷新页面才好 —— 最难查的那一类。
    expect(normalizePointer(10, 10, { w: 0, h: 0 })).toEqual({ nx: 0, ny: 0 })
    expect(normalizePointer(10, 10, { w: -5, h: 3 })).toEqual({ nx: 0, ny: 0 })
  })

  it('归一化与 tiltFromPointer 接得上：中心点给出平放态', () => {
    const { nx, ny } = normalizePointer(280, 157.5, SIZE)
    expect(tiltFromPointer(nx, ny)).toEqual(neutralTilt())
  })
})

describe('neutralTilt', () => {
  it('与"指针在中心"完全一致 —— 离开卡片就是回到这个状态', () => {
    expect(neutralTilt()).toEqual(tiltFromPointer(0, 0))
  })
})
