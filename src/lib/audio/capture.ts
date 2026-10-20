/**
 * lib/audio/capture.ts —— 录到/选到的音频 → 厂商收得下的样本
 *
 * 一条流水线，两个入口（录音、选文件）：解码 → 重采样成 16kHz 单声道 → 写 WAV。
 * 为什么要过这一趟，见 `wav.ts` 的文件头（一句话：浏览器产不出 WAV，厂商不收 webm）。
 *
 * 这一层是唯一能判"这段够不够、长不长"的地方：适配器里没有解码器
 *   （`qwen-speech.ts` 那段注释写着"推荐 10–20 秒、最长 60 秒"这条约束落在采集的界面上）。
 *   所以 `sampleProblem()` 是这一层的公开判据，界面直接拿它说话。
 *
 * 这一层不碰任何存储：出来的字节只在内存里走一趟请求体，然后就没有然后了
 *   （§8.3：样本拿到 voice_id 后立即删——我们的版本是"从不上传以外的任何地方"）。
 */

import { encodeWav } from './wav.ts'

/** 送进 TTS 的采样率。文档要求 ≥16kHz，取 16k：单声道 16k 的 20 秒 ≈ 640KB */
export const SAMPLE_RATE = 16000

/** 厂商收的容器。★ 与我们发出去的那一种（WAV）不必一一对应：选进来的 mp3/m4a 也走这条流水线 */
export const SAMPLE_MIME = 'audio/wav'

/** 太短生成出来不像本人；太长浪费（厂商上限 60 秒） */
const TOO_SHORT_MS = 3_000
const IDEAL_MIN_MS = 10_000
const IDEAL_MAX_MS = 20_000
const TOO_LONG_MS = 60_000

export type Sample = {
  /** 类型写成 `Uint8Array<ArrayBuffer>` 而不是裸的 `Uint8Array`：
   *  它要能直接塞进 `new Blob([...])`（`BlobPart` 只收 `ArrayBufferView<ArrayBuffer>`），
   *  而裸类型在 TS 眼里可能由 `SharedArrayBuffer` 撑着
   */
  bytes: Uint8Array<ArrayBuffer>
  mime: string
  durationMs: number
}

export type SampleProblem = {
  /** `block` 不许往下走；`warn` 放行但要说一句 */
  level: 'block' | 'warn'
  message: string
}

/**
 * 这一段能不能用来做音色。★ 分两档而不是一刀切：越界才拦（短到 3 秒以下、
 * 长过 60 秒），10–20 秒只是"为宜"——把"为宜"做成硬门槛，会让一个录了 25 秒的家长
 * 反复重录，而多录的 5 秒一点问题都没有。
 */
export function sampleProblem(durationMs: number): SampleProblem | null {
  if (durationMs < TOO_SHORT_MS) {
    return { level: 'block', message: `太短了（${fmt(durationMs)}）。至少要 10 秒，短了学不像你` }
  }
  if (durationMs > TOO_LONG_MS) {
    return { level: 'block', message: `太长了（${fmt(durationMs)}）。剪到 20 秒以内最好` }
  }
  if (durationMs < IDEAL_MIN_MS) {
    return { level: 'warn', message: `只有 ${fmt(durationMs)}，偏短。10–20 秒最像你` }
  }
  if (durationMs > IDEAL_MAX_MS) {
    return { level: 'warn', message: `${fmt(durationMs)}，偏长。20 秒以内就够` }
  }
  return null
}

/** 秒数：一位小数，够读也够看 */
export function fmt(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)} 秒`
}

/** 解码要一个 AudioContext；旧 Safari 只认 webkit 前缀那个名字 */
type AudioContextCtor = typeof AudioContext
function audioContextCtor(): AudioContextCtor {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  const ctor = w.AudioContext ?? w.webkitAudioContext
  if (!ctor) throw new Error('这个浏览器没有 AudioContext，没法解码音频')
  return ctor
}

/**
 * 任意一段音频 → 16kHz 单声道 WAV。
 *
 * 重采样交给 `OfflineAudioContext`，不自己抽点：直接隔点丢样本会出混叠噪声，
 *   而"16k 是 48k 的三分之一"这种整除关系只在部分设备上成立（44100 就不是）。
 *   离线上下文按浏览器自己的重采样器跑一遍，几毫秒的事。
 */
export async function toSample(input: Blob): Promise<Sample> {
  const bytes = await input.arrayBuffer()

  const decodeContext = new (audioContextCtor())()
  let decoded: AudioBuffer
  try {
    // 传副本：某些实现会「吃掉」这个 ArrayBuffer，之后再用就只剩零长度
    decoded = await decodeContext.decodeAudioData(bytes.slice(0))
  } catch {
    // 解码失败的原因对用户没有信息量（容器坏了/编码不认识），给一句能行动的话
    throw new Error('这段音频解不开。录音或换一个 mp3 / m4a / wav 文件试试')
  } finally {
    void decodeContext.close()
  }

  const durationMs = Math.round(decoded.duration * 1000)
  const frames = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  // 声道数写 1，浏览器自己下混（不自己平均两声道：那是重采样器的邻居，不该我们管）
  const rendered = await offline.startRendering()

  return {
    bytes: encodeWav(rendered.getChannelData(0), SAMPLE_RATE),
    mime: SAMPLE_MIME,
    durationMs,
  }
}

/** 字节 → base64（请求体是 JSON，样本只能这么走）。分块拼接，避免 apply 的参数上限 */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
