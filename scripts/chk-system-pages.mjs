/**
 * chk-system-pages.mjs —— 三个「系统页」到底长什么样、什么时候显形（2026-10-20）
 *
 * ```bash
 * node scripts/chk-system-pages.mjs http://127.0.0.1:3311
 * ```
 *
 * 量的是新加的 `app/error.tsx` / `app/loading.tsx` / `app/(studio)/loading.tsx` /
 * `app/not-found.tsx` —— 四个文件一套视图（`components/system/SystemNotice.tsx`）。
 *
 * ── 判据四条，每条都只有真做才会不同 ───────────────────────────────────────
 *
 * | # | 量什么                                                              | 错了会怎样                                       |
 * | - | ------------------------------------------------------------------- | ------------------------------------------------ |
 * | 1 | `/no-such-page` 返回**真 404**，页面上是那张纸（标题、两条出口、纸色） | 落到 Next 自带的错误页 / 200 带一句"没有这一页"  |
 * | 2 | 客户端导航（RSC 拦住 1.5s）：**先出现根那一档**，且前 120ms 读到的   | 那一档立刻显形 → 快导航时闪一下整屏纸            |
 * |   | opacity 是 0，之后升到 1                                             |                                                  |
 * | 3 | 工作台**组内**导航：出现的是 `scope=shell` 那一档，而 `.shell` 还在  | 侧栏一起被换掉 → 读起来像"整个应用重启了"        |
 * | 4 | 空态不算通过：判据 2/3 **必须真看见那张纸**（量到 0 次 = 不过）      | 加载态根本没出现过，而"没闪"看着像全绿           |
 *
 * ★ 判据 2/3 为什么要**拦 RSC**：这两个加载态只在"等得够久"时才看得见 ——
 *   生产上那是首屏与冷导航，dev 里是现场编译（实测 1.5–2.5s）。
 *   不拦的话量到的是"什么都没看见"，而那与"延迟显形做对了"是**同一个读数**
 *   （`measurement-budget-is-ample` 那条账：没测成不许记成测出来）。
 *   拦住之后那 1.5s 由脚本自己给，两件事就分得开了。
 *
 * ★ 为什么直连 CDP、不进预览面板：**那个面板会把 rAF 与 transition 一起冻住**
 *   （`preview-pane-hidden-freezes-raf-and-transitions` 那条记过），
 *   而判据 2 量的恰恰是"这 120ms 里它是 0 还是 1"。
 *   （实测过：面板里那张纸出现 300ms，其间每 40ms 采一次，opacity 一直是 0 ——
 *   采样窗口不够是一个原因，但更根本的是那一档动画在面板里不跑。）
 *
 * ★ 判据 1 的出口**逐个查 href 而不是查数量**：`回到首页 → /`、`翻一本成品 →
 *   /booklist` 这两条是这一屏唯一说得出"下一步去哪"的地方，路径写错了与没写
 *   在"按钮有几个"上读出来是一样的。
 *
 * ── 没有进这份探针的那一档 ─────────────────────────────────────────────────
 *
 * **`app/error.tsx`（根错误边界）不在里面**：要验它得先有一条会抛的路由，
 * 而这个仓库里不该留着那样一条路由。它是一次性读数，2026-10-20 量的（记在
 * `.scratch/tech-debt/issues/01-app-router-special-files.md`）：服务端抛 → 边界接住、
 * 显示 digest；hydrate **之后**再抛也接得住；按「重试」那一棵子树**真的重挂了**
 * （t=43ms 读数：`.notice` 没了、被抛的那一屏画出来了）。
 *
 * ── 参数 ───────────────────────────────────────────────────────────────────
 *
 * 位置参数或 `--base=`：dev server 地址（默认 `http://127.0.0.1:3311`）。
 * `--delay=`：拦住 RSC 之后放行前的等待毫秒数（默认 1500）。
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
const PORT = Number(flag('port', '9367'))
const DELAY = Number(flag('delay', '1500'))
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE = resolve(ROOT, '.out', 'chrome-system-pages')

const VW = 1440
const VH = 900
/** 延迟显形那道门槛（CSS 里的 `animation-delay`：0.12s）。判据 2 前 120ms 读 0 靠它 */
const REVEAL_MS = 120

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
/** 判据 1 要的那条真状态码（`/no-such-page` 必须是 404，不是 200 带一句"没有"） */
const statuses = []
/** 拦下来的 RSC 请求：先攥在手里，隔 `DELAY` 毫秒再放行 */
const heldRsc = []
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Network.responseReceived') {
    const { url } = msg.params.response
    if (url.includes('/no-such-page') && !url.includes('_rsc='))
      statuses.push(msg.params.response.status)
  }
  if (msg.method === 'Fetch.requestPaused') {
    const { requestId, request } = msg.params
    if (request.url.includes('_rsc=') || request.url.includes('/_next/static/chunks/app/')) {
      if (request.url.includes('_rsc=')) heldRsc.push(request.url)
      setTimeout(() => send('Fetch.continueRequest', { requestId }), DELAY)
    } else {
      send('Fetch.continueRequest', { requestId })
    }
  }
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
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: VW,
  height: VH,
  deviceScaleFactor: 1,
  mobile: false,
})

const open = async (path) => {
  await send('Page.navigate', { url: `${BASE}${path}` })
  for (let i = 0; i < 120; i += 1) {
    const ready = await evaluate('document.readyState === "complete"').catch(() => false)
    if (ready) break
    await sleep(150)
  }
  /* 等 hydrate 完（判据 2/3 要点 `<Link>`：没 hydrate 的链接点不动，
     而那会记成"加载态没出现"——一个假故障）。 */
  for (let i = 0; i < 80; i += 1) {
    const ok = await evaluate(
      `Object.keys(document.body).some((k) => k.startsWith('__reactFiber$')) ||
       !!document.querySelector('a[href]')?.__reactProps$`,
    ).catch(() => false)
    if (ok) break
    await sleep(150)
  }
  await sleep(400)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 1：404 那一屏
 * ══════════════════════════════════════════════════════════════════════════ */
await open('/no-such-page-chk')
const notFound = await evaluate(`(() => {
  const n = document.querySelector('.notice')
  const paper = n?.querySelector('.notice__paper')
  const r = paper?.getBoundingClientRect()
  const cs = paper ? getComputedStyle(paper) : null
  return {
    kind: n?.dataset.kind ?? null,
    scope: n?.dataset.scope ?? null,
    title: document.title,
    h1: n?.querySelector('.notice__title')?.textContent ?? null,
    lead: n?.querySelector('.notice__lead')?.textContent ?? null,
    exits: [...(n?.querySelectorAll('.notice__btn') ?? [])].map((b) => b.getAttribute('href')),
    mark: !!n?.querySelector('.notice__mark'),
    paperBg: cs?.backgroundColor ?? null,
    radius: cs?.borderRadius ?? null,
    w: Math.round(r?.width ?? 0),
    centered: r ? Math.abs(r.top + r.height / 2 - innerHeight / 2) < 8 : false,
  }
})()`)
check(
  '1a `/no-such-page-chk` 返回真 404',
  statuses.includes(404),
  `Document 响应状态：${statuses.join(' / ') || '（没记到）'}`,
)
check(
  '1b 404 那一屏是那张纸（标题 + 品牌记号 + 纸色）',
  notFound.kind === 'missing' &&
    notFound.h1 === '没有这一页' &&
    notFound.mark &&
    notFound.paperBg === 'rgb(251, 247, 239)',
  `kind=${notFound.kind} scope=${notFound.scope} h1=${notFound.h1} title=${notFound.title}` +
    ` · 底 ${notFound.paperBg} 圆角 ${notFound.radius} 宽 ${notFound.w} 居中=${notFound.centered}`,
)
check(
  '1c 两条出口都指向真存在的路',
  JSON.stringify(notFound.exits) === JSON.stringify(['/', '/booklist']),
  `出口 ${JSON.stringify(notFound.exits)}（要 ["/","/booklist"]）· 正文「${notFound.lead}」`,
)

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 2：从首页客户端导航进工作台 —— 出现的是**根那一档**（整页）
 *         并且前 120ms 读到的 opacity 必须是 0
 *
 * ★ 拦的**是两类**请求，理由不同：
 *   · `*_rsc=*`：新一屏的数据。拦住它 = "服务端还没把这一屏给出来"。
 *   · `*_next/static/chunks/app/*`：那一屏的 JS。**dev 里真正决定这张纸活多久的
 *     是这一条** —— 实测第一遍只拦 RSC 时，纸在 t≈1741ms 才出现、只活了约 325ms
 *     （RSC 放行后开始取 page chunk，取完就换页），短于"延迟 120 + 渐显 300"，
 *     于是判据 2c 读不到 opacity=1（它分不清"还没显完"与"永远不会显"）。
 *   两条一起拦，纸就活够久，判据 2c 才有意义。
 * ══════════════════════════════════════════════════════════════════════════ */
await send('Fetch.enable', {
  patterns: [
    { urlPattern: '*_rsc=*', requestStage: 'Request' },
    { urlPattern: '*_next/static/chunks/app/*', requestStage: 'Request' },
  ],
})
await open('/')
heldRsc.length = 0

const rootSheet = await evaluate(`new Promise((resolve) => {
  const t0 = performance.now()
  const samples = []
  const a = document.querySelector('a[href="/booklist"]')
  if (!a) { resolve({ err: '首页上没有指向 /booklist 的链接' }); return }
  const iv = setInterval(() => {
    const n = document.querySelector('.notice')
    if (n) {
      samples.push({
        t: Math.round(performance.now() - t0),
        scope: n.dataset.scope,
        op: Number(getComputedStyle(n.querySelector('.notice__paper')).opacity),
        shell: !!document.querySelector('.shell'),
      })
    }
    if (performance.now() - t0 > 6000) { clearInterval(iv); resolve({ samples }) }
  }, 25)
  a.click()
})`)

const rs = rootSheet.samples ?? []
/* "第一次看见"= 那张纸进 DOM 的那一刻；延迟显形要从那一刻起算 */
const firstSeen = rs[0]?.t ?? null
const early = rs.filter((s) => s.t - (firstSeen ?? 0) < REVEAL_MS)
const late = rs.filter((s) => s.t - (firstSeen ?? 0) > REVEAL_MS + 320)
check(
  '2a 客户端导航进工作台时，出现的是**根**那一档加载态',
  rs.length > 0 && rs.every((s) => s.scope === 'page'),
  rs.length
    ? `看见 ${rs.length} 次采样，scope=${[...new Set(rs.map((s) => s.scope))].join('/')}（要 page）· 首次看见 t≈${firstSeen}ms`
    : `一次都没看见（拦了 ${heldRsc.length} 条 RSC）—— 判据 4 说的"空态不算通过"就是这一格`,
)
check(
  '2b 前 120ms 读到的 opacity 是 0（快导航不闪）',
  early.length > 0 && early.every((s) => s.op === 0),
  early.length
    ? `头 ${early.length} 次采样 opacity=${[...new Set(early.map((s) => s.op))].join('/')}`
    : '那 120ms 里一次都没采到（采样太稀，判不了）',
)
check(
  '2c 等到放行之后 opacity 升到 1（它是真的会显形的，不是永远 0）',
  late.length > 0 && late.some((s) => s.op === 1),
  late.length
    ? `后段 opacity=${[...new Set(late.map((s) => s.op))].join('/')}`
    : '后段一次都没采到',
)

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 3：**工作台组内**导航 —— 出现的是 shell 那一档，且侧栏还在
 *
 * 这一格是 `(studio)/loading.tsx` 存在的全部理由：根那一档会把 `.shell`
 * 一起换掉（判据 2 的读数里 `shell` 就是 false），组内这一档不该。）
 * ══════════════════════════════════════════════════════════════════════════ */
await open('/booklist')
heldRsc.length = 0
const shellSheet = await evaluate(`new Promise((resolve) => {
  const t0 = performance.now()
  const samples = []
  const a = document.querySelector('a[href="/shelf"]')
  if (!a) { resolve({ err: '工作台里没有指向 /shelf 的链接' }); return }
  const iv = setInterval(() => {
    const n = document.querySelector('.notice')
    if (n) {
      samples.push({
        t: Math.round(performance.now() - t0),
        scope: n.dataset.scope,
        op: Number(getComputedStyle(n.querySelector('.notice__paper')).opacity),
        shell: !!document.querySelector('.shell'),
      })
    }
    if (performance.now() - t0 > 7000) { clearInterval(iv); resolve({ samples }) }
  }, 25)
  a.click()
})`)
const ss = shellSheet.samples ?? []
check(
  '3 工作台组内导航：出现 shell 那一档，侧栏（`.shell`）还在',
  ss.length > 0 && ss.every((s) => s.scope === 'shell') && ss.every((s) => s.shell === true),
  ss.length
    ? `看见 ${ss.length} 次采样，scope=${[...new Set(ss.map((s) => s.scope))].join('/')}（要 shell）` +
        ` · .shell 在场 ${[...new Set(ss.map((s) => s.shell))].join('/')}（要 true）· 首次看见 t≈${ss[0].t}ms`
    : `一次都没看见（拦了 ${heldRsc.length} 条 RSC）`,
)

await send('Fetch.disable')

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
