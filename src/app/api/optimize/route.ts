/**
 * /api/optimize —— 把家长写的那一句"想讲什么"改得更具体
 *
 *   POST /api/optimize  { wish, childName?, themeLabel? }  →  { suggestion, … }
 *
 * ★ 它**只回建议，不改任何东西**。原句在客户端的 state 里，用不用由用户点。
 *   服务端不落盘、不建产物、不进任何 provenance——这不是一次生成，是一次改写建议。
 *   （所以这一版提示词的版本号只用于排障，见 `prompts/optimize.ts` 文件头。）
 *
 * ★ 这是**文本**能力，不是新能力：走 `textProviderOf(env)`，与 `/api/cards` 那边
 *   直接用 `imageProviderOf` 是同一条纪律——按组构造的工厂就该按组用。
 *   拿 `createProviders` 做这件事的话，一个"只想改句话"的动作会因为没填**图像**密钥整条跑不起来。
 *
 * ★ 密钥只从服务端环境来（ADR-0009，`lib/settings/server-env.ts`）：
 *   这一条 2026-10-17 之前写的是"请求体里那张表说了算"，正好反过来。
 *
 * ★ 失败一律说人话（`userFailureOf` 是唯一那处判据），**绝不在本地编一句兜底文本顶上**：
 *   那样用户会以为自己拿到的是 AI 优化过的句子，实际是一句写死的话——
 *   一个只对四分之一能响的控件，证的是这件事想证的反面。
 */

import type { NextRequest } from 'next/server'
import { textProviderOf } from '@/lib/engine/providers/registry.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'
import { MAX_TEXT } from '@/lib/book-api.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'
import {
  cleanSuggestion,
  isTooLong,
  optimizeRequest,
  PROMPT_OPTIMIZE_VERSION,
  suggestionLength,
} from '@/lib/prompts/optimize.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 失败一律走这里：文案、可重试性、状态码三件一起算（与 `/api/cards` 同一个函数） */
function failureResponse(err: unknown): Response {
  const failure = userFailureOf(err)
  return Response.json(
    { code: failure.code, message: failure.message, retryable: failure.retryable },
    { status: failure.status },
  )
}

type Body = {
  wish: string
  childName?: string
  themeLabel?: string
}

/**
 * 家长写的那句话的**上界**（2026-10-20 补的）。
 *
 * ★ 在这之前这一格**只判了非空**，而它原样进提示词（`prompts/optimize.ts` 的
 *   `optimizeUser`）。同一类东西在别的入口都是有上界的，三个数还是同一档：
 *   `book-api.ts` 的 `MAX_TEXT = 200`（开书时的主题与 wish）、
 *   `rerun-api.ts` 的 `MAX_FIX_NOTE = 200`（重画时那句补充）。
 *   ★ 那个文件头把这条规矩写得很清楚：「同一类东西（人写的一句话）不该因为走了
 *     另一个入口就换一套长度规矩」——这一格正是漏掉的那一个入口。
 *   ★ 超了**拒收而不是截断**：截一半的句子会被"优化"成一句完整的话，
 *     而家长看不到自己那半句被丢了（与 `OPTIMIZE_MAX_CHARS` 那条"超长只说长了一点、
 *     不截断"是同一条判断：截断会把"我写多了"伪装成"模型读懂了"）。
 */
const MAX_NAME = 20

function parseBody(raw: unknown): { body?: Body; problems: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { problems: ['请求体要是一个 JSON 对象'] }
  }
  const source = raw as Record<string, unknown>
  const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

  const problems: string[] = []
  const wish = str(source['wish'])
  // ★ 空句**不在这里兜一个默认主题**：没有要改的句子就没有这件事，
  //   编一句"关于友情的故事"顶上就是把一个空输入变成一次收费的调用
  if (wish === '') problems.push('要优化的那句话是空的——先写一句想讲什么')
  else if (wish.length > MAX_TEXT) problems.push(`想讲什么写短一点（${MAX_TEXT} 字以内）`)

  const childName = str(source['childName'])
  if (childName.length > MAX_NAME) problems.push(`孩子的名字太长了（${MAX_NAME} 字以内）`)
  if (problems.length > 0) return { problems }

  return {
    problems: [],
    body: {
      wish,
      ...(childName === '' ? {} : { childName }),
      ...(str(source['themeLabel']) === '' ? {} : { themeLabel: str(source['themeLabel']) }),
    },
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  // ★ 这一条只花文本的钱（`textProviderOf`），所以只要**文本**那一个能力
  const guard = await requireCapability(req, ['text'])
  if (!guard.ok) return guard.response

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ code: 'bad-json', message: '请求体不是合法的 JSON' }, { status: 400 })
  }

  const { body, problems } = parseBody(raw)
  if (!body) {
    return Response.json(
      { code: 'invalid-request', message: problems.join('；'), extra: problems },
      { status: 400 },
    )
  }

  // 按组构造：缺文本密钥时抛 `provider-not-configured`，翻出来的是"文本能力不可用"，
  // 而不是一句与本次动作无关的"模型与密钥没配全"
  let text
  try {
    text = textProviderOf(serverEnv())
  } catch (err) {
    return failureResponse(err)
  }

  let response
  try {
    // ★ 整份请求（含 `plainText: true`）从 `optimizeRequest` 出，与
    //   `scripts/probe-optimize.mts` 是同一份——探针量到的就是线上这条路的调用
    response = await text.complete(optimizeRequest(body))
  } catch (err) {
    return failureResponse(err)
  }

  const suggestion = cleanSuggestion(response.text)
  // ★ 空回复算失败，不退回原句**假装优化过**：退回原句之后界面会显示
  //   "优化后：<和原来一模一样>"，用户以为模型觉得他写得很好了
  if (suggestion === '') {
    return Response.json(
      {
        code: 'provider-empty',
        message: '模型这次没给出内容，再点一次试试——也可能是这个模型把预算花在思考上了',
        retryable: true,
      },
      { status: 502 },
    )
  }

  return Response.json({
    suggestion,
    /** 超长**不截断**，只把这件事告诉界面（界面写一句"长了一点"） */
    tooLong: isTooLong(suggestion),
    length: suggestionLength(suggestion),
    /** 哪一版提示词、哪个模型改的：优化结果被投诉时要答得上（与卡上记 modelId 同一条道理） */
    promptVersion: PROMPT_OPTIMIZE_VERSION,
    modelId: response.modelId,
  })
}
