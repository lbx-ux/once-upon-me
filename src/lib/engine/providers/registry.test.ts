/**
 * registry.test.ts —— env → 文本适配器选项的那几条规则
 *
 * 锁三件事，每件都对应一次实测或一条纪律：
 *
 * 1. 缺省关思考。与平台默认相反，是实测决定的（思考模型会把 max_tokens
 *    整条花在思考链上、正文一个字都不写）。这条要是哪天被悄悄翻回 on，
 *    出厂配置就是坏的，而症状要到跑测时才看得见。
 * 2. 配错值必须响。`LLM_THINKING=auto` 不能当成 none/off 悄悄跑过去——
 *    registry.ts 文件头第 2 条就是"不静默降级"。
 * 3. health 行要报出实际生效的配置。看不见就等于没配（同一文件头第 1 条）。
 */

import { describe, expect, it } from 'vitest'

import { describeProviders, textOptionsOf } from './registry.ts'
import { EngineError } from '../errors.ts'

const BASE = { LLM_API_KEY: 'k', LLM_MODEL: 'qwen3.8-flash' }

describe('textOptionsOf · 思考开关与预算', () => {
  it('什么都不配 = 关思考 + 预算交给适配器（不在这里编一个数）', () => {
    const opts = textOptionsOf({ ...BASE })
    expect(opts.extra).toEqual({ enable_thinking: false })
    expect(opts.defaultMaxTokens).toBeUndefined()
  })

  it('LLM_THINKING=on 就不再发这个字段（让平台按默认走），预算由 env 给', () => {
    const opts = textOptionsOf({ ...BASE, LLM_THINKING: 'on', LLM_MAX_TOKENS: '16000' })
    expect(opts.extra).toBeUndefined()
    expect(opts.defaultMaxTokens).toBe(16000)
  })

  it('显式 off 与缺省同义', () => {
    expect(textOptionsOf({ ...BASE, LLM_THINKING: 'off' }).extra).toEqual({
      enable_thinking: false,
    })
  })

  it('★ 配错值拒绝运行，不悄悄退回某一档', async () => {
    // 平台其实还有个 `auto`（实测：UNSUPPORTED_FIELD 的原文是"只支持开启、关闭或自动"），
    // 但它的字面量没验证过，所以这里宁可拒绝也不替用户猜
    await expect(() => textOptionsOf({ ...BASE, LLM_THINKING: 'auto' })).toThrowError(EngineError)
    await expect(() => textOptionsOf({ ...BASE, LLM_THINKING: 'auto' })).toThrow(/只接受 on \/ off/)
  })

  it('jsonMode 配错同样要响（档位是判据的一部分，不能悄悄当 none）', async () => {
    await expect(() => textOptionsOf({ ...BASE, LLM_JSON_MODE: 'jsonl' })).toThrowError(EngineError)
  })
})

describe('describeProviders · 报的是实际生效的配置', () => {
  it('文本行带得上思考开关与预算，缺省值也照报', () => {
    const line = describeProviders({ ...BASE }).text
    expect(line).toContain('思考 关')
    expect(line).toContain('4096')
  })

  it('开了就报告警中，不能和缺省长得一样', () => {
    const line = describeProviders({ ...BASE, LLM_THINKING: 'on', LLM_MAX_TOKENS: '16000' }).text
    expect(line).toContain('思考 开')
    expect(line).toContain('16000')
    expect(line).not.toContain('关')
  })
})
