/**
 * chk-shared-reader.mjs —— 共读版阅读器的验收（工单 04 那张验收表，机械化）
 *
 * ```bash
 * node scripts/chk-shared-reader.mjs [http://127.0.0.1:3000] [.out/shared-reader.png]
 * ```
 *
 * 前置：盘上要有**两本共读版**的演示书（一本正常、一本缺一页图）。夹具这么造、跑完这么拆
 * （`public/demo/` 之外不进仓库）：
 *
 * ```bash
 * node scripts/mk-shared-fixture.mjs
 * node scripts/mk-shared-fixture.mjs --missing
 * node scripts/mk-shared-fixture.mjs --clean
 * ```
 *
 * ★ 为什么必须直连 CDP、不能只在预览面板里点：**那个面板把 rAF 冻住了**
 *   （`preview-pane-hidden-freezes-raf-and-transitions` 那条记过），于是翻页补间一步都不走、
 *   `settled` 永远为假、选择点永远不浮出来——而这一屏要验的恰好是"翻到选择点那一屏"。
 *   无头 Chrome 有真帧，所以下面每一条判据都是真跑出来的。
 *
 * 判据分两类，两类都**只有真做才会不同**：
 *
 * | 类   | 量什么                              | 错了会怎样                         |
 * | ---- | ----------------------------------- | ---------------------------------- |
 * | 网络 | 请求过的资产 URL 集合（`Network.*`） | 走不到的支被读出来 → 出现它的图/音  |
 * | 屏幕 | 底栏读数、正文、按下态、控件几何     | 两条支连着读 / 页码报成资产编号     |
 *
 * ★ 那本夹具的两支页号是**交错**的（a 支第 4 页、b 支第 5–6 页），所以"平铺顺序"
 *   `1,2,3,4,5,6` 与任何一条路都不同：走 b 支时 **page-4 一次都不许出现**。
 *   要是被读成"两支连着读"，network 里立刻多出 page-4.webp —— 那是活的证据，
 *   而它正是"阅读顺序必须是那条路"这条唯一能自动判别的地方。
 * ★ 两本夹具的页名是**一样**的，所以资产按书号分开收：混在一起"是谁请求的"就分不清了。
 *
 * ★ 音频**不会自己下**（`preload="none"`，按一下才播），所以"音频也没被请求"这条
 *   要**按一下朗读**才算数：不按的话两边都是零，那是一条没有判别力的断言。
 */
import { spawn } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const positional = args.filter((item) => !item.startsWith('--'))
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = (positional[0] ?? 'http://127.0.0.1:3000').replace(/\/+$/, '')
const SHOT = positional[1] ?? null
const BOOK = flag('book', 'xzj-shared-verify')
/** 缺图那一本：同一棵树，第 5 页的图没出成（见 `mk-shared-fixture.mjs --missing`） */
const MISSING_BOOK = flag('missing-book', 'xzj-shared-missing')
const PORT = Number(flag('port', '9347'))
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const PROFILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'chrome-shared')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
}

/**
 * ★ **每次从干净的 profile 开始**（2026-10-18 加，工单 07 落地那天）。
 *
 * 这台阅读器现在会**记住孩子选了哪一支**（`lib/reading-path.ts`，`localStorage`），
 * 而 profile 是复用的——上一趟留下的 `'a'` 会让这一趟一开始就"已经选过"：
 * 选择点上已经按着一颗、`›` 也没被挡住，于是这个脚本里那些"第一次站上岔口"的
 * 判据从此**验的是另一件事，而它照样全绿**。跑一次的脚本不能依赖上一次的残留。
 */
await rm(PROFILE, { recursive: true, force: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  // 朗读那一按要真的去取音频：无头 Chrome 里"没人点过"的判断容易把播放拦掉
  '--autoplay-policy=no-user-gesture-required',
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

/* ── 网络：只记这一本书的资产，逐条留下来（"一次都没被请求"要能指着看） ───────── */

/**
 * 请求过的资产，**按书分开收**。
 *
 * ★ **累计**（不复位）：判据是"到这一刻为止请求过哪些"，复位会把"早就取过"读成"没取"。
 * ★ 按书分开是必须的：两本夹具的页名一模一样（`page-5.webp`），混在一个数组里
 *   "到底是谁请求的"就分不出来了——而这两本书要判的恰好是同一批名字。
 */
const requestedByBook = new Map()
const mineOf = (bookId) => {
  if (!requestedByBook.has(bookId)) requestedByBook.set(bookId, [])
  return requestedByBook.get(bookId)
}
const urlOf = new Map()
/** 404 / 断连的资产，带书号记下来（`Network.responseReceived` 只看得到状态码，看不到是哪本书） */
const failedAssets = []
/**
 * 这一趟碰过的 `/api/` 请求（方法 + 路径）。
 * ★ 它要判的是工单验收表那条"选完**零出图 / 零 TTS 调用**"：阅读器是**只读**的一屏，
 *   全程只该有 GET（`/api/auth/me` 那种），写接口（建书 / 出图 / 改故事 / 发布）**一次都不许碰**。
 *   判据取"到这一刻为止没出现过非 GET 的 `/api/` 请求"——只有真做（真跑了出图）才会不同。
 */
const apiCalls = []
const exceptions = []
/**
 * 非本机的请求（应该**一条都没有**）：这是"断网演示"那条判据的机械版——
 * 演示书走的是 `public/demo/` 里的静态字节，整条路上不该出现任何外部主机。
 */
const foreign = []
/** 别人正在存盘的证据：HMR 一存就整页重载，那会让这一趟的判据全部失真（共享工作区） */
const reloads = []
await send('Network.enable')
await send('Runtime.enable')
await send('Log.enable')
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Network.requestWillBeSent') {
    const { url, method } = msg.params.request
    urlOf.set(msg.params.requestId, url)
    for (const bookId of [BOOK, MISSING_BOOK]) {
      const marker = `/demo/books/${bookId}/`
      if (url.includes(marker)) mineOf(bookId).push(url.slice(url.indexOf(marker) + marker.length))
    }
    if (url.includes('/api/')) apiCalls.push(`${method} ${url.slice(url.indexOf('/api/'))}`)
    if (url.includes('hot-update.json')) reloads.push(url.split('/').pop())
    // ★ **只碰本机**（2026-10-18 加，工单 08 §二 的"断网演示"那条判据）：
    //   这一屏（以及整条演示路径）一个外部主机都不许问。`data:` / `blob:` 是本页自己
    //   造出来的，不算外部。★ 只有真做才会不同——挂一个 CDN 字体、一个外链 audio、
    //   或者把出图地址写成一个绝对 URL，这一条当场就红，而那正是"断网演示"会碎的地方。
    if (!url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      foreign.push(url.slice(0, 120))
    }
  }
  if (msg.method === 'Network.responseReceived') {
    const { url, status } = msg.params.response
    if (url.includes('/demo/books/') && status >= 400) {
      failedAssets.push(`${status} ${url.replace(BASE, '')}`)
    }
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const details = msg.params.exceptionDetails
    exceptions.push(`${details.text}｜${details.exception?.description?.split('\n')[0] ?? ''}`)
  }
})

/** 底栏那行读数**只有页码那一段**（`<span class="reader__total">` 是它的兄弟） */
const readout = () =>
  evaluate(`document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() ?? null`)
const assets = (book = BOOK) => [...new Set(mineOf(book))].sort()
const has = (name, book = BOOK) => mineOf(book).includes(name)

async function waitFor(expression, ms = 8000, step = 150) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await evaluate(expression)) return true
    await sleep(step)
  }
  return false
}

/* ── 真鼠标点击：命中测试也一起过（不能只 `element.click()`）────────────────── */

async function clickAt(selector) {
  const box = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!box) return false
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    })
  }
  return true
}

/** 翻到某一屏（等**页码那一段**变成它为止——补间走完才算到位，这不是 sleep 能代替的） */
async function flipTo(label, times = 4) {
  const seen = []
  for (let i = 0; i < times; i += 1) {
    const now = await readout()
    seen.push(now)
    if (now === label) return true
    await clickAt('[aria-label="下一页"]')
    if (
      await waitFor(
        `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() === ${JSON.stringify(label)}`,
        5000,
      )
    )
      return true
  }
  console.log(`  （翻到 ${label} 没成，看到的是：${seen.join(' → ')}）`)
  return false
}

async function flipBack(times = 1) {
  for (let i = 0; i < times; i += 1) {
    const now = await readout()
    await clickAt('[aria-label="上一页"]')
    await waitFor(
      `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() !== ${JSON.stringify(now)}`,
      5000,
    )
  }
}

/**
 * ★ 等"落定"（`data-on`）再点：控件浮出来的那 0.34s 里 `pointer-events: none`、
 *   `visibility: hidden` —— 补间没停就点，一发会点到看不见的东西上、静默落空
 *   （首页那条 visibility 注记的同一个机制）。"元素在 DOM 里"不等于"点得动"。
 */
async function waitSettled(ms = 5000) {
  return waitFor(`!!document.querySelector('.book-choice[data-on]')`, ms)
}

const key = async (name, code, vk) => {
  await send('Page.bringToFront')
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: name,
    code,
    windowsVirtualKeyCode: vk,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: name,
    code,
    windowsVirtualKeyCode: vk,
  })
}
/**
 * 按一个键，**并说清是走哪条路按到的**。
 *
 * ★ 无头窗口默认没有 OS 焦点，`Input.dispatchKeyEvent` 会静静地什么都没发生
 *   （而鼠标点击照样有效——所以"点击都过了"证明不了键盘那条路）。
 *   所以：先派真键，读数没动就退回**在元素上派发一个 `KeyboardEvent`**，
 *   并把用的是哪一条写进结果里——那两种证据的强度不一样，不能混着报。
 */
async function pressUntil(name, vk, changed, ms = 1500) {
  await key(name, name, vk)
  if (await waitFor(changed, ms, 150)) return '真键盘事件'
  await evaluate(
    `document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, code: ${JSON.stringify(name)}, bubbles: true, cancelable: true })) ?? null`,
  )
  if (await waitFor(changed, ms, 150)) return '元素上派发的合成事件（无头窗口没有 OS 焦点）'
  return null
}

/** 底栏上有哪些钮（朗读那一条要按得到，先看清它在不在、可不可按） */
const barButtons = () =>
  evaluate(
    `[...document.querySelectorAll('.reader__bar button')].map((b) => b.textContent + (b.disabled ? '(禁用)' : ''))`,
  )

await send('Page.enable')
await send('Page.navigate', { url: `${BASE}/reader/${BOOK}` })
await sleep(2500)

/* ── 判据 0：这一屏是 React 接管了的（SSR 的 HTML 里没有 `__reactProps$`）──────── */

const hydrated = await evaluate(
  `(() => { const el = document.querySelector('.reader__stage'); return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$')) })()`,
)
check('React 已接管这一屏（不是一张静态纸）', hydrated === true)

/* ── 判据 1：还没选 —— 全表 6 页，屏幕上只有"到目前为止能读到的那些页" ─────────── */

const atCover = await evaluate(`(() => ({
  readout: document.querySelector('.reader__readout')?.textContent ?? null,
  total: document.querySelector('.reader__total')?.textContent ?? null,
  leaves: document.querySelectorAll('.reader__leaf').length,
}))()`)
check('封面：读数是「封面」', atCover.readout === '封面', JSON.stringify(atCover))
check(
  '封面：叶数 = 3 页 + 1（这条路走到选择点为止）',
  atCover.leaves === 4,
  `leaves=${atCover.leaves}`,
)
check(
  '没选之前不报"共多少页"（那个数取决于选哪支）',
  atCover.total === null,
  `total=${atCover.total}`,
)

/* ── 判据 2：翻到选择点那一屏，两颗按钮浮出来 ───────────────────────────────── */

const reached = await flipTo('第 3 页')
await waitFor(`!!document.querySelector('.book-choice[data-on]')`, 5000)
const choiceDom = await evaluate(`(() => {
  const box = document.querySelector('.book-choice')
  if (!box) return null
  const btns = [...box.querySelectorAll('.book-choice__btn')]
  const stage = document.querySelector('.reader__stage').getBoundingClientRect()
  const r = box.getBoundingClientRect()
  return {
    on: box.hasAttribute('data-on'),
    ask: box.querySelector('.book-choice__ask')?.textContent ?? null,
    labels: btns.map((b) => b.querySelector('.book-choice__label')?.textContent ?? null),
    arts: btns.map((b) => b.querySelector('.book-choice__art')?.getAttribute('src') ?? null),
    // ★ 有 src 不等于画得出来：404 的 img 是 naturalWidth === 0（碎图标）
    //（这段是塞在模板字符串里的，注释里不能写反引号）
    artLoaded: btns.map((b) => {
      const img = b.querySelector('.book-choice__art')
      return img ? img.complete && img.naturalWidth > 0 : null
    }),
    glyphs: btns.map((b) => b.querySelector('.book-choice__glyph')?.textContent ?? null),
    pressed: btns.map((b) => b.getAttribute('aria-pressed')),
    speak: box.querySelector('.book-choice__speak')?.textContent ?? null,
    insideStage: r.top >= stage.top - 1 && r.bottom <= stage.bottom + 1,
    box: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
    stage: { top: Math.round(stage.top), bottom: Math.round(stage.bottom) },
  }
})()`)
check('翻到选择点那一屏', reached === true, `readout=${await readout()}`)
check(
  '★ 画面停住、两颗按钮**浮出来了**（`data-on` 只在落定之后才加）',
  choiceDom?.on === true,
  JSON.stringify(choiceDom?.on),
)
check('引导提问在按钮上方', choiceDom?.ask === '你想走哪一条？', `ask=${choiceDom?.ask}`)
check(
  '两颗按钮的文字 = 两个选项',
  JSON.stringify(choiceDom?.labels) === JSON.stringify(['恐龙的背', '小船的肚子']),
  JSON.stringify(choiceDom?.labels),
)
check(
  '★ 词表里有图的**真画出来了**（`naturalWidth > 0`），词表之外的露 emoji 兜底（不是碎图标）',
  choiceDom?.arts[0] === '/book/choice-dino.webp' &&
    choiceDom?.artLoaded[0] === true &&
    choiceDom?.arts[1] === null &&
    choiceDom?.glyphs[1] === '🛶',
  JSON.stringify({
    arts: choiceDom?.arts,
    artLoaded: choiceDom?.artLoaded,
    glyphs: choiceDom?.glyphs,
  }),
)
check(
  '三段音齐 → 给「念一遍」那颗钮',
  typeof choiceDom?.speak === 'string' && choiceDom.speak.includes('念一遍'),
  `speak=${choiceDom?.speak}`,
)
check(
  '★ 控件浮在**书的框内**（没跑到底栏上去，也没跑到书外面）',
  choiceDom?.insideStage === true,
  JSON.stringify({ box: choiceDom?.box, stage: choiceDom?.stage }),
)

/**
 * ★ 控件不许压住正文那一页的字。
 * 判据用 **Range 逐行矩形**而不是 `<p>` 的盒子：`<p>` 是块级，盒子一直拉到内边距
 *   结束，而那半截是透明渐变——拿盒子量会把"没挡住字"误报成"挡住了"。
 * ★ 而且**只量当前这一面**：挂图窗口内邻居页的面也在 DOM 里，它们的 `<p>` 也量得出矩形
 *   （只是转开的叶），一起算就成了一条永远不会绿的判据。
 *   定位办法：当前页的左半是唯一带 `role="img"` 的那一面（右半 `aria-hidden`）。
 */
const occlusion = await evaluate(`(() => {
  const card = document.querySelector('.book-choice')
  if (!card) return null
  const cr = card.getBoundingClientRect()
  const face = document
    .querySelector('[role="img"][aria-label="第 3 页的插画"]')
    ?.closest('.reader__face')
  const hits = []
  for (const p of (face?.querySelectorAll('.reader__text p') ?? [])) {
    const range = document.createRange()
    range.selectNodeContents(p)
    for (const r of range.getClientRects()) {
      const ox = Math.min(r.right, cr.right) - Math.max(r.left, cr.left)
      const oy = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top)
      if (ox > 1 && oy > 1) hits.push({ line: p.textContent.slice(0, 6), w: Math.round(ox), h: Math.round(oy) })
    }
  }
  return { hits, measured: (face?.querySelectorAll('.reader__text p') ?? []).length }
})()`)
check(
  '★ 控件一行正文都没压住（只量当前这一面，逐行量）',
  occlusion?.hits.length === 0 && occlusion?.measured > 0,
  JSON.stringify(occlusion),
)

/* ── 判据 3：★ 到这一步为止，走不到的那一支资产**一次都没被请求** ─────────────── */

check(
  '★ 走到选择点为止：只取过前 3 页的图，a 支的 page-4 一次都没有',
  has('page-1.webp') &&
    has('page-2.webp') &&
    has('page-3.webp') &&
    !has('page-4.webp') &&
    !has('page-5.webp') &&
    !has('page-6.webp'),
  assets().join(', '),
)

/* ── 判据 3b：选择点那三段音**合成一句话念**（按一下才播）────────────────────── */

await clickAt('.book-choice__speak')
const spoke = await waitFor(
  `document.querySelector('.book-choice__speak')?.textContent?.includes('正在念') === true`,
  4000,
)
/**
 * ★ 三段是**顺着念**的（提问 → 选项 A → 选项 B），每一段都有几秒长，
 *   所以判据要等**第三段**被取过，不能等一秒就下结论——
 *   等待时长本身就是这条判据的一部分（首页那条"只对四分之一能响的控件"的教训）。
 */
await waitFor(
  `[...document.querySelectorAll('audio')].some((a) => a.src.includes('opt-b.mp3'))`,
  40000,
  400,
)
check(
  '「念一遍」真的把三段音都取来念（提问 + 两个选项，按顺序）',
  has('ask.mp3') && has('opt-a.mp3') && has('opt-b.mp3'),
  `${spoke ? '按钮切到了"正在念"' : '★ 按钮没切到"正在念"'}；取过：${
    assets()
      .filter((n) => n.endsWith('.mp3'))
      .join(', ') || '没有 mp3'
  }`,
)
// 念到一半就去翻页会让媒体请求被掐断（ERR_ABORTED），那不是"资产坏了"——先停下来
await evaluate(`document.querySelectorAll('audio').forEach((a) => a.pause())`)

/* ── 判据 4：选 b 支 —— 屏幕上是 b 支的正文，a 支一次都不出现 ───────────────── */

const pickAt = (index) =>
  evaluate(`(() => {
  const el = document.querySelectorAll('.book-choice__btn')[${index}]
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)

async function pick(index) {
  const box = await pickAt(index)
  if (!box) return false
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    })
  }
  return true
}

await pick(1)
await waitFor(
  `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() === '第 4 页'`,
  6000,
)
const afterB = await evaluate(`(() => ({
  readout: document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() ?? null,
  total: document.querySelector('.reader__total')?.textContent ?? null,
  body: [...document.querySelectorAll('.reader__text p')].map((p) => p.textContent ?? '').join(''),
}))()`)
check(
  '选 b → 翻到那一支的第一页（第 4 屏）',
  afterB.readout === '第 4 页',
  `readout=${afterB.readout}`,
)
check('屏幕上是 b 支的正文（不是 a 支的）', afterB.body.includes('小船那条路'), afterB.body)
check(
  '总数说清是**这条路**的页数（b 支 5 页）',
  afterB.total === ' · 这条路共 5 页',
  `total=${afterB.total}`,
)

// b 支第 5 屏的朗读：按一下，音频才会真的去取（`preload="none"`）
// ★ 第 5 **屏** = 资产第 **6** 页（b 支的页号是 1,2,3,5,6）——这一条差一正是
//   "路径序号 ≠ 资产编号"，拿它当判据比拿 page-5 更狠：写成同一个数就红
await flipTo('第 5 页', 3)
const bar = await barButtons()
await clickAt('.reader__audio')
await waitFor(
  `[...document.querySelectorAll('audio')].some((a) => a.src.includes('page-6.mp3'))`,
  6000,
)
const bAssets = assets()
check(
  '★★ a 支的图与音频**一次都没被请求**（选 b 支、"念一遍"、再念一页之后都没有）',
  has('page-6.webp') && has('page-6.mp3') && !has('page-4.webp') && !has('page-4.mp3'),
  `底栏=${JSON.stringify(bar)}；取过：${bAssets.join(', ')}`,
)

/* ── 判据 5：回翻 → 按下态还在 → 改选 a 支 ──────────────────────────────────── */

await flipBack(2)
await waitSettled()
const back = await evaluate(`(() => ({
  readout: document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() ?? null,
  pressed: [...document.querySelectorAll('.book-choice__btn')].map((b) => b.getAttribute('aria-pressed')),
}))()`)
check('回翻到选择点那一屏', back.readout === '第 3 页', `readout=${back.readout}`)
check(
  '★ 按下态还在（刚才选的是 b 支）——"往回翻，按下态还在、可以改选"',
  back.pressed[0] === 'false' && back.pressed[1] === 'true',
  JSON.stringify(back.pressed),
)

await pick(0)
await waitFor(
  `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() === '第 4 页'`,
  6000,
)
const afterA = await evaluate(`(() => ({
  readout: document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() ?? null,
  total: document.querySelector('.reader__total')?.textContent ?? null,
  body: [...document.querySelectorAll('.reader__text p')].map((p) => p.textContent ?? '').join(''),
}))()`)
check('★ 改选 a 支：屏幕上换成 a 支的正文', afterA.body.includes('山脊'), afterA.body)
check('a 支这条路共 4 页', afterA.total === ' · 这条路共 4 页', `total=${afterA.total}`)
check('改选之后 a 支的图也取到了（真的换了那条路）', has('page-4.webp'), assets().join(', '))

/* ── 判据 6：键盘。容器内翻页；焦点在按钮上时 ← → 只换选项，不翻页 ────────────── */

await flipBack(1)
await waitSettled()
await evaluate(`document.querySelector('.reader__stage').focus()`)
const beforeKey = await readout()
const keyRoute = await pressUntil(
  'ArrowRight',
  39,
  `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() !== ${JSON.stringify(beforeKey)}`,
)
const afterKey = await readout()
check(
  '焦点在舞台上：→ 翻页',
  afterKey !== beforeKey,
  `${beforeKey} → ${afterKey}（${keyRoute ?? '★ 两条路都没动'}）`,
)
await flipBack(1)
await waitSettled()

/**
 * 焦点在第几颗按钮上。
 * ★ 判据用**下标**不用 `aria-pressed`：改选过之后"按着哪一颗"与"焦点在哪一颗"是两件事，
 *   拿按下态当焦点的判据会在"选过第一颗"那种情形下静默地恒真（第一版就是这么假过的）。
 */
const focusIndex = () =>
  evaluate(`[...document.querySelectorAll('.book-choice__btn')].indexOf(document.activeElement)`)

await evaluate(`document.querySelectorAll('.book-choice__btn')[0].focus()`)
const focusBefore = await focusIndex()
const focusRoute = await pressUntil(
  'ArrowRight',
  39,
  `[...document.querySelectorAll('.book-choice__btn')].indexOf(document.activeElement) === 1`,
)
const focusAfter = await focusIndex()
check(
  '焦点在第一颗上：→ 走到第二颗（原生 button + 这一层补的 ← →）',
  focusBefore === 0 && focusAfter === 1,
  `${focusBefore} → ${focusAfter}（${focusRoute ?? '★ 没动'}）`,
)
await pressUntil(
  'ArrowLeft',
  37,
  `[...document.querySelectorAll('.book-choice__btn')].indexOf(document.activeElement) === 0`,
)
check('焦点在第二颗上：← 走回第一颗', (await focusIndex()) === 0)

const readoutBeforeKey = await readout()
await pressUntil(
  'ArrowLeft',
  37,
  `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() !== ${JSON.stringify(readoutBeforeKey)}`,
  1200,
)
const readoutAfterKey = await readout()
check(
  '★ 焦点在按钮上时 ← → **一次都不翻页**（控件不在舞台子树里，事件到不了它）',
  readoutBeforeKey === readoutAfterKey,
  `${readoutBeforeKey} → ${readoutAfterKey}`,
)

/* ── 判据 7：截图 + 干净的控制台 ───────────────────────────────────────────── */

if (SHOT) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(resolve(SHOT), Buffer.from(shot.result.data, 'base64'))
  console.log(`\n截图：${resolve(SHOT)}`)
}
check('没有 JS 异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '))
/** 按书号筛：下面还要读缺图那一本，它的 404 是**另一条判据**（而且它一条都不许有） */
const badOf = (bookId) => failedAssets.filter((item) => item.includes(`/demo/books/${bookId}/`))
check(
  '这本书自己的资产没有一条取失败（404 / 断连）',
  badOf(BOOK).length === 0,
  badOf(BOOK).slice(0, 3).join(' | '),
)

/* ── 判据 8：静止模式（`prefers-reduced-motion`）——控件在场、有静止终态 ───────── */

await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
})
await send('Page.navigate', { url: `${BASE}/reader/${BOOK}` })
await sleep(2500)
console.log(
  `  （静止模式重进：${await evaluate(`document.querySelector('.reader')?.getAttribute('data-motion') ?? '★ 这一屏没渲染出来'`)}）`,
)
const stillReached = await flipTo('第 3 页')
const still = await waitFor(`!!document.querySelector('.book-choice[data-on]')`, 5000)
const stillDom = await evaluate(`(() => {
  const box = document.querySelector('.book-choice')
  if (!box) return null
  const cs = getComputedStyle(box)
  const stage = document.querySelector('.reader__stage').getBoundingClientRect()
  const r = box.getBoundingClientRect()
  return {
    reduced: document.querySelector('.reader')?.getAttribute('data-motion') ?? null,
    position: cs.position,
    transition: cs.transitionDuration,
    visible: cs.visibility,
    opacity: cs.opacity,
    centered: Math.abs(r.left + r.width / 2 - (stage.left + stage.width / 2)) < 2,
    inStage: r.top >= stage.top - 1 && r.bottom <= stage.bottom + 1,
  }
})()`)
check(
  '静止模式：这一屏认得出自己是静止模式（`data-motion="reduced"`）',
  stillDom?.reduced === 'reduced',
  JSON.stringify(stillDom?.reduced),
)
check(
  '静止模式：选择点**在场**（不是"不播动画就不出现"）',
  still === true &&
    stillReached === true &&
    stillDom?.visible === 'visible' &&
    stillDom?.opacity === '1',
  JSON.stringify({ visible: stillDom?.visible, opacity: stillDom?.opacity }),
)
check(
  '★ 静止模式：仍然浮在书上、仍然居中（首页那套"回到文档流"在这里被推翻掉了）',
  stillDom?.position === 'absolute' && stillDom?.centered === true && stillDom?.inStage === true,
  JSON.stringify({
    position: stillDom?.position,
    centered: stillDom?.centered,
    inStage: stillDom?.inStage,
  }),
)
check(
  '静止模式：没有过渡（终态是直接到的，不是"少了一点动画"）',
  stillDom?.transition === '0s',
  `transition=${stillDom?.transition}`,
)

/* ── 判据 9：缺图那一页仍走兜底纸（`Book.errors` 那条路在共读版里不受影响）────────
 *
 * 工单 04 验收表里那条「缺图那一页仍走兜底纸」。这一条**只有真做才会不同**的地方在
 * 两处，两处都量：
 *   ① 屏幕上出的是那张写清"这一页没做出来"的纸（不是裂图、不是空白页）；
 *   ② ★ 那次请求**根本没发生过**——模型说了这一页缺图，阅读器就不该去取一张死图。
 *      夹具把 `illustrations` 里第 5 页那一项**留着**（申报了没出成）而盘上没有那个文件，
 *      所以"要是它去取了"就会 404 落在 `failedAssets` 里 —— 两条判据互相独立。
 * ★ 顺带钉死"路径序号 ≠ 资产编号"：底栏报**第 4 页**（b 支第 4 屏），
 *   而那张纸上印的是**第 5 页**（资产编号）。一个屏幕上是两个不同的号。
 * ★ 音是**另一条轴**：这一页没图但配上了音，朗读钮照旧可用、照旧取得动 page-5.mp3
 *   （"音缺了这一页照样能读"与"图缺了这一页没法读"是两件事，不许合并）。
 */

await send('Emulation.setEmulatedMedia', { features: [] })
await send('Page.navigate', { url: `${BASE}/reader/${MISSING_BOOK}` })
await sleep(2500)
await flipTo('第 3 页')
await waitSettled()
await pick(1)
await waitFor(
  `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() === '第 4 页'`,
  6000,
)
const missingDom = await evaluate(`(() => {
  const paper = document.querySelector('.reader__missing')
  const r = paper?.getBoundingClientRect() ?? null
  // ★ 正文**只量这一面**：挂图窗口内邻居页的面也在 DOM 里（转开的叶），
  //   全页取会把"这一页的正文没了"读成绿的（遮挡那条判据踩过同一个坑）
  const face = paper?.closest('.reader__face')
  return {
    readout: document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() ?? null,
    total: document.querySelector('.reader__total')?.textContent ?? null,
    paper: paper ? paper.textContent : null,
    onScreen: !!r && r.width > 0 && r.height > 0,
    body: [...(face?.querySelectorAll('.reader__text p') ?? [])].map((p) => p.textContent ?? '').join(''),
    audio: document.querySelector('.reader__audio')?.disabled === false,
  }
})()`)
check(
  '★ 缺图那一页：兜底纸在场，写清"这一页没做出来"（不是裂图、不是空白页）',
  missingDom?.onScreen === true && (missingDom?.paper ?? '').includes('没做出来'),
  JSON.stringify({ paper: missingDom?.paper, onScreen: missingDom?.onScreen }),
)
check(
  '★ 同一屏上两个号不同：底栏报**第 4 屏**（这条路），纸上印的是**第 5 页**（资产编号）',
  missingDom?.readout === '第 4 页' && (missingDom?.paper ?? '').includes(`第 ${5} 页`),
  JSON.stringify({ readout: missingDom?.readout, paper: missingDom?.paper }),
)
check(
  '缺图那一页的正文照旧读得到（缺的是画，不是这一页；只量这一面）',
  (missingDom?.body ?? '').includes('小船那条路') && (missingDom?.body ?? '').length < 40,
  JSON.stringify({ 这一面的正文: missingDom?.body }),
)
check(
  '★★ 那张死图**一次都没被请求**（模型说它缺，就不该去取；取了一定 404）',
  !has('page-5.webp', MISSING_BOOK) && badOf(MISSING_BOOK).length === 0,
  `取过：${assets(MISSING_BOOK).join(', ') || '什么都没取'}；失败：${badOf(MISSING_BOOK).join(' | ') || '无'}`,
)
await clickAt('.reader__audio')
const heardMissing = await waitFor(
  `[...document.querySelectorAll('audio')].some((a) => a.src.includes('page-5.mp3'))`,
  6000,
)
check(
  '★ 缺图 ≠ 缺音：这一页配上了音，朗读钮照旧可用、照旧取得到 page-5.mp3',
  missingDom?.audio === true && heardMissing === true,
  JSON.stringify({ 钮可用: missingDom?.audio, 取到音: heardMissing }),
)
await evaluate(`document.querySelectorAll('audio').forEach((a) => a.pause())`)
if (SHOT) {
  // 第二张图落在同一目录：兜底纸长什么样，值得留一张（`…-choice.png` / `…-missing.png`）
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const path = resolve(SHOT.replace(/\.png$/, '') + '-missing.png')
  await writeFile(path, Buffer.from(shot.result.data, 'base64'))
  console.log(`缺图那一页的截图：${path}`)
}

/* ── 判据 10：选完**零出图 / 零 TTS 调用**（整趟只看，不只看选的那一下）────────── */

const apiWrites = apiCalls.filter((call) => !call.startsWith('GET '))
check(
  '★★ 阅读器全程只做 GET：建书 / 出图 / 改故事 / 发布那些写接口**一次都没被碰**',
  apiWrites.length === 0,
  `这一趟的 /api/ 请求：${apiCalls.length} 条${apiWrites.length ? `，其中写操作 ${apiWrites.join(' | ')}` : '，全是 GET'}`,
)

/* ── 判据 11：整条路上一个外部主机都没问（工单 08 §二 的"断网演示"） ───────────── */

check(
  '★★ 从头到尾只请求本机：演示这本书的字节全在盘上（断网也读得了）',
  foreign.length === 0,
  foreign.length ? `问到过外面：${[...new Set(foreign)].join(' | ')}` : '外部主机 0 次',
)

/* ── 收口 ──────────────────────────────────────────────────────────────────── */

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} 条通过`)
if (reloads.length > 0) {
  console.log(
    `★ 这一趟期间发生了 ${reloads.length} 次 HMR —— 有别的会话在存盘，共享工作区里这会让页面整页重载，`,
  )
  console.log('  上面那些"元素不在了"的失败要先按这一条排除。')
}
chrome.kill()
process.exit(failed.length === 0 ? 0 : 1)
