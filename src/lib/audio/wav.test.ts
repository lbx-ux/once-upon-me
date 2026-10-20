/**
 * audio/wav.test.ts —— 那 44 个字节逐字段钉住
 *
 * 为什么值得这么细：RIFF 的 chunk 长度写错（写成整个文件的长度）时，
 *   Chrome 与 ffmpeg 都照样能放，只有厂商那边会 400，而那时候我们已经
 *   把一段语音发出去了。所以这里断言的是一份能被别家读的字节，不是"我们的播放器能放"。
 */

import { describe, expect, it } from 'vitest'

import { encodeWav } from './wav.ts'

const text = (view: DataView, offset: number, length: number): string =>
  Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('')

describe('encodeWav', () => {
  it('头 44 字节逐字段对（1 秒 16kHz 单声道）', () => {
    const samples = new Float32Array(16_000)
    const bytes = encodeWav(samples, 16_000)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    expect(bytes.byteLength).toBe(44 + 16_000 * 2)
    expect(text(view, 0, 4)).toBe('RIFF')
    // 36 + 数据长度，不是整个文件的长度
    expect(view.getUint32(4, true)).toBe(36 + 32_000)
    expect(text(view, 8, 4)).toBe('WAVE')
    expect(text(view, 12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // 单声道
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(28, true)).toBe(32_000) // 采样率 × 2
    expect(view.getUint16(32, true)).toBe(2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(text(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(32_000)
  })

  it('样本落成 16bit 定点：0 → 0，±1 → 两头占满', () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16_000)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(32767)
    expect(view.getInt16(48, true)).toBe(-32768)
    expect(view.getInt16(50, true)).toBe(16384)
  })

  it('★ 越界的样本被钳住，不绕回反面（+1.2 不许变成 -0.8）', () => {
    const bytes = encodeWav(new Float32Array([1.2, -1.7]), 16_000)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
  })

  it('空输入也是一份合法的空 WAV（44 字节头，数据长度 0）', () => {
    const bytes = encodeWav(new Float32Array(0), 16_000)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(bytes.byteLength).toBe(44)
    expect(view.getUint32(4, true)).toBe(36)
    expect(view.getUint32(40, true)).toBe(0)
  })
})

describe('sampleProblem', () => {
  it('越界的拦、为宜的只提醒、中间的放行', async () => {
    const { sampleProblem } = await import('./capture.ts')
    expect(sampleProblem(1_000)?.level).toBe('block')
    expect(sampleProblem(61_000)?.level).toBe('block')
    expect(sampleProblem(5_000)?.level).toBe('warn')
    expect(sampleProblem(35_000)?.level).toBe('warn')
    expect(sampleProblem(15_000)).toBeNull()
    // 边界：卡在 3 秒上不算"太短"（不拦），但仍然偏短（提醒）。
    //   写成"3 秒就通过且不说话"会让一个刚够格但明显偏短的样本悄悄过掉
    expect(sampleProblem(3_000)?.level).toBe('warn')
    expect(sampleProblem(2_999)?.level).toBe('block')
  })
})
