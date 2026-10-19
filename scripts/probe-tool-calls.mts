/**
 * probe-tool-calls.mts —— 探针：这条网关上的 `tools` / `tool_choice` 到底能不能用
 *
 * 为什么先做它，而不是直接把 `tool-loop.ts` 写出来：
 * 全仓 `tool_call` / `tools:` **零命中**，`registry.ts` 里没有这个能力，
 * `docs/tech-selection.md §9.1` 对候选模型的评价里只有一句口碑
 * （「结构化输出与工具调用成熟度」），**没有一行实测**。
 * 所以「这家支持 Function Calling」在今天是一个**印象**，不是事实。
 *
 * ★ W1 在这件事上付过学费（`scripts/probe-embeddings.mts` 文件头写着那句）：
 *   **不是「漏测」，是「把一个否定结论建立在没找到入口上」**——
 *   前者是「我试了这条路的全部形状」，后者是「我试了这一条路」。
 *   所以下面八格**一格都不能少**，缺一格就退化成学费本身。
 *
 * ## 八格
 *
 * | 格   | 打什么                                                   | 它答的是                                |
 * | ---- | -------------------------------------------------------- | --------------------------------------- |
 * | A    | `tools` + `tool_choice:'auto'`，问句要求先用工具          | 回包里有没有 `message.tool_calls`       |
 * | B    | `tool_choice` 强制指定某个函数                            | 支不支持强制                            |
 * | C    | 多轮：`assistant.tool_calls` + `role:'tool'` 回填         | 工具结果喂回去能不能续                  |
 * | D    | **`tools` + `response_format:{type:'json_object'}` 同给** | ★ 承重格一                              |
 * | E    | **`tools` + `response_format:{type:'json_schema'}`**      | ★ 承重格二                              |
 * | F1   | 判别对照一：body 里塞一个**不存在的顶层字段**             | 网关对未知字段是宽还是严                |
 * | F2   | 判别对照二：`tools` 里放一个**没有 name 的函数**          | 网关**有没有真的解析** `tools` 这个字段 |
 * | H    | `parallel_tool_calls:false`                               | 并行调用会让步数账变复杂                |
 * | G    | 候选模型各打一遍 A 与 D                                   | 「换哪家还能用」                        |
 *
 * ## 为什么 D / E 是承重的
 *
 * 规划那一步**本来就吃 `LLM_JSON_MODE`**（`providers/registry.ts` 的 `textOptionsOf`，
 * 今天 `.env.local` 里是 `object`），而「`tools` 与 `response_format` 互斥」
 * 是网关很常见的一种实现。如果 D / E 都不过，工具那一档只剩
 * 「不带 `response_format`、靠提示词要 JSON」一条路——**那会拿规划的输出稳定性去换
 * 工具调用**，代价必须当场写清楚，不许悄悄换掉（工单 08 的三臂对照就是量这个）。
 *
 * ## 判读表（改这个脚本前先读它）
 *
 * ```
 * A 回 200 且 message.tool_calls 非空        → **能用**（这一格是结论本身）
 * A 回 200 但 tool_calls 缺席                → 看 F1/F2 才能读：
 *                                              F1 严（未知字段被拦）→ 参数真的进了请求体，
 *                                                那是"模型这次不肯调"，不是"不支持"
 *                                              F1 宽（未知字段被忽略）→ 参数可能被丢了
 *                                              （F2 再补一刀：F2 回 4xx = 网关确实解析 tools）
 * A 回 400 且文案点名 tools 这个字段          → 这条路上**不支持 tools**（能力级结论）
 * B 回 400 且文案说「请改用 tool_choice=auto」→ 单独一档：**auto 可用、强制点名不支持**
 * D / E 回 4xx 且文案同时点名 tools 与 format → **两者互斥**：工具那一档不能带 JSON 强制
 * D / E 回 200（哪怕模型没调工具）            → **不互斥**。模型调不调是模型的选择，
 *                                              不是接口的限制——别把这两件事合成一句
 * D 回 400「must contain the word 'json'」   → ★ **不是 tools 的问题**：那是 LiteLLM 对
 *                                              json_object 的提示词要求，本脚本已在 D 的
 *                                              问句里写了 JSON 就是为了排掉这个混淆
 * 400 且文案是 `'x' is a required property`  → **形状**：网关解析了这个字段（正对照），
 *                                              不是"不支持"。★ 判读顺序错了就会把**正对照
 *                                              记成否定结论**——第一版就是这么错的（见 classify）
 * 403 / 429 / 5xx                            → **没结论**，读原文，别记成「不支持」
 * ```
 *
 * ★ 最后一行是要紧的：`403` / `429` / `502` 都**不是**「不存在」。
 *   把它们记成「没有」，就是这一次探针要避免的那个错误本身。
 *   （B1 那轮已经踩过一次：限流把「全称否定」灌了水，所以下面汇总里
 *   「有结论 / 没结论」**分两栏**，只要还剩一格没测成就不打全称否定。）
 *
 * ★ 第一版跑出来的**两个判读错**留在 `classify` 的注释里，别删——
 *   它们是「正则漏一个词，读数就从『有结论』掉到『没结论』」的活标本。
 *
 * ```bash
 * node scripts/probe-tool-calls.mts                    # A–F、H 打在配置的那个模型上，再跑 G
 * node scripts/probe-tool-calls.mts --only=A,D         # 只跑指定几格
 * node scripts/probe-tool-calls.mts --model=qwen3.8-flash
 * node scripts/probe-tool-calls.mts --models=a,b,c     # G 那一轮的名单
 * node scripts/probe-tool-calls.mts --delay=3000       # 放慢（被测限流过就调它）
 * ```
 *
 * 结论回填 `.scratch/mcp/spec.md §四`、`.env.example` 的 `LLM_*` 那一段与工单 06。
 * 本文件留着，是为了让那条结论可复现。
 */

import { requestJson } from '../src/lib/engine/providers/http.ts'
import { arg, readEnv } from './env.mts'

/* ───────────────────────── 请求的形状 ───────────────────────── */

const PATH = '/chat/completions'

/** 两个工具：`read_shelf` 无参（最省事，先钉住"能不能调"），
 *  `search_past_stories` 有参（顺带看模型会不会**生成**参数） */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_shelf',
      description: '读这个孩子已有的绘本清单（书名 + 主题）。想知道他已经有哪些书时调用它。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_past_stories',
      description: '在以前写过的故事里检索与 query 相近的段落。动笔前想参考旧文本时调用它。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要找什么' },
          k: { type: 'integer', description: '取几条，缺省 3' },
        },
        required: ['query'],
      },
    },
  },
] as const

/** A / B / C / H 共用同一句问话：它**必须**诱导工具调用，否则 A 的 200 读不出东西 */
const ASK_TOOL = '先调用 read_shelf 看看这个孩子已经有哪些绘本，再告诉我。'

/**
 * D 专用问句。★ 与 `ASK_TOOL` 只差最后半句，而那是**刻意**的：
 * LiteLLM 对 `response_format:{type:'json_object'}` 有一条「messages 里必须出现
 * json 这个词」的前置检查（本仓在 `providers/types.ts` 的 `plainText` 那段踩过，
 * 原话是 `'messages' must contain the word 'json' in some form`）。
 * 不把这半句写进去的话，D 那一格的 400 会同时兼容
 * 「tools 与 response_format 互斥」与「你没写 json 这个词」两个命题——
 * 而后者与这一单想问的事毫无关系。
 */
const ASK_JSON = `${ASK_TOOL}结果用 JSON 回答。`

/** E 的 schema。取最小的一个：这一格问的是"能不能同给"，不是"schema 多复杂能过" */
const JSON_SCHEMA_RESPONSE = {
  type: 'json_schema',
  json_schema: {
    name: 'shelf_summary',
    strict: true,
    schema: {
      type: 'object',
      properties: { books: { type: 'array', items: { type: 'string' } } },
      required: ['books'],
      additionalProperties: false,
    },
  },
}

/* ───────────────────────── 判读 ───────────────────────── */

type Verdict =
  | 'tool-called'
  | 'accepted-no-call'
  | 'choice-forced-unsupported'
  | 'tools-unsupported'
  | 'format-conflict'
  | 'json-word'
  | 'shape'
  | 'inconclusive'

const VERDICT_LABEL: Record<Verdict, string> = {
  'tool-called': '**调了工具**（`message.tool_calls` 非空）',
  'accepted-no-call': '网关收了，但**模型没调工具**',
  'choice-forced-unsupported': '`tool_choice` **强制点名**不支持（auto 可以）',
  'tools-unsupported': '**tools 这个字段本身不被接受**（能力级结论）',
  'format-conflict': '`response_format` 与 `tools` **互斥**',
  'json-word': '被 json_object 的"提示词里要有 json"那条挡了（**不是 tools 的问题**）',
  shape: '请求体**形状**问题（既不是没能力，也不是没给参数）',
  inconclusive: '**没结论**——读原文',
}

/**
 * 一次失败分成哪一类。
 *
 * ★ 判断的**顺序**是这一版最要紧的地方，第一版就在这里判错了两格：
 *
 * 1. **`shape` 必须在 `tools-unsupported` 之前判**。F2 那条故意写坏的 tools
 *    （函数没有 `name`）回的是 `'name' is a required property - 'tools.0.function'`——
 *    它是「网关**解析了** tools 这个字段」的**正对照**，而第一版因为文案里有
 *    `tools` 这个词就记成了「不支持 tools」（能力级结论）。
 *    把一条正对照记成否定结论，正是这一单要防的那个错。
 * 2. 「未知请求字段」这一类同样先判：F1 回的是 `UNKNOWN_FIELD · 未知请求字段：…`，
 *    而第一版的模式写的是「未知字段」（没有"请求"两个字），于是漏掉、记成了「没结论」。
 *    **正则漏一个词，读数就从"有结论"掉到"没结论"**——所以模式要宽，宁可多判一格 shape。
 * 3. `tool_choice` 的强制点名要**单独一档**：它的文案明写「请改用 tool_choice=auto」，
 *    也就是 auto 仍然可用。合成「不支持工具」会把一个**可用**的结论说成不可用。
 */
function classify(status: number, code: string, message: string): Verdict {
  if (status >= 200 && status < 300) return 'accepted-no-call'
  const text = `${code} ${message}`
  if (/must contain the word '?json'?/i.test(text)) return 'json-word'
  if (
    /required property|is a required|未知请求字段|未知字段|unknown field|unexpected|extra inputs|extra fields|additional propert/i.test(
      text,
    )
  ) {
    return 'shape'
  }
  // response_format 那一类要先判：它同时点名 tools 时，结论是"互斥"而不是"不支持"
  const blamesFormat = /response_format|json_schema|json_object/i.test(text)
  const blamesTools = /tool_choice|tool_calls|\btools\b|functions/i.test(text)
  if (blamesFormat && blamesTools) return 'format-conflict'
  if (blamesFormat) return 'format-conflict'
  if (/tool_choice/i.test(text) && /not.?support|不支持/i.test(text)) {
    return 'choice-forced-unsupported'
  }
  if (blamesTools) return 'tools-unsupported'
  return 'inconclusive'
}

/* ───────────────────────── 骨架 ───────────────────────── */

type Call = {
  grid: string
  model: string
  ms: number
  status: number
  verdict: Verdict
  note: string
  toolCalls: number
  contentChars: number
}

let calls = 0
let delayMs = 1200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function bodyOf(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    model: '',
    messages: [
      { role: 'system', content: '你是一个中文绘本创作助手。需要外部信息时先调用工具。' },
      { role: 'user', content: ASK_TOOL },
    ],
    temperature: 0,
    max_tokens: 1024,
    ...extra,
  }
}

type Attempt = {
  ok: boolean
  raw: unknown
  status: number
  code: string
  message: string
  ms: number
}

/**
 * 打一次。
 *
 * ★ 走 `requestJson`（与适配器同一条 HTTP 层）而不是裸 `fetch`：
 *   否则探针测的是"探针自己拼的请求"，而那一层正是每次都要对齐身份、超时、
 *   重试策略的地方——W1 那条「横评自己搭一条平行路，量出来的不是引擎要用的那个数」
 *   就是这么来的。
 */
async function post(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  extra: Record<string, unknown>,
): Promise<Attempt> {
  calls += 1
  const startedAt = Date.now()
  const payload = { ...bodyOf(extra), model }
  try {
    const raw = await requestJson(deps, {
      method: 'POST',
      path: PATH,
      body: payload,
      timeoutMs: 120_000,
    })
    return { ok: true, raw, status: 200, code: '', message: '', ms: Date.now() - startedAt }
  } catch (err) {
    const e = err as { httpStatus?: number; providerCode?: string; message?: string }
    return {
      ok: false,
      raw: null,
      status: e.httpStatus ?? 0,
      code: e.providerCode ?? '',
      message: e.message ?? String(err),
      ms: Date.now() - startedAt,
    }
  }
}

/** 限流要退避重试（★ 退避的是**限流**，不是能力类错误：后者重试多少次都是同一个答案） */
async function postWithBackoff(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  extra: Record<string, unknown>,
): Promise<Attempt> {
  let result = await post(deps, model, extra)
  for (const wait of [4000, 12000, 30000]) {
    if (result.ok || classify(result.status, result.code, result.message) !== 'inconclusive') {
      return result
    }
    if (!/RATE_LIMITED|rate.?limit|TOO_MANY|429/i.test(`${result.code} ${result.message}`)) {
      return result
    }
    process.stdout.write(`     被限流，${wait / 1000}s 后重试…\n`)
    await sleep(wait)
    result = await post(deps, model, extra)
  }
  return result
}

type Message = {
  tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
  content?: unknown
}

function messageOf(raw: unknown): Message | null {
  const choices = (raw as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as { message?: unknown }).message
  return message && typeof message === 'object' ? (message as Message) : null
}

function toolCallsOf(raw: unknown): Message['tool_calls'] {
  const message = messageOf(raw)
  return Array.isArray(message?.tool_calls) ? message.tool_calls : []
}

function contentTextOf(raw: unknown): string {
  const content = messageOf(raw)?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part as { text?: unknown }).text)
      .filter((text): text is string => typeof text === 'string')
      .join('')
  }
  return ''
}

/** 一次打完之后统一记账与打印。返回记下的那一行 */
function record(
  rows: Call[],
  grid: string,
  model: string,
  attempt: Attempt,
  verdict: Verdict,
  note: string,
): Call {
  const toolCalls = attempt.ok ? toolCallsOf(attempt.raw).length : 0
  const contentChars = attempt.ok ? contentTextOf(attempt.raw).length : 0
  const row: Call = {
    grid,
    model,
    ms: attempt.ms,
    status: attempt.status,
    verdict: attempt.ok ? (toolCalls > 0 ? 'tool-called' : verdict) : verdict,
    note,
    toolCalls,
    contentChars,
  }
  rows.push(row)
  process.stdout.write(
    `  [${grid}] ${model} · HTTP ${attempt.status || '?'} · ${attempt.ms}ms · ` +
      `${VERDICT_LABEL[row.verdict]}` +
      `${
        toolCalls > 0
          ? `（${toolCalls} 个：${toolCallsOf(attempt.raw)
              .map((call) => call.function?.name ?? '?')
              .join(' / ')}）`
          : ''
      }` +
      `${attempt.ok ? ` · 正文 ${contentChars} 字` : ''}\n` +
      (attempt.ok ? '' : `        ${attempt.message.slice(0, 200)}\n`) +
      (note ? `        ${note}\n` : ''),
  )
  return row
}

/* ───────────────────────── 八格 ───────────────────────── */

async function gridA(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  rows: Call[],
): Promise<Attempt> {
  const attempt = await postWithBackoff(deps, model, {
    tools: TOOLS,
    tool_choice: 'auto',
  })
  return (
    record(
      rows,
      'A',
      model,
      attempt,
      classify(attempt.status, attempt.code, attempt.message),
      'tools + tool_choice:auto。★ 这一格的 tool_calls 就是「能用」本身',
    ),
    attempt
  )
}

async function gridB(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  rows: Call[],
): Promise<void> {
  await sleep(delayMs)
  const attempt = await postWithBackoff(deps, model, {
    tools: TOOLS,
    tool_choice: { type: 'function', function: { name: 'read_shelf' } },
  })
  record(
    rows,
    'B',
    model,
    attempt,
    classify(attempt.status, attempt.code, attempt.message),
    'tool_choice 强制点名。不支持的点名多半会回 4xx，而不是静默当 auto',
  )
}

async function gridC(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  rows: Call[],
  first: Attempt,
): Promise<void> {
  const callsOfFirst = first.ok ? toolCallsOf(first.raw) : []
  if (callsOfFirst.length === 0) {
    rows.push({
      grid: 'C',
      model,
      ms: 0,
      status: 0,
      verdict: 'inconclusive',
      note: 'A 没调工具，多轮这一格**没测成**（不是"不支持多轮"）',
      toolCalls: 0,
      contentChars: 0,
    })
    process.stdout.write('  [C] 跳过：A 没调工具，多轮无从测起（记**没结论**，不是"不行"）\n')
    return
  }

  await sleep(delayMs)
  const assistant = messageOf(first.raw) as Record<string, unknown>
  const messages = [
    { role: 'system', content: '你是一个中文绘本创作助手。需要外部信息时先调用工具。' },
    { role: 'user', content: ASK_TOOL },
    {
      role: 'assistant',
      content: assistant['content'] ?? null,
      tool_calls: callsOfFirst,
    },
    ...callsOfFirst.map((call) => ({
      role: 'tool',
      tool_call_id: call.id ?? 'call_0',
      content: '这个孩子已经有 2 本：《小宇的云》（云）与《森林里的雨》（下雨）。',
    })),
  ]
  const attempt = await postWithBackoff(deps, model, {
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
  })
  const row = record(
    rows,
    'C',
    model,
    attempt,
    classify(attempt.status, attempt.code, attempt.message),
    '把 tool 结果回填后能不能续上（期望：给一段正文，或者再调一次工具）',
  )
  if (attempt.ok && row.toolCalls === 0 && row.contentChars === 0) {
    row.verdict = 'inconclusive'
    row.note += ' ★ 200 但正文与 tool_calls 都空 —— 续上了但什么都没说，按**没结论**记'
  }
}

async function gridD(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  rows: Call[],
): Promise<void> {
  await sleep(delayMs)
  const attempt = await postWithBackoff(deps, model, {
    messages: [
      { role: 'system', content: '你是一个中文绘本创作助手。需要外部信息时先调用工具。' },
      { role: 'user', content: ASK_JSON },
    ],
    tools: TOOLS,
    tool_choice: 'auto',
    response_format: { type: 'json_object' },
  })
  record(
    rows,
    'D',
    model,
    attempt,
    classify(attempt.status, attempt.code, attempt.message),
    '★ 承重格：tools + response_format:json_object 同给（规划那条今天就吃 json_object）',
  )
}

async function gridE(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  rows: Call[],
): Promise<void> {
  await sleep(delayMs)
  const attempt = await postWithBackoff(deps, model, {
    messages: [
      { role: 'system', content: '你是一个中文绘本创作助手。需要外部信息时先调用工具。' },
      { role: 'user', content: ASK_JSON },
    ],
    tools: TOOLS,
    tool_choice: 'auto',
    response_format: JSON_SCHEMA_RESPONSE,
  })
  record(
    rows,
    'E',
    model,
    attempt,
    classify(attempt.status, attempt.code, attempt.message),
    '★ 承重格：tools + response_format:json_schema（LLM_JSON_MODE=schema 那一档）',
  )
}

async function gridF(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  rows: Call[],
): Promise<void> {
  /* F1 · 未知的顶层字段：网关宽还是严。它决定「A 回 200 但没有 tool_calls」怎么读 */
  await sleep(delayMs)
  const f1 = await postWithBackoff(deps, model, { xiaozhujue_no_such_field: 1 })
  const f1Verdict: Verdict = f1.ok ? 'accepted-no-call' : classify(f1.status, f1.code, f1.message)
  record(
    rows,
    'F1',
    model,
    f1,
    f1Verdict,
    f1.ok
      ? '★ 网关**忽略**未知字段 ⇒ 「200 但没有 tool_calls」读成「参数被丢了 = 不支持」'
      : '★ 网关**拦**未知字段 ⇒ 那 A 的 200 就说明 tools 真的进了请求体',
  )

  /* F2 · 一个没有 name 的函数：网关到底有没有**解析** tools 这个字段 */
  await sleep(delayMs)
  const f2 = await postWithBackoff(deps, model, {
    tools: [{ type: 'function', function: { description: '这个函数故意没有 name' } }],
    tool_choice: 'auto',
  })
  record(
    rows,
    'F2',
    model,
    f2,
    classify(f2.status, f2.code, f2.message),
    f2.ok
      ? '★ 形状坏掉的 tools 也回 200 ⇒ 网关**不解析** tools，A 的结果要打折看'
      : '★ 它回 4xx ⇒ 网关**确实解析** tools 字段（这条是正对照，A 的结论因此站得住）',
  )
}

async function gridH(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  rows: Call[],
): Promise<void> {
  await sleep(delayMs)
  const attempt = await postWithBackoff(deps, model, {
    tools: TOOLS,
    tool_choice: 'auto',
    parallel_tool_calls: false,
  })
  record(
    rows,
    'H',
    model,
    attempt,
    classify(attempt.status, attempt.code, attempt.message),
    'parallel_tool_calls:false（并行调用会让步数账变复杂，能用就用它）',
  )
}

/* ───────────────────────── 汇总 ───────────────────────── */

function summary(rows: Call[], configuredModel: string): void {
  const conclusive: Verdict[] = [
    'tool-called',
    'accepted-no-call',
    'choice-forced-unsupported',
    'tools-unsupported',
    'format-conflict',
    'json-word',
    'shape',
  ]
  const done = rows.filter((row) => conclusive.includes(row.verdict))
  const unknown = rows.filter((row) => row.verdict === 'inconclusive')

  /**
   * 「网关收了这条请求体」——`tool-called` 与 `accepted-no-call` 都算。
   *
   * ★ D / E 两格问的是「同给会不会被拒」，不是「模型肯不肯调」。
   *   把 `accepted-no-call` 读成失败，会说出一句「json 与 tools 互斥」的假结论——
   *   而实测 glm-5.3-flash 的 D 就是 200 + 227 字正文（它宁可写字也不调工具），
   *   网关那一侧一个字都没拦。
   */
  const accepted = (verdict: Verdict | undefined): boolean =>
    verdict === 'tool-called' || verdict === 'accepted-no-call'

  process.stdout.write(`\n${'─'.repeat(72)}\n`)
  process.stdout.write(`调用 ${calls} 次（费用不记——口径见 scripts/env.mts 文件头）\n\n`)
  process.stdout.write('| 格 | 模型 | HTTP | 读数 |\n| -- | ---- | ---- | ---- |\n')
  for (const row of rows) {
    process.stdout.write(
      `| ${row.grid} | ${row.model} | ${row.status || '?'} | ${VERDICT_LABEL[row.verdict]} |\n`,
    )
  }

  const a = rows.find((row) => row.grid === 'A' && row.model === configuredModel)
  const d = rows.find((row) => row.grid === 'D' && row.model === configuredModel)
  const e = rows.find((row) => row.grid === 'E' && row.model === configuredModel)
  const f2 = rows.find((row) => row.grid === 'F2' && row.model === configuredModel)

  process.stdout.write(`\n有结论 ${done.length} 格 · 没结论 ${unknown.length} 格\n`)
  if (unknown.length > 0) {
    process.stdout.write(
      '★ **不许下全称否定**：只要还剩一格没测成，「这条路上不支持工具」就说不出口。\n' +
        `  没测成的是：${unknown.map((row) => row.grid).join(' / ')}——多半是限流，隔一会儿或 --delay 调大再跑\n`,
    )
  }

  process.stdout.write('\n回填 spec §四：\n')
  process.stdout.write(
    `- A（${configuredModel}）：${a ? VERDICT_LABEL[a.verdict] : '没跑'}` +
      `${a ? `（tool_calls ${a.toolCalls} 个）` : ''}\n`,
  )
  process.stdout.write(`- D（json_object 同给）：${d ? VERDICT_LABEL[d.verdict] : '没跑'}\n`)
  process.stdout.write(`- E（json_schema 同给）：${e ? VERDICT_LABEL[e.verdict] : '没跑'}\n`)
  process.stdout.write(`- F2（网关解不解析 tools）：${f2 ? VERDICT_LABEL[f2.verdict] : '没跑'}\n\n`)

  const usable = a?.verdict === 'tool-called'
  const dOk = accepted(d?.verdict)
  if (usable && dOk) {
    process.stdout.write(
      '结论：**工具调用可用，且与 response_format 不互斥。**\n' +
        '  → 工单 06 按「不用放弃 JSON 强制」那一档做：规划那条的 `LLM_JSON_MODE` 保持不动。\n' +
        (d?.verdict === 'accepted-no-call'
          ? `  ★ 但 D 那一格模型**没调工具**（${d.model}）——那是模型选择，不是接口限制，\n` +
            '     别把它读成"互斥"。要它非调不可只能靠提示词（工单 07 的 description）。\n'
          : ''),
    )
    process.exitCode = 0
    return
  }
  if (usable) {
    process.stdout.write(
      '结论：**工具调用可用，但 D/E 那一格被拒了（response_format 与 tools 互斥）。**\n' +
        '  → 工单 06 要按「工具那一档不带 response_format」做，代价是规划的输出稳定性，\n' +
        '     这个代价由工单 08 的三臂对照量出来再决定默认。\n',
    )
    process.exitCode = 0
    return
  }
  process.stdout.write(
    '结论：**配置的那个模型上没拿到 tool_calls。**\n' +
      '  → 先看 G 那一轮：换个模型还有没有戏；再回来看 F1 决定 200 该怎么读。\n' +
      '  → ★ 在 G 跑完之前，不许写成「这条网关不支持 Function Calling」。\n',
  )
  process.exitCode = 1
}

/* ───────────────────────── main ───────────────────────── */

async function main(): Promise<void> {
  const env = await readEnv()
  const apiKey = env['LLM_API_KEY'] ?? ''
  if (!apiKey) throw new Error('LLM_API_KEY 未配置，无从探起')
  const baseUrl = env['LLM_BASE_URL'] ?? 'https://tokenrhythm.studio/v1'
  const deps = { baseUrl, apiKey }

  const configured = arg('model') || env['LLM_MODEL'] || ''
  if (!configured) throw new Error('LLM_MODEL 没配且没给 --model=')

  delayMs = Number(arg('delay') || 1200)
  const only = arg('only')
    .split(',')
    .map((one) => one.trim().toUpperCase())
    .filter(Boolean)
  const wanted = (grid: string): boolean => only.length === 0 || only.includes(grid)

  process.stdout.write(`探针：${PATH} 的 tools @ ${baseUrl}\n`)
  process.stdout.write(
    '判读：A 有 tool_calls = 能用｜D/E 是承重格｜F1/F2 决定 200 怎么读｜403/429/5xx = 没结论\n' +
      `模型 ${configured} · 每次调用间隔 ${delayMs}ms\n\n`,
  )

  const rows: Call[] = []

  let firstA: Attempt | null = null
  if (wanted('A')) firstA = await gridA(deps, configured, rows)
  if (wanted('B')) {
    await gridB(deps, configured, rows)
  }
  if (wanted('C')) {
    if (firstA) await gridC(deps, configured, rows, firstA)
    else process.stdout.write('  [C] 跳过：没跑 A（C 要用 A 的 tool_calls 才有得续）\n')
  }
  if (wanted('D')) await gridD(deps, configured, rows)
  if (wanted('E')) await gridE(deps, configured, rows)
  if (wanted('F')) await gridF(deps, configured, rows)
  if (wanted('H')) await gridH(deps, configured, rows)

  /* G · 候选模型各打一遍 A 与 D。★ 名单不含配置的那个（它上面已经打过 A–H 了） */
  if (wanted('G')) {
    const list = (arg('models') || 'glm-5.3-flash,deepseek-flash')
      .split(',')
      .map((one) => one.trim())
      .filter((one) => one && one !== configured)
    process.stdout.write(`\n[G] 候选模型各打一遍 A 与 D：${list.join(' / ')}\n`)
    for (const model of list) {
      await sleep(delayMs)
      await gridA(deps, model, rows)
      await gridD(deps, model, rows)
    }
  }

  summary(rows, configured)
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
