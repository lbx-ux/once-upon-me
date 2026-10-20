import { describe, expect, it } from 'vitest'

import { clamp, lerp, noNegZero, smoothstep } from './math'

/**
 * lib/math.ts 的测试
 *
 * 期望值全部来自手算的独立来源（S 曲线的定义、README 里写死的那条推导），
 * 不用被测代码自己再算一遍来当期望值 —— 那是同义反复，永远绿，也永远查不出东西。
 */

describe('clamp', () => {
  it('区间内原样返回', () => {
    expect(clamp(0.37)).toBe(0.37)
  })

  it('默认夹到 [0, 1]', () => {
    expect(clamp(-4.2)).toBe(0)
    expect(clamp(9)).toBe(1)
  })

  it('可以指定上下界', () => {
    expect(clamp(-30, -1, 1)).toBe(-1)
    expect(clamp(30, -1, 1)).toBe(1)
    expect(clamp(0.5, -1, 1)).toBe(0.5)
  })
})

describe('smoothstep', () => {
  it('两个端点分别是 0 与 1', () => {
    expect(smoothstep(0, 1, 0)).toBe(0)
    expect(smoothstep(0, 1, 1)).toBe(1)
  })

  it('中点是 0.5（S 曲线的定义）', () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5)
  })

  it('中点之前比线性慢，之后比线性快', () => {
    // 手算：3t² − 2t³，t=0.25 → 3(0.0625) − 2(0.015625) = 0.15625
    expect(smoothstep(0, 1, 0.25)).toBeCloseTo(0.15625, 5)
    // t=0.75 → 3(0.5625) − 2(0.421875) = 0.84375
    expect(smoothstep(0, 1, 0.75)).toBeCloseTo(0.84375, 5)
  })

  it('区间外饱和，不外推', () => {
    expect(smoothstep(2, 4, -100)).toBe(0)
    expect(smoothstep(2, 4, 100)).toBe(1)
  })

  it('★ 复现 README 交接段那条推导：p=.45 时正好走过半程', () => {
    // hero-orbit.css §5 与 HeroOrbit 的 HANDOFF_START 全靠这个等式咬合：
    // smoothstep(.06, .84, p) = .50 的解是 p = .45。
    // 这条测试钉的是文档里写着的数，不是实现细节。
    expect(smoothstep(0.06, 0.84, 0.45)).toBeCloseTo(0.5, 10)
  })

  it('退化区间（上下界相同）不返回 NaN', () => {
    // 这是本模块相对 HeroOrbit 里那份手抄版本唯一的行为差别：
    // 那一份在 edge0 === edge1 时算 0/0，返回 NaN，NaN 一路传染到 opacity。
    // 现有调用点从不传退化区间，所以那不是 bug；但共用函数不该留这个坑。
    expect(smoothstep(1, 1, 0.5)).toBe(0)
    expect(smoothstep(1, 1, 1)).toBe(1)
    expect(smoothstep(1, 1, 2)).toBe(1)
  })
})

describe('lerp', () => {
  it('两端与中点', () => {
    expect(lerp(-1, 1, 0)).toBe(-1)
    expect(lerp(-1, 1, 1)).toBe(1)
    expect(lerp(-1, 1, 0.5)).toBe(0)
  })
  it('把归一化位置映射回像素（tilt 的输出就是这么用的）', () => {
    expect(lerp(0, 400, 300 / 400)).toBe(300)
    // 越界不外推
    expect(clamp(lerp(-1, 1, 4), -1, 1)).toBe(1)
  })
})

describe('noNegZero', () => {
  it('-0 变 +0，其余原样', () => {
    // 抓到的是 tilt 那边的一条真失败：-0 经 toFixed 变成字符串 "-0.00"，
    // 于是 rotateY(-0deg) 与 rotateY(0deg) 数值等价、字符串不等价，
    // 靠字符串去重的 CSS 变量写入会每帧白写一次。
    expect(Object.is(noNegZero(-0), 0)).toBe(true)
    expect(Object.is(noNegZero(0), 0)).toBe(true)
    expect(noNegZero(-6.5)).toBe(-6.5)
    expect(noNegZero(3)).toBe(3)
  })

  it('负号取反这类运算确实会产出 -0（所以这个函数不是想象出来的问题）', () => {
    expect(Object.is(-1 * 0, -0)).toBe(true)
    expect(Object.is(-1 * 0, 0)).toBe(false)
  })
})
