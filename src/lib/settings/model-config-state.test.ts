/**
 * settings/model-config-state.test.ts —— 那一屏的**形状**怎么读回来
 *
 * 两组判据，各钉住一件真会坏的事：
 *
 * 1. **`testLine` 缺了要整份拒绝**（2026-10-18 加的）。放宽成"缺就当空串"的话，
 *    服务端哪天少回这一句，界面上那颗「测试连通」会变成一颗**底下没有说明**的按钮
 *    ——而它按下去要花钱。
 * 2. **一次测试结果的松紧**：`ok` / `capability` / `ms` 这三样不齐就整份不认
 *    （没有它们，界面说不清"这一格现在是什么状态"）；图 / 声 / 话那些是**通的证据**，
 *    缺了就当没有，不该让一次文字测试因为"没有图"而变成一句红字。
 */

import { describe, expect, it } from 'vitest'

import { parseModelConfigView, parseModelTestResult } from './model-config-state.ts'

const section = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'text',
  label: '文字对话',
  hint: '写故事',
  testLine: '发一句话，看它回不回得上（上限 64 token）',
  testSeed: '',
  warn: null,
  fields: [
    {
      id: 'model',
      label: '模型名',
      secret: false,
      configured: true,
      source: 'env',
      fallback: true,
      value: 'qwen3.8-flash',
    },
  ],
  ...over,
})

const view = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  file: '/tmp/models.json',
  effective: { text: '文字：qwen3.8-flash' },
  sections: [section()],
  ...over,
})

describe('parseModelConfigView 与「测试连通」那两句', () => {
  it('齐了就读得出来（包括那两句）', () => {
    const parsed = parseModelConfigView(view())
    expect(parsed?.sections[0]?.testLine).toContain('64 token')
    expect(parsed?.sections[0]?.testSeed).toBe('')
  })

  it('★ 缺 testLine → 整份拒绝，而不是"缺了就当空串"', () => {
    // 见文件头第 1 条：那颗按钮底下没有说明，而它按下去要花钱
    expect(parseModelConfigView(view({ sections: [section({ testLine: undefined })] }))).toBeNull()
  })

  it('★ 缺 testSeed 也一样（空串是合法值，缺字段不是）', () => {
    expect(parseModelConfigView(view({ sections: [section({ testSeed: undefined })] }))).toBeNull()
    expect(parseModelConfigView(view({ sections: [section({ testSeed: '' })] }))).not.toBeNull()
  })
})

describe('parseModelTestResult', () => {
  const done = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    ok: true,
    capability: 'text',
    ms: 3210,
    modelId: 'qwen3.8-flash',
    text: '能，我这就写。',
    imageDataUrl: null,
    audioDataUrl: null,
    anchors: [],
    message: null,
    ...over,
  })

  it('通了的形状：那一句与耗时都在', () => {
    const parsed = parseModelTestResult(done())
    expect(parsed?.ok).toBe(true)
    expect(parsed?.ms).toBe(3210)
    expect(parsed?.modelId).toBe('qwen3.8-flash')
    expect(parsed?.text).toBe('能，我这就写。')
  })

  it('没通的那一份：一句话在，图与声**不能**有（那是"通的证据"）', () => {
    const parsed = parseModelTestResult(
      done({
        ok: false,
        text: null,
        modelId: '',
        message: '这台服务器不认你填的 API key。检查一下是不是复制全了…',
      }),
    )
    expect(parsed?.ok).toBe(false)
    expect(parsed?.message).toContain('API key')
    expect(parsed?.imageDataUrl).toBeNull()
  })

  it('★ 缺 ok / ms / capability 就整份不认（说不清状态的那一份不能用）', () => {
    expect(parseModelTestResult(done({ ok: undefined }))).toBeNull()
    expect(parseModelTestResult(done({ ms: undefined }))).toBeNull()
    expect(parseModelTestResult(done({ ms: '3210' }))).toBeNull()
    // 能力名认不出的那一份也不能用：界面要按它决定"把结果画在谁底下"
    expect(parseModelTestResult(done({ capability: 'voice' }))).toBeNull()
  })

  it('图的形状：data URL 原样带过来', () => {
    const parsed = parseModelTestResult(
      done({ capability: 'image', text: null, imageDataUrl: 'data:image/png;base64,AAA' }),
    )
    expect(parsed?.imageDataUrl).toBe('data:image/png;base64,AAA')
  })

  it('锚点：认得出来的留下，别的丢掉（不因此整份拒绝——它是"读出了什么"，不是状态）', () => {
    const parsed = parseModelTestResult(
      done({
        capability: 'vision',
        anchors: [{ slot: 'hair', value: '齐耳短发' }, { slot: 'eyes' }, { nope: 1 }, 'wardrobe'],
      }),
    )
    expect(parsed?.anchors).toEqual([{ slot: 'hair', value: '齐耳短发' }])
  })
})
