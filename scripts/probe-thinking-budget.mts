/**
 * probe-thinking-budget.mts —— 诊断：思考模型为什么写不出正文
 *
 * 起因是实测到的一条具体现象（不是猜的，见 `probe-chat-shape.mts` 与文本横评的报错原文）：
 *
 * ```
 * content=string(0)，finish_reason=length，reasoning_content=8133 字符
 * ```
 *
 * 思考模型把 `max_tokens` 整个预算花在思考链上，正文一个字都没开始写。
 * 这**不是**"这家不会出 JSON"，是"我们给的预算不够"——两者的处置完全相反，
 * 所以必须先弄清楚，再决定横评怎么跑、引擎的 `maxTokens` 定多少。
 *
 * ★ 为什么要一个单独的探针，而不是直接把横评的 maxTokens 调大：
 *   项目纪律是"拒绝拿正式跑测当参数探测"。正式跑测的数字要是带着探索的痕迹，
 *   它就不再是可复现的结论。所以参数在**这里**探明白，正式跑测只跑最后定下来的那一种配置。
 *
 * 探三件事：
 *
 * | 步骤 | 问的是什么 | 花不花钱 |
 * |---|---|---|
 * | 0 | `/v1/models` 里有没有非思考变体（`-instruct` / `-no-think` 之类） | 免费 |
 * | 1 | 这个接口**认不认未声明的字段**——认，则参数名不能零成本探；不认，则可以 | 一次调用（400，不计费） |
 * | 1b | 各家**允不允许**关思考（送真值 `false`） | 每模型一次小调用 |
 * | 2 | 同一模型三档：现行预算 4096 / 放大到 16000 / 加关思考参数 | 每模型 2–3 次 |
 *
 * ★ 步骤 1 与 1b 是**两个不同强度的命题**，别把它们合成一个（合过一次，错了）：
 *   "字段名存在" 弱于 "这个值被允许"。步骤 1 能免费回答前者，
 *   步骤 1b 必须花一点钱才能回答后者——而选型要的是后者。
 *
 * ```bash
 * node scripts/probe-thinking-budget.mts --models=qwen3.8-max,seed-2.1-pro --budgets=4096,16000
 * ```
 */

import { arg, readEnv } from './env.mts'
import { storyPlanSystem, storyPlanUser } from '../src/lib/prompts/story-plan.ts'

/**
 * 关思考的候选参数名。**没有一个是文档抄来的**——都是从"这个接口会拒未知字段"这条上去试的。
 *
 * 实测补齐（2026-10-13）：平台自己会告诉你值域。给 `enable_thinking` 送一个明显错的值，
 * 它回 `UNSUPPORTED_FIELD · enable_thinking 只支持开启、关闭或自动`——
 * 所以这个字段是**三值**的，除了开/关还有一个 `auto`。
 *
 * ★ `auto` 目前**不用也不测**：它的字面量（是 `"auto"` 还是别的）没验证，
 *   而"平台自己决定想不想"意味着输出形状不稳定——横评要的是可复现的配置。
 *   留作 §9.1 的待办，不要不经验证就写进注册表。
 */
const THINKING_OFF_CANDIDATES: readonly (readonly [string, unknown])[] = [
  ['enable_thinking', false],
  ['thinking', { type: 'disabled' }],
  ['reasoning_effort', 'none'],
  ['enable_reasoning', false],
  ['chat_template_kwargs', { enable_thinking: false }],
]

type Row = {
  label: string
  status: number
  contentLen: number
  reasoningLen: number
  finishReason: string
  completionTokens: number | undefined
  note?: string
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
    for (const key of keys) if (key in record) return { hit: record[key], found: true }
    for (const value of Object.values(record)) {
      const got = walk(value, keys)
      if (got.found) return got
    }
  }
  return { hit: null, found: false }
}

function lenOf(obj: unknown, keys: readonly string[]): number {
  const got = walk(obj, keys)
  return typeof got.hit === 'string' ? got.hit.length : -1
}

async function call(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ status: number; text: string; parsed: unknown }> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  })
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { _unparsed: text.slice(0, 300) }
  }
  return { status: response.status, text, parsed }
}

/** 引擎现在真正发出去的那份 prompt，逐字节相同——探针和正式跑测不能问两个问题 */
function storyPlanBody(model: string, maxTokens: number, extra?: Record<string, unknown>) {
  return {
    model,
    messages: [
      { role: 'system', content: storyPlanSystem() },
      {
        role: 'user',
        content: storyPlanUser({
          childName: '小宇',
          nameReading: 'yǔ',
          ageBand: '4-6',
          interestTags: ['恐龙', '船'],
          lookTags: ['圆脸'],
          theme: '怕黑',
          form: 'solo',
          pages: 6,
        }),
      },
    ],
    temperature: 0.8,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    ...(extra ?? {}),
  }
}

async function main(): Promise<void> {
  const env = await readEnv()
  const baseUrl = env['LLM_BASE_URL'] ?? 'https://tokenrhythm.studio/v1'
  const apiKey = env['LLM_API_KEY'] ?? ''
  if (!apiKey) throw new Error('LLM_API_KEY 未配置，探不了')
  const models = arg('models', '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  const budgets = arg('budgets', '4096,16000')
    .split(',')
    .map((b) => Number(b.trim()))
    .filter((b) => Number.isFinite(b) && b > 0)
  if (models.length === 0) throw new Error('--models 必填')

  // ── 步骤 0：模型清单（免费） ─────────────────────────────────────────────
  process.stdout.write('── 步骤 0：/v1/models 里有什么（免费）──\n')
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    if (!response.ok) {
      process.stdout.write(`  HTTP ${response.status}：${text.slice(0, 200)}\n`)
    } else {
      const parsed = JSON.parse(text) as { data?: { id?: string }[] } | { id?: string }[]
      const ids = (Array.isArray(parsed) ? parsed : (parsed.data ?? []))
        .map((item) => item.id ?? '')
        .filter(Boolean)
      process.stdout.write(`  共 ${ids.length} 个：\n`)
      for (const id of ids) process.stdout.write(`    ${id}\n`)
      const variants = ids.filter((id) => /think|instruct|reason|no-?think|non-?think/i.test(id))
      process.stdout.write(
        variants.length > 0
          ? `  ★ 带 think/instruct/reason 字样的：${variants.join(', ')}\n`
          : '  ★ 清单里没有非思考变体：关思考只能靠参数，不能靠换模型名\n',
      )
    }
  } catch (err) {
    process.stdout.write(`  取不到：${err instanceof Error ? err.message : String(err)}\n`)
  }

  // ── 步骤 1：未知字段会不会被拒（一次调用） ───────────────────────────────
  process.stdout.write('\n── 步骤 1：接口认不认未声明的字段 ──\n')
  let unknownRejected = false
  {
    const probeModel = models[0] as string
    const { status, text } = await call(baseUrl, apiKey, {
      ...storyPlanBody(probeModel, 64),
      _definitely_not_a_real_field: 'x',
      max_tokens: 16,
    })
    unknownRejected = status >= 400 && /未知字段|unknown|unexpected|invalid.*field/i.test(text)
    process.stdout.write(
      `  故意送一个假字段 → HTTP ${status}\n` +
        (unknownRejected
          ? '  ★ 会被拒：**参数名可以零成本探**（送假值，看它报"未知字段"还是别的错）\n'
          : `  不拒：探参数名必须花钱，得靠真实调用比对\n  回包：${text.slice(0, 220)}\n`),
    )
  }

  // ── 步骤 1b：送**真的那个值**，看各家收不收（便宜，小 prompt）────────────────
  //
  // ★★ 这一节改过一次，因为前一版**得出了错的结论**，值得把错法记下来：
  //
  //   前一版送的是**错值**（`enable_thinking: 'not-a-bool-on-purpose'`），
  //   七家全回 `UNSUPPORTED_FIELD`，于是它报告"所有候选都认这个字段，缺省关思考
  //   可以安全地对全体生效"。随后正式跑测立刻打脸：
  //
  //     glm-5.3-flash → HTTP 400 · REASONING_REQUIRED · 当前模型必须开启深度思考   （10/10 全灭）
  //
  //   错在**判据的量法**：送错值只能证明"字段名存在"，证明不了"这个值被允许"。
  //   把前者当成后者，等于用一个更弱的命题去答一个更强的命题——
  //   而我当初选错值，图的是"不花钱"，那就是在拿成本决定判据的强度。
  //   现在是送真值，代价是每家的这次调用成功时会真的生成一次（小 prompt、小预算）。
  process.stdout.write('\n── 步骤 1b：送真值 enable_thinking=false，看各家收不收 ──\n')
  /** 三值，**不许把"不知道"并进"不允许"**——那是对供应商的一句假话 */
  type Verdict = 'allowed' | 'refused' | 'inconclusive'
  const thinkingOff: Record<string, Verdict> = {}
  const noteOf: Record<string, string> = {}
  for (const model of models) {
    const { status, text } = await call(baseUrl, apiKey, {
      ...storyPlanBody(model, 16),
      enable_thinking: false,
    })
    const unknownField = /未知字段|unknown|unexpected|unrecognized/i.test(text)
    // ★ 判据要分三层，合起来报就会说假话（第一版就是合起来报的）：
    //   2xx            → 允许关思考
    //   4xx 且非未知字段 → **拒绝这个值**，且必须看 4xx 的 code 确认是值的问题
    //   5xx / 0 / 网络  → **不知道**，不是"不允许"。503 是平台抖动，
    //                     拿它当结论就冤枉了一家（kimi-k2.6 被这么冤枉过一次）
    const verdict: Verdict =
      status >= 200 && status < 300
        ? 'allowed'
        : status >= 400 && status < 500 && !unknownField
          ? 'refused'
          : 'inconclusive'
    thinkingOff[model] = verdict
    noteOf[model] = text.slice(0, 110)
    process.stdout.write(
      `  ${model}：HTTP ${status} · ` +
        (verdict === 'allowed'
          ? '关思考可用 ✓'
          : verdict === 'refused'
            ? `**收字段但拒绝这个值** ✗（${noteOf[model]}）`
            : `**不知道**（平台/网络问题，不是它的态度）：${noteOf[model]}`) +
        '\n',
    )
  }
  const refused = Object.entries(thinkingOff)
    .filter(([, verdict]) => verdict === 'refused')
    .map(([model]) => model)
  const unknown = Object.entries(thinkingOff)
    .filter(([, verdict]) => verdict === 'inconclusive')
    .map(([model]) => model)
  process.stdout.write(
    (refused.length > 0
      ? `  ★ **不允许**关思考（实测拒绝，不是超时）：${refused.join(', ')}\n` +
        '    注册表缺省 off 会让它们**整家打不通**——响亮的 400，不是静默降级。\n' +
        '    选到它们就得 LLM_THINKING=on 且把 LLM_MAX_TOKENS 提到 16000，这一条要写进 §9.1\n'
      : '  ★ 没有候选明确拒绝关思考 → 缺省 off 可以安全地对全体生效\n') +
      (unknown.length > 0
        ? `  ★ 这几个**没测出来**（别当成"不允许"，也别当成"允许"）：${unknown.join(', ')}\n`
        : ''),
  )

  // ── 步骤 2：预算与关思考（花钱） ────────────────────────────────────────
  if (arg('spend', '1') === '0') {
    process.stdout.write('\n（--spend=0：只跑免费的步骤 0/1/1b，不花调用）\n')
    return
  }
  process.stdout.write('\n── 步骤 2：同一模型、同一 prompt，只改预算与关思考参数 ──\n\n')
  const rows: Row[] = []
  for (const model of models) {
    for (const maxTokens of budgets) {
      process.stdout.write(`  ${model} · max_tokens=${maxTokens} … `)
      const { status, parsed } = await call(baseUrl, apiKey, storyPlanBody(model, maxTokens))
      const row: Row = {
        label: `${model} · 预算 ${maxTokens}`,
        status,
        contentLen: lenOf(parsed, ['content']),
        reasoningLen: lenOf(parsed, ['reasoning_content']),
        finishReason: String(walk(parsed, ['finish_reason']).hit ?? '—'),
        completionTokens:
          typeof walk(parsed, ['completion_tokens']).hit === 'number'
            ? (walk(parsed, ['completion_tokens']).hit as number)
            : undefined,
      }
      rows.push(row)
      process.stdout.write(
        `正文 ${row.contentLen} / 思考 ${row.reasoningLen} / ${row.finishReason}\n`,
      )
      // 预算已经够用就不必再往上加；省下来的调用留给别的候选
      if (row.contentLen > 0 && row.finishReason !== 'length') break
    }

    // 关思考参数：只在"预算放大后仍然写不出正文"时才值得试
    const budgetWorked = rows.some(
      (row) => row.label.startsWith(model) && row.contentLen > 0 && row.finishReason !== 'length',
    )
    if (!budgetWorked) {
      for (const [key, value] of THINKING_OFF_CANDIDATES) {
        process.stdout.write(`  ${model} · ${key}=${JSON.stringify(value)} … `)
        const { status, text, parsed } = await call(baseUrl, apiKey, {
          ...storyPlanBody(model, 4096, { [key]: value }),
        })
        if (status >= 400) {
          process.stdout.write(
            `HTTP ${status}（${unknownRejected ? '字段不被认，排除这个名字' : '报错'}）${text.slice(0, 120)}\n`,
          )
          rows.push({
            label: `${model} · ${key}`,
            status,
            contentLen: -1,
            reasoningLen: -1,
            finishReason: '—',
            completionTokens: undefined,
            note: text.slice(0, 120),
          })
          continue
        }
        const row: Row = {
          label: `${model} · ${key}`,
          status,
          contentLen: lenOf(parsed, ['content']),
          reasoningLen: lenOf(parsed, ['reasoning_content']),
          finishReason: String(walk(parsed, ['finish_reason']).hit ?? '—'),
          completionTokens:
            typeof walk(parsed, ['completion_tokens']).hit === 'number'
              ? (walk(parsed, ['completion_tokens']).hit as number)
              : undefined,
        }
        rows.push(row)
        process.stdout.write(
          `正文 ${row.contentLen} / 思考 ${row.reasoningLen} / ${row.finishReason}\n`,
        )
        if (row.contentLen > 0) break
      }
    }
  }

  process.stdout.write(
    '\n| 配置 | HTTP | 正文长度 | 思考长度 | finish_reason | completion_tokens |\n' +
      '|---|---|---|---|---|---|\n' +
      rows
        .map(
          (r) =>
            `| ${r.label} | ${r.status} | ${r.contentLen < 0 ? '—' : r.contentLen} | ` +
            `${r.reasoningLen < 0 ? '—' : r.reasoningLen} | ${r.finishReason} | ` +
            `${r.completionTokens ?? '—'} |`,
        )
        .join('\n') +
      '\n\n读法：正文长度 0 且 finish_reason=length = 预算被思考吃光；' +
      '正文>0 = 这一档配置这家能干活。\n' +
      '结论要回填 tech-selection §9.1 与引擎的 maxTokens，**别只留在这个日志里**。\n',
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
