/**
 * voices/voices.test.ts —— 「预设 + 我录的」那张合并表
 *
 * ★ 2026-10-17（工单 16）：这个文件里原来还有一组"我录的那份记录怎么存、怎么读"
 *   ——那一份住在 localStorage，所以那一组测的是"半截 JSON、坏一条丢一条"。
 *   记录搬到账号上之后，那些事**不再由这一层负责**（读回来的是服务端给的一份，
 *   `parseMyVoices` 认不出来就整份拒绝，判据在 `state.test.ts`）。
 *   把它们留在这里就是留一组测着别的东西的用例——比没有更坏。
 *
 * ★ 留下来的这一组管的是**模型对不上**：跨模型 400 是实测过的，
 *   所以"不许选"必须是这一层算出来的，而不是等用户点进去撞错误。
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_VOICES, type MyVoice } from '@/lib/voices/state.ts'
import { voiceCatalog, findVoice } from './catalog.ts'

const one = (over: Partial<MyVoice> = {}): MyVoice => ({
  voiceId: 'qwen-audio-3.0-tts-flash-xiaozhujue-abc123',
  name: '我的声音',
  modelId: 'qwen-audio-3.0-tts-flash',
  createdAt: 1_760_000_000_000,
  ...over,
})

describe('合并表', () => {
  it('预设在前、我录的在后，两个预设还是那两个', () => {
    const table = voiceCatalog([one()], 'qwen-audio-3.0-tts-flash')
    expect(table.slice(0, 2).map((v) => v.id)).toEqual(DEFAULT_VOICES.map((v) => v.id))
    expect(table).toHaveLength(3)
    expect(table[2]?.source).toBe('mine')
  })

  it('★ 模型对不上就不许选，并给出一句能行动的话', () => {
    const table = voiceCatalog(
      [one({ modelId: 'qwen-audio-3.0-tts-flash' })],
      'qwen-audio-3.1-tts-flash',
    )
    const mine = table[2]
    expect(mine?.usable).toBe(false)
    expect(mine?.why).toContain('qwen-audio-3.0-tts-flash')
    expect(mine?.why).toContain('400')
  })

  it('模型对得上就能选，且预设永远是能选的（我们没有它们的模型绑定记录，不编）', () => {
    const table = voiceCatalog([one()], 'qwen-audio-3.0-tts-flash')
    expect(table.every((v) => v.usable)).toBe(true)
    expect(voiceCatalog([], '').every((v) => v.usable)).toBe(true)
  })

  it('findVoice：删掉之后查回来是 null（界面据此说"这个音色不在了"）', () => {
    const table = voiceCatalog([one()], 'qwen-audio-3.0-tts-flash')
    expect(findVoice(table, 'v-nope')).toBeNull()
    expect(findVoice(table, DEFAULT_VOICES[0]!.id)?.source).toBe('preset')
  })

  /**
   * ★ 2026-10-17 实测到的：**服务端那几行里会混着预置音色**。
   *   `choose` 的语义是"选一个库里还没有的 id 就顺手记一行"（不这么做，"当前音色"
   *   没地方记），于是选了豆豆之后，`mine` 里就多一条 `longjielidou_v3.6`——
   *   不剔掉的话那一屏会长出**第二张豆豆**，而它没有 `tone`、来源还写着"我录的"。
   */
  it('★ 选过的预置音色不会长成第二张卡：那一行是记录，不是"我录的"', () => {
    const chosenPreset: MyVoice = {
      voiceId: DEFAULT_VOICES[0]!.id,
      // 它落下来的时候可能只有 id（服务端现在会退回 id 当名字，仍不该显示成"我录的"）
      name: DEFAULT_VOICES[0]!.id,
      modelId: '',
      createdAt: 1_760_000_000_000,
    }
    const table = voiceCatalog([chosenPreset, one()], 'qwen-audio-3.0-tts-flash')

    expect(table.map((v) => v.id)).toEqual([...DEFAULT_VOICES.map((v) => v.id), one().voiceId])
    expect(table.filter((v) => v.name === DEFAULT_VOICES[0]!.name)).toHaveLength(1)
    // 而"当前音色"那一格照样指得到它——`findVoice` 走的是同一张表
    expect(findVoice(table, DEFAULT_VOICES[0]!.id)?.source).toBe('preset')
  })

  it('★ 判据是 **id** 不是名字：用户自己那条叫「豆豆」的音色照样在表里', () => {
    const mine = one({ voiceId: 'v-my-doudou', name: '豆豆' })
    const table = voiceCatalog([mine], 'qwen-audio-3.0-tts-flash')
    expect(table.filter((v) => v.source === 'mine').map((v) => v.id)).toEqual(['v-my-doudou'])
  })
})

describe('凭据号', () => {
  it('每次都不一样，且看不出是谁', async () => {
    const { newConsentRef } = await import('./consent.ts')
    const a = newConsentRef(1_760_000_000_000)
    const b = newConsentRef(1_760_000_000_000)
    expect(a).not.toBe(b)
    expect(a.startsWith('local:')).toBe(true)
    expect(a).not.toMatch(/[一-龥]/)
  })
})
