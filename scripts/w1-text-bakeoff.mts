/**
 * w1-text-bakeoff.mts —— 大模型结构化输出横评（tech-selection §12.2 产出物 3）
 *
 * ```bash
 * node scripts/w1-text-bakeoff.mts --models=a,b,c --books=10 --jsonMode=object --out=.out/bakeoff-text
 * # 只重出报告（排版改了不必重跑，不调用任何模型）：
 * node scripts/w1-text-bakeoff.mts --out=.out/bakeoff-text --reportOnly=1
 * ```
 *
 * 量法照 §12.1 的固定输入：**同一主题 × 10 本分镜**，结构化输出的通过率。
 *
 * ★ 四条容易做歪的地方，前三条是这一版改出来的：
 *
 * 1. **本脚本调 `planStory`，不自己搭一条流水线。**上一版手写了
 *    "调用 → 校验 → buildTree → 重试"，与 `plan.ts` 悄悄分了叉：maxTokens
 *    3000 vs 4096、树形不合法时 `break` vs `continue`。分叉的代价不是风格问题——
 *    横评表的数字是**另一条流水线**的成绩，它不是引擎要用的那个数。
 *    委托之后，这里测的就是引擎要跑的，没有第二份要同步。
 *
 * 2. **三种结局必须分开记**：`ok` / `plan-invalid`（三次规划都没过 Schema 或树形）
 *    / `call-failed`（调用与传输层：超时、无正文、503…）。
 *    上一版把三者压进一个 `pagesValid`，于是"超时"读起来和"不会出 JSON"一模一样——
 *    用"裁判没到场"判"选手没跑"，这是这个项目里第二次踩同一个坑
 *    （第一次在图像横评，见 w1-image-bakeoff.mts）。
 *    分界线现成地就在引擎里：`plan.ts` 三次失败后抛 `schema-validation-failed`，
 *    其余错误码都是调用层的。
 *
 * 3. **失败原因原样转发，不自己重新归类。**`planStory` 已经把每次的具体问题
 *    （`第 N 次：Schema 校验未过 …`）写好了，横评表直接引它的话。
 *    自己再解析一遍字符串，就又多一份会分叉的真相。
 *
 * 4. **JSON 约束档位是判据的一部分**（`--jsonMode=none|object|schema`）。
 *    同一家在三档下表现可能差很多，报告里必须写明测的是哪一档，
 *    否则横评表变成"三家用了三种方法"。
 *
 * 判据 2（中文儿童文学语感）**不在这个脚本里**：那是人工判读，
 * 脚本只负责把正文导出成一个便于人读的 markdown，判读结论回填 §9.1。
 *
 * ★ 这里**没有** `--yes=1` 之类的确认闸门：10/13 定的口径是额度管够、
 *   不必记账也不必逐次报告（见 `scripts/env.mts` 文件头）。
 *   一个每次都要按的确认键，最后只会变成条件反射式的敲下去，那时它就不再拦任何东西。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { createOpenAiText } from '../src/lib/engine/providers/openai-text.ts'
import { textOptionsOf } from '../src/lib/engine/providers/registry.ts'
import { planStory } from '../src/lib/engine/plan.ts'
import { EngineError } from '../src/lib/engine/errors.ts'
import { arg, readEnv } from './env.mts'

const THEMES = [
  '怕黑',
  '第一天上幼儿园',
  '学会说不',
  '想念爸爸妈妈',
  '分享',
  '友谊',
  '勇气',
  '输了不高兴',
  '家里添了弟弟妹妹',
  '在幼儿园走丢了',
] as const

/** 一次生成的三选一结局。**互斥**，不许出现"既失败又成功"的记账 */
type Verdict = 'ok' | 'plan-invalid' | 'call-failed'

type BookRecord = {
  theme: string
  verdict: Verdict
  /** 只在 ok / plan-invalid 时有意义；call-failed 停在半路，没有可比的次数 */
  attempts: number
  /** planStory 逐次失败的**原文**，不是我转述的 */
  failures: string[]
  pageCount: number
  seconds: number
  title?: string
  sample?: string[]
  /** 仅 call-failed：适配器/传输层的错误码与消息 */
  errorCode?: string
  error?: string
  traceId?: string
}

async function main(): Promise<void> {
  const env = await readEnv()
  const models = arg('models', env['LLM_MODEL'] ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  if (models.length === 0) throw new Error('--models 必填（或先在 .env.local 配 LLM_MODEL）')
  const books = Number(arg('books', '10'))
  const maxAttempts = Number(arg('maxAttempts', '3'))
  const jsonMode = arg('jsonMode', 'object') as 'none' | 'object' | 'schema'
  // 缺省留空 = 用适配器的文本缺省（180s）。只在"想确认某家是不是只是慢"时才调它
  const timeoutArg = arg('timeoutMs', '')
  const out = resolve(arg('out', '.out/bakeoff-text'))
  await mkdir(out, { recursive: true })

  // ★ 只重出报告，不重跑：报告的排版（表格、列表缩进、截断）改错一次就要重花一遍
  //   全部调用，那是拿钱买一次排版修复。原始数据在 json 里，重放它就是了。
  //   `books` 从 json 里读回来，避免表头写着错的数。
  if (arg('reportOnly', '') === '1') {
    const saved = JSON.parse(await readFile(join(out, 'text-bakeoff.json'), 'utf8')) as Record<
      string,
      BookRecord[]
    >
    const savedBooks = Math.max(...Object.values(saved).map((rows) => rows.length))
    await writeFile(
      join(out, 'text-bakeoff.md'),
      renderReport(saved, jsonMode, savedBooks, maxAttempts),
      'utf8',
    )
    process.stdout.write(
      `从 ${join(out, 'text-bakeoff.json')} 重出报告（未调用任何模型）：\n` +
        `${join(out, 'text-bakeoff.md')}\n`,
    )
    return
  }

  process.stdout.write(
    `横评：${models.length} 个候选 × ${books} 本，JSON 约束档 = ${jsonMode}，` +
      `重试上限 ${maxAttempts}（走引擎的 planStory，不是本脚本另搭的流水线）\n` +
      `单次调用超时：${timeoutArg || env['LLM_TIMEOUT_MS'] || '180000（适配器文本缺省）'}\n\n`,
  )

  const all: Record<string, BookRecord[]> = {}
  // ★ 适配器选项由注册表派生，**不是本脚本自己拼**。上一版是 `{jsonMode}` 一行，
  //   看着没毛病，实际漏了预算与思考开关——而这两项正是让四个候选判成 0/10 的东西。
  //   横评脚本里凡是"生产也有的配置"，都只能有一个来源。
  const adapterOptions = textOptionsOf(env)
  process.stdout.write(
    `适配器选项（与生产同源）：jsonMode=${adapterOptions.jsonMode} · ` +
      `预算 ${adapterOptions.defaultMaxTokens ?? '4096（缺省）'} · ` +
      `思考 ${adapterOptions.extra?.['enable_thinking'] === false ? '关' : '开'}\n\n`,
  )

  for (const model of models) {
    const text = createOpenAiText(
      {
        baseUrl: env['LLM_BASE_URL'] ?? 'https://tokenrhythm.studio/v1',
        apiKey: env['LLM_API_KEY'] ?? '',
        // 优先级：--timeoutMs > .env.local 的 LLM_TIMEOUT_MS > 适配器文本缺省（180s）。
        // 这一项在过去那次跑测里是 60s，三个 max 档候选因此被判成 0/10——
        // 超时被读成了"不会出 JSON"
        timeoutMs: timeoutArg
          ? Number(timeoutArg)
          : env['LLM_TIMEOUT_MS']
            ? Number(env['LLM_TIMEOUT_MS'])
            : undefined,
      },
      model,
      // jsonMode 允许命令行覆盖（横评要按档分别测，档位本身是判据的一部分）；
      // 其余一律跟生产走
      { ...adapterOptions, jsonMode },
    )
    const results: BookRecord[] = []
    for (let i = 0; i < books; i += 1) {
      const theme = THEMES[i % THEMES.length] as string
      const started = Date.now()
      const record: BookRecord = {
        theme,
        verdict: 'call-failed',
        attempts: 0,
        failures: [],
        pageCount: 0,
        seconds: 0,
      }
      try {
        const outcome = await planStory(
          {
            childName: '小宇',
            nameReading: 'yǔ',
            ageBand: '4-6',
            interestTags: ['恐龙', '船'],
            lookTags: ['圆脸'],
            theme,
            form: 'solo',
            pages: 6,
          },
          { text, form: 'solo', maxAttempts, emit: () => {} },
        )
        record.verdict = 'ok'
        record.attempts = outcome.attempts
        record.failures = [...outcome.failures]
        record.pageCount = outcome.tree.nodes.length
        record.title = outcome.tree.title
        record.sample = outcome.tree.nodes.slice(0, 2).flatMap((node) => node.body)
      } catch (err) {
        const engine = err instanceof EngineError ? err : null
        record.errorCode = engine?.code
        record.error = err instanceof Error ? err.message : String(err)
        record.traceId = engine?.traceId
        // ★ 分界线就是引擎自己的错误码：三次规划都没过 Schema/树形 → 选手的问题；
        //   别的码 → 牌桌的问题。把这两者记成一件事，横评表就会给出相反的结论。
        if (engine?.code === 'schema-validation-failed') {
          record.verdict = 'plan-invalid'
          record.attempts = maxAttempts
          record.failures = Array.isArray(engine.detail)
            ? engine.detail.map((item) => String(item))
            : [engine.message]
        }
      }
      record.seconds = Math.round((Date.now() - started) / 100) / 10
      results.push(record)
      const tag =
        record.verdict === 'ok'
          ? `过 · ${record.attempts} 次`
          : record.verdict === 'plan-invalid'
            ? `${maxAttempts} 次规划不过`
            : `**调用失败** ${record.error ?? ''}`
      process.stdout.write(
        `  ${model} · ${theme}：${record.pageCount} 页 · ${record.seconds}s · ${tag}\n`,
      )
    }
    all[model] = results
  }

  await writeFile(join(out, 'text-bakeoff.json'), JSON.stringify(all, null, 2), 'utf8')
  await writeFile(
    join(out, 'text-bakeoff.md'),
    renderReport(all, jsonMode, books, maxAttempts),
    'utf8',
  )
  process.stdout.write(`\n报告：${join(out, 'text-bakeoff.md')}\n`)
}

function renderReport(
  all: Record<string, BookRecord[]>,
  jsonMode: string,
  books: number,
  maxAttempts: number,
): string {
  const lines = [
    '# 大模型结构化输出横评（§12.2 产出物 3）',
    '',
    `- 固定输入：同一批主题 × ${books} 本，独读版 6 页，适龄档 4-6，JSON 约束档 **${jsonMode}**`,
    '- 走的是引擎真正的规划流水线 `planStory`（Schema 校验 + 树形校验 + 带反馈重试），不是脚本另搭的一条',
    '- 判据 1 是一票否决，量法是"结构化输出通过率"。分母里**不含调用失败**：',
    '  "裁判没到场"不能判"选手没跑"——那一类单独列在"调用失败"一列，它证的是可达性/稳定性，不是格式能力',
    '',
    `| 候选 | 通过（≤${maxAttempts} 次） | 一次过 | 出页数（要求 6） | 平均重试 | 三次规划不过 | 调用失败 | 首条病因（引擎原文） |`,
    '|---|---|---|---|---|---|---|---|',
  ]
  for (const [model, results] of Object.entries(all)) {
    const ok = results.filter((r) => r.verdict === 'ok')
    const firstPass = ok.filter((r) => r.attempts === 1).length
    const planInvalid = results.filter((r) => r.verdict === 'plan-invalid')
    const callFailed = results.filter((r) => r.verdict === 'call-failed')
    // 分母 = 真的拿到过裁决的本。调用失败的不进来，否则通过率会被网络抖动拉低，
    // 而那张表是用来选模型的格式能力的
    const judged = ok.length + planInvalid.length
    // 页数只统计**成功**的本：规划不过的本没有树，混进来会把均值拉成假数
    const pages =
      ok.length > 0
        ? `${(ok.reduce((sum, r) => sum + r.pageCount, 0) / ok.length).toFixed(1)}` +
          `（${Math.min(...ok.map((r) => r.pageCount))}–${Math.max(...ok.map((r) => r.pageCount))}）`
        : '—'
    const avgAttempts =
      judged > 0
        ? (
            results
              .filter((r) => r.verdict !== 'call-failed')
              .reduce((sum, r) => sum + r.attempts, 0) / judged
          ).toFixed(2)
        : '—'
    const rawFailure = (planInvalid[0]?.failures[0] ?? callFailed[0]?.error ?? '—').replace(
      /\s+/g,
      ' ',
    )
    const firstFailure = rawFailure.length > 90 ? `${rawFailure.slice(0, 90)}…` : rawFailure
    lines.push(
      `| ${model} | ${ok.length}/${judged || results.length} | ${firstPass}/${judged || results.length} | ` +
        `${pages} | ${avgAttempts} | ${planInvalid.length}/${results.length} | ` +
        `${callFailed.length}/${results.length} | ${firstFailure} |`,
    )
  }

  const callFailures = Object.entries(all).flatMap(([model, results]) =>
    results
      .filter((r) => r.verdict === 'call-failed')
      .map(
        (r) =>
          `- ${model} · ${r.theme}（${r.seconds}s）：${r.errorCode ?? '?'} · ${r.error ?? '?'}` +
          `${r.traceId ? `（traceId=${r.traceId}）` : ''}`,
      ),
  )
  // ★ 缩进要处理"多行的一条"：引擎的失败原因本身是多行
  //   （`第 1 次：树形不合法\n- 第 1 页：…`），直接把整条塞进 `  - ${f}` 的话，
  //   它自带的 `- ` 会顶到最外层，报告看起来像是我把列表拼坏了。所以逐行缩进。
  const indent = (text: string): string => text.split('\n').join('\n    ')
  const planFailures = Object.entries(all).flatMap(([model, results]) =>
    results
      .filter((r) => r.verdict === 'plan-invalid')
      .map(
        (r) => `- ${model} · ${r.theme}：\n` + r.failures.map((f) => `  - ${indent(f)}`).join('\n'),
      ),
  )

  // ★ `.flat()` 不能省：里层 `.map` 每本产出的是一个**数组**，不摊平的话
  //   最后 `.join('\n')` 会把这些数组按 toString 拼成 `标题,,正文,正文` 一行。
  //   踩过一次，报告里那行看着像模型自己的输出格式不对——其实是我拼错了。
  const samples = Object.entries(all)
    .flatMap(([model, results]) =>
      results
        .filter((result) => result.sample && result.theme === '怕黑')
        .map((result) => [
          `## ${model} ·《${result.title ?? '?'}》（怕黑）`,
          '',
          ...(result.sample ?? []).map((line) => `> ${line}`),
          '',
        ]),
    )
    .flat()
  return [
    ...lines,
    '',
    ...(callFailures.length > 0
      ? [
          '## 调用失败明细（**不是**格式能力，单独看）',
          '',
          ...callFailures,
          '',
          '这一类的处置是"重跑/换网络/等平台恢复"，与"这家出不了 JSON"完全不同。',
          '实测见过平台侧 503 `SERVICE_BUSY`「API Key 鉴权服务暂时不可用」——它是**转瞬的**，',
          '而 POST 按纪律不重试（见 http.ts:shouldRetry），一次抖动就吃掉一整本。',
        ]
      : []),
    ...(planFailures.length > 0
      ? ['', '## 三次规划不过明细（引擎原文）', '', ...planFailures]
      : []),
    '',
    '## 语感判读样本（判据 2，人工：4/6/8 岁三档各读一遍）',
    '',
    ...samples,
  ].join('\n')
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
