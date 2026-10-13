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
  /** 供应商特有的额外字段（各家参数名不一致时在这里补，不改接口） */
  extra?: Record<string, unknown>
}

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
        max_tokens: req.maxTokens ?? 2048,
        ...jsonShape(jsonMode, req.jsonSchema),
        ...(opts.extra ?? {}),
      }

      const body = await requestJson(deps, {
        method: 'POST',
        path: '/chat/completions',
        body: payload,
        signal: budget?.signal,
        timeoutMs: budget?.timeoutMs,
      })

      const text = findFirst(body, ['content'])
      if (typeof text !== 'string' || text === '') {
        throw new EngineError('provider-call-failed', '文本响应里没有 content', {
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
 * 横评（scripts/w1-text-bakeoff.ts）要按档分别测，档位是判据的一部分，不是实现细节。
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
