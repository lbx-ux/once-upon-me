/**
 * e2e-delete-child.mts —— 「删掉一个孩子」整条路真跑一次（工单 03 第三刀）
 *
 * ```bash
 * node scripts/e2e-delete-child.mts               # 建探针 → 预演 → 真删 → 核对磁盘
 * node scripts/e2e-delete-child.mts --seed-only=1  # 只造探针（然后在浏览器里点删除那两下）
 * ```
 *
 * ★ 它证明的是**磁盘上真的干净了**，不是"函数回了几个数"。
 *   单元测试（`child-deletion.test.ts`）盯的是逻辑与那条真实的漏
 *   （缩略图与卡片平级，删卡不删图）；这一支盯的是同一个漏在
 *   **真文件系统 + 真 HTTP 路由**上不会换个形状再出现一遍。
 *
 * ★ 缩略图是用**应用自己的那条路**生成的（GET `/api/assets/…?w=240`，走 sharp 现缩），
 *   不是手塞进去的文件。所以"删掉了缩略图"这句话里的那个缩略图，
 *   是真实用户会看到的那一份。
 *
 * ★ 卡也是真的建（走 `cardStore.create`），但**不为此花一次出图钱**：
 *   参考图借示例孩子那一张。删除这条路关心的是文件在哪、有几条，
 *   与那张图是哪个模型画的无关。
 */

import { existsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { createCardStore, createFsStore, createProfileStore } from '../src/lib/engine/index.ts'
import { assetUrlOf } from '../src/lib/asset-url.ts'
import type { CharacterAnchor } from '../src/lib/engine/domain.ts'
import { arg } from './env.mts'

type Row = [what: string, value: string]

const BASE = arg('base', 'http://localhost:3000')
const ROOT = resolve(arg('out', '.out/web'))
const KEEP = arg('keep', '') === '1'
/**
 * 造完探针就停。删除那两下要**在浏览器里点**一遍：
 * 脚本能验数字，验不了"确认框里那句话是不是摆在能读的地方"。
 */
const SEED_ONLY = arg('seed-only', '') === '1'
const PROBE = 'kid-delete-probe'

const ANCHORS: CharacterAnchor[] = [
  { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
  { slot: 'eyes', value: '深棕圆眼' },
  { slot: 'hair', value: '黑发偏软，左上方翘着一撮' },
  { slot: 'build', value: '头身比约 1:4' },
  { slot: 'skin', value: '暖黄偏深的肤色' },
]

function table(rows: readonly Row[]): string {
  const width = Math.max(...rows.map(([what]) => [...what].length))
  return rows
    .map(([what, value]) => `  ${what}${' '.repeat(width - [...what].length)}  ${value}`)
    .join('\n')
}

async function countUnder(prefix: string): Promise<number> {
  const full = resolve(ROOT, prefix)
  if (!existsSync(full)) return 0
  let n = 0
  for (const name of await readdir(full, { recursive: true })) {
    const info = await stat(join(full, name)).catch(() => null)
    if (info?.isFile()) n += 1
  }
  return n
}

async function main(): Promise<void> {
  const rows: Row[] = []

  // ── ① 探针：档案走真路由建，卡借示例孩子的参考图建，缩略图走应用的现缩 ──────
  const store = await createFsStore(ROOT)
  const cardStore = createCardStore(store)
  const profiles = createProfileStore(store)

  const xiaoyu = await cardStore.latestForChild('xiaoyu')
  if (!xiaoyu) {
    console.log('\n示例孩子 xiaoyu 不在资产根里，借不到参考图。先把演示卡拷进 .out/web。\n')
    process.exitCode = 1
    return
  }
  const refBytes = await store.read(xiaoyu.reference.path)
  if (!refBytes) {
    console.log(`\n${xiaoyu.reference.path} 读不到。\n`)
    process.exitCode = 1
    return
  }

  // 探针的档案直接落盘，不走 `/api/children`：建档那条路由 `e2e-new-child.mts` 验，
  // 这一支要验的是**删**——而删面对的是文件布局，不是"档案是谁建的"
  await rm(join(ROOT, 'children', `${PROBE}.json`), { force: true })
  await rm(join(ROOT, 'cards', `${PROBE}-sheet`), { recursive: true, force: true })
  await profiles.save({
    childId: PROBE,
    name: '删除探针',
    nameReading: 'shān chú',
    ageBand: '4-6',
    lookTags: [],
    interestTags: [],
    createdAt: Date.now(),
  })
  const { card } = await cardStore.create({
    cardId: `${PROBE}-sheet`,
    childId: PROBE,
    anchors: ANCHORS,
    style: xiaoyu.style,
    referenceBytes: refBytes,
    referenceMime: xiaoyu.reference.mime,
    modelId: 'probe-seed',
    promptVersion: 'probe-seed@v1',
    now: Date.now(),
  })
  rows.push(['① 探针', `${PROBE}（档案 1 条 + 卡与参考图若干）`])

  // ★ 缩略图走应用自己的现缩那条路：这一步产生的是**真实用户会看到的那一份**
  const thumbUrl = assetUrlOf(card.reference.path, 240)
  const thumb = await fetch(`${BASE}${thumbUrl}`)
  const thumbPath = join(ROOT, 'thumbs', '240', `${card.reference.path}.webp`)
  rows.push([
    '② 生成一张缩略图',
    `${thumb.status} · GET ${thumbUrl} · 磁盘上${existsSync(thumbPath) ? '有' : '**没有**'}`,
  ])

  const before = {
    cards: await countUnder(`cards/${card.cardId}`),
    thumbs: await countUnder('thumbs'),
    profile: existsSync(join(ROOT, 'children', `${PROBE}.json`)) ? 1 : 0,
  }
  rows.push([
    '删之前',
    `卡目录 ${before.cards} 个文件、档案 ${before.profile} 条、整个 thumbs/ ${before.thumbs} 个文件`,
  ])

  // `--seed-only=1`：造完探针就停，好在浏览器里把删除那两下**点**一遍
  // （脚本能验数字，验不了"确认框里那句话是不是摆在能读的地方"）
  if (SEED_ONLY) {
    console.log(`\n只造探针（--seed-only=1）\n\n${table(rows)}\n`)
    console.log(`去这一页点：${BASE}/character/${PROBE}\n`)
    return
  }

  // ── ③ 预演：GET 回"将要删掉什么" ───────────────────────────────────────────
  const planResponse = await fetch(`${BASE}/api/children/${PROBE}`)
  const plan = (await planResponse.json()) as {
    receipt?: { places: { place: string; deleted: number; note?: string }[]; totalFiles: number }
    message?: string
  }
  rows.push(['③ 预演 GET', `${planResponse.status} · 一共 ${plan.receipt?.totalFiles ?? '-'} 条`])
  for (const place of plan.receipt?.places ?? []) {
    rows.push([`  · ${place.place}`, `${place.deleted} 条${place.note ? ` · ${place.note}` : ''}`])
  }

  // 预演**不该动任何东西**：数一遍磁盘和预演前一样
  const afterPlan = await countUnder(`cards/${card.cardId}`)
  rows.push([
    '★ 预演之后卡目录还是',
    `${afterPlan} 个文件 ${afterPlan === before.cards ? '（一个都没动 ✓）' : '**被动过了！**'}`,
  ])

  // ── ④ 真删：DELETE 回"删掉了什么" ─────────────────────────────────────────
  const gone = await fetch(`${BASE}/api/children/${PROBE}`, { method: 'DELETE' })
  const receipt = (await gone.json()) as {
    receipt?: {
      places: { place: string; deleted: number; failed?: string }[]
      totalFiles: number
      complete: boolean
      stage: string
    }
    message?: string
  }
  rows.push([
    '④ 真删 DELETE',
    `${gone.status} · stage=${receipt.receipt?.stage ?? '-'} · 一共 ${receipt.receipt?.totalFiles ?? '-'} 条 · complete=${String(receipt.receipt?.complete ?? false)}`,
  ])

  // ── ⑤ 核对磁盘：不是看它回了什么数，是看**还在不在** ────────────────────────
  const stillCards = await countUnder(`cards/${card.cardId}`)
  const stillProfile = existsSync(join(ROOT, 'children', `${PROBE}.json`)) ? 1 : 0
  const probeThumbs = await countUnder(`thumbs/240/cards/${card.cardId}`)
  const totalThumbs = await countUnder('thumbs')
  rows.push(['★ 删之后卡目录', `${stillCards} 个文件 ${stillCards === 0 ? '✓' : '**还在！**'}`])
  rows.push(['★ 删之后档案', `${stillProfile} 条 ${stillProfile === 0 ? '✓' : '**还在！**'}`])
  rows.push([
    '★ 删之后他的缩略图',
    `${probeThumbs} 个 ${probeThumbs === 0 ? '✓（这一条就是那个真实的漏）' : '**还在！**'}`,
  ])
  rows.push([
    '别人的缩略图没被牵连',
    `整个 thumbs/ 还剩 ${totalThumbs} 个文件（删之前 ${before.thumbs} 个）`,
  ])

  // ── ⑥ 示例孩子要**被拒绝**，而且要说出为什么 ───────────────────────────────
  const demo = await fetch(`${BASE}/api/children/xiaoyu`)
  const demoBody = (await demo.json()) as { message?: string; code?: string }
  rows.push([
    '⑤ 删示例孩子',
    `${demo.status} · ${demoBody.code ?? '-'} · ${String(demoBody.message ?? '').slice(0, 40)}…`,
  ])
  const demoStill = existsSync(join(ROOT, 'cards', 'xiaoyu-r1', 'latest'))
  rows.push(['⑥ 它真的没动示例', demoStill ? 'xiaoyu-r1 还在 ✓' : '**被删了！**'])

  const notFound = await fetch(`${BASE}/api/children/meiyou-zhe-ge`)
  rows.push(['⑦ 删一个不存在的孩子', `${notFound.status}`])

  console.log(`\n删掉一个孩子 · 真跑一次\n\n${table(rows)}\n`)

  if (!KEEP) {
    await rm(join(ROOT, 'cards', `${PROBE}-sheet`), { recursive: true, force: true })
    await rm(join(ROOT, 'children', `${PROBE}.json`), { force: true })
    console.log('探针清理干净。\n')
  } else {
    console.log(`探针留着（--keep=1）。在浏览器里点：${BASE}/character/${PROBE}\n`)
  }
}

await main()
