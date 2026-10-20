/**
 * chk-storybook-keys.mjs —— 首页那本书的 `← →` 到底归谁（2026-10-20）
 *
 * ```bash
 * node scripts/chk-storybook-keys.mjs http://127.0.0.1:3311
 * ```
 *
 * ── 修的是哪一条 ────────────────────────────────────────────────────────────
 *
 * `StorybookFlip` 原来在 `window` 上**无条件**接 ← →：滚到第三屏（亮点）按方向键，
 * 屏幕外那本书会默默翻一页，而 `preventDefault` 又把这两个键从浏览器手里抢走
 * ——整页的方向键都被锁在一本看不见的书里。这是"唯一一条会被评委当场看见的 bug"
 * （第三屏一度用自己那层的 `stopPropagation` 临时挡着，那半条随这次修复撤掉了）。
 *
 * 现在的判据是**视口中线落在这一节里**（`StorybookFlip` 的 `ownsArrowKeys`）：
 * 是这一屏才接管，不是就原样放行给浏览器（连 `preventDefault` 都不调）。
 *
 * ── 为什么直连 CDP、不进预览面板 ─────────────────────────────────────────────
 *
 * 那个面板把 rAF 与 transition 一起冻住（`preview-pane-hidden-freezes-raf-and-transitions`
 * 那条记过），而这一支量的一半正是"按下去之后页面有没有动"——在冻结的文档里，
 * "没动"与"页面卡住了"读出同一个数。同一条理由写在 `chk-mobile.mjs` /
 * `chk-reader-desk.mjs` / `chk-shared-reader.mjs` 头上。
 *
 * ── 十条断言 ───────────────────────────────────────────────────────────────
 *
 * 读数只有一个：**`.storybook__pager span` 的文本**（`封面` / `n / 4`）。
 * 它由 `page` 这个 React state 直接渲染，是"这本书现在翻到第几面"唯一一处
 * 说得出话的地方；它在动效模式下是 `display: none`（只有静止模式才显形），
 * 但 `textContent` 照样读得到——这里用它当**状态读数**，不是当可见性判据
 * （"在不在 DOM 里证明不了看得见"那条账说的是后者）。
 *
 * | #  | 量什么                                                 | 错了会怎样                                       |
 * | -- | ------------------------------------------------------ | ------------------------------------------------ |
 * | 1  | 书钉住那一屏按 → ：读数变（封面 → 1 / 4）              | 闸门恒关，键盘再也翻不动这本书（**正对照**）     |
 * | 2  | 同一处：事件被 `preventDefault`                        | 浏览器会同时把页面横向滚一格                     |
 * | 3  | 第三屏按 ← ：读数**不变**                              | **就是那条 bug**：屏幕外的书默默翻一页           |
 * | 4  | 第三屏按 ← ：`scrollY` 不动                            | 按一下方向键被弹回上一屏                         |
 * | 5  | 第三屏按 ← ：**没有**被 `preventDefault`               | 整页的方向键被锁死在书里                         |
 * | 6  | 接缝（书底边只露 20px）按 ← ：读数不变                 | 拿 IO 的 160px `rootMargin` 当判据就会在这里漏   |
 * | 7  | 静止模式（reduced）书本这一屏按 → ：读数**变**         | 拿"盖满视口"当判据，这一档会恒关（那档只有键+钮） |
 * | 8  | 静止模式：事件仍被 `preventDefault`                    | 这一档书自己接管的那半也没接上                   |
 * | 9  | 手机 390×844 亮点那一屏按 ← ：读数与 `scrollY` 都不动  | 手机那一档本节 `display: none`，本来就不该接键   |
 * | 10 | 第三屏焦点在轮播里按 ← ：轮播**倒**一条，书不翻        | 撤掉 `stopPropagation` 之后第三屏自己的键坏了    |
 *
 * ★ 判据 3/6/9 都**不可能"因为页面没反应"而假绿**：它们各自有一条会动的对照
 *   （判据 1 证明读数会变、判据 10 证明第三屏那一层自己会动），
 *   而且它们在修之前的那一版上**真的是红的**——那一次的读数记在
 *   `.scratch/tech-debt/issues/02-storybook-arrow-keys.md`。
 *
 * ★ 判据 2/5/8 用**同一条**读数（在 `window` 上后挂的监听器读 `e.defaultPrevented`：
 *   组件那个监听器挂得更早，所以它跑在前面，读到的就是它做过什么）。
 *   那是"键有没有被抢走"唯一能分辨出两种做法的量。
 * ★ 判据 10 用 `←` 而不是 `→`：第三屏那台轮播 2 秒一格的自动播**只会往前走**，
 *   所以"按 ← 之后倒了一条"这件事只有键盘做得到。（跑第一遍时这条判红，
 *   原因是判据忘了轮播是**环**——第 1 条往回是第 5 条，不是 0。判据按这一屏
 *   自己的规则算，不按直线轮播的直觉算。）
 *
 * ── 参数 ───────────────────────────────────────────────────────────────────
 *
 * 位置参数或 `--base=`：dev server 地址（默认 `http://127.0.0.1:3311`，
 * 也就是 `.claude/launch.json` 里那格 `session-isolated`）。
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const BASE = (argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:3311').replace(/\/$/, '')
const PORT = Number(flag('port', '9366'))
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE = resolve(ROOT, '.out', 'chrome-storybook-keys')

const VW = 1440
const VH = 900
/** 手机那一档（判据 8）。与 `storybook-flip.css` §8 那个断点同一档 */
const MOBILE = { w: 390, h: 844 }
/** 判据 6 的接缝：书底边在视口顶上露出这么多像素 */
const SEAM_PX = 20

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${PROFILE}`,
  `--window-size=${VW},${VH}`,
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
  const ex = res.result?.exceptionDetails
  if (ex) throw new Error(`页面里报错：${ex.text} ${ex.exception?.description ?? ''}`)
  return res.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')

/** 每次导航都重挂一遍（只是把数组清干净；监听器的顺序由 `armKeys` 每一次按键前保证） */
const installKeyLog = () =>
  evaluate(`(() => {
    if (window.__onKey) window.removeEventListener('keydown', window.__onKey)
    window.__keys = []
    window.__onKey = (e) => window.__keys.push({ key: e.key, prevented: e.defaultPrevented })
    window.addEventListener('keydown', window.__onKey)
    return 1
  })()`)

/**
 * **按键之前**把那条监听器重新挂一次。
 *
 * ★ 这一步不是洁癖，是判据 2/5/8 成立的前提：`defaultPrevented` 只有在
 *   **组件那个监听器已经跑过**之后才读得到，而"谁先跑"取决于注册顺序。
 *   组件是在 hydration 的 effect 里挂的，这个探针是在那之后挂的 ——
 *   但"之后"这件事**没法从外面验证**：第一遍跑的时候判据 8 就是这么红的
 *   （读数说 `prevented=false`，而同一轮的判据 7 明明翻页了 ——
 *   两个读数同时成立只可能是"我的监听器跑在前面"）。
 *   `remove` 再 `add` 把它挪到队尾，于是不管 hydration 是早是晚，
 *   **按下那一刻**它一定排在组件那条之后。
 */
const armKeys = () =>
  evaluate(`(() => {
    window.removeEventListener('keydown', window.__onKey)
    window.addEventListener('keydown', window.__onKey)
    return 1
  })()`)

/**
 * 等这一屏**真的 hydrate 完**再动手。
 *
 * ★ 判据是"`.storybook` 身上有没有 React 挂上去的 props 键"（`__reactProps$…`）：
 *   SSR 的 HTML 里元素本来就在，所以"元素在不在"证明不了已 hydrate
 *   （`ui-probe-clicks-land-before-hydration` 那条账）。
 * ★ 但它只证明 commit 过了，**不证明 effect 跑完了**（键盘监听挂在 effect 里），
 *   所以下面每条断言前面还会等一下；判据 1 本身也是这条的门 ——
 *   它要是红的，先怀疑没 hydrate 完，别先怀疑闸门。
 */
const waitHydrated = async () => {
  for (let i = 0; i < 80; i += 1) {
    const ok = await evaluate(
      `!!document.querySelector('.storybook') &&
       Object.keys(document.querySelector('.storybook')).some((k) => k.startsWith('__reactProps$'))`,
    )
    if (ok) return true
    await sleep(150)
  }
  return false
}

/** 书现在翻到第几面。★ 见文件头：这是状态读数，不是可见性判据 */
const readBook = () =>
  evaluate(`document.querySelector('.storybook__pager span')?.textContent?.trim() ?? null`)

/** 轮播现在是第几条（从那段 sr-only 的播报里读） */
const readHl = () =>
  evaluate(`(() => {
    const t = document.querySelector('.hl__sr-only')?.textContent ?? ''
    const m = t.match(/第\\s*(\\d+)\\s*条/)
    return m ? Number(m[1]) : null
  })()`)

/** 把某一节的顶边对到视口顶（并留一个像素修正量） */
const scrollToSection = (sel, delta = 0) =>
  evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    window.scrollTo(0, Math.round(el.getBoundingClientRect().top + window.scrollY) + ${delta})
    return Math.round(window.scrollY)
  })()`)

const scrollToY = (y) =>
  evaluate(`(window.scrollTo(0, ${Math.round(y)}), Math.round(window.scrollY))`)

const readY = () => evaluate('Math.round(window.scrollY)')

/** 等页面自己停下来（`goTo` 走的是 `behavior: 'smooth'`，要等它滚完） */
const settleScroll = async (maxMs = 2000) => {
  let last = -1
  let same = 0
  let waited = 0
  while (waited < maxMs) {
    const y = await readY()
    if (y === last) {
      same += 1
      if (same >= 3) return y
    } else {
      same = 0
      last = y
    }
    await sleep(60)
    waited += 60
  }
  return last
}

/** 真按键（`Input.dispatchKeyEvent`，不是页面里 `dispatchEvent` 的合成事件） */
const KEYS = {
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
}
const press = async (key) => {
  const { code, keyCode } = KEYS[key]
  await armKeys()
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    })
  }
}

/** 最后一次按键留下的记录（`installKeyLog` 收的） */
const lastKey = () => evaluate(`window.__keys?.[window.__keys.length - 1] ?? null`)

const setReduced = (value) =>
  send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }],
  })

const setViewport = (w, h, mobile) =>
  send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile,
  })

/** 导航 + 等 hydrate + 重挂按键记录 */
const open = async (path = '/') => {
  await send('Page.navigate', { url: `${BASE}${path}` })
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate('document.readyState === "complete"').catch(() => false)
    if (ready) break
    await sleep(150)
  }
  const hydrated = await waitHydrated()
  if (!hydrated)
    throw new Error('页面没有 hydrate（等不到 __reactProps$）—— 先看 dev server 活着没有')
  await installKeyLog()
  await sleep(300)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 1–2：书钉住那一屏 —— **正对照**，闸门必须开着
 * ══════════════════════════════════════════════════════════════════════════ */
await setReduced('no-preference')
await setViewport(VW, VH, false)
await open('/')

await scrollToSection('.storybook')
/* 书那一节一旦进视口，滚动驱动就开始写 `--story-p`（只在真跑起来之后才有）——
   拿它当"驱动已经在跑"的证据，比再等一会儿可靠。 */
let driven = false
for (let i = 0; i < 40; i += 1) {
  driven = await evaluate(
    `!!document.querySelector('.storybook__stage')?.style.getPropertyValue('--story-p')`,
  )
  if (driven) break
  await sleep(150)
}
console.log(`· 滚动驱动在跑：${driven ? '是' : '否（--story-p 一直没写）'}`)
await sleep(400)

const bookBefore = await readBook()
const yBefore = await readY()
await press('ArrowRight')
await settleScroll()
await sleep(450)
const bookAfter = await readBook()
const key1 = await lastKey()

check(
  '1 书钉住那一屏按 → ：翻页读数变了（正对照）',
  bookBefore !== bookAfter && !!bookBefore,
  `${bookBefore} → ${bookAfter}`,
)
check(
  '2 同一处：事件被 preventDefault（浏览器不许同时横向滚一格）',
  key1?.key === 'ArrowRight' && key1?.prevented === true,
  `keydown=${key1?.key} prevented=${key1?.prevented}`,
)
console.log(`· 书那一屏：按 → 之后 scrollY ${yBefore} → ${await readY()}`)

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 3–5：第三屏（亮点）—— **这一条 bug 本身**
 * ══════════════════════════════════════════════════════════════════════════ */
await scrollToSection('.hl')
await settleScroll()
await sleep(500)
const hlBookBefore = await readBook()
const hlYBefore = await readY()
await press('ArrowLeft')
await sleep(700)
const hlBookAfter = await readBook()
const hlYAfter = await readY()
const key2 = await lastKey()

check(
  '3 第三屏按 ← ：书不翻（bug 本体）',
  hlBookBefore === hlBookAfter,
  `读数 ${hlBookBefore} → ${hlBookAfter}（修之前这里会变成 "3 / 4"）`,
)
check(
  '4 第三屏按 ← ：scrollY 不动（没被弹回上一屏）',
  Math.abs(hlYAfter - hlYBefore) <= 4,
  `scrollY ${hlYBefore} → ${hlYAfter}`,
)
check(
  '5 第三屏按 ← ：没有 preventDefault（键还给浏览器）',
  key2?.key === 'ArrowLeft' && key2?.prevented === false,
  `keydown=${key2?.key} prevented=${key2?.prevented}`,
)

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 6：接缝 —— 书底边只露 20px
 *
 * 这一格是**给被否掉的那个写法留的**：要是拿 `useScrollDriver` 的
 * `onActiveChange`（IntersectionObserver，`rootMargin: '160px 0px'`）当判据，
 * 书滚出视口之后还有 160px 算"活跃"，而这一格正落在里面。
 * ══════════════════════════════════════════════════════════════════════════ */
const seamY = await evaluate(
  `Math.round(document.querySelector('.storybook').getBoundingClientRect().bottom + window.scrollY - ${SEAM_PX})`,
)
await scrollToY(seamY)
await settleScroll()
await sleep(400)
const seamGeo = await evaluate(`(() => {
  const r = document.querySelector('.storybook').getBoundingClientRect()
  const hl = document.querySelector('.hl').getBoundingClientRect()
  return { bookBottom: Math.round(r.bottom), bookTop: Math.round(r.top), hlTop: Math.round(hl.top) }
})()`)
const seamBefore = await readBook()
const seamYBefore = await readY()
await press('ArrowLeft')
await sleep(600)
check(
  '6 接缝（书底边只露 20px）按 ← ：书不翻',
  seamBefore === (await readBook()) && (await readY()) === seamYBefore,
  `书 rect ${seamGeo.bookTop}…${seamGeo.bookBottom} / 亮点顶 ${seamGeo.hlTop}，读数 ${seamBefore} → ${await readBook()}`,
)

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 7：静止模式（prefers-reduced-motion）
 *
 * 这一档本节是 `height: auto` 的普通一节（storybook-flip.css §7），
 * **永远盖不满视口** —— 所以它是"拿盖满视口当判据"那个写法的回归点：
 * 那么写的话，键盘用户在这一档会连 ← → 都按不动，而这一档只有按钮和键盘两样能翻页。
 * ══════════════════════════════════════════════════════════════════════════ */
await setReduced('reduce')
await open('/')
const reducedGeom = await evaluate(`(() => {
  const r = document.querySelector('.storybook').getBoundingClientRect()
  return {
    top: Math.round(r.top + window.scrollY),
    h: Math.round(r.height),
    vh: window.innerHeight,
    disp: getComputedStyle(document.querySelector('.storybook__pager')).display,
  }
})()`)
await scrollToY(reducedGeom.top + reducedGeom.h / 2 - reducedGeom.vh / 2)
await sleep(500)
const redBefore = await readBook()
const redYBefore = await readY()
await press('ArrowRight')
await sleep(500)
const redAfter = await readBook()
const key3 = await lastKey()
check(
  '7 静止模式下书本这一屏按 → ：照常翻页',
  redBefore !== redAfter && !!redBefore,
  `本节高 ${reducedGeom.h}px（视口 ${reducedGeom.vh}px，盖不满）× 翻页钮 ${reducedGeom.disp}：` +
    `读数 ${redBefore} → ${redAfter}，scrollY ${redYBefore} → ${await readY()}`,
)
check(
  '8 静止模式：事件仍被 preventDefault（这一档书自己接管）',
  key3?.prevented === true,
  `prevented=${key3?.prevented}`,
)

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 9：手机那一档 —— 本节 `display: none`，不该接键
 * （`storybook-flip.css` §8；首页在手机上只有两节，书那一节整节不出现）
 * ══════════════════════════════════════════════════════════════════════════ */
await setReduced('no-preference')
await setViewport(MOBILE.w, MOBILE.h, true)
await open('/')
const mobBookDisp = await evaluate(`getComputedStyle(document.querySelector('.storybook')).display`)
await scrollToSection('.hl')
await settleScroll()
await sleep(500)
const mobBefore = await readBook()
const mobYBefore = await readY()
await press('ArrowLeft')
await sleep(700)
const mobAfter = await readBook()
const mobYAfter = await readY()
check(
  '9 手机 390×844 亮点那一屏按 ← ：书不翻、页面不动',
  mobBefore === mobAfter && Math.abs(mobYAfter - mobYBefore) <= 4,
  `本节 display=${mobBookDisp}（要 none）· 读数 ${mobBefore} → ${mobAfter} · scrollY ${mobYBefore} → ${mobYAfter}`,
)

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 10：第三屏**自己**的键还在（撤掉 `stopPropagation` 之后）
 *
 * 用 ← 而不是 →：第三屏 2 秒一格的自动播只会往回不了的方向走，
 * 所以"按 ← 之后倒了一条"这件事**只有键盘做得到**（判别力在这一句上）。
 * ══════════════════════════════════════════════════════════════════════════ */
await setViewport(VW, VH, false)
await open('/')
await scrollToSection('.hl')
await settleScroll()
await sleep(400)
await evaluate(`(document.querySelector('.hl__viewport').focus({ preventScroll: true }), 1)`)
await sleep(300)
const hlN = await readHl()
const hlBookN = await readBook()
const hlY0 = await readY()
await press('ArrowLeft')
await sleep(450)
const hlN2 = await readHl()
await evaluate(`(document.querySelector('.hl__viewport').blur(), 1)`)
/* 轮播是**环**（`wrapActive`）：第 1 条再往回就是第 5 条，不是 0。
   第一版这里写成 `hlN - 1`，于是"从 1 倒回 5"这条**正确**的行为被判红 ——
   判据得按这一屏自己的规则算，不能按直线轮播的直觉算。 */
const HL_COUNT = 5
const hlWant = ((hlN - 2 + HL_COUNT) % HL_COUNT) + 1
check(
  '10 第三屏焦点在轮播里按 ← ：轮播倒一条，书不翻',
  hlN !== null && hlN2 === hlWant && hlBookN === (await readBook()) && (await readY()) === hlY0,
  `轮播 ${hlN} → ${hlN2} 条（要 ${hlWant}）· 书 ${hlBookN} → ${await readBook()} · scrollY ${hlY0} → ${await readY()}`,
)

/* ── 收尾 ──────────────────────────────────────────────────────────────── */
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 条通过`)
if (failed.length) {
  console.log('没过的：')
  for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` —— ${f.detail}` : ''}`)
}
ws.close()
chrome.kill()
process.exit(failed.length ? 1 : 0)
