/**
 * make-demo-narration.mts —— 给演示书补**真音频**（ADR-0003 那条"断网也能走完一本"
 * 要连声音一起成立；app-restructure 工单 08 §一 的判据 ③）
 *
 * 做三件事：
 *   1. 读 public/demo/books/<id>/book.json，逐页拿正文
 *   2. 用 .env.local 的 TTS_* 逐页合成，写成 page-N-a1.mp3
 *   3. 把 narrations 写回 book.json
 *
 * ★ 三条纪律：
 *   - **正文拼法必须与 narrate.ts 一致**（`body.join('')`，不加空格）——
 *     两边拼法不同，演示书的时长/体积就与线上生成对不上，测出来的数是两套。
 *   - **一页失败就整体放弃**：宁可这本书没有配音，也不要一本"三页里有两页能响"的书
 *     （工单 08 §一：要么整本都能响，要么不接线）。所以任何一页失败都**不写** book.json。
 *   - **时长不编**：接口不回 durationMs，就不写这个字段——
 *     不许放一个"看起来合理"的数（types.ts 对 usage 的同一条规矩）。
 *
 * 用法：
 *   node scripts/make-demo-narration.mts                       # 演示书（public/demo/books/…）
 *   node scripts/make-demo-narration.mts --dir=.out/web/books/xiaoyu-r1-4fe055c5723b
 * 音色：--voice= 覆盖，缺省取 TTS_VOICE。
 *
 * ★ 为什么要有 `--dir`：书号是"卡 + 主题指纹"（不含时间戳），所以**同一本书
 *   在本机可能同时存在运行期副本（ASSET_ROOT/books/<id>）与随仓库提交的演示副本
 *   （public/demo/books/<id>）**，而 `resolveBook` 按设计优先运行期那个。
 *   两份都要能各自补齐朗读，否则会出现"演示书明明有音频，页面上却说没有朗读"。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { digest } from '../src/lib/engine/digest.ts'
import type { Book, Narration } from '../src/lib/engine/domain.ts'
import { createProviders } from '../src/lib/engine/providers/registry.ts'
import { createFsStore } from '../src/lib/engine/providers/stores.ts'
import { arg, readEnv } from './env.mts'

const bookId = arg('book', 'xiaoyu-r1-4fe055c5723b')
const dir = arg('dir', join('public/demo/books', bookId))
const manifestPath = join(dir, 'book.json')

const env = await readEnv()
const voiceId = arg('voice', env['TTS_VOICE'] ?? '').trim()
if (!voiceId) throw new Error('没指定音色：--voice= 或 .env.local 的 TTS_VOICE')

const store = await createFsStore(dir)
const providers = await createProviders({ env, mode: 'live', store, assetRoot: dir })
if (!providers.voice) {
  throw new Error('语音能力没建起来（TTS_API_KEY / TTS_MODEL / TTS_BASE_URL 有一项缺）')
}
console.log(`音色 ${voiceId} · 适配器 ${providers.voice.id}`)

const book = JSON.parse(await readFile(manifestPath, 'utf8')) as Book
const pages = [...book.tree.nodes].sort((a, b) => a.pageNo - b.pageNo)
console.log(`《${book.tree.title}》共 ${pages.length} 页`)

// 先全部合成，再落盘：任何一页失败就整体放弃（文件头第 2 条）
const made: { pageNo: number; text: string; bytes: Uint8Array; mime: string }[] = []
for (const node of pages) {
  // ★ 与 narrate.ts 的 `narrationTextOf` 同一条规则：join('')，不加空格
  const text = node.body.join('')
  if (text.trim() === '') throw new Error(`第 ${node.pageNo} 页正文是空的——先去查 book.json`)
  const t0 = Date.now()
  const { bytes, mime } = await providers.voice.synthesize({ voiceId, text })
  console.log(
    `  第 ${node.pageNo} 页：${bytes.byteLength} 字节 · ${mime} · ${Date.now() - t0}ms · "${text.slice(0, 18)}…`,
  )
  made.push({ pageNo: node.pageNo, text, bytes, mime })
}

console.log('\n全部合成成功，开始落盘：')
const narrations: Narration[] = []
for (const item of made) {
  const path = `books/${bookId}/page-${item.pageNo}-a1.mp3`
  await writeFile(join(dir, `page-${item.pageNo}-a1.mp3`), item.bytes)
  narrations.push({
    pageNo: item.pageNo,
    voiceId,
    textHash: digest(item.text),
    asset: { path, digest: digest(item.bytes), bytes: item.bytes.byteLength, mime: item.mime },
  })
  console.log(`  ${path} (${item.bytes.byteLength} 字节)`)
}

const total = made.reduce((sum, m) => sum + m.bytes.byteLength, 0)
await mkdir(dirname(manifestPath), { recursive: true })
await writeFile(manifestPath, JSON.stringify({ ...book, narrations }, null, 2), 'utf8')
console.log(
  `\nnarrations 写回 ${manifestPath}：${narrations.length} 条 · 共 ${total} 字节（${(total / 1024).toFixed(0)} KB）`,
)
