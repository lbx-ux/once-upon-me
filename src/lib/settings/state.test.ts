/**
 * settings/state.test.ts —— 设置这一关的测试先行
 *
 * 大部分条目是从 `creation/to-env.test.ts` **原样搬过来的**：那几条纪律
 * （漏一个字段的症状是"安静地用了默认模型"、空白不写进表、图像不回落文本 key）
 * 与搬家无关，一条都没失效。搬家之后多出来的是一条新的、也是最硬的一条：
 *
 * ★ **key 不许进持久层**。ADR-0008 说"不落盘"，而设置页的本能就是持久化——
 *   所以这里对 `storable()` 的断言是"输出里一个 sk- 都不许有"，
 *   不是"我们记得别存 key"。
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DEFAULT_VOICES,
  mergeStored,
  missingRequired,
  speechReady,
  storable,
  toEnv,
  type SettingsForm,
} from './state.ts'

const FILLED: SettingsForm = {
  text: { baseUrl: 'https://example.com/v1', apiKey: 'sk-text-xxx', model: 'some-text-model' },
  image: { baseUrl: 'https://example.com/v1', apiKey: 'sk-image-yyy', model: 'some-image-model' },
  vision: {
    baseUrl: 'https://example.com/v1',
    apiKey: 'sk-vision-zzz',
    model: 'some-vision-model',
  },
  speech: {
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    apiKey: 'sk-speech-www',
    model: 'qwen-audio-3.0-tts-flash',
    voice: 'longjielidou_v3.6',
  },
}

describe('toEnv', () => {
  it('四组各归各的变量名，四组 base 各是各的', () => {
    const env = toEnv(FILLED)
    expect(env['LLM_MODEL']).toBe('some-text-model')
    expect(env['LLM_API_KEY']).toBe('sk-text-xxx')
    expect(env['IMAGE_MODEL']).toBe('some-image-model')
    expect(env['IMAGE_API_KEY']).toBe('sk-image-yyy')
    expect(env['VISION_MODEL']).toBe('some-vision-model')
    expect(env['VISION_API_KEY']).toBe('sk-vision-zzz')
    expect(env['TTS_MODEL']).toBe('qwen-audio-3.0-tts-flash')
    expect(env['TTS_API_KEY']).toBe('sk-speech-www')
    expect(env['TTS_VOICE']).toBe('longjielidou_v3.6')
    // ★ 图像与语音的 base **不同**——这不是笔误，是实测：语音那家在 /api/v1
    expect(env['IMAGE_BASE_URL']).toBe('https://example.com/v1')
    expect(env['TTS_BASE_URL']).toBe('https://dashscope.aliyuncs.com/api/v1')
  })

  it('空白一律不写进表（不是写空串）', () => {
    // 写空串与缺位在 registry 里等价，但"表里有一个空串"会让排障误以为配过
    const env = toEnv({
      ...DEFAULT_SETTINGS,
      text: { ...DEFAULT_SETTINGS.text, apiKey: '   ', baseUrl: '' },
      vision: { ...DEFAULT_SETTINGS.vision, model: '' },
      speech: { ...DEFAULT_SETTINGS.speech, apiKey: '' },
    })
    expect('LLM_API_KEY' in env).toBe(false)
    expect('LLM_BASE_URL' in env).toBe(false)
    expect('VISION_MODEL' in env).toBe(false)
    expect('TTS_API_KEY' in env).toBe(false)
  })

  it('前后空格被剪掉（复制粘贴带空格是最常见的一种"key 不对"）', () => {
    const env = toEnv({
      ...FILLED,
      text: { ...FILLED.text, apiKey: '  sk-text-xxx\n', model: ' some-text-model ' },
    })
    expect(env['LLM_API_KEY']).toBe('sk-text-xxx')
    expect(env['LLM_MODEL']).toBe('some-text-model')
  })

  it('图像 key **不回落**文本 key', () => {
    // registry 的文件头写着为什么不回落：接口形状根本不同，回落只会把配置错误变成运行期 400
    const env = toEnv({ ...FILLED, image: { ...FILLED.image, apiKey: '' } })
    expect(env['IMAGE_API_KEY']).toBeUndefined()
    expect(env['LLM_API_KEY']).toBe('sk-text-xxx')
  })

  it('默认值本身是合法的（预填就能跑，不用先改一遍）', () => {
    const env = toEnv(DEFAULT_SETTINGS)
    expect(env['LLM_MODEL']).toBeTruthy()
    expect(env['IMAGE_MODEL']).toBeTruthy()
    expect(env['LLM_BASE_URL']).toBeTruthy()
    expect(env['IMAGE_BASE_URL']).toBeTruthy()
  })
})

describe('★ key 不进持久层', () => {
  it('storable() 的输出里一个密钥都不带', () => {
    const dumped = JSON.stringify(storable(FILLED))
    expect(dumped).not.toContain('sk-text-xxx')
    expect(dumped).not.toContain('sk-image-yyy')
    expect(dumped).not.toContain('sk-vision-zzz')
    expect(dumped).not.toContain('sk-speech-www')
    expect(dumped).not.toContain('apiKey')
  })

  it('storable() 保留了不许丢的那些（base / 模型名 / 音色）', () => {
    const stored = storable(FILLED)
    expect(stored['image']?.['model']).toBe('some-image-model')
    expect(stored['speech']?.['voice']).toBe('longjielidou_v3.6')
    expect(stored['text']?.['baseUrl']).toBe('https://example.com/v1')
  })

  it('★ 就算存储里混进了 key，mergeStored 也不读进来（不信任存储内容）', () => {
    const tampered = {
      ...storable(FILLED),
      text: { ...storable(FILLED)['text'], apiKey: 'sk-leaked' },
    }
    const merged = mergeStored(tampered)
    expect(merged.text.apiKey).toBe('')
    expect(merged.text.model).toBe('some-text-model')
  })

  it('mergeStored 对残缺/垃圾输入退回默认值，不抛', () => {
    expect(mergeStored(null).image.model).toBe(DEFAULT_SETTINGS.image.model)
    expect(mergeStored({ image: '不是对象' }).image.model).toBe(DEFAULT_SETTINGS.image.model)
    expect(mergeStored(42).speech.voice).toBe(DEFAULT_SETTINGS.speech.voice)
  })
})

describe('missingRequired · 只算跑不动的那两项', () => {
  it('四项都空时全报出来，顺序稳定', () => {
    const missing = missingRequired({
      ...DEFAULT_SETTINGS,
      text: { ...DEFAULT_SETTINGS.text, model: '' },
      image: { ...DEFAULT_SETTINGS.image, model: '' },
    })
    expect(missing).toEqual(['文本模型名', '文本 API key', '图像模型名', '图像 API key'])
  })

  it('与 toEnv 同源：能提交 ⇔ 表里有那两项', () => {
    const env = toEnv(FILLED)
    expect(missingRequired(FILLED)).toEqual([])
    expect(env['LLM_API_KEY']).toBe('sk-text-xxx')
  })

  it('★ 语音/视觉缺了**不算** missing：那是降级路径，不是坏配置', () => {
    const form: SettingsForm = {
      ...FILLED,
      vision: { ...FILLED.vision, model: '', apiKey: '' },
      speech: { ...FILLED.speech, apiKey: '', voice: '' },
    }
    expect(missingRequired(form)).toEqual([])
    // 但"这本书会不会有朗读"要另有一个判据，不能靠 missingRequired
    expect(speechReady(form)).toBe(false)
    expect(speechReady(FILLED)).toBe(true)
  })

  it('语音只要缺 key 或缺音色就不算就绪（音色是必需的，不是可选项）', () => {
    expect(speechReady({ ...FILLED, speech: { ...FILLED.speech, apiKey: '' } })).toBe(false)
    expect(speechReady({ ...FILLED, speech: { ...FILLED.speech, voice: '  ' } })).toBe(false)
  })
})

describe('默认音色', () => {
  it('就是两个，一男一女（产品定义要的"两个默认音色"）', () => {
    expect(DEFAULT_VOICES).toHaveLength(2)
    expect(DEFAULT_VOICES.map((v) => v.id)).toEqual(['longjielidou_v3.6', 'longpaopao_v3.6'])
  })

  it('默认设置里不预选音色：预选一个等于替家长决定了他孩子的声音', () => {
    expect(DEFAULT_SETTINGS.speech.voice).toBe('')
  })
})
