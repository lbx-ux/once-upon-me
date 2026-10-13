/**
 * openai-vision.ts —— 用多模态对话模型做「本页主角 vs 角色卡」的一致性比对
 *
 * 这是**一致性 Agent 的手**：它不决定重不重画，它只回答"这几条锚点对不对得上"。
 * 判定阈值与重画次数在 illustrate.ts，因为那是产品决策，不是模型能力。
 *
 * ★ 为什么判据是逐条清单而不是一句"像不像"：
 *   GLOSSARY「一致性分」写的是"它是判据不是事实，阈值靠人工判读校准"。
 *   要校准就得知道**它凭什么给这个分**。清单式提问让模型必须逐条回答，
 *   于是"0.71"旁边永远跟着"骨相：圆脸没画出来"——家长看得懂，我们也调得准阈值。
 */

import { EngineError } from '../errors.ts'
import type { CallBudget, CompareRequest, CompareResponse, VisionComparator } from './types.ts'
import { requestJson, traceOf, type HttpDeps } from './http.ts'

const SYSTEM = [
  '你是儿童绘本的角色一致性审核员。',
  '给你两张图：第一张是**标准像**（角色的唯一真相），第二张是**待审页**。',
  '只判断第二张里的主要人物与标准像是否为同一个孩子，不评价画得好不好、构图美不美。',
  '逐条核对给定的锚点清单。任何一条硬锚点不符，就要在 missed 里写出该条的槽位名。',
  '只输出 JSON：{"score":0 到 1 的小数,"missed":["槽位名"],"reason":"一句中文说明"}',
  '拿不准时把分打低，不要为了好看给高分——这个分数决定要不要重画，给高了就没人看得见那张崩脸。',
].join('\n')

export function createOpenAiVision(deps: HttpDeps, modelId: string): VisionComparator {
  return {
    id: `openai-vision(${modelId})`,
    modelId,
    async compare(req: CompareRequest, budget?: CallBudget): Promise<CompareResponse> {
      if (!deps.apiKey) {
        throw new EngineError(
          'provider-not-configured',
          'VISION_API_KEY / LLM_API_KEY 未配置，视觉比对不可用',
        )
      }
      const user = [
        {
          type: 'text',
          text: `锚点清单：\n${req.checklist.map((line, i) => `${i + 1}. ${line}`).join('\n')}`,
        },
        { type: 'image_url', image_url: { url: req.referenceDataUrl } },
        { type: 'text', text: '上面是标准像。' },
        { type: 'image_url', image_url: { url: req.pageDataUrl } },
        { type: 'text', text: '上面是待审页。按清单逐条核对后只输出 JSON。' },
      ]

      const body = await requestJson(deps, {
        method: 'POST',
        path: '/chat/completions',
        body: {
          model: modelId,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: user },
          ],
          // 判定要稳定，不要发挥。温度 0 是这里唯一的选项。
          temperature: 0,
          max_tokens: 400,
        },
        signal: budget?.signal,
        // ★ 缺省 300s，不是 90s。这个调用一次要送**两张 1440×1440 的 data URL**
        //   （约 7 MB base64），90s 实测不够：live 跑书时 kimi-k2.6 做比对，
        //   多页直接回 504 或 fetch failed。而超时的代价是"这一页没核对"，
        //   它会让 r_redraw（§12.2 产出物 4）算不出来——所以宁等勿弃。
        //   同时**要认 deps.timeoutMs**：原来这里把它整个忽略了，
        //   于是 .env 里配多少都没用，配了也是白配。
        timeoutMs: budget?.timeoutMs ?? deps.timeoutMs ?? 300_000,
      })

      const text = extractContent(body)
      const parsed = parseLooseJson(text)
      if (!parsed) {
        return {
          score: null,
          missed: [],
          reason: `比对模型没有按 JSON 回答（原文前 120 字：${text.slice(0, 120)}）`,
          modelId,
          traceId: traceOf(body) || undefined,
        }
      }
      const score = typeof parsed.score === 'number' ? clamp01(parsed.score) : null
      return {
        score,
        missed: Array.isArray(parsed.missed) ? parsed.missed.map(String) : [],
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        modelId,
        traceId: traceOf(body) || undefined,
      }
    },
  }
}

function extractContent(body: unknown): string {
  // choices[0].message.content —— 但层级不一致是这个供应商的老毛病，所以递归找 content
  const hit = (function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item)
        if (found !== undefined) return found
      }
      return undefined
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (typeof record['content'] === 'string') return record['content']
      for (const value of Object.values(record)) {
        const found = walk(value)
        if (found !== undefined) return found
      }
    }
    return undefined
  })(body)
  return typeof hit === 'string' ? hit : ''
}

/** 模型偶尔把 JSON 包在 ```json 围栏里或前后带话，所以先抠出第一个平衡的 { } */
export function parseLooseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
