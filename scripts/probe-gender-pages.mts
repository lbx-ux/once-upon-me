/**
 * probe-gender-pages.mts —— 「每一页都是同一个孩子」那条修复的**真跑**验收（2026-10-16）
 *
 * 上游是用户那条报障：**「我提供给你的是男孩子，怎么生成出来有男孩有女孩子」**。
 * 三层根因（诊断与修法见 `.scratch/app-restructure/issues/12-*`）：
 *   ① 逐页 prompt 里**从来没有过**那个称呼（卡上的锚点里也没有性别词）；
 *   ② 父级在界面上选的 `gender` **连请求体都没进**（`toBookBody` 不送、`parseCreateBody` 不收）；
 *   ③ 一致性比对**根本没在判**——`compare()` 把 `max_tokens` 硬编码成 400，
 *      推理模型把预算全花在思考链上，正文一个字都没有 ⇒ 每一页都记「没法核对」。
 *
 * 所以这一条要**真跑一本**，因为三条判据都只有真做才会不同：
 *
 * | 判据                                   | 修复前           | 现在该是                          |
 * | -------------------------------------- | ---------------- | --------------------------------- |
 * | `book.json` 的 `provenance.promptVersion` | `image-page@v2` | `image-page@v3`（多了称呼那一行） |
 * | 每一页的 `consistency.verdict`         | 全是 `unavailable` | 出现真的 `score`（比对**在判**）  |
 * | 盘上那几张页图                         | 有男有女         | 同一个孩子的脸与发型              |
 *
 * ★ 最后一条**机器判不了**，脚本只把图的路径报出来，由人（或读图的那一步）看。
 *   这是这一条探针唯一诚实的样子：把"能自动判的"判掉，把"要看图的"交出去，
 *   而不是编一个"像不像"的分数。
 *
 * 用法（先起一个 dev server，例如 `node scripts/dev-preview.mjs --port=3321`）：
 *
 * ```bash
 * node scripts/probe-gender-pages.mts --base=http://localhost:3321 \
 *   --child=kid-yl957g --card=kid-yl957g-sheet --pages=3
 * ```
 *
 * ★ 它**不改**盘上那个孩子的档案：`/api/books` 不写档案（档案由 `/api/children` 那条路写），
 *   请求体里的 child 只是这一轮的输入。所以对真实数据是只读的（新增的只有这一本书）。
 * ★ 它**不打印任何金额**（与 `web-run.mts` 同一条纪律，口径见 `scripts/env.mts` 文件头）。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describeEvent } from '../src/lib/engine/events.ts'
import { decodeBookFrame, type BookStreamFrame } from '../src/lib/book-stream.ts'
import { createSseDecoder } from '../src/lib/engine/sse.ts'
import { childProfileOf } from '../src/lib/children-source.ts'
import type { Book, EngineEvent } from '../src/lib/engine/index.ts'
import { arg, readEnv } from './env.mts'

/** 与 `web-run.mts` 同一张白名单：per-request Env 的语义就是"这一张表说了算" */
const PROVIDER_KEYS = [
  'LLM_MODEL',
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MAX_TOKENS',
  'LLM_THINKING',
  'LLM_JSON_MODE',
  'IMAGE_MODEL',
  'IMAGE_API_KEY',
  'IMAGE_BASE_URL',
  'VISION_MODEL',
  'VISION_API_KEY',
  'VISION_BASE_URL',
  'VISION_TIMEOUT_MS',
] as const

const say = (line: string): void => void process.stdout.write(`${line}\n`)

async function main(): Promise<void> {
  const base = arg('base', 'http://localhost:3321').replace(/\/+$/, '')
  const childId = arg('child', 'kid-yl957g')
  const cardId = arg('card', 'kid-yl957g-sheet')
  const pages = Number(arg('pages', '3'))
  const theme = arg('theme', '第一次离开家也不怕')
  const assetRoot = resolve(arg('assets', '.out/web'))
  const outDir = resolve(arg('out', `.out/gender-pages/${Date.now()}`))

  const env = await readEnv()
  const providers: Record<string, string> = {}
  for (const key of PROVIDER_KEYS) {
    const value = env[key]?.trim()
    if (value) providers[key] = value
  }
  if (!providers['IMAGE_API_KEY'] || !providers['IMAGE_MODEL']) {
    throw new Error('.env.local 缺 IMAGE_API_KEY / IMAGE_MODEL（本脚本不打印它们的值）')
  }

  // 孩子的档案从**盘上**读（与 `/home` 那一屏同一条路：`children-source` 的两个来源、
  // 自己的在前），不从命令行编：这一轮要送的正是"界面上选的那一档性别"
  const resolved = await childProfileOf(childId, assetRoot)
  if (!resolved) {
    throw new Error(`盘上找不到这个孩子的档案：${childId}（看看 ${assetRoot}/children/）`)
  }
  const profile = resolved.profile
  const child = {
    childId: profile.childId,
    name: profile.name,
    nameReading: profile.nameReading,
    ageBand: profile.ageBand,
    // 有才带（与界面那条路同一写法）：没有这一栏就不写这个键
    ...(profile.gender ? { gender: profile.gender } : {}),
    lookTags: [...profile.lookTags],
    interestTags: [...profile.interestTags],
  }
  say(
    `孩子：${child.name}（${child.childId}）· 性别 ${profile.gender ?? '(没选)'}` +
      ` · 标签 ${child.lookTags.join('/')} · 来源 ${resolved.source}`,
  )
  if (!profile.gender) {
    throw new Error(
      '这个孩子的档案里没有 gender，这一轮验的就是它——换一个有性别的孩子，或先在界面上选一下',
    )
  }

  const body = {
    child,
    cardId,
    theme,
    form: 'solo',
    pages,
    status: 'draft',
    mode: 'live',
    env: providers,
  }

  await mkdir(outDir, { recursive: true })
  say(`\nPOST ${base}/api/books · pages=${pages} · card=${cardId}\n`)

  const response = await fetch(`${base}/api/books`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}：${await response.text()}`)
  }

  const decoder = createSseDecoder()
  const reader = response.body.getReader()
  const textDecoder = new TextDecoder()
  const frames: BookStreamFrame[] = []
  let raw = ''
  let bookId: string | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = textDecoder.decode(value, { stream: true })
    raw += chunk
    for (const sse of decoder.push(chunk)) {
      const frame = decodeBookFrame(sse)
      if (!frame) {
        say(`⚠ 解不出来的帧：event=${sse.event}`)
        continue
      }
      frames.push(frame)
      if (frame.kind === 'engine') {
        const event: EngineEvent = frame.event
        say(`[${String(event.seq).padStart(2, '0')}] ${describeEvent(event)}`)
        if (event.kind === 'book-ready') bookId = event.bookId
      } else if (frame.kind === 'fatal') {
        say(`✗ fatal ${frame.code}：${frame.message}`)
      }
    }
  }
  await writeFile(join(outDir, 'stream.sse'), raw, 'utf8')
  if (!bookId) throw new Error('整条流里没有 book-ready，这一轮没跑出来（上面有原因）')

  /* ── 判据一：模板版本 ─────────────────────────────────────────────────── */

  const book = JSON.parse(
    await readFile(join(assetRoot, 'books', bookId, 'book.json'), 'utf8'),
  ) as Book
  const versions = [...new Set(book.illustrations.map((one) => one.provenance.promptVersion))]
  say(`\n书号 ${bookId}`)
  say(`判据一 · provenance.promptVersion = ${JSON.stringify(versions)}`)

  /* ── 判据二：比对到底在不在判 ─────────────────────────────────────────── */

  say('\n判据二 · 每一页的一致性结论（修复前这里是 8/8 unavailable）')
  for (const one of book.illustrations) {
    const verdict = one.consistency?.verdict ?? '(没有这一栏)'
    const score = one.consistency?.score
    const reason = one.consistency?.reason ? ` · ${one.consistency.reason}` : ''
    say(
      `  第 ${one.pageNo} 页 · attempt ${one.attempt} · ${verdict}` +
        (score === null || score === undefined ? '' : ` ${score.toFixed(2)}`) +
        reason,
    )
  }
  const judged = book.illustrations.filter((one) => one.consistency?.score !== null).length
  say(`  → 真的给出了分数的：${judged} / ${book.illustrations.length}`)

  /* ── 判据三：图本身（人看） ───────────────────────────────────────────── */

  say('\n判据三 · 页图（自己看：这几张该是同一个孩子）')
  for (const one of book.illustrations) {
    say(`  第 ${one.pageNo} 页 → ${join(assetRoot, one.asset.path)}`)
  }
  say(`\n日志与流：${outDir}`)
}

await main()
