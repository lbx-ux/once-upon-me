/**
 * settings/model-config.test.ts —— 管理页那份模型配置的读写规矩
 *
 * ★ 这一组里最要紧的一条是「key 永远不出现在 view 里」。它不是"界面小心一点"，
 *   而是服务端根本不给——所以判据选的是整份 JSON 里搜不到那个值，
 *   而不是"某一格是不是 null"。后者只挡住了一种写法，前者挡住所有写法
 *   （包括将来有人往 view 里加一个 `debug` 字段顺手把值塞进去）。
 *
 * 第二条要紧的是「空 ≠ 清掉」：只想换模型名的人不该顺手把自己的 key 清掉。
 *   这个错误的症状要到下一次生成才出现（401），那时没人会想到是这里。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyPatch,
  capabilitySpec,
  CAPABILITIES,
  checkField,
  clearCapability,
  keepKnownKeys,
  modelConfigView,
  TEST_REQUEST,
} from './model-config.ts'
import { DEFAULT_IMAGE_SIZE } from '@/lib/prompts/image.ts'
import { PREVIEW_LINE } from './preview-line.ts'
import { modelConfigFile, readOverrides, writeOverrides } from './runtime-config.ts'
import { serverEnv } from './server-env.ts'

/** 改过的环境变量，用完原样还回去（与 `server-env.test.ts` 同一条纪律） */
const TOUCHED = [
  'MODEL_CONFIG_FILE',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_BASE_URL',
  'IMAGE_API_KEY',
  'IMAGE_MODEL',
  'TTS_MODEL',
  'TTS_API_KEY',
  'VISION_MODEL',
] as const

let snapshot: Record<string, string | undefined> = {}
let tmpDir = ''

beforeEach(() => {
  snapshot = {}
  for (const key of TOUCHED) snapshot[key] = process.env[key]
  // ★ 每个用例一个空的临时目录：这些用例会真的写文件，绝不能碰到
  //   项目根下那份真的 `models.runtime.json`
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-config-test-'))
  process.env.MODEL_CONFIG_FILE = path.join(tmpDir, 'models.json')
})

afterEach(() => {
  for (const key of TOUCHED) {
    const value = snapshot[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('★ 秘密只进不出', () => {
  it('环境变量里的 key 一个字节都不进 view', () => {
    process.env.LLM_API_KEY = 'sk-super-secret-from-env'
    process.env.LLM_MODEL = 'qwen-x'

    const view = modelConfigView()
    expect(JSON.stringify(view)).not.toContain('sk-super-secret-from-env')
    // 但"配了没有"要说得出来，否则界面没法显示状态
    const key = sectionOf('text').fields.find((f) => f.id === 'apiKey')
    expect(key?.configured).toBe(true)
    expect(key?.source).toBe('env')
    expect(key?.value).toBeNull()
  })

  it('管理页写进去的 key 也不进 view（换了个来源而已）', async () => {
    await writeOverrides({ LLM_API_KEY: 'sk-super-secret-from-admin' })

    const view = modelConfigView()
    expect(JSON.stringify(view)).not.toContain('sk-super-secret-from-admin')
    const key = sectionOf('text').fields.find((f) => f.id === 'apiKey')
    expect(key?.configured).toBe(true)
    expect(key?.source).toBe('admin')
    expect(key?.value).toBeNull()
  })

  it('非秘密的格子照给值：站长得看着当前模型改', () => {
    process.env.LLM_MODEL = 'qwen3.8-flash'
    expect(sectionOf('text').fields.find((f) => f.id === 'model')?.value).toBe('qwen3.8-flash')
  })
})

describe('覆盖压过环境变量', () => {
  it('文件里有就用文件里的，没有就退回环境变量', async () => {
    process.env.LLM_MODEL = 'env-model'
    process.env.IMAGE_MODEL = 'env-image'
    await writeOverrides({ LLM_MODEL: 'admin-model' })

    const env = serverEnv()
    expect(env['LLM_MODEL']).toBe('admin-model')
    expect(env['IMAGE_MODEL']).toBe('env-image')
  })

  it('每一格各自报来源：这一格是管理页改的，那一格还是环境变量', async () => {
    process.env.LLM_MODEL = 'env-model'
    process.env.IMAGE_MODEL = 'env-image'
    await writeOverrides({ LLM_MODEL: 'admin-model' })

    expect(fieldOf('text', 'model').source).toBe('admin')
    expect(fieldOf('image', 'model').source).toBe('env')
  })

  it('★ fallback 看的是 `process.env`，不是"最终生效的那份"', async () => {
    // 环境变量里什么都没有，管理页写了一份
    delete process.env.LLM_MODEL
    await writeOverrides({ LLM_MODEL: 'admin-model' })

    // 「恢复默认」点下去会变成空值——界面上要说的正是这一句。
    //   拿合并后的 env 判这一位的话它永远为真，于是确认框会说
    //   "那边都有配，不会空"，而点完这个能力当场就用不了了
    expect(fieldOf('text', 'model').fallback).toBe(false)

    process.env.LLM_MODEL = 'env-model'
    expect(fieldOf('text', 'model').fallback).toBe(true)
  })

  it('文件里塞了清单外的键 → 读的时候就被丢掉，不进引擎', async () => {
    await writeOverrides({ LLM_DEBUG_DUMP: '1', LLM_MODEL: 'ok-model' })

    const env = serverEnv()
    expect('LLM_DEBUG_DUMP' in env).toBe(false)
    expect(env['LLM_MODEL']).toBe('ok-model')
  })

  it('文件里那一项是空串 → 当没有，仍然用环境变量', async () => {
    process.env.LLM_MODEL = 'env-model'
    await writeOverrides({ LLM_MODEL: '   ' })
    expect(serverEnv()['LLM_MODEL']).toBe('env-model')
  })
})

describe('文件的读法', () => {
  it('文件不存在 = 没有覆盖（不是错误）', () => {
    expect(readOverrides()).toEqual({})
    expect(serverEnv()['LLM_MODEL']).toBeUndefined()
  })

  it('文件是坏 JSON → 当没有覆盖，**退回环境变量**而不是让全站 500', () => {
    process.env.LLM_MODEL = 'env-model'
    fs.writeFileSync(modelConfigFile(), '{ 这不是 JSON', 'utf8')
    // 生成链路的每一跳都会读它一次。为一份手改坏的文件让整站坏掉，
    //   是把一个小事故升级成大事故
    expect(readOverrides()).toEqual({})
    expect(serverEnv()['LLM_MODEL']).toBe('env-model')
  })

  it('值不是字符串的那几项被丢掉（它们会让下游的 `.trim()` 当场抛）', () => {
    fs.writeFileSync(
      modelConfigFile(),
      JSON.stringify({ LLM_MODEL: 42, IMAGE_MODEL: 'ok' }),
      'utf8',
    )
    const overrides = readOverrides()
    expect(overrides['LLM_MODEL']).toBeUndefined()
    expect(overrides['IMAGE_MODEL']).toBe('ok')
  })

  it('写是全量覆盖且能读回来（原子写：临时文件 + rename）', async () => {
    await writeOverrides({ LLM_MODEL: 'a' })
    await writeOverrides({ IMAGE_MODEL: 'b' })
    expect(readOverrides()).toEqual({ IMAGE_MODEL: 'b' })
    // 临时文件不该留下
    expect(fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('一次改动的规矩', () => {
  const text = capabilitySpec('text')!

  it('★ 空 = 这次不改，不是清掉它', () => {
    const before = { LLM_API_KEY: 'sk-keep-me', LLM_MODEL: 'old-model' }
    const after = applyPatch(before, text, { model: 'new-model', apiKey: '' })
    expect(after['LLM_MODEL']).toBe('new-model')
    // 这一条防的是"只想换个模型名，顺手把 key 清了"——
    //   而那个后果要到下一次生成才出现（401）
    expect(after['LLM_API_KEY']).toBe('sk-keep-me')
  })

  it('前后空白剪掉（与读环境变量同一条：尾空格是最常见的"key 明明对却 401"）', () => {
    const after = applyPatch({}, text, { apiKey: '  sk-padded  ', model: ' m ' })
    expect(after['LLM_API_KEY']).toBe('sk-padded')
    expect(after['LLM_MODEL']).toBe('m')
  })

  it('恢复默认只去掉**这个能力**那几格，别人的不动', () => {
    const before = {
      LLM_MODEL: 'text-model',
      LLM_API_KEY: 'sk-text',
      IMAGE_MODEL: 'image-model',
    }
    const after = clearCapability(before, text)
    expect(after['LLM_MODEL']).toBeUndefined()
    expect(after['LLM_API_KEY']).toBeUndefined()
    expect(after['IMAGE_MODEL']).toBe('image-model')
  })
})

describe('字段校验', () => {
  const text = capabilitySpec('text')!

  it('这个能力没有的那一格 → 报错（不是静默忽略）', () => {
    // 静默忽略的话，界面把字段名拼错就是"保存成功但什么都没改"
    expect(checkField(text, 'voice', 'x')).toMatchObject({ ok: false, code: 'unknown-field' })
  })

  it('接口地址得像个地址；空串放行（空表示没填）', () => {
    expect(checkField(text, 'baseUrl', 'tokenrhythm.studio')).toMatchObject({
      ok: false,
      code: 'bad-base-url',
    })
    expect(checkField(text, 'baseUrl', '')).toMatchObject({ ok: true })
    expect(checkField(text, 'baseUrl', 'https://tokenrhythm.studio/v1')).toMatchObject({ ok: true })
  })

  it('不是字符串 → bad-json', () => {
    expect(checkField(text, 'model', 42)).toMatchObject({ ok: false, code: 'bad-json' })
  })

  it('认不出的能力名 → null（路由那边回一句人话，不是 404 页面）', () => {
    expect(capabilitySpec('te xt')).toBeNull()
    expect(capabilitySpec('speech')).not.toBeNull()
  })
})

describe('show 给界面的那份', () => {
  it('四个能力都在，顺序与工作台那四项一致', () => {
    const view = modelConfigView()
    expect(view.sections.map((s) => s.id)).toEqual(['text', 'image', 'vision', 'speech'])
  })

  it('★ 引擎那一句是从 describeProviders 来的，键对得上（speech ↔ voice）', () => {
    process.env.TTS_MODEL = 'qwen-audio-x'
    process.env.TTS_API_KEY = 'sk-tts'
    const view = modelConfigView()
    // 能力 id 叫 speech，引擎那一句叫 voice——这个映射错了的话，
    // 语音那一行会永远显示"（引擎没说这一项）"，而它看起来像个正常状态
    expect(view.effective['voice']).toContain('qwen-audio-x')
  })

  it('一个都没配时，每一格都是"还没有"，不是空白', () => {
    for (const key of TOUCHED) if (key !== 'MODEL_CONFIG_FILE') delete process.env[key]
    const view = modelConfigView()
    for (const section of view.sections) {
      for (const field of section.fields) {
        expect(field.configured).toBe(false)
        expect(field.source).toBeNull()
      }
    }
  })

  it('文件路径会说出去（手改、备份、换服务器都靠这条线索）', () => {
    expect(modelConfigView().file).toBe(modelConfigFile())
    expect(modelConfigView().file).toContain('models.json')
  })

  it('语音那一行带警告（换模型即失效，厂商只报一句 [411]）', () => {
    expect(CAPABILITIES.find((c) => c.id === 'speech')?.warn).toContain('[411]')
  })

  /* 「测试连通」那两句（2026-10-18） */

  it('★ 副标题里写的那个数，就是测试真发出去的那个数', () => {
    // 这一条是这一组里最要紧的：副标题写着"上限 64 token"而路由发的是 4096，
    // 谁也不会发现——那种"字写得很具体、做的是另一件事"正是最坏的错。
    // 而这两个数现在同源（都从 `TEST_REQUEST` 来），所以这一条断言的是同源本身
    const line = sectionOf('text').testLine
    expect(line).toContain(`${TEST_REQUEST.text.maxTokens} token`)
  })

  it('★ 图像那一句里的尺寸就是产品出图用的那个尺寸', () => {
    // 挑一个产品不用的尺寸去测，通不通都不说明产品能不能跑（路由文件头第 4 条）
    expect(sectionOf('image').testLine).toContain(TEST_REQUEST.image.size.replace('x', '×'))
    expect(TEST_REQUEST.image.size).toBe(DEFAULT_IMAGE_SIZE)
  })

  it('测试那一格预填的，就是路由缺省会发出去的那一份', () => {
    expect(sectionOf('image').testSeed).toBe(TEST_REQUEST.image.prompt)
    // 语音那一句与音色卡上印的是同一个常量——两处漂开就是"卡片上印的
    // 和实际念的成了两句话"，而这种错没人会去对
    expect(sectionOf('speech').testSeed).toBe(PREVIEW_LINE)
  })

  it('文字与视觉没有预填值（它们不需要输入：一个发固定那句话，一个要的是图片本身）', () => {
    expect(sectionOf('text').testSeed).toBe('')
    expect(sectionOf('vision').testSeed).toBe('')
    for (const id of ['text', 'image', 'vision', 'speech']) {
      expect(sectionOf(id).testLine.length).toBeGreaterThan(0)
    }
  })
})

describe('keepKnownKeys', () => {
  it('只留清单上的键', () => {
    expect(keepKnownKeys({ LLM_MODEL: 'a', NOPE: 'b', IMAGE_API_KEY: 'c' })).toEqual({
      LLM_MODEL: 'a',
      IMAGE_API_KEY: 'c',
    })
  })
})

/* 小工具 */

function sectionOf(id: string) {
  const section = modelConfigView().sections.find((s) => s.id === id)
  if (!section) throw new Error(`没有 ${id} 这一节`)
  return section
}

function fieldOf(sectionId: string, fieldId: string) {
  const field = sectionOf(sectionId).fields.find((f) => f.id === fieldId)
  if (!field) throw new Error(`没有 ${sectionId}.${fieldId} 这一格`)
  return field
}
