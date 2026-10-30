/**
 * chk-system-pages.mjs —— 「系统页」长什么样，以及**导航时那张纸不许再出现**（2026-10-20）
 *
 * ```bash
 * node scripts/chk-system-pages.mjs http://127.0.0.1:3311
 * ```
 *
 * 量的是 `app/error.tsx` / `app/not-found.tsx`（一套视图 `components/system/SystemNotice.tsx`）
 * 与"导航期间的加载态"这件事本身。
 *
 * ── 判据，每条都只有真做才会不同 ───────────────────────────────────────────
 *
 * | # | 量什么                                                              | 错了会怎样                                       |
 * | - | ------------------------------------------------------------------- | ------------------------------------------------ |
 * | 1 | `/no-such-page` 返回**真 404**，页面上是那张纸（标题、两条出口、纸色） | 落到 Next 自带的错误页 / 200 带一句"没有这一页"  |
 * | 2 | 客户端导航（RSC 与 page chunk 拦住 1.5s）：**全程没有那张纸**，        | 那张纸又冒出来了（用户 2026-10-20 明确不要它）   |
 * |   | 那 1.5s 里**旧那一屏原地留着**，放行后**新那一屏真的到了**            | 骨架顶掉旧屏 / 新屏没到                          |
 * | 3 | 工作台**组内**导航：同上，且 `.shell` 那 1.5s 全程在场                | 侧栏一起被换掉 → 读起来像"整个应用重启了"        |
 * | 4 | 冷启动（直接打开 `/home`、`/shelf`）：**HTML 里有骨架，且排在内容之前** | `loading.tsx` 没接上 / 骨架被塞到页面尾巴上      |
 *
 * ★ 2026-10-30 加了骨架（两个 `loading.tsx`），而**判据 2/3 一个字没改**：
 *   实测（2026-10-30，dev）客户端导航期间骨架**不出现**，旧屏照旧留着——
 *   RSC 没到之前路由手里没有新树，`loading.tsx` 只在服务端流式那一趟生效。
 *   所以骨架那件事单开判据 4：冷启动的响应体里 `.skel` 在内容之前。
 *   ★ 生产档开了预取，骨架**有可能**在点下去那一刻出现；这种情形本轮没有量
 *     （`next build` + 生产服务器那一趟没跑），所以判据 2b/3b 只对开发档下判词。
 *
 * ★ 判据 2/3 的三格是**绑在一起的**：只量"没看见那张纸"会被"导航根本没发生"骗过
 *   （一次都没点动、或者点了没反应，读数与"做对了"一模一样）。
 *   所以另两格是"旧屏还在"与"新屏真到了"——后者只有真换过去才会成立。
 *   （`measurement-budget-is-ample` 那条账：没测成不许记成测出来。）
 *
 * ★ 为什么要**拦 RSC 与 page chunk**：不拦的话这一趟导航只花几十毫秒
 *   （实测 45–62ms），"加载态该不该出现"这个窗口根本不存在，量到的永远是"没看见"。
 *   拦住之后那 1.5s 是脚本自己给的，于是"没出现"才是一个有内容的读数 ——
 *   它证明了**等 1.5 秒也没有纸**，而那正是用户要的那件事。
 *
 * ★ 为什么直连 CDP、不进预览面板：**那个面板会把 rAF 与 transition 一起冻住**
 *   （`preview-pane-hidden-freezes-raf-and-transitions` 那条记过）。
 *   这张纸本身已经拆了，但"旧屏留到什么时候、新屏什么时候到"仍是时间上的事。
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
/** 采样间隔。判据 2/3 要读的是"那 1.5s 里有没有出现纸"，25ms 够密 */
const SAMPLE_MS = 25
/** 一次采样窗口（要盖住 1.5s 的拦截 + 放行之后的换屏） */
const WATCH_MS = 7000

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
 * 判据 2：从首页客户端导航进工作台 —— 那 1.5s 里**不许出现那张纸**，
 *         旧那一屏原地留着，放行之后新那一屏真的到了
 *
 * ★ 拦的**是两类**请求，理由不同：
 *   · `*_rsc=*`：新一屏的数据。拦住它 = "服务端还没把这一屏给出来"。
 *   · `*_next/static/chunks/app/*`：那一屏的 JS。dev 里它也是这段时间的一部分，
 *     一起拦住，这 1.5s 才是干净的"什么都没有准备好"。
 *   （这一条是上一版探针实测踩出来的：只拦 RSC 时，纸的寿命由 page chunk 决定。）
 * ══════════════════════════════════════════════════════════════════════════ */
await send('Fetch.enable', {
  patterns: [
    { urlPattern: '*_rsc=*', requestStage: 'Request' },
    { urlPattern: '*_next/static/chunks/app/*', requestStage: 'Request' },
  ],
})
await open('/')
heldRsc.length = 0

/**
 * 点一个链接，然后每 `SAMPLE_MS` 采一次。三件事一起采，因为它们互为判据：
 *   · `notice`  —— 那张纸（`null` = 不在 DOM 里）
 *   · `skel`    —— 骨架（2026-10-30 起，等待期间该出现的就是它）
 *   · `old`     —— 旧那一屏的标志物还在不在
 *   · `next`    —— 新那一屏的标志物到了没有
 */
const watchNav = (linkHref, oldMark, newMark) => `new Promise((resolve) => {
  const t0 = performance.now()
  const samples = []
  const a = document.querySelector('a[href="${linkHref}"]')
  if (!a) { resolve({ err: '这一屏上没有指向 ${linkHref} 的链接' }); return }
  const iv = setInterval(() => {
    samples.push({
      t: Math.round(performance.now() - t0),
      notice: !!document.querySelector('.notice'),
      skel: !!document.querySelector('.skel'),
      old: !!document.querySelector('${oldMark}'),
      next: !!document.querySelector('${newMark}'),
      shell: !!document.querySelector('.shell'),
    })
    if (performance.now() - t0 > ${WATCH_MS}) { clearInterval(iv); resolve({ samples }) }
  }, ${SAMPLE_MS})
  a.click()
})`

/**
 * 三段读数：拦截期间（放行前）、刚放行之后、**末尾那一段**。
 *
 * ★ 为什么要有"末尾"这一段：换屏发生在放行之后的某一刻，`after` 那个窗口里
 *   前几次采样仍在旧屏上（实测就是这样：`old` 是 false/true 混着的）。
 *   拿"放行后每一次都必须是新屏"当判据，红的是判据自己，不是页面。
 *   所以"真的换过去了"这条落在**末尾**：那一段必须是"新屏在场、旧屏已退场"。
 */
const phasesOf = (samples) => {
  const held = samples.filter((s) => s.t < DELAY - SAMPLE_MS * 2)
  const after = samples.filter((s) => s.t > DELAY + 900)
  const tail = samples.slice(-Math.max(8, Math.round(samples.length * 0.25)))
  return { held, after, tail }
}

const home2studio = await evaluate(watchNav('/booklist', '.hero__brand', '.blw'))
const h2s = home2studio.samples ?? []
const h2sHeld = phasesOf(h2s).held
const h2sTail = phasesOf(h2s).tail
const h2sNoticeAt = h2s.filter((s) => s.notice).map((s) => s.t)

check(
  '2a 客户端导航进工作台：**全程没有那张加载纸**（拦了 1.5s 也没有）',
  h2s.length > 0 && h2sNoticeAt.length === 0,
  h2s.length === 0
    ? `一次都没采到（${home2studio.err ?? '未知'}）`
    : `采样 ${h2s.length} 次（拦了 ${heldRsc.length} 条 RSC，同期的 page chunk 一起拦），` +
        `\`.notice\` 出现 ${h2sNoticeAt.length} 次` +
        (h2sNoticeAt.length ? `（t≈${h2sNoticeAt.slice(0, 6).join('/')}ms）` : '（一次都没有 ✓）'),
)

check(
  '2b 那 1.5s 里**旧那一屏还在**（不是空白、也不是那张纸）',
  h2sHeld.length > 0 && h2sHeld.every((s) => s.old),
  h2sHeld.length
    ? `拦截期间 ${h2sHeld.length} 次采样，首页标志物在场 ${[...new Set(h2sHeld.map((s) => s.old))].join('/')}（要 true）` +
        ` · 骨架 ${[...new Set(h2sHeld.map((s) => s.skel))].join('/')}（开发档不该出现，见判据 4）`
    : '拦截期间一次都没采到（窗口太短，判不了）',
)

check(
  '2c 放行之后**新那一屏真的到了**（否则 2a 那格会被"没导航"骗过）',
  h2sTail.length > 0 && h2sTail.every((s) => s.next && !s.old),
  h2sTail.length
    ? `末尾 ${h2sTail.length} 次采样（t≥${h2sTail[0].t}ms）：新屏 ${[...new Set(h2sTail.map((s) => s.next))].join('/')}（要 true）` +
        ` · 首页标志物 ${[...new Set(h2sTail.map((s) => s.old))].join('/')}（要 false）`
    : '末尾一段一次都没采到',
)

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 3：**工作台组内**导航 —— 同样不许出现那张纸，且 `.shell` 全程在场
 *
 * 这一格验的是"组内那一档不会把壳一起换掉"：2026-10-20 量到过根那一档
 * 会把 `.shell` 一起换掉（判据 2a 的 `shell=false` 就是它），所以任何加载态
 * 都只许挂在组内这一段上——壳全程在场。2026-10-30 加的骨架也守这一条。
 * ══════════════════════════════════════════════════════════════════════════ */
await open('/home')
heldRsc.length = 0
const insideStudio = await evaluate(watchNav('/shelf', '.cl', '.shelf'))
const ins = insideStudio.samples ?? []
const insHeld = phasesOf(ins).held
const insTail = phasesOf(ins).tail
const insNoticeAt = ins.filter((s) => s.notice).map((s) => s.t)

check(
  '3a 组内导航：**全程没有那张加载纸**，且 `.shell` 一次都没被换掉',
  ins.length > 0 && insNoticeAt.length === 0 && ins.every((s) => s.shell),
  ins.length === 0
    ? `一次都没采到（${insideStudio.err ?? '未知'}）`
    : `采样 ${ins.length} 次（拦了 ${heldRsc.length} 条），\`.notice\` 出现 ${insNoticeAt.length} 次 · ` +
        `.shell 在场 ${[...new Set(ins.map((s) => s.shell))].join('/')}（要 true）`,
)

check(
  '3b 那 1.5s 里旧那一屏还在（`.cl` 是 /home 的标志物）',
  insHeld.length > 0 && insHeld.every((s) => s.old),
  insHeld.length
    ? `拦截期间 ${insHeld.length} 次采样，/home 标志物在场 ${[...new Set(insHeld.map((s) => s.old))].join('/')}（要 true）` +
        ` · 骨架 ${[...new Set(insHeld.map((s) => s.skel))].join('/')}（开发档不该出现）`
    : '拦截期间一次都没采到',
)

check(
  '3c 放行之后 `/shelf` 真的到了（末尾那一段：书架在场、`/home` 已退场）',
  insTail.length > 0 && insTail.every((s) => s.next && !s.old),
  insTail.length
    ? `末尾 ${insTail.length} 次采样（t≥${insTail[0].t}ms）：书架 ${[...new Set(insTail.map((s) => s.next))].join('/')}（要 true）` +
        ` · /home 标志物 ${[...new Set(insTail.map((s) => s.old))].join('/')}（要 false）`
    : '末尾一段一次都没采到',
)

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 4：冷启动那一趟的 HTML 里**骨架在内容之前**（2026-10-30）
 *
 * 为什么单开一格：`loading.tsx` 在客户端导航里没有出现（判据 2b/3b 量到旧屏留着），
 * 它生效的地方是**服务端流式**——直接打开一屏时，HTML 先吐骨架、再吐内容。
 * 所以这一格判的是"响应体里 `.skel` 确实在，且排在内容标志物之前"。
 * ★ 只判"含 skel"不够：一个空文件也能被 Next 渲染成空骨架；要它**在内容前**，
 *   才证明它是流式的第一帧，而不是被塞到了页面尾巴上。
 * ★ 客户端导航里为什么没有它：RSC 没到之前，路由手里没有新树，旧屏照旧留着——
 *   这是开发档的读数。生产档开了预取，骨架可能在点下去那一刻出现，**这一条没量**。
 * ══════════════════════════════════════════════════════════════════════════ */
const cold = await evaluate(`(async () => {
  const out = {}
  for (const [path, mark] of [['/home', 'cl__'], ['/shelf', 'shelf__']]) {
    const html = await (await fetch(path, { credentials: 'same-origin' })).text()
    const skel = html.indexOf('skel')
    const content = html.indexOf(mark)
    out[path] = { skel, content, has: skel >= 0, before: skel >= 0 && content >= 0 && skel < content }
  }
  return out
})()`)
const coldAll = Object.values(cold)
check(
  '4 冷启动：两屏的 HTML 里都有骨架，且骨架排在内容之前',
  coldAll.length === 2 && coldAll.every((c) => c.has && c.before),
  Object.entries(cold)
    .map(([p, c]) => `${p} skel@${c.skel} 内容@${c.content} ${c.before ? '✓' : '✗'}`)
    .join(' · '),
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
