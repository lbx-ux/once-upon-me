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
 * | 1b | 各家的**关思考字段**（`enable_thinking`）到底生效没有——判据是"思考长度归零"，且**配一个不发该字段的空对照** | 每模型两次小调用 |
 * | 2 | 同一模型三档：现行预算 4096 / 放大到 16000 / 加关思考参数 | 每模型 2–3 次 |
 *
 * ★ 步骤 1 与 1b 是**两个不同强度的命题**，别把它们合成一个（合过一次，错了）：
 *   "字段名存在" 弱于 "这个值被允许"。步骤 1 能免费回答前者，
 *   步骤 1b 必须花一点钱才能回答后者——而选型要的是后者。
 *
 * ★ 1b 在 2026-10-21 **第二次**说错了话，那一次的错法记在它的实现处：
 *   它拿 `HTTP 200` 当"关思考可用"，而换到 DeepSeek 那天量到——这家**忽略不认识的字段**，
 *   200 照回、思考一个字都没少（135 → 175 字符）。所以判据改成"与空对照比思考长度"。
 *   一句话：**"没报错"不是"生效了"**，判据要落在只有真做才会不同的那个量上。
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
  process.stdout.write('\n── 步骤 1b：关思考的候选写法，逐个与**空对照**比思考长度 ──\n')
  /**
   * ★ 2026-10-21 这一节**第二次**说错了话，错法值得留着：
   *
   *   它原来拿 `HTTP 200` 当"关思考可用 ✓"。换到 DeepSeek 那天量了三个变体各一次
   *   （`.out/tmp/thinking-live.txt`）：
   *
   *   | 送什么 | reasoning 字符 | completion_tokens |
   *   | --- | --- | --- |
   *   | 什么都不送（厂商默认） | 135 | 90 |
   *   | `enable_thinking: false`（百炼那套写法） | **175** | 109 |
   *   | `thinking: {type: 'disabled'}`（DeepSeek 文档写法） | **0** | 21 |
   *
   *   第二行就是旧判据会报成"✓"的那一格：**200 照回、思考一个字都没少**。
   *   这家忽略不认识的字段（步骤 1 量到过），所以状态码在这里什么都证明不了——
   *   **"没报错"不等于"生效了"**。
   *
   *   所以判据改成两件事一起看：
   *   1. **思考长度**归零了没有（那是只有真做才会不同的量）；
   *   2. 配一个**不发该字段的空对照**——不然"这个模型本来就不思考"会被记成"我们关掉了"。
   *
   *   顺带把候选表整个跑一遍（原来只试 `enable_thinking` 一个名字）：
   *   只试一个名字的代价在这一天正好露出来了——DeepSeek 关得掉，只是不叫那个名字。
   */
  type Verdict = 'worked' | 'ignored' | 'moot' | 'refused' | 'inconclusive'
  type CandidateResult = { name: string; verdict: Verdict; reasoning: number; note: string }
  const perModel: { model: string; baseline: number; candidates: CandidateResult[] }[] = []
  /**
   * 每个候选**跑两次**再下结论。
   *
   * ★ 这一条是 2026-10-21 被数据逼出来的：同一份探针连跑两次，
   *   `enable_thinking=false` 第一次读成"思考 0 字 ✓"、第二次读成"思考 50 字 · 被忽略"。
   *   两次读数不一致时，单次那一份就是噪声——**先复跑，再写结论**。
   *   两次一致才算数，不一致记 `inconclusive`（"没测出来"），不许挑对自己有利的那一次。
   */
  const repeats = Math.max(1, Number(arg('repeats', '2')))
  /** 判定用的那份读数：答了没有、思考多少字 */
  const readOne = (parsed: unknown): { answered: boolean; reasoning: number } => {
    // "答了"的判据是**有 finish_reason**（回包结构对得上）。一个 200 但结构不对的
    //   回包会把"没有 reasoning_content"读成"思考被关掉了"——那正是上面那次假读数的形状
    const answered = walk(parsed, ['finish_reason']).found
    const hit = walk(parsed, ['reasoning_content']).hit
    return { answered, reasoning: typeof hit === 'string' ? hit.length : 0 }
  }
  /**
   * 判定用的预算。**不用 16**：那一档下思考链会被截断在几十字符，
   *   于是"0 字"与"还没来得及想"长得一样（实测：16 → 基线 46–58 字；256 → 759–998 字）。
   *   256 那一档下 `0` 与 `几百` 是一眼能分开的两个数，而它一次调用仍然很便宜。
   */
  const JUDGE_BUDGET = 256
  for (const model of models) {
    /** 空对照：同样的 prompt、同样的预算，**不发任何关思考字段** */
    const baselineReads = []
    for (let i = 0; i < repeats; i += 1) {
      baselineReads.push(
        readOne((await call(baseUrl, apiKey, storyPlanBody(model, JUDGE_BUDGET))).parsed),
      )
    }
    const baseReason = Math.min(...baselineReads.map((one) => one.reasoning))
    process.stdout.write(
      `  ${model}：空对照（不发关思考字段）思考 ${baselineReads.map((one) => one.reasoning).join('/')} 字\n`,
    )
    const candidates: CandidateResult[] = []
    for (const [key, value] of THINKING_OFF_CANDIDATES) {
      const reads = []
      let note = ''
      let refusedStatus = 0
      for (let i = 0; i < repeats; i += 1) {
        const { status, text, parsed } = await call(baseUrl, apiKey, {
          ...storyPlanBody(model, JUDGE_BUDGET),
          [key]: value,
        })
        note = text.slice(0, 110)
        const unknownField = /未知字段|unknown|unexpected|unrecognized/i.test(text)
        if (status >= 400 && status < 500 && !unknownField) refusedStatus = status
        reads.push({ status, unknownField, ...readOne(parsed) })
      }
      // ★ 判据分五档，合起来报就会说假话：
      //   4xx 且非未知字段 → **拒绝这个值**
      //   5xx / 0 / 网络    → **不知道**（503 是平台抖动，拿它当结论就冤枉了一家）
      //   有哪一次没答上来  → **不知道**（别把"空回包"读成"思考被关掉了"）
      //   每次都答了、思考全为 0、空对照确有思考 → **真关掉了**
      //   每次都答了、思考都不为 0 → **被忽略**（不等于"它关不掉"）
      const allAnswered = reads.every((one) => one.answered)
      const allZero = reads.every((one) => one.reasoning === 0)
      const anyZero = reads.some((one) => one.reasoning === 0)
      const verdict: Verdict =
        refusedStatus > 0
          ? 'refused'
          : reads.some((one) => one.status < 200 || one.status >= 300)
            ? 'inconclusive'
            : !allAnswered
              ? 'inconclusive'
              : baseReason === 0
                ? 'moot'
                : allZero
                  ? 'worked'
                  : anyZero
                    ? 'inconclusive' // 两次不一致：一次 0、一次不是
                    : 'ignored'
      candidates.push({
        name: `${key}=${JSON.stringify(value)}`,
        verdict,
        reasoning: allZero ? 0 : Math.min(...reads.map((one) => one.reasoning)),
        note,
      })
      process.stdout.write(
        `    ${`${key}=${JSON.stringify(value)}`.padEnd(46)} ` +
          `思考 ${reads.map((one) => (one.answered ? one.reasoning : '—')).join('/')} 字 · ` +
          {
            worked: '真关掉了 ✓',
            ignored: '被忽略（思考照旧）',
            moot: '不适用（它本来就不思考）',
            refused: `收字段但拒绝这个值 ✗（${note}）`,
            inconclusive: '**不知道**（复跑读数不一致，或这一次没答上来）',
          }[verdict] +
          '\n',
      )
    }
    perModel.push({ model, baseline: baseReason, candidates })
  }

  for (const one of perModel) {
    const worked = one.candidates.filter((item) => item.verdict === 'worked')
    const ignored = one.candidates.filter((item) => item.verdict === 'ignored')
    const inconclusive = one.candidates.filter((item) => item.verdict === 'inconclusive')
    const refused = one.candidates.filter((item) => item.verdict === 'refused')
    if (worked.length > 0) {
      process.stdout.write(
        `  ★ ${one.model}：**关得掉**，写法是 ${worked.map((item) => item.name).join(' / ')}` +
          `（思考 ${one.baseline} 字 → 0）\n`,
      )
    } else if (one.baseline === 0) {
      process.stdout.write(`  ★ ${one.model}：它本来就不思考，这一格对它没有意义\n`)
    } else if (inconclusive.length > 0) {
      process.stdout.write(
        `  ★ ${one.model}：**没测出来**（别当成"关不掉"，也别当成"能关"）：` +
          `${inconclusive.map((item) => item.name).join(' / ')}\n`,
      )
    } else if (refused.length === one.candidates.length) {
      process.stdout.write(
        `  ★ ${one.model}：**关不掉**——${refused.length} 个写法全被拒（不是超时，是实测拒绝）。\n` +
          '    注册表缺省 off 会让它**整家打不通**（响亮的 400，不是静默降级）：\n' +
          '    选到它就得 LLM_THINKING=on 且把 LLM_MAX_TOKENS 提到 16000，这一条要写进 §9.1\n',
      )
    } else {
      process.stdout.write(
        `  ★ ${one.model}：候选表里的写法**全部被忽略**（${ignored.length} 个）——` +
          '这多半意味着"它用的是表里没有的另一个写法"，而不是"它关不掉"。\n' +
          '    要下"关不掉"这个结论，得先把它的文档翻一遍、把那个写法补进 `THINKING_OFF_CANDIDATES`\n' +
          '    （DeepSeek 那一次就是这么补上 `thinking:{type:disabled}` 的，见 providers/thinking.ts）\n',
      )
    }
  }

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
