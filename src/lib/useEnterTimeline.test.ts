/**
 * useEnterTimeline.test.ts —— 进场时间线的**纯数据**那部分
 *
 * ★ 这个文件刻意不测 `useEnterTimeline` 本身：它要 DOM、要 rAF、要 GSAP 的 ticking，
 *   而仓库里 vitest 跑的是 node 环境（没有 jsdom）。为它拉一套 jsdom，
 *   换来的是一份"动画确实动过"的断言——那句话在真机上用眼睛一眼就能看，
 *   而 jsdom 里过了的动画在真机上照样可能是坏的（它不渲染、不合成、不算帧）。
 *   所以测的是**能断言的那部分**：那条时间线的形状。
 *
 * ★ 形状为什么值得钉：这三件事坏了，界面上都只是"有点怪"，没有异常——
 *   1. `staggerFor` 退回常数 → 12 张主题卡各 35ms = 385ms 的尾巴，
 *      整页早就就位了它还在慢慢往外冒（首页轮播那条"像页面卡住了"是同一类）；
 *   2. `ENTER_STEPS` 的 `at` 不再递增 → 层级没了，所有东西挤在一起同时出现；
 *   3. 两条步骤用了同一个选择器 → 同一个元素被两条 `from()` 先后设置起点，
 *      结果由 GSAP 的解析顺序决定，改一行顺序就换一个画面。
 */

import { describe, expect, it } from 'vitest'

import {
  ARRIVAL_AT,
  ARRIVAL_DURATION,
  ENTER_STEPS,
  STAGGER_BUDGET,
  STAGGER_CAP,
  staggerFor,
} from './useEnterTimeline.ts'

describe('交错间隔 staggerFor', () => {
  it('零项与一项不交错：0', () => {
    expect(staggerFor(0)).toBe(0)
    expect(staggerFor(1)).toBe(0)
  })

  it('上限档以内是固定的 35ms', () => {
    for (let n = 2; n <= STAGGER_CAP; n++) {
      expect(staggerFor(n), `${n} 项`).toBeCloseTo(0.035, 6)
    }
  })

  it('★ 超过上限档之后，最后一项的**开始**时间被压在预算内', () => {
    // 这一条就是"为什么它不是常数"的全部理由，也覆盖了真实的 12 张主题墙
    for (const n of [STAGGER_CAP + 1, 12, 24, 60]) {
      const lastStartsAt = staggerFor(n) * (n - 1)
      expect(lastStartsAt, `${n} 项时最后一项在 ${lastStartsAt}s 才出现`).toBeLessThanOrEqual(
        STAGGER_BUDGET + 1e-9,
      )
    }
    // 12 项正好是主题墙：压在预算上，不早太多也不晚
    expect(staggerFor(12) * 11).toBeCloseTo(STAGGER_BUDGET, 6)
  })

  it('间隔随项数单调不增——跨过上限档那一步不许往上跳', () => {
    // ★ 从 2 项起算，不是从 1。1 项返回 0 是**刻意**的"没什么可交错"，
    //   把它拉进这条单调性里就是断言写错了（第一次跑就是这么红的：
    //   红了不等于代码错了，先看断言讲的是什么）
    let prev = staggerFor(2)
    for (let n = 3; n <= 40; n++) {
      const now = staggerFor(n)
      expect(now, `${n} 项的间隔 ${now} 比 ${n - 1} 项的 ${prev} 还大`).toBeLessThanOrEqual(prev)
      prev = now
    }
  })
})

describe('时间线形状 ENTER_STEPS', () => {
  it('起点时间非递减：顺序即层级', () => {
    for (let i = 1; i < ENTER_STEPS.length; i++) {
      const prev = ENTER_STEPS[i - 1]!
      const step = ENTER_STEPS[i]!
      expect(
        step.at,
        `第 ${i + 1} 条 (${step.sel}) 早于上一条 (${prev.sel})`,
      ).toBeGreaterThanOrEqual(prev.at)
    }
  })

  it('选择器互不重复，且每条都真的选得到东西（非空字符串）', () => {
    const sels = ENTER_STEPS.map((s) => s.sel)
    expect(new Set(sels).size).toBe(sels.length)
    for (const sel of sels) expect(sel.trim().length).toBeGreaterThan(0)
  })

  it('时长与位移都在"看得见但不等"的范围内', () => {
    for (const step of ENTER_STEPS) {
      expect(step.duration, `${step.sel} 的时长`).toBeGreaterThan(0)
      expect(step.duration).toBeLessThanOrEqual(0.8)
      // 位移是"从下面一点点浮上来"，不是一个飞入。超过 24px 就成了另一种语言
      expect(Math.abs(step.from.y)).toBeLessThanOrEqual(24)
      expect(step.from.opacity).toBe(0)
    }
  })

  it('★ 整场进场在一秒出头收完（12 张卡的尾巴也算进去）', () => {
    const wall = ENTER_STEPS[ENTER_STEPS.length - 1]
    expect(wall?.stagger, '最后一条应当是那批交错的（主题墙）').toBeTypeOf('function')
    const n = 12
    const endsAt = (wall?.at ?? 0) + (wall?.duration ?? 0) + staggerFor(n) * (n - 1)
    expect(endsAt).toBeLessThanOrEqual(1.2)
  })

  it('两笔手绘装饰排在最前（它们最先"被画出来"）', () => {
    expect(ENTER_STEPS[0]?.sel).toBe('.cl__doodle')
    expect(ENTER_STEPS[0]?.at).toBe(0)
  })
})

describe('接力那一步（从首页环上飞回来的那 12 张）', () => {
  it('★ 从 0 起跳，不是排在最后那一步的 0.42', () => {
    // 这 12 张在切页那一刻**已经在屏幕上**了（就在刚才那个位置）。让它们原地等到
    // 0.42s 再起飞，看起来就是"环突然停住半秒"——环是转的，停住就穿帮。
    expect(ARRIVAL_AT).toBe(0)
    const wall = ENTER_STEPS[ENTER_STEPS.length - 1]
    expect(wall?.sel).toBe('.cl__wall li') // 接的必须是那一步（按选择器对上）
    expect(ARRIVAL_AT).toBeLessThan(wall?.at ?? 0)
  })

  it('★ 整场仍然收在一秒出头：0.62 + 12 项的错峰尾巴 = 0.90s', () => {
    const n = 12
    const endsAt = ARRIVAL_AT + ARRIVAL_DURATION + staggerFor(n) * (n - 1)
    expect(endsAt).toBeLessThanOrEqual(1.2)
    // 它比默认那一步（0.4s）长，是因为要走几百像素：不是随手放长的
    const wall = ENTER_STEPS[ENTER_STEPS.length - 1]
    expect(ARRIVAL_DURATION).toBeGreaterThan(wall?.duration ?? 0)
  })
})
