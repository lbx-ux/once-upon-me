/**
 * chk-shelf-draft.mjs —— 「正在编辑」那一栏的验收（2026-10-16）
 *
 * 用法（先起一个 dev server）：
 *
 * ```bash
 * node scripts/chk-shelf-draft.mjs http://127.0.0.1:3321 .out/shelf-draft.png
 * ```
 *
 * 用户的原话："用户点击退出之后，这个待编辑就放到书架上，状态设为正在编辑，
 * 然后用户可以选择是删除还是制作为绘本；书架应该增加一栏，用于存放编辑的书籍。"
 * 于是这一栏要兑现三件事，脚本逐条量：
 *
 * 1. **它在那儿，而且说得出自己是干什么的**（标题「正在编辑」+ 一行说明）。
 * 2. **一张卡上三个出口**：整张卡去 `/create?book=`（继续编辑）、「制作为绘本」、「删除」。
 * 3. ★ **「制作为绘本」真的写盘了**——判据不是"按钮变了"，而是**盘上那份 `book.json`
 *    的 `status` 从 `draft` 变成了 `published`**，而且刷新之后它离开了这一栏。
 *    只有真打那个接口才会不同（`POST /api/books/<id>/publish`），这是这一条的性质。
 *
 * ★ 它**自己造一本草稿来验**（真跑一本要 Key、要几分钟、还要花钱，而这里要验的是界面与
 *   那一个接口），造的是 `chk-draft-fixture` **这个名字固定**的假书，跑完删掉它。
 *   所以：**别在你想留着的资产根上跑第二遍**——第一件事就是删掉同名的那一本。
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const positional = args.filter((item) => !item.startsWith('--'))
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const base = (positional[0] ?? 'http://127.0.0.1:3321').replace(/\/+$/, '')
const OUT = positional[1] ?? null
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const PORT = Number(flag('port', '9340'))
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_ID = 'chk-draft-fixture'
const BOOK_DIR = resolve(REPO, '.out/web/books', FIXTURE_ID)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 一本最小的草稿。字段只给书架真读的那几个（`library.ts` 的 `summarize`） */
const fixture = {
  schemaVersion: 1,
  bookId: FIXTURE_ID,
  cardId: 'xiaoyu-r1',
  form: 'solo',
  status: 'draft',
  createdAt: Date.now(),
  tree: {
    title: '验收用的草稿（跑完就删）',
    nodes: [1, 2, 3].map((pageNo) => ({
      nodeId: `n${pageNo}`,
      pageNo,
      scene: `第 ${pageNo} 幕`,
      body: [`第 ${pageNo} 页的正文。`],
      imagePrompt: '测试',
      mood: 'calm',
      next: [],
      pathFromRoot: [`n${pageNo}`],
    })),
  },
  illustrations: [],
  narrations: [],
}

// 先清掉同名的那一本（跑第二遍时它会以成品的样子留着）
await rm(BOOK_DIR, { recursive: true, force: true })
await mkdir(BOOK_DIR, { recursive: true })
await writeFile(resolve(BOOK_DIR, 'book.json'), JSON.stringify(fixture, null, 2), 'utf8')
console.log(`造了一本草稿：${FIXTURE_ID}\n`)

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${resolve(REPO, '.out/chrome-shelf')}`,
  '--window-size=1440,900',
  'about:blank',
])

async function target() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = list.find((t) => t.type === 'page')
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
  new Promise((resolve) => {
    id += 1
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.result?.exceptionDetails) return { __error: res.result.exceptionDetails.text }
  return res.result?.result?.value
}

const errors = []
const network = []
await send('Log.enable')
await send('Runtime.enable')
await send('Network.enable')
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Network.responseReceived' && msg.params.response.url.includes('/api/books')) {
    network.push(`${msg.params.response.status} ${msg.params.response.url.replace(base, '')}`)
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(msg.params.entry.text)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.text)
  }
})

const readRow = () =>
  evaluate(`(() => {
  const section = document.querySelector('.shelf__drafts')
  const card = section?.querySelector('.shelf__draft')
  return {
    有这一栏: !!section,
    标题: section?.querySelector('.shelf__drafts-title')?.textContent?.trim() ?? '',
    说明: section?.querySelector('.shelf__drafts-hint')?.textContent?.trim() ?? '',
    // ★ 判据要**按本**看，不能只问"这一栏在不在"：栏里可能还有别的书（真书），
    //   于是"刷新之后它离开了这一栏"会被一个不相干的邻居答成"还在"——第一版就是这么误报的
    这一栏里的书: [...document.querySelectorAll('.shelf__draft .shelf__name')].map((n) => n.textContent.trim()),
    卡里的书名: card?.querySelector('.shelf__name')?.textContent?.trim() ?? null,
    卡上的状态句: card?.querySelector('.shelf__meta')?.textContent?.trim() ?? null,
    去继续编辑的地址: card?.querySelector('.shelf__draft-open')?.getAttribute('href') ?? null,
    按钮: [...(card?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()),
    成品架上的书: [...document.querySelectorAll('.shelf__rack .shelf__name')].map((n) => n.textContent.trim()),
  }
})()`)

await send('Page.enable')
await send('Page.navigate', { url: `${base}/shelf` })
for (let i = 0; i < 30; i += 1) {
  await sleep(700)
  if ((await evaluate(`!!document.querySelector('.shelf__drafts')`)) === true) break
}

const before = await readRow()
console.log('这一栏长这样：', JSON.stringify(before, null, 2))

if (OUT) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
  console.log('截图：', OUT)
}

/* ── 点「制作为绘本」，判据是**盘上那个字段** ───────────────────────────── */

/**
 * ★ **点一下可能落空**：这一屏是客户端组件，SSR 的那份 HTML 里按钮就在，
 *   所以"元素在不在"区分不出"已经 hydrate"与"还是一张静态纸"——hydrate 之前
 *   `.click()` 什么都不触发（这已经是同一晚的第二个地方踩它了：
 *   `chk-run-motion.mjs` 在 `/home` 上也是这样）。所以这里**点-等-读盘**循环，
 *   以盘上那个字段为准。多点的几次无害：`POST /publish` 是幂等的（路由文件头第 2 条）。
 */
let published = false
for (let i = 0; i < 12 && !published; i += 1) {
  const clicked = await evaluate(
    `[...document.querySelectorAll('.shelf__draft button')].find((b) => b.textContent.includes('制作') && !b.disabled)?.click() ?? null`,
  )
  void clicked
  await sleep(1500)
  try {
    published =
      JSON.parse(await readFile(resolve(BOOK_DIR, 'book.json'), 'utf8')).status === 'published'
  } catch {
    published = false
  }
}

const onDisk = JSON.parse(await readFile(resolve(BOOK_DIR, 'book.json'), 'utf8'))
console.log(`\n盘上那份的 status：${onDisk.status}`)

await evaluate(`location.reload()`)
await sleep(4000)
const after = await readRow()
console.log('刷新之后：', JSON.stringify(after))
console.log('网络：', network.length === 0 ? '（没记到 /api/books）' : network)
console.log('页里的错误：', errors.length === 0 ? '没有 ✓' : errors)

const TITLE = fixture.tree.title
console.log('\n判据小结（自己看）：')
console.log(`  那一栏在、标题是「正在编辑」：${before.标题 === '正在编辑' ? '是 ✓' : '★ 不是'}`)
console.log(`  卡上三个出口：${JSON.stringify(before.按钮)} + 链接 ${before.去继续编辑的地址}`)
console.log(`  制作为绘本真的写了盘：${onDisk.status === 'published' ? '是 ✓' : '★ 没有'}`)
console.log(
  `  刷新之后那一本离开了这一栏：${after.这一栏里的书.includes(TITLE) ? '★ 还在' : '是 ✓'}` +
    `（栏里现在还有：${after.这一栏里的书.join(' / ') || '没有了'}）`,
)
console.log(`  它出现在成品架上了：${after.成品架上的书.includes(TITLE) ? '是 ✓' : '★ 没有'}`)

await rm(BOOK_DIR, { recursive: true, force: true })
console.log(`\n清掉了那一本假书（${FIXTURE_ID}）`)

ws.close()
chrome.kill()
process.exit(0)
