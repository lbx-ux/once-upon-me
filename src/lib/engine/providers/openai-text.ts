/**
 * openai-text.ts —— OpenAI 兼容的对话补全适配器
 *
 * 一个适配器覆盖一整类供应商：tokenrhythm 的对话模型、DeepSeek、通义千问、豆包、
 * 智谱、Kimi 都走 `POST {base}/chat/completions`，**只有 base、key、model 三个值不同**。
 * 所以模型名一律从环境变量来（registry.ts），本文件里不出现任何具体模型 id。
 *
 * 为什么不用各家 SDK（ADR-0002 / ADR-0004）：横评要求同一套提示词在候选之间跑，
 * 接口不统一就得写三份胶水；而"统一"这件事在这里 20 行 HTTP 就完成了。
 */

import { EngineError } from '../errors.ts'
import type { CallBudget, TextGenerator, TextRequest, TextResponse } from './types.ts'
import { findFirst, requestJson, traceOf, type HttpDeps } from './http.ts'

export type OpenAiTextOptions = {
  /** 强制 JSON 输出的方式。见下面 jsonShape() 的注释 */
  jsonMode?: 'none' | 'object' | 'schema'
  /** 调用方没指定时用哪个 token 预算。**预算随模型走，不随阶段走**，见下面注释 */
  defaultMaxTokens?: number
  /** 供应商特有的额外字段（各家参数名不一致时在这里补，不改接口） */
  extra?: Record<string, unknown>
}

/**
 * 一次文本生成的缺省超时。180s 是**给一整张故事表**的预算，不是给一句话的。
 * 它挡住的是"把慢误判成不会"这一类错——真要压到更低，得先有实测的 P95 时延。
 */
const DEFAULT_TEXT_TIMEOUT_MS = 180_000

/**
 * 缺省 token 预算。4096 是**规划阶段的输出形状**决定的（一张 6–20 页的故事表），
 * 不是随便取的，但它是**下界而不是够用线**：
 *
 * 实测（`scripts/probe-thinking-budget.mts`，同一 prompt 只改参数，2026-10-13）——
 * 思考模型会把这个预算整条吃光，正文一个字都不写：
 *
 * ```
 * qwen3.8-max   预算 4096 → 正文 0 字符，思考 9072 字符，finish_reason=length
 * qwen3.8-flash 预算 4096 → 正文 0 字符，思考 9407 字符，finish_reason=length
 * glm-5.3-flash 预算 4096 → 正文键都不存在，思考 10552 字符，finish_reason=length
 * ```
 *
 * 所以"预算"是**模型的属性**：思考模型要么给到 16000（实测 5373–7417 tokens 才写完），
 * 要么关掉思考（`enable_thinking:false`，实测 555–847 tokens 就够，便宜 5–7 倍）。
 * 这两条都由 `.env.local` 的 `LLM_MAX_TOKENS` / `LLM_THINKING` 决定，
 * 不写在规划阶段里——写在那里就等于把一个模型参数钉死成一个产品参数。
 */
const DEFAULT_TEXT_MAX_TOKENS = 4096

export function createOpenAiText(
  deps: HttpDeps,
  modelId: string,
  opts: OpenAiTextOptions = {},
): TextGenerator {
  const jsonMode = opts.jsonMode ?? 'object'
  return {
    id: `openai-text(${modelId})`,
    modelId,
    async complete(req: TextRequest, budget?: CallBudget): Promise<TextResponse> {
      if (!deps.apiKey) {
        throw new EngineError('provider-not-configured', 'LLM_API_KEY 未配置，文本能力不可用')
      }
      const messages: unknown[] = []
      if (req.system) messages.push({ role: 'system', content: req.system })
      messages.push({ role: 'user', content: req.user })

      const payload: Record<string, unknown> = {
        model: modelId,
        messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? opts.defaultMaxTokens ?? DEFAULT_TEXT_MAX_TOKENS,
        ...jsonShape(jsonMode, req.jsonSchema),
        ...(opts.extra ?? {}),
      }

      const body = await requestJson(deps, {
        method: 'POST',
        path: '/chat/completions',
        body: payload,
        signal: budget?.signal,
        // ★ 文本的缺省超时**不是** http.ts 那个 60s。两者量的是不同的东西：
        //   图像是同步出图（十几秒），文本是**生成一整张故事表**。实测 60s
        //   读不完 max 档的输出，而超时在这里最坏的后果不是慢——是它会被
        //   读成"这家不会出 JSON"，正式跑测里三个候选就这么变成了 0/10。
        //   优先级仍然是"调用级 > deps（.env 的 LLM_TIMEOUT_MS）> 本条缺省"。
        timeoutMs: budget?.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS,
      })

      const message = messageObject(body)
      // ★ 先定位 `message` 再读它的 `content`，**不是**直接 findFirst(body, ['content'])：
      //   findFirst 会跳过空串继续往深处翻，正文是 '' 时它会翻到别的同名键上
      //   （回包里回显的请求、provider_specific_fields 都可能有 content），
      //   于是"读不到"变成"读到别人的"——那比读不到更难查。
      const contentValue = message ? message['content'] : findFirst(body, ['content'])
      const text = flattenContent(contentValue)
      if (text === '') {
        throw new EngineError('provider-call-failed', explainEmptyContent(body, message), {
          traceId: traceOf(body) || undefined,
          detail: body,
        })
      }
      return {
        text,
        modelId: String(findFirst(body, ['model']) ?? modelId),
        usage: usageOf(body),
        traceId: traceOf(body) || undefined,
      }
    },
  }
}

/**
 * JSON 约束的三档，**默认 `object`**，这是实测决定的：
 *
 * - `none` 什么都不加，靠 prompt 里的 schema 文本 + 我们自己的校验（判据 1 测的就是这条路的通过率）
 * - `object` `response_format: {type:'json_object'}`，OpenAI 兼容层的最大公约数
 * - `schema` 再加 `json_schema` 严格模式。**各家支持度不一致**，所以它必须显式打开，
 *   不能默认——默认了就会在"这家不支持"时静默退回 none，而横评报告里写的却是强制模式。
 *
 * 横评（scripts/w1-text-bakeoff.mts）要按档分别测，档位是判据的一部分，不是实现细节。
 */
function jsonShape(mode: 'none' | 'object' | 'schema', schema: unknown): Record<string, unknown> {
  if (mode === 'none') return {}
  if (mode === 'object') return { response_format: { type: 'json_object' } }
  if (!schema) return { response_format: { type: 'json_object' } }
  return {
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'story_plan', strict: true, schema },
    },
  }
}

/**
 * 找到回包里的 `message` 对象（哪一层都行：`choices[0].message` 是常规位置，
 * 但这一层存在的意义就是容忍各家把它挪走）。
 *
 * 找到之后**从它身上读 content**，而不是继续深度搜索同名键——理由见 complete() 里的注释。
 */
function messageObject(body: unknown): Record<string, unknown> | null {
  const walk = (obj: unknown): Record<string, unknown> | null => {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const hit = walk(item)
        if (hit) return hit
      }
      return null
    }
    if (obj && typeof obj === 'object') {
      const record = obj as Record<string, unknown>
      const message = record['message']
      if (message && typeof message === 'object' && !Array.isArray(message)) {
        return message as Record<string, unknown>
      }
      for (const value of Object.values(record)) {
        const hit = walk(value)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(body)
}

/**
 * 正文取成字符串。多段正文（`content: [{type:'text',text:'…'}]`，部分供应商的默认形状）
 * 在这里拼起来——**这是我们该做的事，不是模型的毛病**，所以它不报错。
 */
function flattenContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) =>
        part && typeof part === 'object' ? (part as Record<string, unknown>)['text'] : part,
      )
      .filter((part): part is string => typeof part === 'string')
      .join('')
  }
  return ''
}

/**
 * 正文为空时，**把"为什么"说出来**。原来这里只报一句「文本响应里没有 content」，
 * 于是「我的适配器不会读」「这家在 max_tokens 内没写完」「回包结构变了」
 * 三种情况的处置完全不同，报告上却是同一行字。
 *
 * 实测依据见 `scripts/probe-chat-shape.mts`：短提示词下四家都能正常返回
 * `content`（string，`finish_reason=stop`），所以正式跑测里出现的空正文
 * 一定另有原因——**思考预算**是头号嫌疑（思考模型同时带 `reasoning_content`）。
 */
function explainEmptyContent(body: unknown, message: Record<string, unknown> | null): string {
  const finishReason = String(findFirst(body, ['finish_reason']) ?? '')
  const reasoning = message ? findFirst(message, ['reasoning_content']) : null
  const reasoningLength = typeof reasoning === 'string' ? reasoning.length : 0
  const contentShape = message
    ? 'content' in message
      ? describeValue(message['content'])
      : '**键不存在**'
    : '找不到 message'
  const detail = `content=${contentShape}，finish_reason=${finishReason || '—'}，reasoning_content=${reasoningLength} 字符`
  if (finishReason === 'length' || reasoningLength > 0) {
    return `这家在 max_tokens 之内没写出正文（${detail}）。正文预算被思考吃掉了——调大 maxTokens 或换一家`
  }
  return `回包里没有正文（${detail}）。回包结构可能变了，拿 traceId 找平台`
}

/** 类型 + 长度，不回显正文（正文可能有几十 KB，塞进错误消息里会淹没真正的信息） */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `string(${value.length})`
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === 'object') return `object{${Object.keys(value as object).join(',')}}`
  return typeof value
}

function usageOf(body: unknown): TextResponse['usage'] | undefined {
  const raw = findFirst(body, ['usage'])
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const prompt = record['prompt_tokens'] ?? record['input_tokens']
  const completion = record['completion_tokens'] ?? record['output_tokens']
  if (typeof prompt !== 'number' && typeof completion !== 'number') return undefined
  return {
    promptTokens: typeof prompt === 'number' ? prompt : undefined,
    completionTokens: typeof completion === 'number' ? completion : undefined,
  }
}
