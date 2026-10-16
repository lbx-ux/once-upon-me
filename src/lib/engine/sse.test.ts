/**
 * sse.test.ts —— 帧编解码的往返与**分块边界**（后者才是这个模块唯一的难点）
 *
 * 测的三件事，各自对应一次会真出现的事故：
 *   1. 分块从一帧中间切开（网络不按帧边界给你）→ 半个 JSON 被解出来，界面上冒一条坏事件
 *   2. 多行载荷往返（`reason` 字段带换行）→ 丢了换行，重试原因在界面上连成一句
 *   3. 只带 `event:` 不带 `data:` 的块 → 保活心跳被当成一条空事件
 */

import { describe, expect, it } from 'vitest'
import { createSseDecoder, decodeFrames, encodeFrame } from './sse.ts'

describe('encodeFrame / decodeFrames', () => {
  it('往返保持 event 与 data 不变', () => {
    const frame = { event: 'engine', data: '{"seq":1}' }
    expect(decodeFrames(encodeFrame(frame))).toEqual([frame])
  })

  it('多行 data 拼回来时换行还在', () => {
    const frame = { event: 'engine', data: '第一行\n第二行\n第三行' }
    const back = decodeFrames(encodeFrame(frame))
    expect(back).toHaveLength(1)
    expect(back[0]?.data).toBe(frame.data)
  })

  it('载荷里的换行不会把一帧拆成两帧', () => {
    // 这条是上一条的反面：如果编码时直接写 `data: ${frame.data}`，
    // 第二行会变成裸文本行，解码端按字段名解析不出来，于是这一段被静默吃掉
    const frames = decodeFrames(encodeFrame({ event: 'e', data: 'a\n\nb' }))
    expect(frames).toHaveLength(1)
    expect(frames[0]?.data).toBe('a\n\nb')
  })

  it('id 有才写，没有就不写', () => {
    expect(encodeFrame({ event: 'e', data: 'x' })).toBe('event: e\ndata: x\n\n')
    expect(encodeFrame({ event: 'e', data: 'x', id: '7' })).toBe('id: 7\nevent: e\ndata: x\n\n')
  })
})

describe('createSseDecoder 的分块边界', () => {
  it('一帧被切成三个 chunk 也要解出同一帧', () => {
    const text = encodeFrame({ event: 'engine', data: '{"a":1}' })
    const decoder = createSseDecoder()
    const out = [
      ...decoder.push(text.slice(0, 3)),
      ...decoder.push(text.slice(3, 11)),
      ...decoder.push(text.slice(11)),
    ]
    expect(out).toEqual([{ event: 'engine', data: '{"a":1}', id: undefined }])
  })

  it('一个 chunk 里有多帧，一次全解出来', () => {
    const text = encodeFrame({ event: 'e', data: '1' }) + encodeFrame({ event: 'e', data: '2' })
    expect(decodeFrames(text).map((f) => f.data)).toEqual(['1', '2'])
  })

  it('逐字节喂进去也不丢帧', () => {
    const text =
      encodeFrame({ event: 'e', data: '中文载荷' }) + encodeFrame({ event: 'e', data: '2' })
    const decoder = createSseDecoder()
    const out = [...text].flatMap((ch) => decoder.push(ch))
    expect(out.map((f) => f.data)).toEqual(['中文载荷', '2'])
  })

  it('CRLF 也认（有的代理会把行尾改掉）', () => {
    expect(decodeFrames('event: e\r\ndata: x\r\n\r\n')).toEqual([
      { event: 'e', data: 'x', id: undefined },
    ])
  })

  it('多行 data 在分块中间切开也拼得对', () => {
    const text = encodeFrame({ event: 'e', data: 'a\nb' })
    const decoder = createSseDecoder()
    const cut = text.indexOf('\n', text.indexOf('data: a')) + 1
    const out = [...decoder.push(text.slice(0, cut)), ...decoder.push(text.slice(cut))]
    expect(out).toEqual([{ event: 'e', data: 'a\nb', id: undefined }])
  })
})

describe('不该产出帧的三种块', () => {
  it('注释行整行忽略，不产生事件', () => {
    expect(decodeFrames(': keep-alive\n\n')).toEqual([])
  })

  it('只带 event: 不带 data: 的块丢掉', () => {
    // 规范原话：data buffer 为空时不派发。漏了这条，`event: engine\n\n` 会变成空事件
    expect(decodeFrames('event: engine\n\n')).toEqual([])
  })

  it('半帧留在缓冲里，不产出', () => {
    const decoder = createSseDecoder()
    expect(decoder.push('event: e\ndata: {"a"')).toEqual([])
    expect(decoder.push(':1}\n\n')).toEqual([{ event: 'e', data: '{"a":1}', id: undefined }])
  })

  it('没有 event: 的帧按规范用 message 兜底', () => {
    expect(decodeFrames('data: x\n\n')).toEqual([{ event: 'message', data: 'x', id: undefined }])
  })
})

/**
 * `flush()` —— 流结束时把缓冲里的最后半行交出来。
 *
 * ★ 它存在的理由是一次具体的截断：网关发完最后一帧就关连接、不补那个空行时，
 *   严格按规范那一帧不算数，正文会**安静地少一截**（没有错误、没有日志）。
 *   `providers/http.ts` 的 `requestSse` 在 EOF 时调它，就是为了这一段。
 */
describe('createSseDecoder 的 flush（流结束）', () => {
  it('★ 结尾没有空行的那一帧也交出来', () => {
    const decoder = createSseDecoder()
    expect(decoder.push('data: {"a":1}\n\ndata: {"b":2}')).toEqual([
      { event: 'message', data: '{"a":1}', id: undefined },
    ])
    expect(decoder.flush()).toEqual([{ event: 'message', data: '{"b":2}', id: undefined }])
  })

  it('已经分帧发出去的不会因为 flush 再来一遍', () => {
    const decoder = createSseDecoder()
    expect(decoder.push('data: x\n\n')).toHaveLength(1)
    expect(decoder.flush()).toEqual([])
    expect(decoder.flush()).toEqual([])
  })

  it('空缓冲 flush 出空数组（不是一条空事件）', () => {
    expect(createSseDecoder().flush()).toEqual([])
    // 只带注释的尾巴同样什么都不产出
    const decoder = createSseDecoder()
    decoder.push(': 心跳')
    expect(decoder.flush()).toEqual([])
  })

  it('CRLF 的尾巴也认', () => {
    const decoder = createSseDecoder()
    decoder.push('data: x\r')
    expect(decoder.flush()).toEqual([{ event: 'message', data: 'x', id: undefined }])
  })
})
