/**
 * chk-reader-desk.mjs —— 量阅读器那层底图（「桌面」）
 *
 * ```bash
 * node scripts/chk-reader-desk.mjs http://127.0.0.1:3341 .out/reader-desk.png
 * node scripts/chk-reader-desk.mjs http://127.0.0.1:3341 --book=dino
 * node scripts/chk-reader-desk.mjs http://127.0.0.1:3341 --reader=xiaoyu-r1-xxxx --w=390 --h=844
 * ```
 *
 * ★ 为什么直连 CDP、不进预览面板：**那个面板把 rAF 与 transition 一起冻住**
 *   （`preview-pane-hidden-freezes-raf-and-transitions` 那条记过），量几何会读到过渡起点。
 *   无头 Chrome 有真帧。同一条理由写在 `chk-shared-reader.mjs` 头上。
 *
 * ── 四条断言，每条都只有真做才会不同 ─────────────────────────────────────────
 *
 * | # | 量什么                                                     | 错了会怎样                                                                        |
 * | - | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
 * | 1 | 底图那一层的 rect 就**是整块视口**（四边各 ≤1px）           | 又收回一条"横幅"（`absolute; inset: 0` 只盖 `.blr` 那 830px，上下各露一条 `--bg`） |
 * | 2 | 每一行字**真被压着的那些像素**对这行字色 ≥ 4.5:1（逐档底图） | 图铺到字上、字读不清（`--ink-muted` 在木桌那张的说明行只有 2.15:1）               |
 * | 3 | **设置里那一档真的到了这一屏**（逐档写偏好再重载）          | 偏好写了没人读（界面能选、底下没接上）                                            |
 * | 4 | 底图**之外**那行「← 回灵感书单」真的画在图的**上面**        | 那行字整个被图盖住（2026-10-18 晚**真的发生过**一次，见下）                        |
 *
 * ★ 判据 4 是补上的一次真实失手：改 `fixed; inset: 0` 那一轮给 `.reader-page__back`
 *   加了 `position: relative`，以为"定位就在静态内容之上" —— 可**定位元素之间是按树序
 *   画的**，`.blr__desk` 在 `<nav>` 之后，于是那行字被图整个盖住。
 *   ★ 当时没验出来，是因为探针判的是"`elementsFromPoint` 的栈顶是不是那个 <a>"，
 *     而底图身上有 `pointer-events: none`：**命中测试会把它整个跳过**，
 *     那条判据恒真。所以这一条的判据落在**像素**上 —— 数这行字自己矩形里的墨，
 *     只有它真被画出来才数得到。判据的选法见 `ui-probe-clicks-land-before-hydration`。
 *   ★ 这一行的颜色（判据 2 也量它）与它有没有被画出来是**两件事**：判据 2 量的是
 *     "它脚下那些像素"（把图藏掉之后仍然成立），盖住了照样绿 —— 两件都要量。
 *
 * ★ 判据 3 是这一轮**唯一**能证伪"设置那条链接通了"的地方：`localStorage` 里写什么
 *   和屏幕上铺什么之间隔着 hydration、隔着 `useReaderPaper`、隔着 CSS 变量，
 *   中间任何一处断了，界面上都只是"选了没反应"。判据取的是**图文件名**
 *   （只有真换过才会变），不是"元素在不在"——SSR 的 HTML 里那个 div 本来就在。
 *   ★ 判据 2 就搭在这一条的循环里：它要**逐档底图**各量一次"压在它上面的字还读不读得清"，
 *     而这一圈正好逐档重载。判据 4 也搭在这一圈里（它要"字还在"的那一张截图）。
 *
 * ── 2026-10-18 晚**删掉**的五条：染色与明暗 ──────────────────────────────────
 *
 * 那五条量的是 `.blr__tint` / `.blr__tint-face`（随页染色，连同 `booklistTints.ts`
 * 那张离线色表）与 `.blr__shade`（书页内侧的明暗）。用户当晚说「把书籍四周的仿真书
 * 效果删掉吧，只有背景就行」，并在"删到哪一层"那一问里选了**连书页明暗也删** ——
 * 于是这两层从两台阅读器里**删掉**了，量它们的判据跟着一起删：不留一个跑不绿、
 * 也没人打算跑绿的量具（CLAUDE.md「不糊弄」）。
 * ★ 顺带带走的还有"跳过"那套机件（`skipNote` / `skips`）：它当初唯一的存在理由是
 *   独读版按设计没有染色层。现在两台都没有、也都**不该有**，三条判据在两台上都跑，
 *   于是"跳过"这个第三态没有存在的必要 —— 留着它反而会让"没量"重新变得体面。
 *
 * ── 判据 1/2 在 2026-10-18 第三轮被**换过一次** ─────────────────────────────
 *
 * 换之前是一条几何证明：底图挂在整个 `.blr` 上，竖直遮罩在每一行字的上沿
 * **再往上 4px** 处必须 α = 0 —— 证的是"一行字都不压在图上"。
 * 用户看了那一版说「背景铺平整个屏幕呀」，于是遮罩整条删掉、底图改成
 * `fixed; inset: 0`，**那条证明跟着失效**（它证的正是这一版要拆掉的东西）。新的两条是：
 *
 * · 判据 1 量"铺满"这句话本身：底图层的 rect 与视口相等。
 *   ★ 量的是**结果**（盖住了多大），不是手段（`position: fixed`）——手段换了而结果对，
 *     这一条不该红；结果没达到，手段再对也没用。
 * · 判据 2 换成**光度证明**：把每一行字隐掉（`color: transparent`，布局一个字不动）
 *   截一张屏，用 sharp 量那一横条里**最暗的 1%** 对这些字自己的颜色还剩多少对比度。
 *   ★ 这不是把门槛放松了，是换了一条**更严也更近**的：几何那条的结论是"那里是纯
 *     `--bg`"（于是必然过线，其实什么都没验到）；这条量的是**那几个字真被哪些像素压着**。
 *   ★ 采样取整行那一横条的最暗 1%，比"字真正压着的那几个像素"**更严**（把字左右两侧
 *     的底也算进来了）。偏严的那一头不许红，这是刻意的。
 *   ★ 第四轮（删掉暖光与染色那一晚）**复量过一次**：那两层原先是**往上提亮**的，
 *     删掉之后字脚下只会更暗，所以判据 2 当场按七档底图 × 三个视口重跑了一遍，
 *     新读数见 README §五。
 *
 * ★ 两条判据的取值都**从浏览器读**（rect / `getComputedStyle().color`），脚本里不重抄
 *   一份数 —— 与 `check-scrim.mts` 那条纪律同源：一份写在量具里的数，改 CSS 的人不会
 *   想到来改它，于是量出来的是一份早就没有的设计。解析不出来/取不到就**当场报错**，
 *   不许退回到内置默认值。（原来那段"逐段读遮罩停点"的写法跟着遮罩一起删了：
 *   留一个没人读的量具，下一个人会以为它在看着什么事。）
 */

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import sharp from 'sharp'

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
 *   探针只会说"这一屏上没有底图层"。拼 URL 的活在脚本里做，外面只给 id。
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
/** 截图时铺哪一张底图。★ 判据 3 会把盘上那档改来改去（跑完停在最后一档），拍之前要显式写回来 */
const SHOT_PAPER = flag('paper', 'paper')

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
await send('Network.enable')
// 字体稳定下来再量：字行的 rect 直接决定判据 1 的那条线
await send('Emulation.setDeviceMetricsOverride', {
  width: VW,
  height: VH,
  deviceScaleFactor: 1,
  mobile: false,
})

/**
 * 等这一屏**真的画出来**再量。
 *
 * ★ 要等的是什么：dev server 冷编译那一趟会先吐一份"CSS 还没到"的 HTML ——
 *   症状是底图层变成文档流里一个 359×0 的小方块、翻页钮还没 hydrate。
 *   那不是代码坏了，但量出来会是一屏吓人的假数（390×844 那一档撞到过一次：
 *   判据 1 报"层 359×0 @ (8, 53)"、紧接着翻页报"没 hydrate"）。
 *   判据要的是**终态**，那就等终态：DOM 到齐 + 浏览器真的拿它排过版（底图层有高度）
 *   + React 挂上去了。等到就往下走，等不到才是真的坏了。
 * ★ 这里**刻意不去判 `position: fixed`**：那是手段，不是判据要的结果。
 *   拿手段当闸门的话，谁把实现换成别的写法，这一条会先卡住、
 *   报出来的却是一句"页面没画好"——把真因盖掉了。
 */
const ready = async (tries = 40) => {
  for (let i = 0; i < tries; i += 1) {
    const state = await evaluate(`(() => {
      const desk = document.querySelector('.blr__desk, .reader__desk')
      const stage = document.querySelector('.blr__stage, .reader__stage')
      if (!desk || !stage) return 'no-dom'
      if (desk.getBoundingClientRect().height <= 1) return 'no-layout'
      if (!Object.keys(stage).some((k) => k.startsWith('__reactProps$'))) return 'no-hydrate'
      return 'ok'
    })()`)
    if (state === 'ok') return i * 250
    await sleep(250)
  }
  throw new Error('这一屏一直没画好（DOM / 排版 / hydrate 有一样没到）')
}

const go = async (url) => {
  await send('Page.navigate', { url })
  await sleep(1200)
  return ready()
}

/* ── 页里用的小工具：一次拿齐"底图层的几何 + 压在/它上面的那几行字在哪" ─────── */

const DESK_PROBE = `(() => {
  const round = (n) => Math.round(n * 100) / 100
  const box = (el) => {
    const b = el.getBoundingClientRect()
    return { top: round(b.top), left: round(b.left), width: round(b.width), height: round(b.height) }
  }
  const desk = document.querySelector('.blr__desk, .reader__desk')
  if (!desk) return { error: '这一屏上没有底图层' }
  /**
   * 压在底图上的那几行字在哪。
   * ★ 这里只取位置用来**打印**——2026-10-18 第三轮之前的判据 1 是"遮罩在这一行
   *   上沿再往上 4px 处必须 α = 0"，读的是浏览器算出来的遮罩停点；遮罩删掉之后
   *   那段解析（逐段读「颜色 + 位置」+ 分段插值）跟着一起删了。
   *   真正的判据 2 换成截图量真实像素，取材在 TEXT_PROBE。
   */
  const rows = [...document.querySelectorAll(
    '.blr__readout, .blr__total, .blr__meta, .reader__readout, .reader__total, .reader__meta',
  )].map((el) => ({
    sel: el.className.split(' ')[0],
    top: round(el.getBoundingClientRect().top),
  }))
  return {
    paper: desk.getAttribute('data-paper'),
    paint: getComputedStyle(desk).backgroundImage,
    deskBox: box(desk),
    /**
     * 判据 1 的尺子 = **布局视口**（documentElement.client*），不是 inner*。
     * ★ fixed 的 inset: 0 大小由布局视口定，而 innerWidth **把滚动条算在里面**：
     *   有滚动条时用 inner* 当尺子，会把"盖满了"报成"差 15px"。
     *   两个数都报出来，滚动条在不在日志里一眼看得见。
     * ★ 这段注释里不许出现反引号：整段是模板字符串（见 TEXT_PROBE 上面那条）。
     */
    viewport: {
      w: innerWidth,
      h: innerHeight,
      clientW: document.documentElement.clientWidth,
      clientH: document.documentElement.clientHeight,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
    },
    rows,
  }
})()`

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

/* ── 判据 2 的取材：压在底图上的每一行字（含它自己的颜色） ───────────────────── */

/**
 * ★ 两段都塞在 `evaluate()` 里当模板字符串，所以**注释里不能出现反引号**：
 *   多一个反引号会把表达式截断，而 V8 报的错指向的位置不是真错处（踩过一次）。
 *
 * `TEXT_PROBE` 做两件事：把这一屏上压在底图上的每一行字连同颜色报上来，
 * 然后**把这一带的字全隐掉**——只改 `color`，布局一个字不动。
 * ★ 隐掉的范围要比"被量的那几行"**更宽**：翻页钮上的「›」、朗读钮上的「▶ 朗读」
 *   也是这一带的字，留着的话采样会把"字自己那几个深色像素"当成底色，
 *   量出来是一条**假红**（判据说读不清，其实是字把自己的像素算进去了）。
 *   只隐颜色、不隐按钮自己的白底：那圈白是**底**的一部分，不能动。
 * ★ 等底图解码完再量：冷启动时那一屏可能还在拉图，量到的会是上一帧的纯色底。
 */
const TEXT_PROBE = `(async () => {
  const desk = document.querySelector('.blr__desk, .reader__desk')
  if (!desk) return { error: '这一屏上没有底图层' }
  const url = (/url\\("?([^")]+)"?\\)/.exec(getComputedStyle(desk).backgroundImage) || [])[1]
  if (url) {
    await new Promise((done) => {
      const im = new Image()
      im.onload = done
      im.onerror = done
      im.src = url
    })
  }
  const SEL = '.blr__readout, .blr__total, .blr__meta, .reader-page__back a, .reader__readout, .reader__total, .reader__meta'
  const rows = [...document.querySelectorAll(SEL)]
    .filter((el) => (el.textContent || '').trim().length > 0)
    .map((el) => {
      const b = el.getBoundingClientRect()
      return {
        // ★ 底图**之外**那一行单独给个名字：判据 4 要靠它把这一行挑出来。
        //   它的 className 是空的（<a> 在 <nav> 里），不标一下日志里只会留一个 A。
        sel: el.matches('.reader-page__back a')
          ? 'back-link'
          : el.className.split(' ')[0] || el.tagName,
        text: (el.textContent || '').trim().slice(0, 18),
        color: getComputedStyle(el).color,
        left: Math.round(b.left),
        top: Math.round(b.top),
        right: Math.round(b.right),
        bottom: Math.round(b.bottom),
      }
    })
  let hidden = 0
  for (const area of document.querySelectorAll('.blr__bar, .blr__meta, .reader__bar, .reader__meta, .reader-page__back')) {
    for (const el of [area, ...area.querySelectorAll('*')]) {
      el.style.color = 'transparent'
      hidden += 1
    }
  }
  return { rows, hidden }
})()`

/** 量完把字还回去（下一次 `go()` 本来会重载，但末段那张截图不该顶着一屏隐字的屏） */
const UNHIDE_PROBE = `(() => {
  let n = 0
  for (const el of document.querySelectorAll('[style]')) {
    if (el.style.color === 'transparent') {
      el.style.removeProperty('color')
      n += 1
    }
  }
  return n
})()`

/* ── 判据 2 的量法：截图 → 逐行取那一横条 → 最暗 1% 对这行字色的对比度 ──────── */

/** WCAG 相对明度与对比度：与 `check-scrim.mts` / `check-reader-paper.mts` 同一套算法 */
const lin = (v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const relativeLum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrastOf = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** `rgb(r, g, b)` → 三个数。★ 解析不出来/这行字是半透明的就抛，不许猜一个往下量 */
const parseRgb = (text) => {
  const hit = /rgba?\(([^)]+)\)/.exec(String(text))
  if (!hit) throw new Error(`字色解析不出来：${text}`)
  const [r, g, b, a] = hit[1].split(',').map((v) => Number(v.trim()))
  if (a !== undefined && a < 1) throw new Error(`这一行字是半透明的（α=${a}）：${text}`)
  return { r, g, b }
}

/**
 * 一张截图 + 一行字的框 → 那一横条里最暗的 1% 对这行字色的对比度。
 * ★ 取**最暗的 1%**，不取"最暗的那一个像素"（那可能是一个压缩噪声点），
 *   也不取中位（那会把"这几个字正好压在一道木纹上"这件事平均掉）。两个数都报。
 * ★ 框可能与视口相交（窄屏那一档行可能落到屏幕外）：这里夹到截图边界内，
 *   夹不动（整行都在屏幕外）就返回 null，由调用处**明说跳过**，不静默当成通过。
 */
async function measureRow(shot, size, row) {
  const left = Math.max(0, Math.min(row.left, size.width - 1))
  const top = Math.max(0, Math.min(row.top, size.height - 1))
  const width = Math.min(row.right, size.width) - left
  const height = Math.min(row.bottom, size.height) - top
  if (width < 8 || height < 4) return null
  const { data, info } = await sharp(shot)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const lums = new Float64Array(info.width * info.height)
  for (let i = 0, px = 0; i < data.length; i += info.channels, px += 1) {
    lums[px] = relativeLum({ r: data[i], g: data[i + 1], b: data[i + 2] })
  }
  lums.sort()
  const at = (q) => lums[Math.min(lums.length - 1, Math.round((lums.length - 1) * q))]
  const fg = relativeLum(parseRgb(row.color))
  return {
    dark: contrastOf(fg, at(0.01)),
    median: contrastOf(fg, at(0.5)),
    px: info.width * info.height,
  }
}

/* ── 判据 4 的量法：这一行字**自己那个矩形**里有没有墨 ──────────────────────── */

/**
 * ★ 与 `measureRow` 的取材正好**相反**，这是关键：
 *   · 判据 2 把字隐掉，量的是"这行字脚下压着什么像素"（对比度）；
 *   · 判据 4 要字**在**，量的是"这行字到底画出来了没有"（层序）。
 *   被底图盖住时，判据 2 照样绿（它把字藏了，量到的是纸），只有判据 4 会红。
 * ★ 取这一格里**最暗的那个像素**，不是最暗的 1%：这一格里字的占比本来就小，
 *   百分位会把墨稀释掉；被盖住时最暗的也还是纸，区分度够。
 * ★ 160 这个阈值是**实测**卡出来的，不是估的：这行字是 `--ink-soft`（#1c1b22，
 *   灰阶 ≈ 28），底图最亮的那张纸上灰阶 ≈ 228–236（`.out/back-pixels/*.png`）。
 *   两边各留 60 以上的余量，且只在"最暗 ≤ 80"这条上再收一道 —— 两条都要过。
 */
async function measureInk(shot, size, row) {
  const left = Math.max(0, Math.min(row.left, size.width - 1))
  const top = Math.max(0, Math.min(row.top, size.height - 1))
  const width = Math.min(row.right, size.width) - left
  const height = Math.min(row.bottom, size.height) - top
  if (width < 8 || height < 4) return null
  const { data } = await sharp(shot)
    .extract({ left, top, width, height })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let minLuma = 255
  let darkPx = 0
  for (const v of data) {
    if (v < minLuma) minLuma = v
    if (v < 160) darkPx += 1
  }
  return { minLuma, darkPx }
}

/* ── 判据 1：底图铺满整块视口 ───────────────────────────────────────────────── */

// ★ 整段包在 try 里，为的是**出错也把自己那个 Chrome 关掉**。第一版没有这一条，
//   探针一抛异常就留一个无头 Chrome 占着调试端口与 profile 目录；下一次跑会
//   **连到那一个旧进程**、量到上一次那个页面 —— 报出来的"这一屏上没有底图层"，
//   连上的其实是上一次 404 的页。连跑几次就积成一堆。
try {
  await go(`${BASE}${PATH}`)
  const first = await evaluate(DESK_PROBE)
  if (first.error) throw new Error(first.error)

  const box = first.deskBox
  const vp = first.viewport
  const scrolls =
    vp.scrollW > vp.clientW || vp.scrollH > vp.clientH
      ? `（内容 ${vp.scrollW}×${vp.scrollH}，能滚；滚动条吃掉 ${vp.w - vp.clientW}×${vp.h - vp.clientH}）`
      : ''
  console.log(
    `\n底图层：${first.paper} —— ${first.paint}` +
      `\n  这一层盖住 ${box.width}×${box.height} @ (${box.left}, ${box.top})；` +
      `布局视口 ${vp.clientW}×${vp.clientH}（inner ${vp.w}×${vp.h}）${scrolls}`,
  )
  for (const row of first.rows) console.log(`  ${row.sel.padEnd(18)} 顶边 y=${row.top}`)

  const near = (v, edge) => Math.abs(v - edge) <= 1
  // ★ 判据取的是**结果**（这一层盖住了多大），不是手段（`position: fixed`）：
  //   手段换成别的而结果对，这一条不该红；结果没达到，手段再对也没用。
  //   `absolute; inset: 0` 挂在 `.blr` 上时量出来是"这一节有多高"（1440×900 下 830），
  //   与视口差多少随视口变 —— 所以这里必须拿视口当尺子，不能写一个固定高度。
  //   ★ 尺子用**布局视口**（client*）而不是 inner*：`fixed; inset: 0` 的大小本来就由
  //     布局视口定，而 inner* 把滚动条算在里面 —— 有滚动条时拿它当尺子，
  //     会把"盖满了"读成"差 15px"（390×844 那一档踩到过；`.blr` 上那条
  //     `overflow-x: clip` 就是那次量的产物，2026-10-18 晚随暖光一起删了）。
  check(
    '底图铺满整块视口（不是一个收在书附近的条）',
    near(box.top, 0) &&
      near(box.left, 0) &&
      near(box.width, vp.clientW) &&
      near(box.height, vp.clientH),
    `层 ${box.width}×${box.height} @ (${box.left}, ${box.top})，` +
      `布局视口 ${vp.clientW}×${vp.clientH}${scrolls}`,
  )

  /* ── 判据 3：设置里那一档真的到了这一屏，外加判据 2 ────────────────────────── */

  /**
   * ★ 这一条是这一轮**唯一**能证伪"设置那条链接通了"的地方。
   *   `localStorage` 里写什么，与屏幕上铺什么之间隔着三处：hydration、
   *   `useReaderPaper`、以及那个 CSS 变量。任何一处断了，界面上都只是"选了没反应"
   *   —— 而那正是最难发现的一种坏（选项亮着、读的人没接上）。
   * ★ 判据取**图文件名**：它只有真把偏好读进来、真换了 CSS 变量才会变。
   *   不取"元素在不在"——SSR 的 HTML 里那个 div 本来就在（`ui-probe-clicks-*` 那条记过）。
   * ★ 「纯色」那一档的判据是反的：`background-image` 必须是 `none`。
   *   探针必须在**同一处**跑完，所以这里逐档写盘 + 重载。
   * ★ 判据 2 搭在这里跑：它要**逐档底图**各量一次"压在它上面的字还读不读得清"，
   *   而这一圈正好逐档重载。顺序是：写盘 → 重载 → 看铺的是哪张 → **隐字截图量对比度**。
   */
  const rowsPicked = []
  const perPaper = []
  const notMeasured = []
  /** 判据 4 的读数：每一档底图下，「← 回灵感书单」那行字自己矩形里的墨 */
  const backInk = []
  for (const key of ['paper', 'wood', 'linen', 'mist', 'clay', 'chalk', 'plain']) {
    await evaluate(`(() => {
      window.localStorage.setItem('xiaozhujue.reader.paper', ${JSON.stringify(key)})
      return 1
    })()`)
    await go(`${BASE}${PATH}`)
    /**
     * ★ 等这一档**真的铺上去**再判。理由是这一条判的东西本身：
     *   SSR 渲染的是**默认**那一档，客户端挂载之后才读 `localStorage` 换成用户挑的
     *   （`useReaderPaper` 文件头那条取舍："选过非默认的人会先看到默认那张再换"）。
     *   所以"重载后立刻读一次"读到的可能是**默认**，那不是"偏好没接上"，
     *   是这一条链本来就有一小段延迟 —— 立刻读会把它误判成 ✗（第一次跑就撞到过一次：
     *   1920×1080 下报 6/7，而每一行的图都对着）。
     *   于是改成**等**：最多 6s，一边等一边读，记下等了多久。等不到才是真的没接上。
     */
    const want = key === 'plain' ? 'none' : `${key}.webp`
    let seen = null
    let waited = 0
    for (let i = 0; i < 30; i += 1) {
      seen = await evaluate(`(() => {
        const el = document.querySelector('.blr__desk, .reader__desk')
        if (!el) return null
        return { paper: el.getAttribute('data-paper'), paint: getComputedStyle(el).backgroundImage }
      })()`)
      if (!seen) break
      if (seen.paint.includes(want)) break
      waited += 200
      await sleep(200)
    }
    if (!seen) throw new Error('这一屏上没有底图层')
    rowsPicked.push({
      key,
      ...seen,
      waited,
      ok: seen.paint.includes(want),
    })

    // ── 判据 2：这一档底图下，压在它上面的每一行字 ────────────────────────────
    // ★ 这一张要在**隐字之前**拍：判据 4 量的是"那行字自己画出来了没有"，
    //   字被藏起来的那张上当然数不到墨 —— 两张各有用处，缺一张就有一条判据是瞎的。
    const shotWithText = await send('Page.captureScreenshot', { format: 'png' })
    const text = await evaluate(TEXT_PROBE)
    if (text.error) throw new Error(text.error)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    await evaluate(UNHIDE_PROBE)
    const png = Buffer.from(shot.result.data, 'base64')
    const size = await sharp(png).metadata()
    const measured = []
    for (const row of text.rows) {
      const m = await measureRow(png, size, row)
      // ★ 整行落在视口外（窄屏那一档可能得滚屏才看得见）→ **明说没量到**：
      //   既不报 ✓（那是一条什么都没验的空过），也不报 ✗（把"没量"当成"不行"）
      if (!m) notMeasured.push(`${key}/${row.sel}`)
      else measured.push({ ...row, ...m })
    }
    perPaper.push({ key, measured })

    // ── 判据 4：底图**之外**那行字有没有被图盖住 ─────────────────────────────
    const backRow = text.rows.find((row) => row.sel === 'back-link')
    // 这一行是这一页唯一一行不在 `.blr` / `.reader` 里的字（探针枚举过）：
    // 找不到它不是"这一档没事"，是这一屏 / 这个选择器坏了 —— 当场说，不静默通过。
    if (!backRow) throw new Error('没找到「← 回灵感书单」那一行 —— 判据 4 没东西可量')
    const ink = await measureInk(Buffer.from(shotWithText.result.data, 'base64'), size, backRow)
    backInk.push({ key, text: backRow.text, ...(ink ?? {}) })
  }
  for (const row of rowsPicked) {
    console.log(
      `  ${row.ok ? '·' : '✗'} 选「${row.paper}」→ ${row.paint.slice(0, 64)}` +
        (row.waited > 0 ? `（等了 ${row.waited}ms 才铺上）` : ''),
    )
  }
  check(
    '设置里挑的那一档就是这一屏铺的那张（逐档写偏好再重载）',
    rowsPicked.every((row) => row.ok),
    `${rowsPicked.filter((r) => r.ok).length}/${rowsPicked.length} 档对得上（「纯色」那一档应当没有图）`,
  )

  /**
   * ★ 判据 2 的读数逐行打出来，**不折叠成一句**：判的是"最暗的 1%"，
   *   一行不过就是一行不过，而"哪一张图的哪一行"正是下一个人要的那条信息。
   * ★ 门槛 4.5:1 是 WCAG 正文级 AA —— 这几行字最大的 14px、最小的 12px，
   *   都在"小字"那一档，没有一条能按 3:1 算。
   */
  console.log(`\n判据 2：每一行字压在底图上的**真实像素**（最暗 1%）对这几行字色的对比度`)
  for (const { key, measured } of perPaper) {
    for (const row of measured) {
      console.log(
        `  ${key.padEnd(6)} ${row.sel.padEnd(18)} ${row.color.padEnd(18)} ` +
          `最暗 1% ${row.dark.toFixed(2)}:1 · 中位 ${row.median.toFixed(2)}:1 ` +
          `${row.dark >= 4.5 ? '✓' : '✗'} 「${row.text}」`,
      )
    }
  }
  if (notMeasured.length) console.log(`  · 没量到（整行在视口外）：${notMeasured.join('、')}`)

  const allRows = perPaper.flatMap((p) => p.measured.map((r) => ({ key: p.key, ...r })))
  const badRows = allRows.filter((r) => r.dark < 4.5)
  check(
    '每一档底图下，压在它上面的字都还过 4.5:1（逐档量真实像素）',
    allRows.length > 0 && badRows.length === 0,
    allRows.length === 0
      ? '一行字都没量到 —— 那这一条什么都没验'
      : badRows.length === 0
        ? `${allRows.length} 行全过（最差 ${Math.min(...allRows.map((r) => r.dark)).toFixed(2)}:1）`
        : `${badRows.length} 行不过：` +
          badRows.map((r) => `${r.key}/${r.sel} ${r.dark.toFixed(2)}:1`).join('、'),
  )

  /* ── 判据 4：底图之外那行字真的画在图上面 ──────────────────────────────────── */

  /**
   * ★ 逐档打出来，理由与判据 2 一样：判的是"这一档底图下算不算数"，
   *   而"哪一档盖住了"正是下一个人要的那条信息。
   * ★ 门槛两条一起过：最暗的像素 ≤ 80（这行字的墨是灰阶 ≈ 28，纸是 ≈ 228–236）、
   *   且比纸暗的像素 ≥ 40（一行七个字加一个箭头，实测 300 上下；被盖住时是 0）。
   */
  console.log(`\n判据 4：底图之外那行字「← 回灵感书单」自己矩形里的墨`)
  for (const row of backInk) {
    const ok = row.minLuma !== undefined && row.minLuma <= 80 && row.darkPx >= 40
    console.log(
      `  ${row.key.padEnd(6)} 最暗 ${String(row.minLuma ?? '—').padStart(3)} · ` +
        `比纸暗的像素 ${String(row.darkPx ?? '—').padStart(4)} ${ok ? '✓' : '✗'} 「${row.text ?? ''}」`,
    )
  }
  const inked = backInk.filter((row) => row.minLuma !== undefined)
  const covered = inked.filter((row) => !(row.minLuma <= 80 && row.darkPx >= 40))
  check(
    '「← 回灵感书单」那行字真的画在底图上面（逐档数它自己矩形里的墨）',
    inked.length > 0 && covered.length === 0,
    inked.length === 0
      ? '一行都没量到 —— 那这一条什么都没验'
      : covered.length === 0
        ? `${inked.length} 档全数到墨（最暗 ${Math.min(...inked.map((r) => r.minLuma))}，` +
          `最少 ${Math.min(...inked.map((r) => r.darkPx))} 个暗像素）`
        : `${covered.length} 档被盖住：` +
          covered.map((r) => `${r.key} 最暗 ${r.minLuma} / ${r.darkPx} 个暗像素`).join('、'),
  )

  /* ── 截图 ──────────────────────────────────────────────────────────────────── */

  if (SHOT) {
    // ★ 判据 3 跑完时盘上留着最后一档（`plain`），截图不能顺手拿它当默认：
    //   显式写回要拍的那一档（`--paper=<key>`，缺省就是默认那张）
    await evaluate(`(() => {
      window.localStorage.setItem('xiaozhujue.reader.paper', ${JSON.stringify(SHOT_PAPER)})
      return 1
    })()`)
    await go(`${BASE}${PATH}`)
    // 翻一页，落在有正文的那一屏：封面那屏只有封面图，
    // "底图铺满整屏、字压在它上面还读得清"这件事在那屏上看不出来
    await evaluate(`document.querySelector('.blr__stage, .reader__stage').focus()`)
    await turnNext()
    await sleep(1600)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(SHOT, Buffer.from(shot.result.data, 'base64'))
    console.log(`\n截图（底图 = ${SHOT_PAPER}）：${SHOT}`)
  }

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
