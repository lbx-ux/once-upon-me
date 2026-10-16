/**
 * probe-stream-gaps.mts —— 流式调用的**空闲间隔**实测（工单 07 §一.3 要的那个数）
 *
 * 为什么需要它：`http.ts` 的 `DEFAULT_SSE_IDLE_TIMEOUT_MS` 是一个**会判死好结果**的数
 * （比它更慢的家会被当成"上游卡住"）。这种数不许拍脑袋——拍高的代价是卡死不报错，
 * 拍低的代价是把慢模型判死，而两种错都要等真跑一本书才发现。
 *
 * 它量三件事，每件都对应一个会在真跑里出问题的判断：
 *
 * | 量什么 | 用来定什么 |
 * |---|---|
 * | 第一个 delta 前的等待（TTFT） | 空闲超时的**下界**：思考模型先想几千字才吐第一个字 |
 * | 相邻两个 delta 之间的最大间隔 | 空闲超时的量级（TTFT 往往是最大的那个间隔） |
 * | 这一轮到底有没有流式增量 | "这家支持 stream 吗"——不支持时我们拿到的是一整段，不是流 |
 *
 * ★ 它还顺手回答一个不许猜的问题：**不送 `stream_options` 时回包带不带 usage**。
 *   带就白拿（成本模型要用）；不带也不能为了它去送一个"某些网关会拒的字段"
 *   （图像接口上实测过未知字段被 400 挡回）。
 *
 * ```bash
 * node scripts/probe-stream-gaps.mts                 # 用 .env.local 里的 LLM_*
 * node scripts/probe-stream-gaps.mts --pages=3 --runs=2
 * ```
 *
 * ★ 密钥只从 `.env.local` 读进内存，**不打印、不落盘、不进 manifest**（ADR-0008）。
 */

import { arg, readEnv } from './env.mts'
import { storyPlanSystem, storyPlanUser } from '../src/lib/prompts/story-plan.ts'
import { textProviderOf } from '../src/lib/engine/providers/registry.ts'
import { readPlanProgress } from '../src/lib/engine/plan-stream.ts'
import { planJsonSchema } from '../src/lib/schemas/story.ts'

const env = await readEnv()
const model = env['LLM_MODEL']?.trim() ?? ''

/**
 * ★ 走 `textProviderOf`，不手搓 `createOpenAiText`。
 *
 * 第一版手搓了一次，结果是**探针自己造出来的假故障**：没带上注册表按 `LLM_THINKING`
 * 拼的那组"关思考"参数，于是模型想了 9202 字把预算吃光，正文一个字都没写——
 * 屏幕上出现的是"这家不会出正文"，而真相是"探针没按出厂配置问它"。
 * 探针要量的是**生产路径**的行为，配置必须一模一样。
 */
const text = textProviderOf(env)

const pages = Number(arg('pages', '3')) || 3
const runs = Number(arg('runs', '1')) || 1
/** 不传就是"按 .env.local / 适配器缺省"，与生产一致 */
const maxTokens = Number(arg('maxTokens', '0')) || undefined

const request = {
  system: storyPlanSystem(),
  user: storyPlanUser({
    childName: '小宇',
    nameReading: 'xiǎo yǔ',
    ageBand: '4-6' as const,
    interestTags: ['恐龙', '云'],
    lookTags: [],
    theme: '勇气',
    form: 'solo' as const,
    pages,
  }),
  jsonSchema: planJsonSchema(),
  temperature: 0.8,
  maxTokens,
}

console.log(`流式探针 · model=${model} pages=${pages} runs=${runs} maxTokens=${maxTokens}`)
console.log('（密钥只进内存，不打印）\n')

type Row = {
  run: number
  ttftMs: number
  maxGapMs: number
  totalMs: number
  chars: number
  chunks: number
  pagesByExtractor: number
  usage: string
}

const rows: Row[] = []
for (let run = 1; run <= runs; run += 1) {
  const started = Date.now()
  let first: number | null = null
  let last: number | null = null
  let maxGap = 0
  let chars = 0
  let chunks = 0
  const gaps: number[] = []

  const response = await text.stream(request, {}, (delta) => {
    const now = Date.now()
    chunks += 1
    chars += delta.text.length
    if (first === null) first = now
    else if (last !== null) {
      const gap = now - last
      gaps.push(gap)
      if (gap > maxGap) maxGap = gap
    }
    last = now
  })
  const totalMs = Date.now() - started
  const progress = readPlanProgress(response.text)

  rows.push({
    run,
    ttftMs: (first ?? started) - started,
    maxGapMs: maxGap,
    totalMs,
    chars,
    chunks,
    pagesByExtractor: progress.pages,
    usage: response.usage ? JSON.stringify(response.usage) : '（回包里没有 usage）',
  })

  console.log(
    `第 ${run} 次：TTFT ${((first ?? started) - started) / 1000}s · ` +
      `最大间隔 ${maxGap / 1000}s · 总 ${(totalMs / 1000).toFixed(1)}s · ` +
      `${chunks} 段 / ${chars} 字 · 抽取器认出 ${progress.pages} 页`,
  )
  console.log(
    `  拼接后的正文长度 ${response.text.length}（与累计字符 ${chars} ${
      response.text.length === chars ? '一致' : '**不一致**'
    }）`,
  )
  console.log(`  标题抽取：${progress.title ?? '（没抽到）'}`)
  console.log(`  已闭合正文句数：${progress.lines.length}`)
  console.log(`  usage：${rows[rows.length - 1]?.usage ?? ''}`)
  if (gaps.length > 0) {
    const sorted = [...gaps].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0
    console.log(`  间隔分布：p50 ${p50}ms · 最大 ${maxGap}ms · 共 ${gaps.length} 个间隔`)
  }
  console.log('')
}

const worstTtft = Math.max(...rows.map((r) => r.ttftMs))
const worstGap = Math.max(...rows.map((r) => r.maxGapMs))
console.log('小结（拿这些数去定 DEFAULT_SSE_IDLE_TIMEOUT_MS）：')
console.log(`  最大的"从开始到第一个字"：${(worstTtft / 1000).toFixed(1)}s`)
console.log(`  最大的"两个字之间"：${(worstGap / 1000).toFixed(1)}s`)
console.log(`  空闲超时的下界至少要 > ${(Math.max(worstTtft, worstGap) / 1000).toFixed(0)}s`)
