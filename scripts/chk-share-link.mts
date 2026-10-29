/**
 * chk-share-link.mts —— 分享链接的五条判据（2026-10-29，报告 §6.3）
 *
 * ```
 * node scripts/chk-share-link.mts --base=http://127.0.0.1:3312 --root=.out/share-probe
 * ```
 *
 * 它**自己造一本可分享的书**（把 `public/demo/books/` 里那本演示书拷进
 * `<root>/u/<user>/books/`），再造一条分享记录，然后匿名访问真 dev server。
 * 跑完把造的东西留在原地：你可以接着用浏览器打开那条链接看（最后会把它打印出来）。
 *
 * 五条判据，逐条对应报告 §6.3：
 *
 * 1. 未登录打开分享链 → 200，正文里有第一页的字，图也能匿名取到；
 * 2. 过期 / 收回的记录 → 404（不是 403，不泄露"这张票存在过"）；
 * 3. 改一个字节 → 404；
 * 4. 分享页里没有任何写操作按钮（重画/删除/再做一本/去书架）；
 * 5. 打开分享页**不发生任何模型调用**（`events.jsonl` 一个字节都不动）。
 *
 * 另加四条这一层自己的边界（不在报告那五条里，但漏了就是洞）：
 * · 同一张票读别的书 → 404（即使那个文件真的在盘上）；
 * · 同一张票读 `book.json` / `events.jsonl` → 404（制作底稿不是给孩子读的）；
 *   这两条是 2026-10-29 复查抓出来的：第一版按目录放行，两条都回 200；
 * · 不带票读同一张图 → 401（原来那条"只认登录"的纪律没被松开）。
 *
 * ★ 它**不测** `POST /api/books/<id>/share`：那条路由要过 `requireCapability`，
 *   会去问 Java 那半边（本地不起后端就是 503）。签发与收回的逻辑由
 *   `src/lib/share/*.test.ts` 钉住，路由那层只有"读"没有"写"，风险在票与路径上。
 */

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readEnv } from './env.mts'
import { createUserStore } from '../src/lib/asset-scope.ts'
import { hashShareToken, signShareToken } from '../src/lib/share/token.ts'
import { putShare, sharePathOf, type ShareRecord } from '../src/lib/share/store.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (name: string, fallback: string): string => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = argOf('base', 'http://127.0.0.1:3312').replace(/\/+$/, '')
const ROOT = resolve(REPO, argOf('root', '.out/share-probe'))
const USER = argOf('user', '1')
const BOOK = argOf('book', 'xiaoyu-r1-4fe055c5723b')
const DECOY = 'chk-share-decoy'

const env = await readEnv()
const secret = env.APP_JWT_SECRET?.trim()
if (!secret) {
  console.error('没有 APP_JWT_SECRET：先读 .env.local，或者把它放进进程环境。')
  process.exit(2)
}
process.env.APP_JWT_SECRET = secret

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${name}${detail ? `  —— ${detail}` : ''}`)
  if (!ok) failures += 1
}

const htmlText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")

async function get(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, { redirect: 'manual', ...init })
}

/* ── 造一本、造一条记录 ─────────────────────────────────────────────────── */

const demoDir = join(REPO, 'public', 'demo', 'books', BOOK)
const bookDir = join(ROOT, 'u', USER, 'books', BOOK)

await rm(join(ROOT, 'u', USER, 'shares'), { recursive: true, force: true })
await rm(bookDir, { recursive: true, force: true })
await mkdir(dirname(bookDir), { recursive: true })
await cp(demoDir, bookDir, { recursive: true })

// 一本诱饵：同一片里真的存在、但不属于这张票
await mkdir(join(ROOT, 'u', USER, 'books', DECOY), { recursive: true })
await writeFile(join(ROOT, 'u', USER, 'books', DECOY, 'secret.png'), Buffer.from('not a real png'))

const store = await createUserStore(ROOT, USER)
const manifest = JSON.parse(await readFile(join(bookDir, 'book.json'), 'utf8')) as {
  tree: { title: string; nodes: Array<{ pageNo: number; body: string[] }> }
}
const title = manifest.tree.title
const firstLine = manifest.tree.nodes[0]?.body?.[0] ?? ''

const HOUR = 60 * 60 * 1000

async function seed(hash: string, record: ShareRecord): Promise<void> {
  await putShare(store, hash, record)
}

const now = Date.now()
const live = signShareToken({ userId: USER, bookId: BOOK, expiresAt: now + HOUR })
const expired = signShareToken({ userId: USER, bookId: BOOK, expiresAt: now + HOUR })
const revoked = signShareToken({ userId: USER, bookId: BOOK, expiresAt: now + HOUR })
const tampered = live.token.slice(0, -1) + (live.token.endsWith('A') ? 'B' : 'A')

await seed(live.hash, { bookId: BOOK, createdAt: now, expiresAt: now + HOUR, revokedAt: null })
await seed(expired.hash, {
  bookId: BOOK,
  createdAt: now - 2 * HOUR,
  expiresAt: now - HOUR,
  revokedAt: null,
})
await seed(revoked.hash, {
  bookId: BOOK,
  createdAt: now - HOUR,
  expiresAt: now + HOUR,
  revokedAt: now - 1000,
})

/* ── 判据 1：匿名打开、正文、图、朗读 ─────────────────────────────────── */

const page = await get(`/r/${live.token}`)
const html = await page.text()
check('1a 未登录打开分享链 → 200', page.status === 200, `status=${page.status}`)
check('1b 正文里有第一页的字', html.includes(firstLine), `“${firstLine}”`)
check('1c 标签页标题是这本书', html.includes(title), title)

// 从 HTML 里捞出第一个带 share= 的资产地址。
// ★ 排掉 `)`：阅读器的页图是内联 `style="background-image:url(…)"` 画的，
//   不排的话会把 CSS 的右括号一起带进查询串，服务端按签名失败回 404——
//   而那看起来像"分享没生效"。这一条是探针自己踩出来的（2026-10-29）。
const assetMatch = /\/api\/assets\/[^"')\s]*share=[^"')\s]*/.exec(html)?.[0] ?? ''
const assetPath = assetMatch.replace(/&amp;/g, '&')
const asset = assetPath ? await get(assetPath) : null
check(
  '1d 图/朗读能匿名取到（带 share= 的那条地址）',
  !!asset && asset.status === 200,
  assetPath ? `status=${asset?.status} ${assetPath}` : 'HTML 里没找到资产地址',
)
if (asset) await asset.arrayBuffer()

/* ── 判据 2：过期 / 收回 → 404 ───────────────────────────────────────── */

const expiredPage = await get(`/r/${expired.token}`)
check('2a 过期链接 → 404', expiredPage.status === 404, `status=${expiredPage.status}`)
const revokedPage = await get(`/r/${revoked.token}`)
check('2b 收回之后 → 404', revokedPage.status === 404, `status=${revokedPage.status}`)

/* ── 判据 3：改一个字节 → 404 ────────────────────────────────────────── */

const tamperedPage = await get(`/r/${tampered}`)
check('3 改一个字节 → 404', tamperedPage.status === 404, `status=${tamperedPage.status}`)

/* ── 判据 4：没有任何写操作按钮 ──────────────────────────────────────── */

const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((m) =>
  htmlText(m[1] ?? '').trim(),
)
const WRITE_WORDS = /重画|重配|删除|编辑|再做|新建|发布|收回|分享|去书架|开始创作/
const writeButtons = buttons.filter((text) => WRITE_WORDS.test(text))
check('4a 页面上没有写操作按钮', writeButtons.length === 0, `按钮：${buttons.join(' / ')}`)
check('4b 没有指向工作台的链接', !/href="\/(home|shelf|create|character|voice|admin)"/.test(html))

/* ── 判据 5：零模型调用（events.jsonl 一个字节都不动） ───────────────── */

const eventsPath = join(bookDir, 'events.jsonl')
const before = await stat(eventsPath).catch(() => null)
// 再打开一次，给任何"顺手做点什么"的机会
await (await get(`/r/${live.token}`)).text()
const after = await stat(eventsPath).catch(() => null)
check(
  '5 打开分享页不写事件日志（零模型调用）',
  (before?.size ?? 0) === (after?.size ?? 0) && (before?.mtimeMs ?? 0) === (after?.mtimeMs ?? 0),
  `size ${before?.size ?? '?'} → ${after?.size ?? '?'}`,
)

/* ── 这一层自己的两条边界 ────────────────────────────────────────────── */

const decoyAsset = await get(
  `/api/assets/books/${DECOY}/secret.png?share=${encodeURIComponent(live.token)}`,
)
check(
  '6a 同一张票读别的书 → 404（那个文件真的在盘上）',
  decoyAsset.status === 404,
  `status=${decoyAsset.status}`,
)

const noTicketPath = assetPath.replace(/([?&])share=[^&]*/g, '').replace(/[?&]$/, '')
const noTicket = noTicketPath ? await get(noTicketPath) : null
check(
  '6b 不带票读同一张图 → 401',
  !!noTicket && noTicket.status === 401,
  `status=${noTicket?.status}`,
)

// ★ 制作底稿不是给孩子读的：book.json 里有每页 prompt 与统计，events.jsonl 有整轮内部事件。
//   第一版按目录放行，这两条都回 200（2026-10-29 复查抓出来的）。
const manifestViaShare = await get(
  `/api/assets/books/${BOOK}/book.json?share=${encodeURIComponent(live.token)}`,
)
check(
  '6c 同一张票读 book.json → 404',
  manifestViaShare.status === 404,
  `status=${manifestViaShare.status}`,
)
const eventsViaShare = await get(
  `/api/assets/books/${BOOK}/events.jsonl?share=${encodeURIComponent(live.token)}`,
)
check(
  '6d 同一张票读 events.jsonl → 404',
  eventsViaShare.status === 404,
  `status=${eventsViaShare.status}`,
)

/* ── 收尾 ────────────────────────────────────────────────────────────── */

const recordHash = hashShareToken(live.token)
console.log(`\n分享链接：${BASE}/r/${live.token}`)
console.log(`记录文件：${join(ROOT, 'u', USER, sharePathOf(recordHash))}`)
console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 条没过。`)
process.exit(failures === 0 ? 0 : 1)
