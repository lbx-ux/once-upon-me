/**
 * settings/server-env.test.ts —— 密钥那张表的读法
 *
 * 前身是 `lib/voices/request.test.ts` 里那两条 `envFromBody` 的测试与
 *   `lib/settings/state.test.ts` 里那五条 `toEnv` 的测试。函数换了（从"读请求体"
 *   换成"读 `process.env`"），纪律一条都没丢，所以断言也是一条一条搬过来的：
 *   这三条判据都是踩过才知道的，重写一遍没有意义，漏掉一条才有。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { serverEnv } from './server-env.ts'

/** 改过的键，用完原样还回去。★ 测试不许把 `process.env` 弄脏——它会跟着跑进下一个文件 */
const TOUCHED = [
  'LLM_API_KEY',
  'LLM_MODEL',
  'IMAGE_MODEL',
  'IMAGE_PROMPT_EXTEND',
  'VISION_MODEL',
  'VISION_COMPARE_MAX_TOKENS',
  'VISION_SAFETY_MAX_TOKENS',
  'TTS_MODEL',
  'TTS_VOICE',
  'TTS_VOICE_PREFIX',
] as const

let snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  snapshot = {}
  for (const key of TOUCHED) snapshot[key] = process.env[key]
})

afterEach(() => {
  for (const key of TOUCHED) {
    const value = snapshot[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('serverEnv', () => {
  it('剪掉前后空白（复制粘贴带一个尾空格是最常见的"key 明明对却 401"）', () => {
    process.env.LLM_API_KEY = '  sk-abc  '
    expect(serverEnv()['LLM_API_KEY']).toBe('sk-abc')
  })

  it('空串与只有空白的**不写进表**（"表里有个空串"会让排障误以为配过了）', () => {
    process.env.LLM_MODEL = ''
    process.env.TTS_MODEL = '   '
    const env = serverEnv()
    expect('LLM_MODEL' in env).toBe(false)
    expect('TTS_MODEL' in env).toBe(false)
  })

  it('缺位就是没有这个键，不是 `undefined` 占一个位', () => {
    delete process.env.VISION_MODEL
    expect(Object.hasOwn(serverEnv(), 'VISION_MODEL')).toBe(false)
  })

  /**
   * 这条是那份显式清单换来的东西。写成 `startsWith('LLM_')` 一样能跑，
   *   而且第一次跑不出问题——问题出现在有人加了一个 `LLM_DEBUG_DUMP=1` 或者
   *   一个不该进引擎的数上：它会跟着被送进引擎，而症状在很远的下游。
   */
  it('只认清单上那些名字：没列进去的环境变量一个都不读', () => {
    process.env['LLM_NOT_ON_THE_LIST'] = 'leak'
    const env = serverEnv()
    expect('LLM_NOT_ON_THE_LIST' in env).toBe(false)
    delete process.env['LLM_NOT_ON_THE_LIST']
  })

  /**
   * 视觉不回落到文本、图像也不回落。接口形状不同（对话 vs `images/generations`），
   *   回落只会把"配置错了"变成一个运行期 400，而那一句报错读起来像"模型坏了"。
   *   这一条原来是 `toEnv` 的测试，它防的是映射表写错，与密钥从哪儿来无关，
   *   所以换时代不换判据。
   */
  it('配了文本不配视觉：视觉那一格是空的，不回落到文本那把 key', () => {
    process.env.LLM_API_KEY = 'sk-text'
    process.env.LLM_MODEL = 'qwen-x'
    delete process.env.VISION_API_KEY
    delete process.env.VISION_MODEL
    const env = serverEnv()
    expect(env['VISION_API_KEY']).toBeUndefined()
    expect(env['VISION_MODEL']).toBeUndefined()
    expect(env['LLM_MODEL']).toBe('qwen-x')
  })

  it('语音的音色是一等字段（`TTS_VOICE` 也在表里）', () => {
    process.env.TTS_VOICE = 'longjielidou_v3.6'
    expect(serverEnv()['TTS_VOICE']).toBe('longjielidou_v3.6')
  })

  /**
   * 换模型之后新增的旋钮必须跟着走。
   *
   * 这一条防的正是 2026-10-22 发现的那个缺口：`registry.ts` 认这几个键、
   * `.env.local` 里也写了，而中间这张白名单没列——于是配了不生效，两边都不报错。
   * 判据按"引擎真的会读的名字"逐个钉，不按前缀猜。
   */
  it('换模型后新增的旋钮一个都不能漏（图像改写 / 视觉两格预算 / 音色前缀）', () => {
    process.env.IMAGE_PROMPT_EXTEND = 'on'
    process.env.VISION_COMPARE_MAX_TOKENS = '8192'
    process.env.VISION_SAFETY_MAX_TOKENS = '2048'
    process.env.TTS_VOICE_PREFIX = 'xiaozhujue'
    const env = serverEnv()
    expect(env['IMAGE_PROMPT_EXTEND']).toBe('on')
    expect(env['VISION_COMPARE_MAX_TOKENS']).toBe('8192')
    expect(env['VISION_SAFETY_MAX_TOKENS']).toBe('2048')
    expect(env['TTS_VOICE_PREFIX']).toBe('xiaozhujue')
  })
})
