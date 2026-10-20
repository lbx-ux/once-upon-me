/**
 * id.test.ts —— 音色 id 那一条判据（`voices/id.ts`）
 *
 * 这一条测试存在的理由只有一条：这个数曾经是猜的，而它拦下的是用户自己录的音色。
 * 所以这里钉住的不是"函数写得对"，而是两个实测：
 *   1. 真克隆出来的 id（68 字）必须过；
 *   2. 串了字段的字符串必须被拦——而且靠字符集拦，不靠长度。
 */

import { describe, expect, it } from 'vitest'

import { MAX_VOICE_ID, voiceIdProblem } from './id.ts'

/** 实测拿到的形状（`.out/voice-id-shape.mts`）：模型名 24 + prefix 12 + 32 位随机 = 68 字 */
const CLONED = 'qwen-audio-3.0-tts-flash-xiaozhujue-a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('voiceIdProblem', () => {
  it('实测那条克隆出来的 id（68 字）要过 —— 它正是被旧的 64 拦下的那一条', () => {
    expect(CLONED.length).toBe(68)
    expect(voiceIdProblem(CLONED)).toBeNull()
  })

  it('两个预置音色要过', () => {
    expect(voiceIdProblem('longjielidou_v3.6')).toBeNull()
    expect(voiceIdProblem('longanlingxi')).toBeNull()
  })

  it('空串不是问题：它表示"这一本不配音"', () => {
    expect(voiceIdProblem('')).toBeNull()
  })

  it('超过上界要报，而且把**实际长度**一起说出来（旧的那句只说了界限）', () => {
    const long = 'v'.repeat(MAX_VOICE_ID + 1)
    expect(voiceIdProblem(long)).toContain('音色 id 太长了')
    expect(voiceIdProblem(long)).toContain(String(MAX_VOICE_ID + 1))
  })

  it('上界与后端那一列同宽（VARCHAR(128)）—— 别让它悄悄变成另一个数', () => {
    expect(MAX_VOICE_ID).toBe(128)
  })

  it('★ 串了字段靠**字符集**拦：空格 / 引号 / 花括号 / 斜杠 / 中文都算', () => {
    for (const bad of [
      '我的声音 小宇',
      '{"voiceId":"x"}',
      "it's",
      'https://example.com/v',
      '<script>',
      '音色：慢慢',
    ]) {
      expect(voiceIdProblem(bad), `${bad} 本该被拦下`).not.toBeNull()
      expect(voiceIdProblem(bad)).toContain('不该有的字符')
    }
  })
})
