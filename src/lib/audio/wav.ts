/**
 * lib/audio/wav.ts —— 把一串浮点样本写成 WAV（16bit PCM、单声道）
 *
 * 为什么自己写这 44 个字节，而不是找一个库：我们要的格式是厂商文档写死的那一种
 * （WAV 16bit），而浏览器自己产不出 WAV——`MediaRecorder` 给的是 webm/opus，
 * 厂商不收（见 `engine/providers/qwen-speech.ts` 的 `SAMPLE_MIMES`）。
 * 一个几十行的写头函数比起引一个转码库，少一个依赖、也看得清每一个字节是谁。
 *
 * 三条容易写错的地方，都在下面标出来了：
 *   1. RIFF 的 chunk 长度是从 `WAVE` 之后算起的字节数（= 36 + 数据长度），
 *      写成总长度是常见的错，多数播放器还照样能放——所以测试里逐字段断言；
 *   2. 16bit 定点要先钳到 [-1, 1] 再乘 32767，不然爆音的样本会绕回反面；
 *   3. 小端。WAV 是小端格式，而 JS 有 `DataView` 的 `littleEndian` 参数兜住这件事。
 */

/** 一律小端。★ 每次显式传 true，不依赖"默认是小端"这种记忆 */
const LITTLE_ENDIAN = true

/** 浮点样本 [-1,1] → 16bit 定点。越界钳制（解码/重采样都可能给出略微越界的值） */
function toPcm16(sample: number): number {
  const clamped = sample > 1 ? 1 : sample < -1 ? -1 : sample
  // 负半轴用 32768、正半轴用 32767：这样 -1 与 +1 各占满一头，不会在 +1 处溢出
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
}

/**
 * 单声道 WAV 字节。
 *
 * @param samples     -1..1 的浮点样本（单声道）
 * @param sampleRate  写进头的采样率。★ 它与 samples 的实际采样率必须一致——
 *                    重采样是调用方（`capture.ts`）的事，这里只管写
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  // 第 1 条：36 + 数据长度，不是整个文件的长度
  view.setUint32(4, 36 + dataBytes, LITTLE_ENDIAN)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, LITTLE_ENDIAN) // fmt chunk 固定 16 字节（PCM）
  view.setUint16(20, 1, LITTLE_ENDIAN) // 1 = PCM
  view.setUint16(22, 1, LITTLE_ENDIAN) // 单声道
  view.setUint32(24, sampleRate, LITTLE_ENDIAN)
  view.setUint32(28, sampleRate * 2, LITTLE_ENDIAN) // 每秒字节数 = 采样率 × 声道 × 位深/8
  view.setUint16(32, 2, LITTLE_ENDIAN) // 每帧字节数
  view.setUint16(34, 16, LITTLE_ENDIAN) // 位深
  ascii(36, 'data')
  view.setUint32(40, dataBytes, LITTLE_ENDIAN)

  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(44 + i * 2, toPcm16(samples[i] ?? 0), LITTLE_ENDIAN)
  }
  return new Uint8Array(buffer)
}
