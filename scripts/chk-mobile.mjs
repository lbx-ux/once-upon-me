/**
 * chk-mobile.mjs —— 量手机这一档（2026-10-19 移动端适配）
 *
 * ```bash
 * node scripts/chk-mobile.mjs http://127.0.0.1:3363
 * node scripts/chk-mobile.mjs http://127.0.0.1:3363 --shot=.out/mobile
 * ```
 *
 * ★ 为什么直连 CDP、不进预览面板：**那个面板把 rAF 与 transition 一起冻住**
 *   （`preview-pane-hidden-freezes-raf-and-transitions` 那条记过），
 *   量几何会读到过渡起点。而这一支里有一半判据量的正是"过渡跑到哪儿了"
 *   （判据 4 的跟手中间态、判据 2 的落位尺寸）。同一条理由写在
 *   `chk-reader-desk.mjs` 与 `chk-shared-reader.mjs` 头上。
 *
 * ── 七条断言，每条都只有真做才会不同 ──────────────────────────────────────
 *
 * | # | 量什么                                                        | 错了会怎样                                                       |
 * | - | ------------------------------------------------------------- | ---------------------------------------------------------------- |
 * | 1 | 五个视口 × 十三条路由：`scrollWidth ≤ clientWidth + 1`          | 手机上整页横着能拖（这一轮要修的那件事本身）                     |
 * | 2 | 844×390 下书的高 ≥ **0.95 × 视口高**（两台阅读器各量一次）     | "横放在屏幕上"没做到（竖屏那一档必然 ~0.29，**这条有判别力**）    |
 * |   | ＋ 同一档下**每一个控件都不与书相交**；640×360（16:9 横屏）    | 底栏搬进页边时压到书面上 / 页边窄到放不下控件                   |
 * |   | 也量一次（页边只剩约 51px，正是那一版翻过车的尺寸）             |                                                                  |
 * | 3 | 390×844 下 `.rotate-hint` 可见、844×390 下不可见               | 提示不出现 / 横屏还挡着                                          |
 * | 4 | 真触摸事件后**读出那一行真的变了**，且拖动**中途** q 落在叶之间 | 滑动没接上 / 不是跟手（"先不动、松手才跳"）                      |
 * | 5 | 两台阅读器 + 底部标签栏 + 书架：每个可点元素 ≥ 44×44           | 手指点不准                                                       |
 * | 6 | 书架每块牌子装得下、书名条非零高、角标**整段不折行**           | 书架上挤成一团（2026-10-19 用户报的那一屏，见下）                |
 * | 7 | 首页在手机上换的形态：主张句不被裁、亮点正文列够宽、首页只剩 | 首页在手机上还是桌面那一副（挤 + 切，判据 1 两样都看不见）        |
 * |   | **两节**（首屏 + 亮点）、那五张图的取用账                      |                                                                  |
 *
 * ★ 判据 3 判的是 `getComputedStyle` 的 `display` **加上矩形非零**：
 *   "在不在 DOM 里"证明不了"看不看得见"（SSR 的 HTML 里元素本来就在，
 *   而那正是这一层唯一会让它出现在 HTML 里的路径）。
 *   这一条的选法照 `ui-probe-clicks-land-before-hydration` 那条账。
 * ★ 判据 4 取**读出那一行的文字**当判据，不取"某个变量变了"：
 *   前者只有真翻页才会不同。而"跟手"那半取**拖动中途**的 `--leaf-angle`，
 *   它只有真的每帧在写才会变（旧版是松手才动）。
 * ★ 判据 5 只跑**手机视口**：44 那条线是"手指"，桌面上它不适用
 *   （鼠标指针的命中精度与手指不是一个量级），在宽屏上量它会把一批
 *   本来就是给鼠标用的控件判红。
 *   ★ 它同时报「量到几个」：**一个都没量到 = 不过**。选择器写错、或者那一屏
 *   未登录时把按钮整批藏起来（书架就是），都会让"零个不达标"看起来像全绿 ——
 *   这类"空集通过"是这一支最容易被骗过去的地方。
 *   ★ 书架上还有两颗**平时不在 DOM 里**的（编辑模式下的抓手与 ✕）：它们只有
 *   26×26，命中区靠 `::after` 撑到 44 —— 所以那一步要先真点一次「编辑」，
 *   而且**把伪元素的 inset 加回去再量**，否则量到的是 26×26，两条对的规则恒红。
 * ★ 判据 6 是**补的一次漏判**，值得写清楚它为什么在：这一轮收尾时用户拿手机
 *   打开 `/shelf`，说"挤在一起" —— 而判据 1 在五个视口上全绿。原因是两条叠加：
 *   ①`scrollWidth ≤ clientWidth` 只问"整页有没有横着溢出去"，**不问"里面挤没挤"**：
 *     卡片里的字在自己的盒子里折成三行、书名条被压成 0 高，一个像素都没溢出；
 *   ②该屏**未登录时是一排空架子**（`page.tsx` 里 `if (!userId) return <ShelfDashboard books={[]} />`），
 *     而判据 1 那次跑是没带票的 —— 于是它量的是一个"什么都没有"的页面，
 *     还量得挺像回事。**"绿"必须绿在真的有东西的那一屏上**，这是这一条的意义。
 *   所以判据 6 自己带一张票（见 `--user`），并在架子上真是空的时**明说跳过** ——
 *   跳过不是通过（`measurement-budget-is-ample` 同族的账：没测成不许记成测出来）。
 *
 * ── 参数 ────────────────────────────────────────────────────────────────────
 *
 * ★ 路由与 id **刻意不带前导斜杠**（`--book=dino`，不是 `--path=/booklist/dino`）：
 *   Git Bash（MSYS）会把以 `/` 开头的参数改写成 Windows 路径，
 *   到了脚本里已经不是那条路由了 —— 而症状很闷：`Page.navigate` 不报错，
 *   页面停在一张 `about:blank` 上。拼 URL 的活在脚本里做。
 *
 * `--user=<userId>`（默认 `1`）：判据 6 要登录才看得到东西。票是**本机现签的**——
 *   读 `.env.local` 里的 `APP_JWT_SECRET`，按 `src/lib/auth/session.ts` 的
 *   `verifyToken` 逐字对齐签一张 `scope:'session'` 的 HS256，塞进 `xzj_session`。
 *   于是**不用起 Java 后端、不用真登录**就能量书架（同族手法见
 *   `shelf-and-ssr-pages-verifiable-by-minted-ticket`）。
 *   ★ 密钥只在本进程里用，**一个字都不打印**（`never log the secret` 那条纪律）；
 *   `--user=`（空）就是不带票，判据 6 会照实报跳过。
 */

import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const BASE = (argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:3363').replace(/\/$/, '')
/** 仓库根（`.env.local`、`.out/` 都从这儿找） */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 演示书（`public/demo/books/` 里那本预生成的，ADR-0003）。★ 不带前导斜杠 */
const BOOK = flag('book', 'xiaoyu-r1-4fe055c5723b')
/** 书单那一本样书 */
const KEY = flag('key', 'dino')
const PORT = Number(flag('port', '9355'))
/** 判据 6 的票主（`--user=` 给空 = 不带票，那一档会照实报跳过） */
const USER = flag('user', '1')
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const OUT = resolve(ROOT, '.out', 'chrome-mobile')
const SHOTS = flag('shot', null)

/** 五个视口。★ 竖屏三种 + 横屏一种 + 平板一种（平板是**不该**进横屏那一档的对照） */
const VIEWPORTS = [
  { name: '390×844', w: 390, h: 844, mobile: true },
  { name: '360×640', w: 360, h: 640, mobile: true },
  { name: '412×915', w: 412, h: 915, mobile: true },
  { name: '844×390', w: 844, h: 390, mobile: true },
  { name: '768×1024', w: 768, h: 1024, mobile: true },
]

/**
 * ★ 2026-10-20 补的第六个视口：**16:9 手机横过来**（判据 2 用，不进判据 1 那一圈）。
 *
 * 为什么单列一个：上面那五个里横屏只有 844×390（19.5:9 的一台），而
 * **16:9 的手机横过来是 640×360** —— 书占 537 宽，两侧各只剩约 51px。
 * 底栏搬进页边那一版正是在这个尺寸上翻过车：朗读那颗药丸量出来 76px，
 * 比页边还宽，于是**溢出屏幕 17px、左边压着书**（844×390 上完全看不出来，
 * 那个尺寸的页边有 131px）。补这一档就是让"页边放不放得下控件"有判别力。
 */
const LANDSCAPE_NARROW = { name: '640×360', w: 640, h: 360, mobile: true }

/**
 * 十三条路由（外加**本机有真数据时**再补一条带 id 的）。★ 覆盖这一轮动过的每一处
 * ＋没动过的几处当对照。判据 1 的断言数不随路由数变（它是"每个视口一条"），
 * 所以加路由只是把同一条断言**量得更全**。
 *
 * ★ 2026-10-19 补的四条（`/voice` / `/account` / `/character/new` / `/create`）：
 *   上一版只量了八条，剩下那几屏在 06 那一单里是**手看过的**，而这一支的口径是
 *   "拿读数说话"。补它们的代价只是一次导航（`/create` 不带参数时走的是它的兜底形态，
 *   那也是一屏真的会被打开的页面）。
 * ★ `/admin` **刻意不在**这里：那一屏的内容由 **Java 后端**给（角色由
 *   `AdminController#requireAdminFresh` 判），把它塞进来会让这一支
 *   **从一个不起后端的探针变成一个要起后端的探针** —— 而这一支现在只靠
 *   本机 `.env.local` 签的票就能跑。它的手机形态（8 列表格保留横向滚）已记在
 *   `.scratch/mobile/issues/06-screens-pass.md` 与 docs/known-tradeoffs.md。
 *   ★ 2026-10-19：那一行「← 左右滑动看全表 →」提示**已删**（web 与移动端都不写），
 *   这一句跟着改 —— 否则下一次读到这里的人会去找一个不存在的东西。
 */
const ROUTES = [
  ['/', '首页'],
  ['/booklist', '灵感书单'],
  [`/booklist/${KEY}`, '样书阅读器'],
  [`/reader/${BOOK}`, '独读版阅读器'],
  ['/home', '工作台 · 创作'],
  ['/shelf', '工作台 · 书架'],
  ['/character', '工作台 · 角色卡'],
  ['/character/new', '工作台 · 新建角色'],
  ['/voice', '工作台 · 声音'],
  ['/account', '个人主页'],
  ['/create', '创作运行视图'],
  ['/login', '登录页'],
]

/** ★ 带 id 的那一条要本机上真有那个孩子，判据才不会是"404 不溢出"。
 *  没有就**说一声跳过**（干净检出上跑这一支，这一行会照实报出来）。 */
const childId = (() => {
  const dir = resolve(ROOT, '.out', 'web', 'u', String(USER ?? ''), 'children')
  try {
    const hit = readdirSync(dir).find((f) => f.startsWith('kid-') && f.endsWith('.json'))
    return hit ? hit.slice(0, -'.json'.length) : null
  } catch {
    return null
  }
})()
if (childId) ROUTES.push([`/character/${childId}`, '工作台 · 角色详情'])
else console.log('· 没找到 .out/web/u/<user>/children/kid-*.json —— 「角色详情」那一条跳过')

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
  `--user-data-dir=${OUT}`,
  '--window-size=390,844',
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
/** 判据 7d/7e 要用的取图账（只收首页那五张 `/highlights/*.webp`，其余一律不记） */
const hlReqs = []
/**
 * 判据 7f/7g 要用的取图账：首屏那 12 张封面（`/art/*.webp`）。
 *
 * ★ 这条账是 2026-10-19「web 三节 / 手机两节」那一版加的，它钉的是**两件相反的事**：
 *   手机上**一个 `/art/` 请求都不该有**（环不演，12 张共 2.8 MB 白下是纯浪费），
 *   桌面上**12 张一个不少**（那是首屏的 LCP，环还在）。
 *   ★ 只量 `/art/` 而不是"所有图"：书页是 CSS 背景、朗读是 mp3，各有各的账。
 */
const artReqs = []
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Network.requestWillBeSent') {
    const u = msg.params.request.url
    if (/\/highlights\/[^/]+\.webp/.test(u)) hlReqs.push(u.split('/').pop())
    if (/\/art\/[^/]+\.webp/.test(u)) artReqs.push(u.split('/').pop())
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
    throw new Error(
      `页面里报错：${res.result.exceptionDetails.text} ${res.result.exceptionDetails.exception?.description ?? ''}`,
    )
  }
  return res.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
/* 判据 7d/7e 的取图账要 `Network.enable` 才会有事件；它只读不写，对别的判据没有影响 */
await send('Network.enable')

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 6 要用的那张票（见文件头 `--user`）
 *
 * ★ 密钥从 `.env.local` 现读，**一个字符都不打印** —— 它是这个仓库唯一的秘密，
 *   而探针的日志是会被人贴进 issue 的（`never log the secret`）。
 * ★ 读不到就**不带票跑**，由判据 6 自己报"跳过"：不能"悄悄降级成没登录"
 *   然后全绿 —— 那正是这一条要修的那个毛病。
 * ══════════════════════════════════════════════════════════════════════════ */
const signIn = async () => {
  if (!USER) return '没给 --user，跳过'
  const envPath = resolve(ROOT, '.env.local')
  let raw = ''
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    return '.env.local 不在，跳过'
  }
  const key = raw
    .split(/\r?\n/)
    .find((line) => line.startsWith('APP_JWT_SECRET='))
    ?.slice('APP_JWT_SECRET='.length)
    .trim()
    .replace(/^["']|["']$/g, '')
  if (!key) return '.env.local 里没有 APP_JWT_SECRET，跳过'
  const b64 = (s) => Buffer.from(s).toString('base64url')
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64(
    JSON.stringify({
      sub: String(USER),
      acc: 'chk-mobile',
      role: 'user',
      scope: 'session',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
  const sig = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')
  await send('Network.setCookie', {
    name: 'xzj_session',
    value: `${header}.${payload}.${sig}`,
    url: BASE,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  })
  return `已带票（u/${USER}）`
}
const ticket = await signIn()

/** 换视口。★ 必须**显式给具体宽高**：不给的话 `innerWidth` 会读到 0，`vw` 全落
 *  `min()` 的下限，量到的是**另一套布局**——而它看起来还挺合理。 */
const viewport = async ({ w, h, mobile }) => {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile,
  })
  /* ★ 触屏要单独开：`mobile: true` 只换 UA 与视口，**不会**让
     `Input.dispatchTouchEvent` 生效（不开的话它静默什么都不做，
     而判据 4 会报"滑动没接上"——一个假故障）。 */
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 })
}

/**
 * 等这一屏**真的画出来**再量。
 * ★ 要等的是 dev server 冷编译那一趟：它会先吐一份"CSS 还没到"的 HTML，
 *   那时量出来的几何是一套假的（`chk-reader-desk.mjs` 撞到过一次，见那边的注释）。
 *   判据取"文档真的排过版"（`scrollHeight > 0`）**加上** React 挂上去了。
 * ★ `expect` 是**这一趟要去的那条路**：`Page.navigate` 是异步的，`ready()` 有可能
 *   在**上一份文档**上就返回 `ok`（它当然是画好的），于是紧接着的那次 `evaluate`
 *   落在一份"还在解析、目标元素还没进 DOM"的新文档上 —— 症状是
 *   `Cannot read properties of null (reading 'getBoundingClientRect')`，
 *   而它看起来像**页面坏了**。加上这一条，等的是"新那一页画好了"。
 * ★ 2026-10-19 把 `tries` 从 60 抬到 100（12s → 20s），值得记一句为什么：
 *   `/home` `/voice` `/account` 这几屏是工作台，dev server 现场编译它们要十几秒
 *   （`/home` 的 HTML 就有 300 KB）。抬之前连跑两次，两次都各有一屏报"一直没画好"，
 *   而**每次报的是不同的那一屏** —— 这是编译慢，不是哪一屏坏了
 *   （同族的假故障记在 `api-500-is-usually-a-compile-error-not-auth` 与
 *   `shared-next-build-clobbers-dev-server` 那两条里）。抬的是探针的耐心，
 *   不是判据：页面真画不出来还是会红，只是不再把"编译慢"记成"这一屏坏了"。
 */
const ready = async (expect = null, tries = 100) => {
  let last = ''
  for (let i = 0; i < tries; i += 1) {
    const state = await evaluate(`(() => {
      if (document.readyState !== 'complete') return 'loading'
      if (${expect ? `location.pathname !== ${JSON.stringify(expect)}` : 'false'}) {
        return 'elsewhere:' + location.pathname
      }
      if (!document.body || document.body.children.length === 0) return 'no-dom'
      if (document.documentElement.scrollHeight <= 1) return 'no-layout'
      // ★ 挂上 React 的判据取「页面上**有元素**带 __reactFiber$」而不是点名某个容器：
      //   登录页没有 <main>，工作台没有 .home-hero，而 hydrate 的容器在 App Router 下
      //   是 document 本身 —— 点名法会在某几屏上永远等不到，症状是"探针超时"，
      //   而它看起来像页面坏了。扫前 500 个元素足够，也够快。
      const els = [...document.querySelectorAll('body *')].slice(0, 500)
      const hydrated = els.some((el) => Object.keys(el).some((k) => k.startsWith('__reactFiber$')))
      return hydrated ? 'ok' : 'no-hydrate'
    })()`)
    if (state === 'ok') return i * 200
    last = state
    /* ★ 2026-10-20：「跳到别的路上了」要**单独认出来**，不能混进"一直没画好"。
       起因：`/create` 不带参数时那一屏渲染的 `ResumeLastRun` 会自己回 `/home`
       （"这一屏没有'这一轮'就无事可做"，见 `src/app/create/page.tsx` 的文件头），
       于是这一支原来会在四个视口上报"这一屏一直没画好（DOM / 排版 / hydrate 有一样没到）"
       —— 一个**把重定向说成假故障**的账，而读到它的人会去找一个不存在的排版问题。
       探针量的那一刻跳到哪儿，就是它落到的**另一屏**；调用方照实说"跳过"。 */
    if (state.startsWith('elsewhere:')) {
      const err = new Error(`这一屏跳到了 ${state.slice('elsewhere:'.length)}`)
      err.redirectedTo = state.slice('elsewhere:'.length)
      throw err
    }
    await sleep(200)
  }
  throw new Error(`这一屏一直没画好（DOM / 排版 / hydrate 有一样没到，最后一次读到「${last}」）`)
}

const go = async (path) => {
  await send('Page.navigate', { url: `${BASE}${path}` })
  await sleep(700)
  return ready(path)
}

const shoot = async (name) => {
  if (!SHOTS) return
  const res = await send('Page.captureScreenshot', { format: 'png' })
  if (!res.result?.data) return
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(resolve(SHOTS, `${name}.png`), Buffer.from(res.result.data, 'base64'))
}

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 1 · 不横向溢出
 *
 * 这一轮要修的**就是这一条**：上一版首页三屏各写了一条 `min-width: 1280px`，
 * 手机上整页横着能拖。`scrollWidth ≤ clientWidth + 1`（那个 1 是子像素的余量：
 * 390.4 与 390 的差别不是"溢出了"）。
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n── 判据 1 · 五个视口 × 十三条路由，不横向溢出 ──')
for (const vp of VIEWPORTS) {
  await viewport(vp)
  const bad = []
  /** ★ 跳走的那些**照实报出来**，不悄悄算通过（跳过不是通过 —— 与判据 6 同一条账） */
  const skipped = []
  for (const [path, label] of ROUTES) {
    try {
      await go(path)
      const m = await evaluate(`(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth
      }))()`)
      if (m.sw > m.cw + 1) bad.push(`${label}(${m.sw}>${m.cw})`)
    } catch (err) {
      if (err.redirectedTo) {
        skipped.push(`${label}→${err.redirectedTo}`)
        continue
      }
      bad.push(`${label}(探针失败：${err.message.slice(0, 40)})`)
    }
  }
  const label =
    skipped.length === 0
      ? `${vp.name} · 十三条路由都不横向溢出`
      : `${vp.name} · ${ROUTES.length - skipped.length} 条路由不横向溢出（跳过 ${skipped.join('、')}）`
  check(label, bad.length === 0, bad.join('  '))
  await shoot(`overflow-${vp.name.replace('×', 'x')}`)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 2 · 横屏真的"把书铺开"
 *
 * ★ 判据取**书的高 ÷ 视口高**，而且竖屏那一档也量一次当对照 ——
 *   "≥0.95"这个数只有在它同时能**证伪**的时候才有意义：
 *   同一台手机上竖屏必然是 0.29 左右，两条一起报出来，读者才看得出
 *   这一轮到底改了什么（`e2e-acceptance-needs-a-discriminating-signal` 那条）。
 * ★ 高度而不是宽度：书是 3:2、屏幕是 2.16:1，绑定的那条**只能是**高度
 *   （宽是它推出来的）。量宽的话，一台更宽的手机就能"达标"，而那些空白
 *   本来就在那儿。
 * ★ 门槛 2026-10-20 从 **0.80 抬到 0.95**：那一轮把底栏从"书下面那一行"
 *   搬进了左右两条页边（`reader-book.css` / `booklist-reader.css` 的 §手机横屏），
 *   书从 338px / 86.7% 变成 388px / 99.5%。**留着 0.80 就等于这条判据没了** ——
 *   把底栏搬回书下面照样过（86.7% 离 80% 还有 6.7 个点）。
 *   ★ 两台阅读器各量一次：那两处是**逐字同一条规则**，只量一台等于只验了一半
 *     （`booklist-reader.css` 那台的文件头写着"改一处要改另一处"）。
 * ★ 第二条断言（控件不与书相交）判的是**新版面唯一会犯的错**：页边是 `1fr`，
 *   书一变形、或者控件忘了带上 `max-width: 100%`，页码就会从页边探出去压到书上。
 *   ★ 它同时报「量到几个」：**一个都没量到 = 不过**（空集通过是这一支最容易被骗的
 *     地方，与判据 5 同一条账）。量到的至少要 3 个：两颗翻页钮 + 页码。
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n── 判据 2 · 横屏把书铺开（竖屏对照）──')
const STAGE = '.blr__stage, .reader__stage'
const bookFrac = async () =>
  evaluate(`(() => {
    const s = document.querySelector('${STAGE}')
    if (!s) return null
    const r = s.getBoundingClientRect()
    return { frac: r.height / innerHeight, ratio: r.width / r.height, h: Math.round(r.height) }
  })()`)

/** 横屏下每个控件与书矩形的关系。★ 只收**真有盒子**的（`display: none` 的不算） */
const railOverlap = async () =>
  evaluate(`(() => {
    const s = document.querySelector('${STAGE}')
    if (!s) return null
    const b = s.getBoundingClientRect()
    const sel =
      '.blr__btn--prev, .blr__btn--next, .blr__readout, .blr__audio, .fullscreen-button, ' +
      '.reader__btn--prev, .reader__btn--next, .reader__readout, .reader__audio'
    const items = [...document.querySelectorAll(sel)].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'
    })
    const hits = items
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top
      })
      .map((el) => el.className)
    return { n: items.length, hits, book: [Math.round(b.left), Math.round(b.right)] }
  })()`)

for (const [vp, path, label, want] of [
  [VIEWPORTS[0], `/booklist/${KEY}`, '样书阅读器', null],
  [VIEWPORTS[3], `/booklist/${KEY}`, '样书阅读器', 0.95],
  [VIEWPORTS[3], `/reader/${BOOK}`, '独读版阅读器', 0.95],
  [LANDSCAPE_NARROW, `/booklist/${KEY}`, '样书阅读器', 0.95],
  /* ★ 2026-10-20 补：640×360 原来只量样书那一台。两台阅读器的横屏规则是**逐字同一条**
     （`reader-book.css` / `booklist-reader.css` 的文件头写着"要一起改"），而**窄到只剩
     51px 页边**的那一档恰恰是第一版翻车的地方（朗读药丸溢出 17px）—— 只量一台的话，
     另一台在那条规则上写错了没人知道。两台各量一次才对称。 */
  [LANDSCAPE_NARROW, `/reader/${BOOK}`, '独读版阅读器', 0.95],
]) {
  await viewport(vp)
  await go(path)
  const m = await bookFrac()
  if (!m) {
    check(`${vp.name} · ${label} · 找到书的舞台`, false, `页面上没有 ${STAGE}`)
    continue
  }
  // 两台阅读器都是 3:2 的跨页，量出来的比例必须还是 1.5（不能被"铺开"拉变形）
  check(
    `${vp.name} · ${label} · 书仍是 3:2（没被拉伸）`,
    Math.abs(m.ratio - 1.5) < 0.02,
    `ratio=${m.ratio.toFixed(3)}`,
  )
  if (want === null) {
    console.log(`  · ${vp.name}（竖屏对照）书高占视口 ${(m.frac * 100).toFixed(1)}% · ${m.h}px`)
    continue
  }
  check(
    `${vp.name} · ${label} · 书高 ≥ ${(want * 100).toFixed(0)}% 视口`,
    m.frac >= want,
    `实测 ${(m.frac * 100).toFixed(1)}% · ${m.h}px`,
  )
  const ov = await railOverlap()
  check(
    `${vp.name} · ${label} · 控件一个都不压书（量到 ${ov?.n ?? 0} 个）`,
    (ov?.n ?? 0) >= 3 && ov.hits.length === 0,
    ov
      ? `书占 x ${ov.book[0]}–${ov.book[1]}，压住的是：${ov.hits.join(' / ') || '（无）'}`
      : '没找到控件',
  )
  await shoot(`book-${label}-${vp.name.replace('×', 'x')}`)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 3 · 那层「把手机横过来」的判别力
 *
 * ★ 判据 = `getComputedStyle().display` **乘以**矩形有没有尺寸。
 *   只判"在不在 DOM 里"是恒真的（SSR 的 HTML 里它本来就在），
 *   只判 `display` 又会被"父层被藏了"骗过去。
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n── 判据 3 · 竖屏出提示、横屏不出 ──')
const hintState = async () =>
  evaluate(`(() => {
    const h = document.querySelector('.rotate-hint')
    if (!h) return { present: false }
    const cs = getComputedStyle(h)
    const r = h.getBoundingClientRect()
    const card = h.querySelector('.rotate-hint__card')
    return {
      present: true,
      display: cs.display,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1,
      rect: [Math.round(r.width), Math.round(r.height)],
      cardText: card ? card.innerText.replace(/\\n+/g, ' ').trim().slice(0, 40) : null
    }
  })()`)

for (const [vp, wantVisible] of [
  [VIEWPORTS[0], true],
  [VIEWPORTS[3], false],
]) {
  await viewport(vp)
  await go(`/booklist/${KEY}`)
  const s = await hintState()
  check(
    `${vp.name} · 提示${wantVisible ? '可见' : '不可见'}`,
    s.present ? s.visible === wantVisible : wantVisible === false,
    s.present ? `display=${s.display} · ${s.rect?.[0]}×${s.rect?.[1]}` : '这一层没渲染',
  )
  if (wantVisible && s.cardText) console.log(`  · 卡上是：${s.cardText}`)
  await shoot(`hint-${vp.name.replace('×', 'x')}`)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 4 · 手指划过去真的翻页，而且是**跟手**
 *
 * ★ 判据取**读出那一行的文字**（"封面" → "第 1–2 页"）：只有真翻页才会不同。
 *   取"某个变量变了"会让"松手才跳"那版也过。
 * ★ "跟手"那半取**拖动中途**的叶子角度：旧版（划 44px 松手才翻）在拖动期间
 *   角度是**一动不动的**，只有松手才变。所以一条判据量两件事：
 *   中途要动、松手要落定。
 * ★ 用 `Input.dispatchTouchEvent` 真的派发触摸，不是 `element.click()` ——
 *   后者绕过命中测试（`ui-probe-clicks-land-before-hydration` 那条账）。
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n── 判据 4 · 跟手滑动真的翻页 ──')
const READOUT = '.blr__readout, .reader__readout'
const leafAngle = () =>
  evaluate(`(() => {
    const l = document.querySelector('.blr__leaf, .reader__leaf')
    return l ? l.style.getPropertyValue('--leaf-angle') : null
  })()`)

const touch = (type, x, y) =>
  send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  })

await viewport(VIEWPORTS[3]) // 横屏那一档：舞台最大，手势最好落
await go(`/booklist/${KEY}`)
/** ★ 找不到就**重试**，不 `throw`：舞台是客户端挂上去的，冷编译那一趟它比 hydrate
 *  晚一两拍。直接取 `null.getBoundingClientRect()` 会崩在探针里，
 *  而那看起来像**页面坏了**（真崩过一次）。取不到就落进下面那条红的判据。 */
let stageBox = null
for (let i = 0; i < 20 && !stageBox; i += 1) {
  stageBox = await evaluate(`(() => {
    const s = document.querySelector('${STAGE}')
    if (!s) return null
    const r = s.getBoundingClientRect()
    return r.width > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null
  })()`)
  if (!stageBox) await sleep(200)
}

if (stageBox && stageBox.w > 0) {
  const before = await evaluate(`document.querySelector('${READOUT}').innerText.trim()`)
  const y = stageBox.y + stageBox.h / 2
  const x0 = stageBox.x + stageBox.w - 40
  const step = stageBox.w / 6

  /* ★ 先取一条**基线**：还没碰到屏幕时，同一间隔采三次角度，它们必须**一模一样**。
     少了这一步，"中途采到 4 个不同的角度"这句话是可以被别的东西骗过去的 ——
     比如进场补间还没跑完、或者隔壁会话的 HMR 让页面重载了一次。
     那两种情形下"角度在变"与手指没有任何关系。 */
  const idleAngles = []
  for (let i = 0; i < 3; i += 1) {
    await sleep(60)
    idleAngles.push(await leafAngle())
  }
  check(
    '没碰屏幕时画面是静的（基线）',
    new Set(idleAngles).size === 1,
    `基线采到 ${new Set(idleAngles).size} 个角度：${idleAngles.join(' / ')}`,
  )

  await touch('touchStart', x0, y)
  const midAngles = []
  for (let i = 1; i <= 4; i += 1) {
    await touch('touchMove', x0 - step * i, y)
    await sleep(60)
    midAngles.push(await leafAngle())
  }
  await touch('touchEnd', x0 - step * 4, y)
  await sleep(900)
  const after = await evaluate(`document.querySelector('${READOUT}').innerText.trim()`)

  check('拖完一页：读出那一行变了', before !== after, `${before} → ${after}`)
  // ★ 要求**四次采样各不相同**（不是"有两个不同"）：四次划过的位移是等差的，
  //   跟手就意味着角度也该一格一格地走。只要求"有变化"的话，
  //   一个"第一次 touchMove 就跳到终点、后面三次不动"的实现照样过 ——
  //   而那种实现恰恰是要被这条判据拦下的东西。
  check(
    '拖动**中途**画面就在动（跟手，不是松手才跳）',
    new Set(midAngles.filter(Boolean)).size >= 3,
    `中途采到 ${new Set(midAngles.filter(Boolean)).size} 个不同的角度：${midAngles.join(' / ')}`,
  )
} else {
  check('找得到书的舞台', false, `量不到 ${STAGE} 的盒子`)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 5 · 触控目标 ≥ 44×44
 *
 * ★ 只跑手机的竖屏与横屏两档：44 是**手指**那条线，桌面上不适用
 *   （鼠标的命中精度与手指不是一个量级）。在宽屏上量它会把一批
 *   本来就是给鼠标用的控件判红 —— 那不是"发现了问题"，是判据选错了。
 * ★ 只量**真的画出来**的那些（`display: none` 与零尺寸的跳过）：
 *   一台阅读器里同时住着桌面与手机两套控件的可见版本是不存在的，
 *   但**两台阅读器共用一套类名**，所以按选择器点名即可。
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n── 判据 5 · 触控目标 ≥ 44×44（只跑手机）──')
const SMALL_PROBE = (sel, hit = false) => `(() => {
  const out = []
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
  for (const el of document.querySelectorAll('${sel}')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    let r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    // ★ 「命中区被伪元素撑大」的那两颗（书架的抓手与 ✕）：**元素盒子还是 26×26**，
    //   手指够得着的是那个 ::after 伪元素。量元素自己会把两条本来就对的规则判红 ——
    //   所以把伪元素那四个 inset 加回去（inset: -9px 算出来是 ±9，于是多出 18px）。
    //   ★ 注释里不能出现反引号：这一整段是塞进模板字符串里的，
    //   反引号会把表达式提前截断，而报错指向的是**行中间**，不是真错处。
    //   没有那条 ::after 时它的 inset 计算值是 auto → 0，量到的还是 26×26，**照样红**。
    if (${hit}) {
      const a = getComputedStyle(el, '::after')
      r = {
        width: r.width - px(a.left) - px(a.right),
        height: r.height - px(a.top) - px(a.bottom),
      }
    }
    if (r.width < 43.5 || r.height < 43.5) {
      out.push((el.getAttribute('aria-label') || el.textContent.trim() || el.className) + ':' +
        Math.round(r.width) + '×' + Math.round(r.height))
    }
  }
  return { n: document.querySelectorAll('${sel}').length, small: out }
})()`

for (const vp of [VIEWPORTS[0], VIEWPORTS[3]]) {
  await viewport(vp)
  for (const [path, label, sel] of [
    [`/booklist/${KEY}`, '样书阅读器', '.blr__btn, .blr__audio, .fullscreen-button'],
    [`/reader/${BOOK}`, '独读版阅读器', '.reader__btn, .reader__audio, .fullscreen-button'],
    ['/home', '工作台底栏与顶栏', '.shell__nav .shell__link, .shell__bar a, .shell__bar button'],
    // ★ 书架那一行的按钮：`制作为绘本` / `删除` 在手机上原来是 30px 高。
    //   没登录时它们不存在 —— 那时 n=0，下一条会把"一个都没量到"判成**不过**，
    //   而不是让它悄悄绿过去。
    ['/shelf', '书架上的按钮', '.shelf__edit, .shelf__make, .shelf__discard'],
  ]) {
    await go(path)
    const { n, small } = await evaluate(SMALL_PROBE(sel))
    check(
      `${vp.name} · ${label} 的触控目标（量到 ${n} 个）`,
      n > 0 && small.length === 0,
      n === 0 ? '一个可点元素都没量到 —— 这不算过' : small.join('  '),
    )
  }
}

/* ★ 书架上还有两颗**平时不在 DOM 里**的：编辑模式下的抓手与 ✕（26×26，命中区靠
   `::after` 撑到 44）。上面那一轮量不到它们，所以这里先真点一次「编辑」。
   ★ 点击必须**落在 hydrate 之后**：先在同一轮 JS 里确认这颗按钮已经挂上 React 的
   props，再 `click()`（`ui-probe-clicks-land-before-hydration` 那条账 ——
   SSR 的 HTML 里按钮本来就在，"点得动"证明不了已经 hydrate）。 */
for (const vp of [VIEWPORTS[0], VIEWPORTS[3]]) {
  await viewport(vp)
  await go('/shelf')
  const how = await evaluate(`(() => {
    const btn = document.querySelector('.shelf__edit')
    if (!btn) return '没有「编辑」这颗按钮'
    const key = Object.keys(btn).find((k) => k.startsWith('__reactProps$'))
    if (!key) return '按钮还没 hydrate'
    btn.click()
    return 'clicked'
  })()`)
  let on = false
  for (let i = 0; i < 20 && !on; i += 1) {
    on = await evaluate(`!!document.querySelector('.shelf__rack[data-editing="true"]')`)
    if (!on) await sleep(150)
  }
  const { n, small } = await evaluate(SMALL_PROBE('.shelf__grab, .shelf__remove', true))
  check(
    `${vp.name} · 书架编辑态 抓手/✕ 的命中区（量到 ${n} 个）`,
    on && n > 0 && small.length === 0,
    on ? (n === 0 ? '进了编辑态却一个都没量到' : small.join('  ')) : `${how} · 一直没进编辑态`,
  )
}

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 6 · 书架那一屏不"挤"
 *
 * 三条断言，对应 2026-10-19 用户手机上看到的那三样东西（见文件头那条注）：
 *
 *   A **牌子装得下**：`scrollHeight ≤ clientHeight`。牌子是**定高**的
 *     （里头的书脊要靠它推出架板的位置，`shelf.css` 文件头那套几何），
 *     所以内容一多就会从底下被切掉 —— 而切掉是**不出滚动条、也不溢出页宽**的，
 *     前五条判据一个都碰不到它。
 *   B **书名条非零高**：被压成 0 高时标题一个字都不显示，而"少一行字"
 *     同样不溢出。判据取**盒子的高**，不取"文字在不在 DOM 里"。
 *   C **角标里每一段文字只占一行**：这条判的正是"折行折在词中间"。
 *     ★ 数的是 `.shelf__meta` 的**每一个直接子节点**（一个个匿名 flex item），
 *       **不是整个 meta 容器** —— 容器折成两三行是**对的**（窄屏本来就该一行放一个角标），
 *       错的是"共读版"这三个字自己折成了"共读 / 版"。分不清这两件事，
 *       判据要么恒红要么恒绿。
 *
 * ★ 视口用全部五个（手机三档 + 平板 + 横屏），**另加一档 1440×900 当对照**：
 *   `(max-width: 1000px)` 那一层是这一轮新加的，桌面那一档必须**一个像素都没动**。
 * ★ 架子上真是空的（那个账号没有书）时**明说跳过**，不记成通过。
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n── 判据 6 · 书架那一屏不"挤" ──')
console.log(`  · 票：${ticket}`)

const SHELF_PROBE = `(() => {
  /** 一个节点里的文字实际排了几行：按行盒的 y 去重（折行的特征就是行数 > 1） */
  const rows = (node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const tops = new Set()
    for (const r of range.getClientRects()) {
      if (r.width > 0.5 && r.height > 0.5) tops.add(Math.round(r.y))
    }
    return tops.size
  }
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().slice(0, 20)
  if (!document.querySelector('.shelf')) return { missing: true }
  const out = { books: 0, drafts: 0, tight: [], flat: [], broken: [] }
  out.books = document.querySelectorAll('.shelf__slot').length
  out.drafts = document.querySelectorAll('.shelf__draft').length
  for (const l of document.querySelectorAll('.shelf__label')) {
    if (l.scrollHeight > l.clientHeight + 1) {
      out.tight.push(name(l) + '：内容 ' + l.scrollHeight + ' > 盒 ' + l.clientHeight)
    }
    const n = l.querySelector('.shelf__name')
    if (n && n.getBoundingClientRect().height < 12) {
      out.flat.push(JSON.stringify((n.textContent || '').trim().slice(0, 10)) + ' h=' +
        Math.round(n.getBoundingClientRect().height))
    }
  }
  for (const m of document.querySelectorAll('.shelf__meta')) {
    for (const child of m.childNodes) {
      const text = (child.textContent || '').trim()
      if (!text) continue
      const r = rows(child)
      if (r > 1) out.broken.push(JSON.stringify(text.slice(0, 12)) + ' 折成 ' + r + ' 行')
    }
  }
  return out
})()`

const shelfSkips = []
const SHELF_VIEWPORTS = [...VIEWPORTS, { name: '1440×900', w: 1440, h: 900, mobile: false }]
for (const vp of SHELF_VIEWPORTS) {
  await viewport(vp)
  await go('/shelf')
  const m = await evaluate(SHELF_PROBE)
  if (m.missing) {
    check(`${vp.name} · 书架渲染出来`, false, '页面上没有 .shelf')
    continue
  }
  if (m.books === 0 && m.drafts === 0) {
    shelfSkips.push(vp.name)
    console.log(`  · ${vp.name} · 架子上是空的（u/${USER} 没有书）—— 跳过，**不算过**`)
    continue
  }
  const what = `书 ${m.books} 本 / 草稿 ${m.drafts} 份`
  check(`${vp.name} · 每块书名条装得下（${what}）`, m.tight.length === 0, m.tight.join('  '))
  check(`${vp.name} · 书名条没被压平`, m.flat.length === 0, m.flat.join('  '))
  check(`${vp.name} · 角标整段折行的地方为 0`, m.broken.length === 0, m.broken.join('  '))
  await shoot(`shelf-${vp.name.replace('×', 'x')}`)
}
if (shelfSkips.length === SHELF_VIEWPORTS.length) {
  console.log(`  ★ 判据 6 一档都没量到（${shelfSkips.length} 档全是空架）—— 这一轮它什么也没证`)
}

/* ══════════════════════════════════════════════════════════════════════════
 * 判据 7 · 首页在手机上的形态（2026-10-19 第二轮；第三轮改成两节）
 *
 * 这一条为什么必须另开一条：判据 1 对首页这两件事**是瞎的**。
 * `.hero { overflow: clip }` 之下，主张句被切成半句（右边 235px 吃掉）而整页
 * `scrollWidth` 仍是 390 —— "切"不是"溢出"。同理亮点那一屏那五张卡在手机上
 * 排成 140px 宽、正文列 94px（≈7 字/行）也一个像素都没溢出。
 * 判据 6 记过同类的前一种（书架"挤"），这一条记后一种（"挤 + 切"）。
 *
 * ★ 7a 的写法在这一轮里**改过一次**，值得留着：计划里原本写的是
 *   「`.hero__typing` 的 `scrollWidth ≤ clientWidth + 1`」。拿它去量**改之前**
 *   那一版（把旧样式注回页面，见 docs/known-tradeoffs.md 那一节的 A/B），
 *   结果是**绿的** —— 旧版那 585px 是 `white-space: nowrap` 把盒子自己撑大的，
 *   `scrollWidth` 与 `clientWidth` 相等，这条判据量不出任何东西。
 *   会红的是：
 *     ① 主张句那一行盒子（`.hero__typing`）的右端有没有出文案盒
 *        —— 旧版右端落在 605，文案盒右端 370，**红**；新版 350 ≤ 370，绿；
 *     ② 每一句**打完那一刻**打出来的字右端有没有出文案盒
 *        —— ②管的是"盒子够宽但句子自己折不断"那一类。
 *   ①不需要等打字机（占位就把宽度撑开了），②要等一整轮打字（两句共 ~13s）。
 *   一条量不出 bug 的判据比没有判据更坏：它会让人以为量过了。
 *
 * ★ 7c 换过**两次**对象，两次都值得留着 —— 判据跟着需求走，但每一次都要说清为什么：
 *   ①（第三轮）原来是"第二屏那本书的正文块够不够宽、有没有和底部控件撞"，
 *     那一版首页把环与书**整条依赖链删掉**了，于是 7c 改成"这两节在不在 DOM 里"。
 *   ②（同一天稍后）用户澄清原话：「**我只让你删的是移动段的，没让你删 web 端的首页啊，
 *     web 端的首页和以前一样**」—— 于是 web 端恢复三节，**手机那一档**靠 CSS 收
 *     （`hero-orbit.css` §6 / `storybook-flip.css` §8）。7c 因此改回量**盒子**：
 *     `display: none` 的子树不进辅助技术与 Tab 序，"手机上没有这两节"照旧成立；
 *     而"它有没有顺带把图取了"是**另一笔账**，归 7g。
 *   ★ 它同时钉住"首屏就是一屏"（旧版是 `max(1120px, 168vh)` = 1.68 屏，
 *     那 0.68 屏是给环下沉 + 下一节升起的交接用的）。
 *
 * ★ 7f / 7g 是这一版**成对**加的两条，缺一条这一支就会骗人：
 *   · 7g（手机）：环是 `<img>`，而浏览器对 `display: none` 里的 `<img>` 照取不误 ——
 *     12 张封面共 2.8 MB，手机上全是拿不到的带宽。所以取图走
 *     `<picture><source media="(min-width: 641px)">`，判据就是"手机上一个 `/art/`
 *     请求都没有"。把那条 source 拿掉，这条红而 7c 仍然绿 —— 两件事必须分开量。
 *   · 7f（桌面）：**反方向**那条。只写 7c 的话，把环与书整块删掉（第三轮干过）
 *     这一支反而全绿 —— 一条只会被"删掉东西"满足的判据是没有判别力的。
 *     7f 要三个数一起看：环有盒子且 12 张卡排出来了、书有 340vh 的盒子、
 *     12 张封面**真的取了**（只查 DOM 的话，`<picture>` 那道门写错也看不出来）。
 *
 * ★ 7d 那条取图账要说清楚它**不是**什么：计划里写的是"手机上 `.hl__viewport`
 *   `display: none`、那 492 KB 不进首屏"，实测**改之前也是 0 次请求**
 *   （旧版在手机上滚到亮点那一节之前同样不取那五张——它们本来就在懒加载的余量外），
 *   所以这一条是"两套 DOM 共用同一批 URL、**不会下载两遍**"的回归检查，
 *   不是省带宽的证据。同一批数记在 docs/known-tradeoffs.md 与工单 09 里。
 *   ★ 2026-10-19 第三轮又重标定过一次：这一页从三节变两节之后，亮点那一节就在
 *     第一屏底下，头两张卡落进懒加载余量、跟着首次加载一起取。于是判据从
 *     "滚之前 0 次"改成"**五张各下一次**"（那条"滚之前 0 次"是照三节的页面高度
 *     标定的，页短了它自己会红，红的不是设计）+ 一条静态的"两套 DOM 同一批 URL"。
 *
 * 三条断言各配一次 A/B（旧样式注回页面再量同一批数）：
 *   7a 旧 → 主张句右端 605 > 文案盒 370（被切 235px）；新 → 350，句末 337~364 也在盒内
 *   7b 旧 → 竖排那五列每列宽 **0**（那一层根本没显示，亮点那一屏还是 140px 的轮播卡）；新 → 5 列各 305
 *   7c 旧 → `.hl` 的顶边在 **1.68 屏**处（当年三节）；新 → 落在 1 屏处
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n── 判据 7 · 首页在手机上的形态 ──')

/** 7a · 主张句：行盒 + 每一句打完那一刻 */
const HERO7 = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { w: Math.round(b.width), x: Math.round(b.x), right: Math.round(b.right),
      disp: getComputedStyle(el).display }
  }
  const t = box('.hero__typing')
  const live = box('.hero__typing-live')
  const copy = box('.hero__copy')
  if (!t || !live || !copy) return { missing: true }
  const ghost = document.querySelector('.hero__typing-ghost')
  const sr = document.querySelector('.hero__typing .sr-only')
  const liveEl = document.querySelector('.hero__typing-live')
  return {
    t, live, copy,
    ghost: ghost ? getComputedStyle(ghost).display : 'absent',
    /* 两句原文就在那个 sr-only 里（HeroTypewriter 把 lines 用空格拼起来）——
       用它当"这一句打完了没有"的靶子，不靠数计时器。 */
    full: sr ? sr.textContent.trim().split(/\\s+/) : [],
    typed: liveEl ? liveEl.textContent.replace(/\\s+/g, '') : '',
    liveRight: Math.round(liveEl.getBoundingClientRect().right),
    phone: matchMedia('(max-width: 640px)').matches,
    docSW: document.documentElement.scrollWidth,
  }
})()`

/** 7b · 亮点那一屏竖排那五张卡（手机那一档） */
const HL7 = `(() => {
  const items = [...document.querySelectorAll('.hl__list .hl__item')]
  const texts = items.map((el) => el.querySelector('.hl__card-text'))
  const disp = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : 'absent' }
  const imgs = [...document.querySelectorAll('.hl__list .hl__art-img')]
  /* ★ 轮播那一套的那五张要**单独数**（2026-10-19 修）：原来 7e 拿上面那个
     imgsDone 去量桌面，而那是**竖排列表**（手机上那一套）里的图 ——
     桌面上它是 display: none + loading="lazy"，本来就不该取，
     于是 7e 量的是一个"永远 0"的数。它此前一直是绿的，靠的是**上一次导航
     把这几张留在内存缓存里**（元素一建出来就 complete，不走网络）——
     那是假绿：判据量的不是它自己那句标题说的东西。
     ★ 这段注释里**不要写反引号**：它在一个模板字符串里，反引号会当场把
       这个模块炸成 SyntaxError（报错还指向别的行）。 */
  const reel = [...document.querySelectorAll('.hl__viewport .hl__art-img')]
  return {
    items: items.length,
    widths: texts.map((t) => (t ? t.clientWidth : null)),
    clamped: texts.filter((t) => t && t.scrollHeight > t.clientHeight + 1).length,
    listDisp: disp('.hl__list'),
    vpDisp: disp('.hl__viewport'),
    /* 轮播那一套在手机上还看得见的话，这里会是一个 140px 左右的数 */
    reelCardW: (() => { const c = document.querySelector('.hl__reel .hl__card'); return c ? Math.round(c.getBoundingClientRect().width) : 0 })(),
    imgsDone: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    imgsTotal: imgs.length,
    reelImgsDone: reel.filter((i) => i.complete && i.naturalWidth > 0).length,
    reelImgsTotal: reel.length,
  }
})()`

/** 7c · 手机那一档首页是**两节** —— 按"有没有盒子"量，不按"DOM 里有没有" */
const HOME7 = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return { present: false, disp: 'absent', h: 0, top: -1 }
    const b = el.getBoundingClientRect()
    const disp = getComputedStyle(el).display
    return { present: true, disp, h: Math.round(b.height), top: Math.round(b.top + scrollY) }
  }
  return {
    hero: box('.hero'),
    orbit: box('.hero-orbit'),
    story: box('.storybook'),
    hl: box('.hl'),
    heroItems: [...document.querySelectorAll('.hero-orbit__item')]
      .filter((el) => el.getClientRects().length > 0).length,
    vh: innerHeight,
    pageH: document.documentElement.scrollHeight,
  }
})()`

/* 打完整一句要 92ms/字：长的那句 29 字 ≈ 2.7s，短的那句 ≈ 1.8s，两句之间还有
   停留 2.6~3.6s 与擦除 0.65~1.0s —— 一头一尾都算上，一轮 ~13s。 */
const typewriterWindow = async (vpName, probe) => {
  const seen = new Map()
  let worst = 0
  for (let i = 0; i < 34; i += 1) {
    const m = await evaluate(probe)
    if (m.missing) return { missing: true }
    worst = Math.max(worst, m.liveRight)
    for (const line of m.full) {
      if (line && m.typed === line.replace(/\s+/g, '') && !seen.has(line)) {
        seen.set(line, { right: m.liveRight, box: m.t.right, copy: m.copy.right })
      }
    }
    if (seen.size >= m.full.filter(Boolean).length) break
    await sleep(400)
  }
  const rows = [...seen.entries()].map(([line, v]) => ({ line, ...v }))
  const over = rows.filter((r) => r.right > r.copy + 1)
  check(
    `${vpName} · 7a 两句打完那一刻都在文案盒里（量到 ${rows.length} 句完整）`,
    rows.length > 0 && over.length === 0,
    rows.length === 0
      ? '一轮打字里一次"打完整句"都没量到（没测成 ≠ 过了）'
      : `最右 ${Math.max(worst, ...rows.map((r) => r.right))} / 盒 ${rows[0].copy} px`,
  )
  return { rows, worst }
}

const PHONE7 = VIEWPORTS.filter((v) => v.w <= 640)
const WIDE7 = VIEWPORTS.filter((v) => v.w > 640)
/* 宽的那两档（横屏手机 / 平板）**走的是桌面那一套**，判据 7 不适用 ——
   但把数报出来，免得哪天它们被切了没人看见。 */
for (const vp of WIDE7) {
  await viewport(vp)
  await go('/')
  const m = await evaluate(HERO7)
  const ok = !m.missing && m.live.right <= m.copy.right + 1
  console.log(
    `  · ${vp.name}（宽档，走桌面那一套）主张句右端 ${m.missing ? '-' : m.live.right} / 文案盒 ${m.missing ? '-' : m.copy.right}` +
      `${ok ? ' · 也装得下' : ' · ★ 装不下（这一档没有手机形态，判据 7 管不到它）'}`,
  )
}

for (const vp of PHONE7) {
  await viewport(vp)
  /* ★ 记账要在**导航之前**清空：清在导航之后的话，加载期间真的取了图也会被抹掉。
     ★ 还要先把**浏览器缓存清掉**再导航：`loading="lazy"` 只推迟"需要走网络"的取图，
     已经在内存里的那几张会在元素一建出来时就**立刻**解析掉 —— 于是同一个 tab 里
     量第二次、第三次时，"加载期间就取了 5 张"是一个**假故障**（第一档冷缓存下是 0）。
     冷缓存那一趟才是"第一次打开首页"这件事；三档量的是同一件事才可比。
     （清缓存只影响这一条：它在判据 1~6 之后跑。） */
  hlReqs.length = 0
  artReqs.length = 0
  await send('Network.clearBrowserCache')
  await go('/')
  const preReqs = hlReqs.length

  /* —— 7a —— */
  const m = await evaluate(HERO7)
  if (m.missing) {
    check(
      `${vp.name} · 7a 主张句没被切`,
      false,
      '量到 0 个：.hero__typing / -live / .hero__copy 有一样不在 DOM 里',
    )
  } else {
    check(
      `${vp.name} · 7a 主张句那一行没出文案盒（${m.t.w} ≤ ${m.copy.w}）`,
      m.t.right <= m.copy.right + 1,
      `行盒右端 ${m.t.right} / 文案盒右端 ${m.copy.right} · 占位 ${m.ghost} · 页面 scrollWidth ${m.docSW}`,
    )
    await typewriterWindow(vp.name, HERO7)
  }
  /* —— 7c：手机那一档首页只剩两节 ——
     ★ 判据取"两节都在、且亮点紧跟在**一屏**之后"，不取"某些东西不在 DOM 里"
       那一条单独用（"没有"是最容易被别的原因满足的判据：`.hl` 写错一个类名，
       首页也会"只剩一节"）。两条合起来才有判别力。
     ★ 2026-10-19 改版之后这里量的是**盒子**：环与书都还在 DOM 里（web 那一档要用），
       手机上靠 CSS 收掉 —— `display: none` 的子树不进辅助技术与 Tab 序，
       所以"手机上没有这两节"这句话仍然成立；"它有没有顺带取图"是另一笔账，
       由 7g 单独量（环是 `<img>`，会取；书页是 CSS 背景，不会）。
       旧的（三节）那一版两个数都会红：`.hl` 的顶边在 1.68 屏处。 */
  const home = await evaluate(HOME7)
  const cap = Math.round(vp.h * 1.2)
  check(
    `${vp.name} · 7c 首页只有两节：首屏（一屏）+ 亮点（量到首屏 ${home.hero.h}px、亮点顶边 ${home.hl.top}）`,
    home.hero.disp !== 'none' &&
      home.hero.h >= Math.round(vp.h * 0.95) &&
      home.hero.h <= cap &&
      home.hl.top > 0 &&
      home.hl.top <= cap &&
      /* 被收掉的那两节：**没有盒子**（`display: none` 与"零高"都算） */
      home.orbit.disp === 'none' &&
      home.story.disp === 'none' &&
      home.orbit.h === 0 &&
      home.story.h === 0 &&
      home.heroItems === 0,
    `首屏 ${home.hero.h}px / 视口 ${vp.h}（要 0.95~1.2 屏）· 亮点顶边 ${home.hl.top}（要 ≤ ${cap}）` +
      ` · 页面共 ${home.pageH}px · 环 ${home.orbit.disp}/${home.orbit.h}px（有盒子的卡 ${home.heroItems} 张）` +
      ` · 书 ${home.story.disp}/${home.story.h}px`,
  )
  /* —— 7g：手机上**一张封面都不该取** ——
     环是 `<img>`，而浏览器对 `display: none` 里的 `<img>` 照取不误 ——
     12 张共 2.8 MB（`du -sh public/art` 是 3.2 MB / 14 个文件）。
     所以取图那一步走 `<picture><source media="(min-width: 641px)">`。
     ★ 判别力：把那条 source 拿掉，这条当场红（量到 12 个请求），
       而 7c 仍然是绿的 —— 两件事必须分开量。 */
  check(
    `${vp.name} · 7g 手机上没取那 12 张封面（量到 ${artReqs.length} 次）`,
    artReqs.length === 0,
    `请求 ${artReqs.length} 次：${artReqs.slice(0, 4).join('/')}${artReqs.length > 4 ? '…' : ''}`,
  )
  await shoot(`home-hero-${vp.name.replace('×', 'x')}`)

  /* —— 7b + 7d：滚完整节，读亮点那一屏的形状与取图账 —— */
  await evaluate(`(() => {
    const el = document.querySelector('.hl')
    const top = Math.round(el.getBoundingClientRect().top + scrollY)
    const bottom = Math.round(el.getBoundingClientRect().bottom + scrollY - innerHeight)
    window.__hlRange = { top, bottom }
    window.scrollTo(0, top)
    return 1
  })()`)
  await sleep(1200)
  const hl = await evaluate(HL7)
  const widths = hl.widths.filter((w) => typeof w === 'number')
  check(
    `${vp.name} · 7b 竖排那五张卡的正文列够宽（量到 ${hl.items} 张）`,
    hl.items === 5 &&
      widths.length === 5 &&
      widths.every((w) => w >= 240) &&
      hl.listDisp !== 'none',
    `列宽 ${JSON.stringify(hl.widths)} / 要 ≥ 240 · 列表 ${hl.listDisp} · 轮播 ${hl.vpDisp}` +
      (hl.listDisp === 'none' ? '（★ 手机上列表没显示，说明这一屏还是轮播那一套）' : ''),
  )
  check(
    `${vp.name} · 7b 正文没有被截断（line-clamp 溢出为 0）`,
    hl.listDisp !== 'none' && hl.clamped === 0,
    `溢出 ${hl.clamped} 张 · 卡宽 ${hl.reelCardW}`,
  )
  /* 一路滚到这一节底：五张全宽卡要全部进过视口，才量得出"到底取了几张" */
  const hlRange = await evaluate(`window.__hlRange ?? { top: scrollY, bottom: scrollY }`)
  for (let y = hlRange.top; y <= hlRange.bottom; y += Math.round(vp.h * 0.6)) {
    await evaluate(`window.scrollTo(0, ${y});1`)
    await sleep(420)
  }
  /* ★ 等"五张都完成"要**轮询**，不能睡死一段时间就断言：最后一张是在扫到接近
     节底时才发出去的，固定 1.4s 会量到 4/5 —— 那看起来像"有一张取不到"，
     其实只是还没解码完（第一次跑就撞上了）。等不到就照实报几比几。 */
  let hl2 = await evaluate(HL7)
  for (let i = 0; i < 25 && hl2.imgsDone < 5; i += 1) {
    await sleep(400)
    hl2 = await evaluate(HL7)
  }
  /* ★ 数的是**这一趟导航里全部** `/highlights/*.webp` 请求，不是"滚动之后才开始数的"
     那一段（`preReqs` 之后那些）。
     ★ 2026-10-19 第三轮重标定：这一页从三节砍到两节之后，亮点那一节就落在
       **第一屏底下**（`.hl` 的顶边 = 1 屏），于是头两张卡落在 Chrome 的懒加载余量里、
       跟着首次加载一起取 —— 原来那条"滚到这一节之前 0 次请求"是**照三节那一版的
       页面高度标定的**，形状一换它就红，而红的不是设计（页面短了，图更早进余量，
       那是好事）。留下的是真正想钉的那件事：**五张各下一次、不重复下载**。 */
  const all = hlReqs.slice()
  const distinct = [...new Set(all)]
  check(
    `${vp.name} · 7d 那五张图各下一次（共 ${all.length} 次 / ${distinct.length} 个 URL）`,
    distinct.length === 5 && all.length === 5 && hl2.imgsDone === 5,
    `请求 ${all.length} 次 / 不同 URL ${distinct.length} 个（要 5 与 5）· 完成 ${hl2.imgsDone}/${hl2.imgsTotal}` +
      ` · 首次加载时就取了 ${preReqs} 张（两节之后的余量）`,
  )
  await shoot(`home-hl-${vp.name.replace('×', 'x')}`)
}

/* —— 7d 的另一半：**两套 DOM 共用同一批 URL** ——
   手机那五张竖排卡与桌面那个轮播是同一批图、同一个 `artPath`。
   这一条是**静态可查**的（不必看网络），判别力也强：谁给手机另出一批小图，
   它当场红 —— 那时候要一起改的是 `scripts/make-webp.py` 与资产清单，不是这条判据。 */
{
  await viewport({ name: '390×844', w: 390, h: 844, mobile: true })
  await go('/')
  const same = await evaluate(`(() => {
    const pick = (sel) => [...document.querySelectorAll(sel)]
      .map((i) => i.getAttribute('src')).filter(Boolean).sort()
    const list = pick('.hl__list img')
    const reel = pick('.hl__viewport img')
    return { list, reel, same: list.length === reel.length && list.every((s, i) => s === reel[i]) }
  })()`)
  check(
    '390×844 · 7d 手机那五张与桌面轮播那五张是同一批 URL',
    same.same && same.list.length === 5,
    `列表 ${same.list.length} 个 / 轮播 ${same.reel.length} 个 · 相同 ${same.same}`,
  )
}

/* —— 7e：桌面那一档不能被这套手机形态弄坏 ——
   ★ 判据取"五张图全 complete"，**不是**取卡片尺寸：卡片尺寸只有等到
     GSAP 把那一段过渡跑完才稳，量早了会读到一个 scale .93 的邻居卡
     （518 → 485，看着像回归，其实是量早了）。 */
{
  const vp = { name: '1440×900', w: 1440, h: 900, mobile: false }
  await viewport(vp)
  artReqs.length = 0
  await send('Network.clearBrowserCache')
  await go('/')
  const wide = await evaluate(HOME7)
  const artUrls = [...new Set(artReqs)]
  /* —— 7f：**web 端首页还是三节**（2026-10-19 用户澄清那一句的判据）——
     用户的原话：「我只让你删的是移动段的，没让你删 web 端的首页啊，
     web 端的首页和以前一样」。所以"手机两节"这条判据必须**配一条反向的**，
     否则把环与书删掉（第三轮干过的那件事）这一整支仍然全绿。
     ★ 三个数缺一不可：环有盒子且 12 张卡都排出来了、那本书有 340vh 的盒子、
       12 张封面**真的取了**（只查 DOM 的话，`<picture>` 那道门写错也看不出来）。
     ★ 顺带钉住"手机专属的横向卡带没有回来"：它是手机那一档的形态，
       而手机那一档现在连主题都不演。 */
  check(
    `1440×900 · 7f web 端首页仍是三节（环 ${wide.heroItems} 张 · 书 ${wide.story.h}px）`,
    wide.orbit.disp !== 'none' &&
      wide.heroItems === 12 &&
      wide.story.disp !== 'none' &&
      wide.story.h > vp.h * 2 &&
      wide.hero.disp !== 'none' &&
      !(await evaluate(`!!document.querySelector('.theme-strip')`)),
    `环 ${wide.orbit.disp} / 卡 ${wide.heroItems} 张 · 书 ${wide.story.disp} / ${wide.story.h}px（要 > ${vp.h * 2}）` +
      ` · 首屏 ${wide.hero.h}px · 页面共 ${wide.pageH}px`,
  )
  check(
    `1440×900 · 7f 桌面那 12 张封面照常取全（量到 ${artUrls.length} 个 URL / ${artReqs.length} 次）`,
    artUrls.length === 12,
    `请求 ${artReqs.length} 次 / 不同 URL ${artUrls.length} 个（要 12）`,
  )
  await evaluate(`(() => {
    const el = document.querySelector('.hl')
    window.scrollTo(0, Math.round(el.getBoundingClientRect().top + scrollY))
    return 1
  })()`)
  await sleep(2500)
  const m = await evaluate(HL7)
  check(
    `1440×900 · 7e 桌面亮点那一屏那五张图照常取全（${m.reelImgsDone}/${m.reelImgsTotal}）`,
    m.vpDisp !== 'none' && m.reelImgsTotal === 5 && m.reelImgsDone === 5 && m.listDisp === 'none',
    `轮播 ${m.vpDisp} · 列表 ${m.listDisp} · 轮播那五张 ${m.reelImgsDone}/${m.reelImgsTotal}` +
      ` · 竖排列表那五张 ${m.imgsDone}/${m.imgsTotal}（桌面这一档它是 display: none，本来就不该取）`,
  )
  await shoot('home-hl-1440x900')
}

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
