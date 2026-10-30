/**
 * chk-print-pdf.mjs —— 「导出打印」这一件的判据（2026-10-29）
 *
 * ```bash
 * node scripts/chk-print-pdf.mjs --base=http://127.0.0.1:3311
 * ```
 *
 * 量的不是"页面上有没有那几张纸"，是**打印出来的那个 PDF**：
 * 纸的尺寸、页数、每页有没有图、字体有没有嵌进去、文件多大。
 *
 * ── 为什么直连 CDP ───────────────────────────────────────────────────────────
 *
 * 这一支要的东西浏览器面板给不了：`Page.printToPDF` 是 CDP 的方法，
 * 而预览面板里的文档在面板隐藏时连 rAF 都冻着（`preview-pane-hidden-*` 那条账）。
 * 同一条理由写在 `chk-mobile.mjs` / `chk-reader-desk.mjs` 头上。
 *
 * ── 判据 ─────────────────────────────────────────────────────────────────────
 *
 * | # | 量什么                                             | 错了会怎样                              |
 * | - | -------------------------------------------------- | --------------------------------------- |
 * | 1 | 屏幕上每张纸正好 297mm × 210mm（1122.5 × 793.7 px） | 预览不是成品：印出来会切边或缩排        |
 * | 2 | 打印媒体下顶栏 `display: none`                      | 顶栏占掉第一页，整本书错开一张          |
 * | 3 | 每张图都真的加载了（`naturalWidth > 0`）            | 印出来是空纸                            |
 * | 4 | PDF 页数 = 纸的张数                                 | 一张纸溢出到两页（210mm 的经典坑）      |
 * | 5 | 每页 MediaBox 是 A4 横向（842 × 595 pt）            | 竖版或 Letter，家长打印要手动缩放       |
 * | 6 | 每页都有图（除书名页，它本来就没有封面图）          | 图没进 PDF，只剩字                      |
 * | 7 | 字体真的嵌进去了（`/FontFile`）                     | 换台机器打开是方框——中文最常见的坏法    |
 * | 8 | 文件 < 20 MB                                        | 发不动、传不上                          |
 *
 * ★ 判据 4 是这一支里最容易假绿的一条：`Page.printToPDF` 会把**空白页**也如实印出来，
 *   而"页数对得上"正是那个 210mm 坑唯一会露出来的地方。第一版如果多出一页空纸，
 *   这里必须是红的。
 * ★ 判据 6 对书名页放行：`print-sheets.ts` 里书名页在没有封面时**照样占一张纸**
 *   （那是扉页，不是缺页），所以"每页都有图"这条只在有页图的那些纸上成立。
 *
 * ── 参数 ─────────────────────────────────────────────────────────────────────
 *
 * - `--base=`：dev server 地址，默认 `http://127.0.0.1:3311`（`.claude/launch.json` 的
 *   `session-isolated` 那一格）
 * - `--book=`：书号，默认仓库里那本预生成演示书（未登录也能打开）
 * - `--out=`：PDF 落在哪儿，默认 `.out/print-probe/book.pdf`
 */

import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readEnv } from './env.mts'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = (flag('base', 'http://127.0.0.1:3311') ?? '').replace(/\/$/, '')
const BOOK = flag('book', 'xiaoyu-r1-4fe055c5723b')
/**
 * 看的是**谁那一片**。给 `--user=` 时自己签一张会话票（机器上那把 `APP_JWT_SECRET`
 * 就够，不用起 Java 后端——`shelf-and-ssr-pages-verifiable-by-minted-ticket` 那条账）。
 * 不给就是匿名 + 那本随仓库提交的演示书。
 */
const USER = flag('user', '')
const OUT = resolve(flag('out', '.out/print-probe/book.pdf'))
const PORT = Number(flag('port', '9377'))
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE = resolve(ROOT, '.out', 'chrome-print-pdf')

/** 297mm / 210mm 在 96dpi 下的像素数（1in = 96px，1in = 25.4mm） */
const A4 = { w: (297 / 25.4) * 96, h: (210 / 25.4) * 96 }
/** A4 横向在 PostScript 点里的尺寸（1pt = 1/72in） */
const A4_PT = { w: (297 / 25.4) * 72, h: (210 / 25.4) * 72 }
const MAX_BYTES = 20 * 1024 * 1024

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
}

await rm(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1440,900',
  'about:blank',
])

async function target() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('Chrome 没起来')
}

const ws = new WebSocket(await target())
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
const send = (method, params = {}) =>
  new Promise((done) => {
    id += 1
    pending.set(id, done)
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  const ex = res.result?.exceptionDetails
  if (ex) throw new Error(`页面里报错：${ex.text} ${ex.exception?.description ?? ''}`)
  return res.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

/**
 * 自己签一张会话票塞进浏览器。
 *
 * ★ 与 `src/lib/auth/session.ts` 的 `verifyToken` 逐字同一种算法（HS256、三段 base64url、
 *   只认 `alg: 'HS256'`）。密钥从 `.env.local` 读——**dev server 用的也是那一份**，
 *   两边不一致的症状是"登录成功、下一个请求 401"（`isolated-backend-needs-shared-jwt-secret` 那条）。
 *
 * 只签 `scope: 'session'`：打印那一屏只问 `currentUserId()`，不问后端权限，
 *   所以这张票够用，也正好把"这一屏没有别的闸"这件事量出来。
 */
async function sessionCookie(userId) {
  const secret = (await readEnv()).APP_JWT_SECRET
  if (!secret) throw new Error('.env.local 里没有 APP_JWT_SECRET，签不了会话票')
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    sub: userId,
    acc: 'print-probe',
    role: 'user',
    scope: 'session',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

if (USER) {
  const value = await sessionCookie(USER)
  const set = await send('Network.setCookie', {
    name: 'xzj_session',
    value,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
  })
  check('探针自己签了一张会话票（不用 Java 后端）', set.result?.success === true, USER)
}

const url = `${BASE}/print/${BOOK}`
await send('Page.navigate', { url })

/** 等到"纸都铺开、图都落地"：纸的出现是服务端渲染的结果，图是网络结果 */
let ready = false
for (let i = 0; i < 120; i += 1) {
  ready = await evaluate(`(() => {
    const sheets = document.querySelectorAll('.print-sheet')
    if (sheets.length === 0) return false
    const images = Array.from(document.querySelectorAll('.print-book img'))
    return images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0)
  })()`)
  if (ready) break
  await sleep(250)
}
check('页面铺开了，所有页图都加载完', ready)

if (USER) {
  // 运行期的书才走 `?fmt=jpeg`（演示书是静态文件，查询串它不认，见 `book-source.ts`）
  const urls = await evaluate(
    `Array.from(document.querySelectorAll('.print-book img')).map((img) => img.getAttribute('src'))`,
  )
  check(
    '页图地址都带 fmt=jpeg',
    urls.length > 0 && urls.every((src) => String(src).includes('fmt=jpeg')),
    String(urls[0] ?? ''),
  )
}

const shape = await evaluate(`(() => {
  const sheets = Array.from(document.querySelectorAll('.print-sheet'))
  const boxes = sheets.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height } })
  return {
    count: sheets.length,
    boxes,
    images: Array.from(document.querySelectorAll('.print-book img')).map((img) => ({
      src: img.getAttribute('src'),
      nw: img.naturalWidth,
    })),
    coverHasImage: !!document.querySelector('.print-sheet--cover img'),
    sheetsWithImage: sheets.filter((el) => el.querySelector('img')).length,
  }
})()`)

const sizeOk = shape.boxes.every((box) => Math.abs(box.w - A4.w) < 2 && Math.abs(box.h - A4.h) < 2)
check(
  `每张纸正好 A4 横向（${A4.w.toFixed(1)} × ${A4.h.toFixed(1)} px，共 ${shape.count} 张）`,
  sizeOk,
  sizeOk ? '' : JSON.stringify(shape.boxes.slice(0, 3)),
)

/* 打印媒体下顶栏必须整个消失（`display: none`，不是可见性隐藏——后者仍占位） */ await send(
  'Emulation.setEmulatedMedia',
  { media: 'print' },
)
const printBar = await evaluate(
  `(() => { const el = document.querySelector('.print-page__bar'); return el ? getComputedStyle(el).display : 'missing' })()`,
)
await send('Emulation.setEmulatedMedia', { media: '' })
check('打印媒体下顶栏不占位（display: none）', printBar === 'none', `读到 ${printBar}`)

/* 打成 PDF */
const printed = await send('Page.printToPDF', {
  landscape: true,
  printBackground: true,
  preferCSSPageSize: true,
})
const base64 = printed.result?.data
if (!base64) {
  console.error('printToPDF 没回数据：', JSON.stringify(printed).slice(0, 400))
  process.exit(1)
}
const pdf = Buffer.from(base64, 'base64')
await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, pdf)
const bytes = (await stat(OUT)).size

/**
 * PDF 的极简读法：对象流没压缩时，页面是 `/Type /Page`（`/Pages` 是目录）。
 * ★ 这一行判据只对 Chrome 自己的输出成立，换别家生成器就不作数——这一支量的正是 Chrome。
 */
const text = pdf.toString('latin1')
const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
check(
  `PDF 页数 = 纸的张数（${shape.count}）`,
  pageCount === shape.count,
  `PDF 里数到 ${pageCount} 页`,
)

const boxes = [
  ...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g),
]
const a4Ok =
  boxes.length > 0 &&
  boxes.every((match) => {
    const [x0, y0, x1, y1] = match.slice(1).map(Number)
    return (
      Math.abs(x1 - x0 - A4_PT.w) < 2 && Math.abs(y1 - y0 - A4_PT.h) < 2 && x0 === 0 && y0 === 0
    )
  })
check(
  '每页都是 A4 横向、无页边距（842 × 595 pt）',
  a4Ok,
  boxes.length === 0 ? '一个 MediaBox 都没读到' : `读到 ${boxes.length} 个`,
)

/**
 * PDF 里的图对象。★ 一张带透明的图在 PDF 里是**两个** `/Subtype /Image`：
 *   彩色那一层带 `/SMask`，外加一张 `/DeviceGray` 的蒙版。按 `/Subtype` 数会把一页数成两张
 *   （第一版就是这么错的：期望 3、读到 6）。所以只数**有颜色空间**的那些。
 */
const imageObjects = [...text.matchAll(/(\d+)\s+0\s+obj([\s\S]{0,400}?)(?:stream|endobj)/g)]
  .map((match) => match[2])
  .filter((head) => /\/Subtype\s*\/Image/.test(head))
const colorImages = imageObjects.filter((head) => !/\/ColorSpace\s*\/DeviceGray/.test(head))
check(
  `每张有图的纸都带一张图（期望 ${shape.sheetsWithImage}，读到 ${colorImages.length}）`,
  colorImages.length === shape.sheetsWithImage,
)

if (USER) {
  // 运行期的书走 `?fmt=jpeg` 那一档：图必须是 DCT（原样搬进 PDF），不是被重新无损压
  const dct = imageObjects.filter((head) => /\/Filter\s*\/DCTDecode/.test(head)).length
  check(
    `运行期的书走 JPEG 那一档（${dct} 张 DCTDecode）`,
    dct === shape.sheetsWithImage,
    '否则 20 页的书会压到 30 MB 上下',
  )
}

const embedded = /\/FontFile[23]?/.test(text)
check('字体嵌进去了（PDF 里有 FontFile）', embedded)

check(
  `文件 ${(bytes / 1024 / 1024).toFixed(2)} MB（上限 20 MB）`,
  bytes < MAX_BYTES,
  `${bytes} 字节`,
)

ws.close()
chrome.kill()

const failed = results.filter((one) => !one.ok)
console.log(`\n${results.length - failed.length} / ${results.length} 通过 · PDF 在 ${OUT}`)
process.exit(failed.length === 0 ? 0 : 1)
