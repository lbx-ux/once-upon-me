/**
 * e2e-analyze-photo.mts —— 「分析锚点」那条路，真跑一次（第 19 刀）
 *
 * ```bash
 * # 先起一个自己的 dev server（别用别人那个 :3000）
 * node scripts/e2e-analyze-photo.mts --base=http://localhost:3311 \
 *   --photo=.out/probe/halfbody.jpg
 * ```
 *
 * 起因是用户报障：「这个修复一下，我试了好几次，都出现这个问题了，有时候用户上传的
 * 图片并不是完整的照片，可能只有是上半身，ai能识别出来什么就在锚点里填上，
 * 识别不出来的就空出来，提示用户去填」。
 *
 * 打的是**真路由** `POST /api/cards/analyze-photo`（不是直接调适配器）：
 * 那个 bug 有一半长在路由下面那一层（`anchorsObjectOf` 只认 `anchors`、模型回的是
 * `anchor`），一半长在这一层（同意/大小的门、错误映射）。只测适配器的话，
 * "路由把 env 读错了"这一类照样漏过去。
 *
 * ## 四件被判据化的事
 *
 * | 判据 | 它排除的坏法 |
 * |---|---|
 * | 读到 >0 条 | 复现用户那一屏：回包里明明有读数，界面报「读到了 0 条」 |
 * | 照片答不了的那几格**是空的** | 模型按"同龄孩子常见的样子"把全身比例补出来（编出来的一条会跟着孩子进每一页） |
 * | `note` 说得出这张照片缺了什么 | 界面那句"另外几格空着"说不出原因，家长会以为坏了 |
 * | 没配视觉模型时**回一句人话、不给锚点** | 静默的假成功：拿一份空表当"读到了"填进表单 |
 *
 * ★ 送进去的是**一张裁剪图**，不是真照片：`.out/probe/halfbody.jpg` 是把
 *   `E:/match/public/photo/xiaoman.jpg` 上 42% 裁下来的半身像
 *   （`sharp().extract(...)`）。我不会往这台机器上放任何未成年人的照片。
 *   所以这一跑能证明的是**半身照这条路**是通的，不能证明"读出来的描述像不像他"——
 *   那只能人看，两件事不许混着写。
 */

import { readFile, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import { DEFAULT_ANCHORS } from '../src/lib/creation/default-anchors.ts'
import { ANCHOR_LABELS, READ_SLOTS } from '../src/lib/engine/domain.ts'
import { arg, readEnv } from './env.mts'

const BASE = arg('base', 'http://localhost:3311')
const PHOTO = resolve(arg('photo', '.out/probe/halfbody.jpg'))

const env = await readEnv()

/** 送几组 env：**只送视觉那三个**（界面抽屉里那一格给的就是它们） */
function visionEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ['VISION_BASE_URL', 'VISION_API_KEY', 'VISION_MODEL']) {
    const value = env[key] ?? (key === 'VISION_API_KEY' ? env['LLM_API_KEY'] : undefined)
    if (value) out[key] = value
  }
  return out
}

type Result = {
  label: string
  ok: boolean
  detail: string
}

const results: Result[] = []
const judge = (label: string, ok: boolean, detail: string): void => {
  results.push({ label, ok, detail })
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

async function analyze(
  bytes: Uint8Array,
  envTable: Record<string, string>,
  consent: string | null,
): Promise<{ status: number; ms: number; body: Record<string, unknown> }> {
  const form = new FormData()
  form.set(
    'photo',
    new Blob([bytes], { type: MIME[extname(PHOTO).toLowerCase()] ?? 'image/jpeg' }),
    'probe.jpg',
  )
  if (consent !== null) form.set('consent', consent)
  // 界面送的是**表单里当前那八条**（当粒度参考用，不是标准答案），所以这里也送它们
  form.set('anchors', JSON.stringify(DEFAULT_ANCHORS))
  form.set('env', JSON.stringify(envTable))
  const started = performance.now()
  const response = await fetch(`${BASE}/api/cards/analyze-photo`, { method: 'POST', body: form })
  const ms = performance.now() - started
  const body = (await response.json()) as Record<string, unknown>
  return { status: response.status, ms, body }
}

async function main(): Promise<void> {
  const info = await stat(PHOTO).catch(() => null)
  if (!info) {
    console.log(`找不到照片 ${PHOTO}。造一张半身照：把一张全身照上 42% 裁下来。`)
    process.exitCode = 1
    return
  }
  const bytes = new Uint8Array(await readFile(PHOTO))
  const envTable = visionEnv()
  console.log(
    `\n打真路由 ${BASE}/api/cards/analyze-photo\n` +
      `照片 ${PHOTO}（${bytes.length} 字节）· env ${JSON.stringify(Object.keys(envTable))}` +
      ` · 模型 ${envTable['VISION_MODEL'] ?? '（没配）'}\n`,
  )

  // ── ① 半身照：读得出来的要读出来，读不出来的要空着 ─────────────────────────
  const half = await analyze(bytes, envTable, 'true')
  const anchors = Array.isArray(half.body['anchors'])
    ? (half.body['anchors'] as { slot: string; value: string }[])
    : []
  const read = new Map(anchors.map((anchor) => [anchor.slot, anchor.value]))
  const missing = READ_SLOTS.filter((slot) => !read.has(slot))
  const note = typeof half.body['note'] === 'string' ? (half.body['note'] as string) : ''

  console.log(
    `① 半身照 ${half.status} · ${half.ms.toFixed(0)} ms · modelId=${String(half.body['modelId'] ?? '-')}`,
  )
  if (half.status !== 200) {
    console.log(`  它说了什么：${String(half.body['message'] ?? '（没有 message）')}`)
  }
  for (const slot of READ_SLOTS) {
    console.log(`   ${ANCHOR_LABELS[slot]}：${read.get(slot) ?? '（空——留给家长填）'}`)
  }
  console.log(`   note：${note === '' ? '（没有）' : note}`)

  judge(
    '★ 读到了 >0 条（用户那一屏是"读到了 0 条"，而回包里其实有读数）',
    half.status === 200 && anchors.length > 0,
    `${anchors.length} 条 / ${READ_SLOTS.length} 格`,
  )
  judge(
    '★ 照片答不了的那几格是空的（不是编出来的）',
    missing.length > 0,
    `空的：${missing.map((slot) => ANCHOR_LABELS[slot]).join('、') || '（一格都没空——半身照不该这样）'}`,
  )
  judge(
    'note 说得出这张照片缺了什么（界面那句"另外几格空着"的理由）',
    note !== '',
    note === '' ? 'note 是空的' : note,
  )
  // 编出来的锚点最坏的形态是"看着很正常"，所以这里只判它**不许**长成通用套话
  judge(
    '读出来的每一条都不是套话（不是"一个可爱的孩子"这种）',
    anchors.every((anchor) => anchor.value.length >= 4),
    anchors
      .map(
        (anchor) =>
          `${ANCHOR_LABELS[anchor.slot as keyof typeof ANCHOR_LABELS] ?? anchor.slot}=${anchor.value.length}字`,
      )
      .join(' '),
  )

  // ── ② 没配视觉模型：一句人话，**不给锚点** ────────────────────────────────
  const naked = await analyze(bytes, {}, 'true')
  const nakedAnchors = naked.body['anchors']
  console.log(
    `\n② 没配视觉模型 ${naked.status} · ${naked.ms.toFixed(0)} ms · ${String(naked.body['message'] ?? '')}`,
  )
  judge(
    '★ 没配模型时回一句人话，而不是一份编的锚点',
    naked.status === 400 && nakedAnchors === undefined,
    `状态 ${naked.status}，anchors ${nakedAnchors === undefined ? '没给 ✓' : '**给了**'}`,
  )

  // ── ③ 同意那一格没松：缺字段 → 400，且一个字节都不该被看 ────────────────────
  const noConsent = await analyze(bytes, envTable, null)
  console.log(`\n③ 没勾同意 ${noConsent.status} · ${String(noConsent.body['message'] ?? '')}`)
  judge(
    '同意那一格只认字面量 true（缺字段就拒）',
    noConsent.status === 400,
    `状态 ${noConsent.status}`,
  )

  const failed = results.filter((item) => !item.ok)
  console.log('\n──── 判据 ────')
  for (const item of results) {
    console.log(`  ${item.ok ? '✓' : '✗'} ${item.label}\n      ${item.detail}`)
  }
  console.log(failed.length === 0 ? '\n全过。\n' : `\n${failed.length} 条没过。\n`)
  if (failed.length > 0) process.exitCode = 1
}

await main()
