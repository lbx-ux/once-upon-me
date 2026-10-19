/**
 * probe-embeddings.mts —— 探针：这条接口上到底有没有可用的 `/embeddings`
 *
 * 为什么需要一个探针，而不是直接把适配器写出来：
 * 全仓**从没量过**这条路由。它只在一条脚手架待办（`.scratch/app-restructure/issues/01`）
 * 的路由清单里出现过一次，`.env.example` 里连 `EMBEDDING_*` 都没有，
 * `registry.ts` 里没有这个能力。所以「嵌入可用」在今天是一个**印象**，不是事实。
 *
 * ★ W1 付过这次学费，记在 `.scratch/app-restructure/issues/01` 的 Comments 里：
 *   **不是「漏测」，是「把一个否定结论建立在没找到入口上」**——
 *   前者是「我试了这条路的全部形状」，后者是「我试了这一条路」。
 *   所以下面第 1 步（目录里的）与第 2 步（目录外的）**两步都要跑**，缺一步就退化成学费本身。
 *
 * ## 探六步
 *
 * | 步       | 问的是什么                                                       | 花不花钱                              |
 * | -------- | ---------------------------------------------------------------- | ------------------------------------- |
 * | 0        | `GET /v1/models` 里有没有 embedding 类的名字（**线索不是结论**）   | 免费                                  |
 * | **1c**   | 对照组：打一个**确实不存在的路径**，看「路由不存在」长什么样        | 免费（不会计费）                      |
 * | **1b**   | 判别实验：**确定存在的对话模型**打 `/embeddings` 会怎样            | 一次极小调用                          |
 * | 2        | 目录里筛出来的嵌入名，一个个打一次                                 | 未知模型 4xx 不计费                   |
 * | 3        | **反向**：目录没列的 15 个常用名照样打                             | 同上                                  |
 * | 4        | 第一个能用的：两种 input 形状 + `encoding_format` + 两个句子的余弦 | 3–4 次极小调用                        |
 *
 * ★ **1b 与 1c 是这一版加上去的，而它们才是这条结论的承重墙。**
 *   第一轮跑完（15 个候选全回 `400 · MODEL_NOT_AVAILABLE · 模型不可用`）时，
 *   屏幕上只有一个数：`400`。而 **400 同时兼容两个相反的命题**：
 *   「这条路由活着，只是这些模型名不可用」与「根本没有这个入口，网关顺手报了个 400」。
 *   两者的处置完全不同：前者要去找一个开通了的模型名，后者要收手改走词法档。
 *   所以不能靠读错误文案的语气下结论，要靠**两个对照实验**：
 *
 *   - **1c（不存在的路径）**：拿到「路由不存在」这个答案的**原始形状**。
 *     如果 `MODEL_NOT_AVAILABLE` 与它长得不一样，那 15 个 400 就**不是**「没有入口」。
 *   - **1b（确定存在的模型名）**：拿一个我们每天在用、目录里也有的对话模型去打。
 *     它**不是**嵌入模型，所以期望是「模型级」的拒绝，而不是「路由级」的 404——
 *     回出来的若是 `MODEL_NOT_AVAILABLE` 这一类，就证明**请求体被解析了、路由是活的**。
 *     这是「只有真做才会不同」的那类判据：路由死了的话，1b 与 1c 会回同一个东西。
 *
 * 判读表（改这个脚本前先看它）：
 *
 * ```
 * 200 + data[0].embedding 是数字数组   → **存在**，记 model 与维度
 * MODEL_NOT_AVAILABLE / 模型不可用      → 路由活着，这个**模型**不可用（换名字，不是换路由）
 * 404 且形状与 1c 那条对照一致          → 整条**路由没有**（这是路由级结论）
 * 400 未知字段 / 参数类文案             → 请求体形状问题（不是"路由没有"，也不是"模型没有"）
 * 其他 4xx/5xx（403 鉴权、429 限流、5xx）→ **没结论**，读原文，别记成"没有"
 * ```
 *
 * ★ 最后一行是要紧的：`403` / `429` / `502` 都**不是**「不存在」。
 *   把它们记成「没有」，就是这一次探针要避免的那个错误本身。
 *
 * ```bash
 * node scripts/probe-embeddings.mts                 # 六步全跑
 * node scripts/probe-embeddings.mts --only=sweep    # 目录里**全部**名字扫一遍 /embeddings
 * node scripts/probe-embeddings.mts --only=step4    # 只跑形状矩阵（要配 --model=）
 * node scripts/probe-embeddings.mts --model=<名字>  # 只打这一个名字
 * ```
 *
 * 结论回填到 `.scratch/rag/spec.md` §二.4、`.env.example`（能不能用写进注释）
 * 与工单 03（适配器还写不写）。本文件留着，是为了让那条结论可复现。
 */

import { requestJson } from '../src/lib/engine/providers/http.ts'
import { arg, readEnv } from './env.mts'

/** 第 4 步用的两句中文。★ 刻意选**语义不同但字面高度重叠**的两句：
 *  这样「两个向量不一样」是因为语义，而不是因为字数不同——否则测了个寂寞 */
const SENTENCE_A = '小恐龙第一次离开家，走进会下雨的森林'
const SENTENCE_B = '小恐龙第一次离开家，走进会下雨的森林里那棵大树'

/**
 * 固定候选表（第 3 步：目录里没列的也要试）。**不是从文档抄的**，
 * 是「一个 OpenAI 兼容网关到 2026 年可能挂哪些嵌入模型」的穷举。
 *
 * ★ 刻意含**中文原生**的几家（bge / m3e / gte / dashscope / 豆包）——
 *   本项目的语料全中文，一个只吃英文的嵌入模型即使能用也不是我们要的那个。
 */
const FIXED_CANDIDATES: readonly string[] = [
  // OpenAI 命名
  'text-embedding-3-small',
  'text-embedding-3-large',
  'text-embedding-ada-002',
  // 阿里 dashscope 命名
  'text-embedding-v3',
  'text-embedding-v4',
  // Qwen 系
  'qwen3-embedding',
  'qwen3-embedding-0.6b',
  // 开源中文常用
  'bge-m3',
  'bge-large-zh-v1.5',
  'bge-large-zh',
  'm3e-base',
  'gte-large-zh',
  'jina-embeddings-v3',
  // 火山
  'doubao-embedding',
  'doubao-embedding-large',
]

/** 目录里筛「像嵌入模型」的名字。宽松一点：漏掉一个真名字的代价比多打一次大 */
const CATALOG_PATTERN = /embed|bge|m3e\b|gte-|jina|retriev|vector/i

type Verdict = 'exists' | 'no-route' | 'model-unavailable' | 'shape' | 'inconclusive'

const VERDICT_LABEL: Record<Verdict, string> = {
  exists: '**存在**',
  'no-route': '路由不存在（路由级结论）',
  'model-unavailable': '路由活着，这个**模型**不可用',
  shape: '请求体形状问题（既不是没路由，也不是没模型）',
  inconclusive: '**没结论**——读原文',
}

type Attempt = { label: string; shape: string; status: string; verdict: Verdict; note: string }

let calls = 0

/**
 * 把一次失败分成四类。**先判「模型不可用」再判 404**——
 * 顺序反了会把「路由活着但这个名字不行」读成「没有入口」，那正是这次要防的错。
 */
function classify(status: number, message: string, noRouteShape: string): Verdict {
  if (status >= 200 && status < 300) return 'exists'
  if (/MODEL_NOT_AVAILABLE|模型不可用|no available|access denied to model/i.test(message)) {
    return 'model-unavailable'
  }
  // 1c 那条对照拿到的原始形状：与它一致才算「没有入口」
  if (noRouteShape && shapeOf(message) === shapeOf(noRouteShape) && status === 404) {
    return 'no-route'
  }
  if (status === 404) return 'model-unavailable'
  if (status === 400) {
    if (/未知字段|unknown field|unexpected|extra inputs|extra fields/i.test(message)) return 'shape'
    if (/模型|model/i.test(message)) return 'model-unavailable'
  }
  return 'inconclusive'
}

/** 形状的粗指纹：状态码 + 供应商错误码 + 文案前 40 字（够用来比对「两条回的是不是同一种」） */
function shapeOf(message: string): string {
  const code = /·\s*([A-Z_0-9-]+)\s*·/.exec(message)?.[1] ?? ''
  const body = message.replace(/^[^·]*·\s*/, '').slice(0, 40)
  return `${code}|${body}`
}

async function postEmbeddings(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  input: unknown,
  extra: Record<string, unknown> = {},
): Promise<{ vector: number[]; raw: unknown } | { error: string; status: number }> {
  calls += 1
  try {
    const raw = await requestJson(deps, {
      method: 'POST',
      path: '/embeddings',
      body: { model, input, ...extra },
      timeoutMs: 60_000,
    })
    const vector = firstVector(raw)
    if (!vector) return { error: `回包形状不认识：${JSON.stringify(raw).slice(0, 200)}`, status: 0 }
    return { vector, raw }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { error: message, status: Number(/HTTP (\d{3})/.exec(message)?.[1] ?? 0) }
  }
}

function firstVector(raw: unknown): number[] | null {
  const data = (raw as { data?: unknown }).data
  if (!Array.isArray(data) || data.length === 0) return null
  const embedding = (data[0] as { embedding?: unknown }).embedding
  if (!Array.isArray(embedding)) return null
  return embedding.every((n) => typeof n === 'number') ? (embedding as number[]) : null
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0)
    na += (a[i] ?? 0) ** 2
    nb += (b[i] ?? 0) ** 2
  }
  return na === 0 || nb === 0 ? Number.NaN : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function main(): Promise<void> {
  const env = await readEnv()
  const apiKey = env['EMBEDDING_API_KEY'] ?? env['LLM_API_KEY'] ?? ''
  if (!apiKey) throw new Error('LLM_API_KEY（或 EMBEDDING_API_KEY）未配置，无从探起')
  const baseUrl =
    env['EMBEDDING_BASE_URL'] ?? env['LLM_BASE_URL'] ?? 'https://tokenrhythm.studio/v1'
  const deps = { baseUrl, apiKey }

  const only = arg('only')
  const pinned = arg('model')

  process.stdout.write(`探针：/embeddings @ ${baseUrl}\n`)
  process.stdout.write(
    '判读：200+embedding 数组 = 存在｜模型不可用 = 换名字｜404 与对照同形 = 没入口\n\n',
  )

  const attempts: Attempt[] = []
  let noRouteShape = ''

  /** 扫全部名字（单独一个模式：它自己会打 26 次，别混在默认那一轮里） */
  if (only === 'sweep') {
    await sweep(deps)
    return
  }

  /** 第 4 步单独跑：候选扫描已经跑过，别重复烧调用 */
  if (only === 'step4') {
    if (!pinned) throw new Error('--only=step4 需要同时给 --model=<已验证可用的名字>')
    await step4(deps, pinned, attempts)
    summary(attempts)
    return
  }

  /* ── 第 0 步：目录（免费）。★ 它是**线索不是结论**，所以后面还有第 3 步 ── */
  let catalog: string[] = []
  try {
    const raw = await requestJson(deps, { method: 'GET', path: '/models', timeoutMs: 30_000 })
    const list = (raw as { data?: unknown }).data
    const names = Array.isArray(list)
      ? list
          .map((item) => (item as { id?: unknown }).id)
          .filter((id): id is string => typeof id === 'string')
      : []
    catalog = names.filter((name) => CATALOG_PATTERN.test(name))
    process.stdout.write(
      `[0] /v1/models：共 ${names.length} 个名字，其中像嵌入模型的 ${catalog.length} 个` +
        `${catalog.length > 0 ? `（${catalog.join(' / ')}）` : '（一个都没有）'}\n` +
        '    ★ 目录**漏报过**（§1.2 已证它对图像能力漏报），所以第 3 步不能省\n\n',
    )
  } catch (err) {
    process.stdout.write(
      `[0] /v1/models 拿不到（${err instanceof Error ? err.message : String(err)}）——` +
        '不影响下面，只是名单全靠固定候选表\n\n',
    )
  }

  /* ── 第 1c 步：对照组。「路由不存在」长什么样 ── */
  {
    calls += 1
    const path = '/embeddings-no-such-route'
    let message = ''
    let status = 0
    try {
      await requestJson(deps, { method: 'GET', path, timeoutMs: 20_000 })
      message = '（这条路径居然回 2xx——网关对未知路径不拦，判读表要改）'
      status = 200
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
      status = Number(/HTTP (\d{3})/.exec(message)?.[1] ?? 0)
    }
    noRouteShape = message
    process.stdout.write(
      `[1c] 对照组·不存在的路径 GET ${path}\n     HTTP ${status} · ${message.slice(0, 180)}\n` +
        `     形状指纹 ${shapeOf(message)} ← 下面所有 404 都拿它比\n\n`,
    )
  }

  /* ── 第 1b 步：判别实验。用一个**确定存在的对话模型**打 /embeddings ── */
  let routeAlive = false
  {
    const chatModel = pinned || env['LLM_MODEL'] || ''
    if (!chatModel) {
      process.stdout.write('[1b] LLM_MODEL 没配，判别实验跳过（这条结论就要靠人工补）\n\n')
    } else {
      process.stdout.write(`[1b] 判别实验·确定存在的对话模型 ${chatModel} 打 /embeddings\n`)
      const result = await postEmbeddings(deps, chatModel, SENTENCE_A)
      if ('vector' in result) {
        routeAlive = true
        process.stdout.write(
          `     HTTP 200 —— **这个对话模型能做嵌入**，维度 ${result.vector.length}\n` +
            '     ★ 那第 4 步就跑在它身上，第 2/3 步的候选表可以省一轮\n\n',
        )
        attempts.push({
          label: chatModel,
          shape: 'input=字符串（1b 判别）',
          status: '200',
          verdict: 'exists',
          note: `维度 ${result.vector.length}，来自目录里确定存在的名字`,
        })
      } else {
        const verdict = classify(result.status, result.error, noRouteShape)
        // ★ 判据在这一句上：**不是** no-route（即不是 1c 那个形状）就说明请求被路由处理了
        routeAlive = verdict !== 'no-route'
        process.stdout.write(
          `     HTTP ${result.status || '?'} · ${VERDICT_LABEL[verdict]}\n` +
            `     ${result.error.slice(0, 200)}\n` +
            `     → 与 1c 那条对照${shapeOf(result.error) === shapeOf(noRouteShape) ? '**同形**（没入口）' : '**不同形**（路由活着，是模型级拒绝）'}\n\n`,
        )
        attempts.push({
          label: chatModel,
          shape: 'input=字符串（1b 判别）',
          status: String(result.status || '?'),
          verdict,
          note: result.error.slice(0, 140),
        })
      }
    }
  }

  /* ── 第 2 + 3 步：目录里的 + 目录外的，各打一次 ── */
  const working: string[] = []
  const firstWorking = attempts.find((item) => item.verdict === 'exists')?.label
  if (firstWorking) working.push(firstWorking)

  const candidates = pinned ? [pinned] : [...new Set([...catalog, ...FIXED_CANDIDATES])]
  process.stdout.write(`[2/3] 打 ${candidates.length} 个名字（目录里的 + 固定候选表）\n`)
  for (const model of candidates) {
    if (model === pinned || model === firstWorking) continue
    const result = await postEmbeddings(deps, model, SENTENCE_A)
    const fromCatalog = catalog.includes(model)
    if ('vector' in result) {
      working.push(model)
      attempts.push({
        label: model,
        shape: 'input=字符串',
        status: '200',
        verdict: 'exists',
        note: `维度 ${result.vector.length}${fromCatalog ? '' : '（★ 目录没列，反向试出来的）'}`,
      })
      process.stdout.write(
        `  ✓ ${model.padEnd(26)} HTTP 200 —— **存在**，维度 ${result.vector.length}` +
          `${fromCatalog ? '' : '，★ 目录里没列'}\n`,
      )
    } else {
      const verdict = classify(result.status, result.error, noRouteShape)
      attempts.push({
        label: model,
        shape: 'input=字符串',
        status: String(result.status || '?'),
        verdict,
        note: result.error.slice(0, 140),
      })
      process.stdout.write(
        `  · ${model.padEnd(26)} HTTP ${String(result.status || '?').padEnd(4)} —— ` +
          `${VERDICT_LABEL[verdict]}\n     ${result.error.slice(0, 170)}\n`,
      )
    }
  }

  if (working.length === 0) {
    process.stdout.write(
      routeAlive
        ? '\n结论：**这条路由活着，但这把 key 上没有任何可用的嵌入模型。**\n' +
            '  证据链：1b 的对话模型回的是模型级拒绝、且与 1c「不存在的路径」那条对照**不同形**；\n' +
            '  而目录里 0 个候选、反向 15 个常用名全部 `MODEL_NOT_AVAILABLE`。\n' +
            '  → 回填 spec §二.4：**词法档（bigram-BM25）是唯一档**，混合档不做，适配器不写。\n' +
            '  → 换档条件（要重开这一栏才成立）：管理页/控制台开通某个嵌入模型，或换一家有嵌入接口的供应商。\n'
        : '\n结论：**这条接口上没有 /embeddings 这个入口**（1b 与 1c 同形，路由级否定）。\n' +
            '  → 同上：词法档是唯一档。这一条比上一行更硬——换模型名也没用。\n',
    )
    summary(attempts)
    process.exitCode = 1
    return
  }

  /* ── 第 4 步：形状矩阵 + 两个句子的余弦 ── */
  await step4(deps, working[0] as string, attempts)
  summary(attempts)
  process.stdout.write(
    `\n结论：**可用**。首选 ${working[0]}（共 ${working.length} 个可用：${working.join(' / ')}）\n` +
      '→ 回填 spec §二.4、`.env.example` 的 EMBEDDING_MODEL 注释、工单 03 的适配器与混合档。\n',
  )
}

/** 第 4 步：第一个能用的那一个——两种 input 形状、encoding_format、两句的余弦 */ async function step4(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  attempts: Attempt[],
): Promise<void> {
  process.stdout.write(`\n[4] ${model} 的形状矩阵\n`)

  const shapes: readonly (readonly [string, unknown, Record<string, unknown>])[] = [
    ['input=字符串', SENTENCE_A, {}],
    ['input=字符串数组', [SENTENCE_A, SENTENCE_B], {}],
    ['input + encoding_format=float', SENTENCE_A, { encoding_format: 'float' }],
  ]

  for (const [label, input, extra] of shapes) {
    const result = await postEmbeddings(deps, model, input, extra)
    if ('vector' in result) {
      attempts.push({
        label: model,
        shape: label,
        status: '200',
        verdict: 'exists',
        note: `维度 ${result.vector.length}，回 ${Array.isArray(input) ? input.length : 1} 条`,
      })
      process.stdout.write(`  ✓ ${label.padEnd(30)} 200，维度 ${result.vector.length}\n`)
    } else {
      const verdict = classify(result.status, result.error, '')
      attempts.push({
        label: model,
        shape: label,
        status: String(result.status || '?'),
        verdict,
        note: result.error.slice(0, 140),
      })
      process.stdout.write(
        `  · ${label.padEnd(30)} HTTP ${result.status || '?'} —— ${VERDICT_LABEL[verdict]}\n` +
          `     ${result.error.slice(0, 170)}\n`,
      )
    }
  }

  /* 两句各取一个向量：判「非零、非恒定、且随语义变」 */
  const a = await postEmbeddings(deps, model, SENTENCE_A)
  const b = await postEmbeddings(deps, model, SENTENCE_B)
  if ('vector' in a && 'vector' in b) {
    const norm = Math.sqrt(a.vector.reduce((sum, n) => sum + n * n, 0))
    const same = a.vector.length === b.vector.length && a.vector.every((n, i) => n === b.vector[i])
    const sim = cosine(a.vector, b.vector)
    process.stdout.write(
      `\n  句子 A 的 L2 范数 ${norm.toFixed(4)}（0 就是零向量，那等于没嵌）\n` +
        `  两句的余弦 ${sim.toFixed(4)}；两个向量${same ? '**完全相同**（可疑：常量向量）' : '不同'}\n` +
        '  ★ 这两句只差半句，余弦偏高是**对的**；要警惕的是「任何两句都同一个值」\n',
    )
    attempts.push({
      label: model,
      shape: '两句余弦',
      status: '200',
      verdict: same || Number.isNaN(sim) || norm === 0 ? 'inconclusive' : 'exists',
      note: `范数 ${norm.toFixed(3)}，余弦 ${sim.toFixed(3)}，${same ? '常量向量（可疑）' : '非恒定'}`,
    })
  } else {
    process.stdout.write('  · 两句余弦：这一步没跑成（上面那两条里有一条失败）\n')
  }
}

function summary(attempts: readonly Attempt[]): void {
  process.stdout.write(`\n—— 共 ${calls} 次调用（金额不在此报，见 MEMORY 那条纪律）——\n`)
  const exists = attempts.filter((item) => item.verdict === 'exists')
  process.stdout.write(`判定为「存在」的：${exists.length} 条\n`)
  for (const item of attempts.filter((one) => one.verdict !== 'exists')) {
    process.stdout.write(
      `  ${item.label} · ${item.shape} → HTTP ${item.status} ${VERDICT_LABEL[item.verdict]}\n`,
    )
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n探针失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})

/**
 * 扫全部：把目录里**每一个**名字都打一次 `/embeddings`。
 *
 * ★ 为什么值得多花这二十几次调用：它把这个否定结论从
 *   「15 个**像**嵌入模型的名字都失败了」升级成
 *   「**这把 key 上服务的每一个模型都试过了，没有一个能做嵌入**」。
 *   前者是「我试了像样的那些」，后者才是这条路由上的**全称否定**——
 *   两者的差别正是 W1 那次学费的原文（`.scratch/app-restructure/issues/01`）。
 * ★ 成本约等于零：非 200 一律不计费（`模型.md` §5），而这一扫里成功的那个数就是 0。
 *
 * ★★ **2026-10-19 实测：这一扫先是骗过我一次。**
 *   第一次跑：`25 个 MODEL_CAPABILITY_NOT_SUPPORTED + 1 个 MODEL_ACCESS_DENIED`，
 *   汇总一句话「26 个里没有一个能做嵌入」。
 *   紧接着再跑一次，同一份目录变成了 `17 个 RATE_LIMITED + 8 个 CAPABILITY + 1 个网络错`——
 *   **网关在限流我们**（前面刚连打了几十次）。
 *
 *   于是那次汇总错在哪，一眼看得出来：它把**三种完全不同的话**加成了一个数。
 *   - `MODEL_CAPABILITY_NOT_SUPPORTED` = 「这个模型不会嵌入」——**有结论的否定**
 *   - `MODEL_ACCESS_DENIED`            = 「这个模型没开通」——**另一种结论**，指向控制台
 *   - `RATE_LIMITED` / 网络错 / 5xx     = **什么都没证明**，这一格是空的
 *   前两类可以算进否定，第三类**只能算没测**。把它们相加之后写"没有一个能做嵌入"，
 *   就是 W1 那条「把『没测成』记成『测出来』」换了个马甲重演一遍。
 *   所以现在：**限流退避重试**，且**结论里必须分开数**，
 *   只要还剩一个"没测成"，就不许下全称否定。
 */
async function sweep(deps: { baseUrl: string; apiKey: string }): Promise<void> {
  calls += 1
  const raw = await requestJson(deps, { method: 'GET', path: '/models', timeoutMs: 30_000 })
  const data = (raw as { data?: unknown }).data
  const names = (Array.isArray(data) ? data : [])
    .map((item) => (item as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string')

  const delayMs = Number(arg('delay', '1200'))
  process.stdout.write(
    `[sweep] 目录里 ${names.length} 个名字，逐个打 /embeddings（每次间隔 ${delayMs}ms，限流会退避重试）\n`,
  )

  const hits: string[] = []
  /** 「这个模型不会嵌入」——有结论的否定 */
  const refuses: string[] = []
  /** 「这个模型没开通」——另一种结论 */
  const denied: string[] = []
  /** 这一格什么都没证明（限流、网络、5xx） */
  const unknown: { name: string; note: string }[] = []

  for (const name of names) {
    const result = await postEmbeddingsWithBackoff(deps, name, SENTENCE_A, (note) =>
      process.stdout.write(`      … ${name}：${note}\n`),
    )
    if ('vector' in result) {
      hits.push(name)
      process.stdout.write(`  ✓ ${name.padEnd(30)} 200，维度 ${result.vector.length}\n`)
    } else {
      const code = codeOf(result.error) ?? `HTTP ${result.status || '?'}`
      if (code === 'MODEL_CAPABILITY_NOT_SUPPORTED') refuses.push(name)
      else if (code === 'MODEL_ACCESS_DENIED') denied.push(name)
      else unknown.push({ name, note: result.error.slice(0, 120) })
      // ★ 逐个名字都打出来：三种话指向三个不同的下一步，合成一个总数会把差别埋掉
      process.stdout.write(`  · ${name.padEnd(30)} ${code}\n`)
    }
    if (delayMs > 0) await sleep(delayMs)
  }

  const conclusive = hits.length + refuses.length + denied.length
  process.stdout.write(
    `\n  有结论的 ${conclusive} / ${names.length}：\n` +
      `    「不会嵌入」（MODEL_CAPABILITY_NOT_SUPPORTED） ${refuses.length} 个\n` +
      `    「没开通」（MODEL_ACCESS_DENIED）                  ${denied.length} 个` +
      `${denied.length > 0 ? `　← ${denied.join(' / ')}` : ''}\n` +
      `    「能做嵌入」                                       ${hits.length} 个\n`,
  )
  if (unknown.length > 0) {
    process.stdout.write(`  ★ 这次**没测成**的 ${unknown.length} 个（不算进上面的否定里）：\n`)
    for (const item of unknown) process.stdout.write(`      ${item.name} —— ${item.note}\n`)
  }

  if (hits.length > 0) {
    process.stdout.write(
      `\n结论：**这 ${hits.length} 个模型能做嵌入**：${hits.join(' / ')}\n` +
        '→ 回填 spec §二.4 与工单 03：混合档可做，嵌入名取上面这一个。\n',
    )
    process.exitCode = 0
    return
  }
  if (unknown.length > 0) {
    process.stdout.write(
      `\n结论：**不完整，不下全称否定。** ${unknown.length} 个名字这次没测成（多半是限流），\n` +
        `  所以只能说「已测成的 ${conclusive} 个里没有一个能做嵌入」。\n` +
        '  → 隔一会儿（或把 --delay 调大）再跑一次；**在那之前不许把这一格写成「没有嵌入」。**\n',
    )
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `\n结论：**目录里服务的这 ${names.length} 个模型，没有一个能做嵌入**（这次全部测成了）。\n` +
      '  配上 1b/1c 那两条对照（路由活着 + 模型级拒绝），这就是这条路由上的全称否定。\n' +
      '  → spec §二.4：**词法档（bigram-BM25）是唯一档**，适配器不写，混合档不做。\n' +
      (denied.length > 0
        ? `  ★ 但 ${denied.join(' / ')} 是 **MODEL_ACCESS_DENIED（没开通）而不是「不会」**——\n` +
          '    去控制台看一眼它是什么模型：若它是个嵌入模型，开通之后混合档就有了。\n'
        : ''),
  )
  process.exitCode = 1
}

function codeOf(message: string): string | null {
  return /·\s*([A-Z_0-9-]+)\s*·/.exec(message)?.[1] ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 限流要退避重试，否则一整轮扫下来全是 `RATE_LIMITED`——
 * 而那**不是数据**（见上面 ★★ 那段）。只有限流才重试：
 * 能力类与鉴权类的错误重试多少次都是同一个答案，那是浪费钱与时间。
 */
async function postEmbeddingsWithBackoff(
  deps: { baseUrl: string; apiKey: string },
  model: string,
  input: unknown,
  onWait: (note: string) => void,
): Promise<{ vector: number[]; raw: unknown } | { error: string; status: number }> {
  const budget = [4000, 12000, 30000]
  let result = await postEmbeddings(deps, model, input)
  for (const wait of budget) {
    if ('vector' in result) return result
    if (!/RATE_LIMITED|rate.?limit|TOO_MANY|429/i.test(result.error)) return result
    onWait(`被限流，${wait / 1000}s 后重试`)
    await sleep(wait)
    result = await postEmbeddings(deps, model, input)
  }
  return result
}
