/**
 * children-body.test.ts —— 性别那一栏在**请求边界**上收成什么样（2026-10-16 第 23 刀）
 *
 * ★ 为什么要给这一层写测试：它是这条值**唯一**能挡住"绕过界面的请求"的地方。
 *   界面上性别只能点两个芯片之一，但请求体是外面递进来的——`parseChildBody`
 *   是最后一道。写错的样子很安静：脏值一路传进档案，"男孩/女孩"变成
 *   提示词里一个模型读不懂的词，而界面上看不出任何异常。
 * ★ 它的三条口径与 `domain.ts` 的 `Gender` 是同一件事的三面：
 *   ① 没有这一栏 = 合法（老档案、示例、创作流那一屏）；
 *   ② 有且是 boy/girl = 收；
 *   ③ 有但是别的 = 报一条人话，**不把脏值传下去**。
 */

import { describe, expect, it } from 'vitest'

import { parseChildBody } from './children-body.ts'

function base(): Record<string, unknown> {
  return { name: '小宇', nameReading: 'xiao yu', ageBand: '4-6', lookTags: [], interestTags: [] }
}

describe('parseChildBody · 性别（第 23 刀）', () => {
  it('两档都收，原样读出来', () => {
    expect(parseChildBody({ ...base(), gender: 'girl' }).body?.gender).toBe('girl')
    expect(parseChildBody({ ...base(), gender: 'boy' }).body?.gender).toBe('boy')
  })

  it('★ 没有这一栏是**合法**的，而且不算问题（老档案与示例就是这样）', () => {
    const { body, problems } = parseChildBody(base())
    expect(problems).toEqual([])
    expect(Object.hasOwn(body ?? {}, 'gender')).toBe(false)
    // 空串也是"没选"（表单里没点过任何芯片、或者点了但它被清掉）
    expect(Object.hasOwn(parseChildBody({ ...base(), gender: '' }).body ?? {}, 'gender')).toBe(
      false,
    )
    // null / 数字 / 对象都不是"选了一档"——一律当没这一栏，不抛
    for (const value of [null, 0, {}, []]) {
      const parsed = parseChildBody({ ...base(), gender: value })
      expect(parsed.problems).toEqual([])
      expect(Object.hasOwn(parsed.body ?? {}, 'gender')).toBe(false)
    }
  })

  it('★ 写了但不在那两档里：报一条人话，而且**不许把脏值传下去**', () => {
    const { body, problems } = parseChildBody({ ...base(), gender: '男孩' })
    expect(problems).toEqual(['性别只认「boy」或「girl」'])
    // 这一条是重点：问题清单非空时 `body` 是 undefined，
    // 于是"脏值灌进档案"这件事在这个形状下**做不到**
    expect(body).toBeUndefined()
  })
})
