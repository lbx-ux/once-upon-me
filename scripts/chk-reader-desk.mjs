/**
 * chk-reader-desk.mjs —— 量阅读器那张「桌面」层（点阵 / 暖光 / 随页染色）
 *
 * ```bash
 * node scripts/chk-reader-desk.mjs http://127.0.0.1:3341 .out/reader-desk.png
 * node scripts/chk-reader-desk.mjs http://127.0.0.1:3341 --book=dino
 * node scripts/chk-reader-desk.mjs http://127.0.0.1:3341 --reader=xiaoyu-r1-xxxx --w=390 --h=844
 * ```
 *
 * ★ 为什么直连 CDP、不进预览面板：**那个面板把 rAF 与 transition 一起冻住**
 *   （`preview-pane-hidden-freezes-raf-and-transitions` 那条记过）。这一层要验的
 *   恰好是"染色是**慢慢**映上去的"与"静止模式下它一步到位"，两条都是时间轴上的事。
 *   无头 Chrome 有真帧。同一条理由写在 `chk-shared-reader.mjs` 头上。
 *
 * ── 五条判据，每条都只有真做才会不同 ─────────────────────────────────────────
 *
 * | # | 量什么                                   | 错了会怎样                                   |
 * | - | ---------------------------------------- | -------------------------------------------- |
 * | 1 | 遮罩在每一行字的上沿**再往上 4px** 处为 0 | 点阵铺到文案上（`--ink-muted` 4.99:1 会被吃掉） |
 * | 2 | 翻页后染色面的 opacity 在 t≈120ms **在中间** | 淡入被做成了"一跳"（一下子 0→.16）           |
 * | 3 | 落定后：新面 .16、其余 0                 | 交叉淡入没关掉旧面（两层叠着染，色会重）      |
 * | 4 | reduced 下**同一帧**新面就已是 .16       | 静止模式被做成"干脆不染色"（少了一层，不是不动） |
 * | 5 | 封底那一屏 9 张面全为 0                  | 合上的书还在往桌上投影                        |
 *
 * ★ 判据 2/3/4/5 是**有前提的**：它们量的那一层只存在于书单那台。独读版
 *   `/reader/[bookId]` 装的是用户自己创作的书，没有离线取样出来的色表，
 *   按设计就**只吃点阵与暖光**（见 `booklist-reader.css` §桌面 那张表的下半段）。
 *   所以脚本先看 `.blr__tint-face` 在不在：不在就**明说"跳过"**，
 *   既不报 ✗（那是把设计当故障），也不拿空数组去 `.every` 凑一条空过的 ✓
 *   （`[].every(...)` 恒真，而下标取值会读成 `undefined` 报一条假失败）。
 *   跳过的条数在末行单独计数，不进分子也不进分母。
 *
 * ★ 判据 1 读的是**浏览器算出来的遮罩停点**（`getComputedStyle().maskImage`），
 *   不是脚本里重抄一遍的数 —— 与 `check-scrim.mts` 那条纪律同源：
 *   一份写在量具里的数，改 CSS 的人不会想到来改它，于是量出来的是一份早就没有的设计。
 *   解析不出来就**当场报错**，不许退回到内置默认值。
 *
 * ★ 判据 2 是这支脚本唯一不可替代的一条。只看"元素在不在""最后是不是 .16"，
 *   一个 `transition: none` 的实现会全绿 —— 而那正是把"慢慢映上去"做没了的那种错。
 */

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const positional = args.filter((item) => !item.startsWith('--'))
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = (positional[0] ?? 'http://127.0.0.1:3341').replace(/\/+$/, '')
const SHOT = positional[1] ?? null
const BOOK = flag('book', 'dino')
/**
 * 要量的那一屏。**默认是书单那台**（`/booklist/<key>`，那 12 本样书）；
 * 另一台独读版走 `--reader=<bookId>` —— 它俩的类名不同（`.blr__*` 对 `.reader__*`），
 * 但这一层是同一张桌子，所以下面那几条探针的选择器两组都收。
 *
 * ★ 参数**刻意不带前导斜杠**，`--reader=dino` 而不是 `--path=/reader/dino`：
 *   Git Bash（MSYS）会把以 `/` 开头的参数**改写成 Windows 路径**，
 *   于是 `--path=/reader/x` 到了脚本里已经不是那条路由了，
 *   而症状很闷——`Page.navigate` 不报错，页面停在一张 `about:blank` 上，
 *   探针只会说"这一屏上没有点阵层"。拼 URL 的活在脚本里做，外面只给 id。
 */
const PATH = flag('reader', null) ? `/reader/${flag('reader')}` : `/booklist/${BOOK}`
const PORT = Number(flag('port', '9351'))
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const PROFILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'chrome-desk')
/**
 * 视口。★ 必须**显式给具体宽高**（`preview-pane-hidden-freezes-raf-and-transitions`
 * 那条记过）：不给的话窄屏下 `innerWidth` 会读到 0，`vw` 全落 `min()` 的下限，
 * 量到的几何是**另一套布局**，而它看起来还挺合理 —— 那正是最难发现的那种错。
 * 窄屏是这条遮罩的关键一档：`--blr-stage-w` 与控制区那 ~200px 固定高之比
 * 随视口变（1440×900 下舞台底落在整节的 73%，390×844 下落在 50%），
 * 「用百分比会翻车」这句话就是在这里被验的。
 */
const VW = Number(flag('w', '1440'))
const VH = Number(flag('h', '900'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const skips = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
}
/**
 * ★ 「跳过」是**第三种结论**，不是"通过"也不是"失败"。
 *   这一屏按设计就没有染色层（独读版那台装的是用户自己创作的书，
 *   没有离线取样出来的色表），所以关于染色的每一条判据在这里都**无从谈起**：
 *   报 ✗ 是把设计当故障，报 ✓ 是一条什么都没验的空过
 *   （`[].every(...)` 恒真那种）。说清"跳过了哪几条、为什么"才是诚实的写法。
 *   计分时它既不进分子也不进分母。
 */
const skipNote = (label, why, count = 1) => {
  for (let i = 0; i < count; i += 1) skips.push(label)
  console.log(`· 跳过 ${label} —— ${why}`)
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
await send('Network.enable')
// 字体稳定下来再量：字行的 rect 直接决定判据 1 的那条线
await send('Emulation.setDeviceMetricsOverride', {
  width: VW,
  height: VH,
  deviceScaleFactor: 1,
  mobile: false,
})

const go = async (url) => {
  await send('Page.navigate', { url })
  await sleep(1200)
}

/* ── 页里用的小工具：一次拿齐"字行的几何 + 遮罩停点" ─────────────────────────── */

const DESK_PROBE = `(() => {
  const round = (n) => Math.round(n * 100) / 100
  /** 遮罩的三个停点（浏览器算出来的真值）。两处都要：书单那台与独读版那台 */
  const stopsOf = (el) => {
    const raw = getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage
    const nums = [...String(raw).matchAll(/(-?[\\d.]+)px/g)].map((m) => Number(m[1]))
    if (nums.length < 3) return null
    return nums.slice(0, 3)
  }
  /** linear-gradient(#000 0, #000 A, transparent B) 在 y 处的 α（CSS 规范：线性插值） */
  const alphaAt = (stops, y) => {
    const [, a, b] = stops
    if (y <= a) return 1
    if (y >= b) return 0
    return 1 - (y - a) / (b - a)
  }
  const boxes = [...document.querySelectorAll('.blr__bar, .blr__progress, .blr__meta, .reader__bar, .reader__progress, .reader__meta')]
  const ambient = document.querySelector('.blr__ambient, .reader__ambient')
  if (!ambient) return { error: '这一屏上没有点阵层' }
  const stops = stopsOf(ambient)
  if (!stops) return { error: '遮罩解析不出来（不是三停点的 linear-gradient）' }
  const ambientTop = ambient.getBoundingClientRect().top
  const rows = boxes.map((el) => {
    const r = el.getBoundingClientRect()
    // 局部坐标：遮罩是挂在点阵层自己身上的
    const topLocal = r.top - ambientTop
    return {
      sel: el.className.split(' ')[0],
      top: round(r.top),
      // ★ 余量 4px：点粒子本身有 ~1.5px 直径，贴着 0 不算安全
      alphaAtText: round(alphaAt(stops, topLocal - 4)),
    }
  })
  const faces = [...document.querySelectorAll('.blr__tint-face')]
  return {
    ambientTop: round(ambientTop),
    stops,
    rows,
    faceCount: faces.length,
    onIndex: faces.findIndex((f) => f.hasAttribute('data-on')),
    ops: faces.map((f) => round(Number(getComputedStyle(f).opacity))),
    tintOf: faces.map((f) => f.style.getPropertyValue('--t1')),
    readout: (document.querySelector('.blr__readout, .reader__readout') || {}).textContent?.trim(),
  }
})()`

const frame = () =>
  evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))')

const turnNext = () =>
  evaluate(`(() => {
    const btns = [...document.querySelectorAll('.blr__btn, .reader__btn')]
    const next = btns[btns.length - 1]
    if (!next) return '没有翻页钮'
    // ★ 先查 __reactProps$：SSR 的 HTML 里元素全在，"点得动"证明不了已 hydrate
    if (!Object.keys(next).some((k) => k.startsWith('__reactProps$'))) return '没 hydrate'
    next.click()
    return 'ok'
  })()`)

/* ── 判据 1：点阵不落在任何一行字上 ─────────────────────────────────────────── */

// ★ 整段包在 try 里，为的是**出错也把自己那个 Chrome 关掉**。第一版没有这一条，
//   探针一抛异常就留一个无头 Chrome 占着调试端口与 profile 目录；下一次跑会
//   **连到那一个旧进程**、量到上一次那个页面 —— 报出来的"这一屏上没有点阵层"，
//   连上的其实是上一次 404 的页。连跑几次就积成一堆。
try {
  await go(`${BASE}${PATH}`)
  const first = await evaluate(DESK_PROBE)
  if (first.error) throw new Error(first.error)

  console.log(
    `\n遮罩停点（浏览器算出来的）：${first.stops.join(' / ')} px，点阵层顶边 y=${first.ambientTop}`,
  )
  for (const row of first.rows)
    console.log(`  ${row.sel.padEnd(18)} 顶边 y=${row.top}  该处遮罩 α=${row.alphaAtText}`)

  const worst = Math.max(...first.rows.map((r) => r.alphaAtText))
  check(
    '点阵的遮罩止于每一行字之前（含 4px 余量）',
    worst === 0,
    `最大 α=${worst}（0 = 一颗都不落在字上）`,
  )

  /* ── 判据 2/3：翻页时染色是"慢慢映上去"的 ──────────────────────────────────── */

  if (first.faceCount === 0) {
    // ★ 这一屏**本来就没有染色层**，不是"染色坏了"。独读版那台装的是用户自己创作的书，
    //   没有离线取样出来的色表（见 `booklist-reader.css` §桌面 那张表的下半段），
    //   所以它**只吃**点阵与暖光。
    //   报成 ✗ 是错的（把设计当故障），报成 ✓ 更错（一条什么都没验的空过）。
    //   说清"跳过了什么、为什么"才是这一条该有的样子。
    skipNote(
      '染色那三条（淡入 / 落定 / 换色）',
      '这一屏按设计就没有染色层（独读版没有离线色表，只吃点阵与暖光）',
      3,
    )
  } else {
    const before = first.onIndex
    const turned = await turnNext()
    if (turned !== 'ok') throw new Error(`翻页没点成：${turned}`)

    // 三次采样，每次先跨两帧 —— 否则读到的是同一帧
    await frame()
    const t0 = await evaluate(DESK_PROBE)
    await sleep(120)
    await frame()
    const t1 = await evaluate(DESK_PROBE)
    await sleep(1200)
    await frame()
    const t2 = await evaluate(DESK_PROBE)

    const fmt = (s) => `on=${s.onIndex} ops=[${s.ops.join(', ')}]`
    console.log(`\n翻页后三次采样：\n  t≈0    ${fmt(t0)}\n  t≈120  ${fmt(t1)}\n  t≈1320 ${fmt(t2)}`)

    // 中间那一帧：新那一张在往上走、旧那一张在往下走，两边都该在 (0, .16) 里
    const mid = t1.ops[t1.onIndex] ?? 0
    const midOld = before >= 0 ? (t1.ops[before] ?? 0) : 0
    check(
      '染色是淡进去的，不是一跳（t≈120ms 时它在半路上）',
      mid > 0.005 && mid < 0.155 && (before < 0 || midOld > 0.005),
      `新面 ${mid}、旧面 ${midOld}（一跳的实现这里是 0 与 0.16）`,
    )

    check(
      '落定后只有当前那一页染着、其余全灭',
      t2.ops[t2.onIndex] === 0.16 && t2.ops.filter((o) => o > 0).length === 1,
      `on=${t2.onIndex}，>0 的面有 ${t2.ops.filter((o) => o > 0).length} 张`,
    )

    check(
      '染的是这一页自己的色（换页就换色）',
      t2.tintOf[t2.onIndex] !== first.tintOf[before],
      `${first.tintOf[before]} → ${t2.tintOf[t2.onIndex]}`,
    )
  }

  /* ── 判据 5：封底那一屏染色淡干净 ───────────────────────────────────────────── */

  if (first.faceCount === 0) {
    skipNote('封底那一屏不染色', '同上：这一屏没有染色层可淡')
  } else {
    await evaluate(`(() => {
    const stage = document.querySelector('.blr__stage, .reader__stage')
    stage.focus()
    return 1
  })()`)
    // End 键由组件自己接（容器级 onKeyDown），一路跳到最后那一屏
    for (let i = 0; i < 3; i += 1) {
      await evaluate(`(() => {
      const stage = document.querySelector('.blr__stage, .reader__stage')
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
      return 1
    })()`)
      await sleep(400)
    }
    await sleep(1200)
    await frame()
    const end = await evaluate(DESK_PROBE)
    check(
      '封底那一屏不染色（合上的书不往桌上投影）',
      end.ops.every((o) => o === 0),
      `读作「${end.readout}」，${end.faceCount} 张面的 opacity = [${end.ops.join(', ')}]`,
    )
  }

  /* ── 判据 4：静止模式下不播补间，但**染色还在** ────────────────────────────── */

  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await go(`${BASE}${PATH}`)
  await evaluate(`document.querySelector('.blr__stage, .reader__stage').focus()`)
  const rTurn = await turnNext()
  if (rTurn !== 'ok') throw new Error(`静止模式下翻页没点成：${rTurn}`)
  // ★ 同一帧就读：补间被关掉的话，这一帧它就该已经在终值上
  await frame()
  const reduced = await evaluate(DESK_PROBE)
  if (reduced.faceCount === 0) {
    // ★ 别拿空数组去 `.every` / 下标取值 —— 那种 ✓ 是"一条什么都没验的通过"，
    //   而下标取值会读成 `undefined`、反过来报一条假失败。两种都不行。
    skipNote('静止模式下染色直接落在目标上', '同上：这一屏没有染色层')
  } else {
    check(
      '静止模式下染色不播补间，直接落在目标上（而不是干脆不染色）',
      reduced.ops[reduced.onIndex] === 0.16,
      `on=${reduced.onIndex}，同一帧的 opacity = ${reduced.ops[reduced.onIndex]}`,
    )
  }
  await send('Emulation.setEmulatedMedia', { features: [] })

  /* ── 截图 ──────────────────────────────────────────────────────────────────── */

  if (SHOT) {
    await send('Emulation.setEmulatedMedia', { features: [] })
    await go(`${BASE}${PATH}`)
    // 翻一页，落在有正文的那一屏（封面那屏看不出染色换没换）
    await evaluate(`document.querySelector('.blr__stage, .reader__stage').focus()`)
    await turnNext()
    await sleep(1600)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(SHOT, Buffer.from(shot.result.data, 'base64'))
    console.log(`\n截图：${SHOT}`)
  }

  const bad = results.filter((r) => !r.ok)
  const skipped = skips.length ? `，另跳过 ${skips.length} 条（这一屏按设计就没有染色层）` : ''
  console.log(`\n${results.length - bad.length}/${results.length} 条过${skipped}`)
  ws.close()
  chrome.kill()
  process.exit(bad.length === 0 ? 0 : 1)
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  ws.close()
  chrome.kill()
  process.exit(1)
}
