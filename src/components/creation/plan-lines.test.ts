/**
 * plan-lines.test.ts —— 「正在编故事」那几句的两条纪律
 *
 * 钉住的是两件会被后人顺手破坏、而**屏幕上不会当场显形**的事：
 *   ① 那几句里不许出现数字、百分号、页码——编故事这一趟一次性回包，
 *      我们**没有**任何进度可报，写了就是编（README §五 那条："编出来的东西比没有更糟"）；
 *   ② 四句话都要说得出"这件活在做什么"，不能退化成第二句"正在编故事"。
 *      那种退化在屏幕上不显形（轮播照转），但它把这一处改动的理由整个抹掉了。
 */

import { describe, expect, it } from 'vitest'

import { PLAN_LINES } from './plan-lines.ts'

describe('编故事那一段轮播的话', () => {
  it('★ 一句都不许带数字、百分号、页码（这一趟没有进度可报）', () => {
    for (const line of PLAN_LINES) {
      expect(line).not.toMatch(/[0-9%]/)
      expect(line).not.toMatch(/第\s*.+页/)
      expect(line).not.toMatch(/还剩|剩余|马上|秒/)
    }
  })

  it('四句各不相同，而且不是同一句换皮（每句都说了"在做哪一件事"）', () => {
    expect(new Set(PLAN_LINES).size).toBe(PLAN_LINES.length)
    expect(PLAN_LINES.length).toBeGreaterThanOrEqual(3)
    for (const line of PLAN_LINES) {
      expect(line.trim().length).toBeGreaterThan(4)
      expect(line.startsWith('正在') || line.startsWith('还在')).toBe(true)
    }
  })
})
