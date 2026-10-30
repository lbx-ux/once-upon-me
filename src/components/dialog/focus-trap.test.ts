import { describe, expect, it } from 'vitest'

import { wrapTabIndex } from './focus-trap'

/**
 * focus-trap.ts 的测试 —— 只测纯的那一半（`focusablesIn` 要 DOM，node 里没有）。
 *
 * 期望值全部来自"Tab 在浏览器里本来怎么走"，不是从实现反推：
 * 表单一头一尾要绕回来，中间交给浏览器，空面板留在原地。
 */

describe('wrapTabIndex', () => {
  it('列表为空时不接（浏览器会把焦点移出模态，所以调用方另判）', () => {
    expect(wrapTabIndex(0, -1, false)).toBeNull()
    expect(wrapTabIndex(0, 0, true)).toBeNull()
  })

  it('焦点在面板自己身上：Tab 去第一个，Shift+Tab 去最后一个', () => {
    expect(wrapTabIndex(3, -1, false)).toBe(0)
    expect(wrapTabIndex(3, -1, true)).toBe(2)
  })

  it('末尾再 Tab：绕回第一个', () => {
    expect(wrapTabIndex(3, 2, false)).toBe(0)
  })

  it('头上 Shift+Tab：绕到最后一个', () => {
    expect(wrapTabIndex(3, 0, true)).toBe(2)
  })

  it('中间交给浏览器（返回 null 才是不抢的那一半）', () => {
    expect(wrapTabIndex(3, 1, false)).toBeNull()
    expect(wrapTabIndex(3, 1, true)).toBeNull()
    expect(wrapTabIndex(3, 0, false)).toBeNull()
    expect(wrapTabIndex(3, 2, true)).toBeNull()
  })

  it('只有一个可聚焦元素时，两个方向都留在它身上', () => {
    expect(wrapTabIndex(1, 0, false)).toBe(0)
    expect(wrapTabIndex(1, 0, true)).toBe(0)
  })
})
