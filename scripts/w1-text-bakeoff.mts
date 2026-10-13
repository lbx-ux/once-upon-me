/**
 * w1-text-bakeoff.mts —— 大模型结构化输出横评（tech-selection §12.2 产出物 3）
 *
 * ```bash
 * node scripts/w1-text-bakeoff.mts --models=a,b,c --books=10 --jsonMode=object --out=.out/bakeoff-text
 * ```
 *
 * 量法照 §12.1 的固定输入：**同一主题 × 10 本分镜**，每页 4 字段的 Schema 校验通过率。
 * 三条容易做歪的地方：
 *
 * 1. **通过率按页算，也按本算**。只看"10 本里几本全过"会把"错一页"和"错一半"
 *    压成同一个数；只看按页的又看不出"一本书能不能一次拿到"。两个都要。
 * 2. **JSON 约束档位是判据的一部分**（`--jsonMode=none|object|schema`）。
 *    同一家在三档下表现可能差很多，报告里必须写明测的是哪一档，
 *    否则横评表变成"三家用了三种方法"。
 * 3. **重试次数单独记**。判据 1 说的是"通过率"，但"一次过 90%"与
 *    "重试两次才 90%"在成本公式 §10.1 里是两个数。
 *
 * 判据 2（中文儿童文学语感）**不在这个脚本里**：那是人工判读，
 * 脚本只负责把 10 本正文导出成一个便于人读的 markdown，判读结论回填 §9.1。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { createOpenAiText } from '../src/lib/engine/providers/openai-text.ts'
import { storyPlanSystem, storyPlanUser } from '../src/lib/prompts/story-plan.ts'
import { asPlanDraft, planDraftCodec, planJsonSchema } from '../src/lib/schemas/story.ts'
import { buildTree } from '../src/lib/engine/tree.ts'
import { formatFailures, parseWith } from '../src/lib/schemas/schema.ts'
import { readFile } from 'node:fs/promises'

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

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

async function loadEnv(): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = { ...process.env }
  try {
    for (const line of (await readFile('.env.local', 'utf8')).split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (match) env[match[1] as string] = (match[2] as string).replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 用进程环境 */
  }
  return env
}

type BookResult = {
  theme: string
  attempts: number
  pagesTotal: number
  pagesValid: number
  /** 四个字段各自的失败次数，直接对应 §9.2 判据 1 的"每页 4 字段" */
  fieldFailures: Record<string, number>
  treeOk: boolean
  errors: string[]
  title?: string
  sample?: string[]
  usage?: { promptTokens?: number; completionTokens?: number }
}

async function main(): Promise<void> {
  const env = await loadEnv()
  const models = arg('models', env['LLM_MODEL'] ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  if (models.length === 0) throw new Error('--models 必填（或先在 .env.local 配 LLM_MODEL）')
  const books = Number(arg('books', '10'))
  const jsonMode = arg('jsonMode', 'object') as 'none' | 'object' | 'schema'
  const out = resolve(arg('out', '.out/bakeoff-text'))
  await mkdir(out, { recursive: true })

  process.stdout.write(`横评：${models.length} 个候选 × ${books} 本，JSON 约束档 = ${jsonMode}\n`)
  if (arg('yes', '') !== '1') {
    process.stdout.write('这会真调用模型（消耗额度）。确认请加 --yes=1\n')
    return
  }

  const all: Record<string, BookResult[]> = {}
  for (const model of models) {
    const text = createOpenAiText(
      {
        baseUrl: env['LLM_BASE_URL'] ?? 'https://tokenrhythm.studio/v1',
        apiKey: env['LLM_API_KEY'] ?? '',
      },
      model,
      { jsonMode },
    )
    const results: BookResult[] = []
    for (let i = 0; i < books; i += 1) {
      const theme = THEMES[i % THEMES.length] as string
      const user = storyPlanUser({
        childName: '小宇',
        nameReading: 'yǔ',
        ageBand: '4-6',
        interestTags: ['恐龙', '船'],
        lookTags: ['圆脸'],
        theme,
        form: 'solo',
        pages: 6,
      })
      const record: BookResult = {
        theme,
        attempts: 0,
        pagesTotal: 0,
        pagesValid: 0,
        fieldFailures: {},
        treeOk: false,
        errors: [],
      }
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        record.attempts = attempt
        try {
          const response = await text.complete({
            system: storyPlanSystem(),
            user:
              attempt === 1
                ? user
                : `${user}\n\n【上一次不合格之处，只改这些】\n${record.errors.at(-1) ?? ''}`,
            jsonSchema: jsonMode === 'schema' ? planJsonSchema() : undefined,
            temperature: 0.8,
            maxTokens: 3000,
          })
          record.usage = response.usage
          const parsed = parseWith(planDraftCodec, response.text)
          if (!parsed.ok) {
            const message = formatFailures(parsed.failures, 20)
            record.errors.push(message)
            for (const failure of parsed.failures) {
              const field =
                failure.path
                  .split('.')
                  .at(-1)
                  ?.replace(/\[\d+\]/, '') ?? '?'
              record.fieldFailures[field] = (record.fieldFailures[field] ?? 0) + 1
            }
            continue
          }
          const plan = asPlanDraft(parsed.value)
          record.pagesTotal = plan.nodes.length
          record.pagesValid = plan.nodes.length
          record.title = plan.title
          record.sample = plan.nodes.slice(0, 2).flatMap((node) => node.body)
          const built = buildTree('solo', plan.title, plan.nodes)
          record.treeOk = built.ok
          if (!built.ok)
            record.errors.push(`树形：${built.problems.map((p) => p.message).join('；')}`)
          break
        } catch (err) {
          record.errors.push(err instanceof Error ? err.message : String(err))
          break
        }
      }
      results.push(record)
      process.stdout.write(
        `  ${model} · ${theme}：${record.pagesValid} 页 / ${record.attempts} 次${record.treeOk ? '' : ' / 树形不合法'}\n`,
      )
    }
    all[model] = results
  }

  await writeFile(join(out, 'text-bakeoff.json'), JSON.stringify(all, null, 2), 'utf8')
  await writeFile(join(out, 'text-bakeoff.md'), renderReport(all, jsonMode, books), 'utf8')
  process.stdout.write(`\n报告：${join(out, 'text-bakeoff.md')}\n`)
}

function renderReport(all: Record<string, BookResult[]>, jsonMode: string, books: number): string {
  const lines = [
    '# 大模型结构化输出横评（§12.2 产出物 3）',
    '',
    `- 固定输入：同一批主题 × ${books} 本，独读版 6 页，适龄档 4-6，JSON 约束档 **${jsonMode}**`,
    '- 判据 1 是一票否决。**通过率低于 90% 的候选不进语感盲评**——结构都不稳，语感无从谈起。',
    '',
    '| 候选 | 一次过 | ≤3 次过 | 按页通过率 | 树形合法 | 平均重试 | 缺字段 TOP |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const [model, results] of Object.entries(all)) {
    const firstPass = results.filter((r) => r.attempts === 1 && r.pagesValid > 0).length
    const anyPass = results.filter((r) => r.pagesValid > 0).length
    const pages = results.reduce((sum, r) => sum + r.pagesTotal, 0)
    const valid = results.reduce((sum, r) => sum + r.pagesValid, 0)
    const treeOk = results.filter((r) => r.treeOk).length
    const avgAttempts = (
      results.reduce((sum, r) => sum + r.attempts, 0) / Math.max(1, results.length)
    ).toFixed(2)
    const fields: Record<string, number> = {}
    for (const result of results) {
      for (const [field, count] of Object.entries(result.fieldFailures)) {
        fields[field] = (fields[field] ?? 0) + count
      }
    }
    const top =
      Object.entries(fields)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([field, count]) => `${field}×${count}`)
        .join(' ') || '—'
    lines.push(
      `| ${model} | ${firstPass}/${results.length} | ${anyPass}/${results.length} | ${pages ? ((valid / pages) * 100).toFixed(1) : '0.0'}% | ${treeOk}/${results.length} | ${avgAttempts} | ${top} |`,
    )
  }
  const samples = Object.entries(all).flatMap(([model, results]) =>
    results
      .filter((result) => result.sample && result.theme === '怕黑')
      .map((result) => [
        `## ${model} ·《${result.title ?? '?'}》（怕黑）`,
        '',
        ...(result.sample ?? []).map((line) => `> ${line}`),
      ]),
  )
  return [
    ...lines,
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
