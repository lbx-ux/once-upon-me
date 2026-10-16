/**
 * openai-text-stream.test.ts —— 流式适配器（工单 07 §一）
 *
 * 这一组测试的全部意义是一句话：**流式不许悄悄改输出**。
 * 所以最重的一条是"同一份响应，两条路径的规划结果逐字段相等"——
 * 它不是"实现细节的测试"，它是横评数字能不能跨口径比较的前提：
 * 规划通过率是按同一条 prompt 算的，两条路给出不同的文本，那个数字就没有意义了。
 *
 * 一次网络都不发：`HttpDeps.fetchImpl` 是可注入的（见 http.ts 里那段理由）。
 * 喂进去的 SSE 是**按字节切碎**的——包括把中文切成两半、把 `data:` 前缀切成两半，
 * 因为"一次 read() 回来的可能是一行半"正是这一层最容易错的地方。
 */

import { describe, expect, it } from 'vitest'

import { planStory } from '../plan.ts'
import type { StoryPlanInput } from '../../prompts/story-plan.ts'
import { createOpenAiText } from './openai-text.ts'
import type { TextDelta } from './types.ts'

/* ───────────────────────── 造一份"录制响应" ───────────────────────── */

const PLAN = {
  title: '云上的恐龙',
  nodes: [
    {
      scene: '草地上，小宇抬头看云',
      body: ['云变成了一条恐龙的背。', '他踮起脚，想摸一摸。'],
      imagePrompt: '午后草地，孩子仰头，远处一朵长背脊的云',
      mood: 'wonder',
    },
    {
      scene: '云恐龙低下头',
      body: ['恐龙说：上来吧。'],
      imagePrompt: '云朵俯身贴近草地，孩子伸手',
      mood: 'joy',
    },
    {
      scene: '他站在云背上',
      body: ['风从耳朵旁边跑过去。'],
      imagePrompt: '孩子站在云背上，风吹起头发',
      mood: 'wonder',
    },
  ],
}
const RECORDED_TEXT = JSON.stringify(PLAN)

/** 一整段文本 → 一串 OpenAI 兼容的 SSE 帧（每 7 个字符一帧，故意切得很碎） */
function sseBody(text: string, opts: { reasoningPrefix?: string } = {}): string {
  const frames: string[] = [': keep-alive\n\n']
  if (opts.reasoningPrefix) {
    frames.push(
      `data: ${JSON.stringify({ model: 'm-1', choices: [{ delta: { reasoning_content: opts.reasoningPrefix } }] })}\n\n`,
    )
  }
  for (let i = 0; i < text.length; i += 7) {
    frames.push(
      `data: ${JSON.stringify({
        model: 'm-1',
        choices: [{ delta: { content: text.slice(i, i + 7) } }],
      })}\n\n`,
    )
  }
  frames.push(`data: ${JSON.stringify({ model: 'm-1', usage: { completion_tokens: 42 } })}\n\n`)
  frames.push('data: [DONE]\n\n')
  return frames.join('')
}

/** 把整段 SSE 按字节切碎成若干块，切点故意落在多字节字符与 `data:` 前缀中间 */
function chunked(body: string, pieces: number): Response {
  const bytes = new TextEncoder().encode(body)
  const cuts = [1, Math.floor(bytes.length / 3), Math.floor(bytes.length / 3) + 1]
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < bytes.length), bytes.length]
  const chunks: Uint8Array[] = []
  for (let i = 0; i < bounds.length - 1; i += 1) {
    chunks.push(bytes.slice(bounds[i] ?? 0, bounds[i + 1] ?? bytes.length))
  }
  void pieces
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

function fetchReturning(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch
}

function depsWith(response: Response): {
  baseUrl: string
  apiKey: string
  fetchImpl: typeof fetch
} {
  return {
    baseUrl: 'http://example.invalid/v1',
    apiKey: 'test-key-not-a-secret',
    fetchImpl: fetchReturning(response),
  }
}

const REQUEST = { system: 's', user: 'u', temperature: 0.8 }
const INPUT: StoryPlanInput = {
  childName: '小宇',
  nameReading: 'xiǎo yǔ',
  ageBand: '4-6',
  interestTags: ['恐龙'],
  lookTags: [],
  theme: '勇气',
  form: 'solo',
  pages: 3,
}

/* ───────────────────────── 一、拼回来的文本 ───────────────────────── */

describe('stream · 把碎帧拼回一整段', () => {
  it('★ 跨 chunk 的半行能接起来：拼回来的正文与录制的那段逐字节相等', async () => {
    const text = createOpenAiText(depsWith(chunked(sseBody(RECORDED_TEXT), 3)), 'm-1')
    const response = await text.stream(REQUEST, undefined, () => {})
    expect(response.text).toBe(RECORDED_TEXT)
  })

  it('delta 累加起来就是正文，而且每一段都标 streamed:true', async () => {
    const text = createOpenAiText(depsWith(chunked(sseBody(RECORDED_TEXT), 3)), 'm-1')
    const deltas: TextDelta[] = []
    const response = await text.stream(REQUEST, undefined, (delta) => deltas.push({ ...delta }))
    expect(deltas.map((d) => d.text).join('')).toBe(response.text)
    expect(deltas.every((d) => d.streamed)).toBe(true)
    // 一帧七字：段数必然多于一段（否则就是"一次吐完"，那是回放才该有的样子）
    expect(deltas.length).toBeGreaterThan(10)
  })

  it('`[DONE]` 不是内容，心跳注释与空的 usage 帧也不是', async () => {
    const text = createOpenAiText(depsWith(chunked(sseBody('{"title":"ok ok ok"}'), 3)), 'm-1')
    const response = await text.stream(REQUEST, undefined, () => {})
    expect(response.text).toBe('{"title":"ok ok ok"}')
    expect(response.text).not.toContain('[DONE]')
    expect(response.text).not.toContain('keep-alive')
  })

  it('★ 思考链（reasoning_content）一个字都不进正文', async () => {
    const text = createOpenAiText(
      depsWith(chunked(sseBody(RECORDED_TEXT, { reasoningPrefix: '先想想…' }), 3)),
      'm-1',
    )
    const deltas: TextDelta[] = []
    const response = await text.stream(REQUEST, undefined, (delta) => deltas.push({ ...delta }))
    expect(response.text).toBe(RECORDED_TEXT)
    expect(deltas.map((d) => d.text).join('')).not.toContain('先想想')
  })
})

/* ───────────────────────── 二、两条路径逐字段相等 ───────────────────────── */

describe('stream · 与 complete() 的等价性（工单 07 §一.1）', () => {
  it('★ 同一份录制响应：全量与流式跑出来的规划结果逐字段相等', async () => {
    // 全量：普通的 chat/completions 回包
    const jsonResponse = new Response(
      JSON.stringify({
        model: 'm-1',
        choices: [{ message: { role: 'assistant', content: RECORDED_TEXT } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const viaComplete = createOpenAiText(depsWith(jsonResponse), 'm-1')
    // 流式：同一段文本，切碎成 SSE 帧
    const viaStream = createOpenAiText(depsWith(chunked(sseBody(RECORDED_TEXT), 3)), 'm-1')

    const eventsA: unknown[] = []
    const eventsB: unknown[] = []
    const a = await planStory(INPUT, {
      text: viaComplete,
      form: 'solo',
      emit: (payload) => eventsA.push(payload),
    })
    const streamed: TextDelta[] = []
    const b = await planStory(INPUT, {
      text: viaStream,
      form: 'solo',
      onDelta: (delta) => streamed.push({ ...delta }),
      emit: (payload) => eventsB.push(payload),
    })

    // 这就是判据：规划结果**逐字段相等**（树、尝试次数、失败清单、提示词版本）
    expect(b).toEqual(a)
    // 事件也一样——否则"过程面板上看到的"与"引擎里发生的"会分成两份事实
    expect(eventsB).toEqual(eventsA)
    // 而且流式这一趟确实收到过增量（不然上面那条相等是"两条路都没流"换来的）
    expect(streamed.length).toBeGreaterThan(10)
  })

  it('走流式时，增量先到、正式结果后到（规划期的顺序不能倒过来）', async () => {
    const viaStream = createOpenAiText(depsWith(chunked(sseBody(RECORDED_TEXT), 3)), 'm-1')
    const order: string[] = []
    await planStory(INPUT, {
      text: viaStream,
      form: 'solo',
      onDelta: () => order.push('delta'),
      emit: (payload) => order.push(payload.kind),
    })
    expect(order[0]).toBe('stage')
    expect(order.indexOf('delta')).toBeGreaterThan(-1)
    expect(order.indexOf('plan-ready')).toBeGreaterThan(order.indexOf('delta'))
  })
})

/* ───────────────────────── 三、两个超时不是同一个数 ───────────────────────── */

describe('stream · 超时', () => {
  it('★ 空闲超时：上游开着连接一个字节都不发 → 报"空闲超时"（而不是一直挂着）', async () => {
    const never = new Response(
      new ReadableStream<Uint8Array>({
        start() {
          /* 永远不 enqueue、也不 close：这就是"上游卡住"的样子 */
        },
      }),
      { status: 200 },
    )
    const text = createOpenAiText(depsWith(never), 'm-1')
    await expect(
      text.stream(REQUEST, { idleTimeoutMs: 20, timeoutMs: 60_000 }, () => {}),
    ).rejects.toThrow(/空闲超时/)
  })

  it('★ 总超时：一点点慢慢吐、但总也不结束 → 报"总超时"（与空闲超时分开说）', async () => {
    /**
     * 读侧一旦被 cancel（超时后 requestSse 会 cancel），就不许再往控制器里塞东西——
     * 否则 enqueue 抛"控制器已关闭"，测试会报一个与被测行为无关的错。
     */
    let closed = false
    let tick: ReturnType<typeof setInterval> | null = null
    const trickle = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          // 每 15ms 吐一个心跳帧：永远不空闲（有空闲超时也不该响），但永远不结束
          tick = setInterval(() => {
            if (closed) return
            try {
              controller.enqueue(new TextEncoder().encode(': tick\n\n'))
            } catch {
              closed = true
            }
          }, 15)
        },
        cancel() {
          closed = true
          if (tick) clearInterval(tick)
        },
      }),
      { status: 200 },
    )
    const text = createOpenAiText(depsWith(trickle), 'm-1')
    await expect(
      text.stream(REQUEST, { idleTimeoutMs: 10_000, timeoutMs: 60 }, () => {}),
    ).rejects.toThrow(/总超时/)
  })

  it('非 2xx：把网关那句原文带出来，不当成"流断了"', async () => {
    const bad = new Response(
      JSON.stringify({ error: { code: 'invalid_api_key', message: '密钥无效' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )
    const text = createOpenAiText(depsWith(bad), 'm-1')
    await expect(text.stream(REQUEST, undefined, () => {})).rejects.toThrow(/401/)
    await expect(text.stream(REQUEST, undefined, () => {})).rejects.toThrow(/密钥无效/)
  })

  it('★ 最后一帧没有结尾空行时也不丢（网关直接关连接的那种）', async () => {
    // 前半截正常分帧，**最后一段正文没有结尾空行**——严格按 SSE 规范它不算一帧。
    // 去掉 flush 的话正文会停在 '{"title"'：没有报错、没有日志，就是少了一段。
    const frame = (content: string): string =>
      `data: ${JSON.stringify({ model: 'm-1', choices: [{ delta: { content } }] })}`
    const body = `${frame('{"title"')}\n\n${frame(':"云"}')}`
    const response = await createOpenAiText(depsWith(chunked(body, 1)), 'm-1').stream(
      REQUEST,
      undefined,
      () => {},
    )
    expect(response.text).toBe('{"title":"云"}')
  })

  it('一个正文都没有（只有思考链）→ 说清是预算被思考吃掉了', async () => {
    const onlyThinking =
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '想了很久' } }] })}\n\n` +
      'data: [DONE]\n\n'
    const text = createOpenAiText(
      depsWith(
        new Response(onlyThinking, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
      'm-1',
    )
    await expect(text.stream(REQUEST, undefined, () => {})).rejects.toThrow(/reasoning_content=4/)
  })
})
