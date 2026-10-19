/**
 * protocol.test.ts —— MCP 协议层的单测
 *
 * 这一组用例盯的是**规范**而不是"我的实现"，所以每条用例的标题就是它防的那种坏法。
 * 其中三条是这一层最容易写错、而错了以后现场离成因最远的：
 *
 * 1. **通知回了话** → 客户端把响应错配到别处，整条会话开始错位（文件头第 1 条）。
 * 2. **`id` 被 `String()` 了一道** → 数字 id 变成字符串 id，客户端按 `===` 找不到响应，
 *    表现为"卡在一个永远不来的回复上"（文件头第 2 条）。
 * 3. **进度通知永远发 / 永远不发** → 两种坏法读数完全不同，所以两边都要测
 *    （只测一边的话，一个"忽略 progressToken、无条件发通知"的实现会全绿）。
 */

import { describe, expect, it } from 'vitest'

import {
  dispatch,
  ERROR_CODES,
  INITIAL_SESSION,
  LATEST_PROTOCOL_VERSION,
  levelAtLeast,
  LOG_LEVELS,
  notificationsFor,
  PROTOCOL_VERSIONS,
  type Session,
  type ToolRuntime,
  type ToolSpec,
} from './protocol.ts'
import type { EngineEvent } from '../engine/events.ts'

/* ───────────────────────── 假的运行时 ───────────────────────── */

const SPECS: ToolSpec[] = [
  { name: 'list_children', description: '有哪些孩子', inputSchema: { type: 'object' } },
  { name: 'read_shelf', description: '书架', inputSchema: { type: 'object' } },
]

/** 记录每一次调用的入参，测试要断言"参数真的递进去了" */
type CallLog = { name: string; args: unknown; events: EngineEvent[] }

function fakeRuntime(options: {
  result?: { text: string; isError?: boolean }
  throwWith?: string
  emit?: EngineEvent[]
}): { runtime: ToolRuntime; log: CallLog[] } {
  const log: CallLog[] = []
  return {
    log,
    runtime: {
      specs: () => SPECS,
      async call({ name, args, notify }) {
        const seen: EngineEvent[] = []
        for (const event of options.emit ?? []) {
          seen.push(event)
          notify(event)
        }
        log.push({ name, args, events: seen })
        if (options.throwWith) throw new Error(options.throwWith)
        return options.result ?? { text: '好' }
      },
    },
  }
}

function event(seq: number, payload: Partial<EngineEvent> = {}): EngineEvent {
  return {
    seq,
    at: 1_760_000_000_000 + seq,
    stage: 'illustrating',
    pageNo: seq,
    ...payload,
  } as EngineEvent
}

/** 跑一行，收集写出去的行 */
async function run(
  line: unknown,
  options: {
    session?: Session
    runtime?: ToolRuntime
  } = {},
): Promise<{ out: Record<string, unknown>[]; session: Session; notes: string[] }> {
  const out: string[] = []
  const outcome = await dispatch(
    typeof line === 'string' ? line : JSON.stringify(line),
    options.session ?? INITIAL_SESSION,
    options.runtime ?? fakeRuntime({}).runtime,
    (one) => out.push(one),
  )
  return {
    out: out.map((one) => JSON.parse(one) as Record<string, unknown>),
    session: outcome.session,
    notes: outcome.notes,
  }
}

/** 握手过的那一份会话（大多数用例的起点） */
async function ready(): Promise<Session> {
  const { session } = await run({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: LATEST_PROTOCOL_VERSION },
  })
  return session
}

/* ───────────────────────── 传输层的两条 ───────────────────────── */

describe('行式输入', () => {
  it('空行什么都不做（客户端在每条消息后面补一个换行是常态）', async () => {
    const { out, notes } = await run('   ')
    expect(out).toEqual([])
    expect(notes).toEqual([])
  })

  it('非法 JSON 回 -32700 且**不退出**——坏的那一行后面还有正常的', async () => {
    const first = await run('{"jsonrpc":"2.0", 这不是 JSON')
    expect(first.out).toHaveLength(1)
    expect((first.out[0]?.['error'] as { code: number }).code).toBe(ERROR_CODES.parse)
    // ★ id 只能是 null：这行根本没解析出来，没有 id 可回
    expect(first.out[0]?.['id']).toBeNull()

    // 同一份 session 继续用，下一条正常消息照常处理
    const second = await run({ jsonrpc: '2.0', id: 7, method: 'ping' })
    expect(second.out[0]?.['id']).toBe(7)
  })

  it('不是对象的 JSON（数组 / 字符串 / 数字）回 -32600', async () => {
    for (const bad of ['[]', '"hello"', '42', 'null']) {
      const { out } = await run(bad)
      expect((out[0]?.['error'] as { code: number }).code).toBe(ERROR_CODES.invalidRequest)
    }
  })
})

/* ───────────────────────── 通知不许回话 ───────────────────────── */

describe('★ 通知（不带 id）绝不回话', () => {
  it('notifications/initialized 一条都不发', async () => {
    const { out, session } = await run(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { session: await ready() },
    )
    expect(out).toEqual([])
    expect(session.initialized).toBe(true)
  })

  it('不认识的通知也不回话，只在 stderr 记一笔', async () => {
    const { out, notes } = await run(
      { jsonrpc: '2.0', method: 'notifications/something-new' },
      { session: await ready() },
    )
    expect(out).toEqual([])
    expect(notes.join('')).toContain('不认识的通知')
  })

  it('★ 握手之前来的**通知**也不回话（回一条错误就是错配的种子）', async () => {
    const { out, notes } = await run({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(out).toEqual([])
    expect(notes.join('')).toContain('initialize 之前')
  })

  it('id 为 null 的请求按通知处理（JSON-RPC 2.0 §4 把 null 排除在 id 之外）', async () => {
    const { out } = await run({ jsonrpc: '2.0', id: null, method: 'ping' })
    expect(out).toEqual([])
  })
})

/* ───────────────────────── id 原样回 ───────────────────────── */

describe('★ id 原样回（不许 String()）', () => {
  it('数字 id 回数字', async () => {
    const { out } = await run({ jsonrpc: '2.0', id: 42, method: 'ping' })
    expect(out[0]?.['id']).toBe(42)
    expect(typeof out[0]?.['id']).toBe('number')
  })

  it('字符串 id 回字符串', async () => {
    const { out } = await run({ jsonrpc: '2.0', id: 'abc-1', method: 'ping' })
    expect(out[0]?.['id']).toBe('abc-1')
  })

  it('数字 id 与字符串 id 不会被归一成同一个值', async () => {
    const a = await run({ jsonrpc: '2.0', id: 7, method: 'ping' })
    const b = await run({ jsonrpc: '2.0', id: '7', method: 'ping' })
    expect(a.out[0]?.['id']).not.toBe(b.out[0]?.['id'])
  })
})

/* ───────────────────────── 版本协商 ───────────────────────── */

describe('initialize：版本协商三条分支', () => {
  it('客户端要的版本在表里 → 回它那一个', async () => {
    for (const version of PROTOCOL_VERSIONS) {
      const { out, session } = await run({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: version },
      })
      const result = out[0]?.['result'] as { protocolVersion: string }
      expect(result.protocolVersion).toBe(version)
      expect(session.protocolVersion).toBe(version)
    }
  })

  it('客户端报一个我们不认识的版本 → 回我们最新的那一个（不是报错）', async () => {
    const { out } = await run({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2099-01-01' },
    })
    expect((out[0]?.['result'] as { protocolVersion: string }).protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION,
    )
  })

  it('压根没报版本 → 回我们最新的那一个', async () => {
    const { out } = await run({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect((out[0]?.['result'] as { protocolVersion: string }).protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION,
    )
  })

  it('只声明真实现了的能力：tools 与 logging，**没有** resources / prompts', async () => {
    const { out } = await run({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const capabilities = (out[0]?.['result'] as { capabilities: Record<string, unknown> })
      .capabilities
    expect(Object.keys(capabilities).sort()).toEqual(['logging', 'tools'])
  })

  it('握手之前 tools/call 被拒，且给的是 -32600（不是借来的 -32002）', async () => {
    const { out } = await run({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'read_shelf' },
    })
    const error = out[0]?.['error'] as { code: number; message: string }
    expect(error.code).toBe(ERROR_CODES.invalidRequest)
    expect(error.message).toContain('initialize')
  })

  it('握手之前 ping 是放行的（规范要求它能探活）', async () => {
    const { out } = await run({ jsonrpc: '2.0', id: 3, method: 'ping' })
    expect(out[0]?.['result']).toEqual({})
  })
})

/* ───────────────────────── tools/list ───────────────────────── */

describe('tools/list', () => {
  it('只出 name / description / inputSchema 三件，不带 handler 与 ctx', async () => {
    const { out } = await run(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { session: await ready() },
    )
    const tools = (out[0]?.['result'] as { tools: Record<string, unknown>[] }).tools
    expect(tools).toHaveLength(SPECS.length)
    for (const tool of tools) {
      expect(Object.keys(tool).sort()).toEqual(['description', 'inputSchema', 'name'])
    }
  })
})

/* ───────────────────────── tools/call ───────────────────────── */

describe('tools/call', () => {
  it('把 name 与 arguments 原样递给运行时', async () => {
    const fake = fakeRuntime({ result: { text: '书架上是空的' } })
    const { out } = await run(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'read_shelf', arguments: { k: 3 } },
      },
      { session: await ready(), runtime: fake.runtime },
    )
    expect(fake.log[0]?.name).toBe('read_shelf')
    expect(fake.log[0]?.args).toEqual({ k: 3 })
    const result = out[0]?.['result'] as { content: { type: string; text: string }[] }
    expect(result.content).toEqual([{ type: 'text', text: '书架上是空的' }])
    expect(out[0]?.['result']).not.toHaveProperty('isError')
  })

  it('缺 name 回 -32602', async () => {
    const { out } = await run(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} },
      { session: await ready() },
    )
    expect((out[0]?.['error'] as { code: number }).code).toBe(ERROR_CODES.invalidParams)
  })

  it('工具**自己**说没做成 → isError:true（不是 JSON-RPC 错误）', async () => {
    const fake = fakeRuntime({ result: { text: '这本书不存在', isError: true } })
    const { out } = await run(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_book' } },
      { session: await ready(), runtime: fake.runtime },
    )
    expect(out[0]).not.toHaveProperty('error')
    expect((out[0]?.['result'] as { isError?: boolean }).isError).toBe(true)
  })

  it('工具**抛了** → -32603（协议层坏了，与上面那条分开）', async () => {
    const fake = fakeRuntime({ throwWith: '盘读不出来' })
    const { out, notes } = await run(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_book' } },
      { session: await ready(), runtime: fake.runtime },
    )
    expect((out[0]?.['error'] as { code: number }).code).toBe(ERROR_CODES.internal)
    expect(notes.join('')).toContain('盘读不出来')
  })
})

/* ───────────────────────── 进度通知 ───────────────────────── */

describe('★ 进度通知：给 token 才发，不给一条都不发', () => {
  const events = [
    event(1, { kind: 'stage', stage: 'illustrating', phase: 'begin' }),
    // 通过的核对：`isDisplayable` 判它不占日志行
    event(2, {
      kind: 'consistency',
      verdict: 'pass',
      score: 0.95,
      threshold: 0.8,
      missedAnchors: [],
    }),
    event(3, { kind: 'illustration', assetPath: 'a.webp', modelId: 'm' }),
  ]

  it('给了 progressToken → 每条事件一条 progress', async () => {
    const fake = fakeRuntime({ emit: events })
    const { out } = await run(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'plan_book', _meta: { progressToken: 'tok-1' } },
      },
      { session: await ready(), runtime: fake.runtime },
    )
    const progress = out.filter((one) => one['method'] === 'notifications/progress')
    expect(progress).toHaveLength(events.length)
    expect((progress[0]?.['params'] as { progressToken: string }).progressToken).toBe('tok-1')
    // ★ progress 用的是事件的 seq，不是自增计数
    expect((progress[2]?.['params'] as { progress: number }).progress).toBe(3)
  })

  it('★ 不给 progressToken → 一条 progress 都不发（对照组）', async () => {
    const fake = fakeRuntime({ emit: events })
    const { out } = await run(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'plan_book' } },
      { session: await ready(), runtime: fake.runtime },
    )
    expect(out.filter((one) => one['method'] === 'notifications/progress')).toHaveLength(0)
  })

  it('日志通知只发 isDisplayable 的那些（通过的核对不占行）', async () => {
    const fake = fakeRuntime({ emit: events })
    const { out } = await run(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'plan_book' } },
      { session: await ready(), runtime: fake.runtime },
    )
    const messages = out.filter((one) => one['method'] === 'notifications/message')
    expect(messages).toHaveLength(2)
    const seqs = messages.map(
      (one) => ((one['params'] as { data: { event: EngineEvent } }).data.event as EngineEvent).seq,
    )
    expect(seqs).toEqual([1, 3])
  })

  it('★ 通知排在响应**前面**（客户端不该先看到"做完了"再看到过程）', async () => {
    const fake = fakeRuntime({ emit: events })
    const { out } = await run(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'plan_book', _meta: { progressToken: 1 } },
      },
      { session: await ready(), runtime: fake.runtime },
    )
    const last = out[out.length - 1] as Record<string, unknown>
    expect(last['id']).toBe(5)
    expect(last).toHaveProperty('result')
  })

  it('人话来自 describeEvent，这一层不另写一份', async () => {
    const fake = fakeRuntime({
      emit: [event(4, { kind: 'illustration', assetPath: 'p.webp', modelId: 'm' })],
    })
    const { out } = await run(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'plan_book', _meta: { progressToken: 1 } },
      },
      { session: await ready(), runtime: fake.runtime },
    )
    const message = (out[0]?.['params'] as { message: string }).message
    expect(message).toBe('第 4 页画好了')
  })
})

/* ───────────────────────── 日志等级 ───────────────────────── */

describe('logging/setLevel', () => {
  it('合法等级被接受，并且真的改了阈值', async () => {
    const fake = fakeRuntime({
      emit: [event(1, { kind: 'illustration', assetPath: 'a', modelId: 'm' })],
    })
    const { out, session } = await run(
      { jsonrpc: '2.0', id: 2, method: 'logging/setLevel', params: { level: 'error' } },
      { session: await ready() },
    )
    expect(out[0]?.['result']).toEqual({})
    expect(session.logLevel).toBe('error')

    // 阈值提到 error 之后，info 那一档的日志通知不再发
    const { out: after } = await run(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'plan_book' } },
      { session, runtime: fake.runtime },
    )
    expect(after.filter((one) => one['method'] === 'notifications/message')).toHaveLength(0)
  })

  it('非法等级回 -32602，且**不改**会话（不许静默取一个默认值）', async () => {
    const { out, session } = await run(
      { jsonrpc: '2.0', id: 2, method: 'logging/setLevel', params: { level: 'verbose' } },
      { session: await ready() },
    )
    expect((out[0]?.['error'] as { code: number }).code).toBe(ERROR_CODES.invalidParams)
    expect(session.logLevel).toBe('info')
  })

  it('levelAtLeast 是"至少"而不是"相等"', () => {
    expect(levelAtLeast('error', 'info')).toBe(true)
    expect(levelAtLeast('debug', 'info')).toBe(false)
    expect(levelAtLeast('info', 'info')).toBe(true)
    expect(LOG_LEVELS).toHaveLength(8)
  })
})

/* ───────────────────────── 未知方法 ───────────────────────── */

describe('未知方法', () => {
  it('请求 → -32601', async () => {
    const { out } = await run(
      { jsonrpc: '2.0', id: 8, method: 'resources/list' },
      { session: await ready() },
    )
    expect((out[0]?.['error'] as { code: number }).code).toBe(ERROR_CODES.methodNotFound)
    expect((out[0]?.['error'] as { message: string }).message).toContain('resources/list')
  })
})

/* ───────────────────────── 纯函数那一条 ───────────────────────── */

describe('notificationsFor 是纯的', () => {
  it('同一个事件同样的入参 → 同样的输出（可重放、可断言）', () => {
    const one = event(2, { kind: 'retry', maxAttempts: 3, reason: '不太像' })
    const ctx = { progressToken: 't', level: 'info' as const }
    expect(notificationsFor(one, ctx)).toEqual(notificationsFor(one, ctx))
  })

  it('没有 progressToken 且不可显示 → 一条通知都没有', () => {
    const quiet = event(2, {
      kind: 'consistency',
      verdict: 'pass',
      score: 0.9,
      threshold: 0.8,
      missedAnchors: [],
    })
    expect(notificationsFor(quiet, { level: 'info' })).toEqual([])
  })
})
