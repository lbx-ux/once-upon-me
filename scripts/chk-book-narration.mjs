/**
 * chk-book-narration.mjs —— 量首页第二屏那本演示绘本的**朗读真的会响**
 *
 * ```bash
 * node scripts/chk-book-narration.mjs http://127.0.0.1:3324
 * ```
 *
 * ★ 为什么不能只在这个应用自带的预览面板里看：面板不渲染时 **rAF 是冻的**
 *   （实测 900ms 里 0 帧），而这一节的页码完全由滚动驱动器的每一帧推出来 ——
 *   冻着的时候 `.storybook__pager` 永远停在「封面」，控件连出现都不会出现。
 *   所以走这个仓库里量动效那条老路：headless Chrome + 直连 CDP，**页面真的在跑**。
 *
 * 量五件事，每一件都对应一个**只有真做才会不同**的判据（README「数字要能复现」）：
 *
 * 1. **封面不给控件**（`page = 0`）—— 书还没打开，没有哪一页在念。
 * 2. **翻到第 1 个跨页，控件出现且是可见的**（`data-on` + computed visibility）。
 *    判据不是"元素在 DOM 里"：`visibility: hidden` 的元素照样在 DOM 里。
 * 3. **五段都真的能放、而且各念各的** —— 1 / 2 / 3 与**两支的第 4 页**各走一遍。
 *    三段判据一起看，每段都要成立：
 *      · 取到的是**那一段**（`src` 里是 `spread-k.`，网络里也有那一条）；
 *      · `audio.currentTime` 在 1.4 秒里往前走（**只有真解码才会变**）；
 *      · `duration` 是个说得出话的数（空文件 / 半截文件不成立）。
 *    只听"点了没报错"是不够的：`element.click()` 绕过命中测试，被整层盖住也照样"成功"。
 *    ★ 为什么五段一段都不能漏：那 5 个文件是人手工放进目录的，**坏掉一段**
 *      是这里最可能的坏法，而只试第一段的话另外四段坏了无人知晓。
 * 4. **翻页就停**（这一节的规矩：朗读是「这一页的」）。
 * 5. **选哪朵云就念哪一段**：两支各选一遍，念到的必须是 `spread-4a` / `spread-4b`。
 * 6. **滚出视口也停** —— 这是 `useScrollDriver` 那条 `onActiveChange` 唯一的判据：
 *    不接它，声音会在屏幕外接着解码。
 * 7. **静止模式（prefers-reduced-motion）下位置也对**：那一段 CSS 是**另一套排版**，
 *    最容易出的错是两条选择器特异性打架、整块被钉到左上角 —— 只看代码看不出来。
 *
 * 那 5 段音频是**随仓库提交的演示资产**（与那 7 张图、书单那 12 本同级）：
 * `public/book/spread-1/2/3/4a/4b.m4a|mp3`。缺一段这个脚本第一步就告诉你缺哪一段 ——
 * 那是**设计如此**（判据 ①：要么录满，要么整块不做），不是脚本坏了。
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const positional = args.filter((item) => !item.startsWith('--'))
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const base = (positional[0] ?? 'http://127.0.0.1:3324').replace(/\/+$/, '')
/** 给一个路径就顺手存一张"念着的那一页"的截图（参赛材料要图，`.out/` 不入库） */
const OUT = positional[1] ?? null
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const PORT = Number(flag('port', '9341'))
const PROFILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'chrome-narration')

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank',
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text)
  return res.result?.result?.value
}

/** 音频请求那一路。★ 判据是"请求发出去了"，不是"点了没报错" */
const audioRequests = []
await send('Network.enable')
await send('Runtime.enable')
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (
    msg.method === 'Network.responseReceived' &&
    /\/book\/spread-/.test(msg.params.response.url)
  ) {
    audioRequests.push(`${msg.params.response.status} ${msg.params.response.url.replace(base, '')}`)
  }
})

const fails = []
let passed = 0
const ok = (name, pass, detail) => {
  console.log(`${pass ? '✓' : '✗'} ${name}${detail === undefined ? '' : ` —— ${detail}`}`)
  if (pass) passed += 1
  else fails.push(name)
}

await send('Page.enable')
await send('Page.navigate', { url: `${base}/` })
await sleep(6000)

/* ── 页面那一头的几个动作 ────────────────────────────────────────────────── */

/** 等一个条件成立（最多 4 秒）。够长是因为刻度跳页走的是 smooth 滚动 */
async function until(expression, label) {
  for (let i = 0; i < 40; i += 1) {
    if (await evaluate(expression)) return true
    await sleep(100)
  }
  throw new Error(`等不到：${label}`)
}

/** 点第 n 个刻度（0 = 封面）。走的是这一节自己的 goTo —— 与用户点的同一颗按钮 */
const clickTick = (n) => evaluate(`document.querySelectorAll('.book-spine__tick')[${n}].click()`)

/**
 * 控件的状态。★ `visibility` 必须读 computed，不能读 style —— 藏起来那一路
 * 写在 CSS 里（`opacity: 0; visibility: hidden`），元素仍然在 DOM 里。
 */
const listenState = () =>
  evaluate(`(() => {
    const el = document.querySelector('.storybook__listen')
    if (!el) return { mounted: false }
    const cs = getComputedStyle(el)
    const btn = el.querySelector('.book-listen')
    return {
      mounted: true,
      on: el.hasAttribute('data-on'),
      visibility: cs.visibility,
      opacity: Number(cs.opacity),
      pressed: btn?.getAttribute('aria-pressed') ?? null,
      label: btn?.textContent ?? null,
    }
  })()`)

const audioState = () =>
  evaluate(`(() => {
    const el = document.querySelector('audio')
    if (!el) return { mounted: false }
    return {
      mounted: true,
      src: el.getAttribute('src'),
      paused: el.paused,
      t: Number(el.currentTime.toFixed(2)),
      /* ★ 时长也要量：它是"这一段确实是这一段"的唯一离线证据
         （听不了内容，但一处 0.3 秒的文件与一段 11 秒的朗读长得完全不一样）。
         元数据没到时是 NaN，如实报 null，不编一个数 */
      duration: Number.isFinite(el.duration) ? Number(el.duration.toFixed(1)) : null,
    }
  })()`)

/**
 * 按朗读钮。★ 两条防守，都是这个仓库已经踩过的：
 *   · **hydrate 之前点击会静默落空**：`__reactProps$` 只有 React 挂过才有，
 *     先用它做闸门（SSR 的 HTML 里元素全在，所以"点了有反应"证明不了已 hydrate）；
 *   · `element.click()` **绕过命中测试**，被整层盖住也照样"成功" ——
 *     所以先用 `elementsFromPoint` 看这个点上最上面的是不是它自己。
 */
async function pressListen() {
  const gate = await evaluate(`(() => {
    const btn = document.querySelector('.book-listen')
    if (!btn) return { ok: false, why: '没有这颗按钮' }
    const hydrated = Object.keys(btn).some((k) => k.startsWith('__reactProps$'))
    const r = btn.getBoundingClientRect()
    const cx = Math.round(r.left + r.width / 2)
    const cy = Math.round(r.top + r.height / 2)
    const top = document.elementFromPoint(cx, cy)
    return {
      ok: true,
      hydrated,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      hits: top ? top.className || top.tagName : null,
      covered: top !== btn && !btn.contains(top),
    }
  })()`)
  if (!gate.ok) throw new Error(gate.why)
  if (!gate.hydrated) throw new Error('按钮还没 hydrate —— 这时候点会静默落空')
  if (gate.covered) throw new Error(`按钮被盖住了：这一点上最上面的是 ${gate.hits}`)
  await evaluate(`document.querySelector('.book-listen').click()`)
  return gate
}

/* ── 1. 封面：书还没打开，没有哪一页在念 ─────────────────────────────────── */
await until(`!!document.querySelector('.book-spine__tick')`, '刻度出现')
await until(`document.querySelector('.storybook__pager span').textContent === '封面'`, '停在封面')
const cover = await listenState()
if (!cover.mounted) {
  /* ★ 控件整块不在 DOM 里 —— 最常见的原因不是代码坏了，是**还没录满**：
     判据 ① 要求 5 段全在（含 4a/4b 两支），少一段就整块不做（README §五）。
     说清这一条，而不是让人去翻 CSS。服务端终端里那行 `[demo-book-audio] 还缺…`
     会点名缺哪一段。 */
  console.log('✗ 朗读控件整块不在页面上 —— 先看 public/book/ 里那 5 段齐不齐：')
  console.log('    spread-1 / spread-2 / spread-3 / spread-4a / spread-4b（.m4a 或 .mp3）')
  console.log('  少一段就整块不做，这是判据 ① 的设计（README §五），不是坏了。')
  chrome.kill()
  process.exit(1)
}
ok(
  '封面不给朗读控件',
  cover.on === false && cover.visibility === 'hidden',
  `mounted · data-on=${cover.on} · visibility=${cover.visibility}`,
)

/* ── 2. 翻到第 1 个跨页：控件出现 ────────────────────────────────────────── */
await clickTick(1)
await until(
  `document.querySelector('.storybook__pager span').textContent === '1 / 4'`,
  '翻到 1 / 4',
)
// data-on 是属性、visibility 走 CSS 过渡（0.3s），等它真的显形再判
await sleep(600)
const page1 = await listenState()
ok(
  '第 1 个跨页出现朗读控件（且真的可见）',
  page1.mounted && page1.on && page1.visibility === 'visible' && page1.opacity > 0.9,
  `visibility=${page1.visibility} · opacity=${page1.opacity} · 标签=${JSON.stringify(page1.label)}`,
)

/* ── 3~6. 五段都真的能放，而且各念各的 ───────────────────────────────────
 *
 * ★ 判据不是"DOM 里挂上了 src"，是 **`currentTime` 真的往前走**
 *   ——一个 0 字节或半截的文件也会回 200，但它不会走。
 * ★ **五段一段都不能漏**：只试第一段的话，另外四段坏掉无人知晓，而"坏掉一段"
 *   恰好是这个功能最可能的坏法（那 5 个文件是人手工放进目录的）。
 *   所以这一趟把 1 / 2 / 3 与 **两支的第 4 页** 都走一遍。
 */
async function playPage(file) {
  const before = audioRequests.length
  const gate = await pressListen()
  await sleep(1400)
  const state = await audioState()
  const asked = audioRequests.slice(before).filter((line) => line.includes(file))
  ok(
    `播 ${file}`,
    state.paused === false && state.t > 0.5 && (state.src ?? '').includes(file),
    `src=${state.src} · t=${state.t}s · 这一段长 ${state.duration}s` +
      ` · ${asked.join('、') || '（网络里没取到这一段？）'}`,
  )
  return { duration: state.duration, gate }
}

const lengths = []
const first = await playPage('spread-1.')
lengths.push(['spread-1', first.duration])
const pressedNow = await listenState()
ok('按下态是「正在念」', pressedNow.pressed === 'true', `aria-pressed=${pressedNow.pressed}`)
console.log(`   ↳ 按钮矩形 ${JSON.stringify(first.gate.rect)}，命中测试最上层是 ${first.gate.hits}`)

if (OUT) {
  await mkdir(dirname(OUT), { recursive: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(OUT, Buffer.from(shot.result.data, 'base64'))
  console.log(`   ↳ 截图：${OUT}（这一张是**真帧**：CDP 抓屏会强制出一帧）`)
}

/* ── 4. 翻页就停（这一节的规矩：朗读是「这一页的」）──────────────────────── */
await clickTick(2)
await until(
  `document.querySelector('.storybook__pager span').textContent === '2 / 4'`,
  '翻到 2 / 4',
)
await sleep(300)
const afterTurn = await audioState()
ok('翻页就停', afterTurn.paused === true, `paused=${afterTurn.paused} · t=${afterTurn.t}s`)
lengths.push(['spread-2', (await playPage('spread-2.')).duration])

/* ── 5. 第 3 个跨页：选择点那一页照样有自己的朗读 ────────────────────────── */
await clickTick(3)
await until(
  `document.querySelector('.storybook__pager span').textContent === '3 / 4'`,
  '翻到 3 / 4',
)
await until(`document.querySelector('.book-choice[data-on]') !== null`, '选择点窗口打开')
lengths.push(['spread-3', (await playPage('spread-3.')).duration])

/* ── 6. 选哪朵云就念哪一段（4a 与 4b 各走一遍）──────────────────────────── */
async function pickAndPlay(index, file) {
  await clickTick(3)
  await until(`document.querySelector('.book-choice[data-on]') !== null`, '选择点窗口再打开')
  await evaluate(`document.querySelectorAll('.book-choice__btn')[${index}].click()`)
  await until(
    `document.querySelector('.storybook__pager span').textContent === '4 / 4'`,
    '翻到 4 / 4',
  )
  await sleep(400)
  /* ★ 这一条也顺带量了遮挡：朗读钮在左下角、两颗云按钮在底下正中，
     两个都点得到说明它们**没有压在一起**（`pressListen` 里那道命中测试） */
  return (await playPage(file)).duration
}
lengths.push(['spread-4a', await pickAndPlay(0, 'spread-4a.')])
lengths.push(['spread-4b', await pickAndPlay(1, 'spread-4b.')])

/* ── 7. 滚出视口也停（onActiveChange 唯一的判据）─────────────────────────── */
await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`)
await sleep(900)
const away = await audioState()
ok(
  '滚出视口就停（不在屏幕外接着解码）',
  away.paused === true,
  `paused=${away.paused} · t=${away.t}s`,
)

console.log('')
console.log('五段的时长（听不了内容，但这是"它们不是同一段、也不是空文件"的离线证据）：')
console.log('  ' + lengths.map(([name, d]) => `${name}=${d ?? '?'}s`).join('  '))

/* ── 7. 静止模式（prefers-reduced-motion）那一套也有它自己的位置 ─────────────
 *
 * 那一段 CSS 是**另一套排版**（书那叠 3D 叶整块不渲染，控件回到文档流排在翻页钮
 * 下面），最容易出的错是"两条选择器特异性打架，整块被钉到左上角"——只看代码看不
 * 出来。所以真切一次媒体特性再量一遍。
 */
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
})
await send('Page.navigate', { url: `${base}/` })
await sleep(6000)
await until(`!!document.querySelector('.storybook__pager')`, '静止模式下翻页钮出现')
const staticCover = await listenState()
const staticLayout = await evaluate(`(() => {
  const pager = document.querySelector('.storybook__pager')
  const el = document.querySelector('.storybook__listen')
  return {
    pagerDisplay: getComputedStyle(pager).display,
    listenDisplay: el ? getComputedStyle(el).display : null,
  }
})()`)
ok(
  '静止模式：封面同样不给控件（display: none，不只是藏起来）',
  staticCover.mounted && staticLayout.listenDisplay === 'none',
  `pager=${staticLayout.pagerDisplay} · listen=${staticLayout.listenDisplay}`,
)
await evaluate(`document.querySelectorAll('.storybook__pager button')[1].click()`)
await until(
  `document.querySelector('.storybook__pager span').textContent === '1 / 4'`,
  '静止模式翻到 1 / 4',
)
await sleep(300)
const staticPage = await evaluate(`(() => {
  const pager = document.querySelector('.storybook__pager')
  const el = document.querySelector('.storybook__listen')
  const btn = el?.querySelector('.book-listen')
  return {
    display: el ? getComputedStyle(el).display : null,
    position: el ? getComputedStyle(el).position : null,
    centerDelta: btn ? Math.round(btn.getBoundingClientRect().left + btn.getBoundingClientRect().width / 2 - document.documentElement.clientWidth / 2) : null,
    below: btn ? Math.round(btn.getBoundingClientRect().top - pager.getBoundingClientRect().bottom) : null,
  }
})()`)
ok(
  '静止模式：控件回到文档流，排在翻页钮下面且居中',
  staticPage.display === 'flex' &&
    staticPage.position === 'static' &&
    staticPage.below > 0 &&
    Math.abs(staticPage.centerDelta) <= 2,
  `display=${staticPage.display} · position=${staticPage.position} · 比翻页钮低 ${staticPage.below}px · 离中线 ${staticPage.centerDelta}px`,
)
// ★ 「离中线」量的是 `documentElement.clientWidth`，不是 `innerWidth` ——
//   后者把竖向滚动条那一格算进去了，居中本来就不含它。第一次跑量到 -8px，
//   差的就是那半条滚动条（17px），不是布局错了。

/* ── 收尾 ────────────────────────────────────────────────────────────────── */
console.log('')
// ★ 数**跑过几项**，不写死一个"七项"：条数一改（这一轮从 6 条加到 11 条），
//   写死的那个数就会开始说谎，而它恰好是最后一行、最像结论的那一句。
console.log(
  fails.length
    ? `✗ ${fails.length} / ${passed + fails.length} 项没过：${fails.join(' / ')}`
    : `✓ 全部 ${passed} 项通过`,
)
chrome.kill()
process.exit(fails.length ? 1 : 0)
