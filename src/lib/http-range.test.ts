import { describe, expect, it } from 'vitest'

import { parseRange } from './http-range.ts'

/**
 * `Range` 的解析。★ 这一组用例全部对应 `http-range.ts` 文件头那张表——
 * 表里每一行都至少有一条，因为"解析对了但回错状态码"与"解析错了"在屏幕上
 * 是同一种症状：播放器拖不动、或者干脆 416。
 */
describe('parseRange', () => {
  it('没有 Range 就发整份', () => {
    expect(parseRange(null, 1000)).toBeNull()
  })

  it('认三种正常的写法', () => {
    // 两端都给
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    // 只给开头 = 一直到末尾
    expect(parseRange('bytes=100-', 1000)).toEqual({ start: 100, end: 999 })
    // 后缀式：浏览器取 mp3 末尾就是发这个（时长靠它算出来）
    expect(parseRange('bytes=-500', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('末尾超过文件长度就收到最后一个字节（不是 416）', () => {
    expect(parseRange('bytes=900-2000', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('后缀比文件还长 = 整份', () => {
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('落在文件之外才是 416', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=2000-3000', 1000)).toBe('unsatisfiable')
    // `bytes=-0` 要的是"最后 0 字节"，那等于要不到
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable')
    // 空文件上任何一段都要不到（也要防 `size - 1` 变成 -1）
    expect(parseRange('bytes=-100', 0)).toBe('unsatisfiable')
  })

  it('认不出或不成立的 Range 一律忽略（回整份，不是 416）', () => {
    // 单位不是 bytes
    expect(parseRange('items=0-10', 1000)).toBeNull()
    // 多段：这里没有消费者，回整份是规范允许的
    expect(parseRange('bytes=0-1,4-5', 1000)).toBeNull()
    // 末尾在开头之前
    expect(parseRange('bytes=500-100', 1000)).toBeNull()
    // 垃圾
    expect(parseRange('bytes=abc', 1000)).toBeNull()
    expect(parseRange('bytes=-', 1000)).toBeNull()
    expect(parseRange('', 1000)).toBeNull()
  })

  it('大小写与空格不影响', () => {
    expect(parseRange('BYTES=0-9', 1000)).toEqual({ start: 0, end: 9 })
    expect(parseRange('  bytes=0-9  ', 1000)).toEqual({ start: 0, end: 9 })
  })

  it('一个字节的边界：start === end 是可用的', () => {
    // 单字节请求是最容易写错的那种：`end + 1` 与 `end` 混了就是空响应
    expect(parseRange('bytes=999-999', 1000)).toEqual({ start: 999, end: 999 })
    expect(parseRange('bytes=-1', 1000)).toEqual({ start: 999, end: 999 })
  })
})
