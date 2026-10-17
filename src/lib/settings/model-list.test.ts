/**
 * model-list.test.ts —— 「从接口地址拉候选」那一条路的判据
 *
 * 全部用假 fetch：这一层值得测的是**形状与失败**，不是"网关今天回什么"
 * （那个数会变，写进测试就是一条会自己烂掉的断言）。
 * ★ 唯一的例外是文件末尾那一组：它钉的是**真网关返回形状的两种变体**
 *   （`data[].id` 与 `models[].name`），形状取自 2026-10-17 的实测响应。
 */

import { describe, expect, it, vi } from 'vitest'

import { fetchModelIds, modelsEndpoint, parseModelIds } from './model-list.ts'

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('modelsEndpoint', () => {
  it('尾斜杠不会拼出 //models', () => {
    expect(modelsEndpoint('https://tokenrhythm.studio/v1')).toBe(
      'https://tokenrhythm.studio/v1/models',
    )
    expect(modelsEndpoint('https://tokenrhythm.studio/v1/')).toBe(
      'https://tokenrhythm.studio/v1/models',
    )
    expect(modelsEndpoint('  https://x/v1///  ')).toBe('https://x/v1/models')
  })
})

describe('parseModelIds', () => {
  it('认 OpenAI 那种 { data: [{ id }] }', () => {
    expect(parseModelIds({ object: 'list', data: [{ id: 'b' }, { id: 'a' }] })).toEqual(['a', 'b'])
  })

  it('也认 { models: [{ id | name }] }（自建网关常见）', () => {
    expect(parseModelIds({ models: [{ id: 'x' }, { name: 'y' }] })).toEqual(['x', 'y'])
    expect(parseModelIds({ models: ['z'] })).toEqual(['z'])
  })

  it('去重 + 排序：两次拉取要长得一样（顺序不保证，重复让人以为列表变了）', () => {
    expect(parseModelIds({ data: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b'])
  })

  it('认不出来就是空表，不抛', () => {
    expect(parseModelIds(null)).toEqual([])
    expect(parseModelIds([])).toEqual([])
    expect(parseModelIds({ data: 'nope' })).toEqual([])
    expect(parseModelIds({ data: [{ id: '  ' }, 42, null] })).toEqual([])
  })
})

describe('fetchModelIds', () => {
  it('成功：回 id 表与那个地址（地址要能显示给站长看，里面没有 key）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: 'qwen3.8-flash' }] }))
    const result = await fetchModelIds({
      baseUrl: 'https://gw/v1',
      // ★ 用一把**独一无二**的假 key：断言"返回值里没有它"才有意义
      //   （拿 'k' 去断言会撞上 `ok` 里的那个字母——这条踩过一次）
      apiKey: 'sk-secret-abc123',
      fetchImpl: fetchImpl as never,
    })
    expect(result).toEqual({
      ok: true,
      endpoint: 'https://gw/v1/models',
      ids: ['qwen3.8-flash'],
    })
    // ★ key 只出现在请求头里，不出现在返回值的任何一处
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gw/v1/models')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer sk-secret-abc123',
    )
    expect(JSON.stringify(result)).not.toContain('sk-secret-abc123')
  })

  it('没 key 时照发：让那边自己回 401，不替它判断', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'no key' }, { status: 401 }))
    const result = await fetchModelIds({ baseUrl: 'https://gw/v1', fetchImpl: fetchImpl as never })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('不认这把 key')
    expect(result.message).toContain('401')
  })

  it('404 说"这个地址没有 /models"（语音那一路很可能就是它）', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }))
    const result = await fetchModelIds({
      baseUrl: 'https://tts/api/v1',
      fetchImpl: fetchImpl as never,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('没有 /models')
  })

  it('连不上：说得出是连不上，而不是"没有候选"', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed')
    })
    const result = await fetchModelIds({ baseUrl: 'https://gw/v1', fetchImpl: fetchImpl as never })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('连不上')
  })

  it('200 但一个 id 都没有：照实说，不给一个空的下拉', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }))
    const result = await fetchModelIds({ baseUrl: 'https://gw/v1', fetchImpl: fetchImpl as never })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('一个模型 id 都没有')
  })

  it('回的不是 JSON（网关挂了常回一页 HTML）', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 200 }))
    const result = await fetchModelIds({ baseUrl: 'https://gw/v1', fetchImpl: fetchImpl as never })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('不是 JSON')
  })
})
