/**
 * events.test.ts —— `describeEvent` 的**页号约定**
 *
 * 这个函数是界面上每一句话的唯一来源（引擎侧写一次，MCP / 日志 / 过程面板共用），
 * 所以它吐出来的字符串就是用户看到的东西。
 *
 * ★ 盯的是 2026-10-15 加封面时冒出来的那件事：封面事件走的是同一条通道，
 *   但封面没有页号。如果直接拿 `pageNo` 拼字符串，过程面板会出现"**第 0 页**画好了"——
 *   那句在界面上是噪音，还会让人以为页号从 0 开始数。
 *   所以 `pageNo === 0` 是一个**约定**（0 = 封面），这里把它钉住。
 */

import { describe, expect, it } from 'vitest'

import { describeEvent } from './events.ts'
import type { EngineEvent } from './events.ts'

function shown(event: Record<string, unknown>): string {
  return describeEvent({ stage: 'illustrating', ...event } as unknown as EngineEvent)
}

describe('describeEvent 的页号', () => {
  it('★ pageNo: 0 说"封面"，不说"第 0 页"', () => {
    const text = shown({
      kind: 'illustration',
      pageNo: 0,
      attempt: 1,
      assetPath: 'x',
      modelId: 'm',
    })
    expect(text).toBe('封面画好了')
    expect(text).not.toContain('第 0 页')
  })

  it('正常页号仍然是"第 N 页"', () => {
    expect(
      shown({ kind: 'illustration', pageNo: 7, attempt: 1, assetPath: 'x', modelId: 'm' }),
    ).toBe('第 7 页画好了')
  })

  it('没有页号的事件（规划、完成）不被塞进一个空壳页号', () => {
    const text = describeEvent({
      kind: 'plan-ready',
      stage: 'planning',
      form: 'solo',
      title: '云朵小船去旅行',
      nodeCount: 20,
      choicePages: [],
    } as unknown as EngineEvent)
    expect(text).toBe('故事编好了：《云朵小船去旅行》，20 页')
  })
})
