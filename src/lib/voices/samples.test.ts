/**
 * samples.test.ts —— 那张样本表与 `public/voice-samples/` 里的文件**必须对得上**
 *
 * 为什么值得一条测试：这张表是"哪个音色点下去会响什么"的唯一依据，而它指的东西
 * 是一份**二进制文件** —— 类型系统看不见文件在不在，`tsc` 也看不见字节数。
 * 漂移的后果不是报错，是**页面上悄悄换了一个声音**，或者更糟：一个 404 的空播放器
 * （那正是用户报的"听一句真的根本听不了"那一类症状）。
 *
 * 钉三件事：
 *   1. 每一条的 `url` 在 `public/` 下真的有那个文件；
 *   2. 文件的字节数与表里写的**完全一致**（重新生成过就得改表，改不动就说明
 *      该重跑 `.out/make-voice-samples.mjs`）;
 *   3. 开头是 `ID3` —— 一个被 git 弄坏或被 HTML 错误页覆盖的文件，
 *      大小可能还差不多，但开头不会骗人。
 *
 * ★ 还有一条不查文件、查**意图**的：表里的语料必须就是卡片上印的那一句
 *   （`PREVIEW_LINE`）。样本念的和卡上写的成了两句话，这件事没人会去对。
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PREVIEW_LINE } from '@/lib/settings/preview-line.ts'
import { DEFAULT_VOICES } from '@/lib/voices/state.ts'
import { VOICE_SAMPLES, sampleFor } from './samples.ts'

const ROOT = process.cwd()

async function fileOf(url: string): Promise<{ bytes: number; head: Buffer }> {
  const path = join(ROOT, 'public', url.replace(/^\//, ''))
  const info = await stat(path)
  const buf = await readFile(path)
  return { bytes: info.size, head: buf.subarray(0, 3) }
}

describe('预置音色的试听样本', () => {
  it('每一条都有对应的文件、字节数与表一致、开头是 ID3', async () => {
    expect(VOICE_SAMPLES.length).toBeGreaterThan(0)
    for (const sample of VOICE_SAMPLES) {
      const { bytes, head } = await fileOf(sample.url)
      expect(head.toString('latin1'), `${sample.voiceId} 的文件开头不是 ID3`).toBe('ID3')
      expect(bytes, `${sample.voiceId} 的字节数与表里写的对不上`).toBe(sample.bytes)
    }
  })

  it('样本的 voiceId 都是**预置**音色表里的键，而且不重复', () => {
    const preset = new Set(DEFAULT_VOICES.map((v) => v.id))
    const seen = new Set<string>()
    for (const sample of VOICE_SAMPLES) {
      expect(preset.has(sample.voiceId), `${sample.voiceId} 不在 DEFAULT_VOICES 里`).toBe(true)
      expect(seen.has(sample.voiceId), `${sample.voiceId} 在表里出现了两次`).toBe(false)
      seen.add(sample.voiceId)
    }
  })

  it('样本念的就是卡片上印的那一句', () => {
    for (const sample of VOICE_SAMPLES) expect(sample.text).toBe(PREVIEW_LINE)
  })

  it('查不到的（克隆出来的那条）返回 null —— 它只能现场合成', () => {
    expect(sampleFor('longjielidou_v3.6')).not.toBeNull()
    expect(sampleFor('clone-9f2c')).toBeNull()
  })
})
