/**
 * probe-vision-budget.mts —— 诊断：读照片那条路为什么"想完了没写"，以及它到底要多少预算
 *
 * 起因是一句用户原话（2026-10-16）：「这个修复一下，我试了好几次，都出现这个问题了」——
 * 截图里那句原文是：
 *
 * ```
 * 模型这次没按格式把照片读出来。已经替你试过两次了。……
 * （供我们排障的原文：读照片的模型没有按 JSON 回答（试了 2 次；finish_reason=length ·
 *    正文 0 字 · 思考链 961 字）。它思考的末尾：帽、浅蓝牛仔外套、白色小图案。…）
 * ```
 *
 * 三个数一起看，结论只有一条：**预算不够**，不是"这家不会出 JSON"。
 * `VISION_MODEL=kimi-k2.6` 是推理模型，思考链本身就要几千 token，
 * 而适配器里硬编码的预算是 700——两次都截断，所以"试了好几次都这样"是必然的。
 * 同一个坑文本那条路 2026-10-13 已经踩过（`probe-thinking-budget.mts`），视觉这条路漏了。
 *
 * 探四件事：
 *
 * | 步骤 | 问的是什么 | 花不花钱 |
 * |---|---|---|
 * | 0 | `/v1/models` 里有没有**非推理**的多模态变体（这是"换模型"那条处置的判据） | 免费 |
 * | 1 | 现行预算 700 是不是真的必然截断（复现用户那一次） | 每个预算一次 |
 * | 2 | 同一张照片，预算提到多少才写得完正文 | 每个预算一次 |
 * | 3 | 这个接口认不认关思考的参数（`enable_thinking` / `thinking`） | 每个参数一次（不认就是 400，不计费） |
 * | 4 | ★ 半身照：照片答不了的那一格（头身比）到底空没空出来 | 随 1/2 一起看 |
 *
 * ★ 步骤 1/2 走**生产同一个工厂**（`createOpenAiVision`）而不是自己拼请求体：
 *   项目纪律是"跑测的配置必须就是要上线的那个配置"。自己 `fetch` 一份请求体，
 *   测的就是"探针以为的配置"。唯一的例外是下面 `singleCall` 那一段（见它的注释）。
 *
 * ```bash
 * node scripts/probe-vision-budget.mts --budgets=700,4096 \
 *   --photo=.out/web/cards/xiaoman-r1/ref.f324801f9e05.jpg
 * ```
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import { arg, readEnv } from './env.mts'
import {
  anchorsObjectOf,
  createOpenAiVision,
  ANALYZE_SYSTEM,
  readReply,
  parseLooseJson,
} from '../src/lib/engine/providers/openai-vision.ts'
import { requestJson, toDataUrl } from '../src/lib/engine/providers/http.ts'
import { ANCHOR_LABELS, READ_SLOTS } from '../src/lib/engine/domain.ts'

const env = await readEnv()
const baseUrl = env['VISION_BASE_URL'] || env['LLM_BASE_URL'] || 'https://tokenrhythm.studio/v1'
const apiKey = env['VISION_API_KEY'] || env['LLM_API_KEY'] || ''
const model = env['VISION_MODEL'] || ''
if (!apiKey || !model) {
  console.error('需要 VISION_API_KEY（或 LLM_API_KEY）与 VISION_MODEL')
  process.exit(1)
}

const budgets = arg('budgets', '700,4096')
  .split(',')
  .map((item) => Number(item.trim()))
  .filter((value) => Number.isFinite(value) && value > 0)
const photoPath = arg('photo', '.out/web/cards/xiaoman-r1/ref.f324801f9e05.jpg')
const extraArgs = arg('extra', '') // `enable_thinking:false` 这种，逗号分隔
/** `--dump=1`：把模型的**正文全文**打出来。判"它到底回了什么形状"时必需 */
const dump = arg('dump', '') !== ''

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

const bytes = new Uint8Array(await readFile(photoPath))
const photoDataUrl = toDataUrl(bytes, MIME[extname(photoPath).toLowerCase()] ?? 'image/jpeg')
console.log(
  `照片 ${photoPath}（${bytes.length} 字节）· 模型 ${model} · 预算 ${budgets.join(' / ')}`,
)
console.log(`★ 报告里不出现金额（用户口径：额度管够，但数字不往上写）`)

/** 从 `enable_thinking:false` 这样的写法解析成对象。不认的字段由接口自己去拒（400） */
function extraOf(raw: string): Record<string, unknown> | undefined {
  if (raw.trim() === '') return undefined
  const out: Record<string, unknown> = {}
  for (const piece of raw.split(',')) {
    const [key, value] = piece.split(':')
    if (!key || value === undefined) continue
    out[key.trim()] =
      value.trim() === 'true' ? true : value.trim() === 'false' ? false : value.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/* ── 步骤 0：有哪些多模态模型（免费） ─────────────────────────────────────── */

console.log(
  '\n──── 步骤 0：/v1/models 里与视觉有关的那些（免费，用来判断"换模型"这条处置走不走得通） ────',
)
try {
  const body = (await requestJson(
    { baseUrl, apiKey, timeoutMs: 30_000 },
    { method: 'GET', path: '/models' },
  )) as { data?: { id?: string }[] }
  const ids = (body.data ?? []).map((item) => String(item.id ?? '')).filter((id) => id !== '')
  console.log(`一共 ${ids.length} 个模型：`)
  console.log(`  ${ids.join('、')}`)
} catch (err) {
  console.log(`拿不到模型清单（不影响下面）：${String(err)}`)
}

/**
 * 单发一次（**不走适配器的两次重试**），专门回答"预算多少才够"。
 *
 * ★ 为什么这一段自己拼请求体：适配器那条路自带"截断就把预算翻 4 倍重试"，
 *   跑一遍看到的是两次的合成结果，而这里要的是**一次**的读数（思考链多长、截断在哪）。
 * ★ system 用的是**导出的那一份**（`ANALYZE_SYSTEM`），user 段是精简版
 *   （槽位表 + 那张图）。预算问的是"这张图要让模型想多久"，与 user 段的措辞无关——
 *   这一点与"探针要跑生产配置"那条纪律不冲突：跑的是同一份提示词主体与同一个模型。
 */
async function singleCall(maxTokens: number, extra?: Record<string, unknown>): Promise<void> {
  const slots = READ_SLOTS.map((slot) => `${ANCHOR_LABELS[slot]}（${slot}）`).join('、')
  const body = await requestJson(
    { baseUrl, apiKey, timeoutMs: 300_000 },
    {
      method: 'POST',
      path: '/chat/completions',
      body: {
        model,
        messages: [
          { role: 'system', content: ANALYZE_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: `要读的槽位：${slots}` },
              { type: 'image_url', image_url: { url: photoDataUrl } },
              { type: 'text', text: '上面是孩子的照片。按槽位逐条描述后只输出 JSON。' },
            ],
          },
        ],
        temperature: 0,
        max_tokens: maxTokens,
        ...(extra ?? {}),
      },
    },
  )
  const reply = readReply(body)
  const usage = (body as { usage?: Record<string, unknown> }).usage ?? {}
  const parsed = parseLooseJson(reply.text)
  console.log(
    `\n预算 ${maxTokens}${extra ? ` + ${JSON.stringify(extra)}` : ''}：` +
      `finish_reason=${reply.finishReason || '—'} · 正文 ${reply.text.length} 字 · ` +
      `思考链 ${reply.reasoning.length} 字 · usage=${JSON.stringify(usage)}`,
  )
  if (!parsed) {
    console.log(`  ✗ 没解析出 JSON。正文开头：${JSON.stringify(reply.text.slice(0, 120))}`)
    if (reply.reasoning) console.log(`  思考链末尾：${reply.reasoning.slice(-160)}`)
    if (dump) console.log(`  正文全文：\n${reply.text}`)
    return
  }
  if (dump) console.log(`  正文全文：\n${reply.text}`)
  // ★ 认表用的是**生产那一份** `anchorsObjectOf`（2026-10-16 第 19 刀加的容错）：
  //   这一段原来直接读 `parsed['anchors']`，于是模型把表叫 `anchor` 的那一次，
  //   探针也印成"（没有这一格）"——**探针自己复现了一遍线上那个假成功**，
  //   拿它当证据等于用坏掉的尺子量。判据只留一处，探针也用那一处。
  const anchors = anchorsObjectOf(parsed)
  console.log(`  ✓ 解析到了（表在 ${JSON.stringify(tableKeyOf(parsed))}）。拿到的槽位：`)
  for (const slot of READ_SLOTS) {
    const value =
      anchors && typeof anchors === 'object'
        ? ((anchors as Record<string, unknown>)[ANCHOR_LABELS[slot]] ??
          (anchors as Record<string, unknown>)[slot])
        : undefined
    console.log(
      `    ${ANCHOR_LABELS[slot]}: ${value === undefined ? '（没有这一格）' : String(value)}`,
    )
  }
  console.log(
    `  lookTags=${JSON.stringify(parsed['lookTags'] ?? null)} note=${JSON.stringify(parsed['note'] ?? null)}`,
  )
}

/** 表放在哪个键下面（只说位置，不判对错）。它自己就是"模型形状会不会变"的那个读数 */
function tableKeyOf(parsed: Record<string, unknown>): string {
  for (const key of Object.keys(parsed)) {
    const value = parsed[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      anchorsObjectOf(parsed) === value
    ) {
      return key
    }
  }
  return '顶层（平铺）'
}

/* ── 步骤 1/2/4：预算扫描 ────────────────────────────────────────────────── */

for (const maxTokens of budgets) {
  await singleCall(maxTokens)
}

/* ── 步骤 3：关思考的参数认不认 ──────────────────────────────────────────── */

if (extraArgs.trim() !== '') {
  const extra = extraOf(extraArgs)
  console.log(`\n──── 步骤 3：额外字段 ${JSON.stringify(extra)}（认不认） ────`)
  try {
    await singleCall(budgets[budgets.length - 1] ?? 4096, extra)
  } catch (err) {
    console.log(`  ✗ 被拒了（这就是结论：这个参数名这家不认，别写进代码）：${String(err)}`)
  }
}

/* ── 步骤 4（补）：适配器那条路，也就是**生产真正跑的那条** ───────────────── */

/**
 * ★ 这一段**必须逐次看**：适配器自带"截断就把预算翻 4 倍重试一次"，
 *   只看最后那个结果，就分不清"一次就成"与"第一次截断、第二次才成"——
 *   而这两件事的结论完全不同（后者说明预算是真的不够）。
 *   观察方式是注入一个只读的 `fetchImpl`（它本来就是为"能看见每一次回包"存在的，
 *   见 `HttpDeps.fetchImpl` 的注释），**不改适配器的行为**。
 */
const observingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init)
  const clone = response.clone()
  void clone
    .json()
    .then((body: unknown) => {
      const reply = readReply(body)
      const usage = (body as { usage?: Record<string, unknown> }).usage ?? {}
      const asked = JSON.parse(String(init?.body ?? '{}')) as { max_tokens?: number }
      console.log(
        `    · 一次回包：max_tokens=${asked.max_tokens} → finish_reason=${reply.finishReason || '—'} · ` +
          `正文 ${reply.text.length} 字 · 思考链 ${reply.reasoning.length} 字 · reasoning_tokens=` +
          `${String((usage['completion_tokens_details'] as Record<string, unknown> | undefined)?.['reasoning_tokens'] ?? '—')}`,
      )
    })
    .catch(() => {
      /* 不是 JSON 就算了，下面那条路会自己报 */
    })
  return response
}

console.log('\n──── 生产那条路（`createOpenAiVision` + `analyzePortrait`，含它自己的重试） ────')
for (const maxTokens of budgets) {
  const vision = createOpenAiVision(
    { baseUrl, apiKey, timeoutMs: 300_000, fetchImpl: observingFetch },
    model,
    { analyzeMaxTokens: maxTokens },
  )
  try {
    const analysis = await vision.analyzePortrait({ photoDataUrl })
    const read = new Map(analysis.anchors.map((anchor) => [anchor.slot, anchor.value]))
    console.log(
      `预算 ${maxTokens}：✓ 读到了 ${read.size} 条 —— ` +
        READ_SLOTS.map((slot) => `${ANCHOR_LABELS[slot]}=${read.get(slot) ?? '（空）'}`).join(
          ' | ',
        ),
    )
    console.log(
      `  lookTags=${JSON.stringify(analysis.lookTags)} note=${JSON.stringify(analysis.note ?? null)}`,
    )
  } catch (err) {
    console.log(`预算 ${maxTokens}：✗ ${String(err)}`)
  }
}
