/**
 * chk-paper-picker.mjs —— 验「设置 → 阅读器背景」那条链**真的通到阅读器**
 *
 * ```bash
 * node scripts/chk-paper-picker.mjs http://127.0.0.1:3311
 * ```
 *
 * 前置：那个地址上有一台 dev server（隔离那格；★ 别打别人正在用的 :3000）。
 *
 * ## 它证的是什么
 *
 * 这一轮新加的那条链有四段：**设置弹窗里那七行单选 → 写 localStorage →
 * 阅读器挂载时读回来 → 铺成底图**。中间任何一处断了，界面上都会平静地"选了没反应"
 * —— 选项亮着、能点、也存下了，就是没人读。而这种坏**没有任何视觉信号**，
 * 所以它必须由一支脚本从"点"一路量到"屏幕上那张图的文件名"。
 *
 * ## 判据（都只有真做才会不同）
 *
 * | # | 量什么                                        | 错了会怎样                             |
 * | - | --------------------------------------------- | -------------------------------------- |
 * | 1 | 弹窗里有七行 `input[name=reader-paper]`        | 那一节没渲染出来 / 少了一档             |
 * | 2 | 每一行都带一个缩略图（`--paper` 那档是纯色块） | 缩略图那一格画空了，七行变成七个词       |
 * | 3 | 点第 4 行之后 `localStorage` 变成那一档        | 单选没接上（点了不落盘）                 |
 * | 4 | 重载阅读器，`.blr__desk` 铺的就是那张图         | 偏好写了没人读（**这条才是终点**）       |
 * | 5 | **打开弹窗本身不改盘上的值**                    | 弹窗挂载时顺手写了一次，把用户的选择冲掉 |
 *
 * ★ 判据 3/4 取的是**只有真做才会变的量**（存储里那串字、图文件名），
 *   不取"点得动"——SSR 的 HTML 里元素本来就在，`element.click()` 绕过命中测试
 *   （`ui-probe-clicks-land-before-hydration` 那条记过）。所以点之前先验
 *   `__reactProps$` 在不在（只有 hydrate 过的 React 节点才有），而且**同一轮 JS 里**
 *   查完就点：共享工作区里 HMR 会整页重载，分两次调用中间那份 DOM 可能已经换人了。
 *
 * ★ 判据 5 是这一支里最容易被漏掉、也最容易真发生的一条：`useReaderPaper`
 *   的写法与 `useTurnMode` 一样，挂载后**只读不写**——但一个"顺手保存一下"的改动
 *   就会让每次打开设置都覆盖用户的选择，而那种坏法在只看"选了能存上"的验里全绿。
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const positional = args.filter((item) => !item.startsWith('--'))
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = (positional[0] ?? 'http://127.0.0.1:3311').replace(/\/+$/, '')
const PORT = Number(flag('port', '9353'))
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const PROFILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'chrome-picker')
const VW = Number(flag('w', '1440'))
const VH = Number(flag('h', '900'))

const PAPER_KEY = 'xiaozhujue.reader.paper'
const EXPECTED = ['paper', 'wood', 'linen', 'mist', 'clay', 'chalk', 'plain']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
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
  if (res.result?.exceptionDetails) {
    throw new Error(
      `页面里报错：${res.result.exceptionDetails.text} ${res.result.exceptionDetails.exception?.description ?? ''}`,
    )
  }
  return res.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: VW,
  height: VH,
  deviceScaleFactor: 1,
  mobile: false,
})

const go = async (url) => {
  await send('Page.navigate', { url })
  await sleep(1400)
}

/**
 * 等 React 真的接上那个节点。
 *
 * ★ 一次就点会假失败：dev 模式下第一趟要现编译，1.4 秒远远不够，而
 *   `btn.click()` 在没 hydrate 的 HTML 上**照样有反应**（DOM 事件派发出去了），
 *   只是没人听——于是报出来的是"没 hydrate"，看着像代码坏了。
 *   所以轮询到 `__reactProps$` 出现为止（只有 React 挂过的节点才有这个属性），
 *   再点，并且**在同一轮 JS 里**查完就点（共享工作区里 HMR 会整页重载）。
 */
const clickWhenReady = async (finder, what) => {
  for (let i = 0; i < 40; i += 1) {
    const got = await evaluate(`(() => {
      const el = ${finder}
      if (!el) return 'absent'
      if (!Object.keys(el).some((k) => k.startsWith('__reactProps$'))) return 'cold'
      el.click()
      return 'ok'
    })()`)
    if (got === 'ok') return 'ok'
    if (got === 'absent' && i > 20) return `找不到${what}`
    await sleep(300)
  }
  return `${what}一直没 hydrate`
}

try {
  /* ── 判据 5 的前半：先在盘上放一个"用户已经选好"的值 ──────────────────────── */

  await go(`${BASE}/home`)
  const seeded = await evaluate(`(() => {
    window.localStorage.setItem(${JSON.stringify(PAPER_KEY)}, 'clay')
    return window.localStorage.getItem(${JSON.stringify(PAPER_KEY)})
  })()`)
  if (seeded !== 'clay') throw new Error(`写不进 localStorage（读到 ${seeded}）——手工验一次这一跳`)

  /* ── 判据 1/2：弹窗里那一节 ─────────────────────────────────────────────── */

  const opened = await clickWhenReady(
    `[...document.querySelectorAll('.shell__link')].find((b) => b.title === '设置')`,
    '「设置」那一格',
  )
  if (opened !== 'ok') throw new Error(`「设置」没点开：${opened}`)
  await sleep(400)

  const dialog = await evaluate(`(() => {
    const opts = [...document.querySelectorAll('input[name="reader-paper"]')]
    return {
      values: opts.map((o) => o.value),
      swatches: opts.map((o) => {
        const row = o.closest('label')
        const sw = row && row.querySelector('.prefs__swatch')
        if (!sw) return null
        const st = getComputedStyle(sw)
        return { bg: st.backgroundImage, color: st.backgroundColor, w: Math.round(sw.getBoundingClientRect().width) }
      }),
      title: (document.querySelector('.dlg__title') || {}).textContent,
    }
  })()`)

  check(
    '弹窗里有那七行单选，取值与 `READER_PAPERS` 同序',
    JSON.stringify(dialog.values) === JSON.stringify(EXPECTED),
    `${dialog.title} 里读到 [${dialog.values.join(', ')}]`,
  )

  const swatchesOk =
    dialog.swatches.length === EXPECTED.length &&
    dialog.swatches.every((s) => s && s.w > 0) &&
    // 六张图各自带一张缩略图，「纯色」那一档只填底色
    dialog.swatches.slice(0, 6).every((s) => /reader-papers\/\w+\.thumb\.webp/.test(s.bg)) &&
    dialog.swatches[6].bg === 'none'
  check(
    '每一行都带一件看得见的东西（六张图各有缩略图、「纯色」是底色块）',
    swatchesOk,
    `宽 ${dialog.swatches[0]?.w}px；纯色那一档 background-image=${dialog.swatches[6]?.bg}`,
  )

  /* ── 判据 3：选一下，看它落不落盘 ───────────────────────────────────────── */

  const clicked = await clickWhenReady(
    `document.querySelector('input[name="reader-paper"][value="mist"]')`,
    '「晨雾」那一档',
  )
  if (clicked !== 'ok') throw new Error(`没点成：${clicked}`)
  await sleep(300)
  const stored = await evaluate(`window.localStorage.getItem(${JSON.stringify(PAPER_KEY)})`)
  check('选「晨雾」之后存储里就是它', stored === 'mist', `${PAPER_KEY} = ${stored}`)

  /* ── 判据 5 的后半：打开弹窗这件事本身不许改动盘上的值 ──────────────────── */

  await evaluate(`(() => {
    window.localStorage.setItem(${JSON.stringify(PAPER_KEY)}, 'clay')
    return 1
  })()`)
  await go(`${BASE}/home`)
  const reopened = await clickWhenReady(
    `[...document.querySelectorAll('.shell__link')].find((b) => b.title === '设置')`,
    '「设置」那一格',
  )
  if (reopened !== 'ok') throw new Error(`第二次没点开：${reopened}`)
  await sleep(400)
  const afterOpen = await evaluate(`window.localStorage.getItem(${JSON.stringify(PAPER_KEY)})`)
  check(
    '打开设置这一下不写盘（否则每次开弹窗都会把用户的选择冲掉）',
    afterOpen === 'clay',
    `盘上放着 clay，点开弹窗之后还是 ${afterOpen}`,
  )

  /* ── 判据 4：终点——阅读器铺的就是它 ─────────────────────────────────────── */

  await go(`${BASE}/booklist/dino`)
  const desk = await evaluate(`(() => {
    const el = document.querySelector('.blr__desk')
    if (!el) return null
    return { paper: el.getAttribute('data-paper'), paint: getComputedStyle(el).backgroundImage }
  })()`)
  check(
    '阅读器铺的就是设置里挑的那一张',
    Boolean(desk) && desk.paper === 'clay' && desk.paint.includes('clay.webp'),
    `${desk?.paper} —— ${desk?.paint}`,
  )

  const bad = results.filter((r) => !r.ok)
  console.log(`\n${results.length - bad.length}/${results.length} 条过`)
  ws.close()
  chrome.kill()
  process.exit(bad.length === 0 ? 0 : 1)
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  ws.close()
  chrome.kill()
  process.exit(1)
}
