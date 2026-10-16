/**
 * voices/request.test.ts —— 创建音色那条请求的形状
 *
 * ★ 这一组里最要紧的一条是 `consentRef`：界面上那一步"单独一次同意"如果在请求上
 *   没有任何痕迹，它就只是文案，谁都能绕过。所以断言是"**少了它就拒**"。
 */

import { describe, expect, it } from 'vitest'

import { envFromBody } from '@/lib/settings/request-env.ts'
import { parseCloneRequest, REQUEST_MIME } from './request.ts'

const sample = (bytes: number): string => Buffer.alloc(bytes, 7).toString('base64')

const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  env: { TTS_API_KEY: 'k', TTS_MODEL: 'qwen-audio-3.0-tts-flash' },
  sampleBase64: sample(64),
  mime: REQUEST_MIME,
  consentRef: 'local:abc',
  name: '妈妈的声音',
  ...over,
})

describe('envFromBody', () => {
  it('剪空白、空串不写进表', () => {
    const env = envFromBody({ env: { TTS_API_KEY: '  k  ', TTS_MODEL: '', TTS_BASE_URL: '   ' } })
    expect(env).toEqual({ TTS_API_KEY: 'k' })
  })

  it('不是键值对 → null（数组也不行）', () => {
    expect(envFromBody({ env: 'k=v' })).toBeNull()
    expect(envFromBody({ env: ['k'] })).toBeNull()
    expect(envFromBody({})).toBeNull()
  })
})

describe('parseCloneRequest', () => {
  it('齐了就过，并把名字与样本原样交出去', () => {
    const parsed = parseCloneRequest(body())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.name).toBe('妈妈的声音')
    expect(parsed.value.request.sampleBytes.byteLength).toBe(64)
    expect(parsed.value.request.mime).toBe(REQUEST_MIME)
    expect(parsed.value.request.consentRef).toBe('local:abc')
  })

  it('★ 没有授权凭据号 → 400（没有那一次同意就不建这条音色）', () => {
    const parsed = parseCloneRequest(body({ consentRef: '   ' }))
    expect(parsed).toMatchObject({ ok: false, status: 400 })
    if (!parsed.ok) expect(parsed.message).toContain('授权凭据号')
  })

  it('样本空 / 不是我们那种容器 / 解出来是空的 → 各回 400，各说各的原因', () => {
    expect(parseCloneRequest(body({ sampleBase64: '' }))).toMatchObject({ ok: false, status: 400 })
    const wrongMime = parseCloneRequest(body({ mime: 'audio/webm' }))
    expect(wrongMime).toMatchObject({ ok: false, status: 400 })
    if (!wrongMime.ok) expect(wrongMime.message).toContain('audio/webm')
    // 坏 base64 不会抛，只会解出零长度——那种"发了个空样本"要单独接住
    expect(parseCloneRequest(body({ sampleBase64: '!!!!' }))).toMatchObject({
      ok: false,
      status: 400,
    })
  })

  it('超过 10MB → 400（与适配器里那道是同一个上限，写在注释里互相提醒）', () => {
    const parsed = parseCloneRequest(body({ sampleBase64: sample(10 * 1024 * 1024 + 1) }))
    expect(parsed).toMatchObject({ ok: false, status: 400 })
    if (!parsed.ok) expect(parsed.message).toContain('10MB')
  })

  it('名字：空了给缺省、太长的截断——但不编一个"温柔妈妈音"', () => {
    const empty = parseCloneRequest(body({ name: '  ' }))
    expect(empty.ok && empty.value.name).toBe('我的声音')
    const long = parseCloneRequest(body({ name: '一'.repeat(50) }))
    expect(long.ok && long.value.name.length).toBe(24)
  })
})
