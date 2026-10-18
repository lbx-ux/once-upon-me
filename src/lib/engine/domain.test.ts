/**
 * domain.test.ts —— 那几张**枚举表**自己的判据
 *
 * ★ 这里钉的不是业务逻辑，是**"加了一个值却忘了另一处"**这一类坏法——
 *   它在屏幕上不报错，只是少一个名字、或者多一行空白。
 *   （同一类判据的先例：`story-problems.test.ts` 拿 `planJsonSchema()` 逐个核对
 *   `CHOICE_CELLS`——那种约定"只写在注释里一定会有人违反它"。）
 */

import { describe, expect, it } from 'vitest'

import { CHOICE_ICON_LABELS, CHOICE_ICONS } from './domain.ts'

describe('CHOICE_ICON_LABELS —— 词表里每一枚都有个中文名', () => {
  it('★ 一个都不少（少一个 = 闸门那个下拉框里多一行空白）', () => {
    for (const key of CHOICE_ICONS) {
      expect(CHOICE_ICON_LABELS[key]?.trim()).toBeTruthy()
    }
  })

  it('★ 也不多（多一个 = 名字留在一个已经删掉的 key 上，下一刀又会把它读成"还在用"）', () => {
    expect(Object.keys(CHOICE_ICON_LABELS).sort()).toEqual([...CHOICE_ICONS].sort())
  })

  it('名字互不相同（两个 key 同一个中文名，下拉框里就分不出选的是哪一个）', () => {
    const names = Object.values(CHOICE_ICON_LABELS)
    expect(new Set(names).size).toBe(names.length)
  })

  it('名字里不带 emoji 与括号（emoji 是另一个真字段，摆在这一格的左边）', () => {
    for (const name of Object.values(CHOICE_ICON_LABELS)) {
      expect(name).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
      expect(name).not.toMatch(/[（(]/)
    }
  })
})
