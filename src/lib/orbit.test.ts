import { describe, expect, it } from 'vitest'

import { blurFilter, placeCard, restInlineStyle, type OrbitInputs } from './orbit'

/**
 * lib/orbit.ts 的测试
 *
 * 这个文件存在的唯一理由：那段摆位数学被搬过一次，而搬动的代价是看不见的。
 * 环在页面上照样转、卡片照样有前后，只有某张卡的某一段弧度悄悄差了 8px ——
 * 那种错在截图里看不出来，在 diff 里也看不出来。
 *
 * 所以下面第一块是对照实现：把搬走之前 `HeroOrbit.frame()` §5–§6 那段
 * 逐字抄下来（连乘的顺序都保着）。`placeCard` 必须在整张输入网格上与它相等。
 * 断言用 `toBeCloseTo(…, 12)` 而不是 `toBe`：两者只有操作顺序可能不同，
 * 差在浮点末位，而末位之差不该让测试变红；真正改了数学的话差值远大于 1e-12。
 *
 * 第二块钉的是分解：静态帧的 `kx/ky/py` 是同一函数在 `rx=1,ry=0` 与
 * `rx=0,ry=1` 上取两次解出来的（`restInlineStyle`），得保证
 * `kx·rx + py == placeCard(rx, ry).x/y` —— 这条要是破了，预渲染那一帧
 * 与 JS 第一帧就会错位，而这正是这次修复要接上的缝。
 */

type Ref = ReturnType<typeof placeCard>

/** 搬走之前那段代码，原样。改它就等于改对照标准，别动。 */
function reference(inp: OrbitInputs): Ref {
  const { i, n, phase, rx, ry, sceneX, sceneY, fadeOut, lift } = inp
  const TAU = Math.PI * 2
  const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
  const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = clamp((x - edge0) / (edge1 - edge0))
    return t * t * (3 - 2 * t)
  }

  const a = phase + (i / n) * TAU
  const d = (Math.sin(a) + 1) / 2

  const x =
    Math.cos(a) * rx * (0.82 + 0.18 * d) * (1.2 + 0.06 * smoothstep(0.72, 0.96, d)) +
    sceneX * (18 + 22 * d)

  let y = Math.sin(a) * ry * 0.89 + sceneY * (10 + 12 * d) - 16 * Math.pow(1 - d, 1.7)
  const frontY = 0.89 * ry + 22 * sceneY
  y += (frontY - y) * smoothstep(0.68, 0.9, d)

  const z = (d - 0.5) * 360
  const scale = 0.58 + 0.58 * d + lift
  const rot = 5.2 * Math.sin(1.6 * a + 0.8 * i) * Math.pow(1 - d, 0.72)
  const blur = d < 0.5 ? 5.2 * Math.pow(0.5 - d, 1.3) : 0
  const opacity = (d >= 0.5 ? 1 : 0.28 + (d / 0.5) * 0.72) * fadeOut

  return { x, y, z, scale, rot, blur, opacity, zIndex: Math.round(10 + 80 * d) }
}

const N = 12
const PHASES = [0, Math.PI / 6, Math.PI / 2, Math.PI, 4.7]
const RADII: ReadonlyArray<readonly [number, number]> = [
  [798, 285],
  [500, 200],
  [1420, 285],
  [624, 236],
]
const SCENES: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, -1],
  [-0.62, 0.37],
]
const FADES = [1, 0.78, 0.08]
const LIFTS = [0, 0.19, 0.34]

describe('placeCard —— 与搬走之前那段内联代码等价', () => {
  it('整张输入网格上逐字段相等（12 张卡 × 相位 × 半轴 × 视差 × 淡出 × 弹簧）', () => {
    let checked = 0
    for (const phase of PHASES) {
      for (let i = 0; i < N; i++) {
        for (const [rx, ry] of RADII) {
          for (const [sceneX, sceneY] of SCENES) {
            for (const fadeOut of FADES) {
              for (const lift of LIFTS) {
                const inp: OrbitInputs = { i, n: N, phase, rx, ry, sceneX, sceneY, fadeOut, lift }
                const got = placeCard(inp)
                const want = reference(inp)
                expect(got.x).toBeCloseTo(want.x, 12)
                expect(got.y).toBeCloseTo(want.y, 12)
                expect(got.z).toBeCloseTo(want.z, 12)
                expect(got.scale).toBeCloseTo(want.scale, 12)
                expect(got.rot).toBeCloseTo(want.rot, 12)
                expect(got.blur).toBeCloseTo(want.blur, 12)
                expect(got.opacity).toBeCloseTo(want.opacity, 12)
                expect(got.zIndex).toBe(want.zIndex)
                checked++
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(
      PHASES.length * N * RADII.length * SCENES.length * FADES.length * LIFTS.length,
    )
  })

  it('phase 0 时最前面那张是第 3 张（i = n/4），其余都在它后面', () => {
    const zs = Array.from({ length: N }, (_, i) =>
      placeCard({ i, n: N, phase: 0, rx: 798, ry: 285, sceneX: 0, sceneY: 0, fadeOut: 1, lift: 0 }),
    )
    const front = zs.reduce((best, c, i) => (c.z > zs[best]!.z ? i : best), 0)
    expect(front).toBe(3)
    expect(zs[3]!.zIndex).toBe(90) // 10 + 80 × 1
    expect(zs[3]!.blur).toBe(0) // 前排不糊
    expect(zs[3]!.opacity).toBe(1)
  })
})

describe('restInlineStyle —— 预渲染那一帧（静态帧 = JS 第一帧）', () => {
  it('分解是精确的：kx·rx 与 ky·ry + py 还原出任意半轴下的摆位', () => {
    for (let i = 0; i < N; i++) {
      const style = restInlineStyle(i, N)
      // 从字符串里取回三个系数（格式就是契约的一部分：改格式要同步改这条）。
      // 容差取 2 位小数不是放宽标准 —— 字符串本身就是四舍五入过的，
      // 系数 6 位 / 常数项 3 位，误差上限见 orbit.ts 的 fixed()。
      const m = /calc\((-?[\d.]+) \* var\(--orbit-ry\) ([+-]) ([\d.]+)px\)/.exec(style.transform)!
      const kx = Number(/calc\((-?[\d.]+) \* var\(--orbit-rx\)\)/.exec(style.transform)![1])
      const ky = Number(m[1])
      const py = m[2] === '-' ? -Number(m[3]) : Number(m[3])

      for (const [rx, ry] of RADII) {
        const at = placeCard({
          i,
          n: N,
          phase: 0,
          rx,
          ry,
          sceneX: 0,
          sceneY: 0,
          fadeOut: 1,
          lift: 0,
        })
        expect(kx * rx).toBeCloseTo(at.x, 2)
        expect(ky * ry + py).toBeCloseTo(at.y, 2)
      }
    }
  })

  it('解析出来的常数项与 restInlineStyle 内部那一份一致（字符串没丢符号）', () => {
    // 后半圈那几张卡的 py 是负的（后排上抬），字符串里必须是减号
    const tf = restInlineStyle(6, N).transform // i=6 → a=π → sin=0 → 常数项主导
    expect(tf).toMatch(/var\(--orbit-ry\) - \d+\.\d{3}px/)
  })

  it('12 张卡拿到的都是完整的 transform（静态帧不需要 JS 就能画出来）', () => {
    for (let i = 0; i < N; i++) {
      const style = restInlineStyle(i, N)
      expect(style.transform).toContain('var(--orbit-rx)')
      expect(style.transform).toContain('var(--orbit-ry)')
      expect(style.transform).toContain('translate(-50%, -50%)')
      expect(style.transform).not.toContain('-0.0000') // noNegZero 管的那个负号
      expect(style.transform).not.toContain('NaN')
      expect(Number(style.opacity)).toBeGreaterThanOrEqual(0)
      expect(Number(style.opacity)).toBeLessThanOrEqual(1)
      expect(style.zIndex).toBeGreaterThan(0)
    }
  })

  it('静止帧的 y 有一张卡带常数项（后半圈那几张靠它上抬），不是全靠 ry', () => {
    const pys = Array.from({ length: N }, (_, i) => {
      const t = restInlineStyle(i, N).transform
      const m = /calc\((-?[\d.]+) \* var\(--orbit-ry\) ([+-]) ([\d.]+)px\)/.exec(t)!
      return m[2] === '-' ? -Number(m[3]) : Number(m[3])
    })
    expect(pys.filter((v) => v !== 0).length).toBeGreaterThan(0)
    // 常数项只来自「后排上抬」那一条：0 ≤ 抬升 ≤ 16px
    for (const v of pys) expect(v).toBeLessThanOrEqual(0)
  })
})

describe('blurFilter —— 量化是性能参数', () => {
  it('量化到 0.25px，最大偏差不超过 0.125px', () => {
    for (let b = 0; b <= 5.2; b += 0.017) {
      const s = blurFilter(b)
      if (s === 'none') {
        expect(b).toBeLessThan(0.125)
        continue
      }
      const q = Number(/blur\(([\d.]+)px\)/.exec(s)![1])
      expect(q % 0.25).toBeCloseTo(0, 10)
      expect(Math.abs(q - b)).toBeLessThanOrEqual(0.125)
    }
  })

  it('没有模糊写 none，不写 blur(0px)（零值滤镜照样开一层渲染面）', () => {
    expect(blurFilter(0)).toBe('none')
    expect(blurFilter(0.1)).toBe('none')
    expect(blurFilter(0.13)).toBe('blur(0.25px)')
    expect(blurFilter(2.499)).toBe('blur(2.50px)')
    expect(blurFilter(3.62)).toBe('blur(3.50px)') // 14.48 → 14 档
    expect(blurFilter(3.7)).toBe('blur(3.75px)') // 14.8 → 15 档
  })
})
