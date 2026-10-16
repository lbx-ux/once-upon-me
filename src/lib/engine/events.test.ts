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

import { createEventFactory, describeEvent, maxSeqOf } from './events.ts'
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

/**
 * ★ 序号接续（工单 01 §3.2）。
 *
 * 单页重做是往**同一个** `events.jsonl` **追加**的（整本那一轮开始时才 truncate），
 * 所以整本跑完（`seq` 到 19）、再重画第 3 页时，那一批事件的序号必须从 20 接上去。
 * 从 1 重来的话日志里会出现两条 `seq: 1`——而 `seq` 正是
 * "重放能重建同一串界面状态"与"断线重连后对齐"的依据。
 */
describe('事件序号：单页重做要接着数', () => {
  it('从 startSeq 接上去，不漏号也不撞', () => {
    const emit = createEventFactory(() => 1, 19)
    expect(emit({ kind: 'stage', stage: 'illustrating', phase: 'begin', pageNo: 3 }).seq).toBe(20)
    expect(emit({ kind: 'stage', stage: 'illustrating', phase: 'begin', pageNo: 3 }).seq).toBe(21)
  })

  it('缺省仍然从 1 起（整本那一轮一个字都没改）', () => {
    expect(createEventFactory(() => 1)({ kind: 'stage', phase: 'begin' }).seq).toBe(1)
  })

  it('★ `maxSeqOf` 对空的一串给 0，不是 -Infinity', () => {
    // 调用点自己写 Math.max(...events.map(...)) 的话，空数组拿到的是 -Infinity，
    // 而那个值会让下一条事件得到一个负号——屏幕上不会有任何东西提示这件事
    expect(maxSeqOf([])).toBe(0)
    expect(maxSeqOf([{ seq: 4 } as never, { seq: 19 } as never, { seq: 7 } as never])).toBe(19)
  })
})
