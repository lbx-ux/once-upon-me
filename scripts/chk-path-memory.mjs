/**
 * chk-path-memory.mjs —— 路径记忆的验收（工单 07）
 *
 * ```bash
 * node scripts/mk-shared-fixture.mjs                 # 造《两条路》，跑完 --clean
 * node scripts/chk-path-memory.mjs [http://127.0.0.1:3000]
 * ```
 *
 * 要验的是**一句话**：选了 b，第二天再翻开同一本书，按下态还在、往下翻走的是 b 支。
 * 所以判据必须**跨一次真销毁**——这个脚本的做法是**把这个标签页关掉，另开一个**：
 * 新的 JS 上下文、新的 React 树，内存里什么都不剩。只改内存 state 的实现也能做到
 * "刷新前一致"，它过不了这一条。
 *
 * ★ 为什么直连 CDP 而不在预览面板里点：那个面板把 rAF 冻住
 *   （`preview-pane-hidden-freezes-raf-and-transitions` 那条记过），补间一步都不走、
 *   选择点永远不浮出来——而"按下态还在不在"恰恰要在那一屏上读。
 *
 * 四趟，每趟的判据都**只有真做才会不同**：
 *
 * | 趟 | 干什么                               | 判据                                          |
 * | -- | ------------------------------------ | --------------------------------------------- |
 * | 1  | 真的按一次 b                         | 按下态落在 b；盘上留一个长度 1 的值 `'b'`      |
 * | 2  | **关掉标签页，另开一个**             | 没点过任何东西，b 已经按着，且翻页走 b 支      |
 * | 3  | `localStorage` 清掉之后再看          | 两颗都没按、`›` 按不动（= 没选过，不是"默认 a"）|
 * | 4  | 手写坏值（`'c'` / 半截 JSON / 别的书）| 同上：退回"没选过"，不抛、不锁死               |
 *
 * ★ **键名不写死在这个脚本里**：第 1 趟从 `localStorage` 里**找**出那个值是 `'b'` 的键
 *   （盘上只有它一个的值是单个字母），后面几趟拿它做实验。写死键名的话，改键名的那天
 *   这个脚本会从"验它"变成"验别的"——而它照样全绿。
 * ★ 第 2 趟另量两件旁证：`page-4.webp`（a 支那一页）**一次都没被请求**；
 *   底栏那个 `.reader__total` 在场（它只在"选过"时渲染，是 `blocked` 的另一个投影）。
 * ★ 夹具的页号是**交错**的（a 支第 4 页、b 支第 5–6 页），所以"走 b 支"与"按页号平铺"
 *   在网络上分得开——那是 `mk-shared-fixture.mjs` 刻意摆的形状。
 * ★ ★ 底栏那个「第 k 页」是**这条路上的第几屏**（工单 04 §三：k = 路径序号），
 *   所以**两条支翻到的下一屏都叫"第 4 页"**——它分不出走了哪一支。
 *   "走了 b 支"这件事只有网络里的字节分得出（取的是 page-5、不是 page-4）。
 *   这一条值得写下来：第一次跑这个脚本时，判据就是被它绊倒的（见工单 07 的"怎么验的"）。
 */
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const positional = args.filter((item) => !item.startsWith('--'))
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = (positional[0] ?? 'http://127.0.0.1:3000').replace(/\/+$/, '')
const BOOK = flag('book', 'xzj-shared-verify')
/** 另一本夹具的书号：只用来证明"别的书的选择不会串过来"（它不必真的在盘上） */
const OTHER_BOOK = flag('other-book', 'xzj-shared-missing')
const PORT = Number(flag('port', '9348'))
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE = resolve(ROOT, '.out', 'chrome-path')
const READER = `${BASE}/reader/${BOOK}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
}

/* ── 干净的开始：这个 profile 每次重建（上次留下的选择会让"没选过"那几趟失真） ── */

await rm(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1440,900',
  'about:blank',
])

/** 一条连接的收发。★ 后面每个标签页各有一条，账本也各记各的 */
function connect(socket) {
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  return (method, params = {}) =>
    new Promise((resolve) => {
      id += 1
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
}

async function fetchJson(path) {
  for (let i = 0; i < 60; i += 1) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}${path}`)).json()
    } catch {
      await sleep(250)
    }
  }
  throw new Error(`Chrome 没起来（${path}）`)
}

const version = await fetchJson('/json/version')
const browserSocket = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((r) => (browserSocket.onopen = r))
/** ★ 浏览器那一层只用来开/关标签页（`Target.*` 只有它认） */
const browserSend = connect(browserSocket)

const tabs = []

/**
 * 开一个**新标签页**并接上它。
 * ★ 先开 `about:blank`、接上、`Network.enable`，**最后**才导航过去——
 *   否则第一屏的资产请求在账本开始记之前就发出去了。
 */
async function openTab(label) {
  const created = await browserSend('Target.createTarget', { url: 'about:blank' })
  const targetId = created.result.targetId
  let socketUrl = null
  for (let i = 0; i < 40 && !socketUrl; i += 1) {
    const list = await fetchJson('/json')
    socketUrl = list.find((item) => item.id === targetId)?.webSocketDebuggerUrl ?? null
    if (!socketUrl) await sleep(100)
  }
  if (!socketUrl) throw new Error('新标签页没接上')

  const socket = new WebSocket(socketUrl)
  await new Promise((r) => (socket.onopen = r))
  const send = connect(socket)
  const tab = {
    label,
    targetId,
    assets: [],
    exceptions: [],
    reloads: [],
    send,
    async evaluate(expression) {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (res.result?.exceptionDetails) return { __error: res.result.exceptionDetails.text }
      return res.result?.result?.value
    },
    /** 导航过去并等它真的挂上（`ready` 按页面给） */
    async goto(url, ready) {
      await send('Page.navigate', { url })
      return waitFor(
        tab,
        ready ??
          `document.readyState === 'complete' && !!document.querySelector('.reader__readout')`,
        25000,
      )
    },
  }
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.method === 'Network.requestWillBeSent') {
      const { url } = msg.params.request
      const marker = `/demo/books/${BOOK}/`
      if (url.includes(marker)) tab.assets.push(url.slice(url.indexOf(marker) + marker.length))
      // ★ 别人正在存盘的证据（HMR 一存就整页重载，那会让这一趟的判据失真）
      if (url.includes('hot-update.json')) tab.reloads.push(url.split('/').pop())
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params.exceptionDetails
      tab.exceptions.push(
        `${details.text}｜${details.exception?.description?.split('\n')[0] ?? ''}`,
      )
    }
  })
  for (const method of ['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable']) {
    await send(method)
  }
  tabs.push(tab)
  return tab
}

async function waitFor(tab, expression, ms = 25000, step = 150) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await tab.evaluate(expression)) return true
    await sleep(step)
  }
  return false
}

async function clickBox(tab, box) {
  if (!box || box.__error) return false
  for (const type of ['mousePressed', 'mouseReleased']) {
    await tab.send('Input.dispatchMouseEvent', {
      type,
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    })
  }
  return true
}

/** 真鼠标点击（命中测试也一起过——`element.click()` 会绕过它，被盖住的按钮照样"通过"） */
const clickAt = (tab, selector) =>
  tab
    .evaluate(
      `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })()`,
    )
    .then((box) => clickBox(tab, box))

const readoutOf = (tab) =>
  tab.evaluate(
    `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() ?? null`,
  )
const pressedOf = (tab) =>
  tab.evaluate(
    `[...document.querySelectorAll('.book-choice__btn')].map((b) => b.getAttribute('aria-pressed'))`,
  )
const totalShown = (tab) => tab.evaluate(`!!document.querySelector('.reader__total')`)
/** `›` 按不动 = `qTarget >= maxTarget`（没选过时上界就卡在岔口那一屏） */
const nextDisabled = (tab) =>
  tab.evaluate(`document.querySelector('[aria-label="下一页"]')?.disabled ?? null`)

/**
 * 翻到某一屏。★ 等的是**页码那一段**变成它——补间走完才算到位，sleep 代替不了。
 */
async function flipTo(tab, label, times = 4) {
  const seen = []
  for (let i = 0; i < times; i += 1) {
    const now = await readoutOf(tab)
    seen.push(now)
    if (now === label) return true
    await clickAt(tab, '[aria-label="下一页"]')
    if (
      await waitFor(
        tab,
        `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() === ${JSON.stringify(label)}`,
        6000,
      )
    ) {
      return true
    }
  }
  console.log(`  （翻到 ${label} 没成，看到的是：${seen.join(' → ')}）`)
  return false
}

/**
 * 站到选择点那一屏（这一本夹具：选择点在第 3 页，a 支第 4 页，b 支第 5–6 页）。
 * ★ 还要等它**浮出来**（`data-on`）：那 0.34s 里控件 `pointer-events: none`，
 *   补间没停就点，一发会点到看不见的东西上、静默落空。
 */
async function standOnChoice(tab) {
  const reached = await flipTo(tab, '第 3 页')
  const settled = await waitFor(tab, `!!document.querySelector('.book-choice[data-on]')`, 6000)
  return reached && settled
}

const assetsOf = (tab) => [...new Set(tab.assets)].sort()

/* ── 第 1 趟：真的按一次 b ─────────────────────────────────────────────── */

console.log('\n趟 1 · 真的按一次 b（后面几趟的前提）')
const tab1 = await openTab('趟 1')
await tab1.goto(READER)

const arrived = await standOnChoice(tab1)
const before = await pressedOf(tab1)
check(
  '★ 第一趟：站在选择点上，两颗都没按（干净 profile = 从没选过）',
  arrived && before?.[0] === 'false' && before?.[1] === 'false',
  JSON.stringify(before),
)

const bBtn = await tab1.evaluate(`(() => {
  const el = document.querySelectorAll('.book-choice__btn')[1]
  const r = el?.getBoundingClientRect()
  return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null
})()`)
await clickBox(tab1, bBtn)
/* ★ 判据取**资产**，不取底栏那个数：底栏写的是"这条路上的第几屏"，
   而两条支的下一屏都是「第 4 页」（a 支那一页、b 支那一页，位置上算同一格）。
   所以"到底走了哪一支"只有网络里的字节分得出：取的是 page-5，绝不是 page-4。 */
const advanced = await waitFor(
  tab1,
  `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() === '第 4 页'`,
  6000,
)
const picks1 = assetsOf(tab1)
check(
  '★ 按下 b 之后：翻到了这条路的下一屏，而**取的是 b 支第一页的图**（page-5）',
  advanced && picks1.includes('page-5.webp') && !picks1.includes('page-4.webp'),
  `翻走了=${advanced}，取过的：${picks1.join(', ')}`,
)

// 回翻到岔口：按下态是"落在按钮上"的那一半（翻过去之后那一屏已经没有按钮了）
await clickAt(tab1, '[aria-label="上一页"]')
const backToChoice = await waitFor(
  tab1,
  `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() === '第 3 页'`,
  6000,
)
const pressedBack = backToChoice ? await pressedOf(tab1) : []
check(
  '★ 回翻到岔口：b 还按着（按下态真的落下了，不是只翻过去）',
  backToChoice && pressedBack?.[0] === 'false' && pressedBack?.[1] === 'true',
  `回到第 3 页=${backToChoice}，按下态=${JSON.stringify(pressedBack)}`,
)

const stored = await tab1.evaluate(`(() => {
  const hits = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    const value = key ? localStorage.getItem(key) : null
    if (value === 'a' || value === 'b') hits.push({ key, value, length: value.length })
  }
  return hits
})()`)
check(
  '★ 盘上留下的是**一个两字母的值**，而且键里带着书号（不是整条路径）',
  stored?.length === 1 &&
    stored[0].value === 'b' &&
    stored[0].length === 1 &&
    stored[0].key.includes(BOOK),
  JSON.stringify(stored),
)
const storedKey = stored?.[0]?.key ?? null

/* ── 第 2 趟：关掉标签页，另开一个（真销毁） ─────────────────────────────── */

console.log('\n趟 2 · 关掉这个标签页、另开一个（真销毁），回来看')
await browserSend('Target.closeTarget', { targetId: tab1.targetId })
await sleep(400)

const tab2 = await openTab('趟 2')
await tab2.goto(READER)
const arrived2 = await standOnChoice(tab2)
const restored = await pressedOf(tab2)
check(
  '★★ 真销毁之后回来：一根手指都没碰过，b 已经按着',
  arrived2 && restored?.[0] === 'false' && restored?.[1] === 'true',
  JSON.stringify(restored),
)
const total2 = await totalShown(tab2)
check(
  '★ 底栏那个「这条路共 N 页」也在（它只在"选过"时渲染）',
  total2 === true,
  `reader__total 在场=${total2}`,
)

const beforeFlip = await readoutOf(tab2)
await clickAt(tab2, '[aria-label="下一页"]')
const continuedOnB = await waitFor(
  tab2,
  `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() === '第 4 页'`,
  6000,
)
check(
  '★★ 从这一屏继续往下读，没被拦在岔口上（翻到了这条路的下一屏）',
  continuedOnB,
  `从 ${beforeFlip} 翻到了 ${await readoutOf(tab2)}`,
)
check(
  '★★ 走的是 b 支：取了 page-5 / page-6 的图，而 **a 支那一页（page-4）一次都没被请求**',
  assetsOf(tab2).includes('page-5.webp') && !assetsOf(tab2).includes('page-4.webp'),
  `这一趟取过的：${assetsOf(tab2).join(', ') || '（一张都没取）'}`,
)
check('这一趟没有页面异常', tab2.exceptions.length === 0, tab2.exceptions.join('｜'))

/* ── 第 3、4 趟：清了 / 坏了 / 串了 —— 每一种都要退回"没选过" ───────────── */

console.log('\n趟 3–4 · 清了 / 坏了 / 串了 —— 每一种都要退回"没选过"')
if (!storedKey) {
  check('★ 第 1 趟没找到那个键，后面几趟没法验（键名改了？）', false)
} else {
  const otherKey = storedKey.replace(BOOK, OTHER_BOOK)
  const cases = [
    { label: 'localStorage 清掉之后', seed: null },
    { label: "坏值 'c'（认不出来的字面量）", seed: 'c' },
    { label: '坏值 {"via":"a"（半截 JSON）', seed: '{"via":"a"' },
    { label: '别的书选了 b（键带书号，不该串过来）', seed: null, other: 'b' },
  ]

  /** 一个只用来写盘的原点页（`about:blank` 碰不到这个源的存储） */
  const seeder = await openTab('写盘')
  await seeder.goto(`${BASE}/`)
  const reader = await openTab('趟 3–4')

  for (const one of cases) {
    await seeder.evaluate(`localStorage.clear()`)
    if (one.seed !== null) {
      await seeder.evaluate(
        `localStorage.setItem(${JSON.stringify(storedKey)}, ${JSON.stringify(one.seed)})`,
      )
    }
    if (one.other) {
      await seeder.evaluate(
        `localStorage.setItem(${JSON.stringify(otherKey)}, ${JSON.stringify(one.other)})`,
      )
    }
    await reader.goto(READER)
    const there = await standOnChoice(reader)
    const pressed = await pressedOf(reader)
    const total = await totalShown(reader)
    check(
      `★ ${one.label}：两颗都没按，也没有「共 N 页」（= 没选过）`,
      there && pressed?.[0] === 'false' && pressed?.[1] === 'false' && total === false,
      `按下态=${JSON.stringify(pressed)}，total=${total}`,
    )

    // "照旧能读"：这一屏的正文还在；而 `›` **按不动**（没选过就该停在岔口上）
    const body = await reader.evaluate(
      `(document.querySelector('.reader__text')?.textContent ?? '').trim().length`,
    )
    const blocked = await nextDisabled(reader)
    check(
      `★ ${one.label}：正文照旧读得到（${body} 个字），而 \`›\` 按不动`,
      typeof body === 'number' && body > 0 && blocked === true,
      `下一颗按钮 disabled=${blocked}`,
    )
  }
  check(
    '这几趟一次异常都没有（坏值不许把这一屏弄崩）',
    reader.exceptions.length === 0,
    reader.exceptions.join('｜'),
  )
}

/* ── 收尾 ──────────────────────────────────────────────────────────────── */

const failed = results.filter((one) => !one.ok)
console.log(`\n${results.length - failed.length}/${results.length} 条通过`)
if (failed.length > 0) console.log(`红的是：${failed.map((one) => one.label).join('；')}`)
const reloaded = tabs.filter((tab) => tab.reloads.length > 0)
if (reloaded.length > 0) {
  console.log(
    `★ 有 HMR 重载（别的会话在存盘）：${reloaded.map((tab) => tab.label).join('、')}` +
      ' —— 多步流程可能被打断，先按这一条排除再查代码',
  )
}

chrome.kill()
process.exit(failed.length === 0 ? 0 : 1)
