/**
 * chk-perf.mjs —— **页面级**性能读数（2026-10-20，计划表 B6）
 *
 * ```bash
 * NEXT_DIST_DIR=.next-perf pnpm build
 * NEXT_DIST_DIR=.next-perf PORT=3370 npx next start
 * node scripts/chk-perf.mjs http://127.0.0.1:3370
 * node scripts/chk-perf.mjs http://127.0.0.1:3370 --routes=root --repeat=5 --shot=perf
 * ```
 *
 * ── 为什么要有这一支 ────────────────────────────────────────────────────────
 *
 * 在这之前，仓库里的性能读数**全是资产级的**（缩略档 35.8×、首屏少拉 305.9 KB、
 * 每帧写入 18.6 次……），**一条页面级指标都没有**。而评分表那一栏的原话是
 * 「首屏加载速度、渲染性能」——拿字节数回答它，是答了另一个问题。
 *
 * ★ **量的是生产构建，不是 dev**。dev server 现场编译、chunk 不压缩、每个模块一个
 *   请求，在它上面量出来的 LCP 说的不是上线后的那件事。所以这一支要求一个
 *   `next start`（构建产物），并由 `--dist` 提醒你量的是哪一份。
 *
 * ★ **直连 CDP，不进预览面板**：那个面板把 rAF 与 transition 一起冻住
 *   （见 `preview-pane-hidden-freezes-raf-and-transitions` 那条），
 *   同一条理由写在 `chk-mobile.mjs` / `chk-reader-desk.mjs` 头上。
 *
 * ── 五个指标，各自的定义写在这里（**离开定义它就不是一个数**）──────────────
 *
 * | 指标 | 怎么算 | 出处 |
 * |---|---|---|
 * | TTFB | `navigation.responseStart - startTime` | Navigation Timing |
 * | FCP | `paint` 里 `first-contentful-paint` 的 `startTime` | Paint Timing |
 * | LCP | 最后一个 `largest-contentful-paint` 条目，**连元素一起记** | LCP |
 * | CLS | `layout-shift` 里 `!hadRecentInput` 的 `value` 求和 | Layout Instability |
 * | TBT | FCP 之后、`FCP + 10 s` 之前的所有 long task：`Σ max(0, duration − 50 ms)` | 见下面那条 ★ |
 *
 * ★ **TBT 的窗口是这一支自己写死的，与 Lighthouse 不完全一样**，所以说清楚：
 *   Lighthouse 的窗口是 FCP → TTI（可交互时刻），而 TTI 要另算一套"网络静默 +
 *   无长任务"的判据。这一支取的是 **FCP → FCP+10 s**（并**明说**它是近似）：
 *   第一屏要量的东西都落在这十秒里，而 TTI 那套算法本身在动画站上也不稳。
 *   换窗口就会换出另一个数，所以报告里那个数旁边必须一起写窗口。
 *
 * ── 两档：不节流 与 CPU ×4 ─────────────────────────────────────────────────
 *
 * ★ 只看不节流那一档等于没量 TBT：这台机器 24 核，主线程根本堵不上，
 *   TBT 必然是 0.0 —— 一个**说得通、但什么也没说的数**。
 *   所以每一格都跑两档，报的是 **×4 那一档**（它才是"中端手机"这一档）。
 * ★ 而"节流到底生效了没有"**不能用页面自己的指标去证**：一个静态页在 ×4 下
 *   LCP 照样可以更小（首次导航的冷启动、缓存温度都会影响它——第一版就是这么
 *   把自己判红的，LCP 248ms 不节流 vs 136ms 节流）。所以自检改成**直接量尺子**：
 *   在同一个页面上跑一段固定的 JS 忙循环，×4 那档必须慢出 2 倍以上。
 *   量不到就说明节流没生效，这一支当场判不过——探针得先证明自己在量那个东西。
 *
 * ── 两条防空集的判据 ────────────────────────────────────────────────────────
 *
 * ★ `chk-mobile.mjs` 付过两次学费：判据在**一个什么都没有的页面**上一样能全绿。
 *   所以这里每一格都验**这一屏真的有内容**（主张句/标题非空），并且桌面首页那一格
 *   还要验那 12 张 `/art/` 封面**确实被取了**（手机上反过来一张都不取——
 *   与 `chk-mobile.mjs` 判据 7f/7g 量的是同一件事）。
 *
 * ★ 也**不许把"没量到"画成"很差"**：`390×844` 那一档的首页**一个 LCP 候选都没有**
 *   （实测，成因见下），报告里那一格写「无候选」，不写 `NaN`、也不写"差"。
 *   没测成与测出来很差是两件事（`measurement-budget-is-ample` 同族的账）。
 *
 * ── 判词用的三档 ────────────────────────────────────────────────────────────
 *
 * 用的是 **Web Vitals / Lighthouse 那套公认分档**（LCP 2.5 / 4.0 s、CLS 0.1 / 0.25、
 * TBT 200 / 600 ms），**不是本仓库自己拍的**：这几个数是外部标准，
 * 自己另定一套只会让读数没法与任何东西比。**本机 localhost 上的绝对秒数**
 * 不是用户侧的数（没有网络延迟、没有真实设备）——它量的是**我们自己的代码**这一半。
 *
 * ── 参数 ────────────────────────────────────────────────────────────────────
 *
 * `--routes=root,booklist,login`（**不带前导斜杠**，`root` 就是首页——见下面那条 MSYS 的坑）
 * `--repeat=3` 每格连跑几次（取中位；**单跑一次的 LCP 只是那一次的 LCP**）
 * `--cpu=4` 节流倍数；`--shot=前缀` 顺手存 ×4 那档的首屏截图
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const positional = argv.filter((item) => !item.startsWith('--'))

const BASE = (positional[0] ?? 'http://127.0.0.1:3370').replace(/\/$/, '')

/**
 * 路由写成**不带前导斜杠**的名字（`root` = `/`）。
 *
 * ★ 与 `chk-mobile.mjs` 头上那条同一个成因：Git Bash（MSYS）会把**以 `/` 开头**的
 *   参数值改写成 Windows 路径——实测 `--routes=/` 到了脚本里已经是
 *   `--routes=E:/app/Git/Git/`，于是 `Page.navigate` 收到一个拼出来的乱地址，
 *   而它的报错是 **`Cannot navigate to invalid URL`，页面停在 about:blank**：
 *   看着像注入脚本没跑，其实是路由根本没出去（第一次写这一支就是这么坏的）。
 * ★ 所以：拼 URL 的活在脚本里做；一旦发现那一项长得像 Windows 路径就**报错退出**
 *   ——那种情况下量出来的是一张空白页，而空白页上每一个指标都很好看。
 */
const routeOf = (name) => {
  const clean = name.trim().replace(/^[/\\]+/, '')
  if (clean === '' || clean === 'root') return '/'
  if (/^[A-Za-z]:/.test(clean) || clean.includes('\\')) {
    console.error(
      `路由 "${name}" 看起来是被 Git Bash 改写过的 Windows 路径。\n` +
        `请写不带前导斜杠的名字：--routes=root,booklist（root 就是首页）`,
    )
    process.exit(1)
  }
  return `/${clean}`
}
const ROUTES = flag('routes', 'root,booklist,login')
  .split(',')
  .filter((item) => item !== '')
  .map(routeOf)
const REPEAT = Math.max(1, Number(flag('repeat', '3')))
const RATE = Number(flag('cpu', '4'))
const SHOT = flag('shot', '')
const OUT = resolve(flag('out', '.out/perf'))
const PORT = Number(flag('port', '9333'))
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')

/** 三个视口。★ 桌面那一档同时是"12 张封面该被取全"那一格的判据（见文件头） */
const VIEWPORTS = [
  { name: '桌面 1440×900', width: 1440, height: 900, mobile: false, art: 12 },
  { name: '平板 768×1024', width: 768, height: 1024, mobile: true, art: 0 },
  { name: '手机 390×844', width: 390, height: 844, mobile: true, art: 0 },
]

/** Web Vitals 的三档（外部标准，见文件头）。`null` / 非数一律不套档 */
const BANDS = { lcp: [2500, 4000], cls: [0.1, 0.25], tbt: [200, 600] }
const band = (value, [good, ok]) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '——'
  return value <= good ? '好' : value <= ok ? '及格' : '差'
}
const ms = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}` : '——'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
}

await mkdir(OUT, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${resolve(OUT, 'chrome-profile')}`,
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
/** 取图账：`/art/` 那 12 张（判断"我们量的是不是那一屏"，见文件头） */
let artReqs = []
let bytes = 0
let inFlight = 0
let lastActivity = 0

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Network.requestWillBeSent') {
    inFlight += 1
    lastActivity = Date.now()
    const url = msg.params.request.url
    if (/\/art\/[^/]+\.webp/.test(url)) artReqs.push(url.split('/').pop())
  }
  if (msg.method === 'Network.loadingFinished') {
    inFlight = Math.max(0, inFlight - 1)
    lastActivity = Date.now()
    bytes += msg.params.encodedDataLength ?? 0
  }
  if (msg.method === 'Network.loadingFailed') {
    inFlight = Math.max(0, inFlight - 1)
    lastActivity = Date.now()
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
  if (res.result?.exceptionDetails) {
    const detail = res.result.exceptionDetails
    throw new Error(`页面里报错：${detail.text} ${detail.exception?.description ?? ''}`.trim())
  }
  return res.result?.result?.value
}

/**
 * 观察器必须在**页面自己的任何脚本之前**装上，所以走
 * `Page.addScriptToEvaluateOnNewDocument`：从第一帧开始采样，而不是
 * "导航完了再去看还剩什么"（LCP 的最后一个条目、以及头几百毫秒里的
 * layout-shift，后者尤其报不回来）。
 *
 * ★ 注释里**不许有反引号**：这一整段是外面那个模板字符串的一部分，
 *   一个反引号就会把它截断，而报错指向的行号不是真错处（写这一支时中过两次）。
 */
const OBSERVER = `
window.__perf = { lcp: [], cls: [], long: [], fcp: null, shifts: [] };
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__perf.lcp.push({ t: e.startTime, size: e.size, tag: e.element ? e.element.tagName : null,
        cls: e.element && e.element.className ? String(e.element.className).slice(0, 60) : null });
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch (err) {}
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__perf.cls.push(e.value);
      const src = (e.sources || []).map((s) => s.node ? (s.node.tagName + '.' + String(s.node.className || '').slice(0, 40)) : '?');
      window.__perf.shifts.push({ v: e.value, src });
    }
  }).observe({ type: 'layout-shift', buffered: true });
} catch (err) {}
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__perf.long.push({ t: e.startTime, d: e.duration });
  }).observe({ type: 'longtask', buffered: true });
} catch (err) {}
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
} catch (err) {}
`

await send('Page.enable')
await send('Network.enable')
await send('Runtime.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER })

/**
 * 尺子自检用的忙循环。★ 它必须在**页面里**跑：`setCPUThrottlingRate` 节的是
 * 渲染进程的 JS，在 node 这一侧计时量不到它。
 */
const BENCH = `(() => {
  const t0 = performance.now();
  let s = 0;
  for (let i = 0; i < 1200000; i += 1) s += (i * 7) % 13;
  return { ms: performance.now() - t0, s };
})()`

async function navigate(route, viewport, rate, reduced = false) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  })
  await send('Emulation.setCPUThrottlingRate', { rate })
  await send('Emulation.setEmulatedMedia', {
    features: reduced ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [],
  })
  /**
   * ★ **每一格都从冷缓存跑**（`Network.clearBrowserCache`）。
   *   不清的话，同一格里第 2 次以后的导航吃的是 HTTP 缓存：实测同一个
   *   `/booklist` 第一趟 1587 KB、第二趟 22 KB，而表里报的是两者的中位——
   *   一个既不是"首次访问"也不是"回访"的数（`bytes` 那一列尤其明显，
   *   LCP 也一样会被缓存喂快）。真实用户第一次打开那一屏，就是冷缓存这一档。
   * ★ 代价说清楚：这样量出来的**不是**"回访有多快"。回访那一档靠
   *   `next.config.ts` 的 `staleTimes` 与浏览器缓存，另有读数（见那个文件头）。
   */
  await send('Network.clearBrowserCache')
  const nav = await send('Page.navigate', { url: `${BASE}${route}` })
  if (nav.error) throw new Error(`导航没跑成（${BASE}${route}）：${nav.error.message}`)
  /**
   * ★ 先等**这一次导航真的提交**，再等 readyState。
   *   顺序错了的症状很闷：`Page.navigate` 是异步的，而此刻文档还是那张
   *   `about:blank` —— 它的 `readyState` **本来就是 `complete`**，于是循环一格都不等，
   *   接下来那段取数就打在 about:blank 上（`window.__perf` 自然还不存在）。
   *   第一次写这一支就是这么坏的（实测报 "Cannot read properties of undefined"）。
   */
  for (let i = 0; i < 200; i += 1) {
    const href = await evaluate('location.href')
    if (typeof href === 'string' && href.startsWith(BASE)) break
    await sleep(50)
  }
  for (let i = 0; i < 120; i += 1) {
    const ready = await evaluate('document.readyState')
    if (ready === 'complete') break
    await sleep(100)
  }
  // 网络静默：连续 1000ms 没有在飞请求就收手（上限 15s）
  const started = Date.now()
  for (;;) {
    await sleep(250)
    if (Date.now() - lastActivity > 1000 && inFlight === 0) break
    if (Date.now() - started > 15000) break
  }
  // LCP 在 load 之后还会长一会儿（图片解码完才报），再多等一拍
  await sleep(700)
  const bench = await evaluate(BENCH)
  return {
    benchMs: bench?.ms ?? null,
    ...(await evaluate(`(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const p = window.__perf || { lcp: [], cls: [], long: [], shifts: [] };
    const lcp = p.lcp.length ? p.lcp[p.lcp.length - 1] : null;
    const fcp = p.fcp;
    const window10 = (fcp || 0) + 10000;
    const longs = p.long.filter((e) => fcp === null || e.t >= fcp).filter((e) => e.t <= window10);
    // ★ 取的是 d（观察器里存的那个字段名），不是 e.duration：写成 duration 时它恒为
    //   undefined，于是 TBT 变成 NaN —— 而 NaN 在报告里的样子是"很差不合格"，
    //   不是"没量到"。
    const tbt = longs.reduce((sum, e) => sum + Math.max(0, e.d - 50), 0);
    const shifts = p.shifts;
    const worst = shifts.slice().sort((a, b) => b.v - a.v)[0] || null;
    return {
      ttfb: nav.responseStart !== undefined ? nav.responseStart - nav.startTime : null,
      fcp, lcp: lcp ? lcp.t : null, lcpTag: lcp ? lcp.tag : null, lcpCls: lcp ? lcp.cls : null,
      // ★ 候选个数：**0 个 = 这一格量不出 LCP**，与"LCP 很小"是两件事
      lcpCount: p.lcp.length,
      cls: p.cls.reduce((a, b) => a + b, 0), shifts: shifts.length, worstShift: worst,
      tbt, longTasks: longs.length,
      claim: (document.querySelector('.hero__claim, h1')?.textContent || '').trim().slice(0, 30),
      title: document.title,
    };
  })()`)),
  }
}

/** 中位数。★ 单跑一次的 LCP 只是"那一次"的 LCP，所以每一格取 `--repeat` 次的中位 */
const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const pick = (runs, key) => runs.map((run) => run[key]).filter((v) => typeof v === 'number')

// 热身：第一次导航要付编译/缓存的冷启动，把它算进读数里会让第一格偏慢
await navigate(ROUTES[0], VIEWPORTS[0], 1)
console.log('（热身一次，不计入读数）\n')

const table = []
for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    for (const rate of [1, RATE]) {
      const runs = []
      for (let round = 1; round <= REPEAT; round += 1) {
        artReqs = []
        bytes = 0
        inFlight = 0
        lastActivity = Date.now()
        const sample = await navigate(route, viewport, rate)
        runs.push({ ...sample, bytes, art: artReqs.length })
        if (SHOT && round === 1 && rate === RATE) {
          const shot = await send('Page.captureScreenshot', { format: 'png' })
          await writeFile(
            resolve(OUT, `${SHOT}-${route.replace(/\W+/g, '_')}-${viewport.width}.png`),
            Buffer.from(shot.result.data, 'base64'),
          )
        }
      }
      const row = {
        viewport: viewport.name,
        route,
        rate,
        condition: 'default',
        expectArt: viewport.art,
        ttfb: median(pick(runs, 'ttfb')),
        fcp: median(pick(runs, 'fcp')),
        lcp: median(pick(runs, 'lcp')),
        lcpCount: median(pick(runs, 'lcpCount')),
        cls: median(pick(runs, 'cls')) ?? 0,
        tbt: median(pick(runs, 'tbt')) ?? 0,
        longTasks: median(pick(runs, 'longTasks')),
        benchMs: median(pick(runs, 'benchMs')),
        bytes: median(pick(runs, 'bytes')),
        art: median(pick(runs, 'art')),
        lcpTag: runs.find((run) => run.lcpTag)?.lcpTag ?? null,
        /**
         * CLS 最大的一次位移**是谁造成的**。
         * ★ 只报一个 0.3 不等于知道该去改哪儿；这一格要能说出是哪个元素
         *   （与「画面审核的 where 也要带上」是同一条：产物是给人去翻页用的）。
         */
        worstShift:
          runs
            .map((run) => run.worstShift)
            .filter(Boolean)
            .sort((a, b) => b.v - a.v)[0] ?? null,
        // 原始的每一次，留着看抖动的量级（中位数会把它藏起来）
        raw: {
          lcp: pick(runs, 'lcp'),
          tbt: pick(runs, 'tbt'),
          cls: pick(runs, 'cls'),
          bench: pick(runs, 'benchMs'),
        },
        empty: !runs.some((run) => run.claim),
      }
      table.push(row)
      console.log(
        `· ${viewport.name} ${route} ${rate === 1 ? '不节流' : `CPU×${rate}`} — ` +
          `LCP ${ms(row.lcp)}ms(${band(row.lcp, BANDS.lcp)}${row.lcpCount === 0 ? '·无候选' : ''}) · ` +
          `FCP ${ms(row.fcp)}ms · CLS ${row.cls.toFixed(3)}(${band(row.cls, BANDS.cls)}) · ` +
          `TBT ${row.tbt.toFixed(1)}ms(${band(row.tbt, BANDS.tbt)}) · ` +
          `${row.longTasks ?? '?'} 个长任务 · 忙循环 ${ms(row.benchMs)}ms · ` +
          `${((row.bytes ?? 0) / 1024).toFixed(0)}KB · art ${row.art}`,
      )
    }
  }
}

/**
 * ── 补跑：**一个 LCP 候选都没有**的那些格子，在 `prefers-reduced-motion: reduce` 下再量一次 ──
 *
 * ★ 为什么要补，而不是直接写"量不出来"就完了：那些格子量不出来是**有成因的**，
 *   而且成因与"页面慢"无关——手机上首页那一屏**唯一的内容**（`.hero__copy` 的三层）
 *   是靠一段 `hero-rise` 入场动画进场的（`hero-orbit.css` 的 `animation: hero-rise`），
 *   动画起手是 `opacity: 0`，而 opacity/transform 的动画跑在**合成器**上：
 *   主线程不会再为它产生一次 contentful paint，于是 Chrome 一个 LCP 候选都不报。
 *   实测旁证：同一支脚本、同一个 390×844 视口，`/booklist` 与 `/login` 都量得出 LCP，
 *   桌面 1440 上的首页也量得出（那一档环在演，`<img>` 是候选）——
 *   所以这不是探针的毛病，是**那一屏的渲染性质**。
 * ★ 而 §7 那条无障碍规则（`@media (prefers-reduced-motion: reduce)`）里写着
 *   `animation: none`：那一档文案**当场就是可见的**，LCP 也就量得出来。
 *   所以这一格给的是**减动效条件下的 LCP**，标签写死在 `condition` 上——
 *   它**不是**"手机上首页的 LCP"，两者不能混着引用。
 */
const noLcp = table.filter((row) => row.rate === RATE && row.lcpCount === 0)
for (const cell of noLcp) {
  const viewport = VIEWPORTS.find((item) => item.name === cell.viewport)
  const runs = []
  for (let round = 1; round <= REPEAT; round += 1) {
    artReqs = []
    bytes = 0
    inFlight = 0
    lastActivity = Date.now()
    runs.push({ ...(await navigate(cell.route, viewport, RATE, true)), bytes, art: artReqs.length })
  }
  const row = {
    ...cell,
    condition: 'reduced-motion',
    fcp: median(pick(runs, 'fcp')),
    lcp: median(pick(runs, 'lcp')),
    lcpCount: median(pick(runs, 'lcpCount')),
    cls: median(pick(runs, 'cls')) ?? 0,
    tbt: median(pick(runs, 'tbt')) ?? 0,
    longTasks: median(pick(runs, 'longTasks')),
    benchMs: median(pick(runs, 'benchMs')),
    lcpTag: runs.find((run) => run.lcpTag)?.lcpTag ?? null,
    raw: {
      lcp: pick(runs, 'lcp'),
      tbt: pick(runs, 'tbt'),
      cls: pick(runs, 'cls'),
      bench: pick(runs, 'benchMs'),
    },
  }
  table.push(row)
  console.log(
    `· ${row.viewport} ${row.route} CPU×${RATE} **减动效** — ` +
      `LCP ${ms(row.lcp)}ms(${band(row.lcp, BANDS.lcp)}${row.lcpCount === 0 ? '·仍然无候选' : ''}) · ` +
      `FCP ${ms(row.fcp)}ms · TBT ${row.tbt.toFixed(1)}ms`,
  )
}
// 复位，免得后面若还有导航带着这条媒体特性
await send('Emulation.setEmulatedMedia', { features: [] })

console.log('\n── 判据 ────────────────────────────────────────────────')

const throttled = table.filter((row) => row.rate === RATE && row.condition === 'default')
const baseOf = (row) =>
  table.find(
    (o) =>
      o.rate === 1 &&
      o.condition === 'default' &&
      o.route === row.route &&
      o.viewport === row.viewport,
  )

/**
 * ★ 自检：节流真的在起作用——**直接量尺子**（同一段忙循环在两档下的耗时），
 *   而不是拿页面指标去猜。见文件头那段。
 */
const benchPairs = throttled
  .map((row) => ({
    slow: row.benchMs,
    fast: baseOf(row)?.benchMs,
    where: `${row.viewport} ${row.route}`,
  }))
  .filter((pair) => typeof pair.slow === 'number' && typeof pair.fast === 'number')
const worstRatio = benchPairs.length
  ? Math.min(...benchPairs.map((pair) => pair.slow / pair.fast))
  : null
check(
  `CPU×${RATE} 那一档确实在节流（同一段忙循环至少要慢 ${RATE / 2}×）`,
  worstRatio !== null && worstRatio >= RATE / 2,
  worstRatio === null
    ? '一格都没量到忙循环'
    : `最差的一格 ×${worstRatio.toFixed(2)}（${benchPairs.sort((a, b) => a.slow / a.fast - b.slow / b.fast)[0]?.where}）`,
)

/** 空集护栏：量到的必须是**真有内容的那一屏** */
const emptyCells = table.filter((row) => row.empty)
check(
  '每一格都量到了真的有内容的首屏（标题/主张句非空）',
  emptyCells.length === 0,
  emptyCells.length
    ? `${emptyCells.length} 格是空屏：${emptyCells.map((r) => `${r.viewport}${r.route}`).join('、')}`
    : '',
)

/** 桌面首页取全 12 张（与 chk-mobile.mjs 判据 7 同一件事，这里是旁证） */
const homeDesktop = table.find(
  (row) => row.route === '/' && row.viewport.startsWith('桌面') && row.rate === 1,
)
check(
  '桌面首页确实取了那 12 张封面（量的就是那一屏）',
  (homeDesktop?.art ?? 0) === 12,
  `量到 ${homeDesktop?.art ?? 0} 张`,
)

/**
 * ★ 没量到 LCP 的那几格：**点名**、并说明成因，而不是在表里变成一个看着像"很差"的数。
 *   补跑（减动效）那一格量得出候选，就是成因判断的**证伪点**：
 *   如果减动效之后**仍然**没有候选，那说明原因不是入场动画，这条会红。
 */
/**
 * 默认那档里量不出 LCP 的格子与"减动效补跑"那一组，各自只算一次（补跑的循环在上面）
 */
const remedy = table.filter((row) => row.condition === 'reduced-motion')
check(
  '默认那档量不出 LCP 的格子，成因说得清而且**减动效补跑量得出**（这条是成因判断的证伪点）',
  noLcp.every((cell) =>
    remedy.some(
      (row) => row.route === cell.route && row.viewport === cell.viewport && row.lcpCount > 0,
    ),
  ),
  noLcp.length === 0
    ? '没有这样的格子'
    : `${noLcp.map((r) => `${r.viewport} ${r.route}`).join('、')}：默认无候选；减动效下 ` +
        remedy
          .filter((row) =>
            noLcp.some((cell) => cell.route === row.route && cell.viewport === row.viewport),
          )
          .map((row) => `${ms(row.lcp)}ms`)
          .join('、'),
)

console.log('\n── 三档（Web Vitals 的公认分档，见文件头；只列 ×' + RATE + ' 的默认档）──')
console.log('视口           路由        LCP            FCP      CLS              TBT')
for (const row of throttled) {
  console.log(
    `${row.viewport.padEnd(14)} ${row.route.padEnd(11)} ` +
      `${(ms(row.lcp) + 'ms').padEnd(6)} ${band(row.lcp, BANDS.lcp).padEnd(4)} ` +
      `${(ms(row.fcp) + 'ms').padEnd(8)} ` +
      `${row.cls.toFixed(3)} ${band(row.cls, BANDS.cls).padEnd(4)} ` +
      `${(row.tbt.toFixed(1) + 'ms').padStart(9)} ${band(row.tbt, BANDS.tbt)}`,
  )
}
if (remedy.length) {
  console.log(
    '\n── 补跑：默认档量不出 LCP 的那几格，**减动效**再量一次（★ 这一栏不是"那一屏的 LCP"）──',
  )
  for (const row of remedy) {
    console.log(
      `${row.viewport.padEnd(14)} ${row.route.padEnd(11)} ` +
        `LCP ${(ms(row.lcp) + 'ms').padEnd(6)} ${band(row.lcp, BANDS.lcp).padEnd(4)} ` +
        `（${row.lcpTag ?? '?'}）`,
    )
  }
}

/** 有位移的格子要说清是**谁**在动——不然那个数只够判红，不够去改 */
const shifting = throttled.filter((row) => row.cls > 0.05)
if (shifting.length) {
  console.log('\n── CLS 的来源（只列 ×' + RATE + ' 那一档里 > 0.05 的格子）──')
  for (const row of shifting) {
    console.log(
      `${row.viewport} ${row.route} — CLS ${row.cls.toFixed(3)} · 最大的一次位移 ${row.worstShift ? row.worstShift.v.toFixed(3) : '?'} 来自 ${row.worstShift ? (row.worstShift.src || []).join('、') : '（没记到源）'}`,
    )
  }
}

console.log('\n── 抖动（同一格连跑 ' + REPEAT + ' 次）────────────────────────')
for (const row of table) {
  console.log(
    `${row.viewport.padEnd(14)} ${row.route.padEnd(11)} ${row.rate === 1 ? '不节流' : `×${row.rate}`} — ` +
      `LCP ${row.raw.lcp.map((v) => Math.round(v)).join('/') || '（无候选）'} · ` +
      `忙循环 ${row.raw.bench.map((v) => Math.round(v)).join('/')}`,
  )
}

await writeFile(
  resolve(OUT, 'chk-perf.json'),
  JSON.stringify(
    { base: BASE, rate: RATE, repeat: REPEAT, at: new Date().toISOString(), table },
    null,
    2,
  ),
  'utf8',
)
console.log(`\n读数已存 ${resolve(OUT, 'chk-perf.json')}`)

const failed = results.filter((item) => !item.ok)
chrome.kill()
console.log(failed.length === 0 ? '\n全部判据通过' : `\n${failed.length} 条判据不过`)
process.exit(failed.length === 0 ? 0 : 1)
