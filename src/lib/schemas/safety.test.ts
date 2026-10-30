/**
 * safety.test.ts —— 语义复核输出的形状（2026-10-30）
 *
 * 只测两件事：合法的能过、越界的说得出是哪一条。后者是重试提示的全部依据——
 * 一句"格式不对"等于让模型再猜一次。
 */

import { describe, expect, it } from 'vitest'

import { safetyFindingsCodec, safetyJsonSchema } from './safety.ts'
import type { SafetyFindings } from './safety.ts'

const parse = (value: unknown) => safetyFindingsCodec.parse(value, '')

describe('safetyFindingsCodec', () => {
  it('空清单是合法的（绝大多数触发时就是这个结果）', () => {
    const result = parse({ findings: [] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ findings: [] })
  })

  it('一条完整的发现', () => {
    const value: SafetyFindings = {
      findings: [
        { clauseId: 'R-03', pageNo: 2, quote: '他睡着了，再也没有醒过来', why: '委婉写死亡' },
      ],
    }
    const result = parse(value)
    expect(result.ok).toBe(true)
  })

  it('缺 findings → 说得出根路径', () => {
    const result = parse({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failures[0]?.path).toBe('findings')
  })

  it('页号是小数 → 失败（页码只有整数）', () => {
    const result = parse({
      findings: [{ clauseId: 'R-03', pageNo: 1.5, quote: '原文', why: '理由' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failures[0]?.path).toBe('findings[0].pageNo')
  })

  it('引用超过 60 字 → 失败（这一档不许拿一段概括当引用）', () => {
    const result = parse({
      findings: [{ clauseId: 'R-03', pageNo: 1, quote: '字'.repeat(61), why: '理由' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failures[0]?.path).toBe('findings[0].quote')
  })

  it('超过 12 条 → 失败（清单墙不是发现）', () => {
    const findings = Array.from({ length: 13 }, () => ({
      clauseId: 'R-03',
      pageNo: 1,
      quote: '原文',
      why: '理由',
    }))
    const result = parse({ findings })
    expect(result.ok).toBe(false)
  })

  it('JSON Schema 与校验器同源：findings 是数组，pageNo 是整数', () => {
    const schema = safetyJsonSchema() as {
      properties: Record<
        string,
        { type: string; items: { properties: Record<string, { type: string }> } }
      >
    }
    expect(schema.properties['findings']?.type).toBe('array')
    expect(schema.properties['findings']?.items.properties['pageNo']?.type).toBe('integer')
  })
})
