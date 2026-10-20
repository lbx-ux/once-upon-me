/**
 * tool-loop.test.ts —— 工具循环的四条边界
 *
 * 这一组用例盯的全是坏法，不是"功能正常时对不对"：模型不调工具、
 * 模型调了不存在的工具、模型把参数写成坏 JSON、工具有一次抛了、它一直调不停。
 * 五种都必须是有明确处置的，因为它们的现场都长得像"模型变笨了"——
 * 而真实成因在循环这边。
 *
 * 用假 provider，不打网络；时钟也是注入的，所以 `ms` 可断言。
 */

import { describe, expect, it } from 'vitest'

import { completeWithTools, type ToolDef } from './tool-loop.ts'
import type { ChatMessage, TextGenerator, TextRequest, TextResponse } from './providers/types.ts'
import type { EngineEventPayload } from './events.ts'

/* 假的生成器 */

type Turn = { toolCalls?: { id: string; name: string; argumentsJson: string }[]; text?: string }

/** 按剧本一轮一轮回。剧本用完之后一直回最后一条 */
function scripted(turns: Turn[]): { text: TextGenerator; seen: TextRequest[] } {
  const seen: TextRequest[] = []
  let index = 0
  const next = (): TextResponse => {
    const turn = turns[Math.min(index, turns.length - 1)] ?? {}
    index += 1
    return {
      text: turn.text ?? '',
      modelId: 'fake-text',
      ...(turn.toolCalls ? { toolCalls: turn.toolCalls } : {}),
    }
  }
  return {
    seen,
    text: {
      id: 'fake-text',
      modelId: 'fake-text',
      async complete(req) {
        seen.push(req)
        return next()
      },
      async stream(_req, _budget, onDelta) {
        const response = next()
        onDelta({ text: response.text, streamed: false })
        return response
      },
    },
  }
}

const SHELF: ToolDef = {
  spec: { name: 'read_shelf', description: '看看有哪些书', parameters: { type: 'object' } },
  run: () => '书架上有 2 本：《云》《雨》',
}

function callOf(id: string, name: string, args: unknown = {}): Turn {
  return { toolCalls: [{ id, name, argumentsJson: JSON.stringify(args) }] }
}

function collect(): { events: EngineEventPayload[]; emit: (one: EngineEventPayload) => void } {
  const events: EngineEventPayload[] = []
  return { events, emit: (one) => events.push(one) }
}

/* 第 4 条：一次都不调 = 合法 */

describe('模型一次都不调工具', () => {
  it('直接给答案 = 合法结果，不是失败（这才叫"让它自己决定要不要查"）', async () => {
    const fake = scripted([{ text: '{"title":"云","nodes":[]}' }])
    const outcome = await completeWithTools(
      { system: '你是助手', user: '编一版' },
      { text: fake.text, tools: [SHELF] },
    )
    expect(outcome.text).toBe('{"title":"云","nodes":[]}')
    expect(outcome.toolCalls).toBe(0)
    expect(outcome.steps).toBe(1)
    expect(outcome.trail).toEqual([])
  })

  it('★ 一次都不调时**不带 tools**也照样发（判据 8 的另一半：不调就没有 tools 开销之外的差别）', async () => {
    const fake = scripted([{ text: '答案' }])
    await completeWithTools({ system: 's', user: 'u' }, { text: fake.text, tools: [SHELF] })
    expect(fake.seen[0]?.tools).toHaveLength(1)
  })
})

/* 第 1 条：正常一轮 */

describe('调一次工具再回答', () => {
  it('工具结果回填成 role:tool，并且带的是**同一个 id**', async () => {
    const fake = scripted([callOf('call-1', 'read_shelf'), { text: '书架上有两本' }])
    const outcome = await completeWithTools(
      { system: 's', user: 'u' },
      { text: fake.text, tools: [SHELF] },
    )
    expect(outcome.text).toBe('书架上有两本')
    expect(outcome.toolCalls).toBe(1)
    expect(outcome.steps).toBe(2)

    const second = fake.seen[1]?.messages as ChatMessage[]
    expect(second?.at(-2)).toMatchObject({ role: 'assistant' })
    expect(second?.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'call-1',
      content: '书架上有 2 本：《云》《雨》',
    })
  })

  it('调工具那一轮 assistant 的 content 是 null（回包正文为空时不编一个空串）', async () => {
    const fake = scripted([callOf('c1', 'read_shelf'), { text: '好的' }])
    await completeWithTools({ system: 's', user: 'u' }, { text: fake.text, tools: [SHELF] })
    const second = fake.seen[1]?.messages as ChatMessage[]
    expect(second?.at(-2)).toMatchObject({ role: 'assistant', content: null })
  })

  it('成功那次也发一条 tool 事件（过程面板要看得到"模型查了什么"）', async () => {
    const fake = scripted([callOf('c1', 'read_shelf'), { text: '好的' }])
    const sink = collect()
    await completeWithTools(
      { system: 's', user: 'u' },
      { text: fake.text, tools: [SHELF], emit: sink.emit, now: ticking() },
    )
    const tools = sink.events.filter((one) => one.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ name: 'read_shelf', ok: true })
  })
})

/* 第 2 条：工具抛错不终止 */

describe('★ 工具抛错不终止整条循环', () => {
  const boom: ToolDef = {
    spec: { name: 'boom', description: '会炸', parameters: { type: 'object' } },
    run: () => {
      throw new Error('语料索引读不出来')
    },
  }

  it('错误原文喂回去，模型下一轮还能给答案', async () => {
    const fake = scripted([callOf('c1', 'boom'), { text: '那我照常编' }])
    const sink = collect()
    const outcome = await completeWithTools(
      { system: 's', user: 'u' },
      { text: fake.text, tools: [boom], emit: sink.emit },
    )
    expect(outcome.text).toBe('那我照常编')
    const second = fake.seen[1]?.messages as ChatMessage[]
    expect(second?.at(-1)).toMatchObject({ role: 'tool' })
    expect((second?.at(-1) as { content: string }).content).toContain('语料索引读不出来')
  })

  it('★ 同时发 tool(ok:false) 与一条非致命 error —— 不然"模型在改"看不出来', async () => {
    const fake = scripted([callOf('c1', 'boom'), { text: '好' }])
    const sink = collect()
    await completeWithTools(
      { system: 's', user: 'u' },
      { text: fake.text, tools: [boom], emit: sink.emit },
    )
    expect(sink.events.find((one) => one.kind === 'tool')).toMatchObject({ ok: false })
    expect(sink.events.find((one) => one.kind === 'error')).toMatchObject({ fatal: false })
  })
})

/* 第 3 条：参数坏 / 工具名坏 */

describe('模型写坏参数', () => {
  it('坏 JSON 不当成崩溃，喂回去让它自己改', async () => {
    const fake = scripted([
      { toolCalls: [{ id: 'c1', name: 'read_shelf', argumentsJson: '{"k": 3,}' }] },
      { text: '重写好了' },
    ])
    const sink = collect()
    const outcome = await completeWithTools(
      { system: 's', user: 'u' },
      { text: fake.text, tools: [SHELF], emit: sink.emit },
    )
    expect(outcome.text).toBe('重写好了')
    const second = fake.seen[1]?.messages as ChatMessage[]
    expect((second?.at(-1) as { content: string }).content).toContain('不是合法 JSON')
  })

  it('空串当 `{}`（有的网关没有参数时回空串，那是合法调用）', async () => {
    const fake = scripted([
      { toolCalls: [{ id: 'c1', name: 'read_shelf', argumentsJson: '' }] },
      { text: '好' },
    ])
    const outcome = await completeWithTools(
      { system: 's', user: 'u' },
      { text: fake.text, tools: [SHELF] },
    )
    expect(outcome.trail[0]).toMatchObject({ name: 'read_shelf', ok: true })
  })

  it('不存在的工具名：把**可用的那几个**报回去', async () => {
    const fake = scripted([callOf('c1', 'read_bookshelf'), { text: '抱歉' }])
    await completeWithTools({ system: 's', user: 'u' }, { text: fake.text, tools: [SHELF] })
    const second = fake.seen[1]?.messages as ChatMessage[]
    const content = (second?.at(-1) as { content: string }).content
    expect(content).toContain('read_bookshelf')
    expect(content).toContain('read_shelf')
  })
})

/* 第 3 条：步数用完了 */

describe('★ 步数用完了必须说出来，不许静默截断', () => {
  it('到顶后**不带 tools** 再问一次，逼它给最终答复', async () => {
    // 一直调工具，永不停手
    const fake = scripted([callOf('c1', 'read_shelf')])
    const sink = collect()
    const outcome = await completeWithTools(
      { system: 's', user: 'u' },
      { text: fake.text, tools: [SHELF], maxSteps: 3, emit: sink.emit },
    )
    // 4 次调用：3 次带工具 + 1 次不带
    expect(fake.seen).toHaveLength(4)
    expect(fake.seen[3]?.tools).toBeUndefined()
    expect(outcome.steps).toBe(4)
    expect(outcome.toolCalls).toBe(3)
    // 最后一轮它还在要工具（坏网关才做得到）→ 带着已有文本往下走 + 一条非致命 error，
    //   而不是抛：抛出去会把"模型有点怪"升级成整步崩溃，而下游的 schema 校验
    //   本来就会把"这不是一张合法故事表"说得更清楚
    expect(
      sink.events.some((one) => one.kind === 'error' && one.code === 'tool-budget-exhausted'),
    ).toBe(true)
  })

  it('★ 到顶那一条要**说出来**（静默截断的症状是"故事莫名其妙短了"，且没有任何提示）', async () => {
    const fake = scripted([callOf('c1', 'read_shelf'), { text: '我知道的就这些' }])
    const sink = collect()
    const outcome = await completeWithTools(
      { system: 's', user: 'u' },
      { text: fake.text, tools: [SHELF], maxSteps: 1, emit: sink.emit },
    )
    // 没有"到顶"那条 error（因为它在这一轮停下来了），但文本是它自己给的
    expect(outcome.text).toBe('我知道的就这些')
    expect(sink.events.some((one) => one.kind === 'error')).toBe(false)
  })

  it('最后那一轮拿到的文本就是答复（不是空串）', async () => {
    const fake = scripted([callOf('c1', 'read_shelf'), { text: '我知道的就这些' }])
    const outcome = await completeWithTools(
      { system: 's', user: 'u' },
      { text: fake.text, tools: [SHELF], maxSteps: 1 },
    )
    expect(outcome.text).toBe('我知道的就这些')
  })
})

/* 判据 8：不传 tools 时一个字都不变 */

describe('★ 判据 8：不带工具那条路不受影响', () => {
  it('`completeWithTools` 只在有工具时出现；引擎别处走的是老路（这一条钉住形状）', async () => {
    const fake = scripted([{ text: '答案' }])
    await completeWithTools({ system: 's', user: 'u' }, { text: fake.text, tools: [SHELF] })
    // messages 只有 system + user 两条，且顺序与老路一致
    expect(fake.seen[0]?.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ])
  })
})

/* 时钟 */

/** 每次调用往后走 250ms，于是 `ms` 可断言，不依赖真实时间 */
function ticking(): () => number {
  let at = 1_760_000_000_000
  return () => {
    at += 250
    return at
  }
}
