/**
 * voices/samples.ts —— 两个**预置**音色的试听样本（预生成的音频，跟着仓库走）
 *
 * ★ 这个文件是为什么出现的（2026-10-16 第九轮之后）
 * ---------------------------------------------------------------------------
 * 用户点「听一句真的」，什么也没听到，说：「现在这个听一句真的是假的，根本听不了」。
 * 查下来**不是代码坏了**：那条路由拿真 key 打是 `200 / audio/mpeg / 41,371 字节`。
 * 坏的是这一屏的可信度 —— ADR-0008 定的 BYO key 只在内存里活一次请求（刷新就没了），
 * 于是没配 key 的浏览器里三颗钮全是 `disabled`，而**看上去几乎是活的**：
 * 实测 `color: rgb(107,106,116)`（比正常只浅一档）、`opacity: 1`、边还是蓝的 30%。
 * 一个只在"刚好配过 key"的机器上才响的钮，证的是这一屏想证的反面
 * （这一屏存在的理由恰恰是"音色没法用文字判断，必须能听"）。
 *
 * ★ 所以：**预置音色的试听不需要 key。**
 * 那句语料是固定的（`PREVIEW_LINE`），音色是厂商预置的，所以"这句话听起来什么样"
 * 是一个**常量** —— 一次生成、跟着仓库走。这正是 ADR-0003「预生成资产让演示与 API 解耦」
 * 在语音上的同一条做法（`public/demo/books/...` 的逐页朗读早就这么做了）。
 *   ★ 它与「试听是一次性的：不缓存、不进资产根」**不矛盾**：那条管的是**现场合成**的
 *     结果不许缓存、不许进资产根；这里进的是一份**出厂就带着**的样本，
 *     不是任何一次运行时调用的产物。
 *
 * ★ **克隆的那条没有样本，也不可能有**：它只存在于用户自己的厂商账号里。
 *   所以那一张卡的试听仍然是现场合成、仍然要 key —— 没有 key 时它就该说自己没有 key
 *   （见 `VoicePicker.tsx` 里那颗钮的两个态）。
 *
 * ★ 出处（可复现：`.out/make-voice-samples.mjs --port=<隔离 dev server>`，
 *   走的是我们自己的 `/api/voice/preview`，所以样本与现场合成**同源**——
 *   同一个 model、同一句语料、同一套参数，不会出现"文件里的和按钮听到的不是一个"）：
 *
 *   | voiceId              | 模型                    | 语料             | 生成日     | 字节   |
 *   | -------------------- | ----------------------- | ---------------- | ---------- | ------ |
 *   | `longjielidou_v3.6`  | qwen-audio-3.0-tts-flash | `PREVIEW_LINE`   | 2026-10-16 | 41,371 |
 *   | `longanlingxi`       | qwen-audio-3.0-tts-flash | `PREVIEW_LINE`   | 2026-10-16 | 50,971 |
 *
 *   `samples.test.ts` 钉着"表里每一条都真的有那个文件、字节数与表里写的一致、
 *   开头是 ID3" —— 换了模型或重新生成了音频而没改这张表，它会红，而不是让页面上
 *   悄悄换了一个声音。
 */

import { PREVIEW_LINE } from '@/lib/settings/preview-line.ts'

export type VoiceSample = {
  /** 厂商的 voice_id。与 `settings/state.ts` 的 `DEFAULT_VOICES` 是同一批键 */
  voiceId: string
  /** 页面里直接当 URL 用的路径（文件在 `public/voice-samples/`） */
  url: string
  /**
   * 生成它的模型。★ 这不是一句记账：**换模型 = 换声音**（实测跨模型合成直接 400
   * `[cosyvoice]Engine error [411]`），所以样本绑定的模型变了，样本就得重新生成。
   */
  modelId: string
  /** 生成它用的那句话。★ 读 `PREVIEW_LINE`，不在这里再抄一遍 */
  text: string
  /** 生成日期（ISO 日期部分，不含时刻：这一栏是"什么时候出的厂"） */
  generatedAt: string
  /** 文件字节数。★ 一个**断言用**的数：表与文件对不上就说明有人只改了其中一边 */
  bytes: number
}

export const VOICE_SAMPLES: readonly VoiceSample[] = [
  {
    voiceId: 'longjielidou_v3.6',
    url: '/voice-samples/longjielidou_v3.6.mp3',
    modelId: 'qwen-audio-3.0-tts-flash',
    text: PREVIEW_LINE,
    generatedAt: '2026-10-16',
    bytes: 41371,
  },
  {
    voiceId: 'longanlingxi',
    url: '/voice-samples/longanlingxi.mp3',
    modelId: 'qwen-audio-3.0-tts-flash',
    text: PREVIEW_LINE,
    generatedAt: '2026-10-16',
    bytes: 50971,
  },
]

/** 这个音色有没有跟着仓库走的样本。没有 → 那张卡的试听只能现场合成 */
export function sampleFor(voiceId: string): VoiceSample | null {
  return VOICE_SAMPLES.find((s) => s.voiceId === voiceId) ?? null
}
