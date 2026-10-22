/**
 * probe-image-concurrency.mts —— 3 路同发，这家会不会把限流顶出来（2026-10-21，工单 D-03）
 *
 * ```bash
 * node scripts/probe-image-concurrency.mts                  # 3 路 × 2 回合 = 6 张
 * node scripts/probe-image-concurrency.mts --concurrent=6 --rounds=1
 * ```
 *
 * ── 它回答的是 D-03 里那句"代价"，不是判据 ──────────────────────────────────
 *
 * 工单原文：「并发会把供应商侧限流顶出来，要带退避重试」。后半句已经写进代码了
 * （`qwen-image.ts` 的 `IMAGE_ATTEMPTS`，只重 429）；前半句在那之前**没量过**——
 * 而"会不会被限流"决定了那条退避是消防演习还是每天都要走的流程。
 * ★ 2026-10-21 换到 qwen-image-3.0 之后这一问**重新变成未知**：上一家那次跑的是上一家，
 *   并发上限与限流策略是供应商属性，不能搬过来。
 *
 * ── 量法：把 HTTP 状态码数出来，而不是只看成没成 ────────────────────────────
 *
 * 适配器自己会重试 429，所以"拿到图"这件事**掩盖**了限流：成功的调用可能有 1 次 429
 * 藏在里面。所以这一支包了一层 `fetch`，把每一次响应的状态码照原样记下来
 * （`deps.fetchImpl`），报的是**状态码直方图**。只看成败的话，429 有没有发生这件事
 * 会被重试抹平——那正是"探针要送真值"那条纪律说的形状。
 *
 * ── 判读（改这个脚本之前先看这一段）────────────────────────────────────────
 *
 * | 观测 | 结论 |
 * | --- | --- |
 * | 3 路、两个回合、0 个 429 | 这一档没顶到墙上；**不代表 6 路也不会**（那是另一问） |
 * | 出现 429 但图都拿到了 | 退避在干活：它是**流程**不是演习 |
 * | 429 用满 4 次仍失败 | 上限 3 太高，要降（或把退避拉长）——这一支会当场判"不过" |
 * | 出现 402/403 | 与并发无关（余额、灰度），别读成限流 |
 *
 * ★ 这一支**要花钱**（`--concurrent` × `--rounds` 张图；单价按厂商计费，本仓不记），产物字节直接丢掉：
 *   它量的是"这家在几个并发下肯不肯受理"，不是"这张图好不好看"。
 */

import { createQwenImage } from '../src/lib/engine/providers/qwen-image.ts'
import { DEFAULT_IMAGE_SIZE } from '../src/lib/prompts/image.ts'
import { arg, readEnv } from './env.mts'

const CONCURRENT = Number(arg('concurrent', '3'))
const ROUNDS = Number(arg('rounds', '2'))
// 缺省用产品页图那个尺寸（3:2）：探针要送真值，别送一个产品根本不会要的方图
const SIZE = arg('size', DEFAULT_IMAGE_SIZE)

/** 每一路给不同的画面，免得"同一份请求"这件事把限流与否混在一起 */
const SCENES = [
  '一个小孩蹲在草地上看一只瓢虫',
  '一个小孩站在窗前看外面的雨',
  '一只小狗在雪地里跑',
  '一个小孩坐在树下翻一本书',
  '一只小猫趴在窗台上晒太阳',
  '一个小孩举着一只纸飞机',
]

type Seen = { status: number; url: string }

async function main(): Promise<void> {
  const env = await readEnv()
  const apiKey = env['IMAGE_API_KEY'] ?? ''
  if (!apiKey) throw new Error('IMAGE_API_KEY 未配置（这一支要真发请求）')
  const baseUrl = env['IMAGE_BASE_URL'] ?? ''
  if (!baseUrl) throw new Error('IMAGE_BASE_URL 未配置')
  const model = arg('model', env['IMAGE_MODEL'] ?? '')
  if (!model) throw new Error('IMAGE_MODEL 未配置（或 --model=<名字>）')

  const seen: Seen[] = []
  /** ★ 只记状态码，不改任何行为：字节、头部、错误都原样透传 */
  const loggingFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    seen.push({ status: response.status, url: String(input) })
    return response
  }

  const image = createQwenImage({ baseUrl, apiKey, fetchImpl: loggingFetch }, model)

  process.stdout.write(
    `并发探针：每回合 ${CONCURRENT} 路同发 · ${ROUNDS} 回合 · 模型 ${model} · 尺寸 ${SIZE}\n` +
      `（这一支要花 ${CONCURRENT * ROUNDS} 张图的钱；跑的是适配器本体，含 429 退避）\n\n`,
  )

  for (let round = 1; round <= ROUNDS; round += 1) {
    const before = seen.length
    const started = Date.now()
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, async (_, index) => {
        const scene = SCENES[index % SCENES.length] as string
        const at = Date.now()
        try {
          const response = await image.generate({ prompt: scene, size: SIZE })
          return { ok: true, ms: Date.now() - at, bytes: response.bytes.length, code: '' }
        } catch (err) {
          return {
            ok: false,
            ms: Date.now() - at,
            bytes: 0,
            code: (err as { code?: string }).code ?? String(err),
          }
        }
      }),
    )
    const thisRound = seen.slice(before)
    const codes = new Map<number, number>()
    for (const item of thisRound) codes.set(item.status, (codes.get(item.status) ?? 0) + 1)

    process.stdout.write(
      `第 ${round} 回合 — 一起发出去到最后一个回来 ${((Date.now() - started) / 1000).toFixed(1)}s\n` +
        `  每一路：${results
          .map((item) =>
            item.ok
              ? `${(item.ms / 1000).toFixed(1)}s/${(item.bytes / 1024).toFixed(0)}KB`
              : `✗ ${item.code}`,
          )
          .join(' · ')}\n` +
        `  HTTP 状态码（含适配器自己重试的那些）：${[...codes.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([status, count]) => `${status}×${count}`)
          .join(' · ')}\n`,
    )
  }

  const all = new Map<number, number>()
  for (const item of seen) all.set(item.status, (all.get(item.status) ?? 0) + 1)
  const rateLimited = all.get(429) ?? 0
  const total = seen.length
  process.stdout.write(
    `\n全部 HTTP 调用 ${total} 次：${[...all.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([status, count]) => `${status}×${count}`)
      .join(' · ')}\n` +
      (rateLimited === 0
        ? `★ 这一档（${CONCURRENT} 路）在两个回合里一次 429 都没有。结论的边界就在这里：\n` +
          `  它说的是"这一档没顶到墙上"，不是"这家不限流"——更高的并发是另一个问题。\n`
        : `★ 出现 ${rateLimited} 次 429：并发确实把限流顶出来了，退避不是演习。\n`),
  )
}

await main()
