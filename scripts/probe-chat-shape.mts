/**
 * probe-chat-shape.mts —— 诊断：`/chat/completions` 的回复为什么读不到 content
 *
 * 为什么要单独一个脚本：`openai-text.ts` 把**三种完全不同的情况**压成了同一句
 * 「文本响应里没有 content」——
 *
 * | 真实情况 | findFirst(['content']) 的结果 | 报出来的话 |
 * |---|---|---|
 * | content 是多段数组 `[{type:'text',…}]` | 返回数组（非空字符串都会返回） | 同一句 |
 * | content 是 `''`，正文在 `reasoning_content`（思考模型） | 跳过空串，翻不到 | 同一句 |
 * | 响应里确实没有正文（拒绝/200 里套错误） | null | 同一句 |
 *
 * 只报同一句话，就分不清"我的适配器不会读"和"这家模型不行"——
 * 前者是我的 bug，后者才是横评结论。所以先探形状，再下判断。
 *
 * 本脚本**只打印结构**（键名、类型、长度、finish_reason），不打印正文：
 * 目的是看清信封长什么样，不是评判信写得好不好。
 *
 * ```bash
 * node scripts/probe-chat-shape.mts --models=qwen3.8-flash,glm-5.3-flash --jsonModes=none,object
 * ```
 */

import { arg, readEnv } from './env.mts'

type Shape = {
  jsonMode: string
  model: string
  status: number
  /** 从 message 里读到的正文长度：findFirst(['content']) 的原始所见 */
  contentKind: string
  contentLen: number
  /** 思考模型的思考链长度。它是"正文为空"的头号嫌疑，所以要单独看 */
  reasoningLen: number
  messageKeys: string[]
  finishReason: string
  completionTokens: number | undefined
  traceId: string
  error?: string
}

/** 递归描述一个值：类型 + 长度，不吐正文 */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `string(${value.length})`
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === 'object') return `object{${Object.keys(value as object).join(',')}}`
  return typeof value
}

function walk(obj: unknown, keys: readonly string[]): { hit: unknown; found: boolean } {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const got = walk(item, keys)
      if (got.found) return got
    }
    return { hit: null, found: false }
  }
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    for (const key of keys) {
      if (key in record) return { hit: record[key], found: true }
    }
    for (const value of Object.values(record)) {
      const got = walk(value, keys)
      if (got.found) return got
    }
  }
  return { hit: null, found: false }
}

async function probe(
  baseUrl: string,
  apiKey: string,
  model: string,
  jsonMode: string,
): Promise<Shape> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: '你只输出 JSON，不要任何解释。' },
      {
        role: 'user',
        content: '给 4-6 岁小孩写一个两页的故事开头，输出 {"title":"…","pages":["…","…"]}',
      },
    ],
    temperature: 0.8,
    max_tokens: 1200,
  }
  if (jsonMode === 'object') body['response_format'] = { type: 'json_object' }

  const started = Date.now()
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  })
  const raw = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = { _unparsed: raw.slice(0, 200) }
  }
  const content = walk(parsed, ['content'])
  const reasoning = walk(parsed, ['reasoning_content'])
  const message = walk(parsed, ['message'])
  const finish = walk(parsed, ['finish_reason'])
  const usage = walk(parsed, ['completion_tokens'])
  const trace = walk(parsed, ['traceId', 'trace_id'])
  process.stdout.write(
    `  ${model} · ${jsonMode}：HTTP ${response.status} · ${((Date.now() - started) / 1000).toFixed(1)}s` +
      `${response.ok ? '' : ` · ${raw.slice(0, 160)}`}\n`,
  )
  return {
    jsonMode,
    model,
    status: response.status,
    contentKind: content.found ? describe(content.hit) : '**键不存在**',
    contentLen: typeof content.hit === 'string' ? content.hit.length : -1,
    reasoningLen: typeof reasoning.hit === 'string' ? reasoning.hit.length : 0,
    messageKeys:
      message.found && message.hit && typeof message.hit === 'object'
        ? Object.keys(message.hit as object)
        : [],
    finishReason: finish.found ? String(finish.hit) : '—',
    completionTokens: typeof usage.hit === 'number' ? usage.hit : undefined,
    traceId: trace.found ? String(trace.hit) : '',
    error: response.ok ? undefined : raw.slice(0, 200),
  }
}

async function main(): Promise<void> {
  const env = await readEnv()
  const baseUrl = env['LLM_BASE_URL'] ?? 'https://tokenrhythm.studio/v1'
  const apiKey = env['LLM_API_KEY'] ?? ''
  if (!apiKey) throw new Error('LLM_API_KEY 未配置，探不了形状')
  const models = arg('models', '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  const jsonModes = arg('jsonModes', 'none,object')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  if (models.length === 0) throw new Error('--models 必填')

  process.stdout.write(
    `探形状：${models.length} 个模型 × ${jsonModes.length} 个 JSON 档\n` +
      `读法：contentKind 是 **键不存在** = 回包里根本没有这个键；` +
      `string(0) = 键在但空；array(n) = 多段正文，适配器要拼起来\n\n`,
  )

  const shapes: Shape[] = []
  for (const model of models) {
    for (const mode of jsonModes) {
      try {
        shapes.push(await probe(baseUrl, apiKey, model, mode))
      } catch (err) {
        shapes.push({
          jsonMode: mode,
          model,
          status: 0,
          contentKind: '—',
          contentLen: -1,
          reasoningLen: 0,
          messageKeys: [],
          finishReason: '—',
          completionTokens: undefined,
          traceId: '',
          error: err instanceof Error ? err.message : String(err),
        })
        process.stdout.write(
          `  ${model} · ${mode}：抛错 ${err instanceof Error ? err.message : ''}\n`,
        )
      }
    }
  }

  process.stdout.write(
    '\n| 模型 | JSON 档 | HTTP | content | 长度 | 思考链长度 | message 的键 | finish_reason | completion_tokens |\n' +
      '|---|---|---|---|---|---|---|---|---|\n' +
      shapes
        .map(
          (s) =>
            `| ${s.model} | ${s.jsonMode} | ${s.status || s.error || '—'} | ${s.contentKind} | ` +
            `${s.contentLen < 0 ? '—' : s.contentLen} | ${s.reasoningLen} | ${s.messageKeys.join(' ') || '—'} | ` +
            `${s.finishReason} | ${s.completionTokens ?? '—'} |`,
        )
        .join('\n') +
      '\n',
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
