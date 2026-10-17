/**
 * voices/voices.test.ts —— 我录的那份记录与那张合并表
 *
 * 两组断言各管一件真实会出的事：
 * - **存储坏了**：localStorage 里是半截 JSON、或者某一条少了 voiceId——整屏不该打不开，
 *   也不该显示一个用不了的音色；
 * - **模型对不上**：跨模型 400 是实测过的，所以"不许选"必须是这一层算出来的，
 *   而不是等用户点进去撞错误。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_VOICES } from '@/lib/voices/state.ts'
import { voiceCatalog, findVoice } from './catalog.ts'
import {
  addMyVoice,
  loadMyVoices,
  MY_VOICES_KEY,
  newConsentRef,
  removeMyVoice,
  type MyVoice,
} from './store.ts'

/** 一个够用的 localStorage 替身（node 环境里没有 window） */
function fakeStorage(): void {
  const map = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    },
  })
}

const one = (over: Partial<MyVoice> = {}): MyVoice => ({
  voiceId: 'qwen-audio-3.0-tts-flash-xiaozhujue-abc123',
  name: '我的声音',
  modelId: 'qwen-audio-3.0-tts-flash',
  createdAt: 1_760_000_000_000,
  consentRef: 'local:test',
  ...over,
})

beforeEach(() => {
  fakeStorage()
})

describe('我录的音色：存与读', () => {
  it('加进去、读回来、新的在前', () => {
    addMyVoice(one({ voiceId: 'v-old', createdAt: 1 }))
    addMyVoice(one({ voiceId: 'v-new', createdAt: 2 }))
    expect(loadMyVoices().map((v) => v.voiceId)).toEqual(['v-new', 'v-old'])
  })

  it('同一个 voiceId 只留一条（否则同一支声音会有两张卡）', () => {
    addMyVoice(one({ voiceId: 'v1', name: '先起的' }))
    addMyVoice(one({ voiceId: 'v1', name: '后起的' }))
    const mine = loadMyVoices()
    expect(mine).toHaveLength(1)
    expect(mine[0]?.name).toBe('后起的')
  })

  it('删掉之后就没了，且不会把别的删掉', () => {
    addMyVoice(one({ voiceId: 'v1' }))
    addMyVoice(one({ voiceId: 'v2' }))
    expect(removeMyVoice('v1').map((v) => v.voiceId)).toEqual(['v2'])
    expect(loadMyVoices().map((v) => v.voiceId)).toEqual(['v2'])
  })

  it('★ 存储坏掉时当作空，不抛（半截 JSON / 不是数组）', () => {
    window.localStorage.setItem(MY_VOICES_KEY, '{"voiceId":')
    expect(loadMyVoices()).toEqual([])
    window.localStorage.setItem(MY_VOICES_KEY, '"一个字符串"')
    expect(loadMyVoices()).toEqual([])
  })

  it('★ 坏的那一条丢掉，好的留下（缺 voiceId 的记录是会真发生的：手改过、或旧版本写过）', () => {
    window.localStorage.setItem(
      MY_VOICES_KEY,
      JSON.stringify([{ name: '没有 id' }, one({ voiceId: 'v-ok' }), { voiceId: 'v-no-name' }]),
    )
    expect(loadMyVoices().map((v) => v.voiceId)).toEqual(['v-ok'])
  })

  it('凭据号每次都不一样，且看不出是谁', () => {
    const a = newConsentRef(1_760_000_000_000)
    const b = newConsentRef(1_760_000_000_000)
    expect(a).not.toBe(b)
    expect(a.startsWith('local:')).toBe(true)
    expect(a).not.toMatch(/[一-龥]/)
  })
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
})
