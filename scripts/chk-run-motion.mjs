/**
 * chk-run-motion.mjs —— 量**运行中那些动效**是不是真的在动
 *
 * 两种跑法：
 *
 * ```bash
 * # ① 走用户那条路（/home 写一句话 → 弹窗 → /create），要浏览器里有 Key
 * node scripts/chk-run-motion.mjs http://127.0.0.1:3321 --pages=5 .out/run-motion.png
 * # ①' 同一条，但选共读版（`--form=shared`）。★ 它会真多画一支，别当默认跑
 * node scripts/chk-run-motion.mjs http://127.0.0.1:3321 --form=shared .out/run-motion.png
 *
 * # ② 盯着**别人发起**的一轮（`?book=` 重放那条路）：脚本在服务端拿 .env.local 起跑，
 *    UI 这边只看。★ 这条路不需要浏览器里有 Key——密钥从来不进 localStorage（设置层
 *    写死的那条），所以一个干净的 Chrome profile 是跑不了 ① 的
 * node scripts/chk-run-motion.mjs http://127.0.0.1:3321 --book=<bookId> .out/run-motion.png
 * ```
 *
 * ★ ② 看到的画面是**打开那一刻**的快照：`/api/books/<id>/events` 是一次性回吐
 *   （不是长连接），所以刷新之后新事件不会自己进来。要它继续长，得再刷一次。
 *   但"条在不在、光在不在动、那一格在不在忙"这三件事，一份快照就够答了。
 *
 * 量四件事，每一件都对应一个**只有真跑才会不同**的判据：
 *
 * 1. **进度条的长度 = 已经画好的格数 / 总格数**。它的判据不是"条存在"，
 *    而是**像素比与阶段轨上那个 `k / N` 对得上**——条要是自己算了一个百分比，
 *    这两个数就会分家，而那正是 `Desk.tsx` 文件头第 1 条担心的那件事。
 * 2. **那些光真的在动**：读 `document.getAnimations()`，看 `dk-scan` / `dk-sweep` /
 *    `dk-breathe` / `gr-ping` 这几条动画在不在、`currentTime` 在两次采样之间有没有往前走。
 *    ★ 只看"元素在不在"是测不出"动没动"的（`preview-pane-hidden-freezes-raf-and-transitions`
 *      那条记过：过渡冻结时计算值会停在起点，看着像样式没生效）。
 * 3. **画好的那一格真的"落"下来了**：抓住某一格从"没有图"变成"有图"的那一瞬，
 *    立刻读它的 `.dk__art` 透明度和缩放（应当在动画中途），0.8s 后再读一次（应当是终态 1 / 无缩放）。
 * 4. **静止模式下每一条都停在终态**：中途把媒体特性切成 `prefers-reduced-motion: reduce`，
 *    再读一次——那几条动画应当**一条都不在**，而 `.dk__art` 仍然是完全显形的。
 *
 * ★ 走 ① 时它**会花钱**（真出一本书）。别在 CI 里跑，也别拿它常跑当冒烟测试。
 *
 * ★ 走 ②（`--book=`）时这一屏是**要登录的**：`/create` 没有票会 307 回 `/home`，
 *   而"盯着"那一段等的是画桌 —— 没票的话它等满 `--limit` 也不会有格，症状与
 *   "这一轮卡住了"一模一样。所以它跟 `chk-mobile.mjs` 用同一个办法：
 *   **本机现签**一张 `scope:'session'` 的 HS256 票（读 `.env.local` 里的
 *   `APP_JWT_SECRET`，与 `src/lib/auth/session.ts` 的 `verifyToken` 逐字对齐），
 *   导航之前用 `Network.setCookie` 塞进 `xzj_session`。★ 密钥只在本进程里用，
 *   一个字都不打印；`--user=` 给空串就是不带票。
 *   ★ 而且塞完要**验一次真的进了这一屏**（下面 `waitFor` 那一格）：
 *   "等满限时也没等到一格"与"根本没到这一屏"在读数上长得一样，
 *   只有后者该判不过 —— 所以它当场退，不静静地等满七分钟。
 */

import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const positional = args.filter((item) => !item.startsWith('--'))
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const base = (positional[0] ?? 'http://127.0.0.1:3321').replace(/\/+$/, '')
const OUT = positional[1] ?? null
/**
 * 页数。★ **必须是 `PAGE_CHOICES` 里那四档之一**（5 / 8 / 12 / 20，见 `state.ts`）——
 * 弹窗给的是四档而不是一个数字输入框（`GenerationSetupDialog` 判断 2）。
 * 传一个不在档里的数，这一趟会**静默按默认那一档跑**（`setPages` 没被调用），
 * 所以下面点不到时会直接把四档打出来，而不是继续跑一个不是你要的规模
 */
const PAGES = Number(flag('pages', '5'))
/**
 * 形态（2026-10-18 起它是弹窗的**第一问**，`BOOK_FORMS` 里的一档：solo / shared）。
 * ★ 默认 solo，与弹窗自己的默认一致——不点它也是这个值，所以下面点它只为把
 *   "这一问真的能选"这件事走一遍。共读版那一档会真的多画一支，别拿它当默认跑全量。
 */
const FORM = flag('form', 'solo')
const WISH = flag('wish', '一只纸箱小船顺着雨后的水沟，一路漂到月亮旁边')
/** 最多盯多久（毫秒）。20 页的书会超——那时候改大它 */
const LIMIT_MS = Number(flag('limit', '420000'))
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const PORT = Number(flag('port', '9338'))
const PROFILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'chrome-motion')

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${PROFILE}`,
  '--window-size=1440,900',
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
  if (res.result?.exceptionDetails) {
    return { __error: res.result.exceptionDetails.text }
  }
  return res.result?.result?.value
}

const errors = []
await send('Log.enable')
await send('Runtime.enable')
/**
 * 网络那一路也要看：这一轮的第一次真跑就是**悄悄 502** 掉的
 * （页面上只留一句"这一本没做出来"，而"为什么"在响应状态里）。
 * 只记不是 2xx/3xx 的，以及 `/api/books` 那一条（它是这一轮的开始）。
 */
const network = []
await send('Network.enable')
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Network.responseReceived') {
    const { url, status, mimeType } = msg.params.response
    const interesting = url.includes('/api/books') || status >= 400
    if (interesting)
      network.push(`${status} ${url.replace(base, '')}${mimeType ? ' · ' + mimeType : ''}`)
  }
})
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(msg.params.entry.text)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(
      msg.params.exceptionDetails.text +
        ' ' +
        (msg.params.exceptionDetails.exception?.description ?? ''),
    )
  }
})

/** 等一个表达式变真。返回真/假，不抛——调用方自己决定怎么报 */
async function waitFor(expression, ms, step = 500) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await evaluate(expression)) return true
    await sleep(step)
  }
  return false
}

await send('Page.enable')

/**
 * 本机现签一张票塞进 `xzj_session`（手法与 `chk-mobile.mjs` 那一条逐字一致）。
 *
 * ★ 只给 `--book=` 那条路用：`/home` 那一条走的是**真登录**（它要一个真浏览器里的
 *   Key 才能跑完 ①），给它塞一张本机票只会把那一趟的语义搅浑。
 * ★ 密钥只在本进程里用，一个字都不打印（`never log the secret`）。
 * 失败不抛：判据 6 那一路本来就允许"没票"（照实报没进去），
 *   让调用方自己看下面那一格的结果。
 */
async function signIn(userId) {
  if (userId === '') return '没带票（--user= 给了空串）'
  let raw
  try {
    raw = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), 'utf8')
  } catch {
    return '.env.local 读不到，没带票'
  }
  const key = raw
    .split(/\r?\n/)
    .find((line) => line.startsWith('APP_JWT_SECRET='))
    ?.slice('APP_JWT_SECRET='.length)
    .trim()
    .replace(/^["']|["']$/g, '')
  if (!key) return '.env.local 里没有 APP_JWT_SECRET，没带票'
  const b64 = (value) => Buffer.from(value).toString('base64url')
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64(
    JSON.stringify({
      sub: String(userId),
      acc: `u${userId}`,
      role: 'user',
      scope: 'session',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
  const sig = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')
  const cookie = await send('Network.setCookie', {
    name: 'xzj_session',
    value: `${header}.${payload}.${sig}`,
    url: base,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  })
  return cookie.result?.success ? `已带票（u/${userId}）` : '★ 票没塞进去'
}

/** ② 盯着别人发起的那一轮：直接进重放那一屏，不走 /home 与弹窗 */
const WATCH = flag('book', '')
/** 票的户主（`sub`）。空串 = 不带票，见 `signIn` */
const USER = flag('user', '1')

if (WATCH) {
  console.log(`登录：${await signIn(USER)}`)
  await send('Page.navigate', { url: `${base}/create?book=${encodeURIComponent(WATCH)}` })
  console.log(`盯着 ${WATCH} 这一轮（重放那条路，画面是打开那一刻的快照）。\n`)

  /**
   * ★ 先证明**真的进了这一屏**，再开始盯。
   *
   * 这一格是踩出来的：没票时 `/create` 会 307 回 `/home`，而"盯着"那一段等的是
   * 画桌 —— 于是它会安安静静地等满 `--limit`（默认 7 分钟），最后一格都没等到，
   * 读数与"这一轮卡住了"一模一样。★ 而"这个组件没渲染出来"恰恰是这一族探针最该
   * 抓住的坏法（`e2e-acceptance-needs-a-discriminating-signal` 那条：判据要落在
   * 只有真做才会不同的量上），所以这里当场退，不把它读成一次超时。
   */
  if (
    !(await waitFor(
      `location.pathname === '/create' && !!document.querySelector('.gr__rail')`,
      20000,
    ))
  ) {
    console.log('✗ 没进运行视图，现在在：', await evaluate(`location.href`))
    console.log('  多半是没带票（`--user=`）或者这一本不在这个账号名下。')
    process.exit(1)
  }
} else {
  await send('Page.navigate', { url: `${base}/home` })
}

/* ── ① 首页写下那句话（只有不指定 `--book=` 时才走这一段）───────────────── */

if (!WATCH) {
  if (!(await waitFor(`!!document.querySelector('.cl__input')`, 20000))) {
    console.log(
      '✗ /home 上没有出现输入框。页面现状：',
      await evaluate(`document.body.innerText.slice(0, 300)`),
    )
    process.exit(1)
  }
  /**
   * ★ **先证明 React 已经接管了这一屏**，再写字。
   *
   * 这一步是踩出来的：SSR 的那份 HTML 里输入框与按钮都在，所以"元素在不在"区分不出
   * "已经 hydrate" 与"还是一张静态纸"。在 hydrate 之前派发的 `input` 事件没有人听，
   * `.click()` 也一样——症状是**点了「开始创作」什么都不发生**（不报错、也不跳走），
   * 看起来像那颗按钮坏了。两次都是这么假出来的。
   *
   * 判据选"点开角色卡那颗药丸、下拉长不长出来"：那个下拉**只有 React 状态**能弄出来，
   * SSR 的 HTML 里没有它。
   */
  await evaluate(`document.querySelector('.cl__pill')?.click()`)
  let hydrated = false
  for (let i = 0; i < 20 && !hydrated; i += 1) {
    hydrated = await evaluate(`!!document.querySelector('.cl__options')`)
    if (hydrated) break
    // 点空的那一下说明事件还没人听——再点。**这一轮循环本身就是"等 hydrate"**
    await evaluate(`document.querySelector('.cl__pill')?.click()`)
    await sleep(800)
  }
  if (!hydrated) {
    console.log('✗ 连点 20 次都没长出下拉——这一屏可能根本没 hydrate。退出。')
    process.exit(1)
  }

  // ★ 受控输入：直接改 value 不会让 React 收到——要用原生 setter 再补一个 input 事件
  await evaluate(`(() => {
  const box = document.querySelector('.cl__input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(WISH)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
  // 按钮从禁用变可点，是"React 收到了那句话"的证据（`ready` 就是从 wish 推的）
  if (
    !(await waitFor(
      `{ const b = document.querySelector('.cl__go'); return !!b && !b.disabled }`,
      8000,
    ))
  ) {
    console.log(
      '✗ 写完那句话之后「开始创作」还是禁用的。角色卡：',
      await evaluate(`document.querySelector('.cl__pill-text')?.textContent`),
    )
    process.exit(1)
  }
  await evaluate(`document.querySelector('.cl__go').click()`)

  /* ── ② 那个"这一本要怎么做"的弹窗 ─────────────────────────────────────── */

  // ★ 20s：dev 下这个弹窗与 `/create` 那一片是**按需编译**的，第一次点常常要好几秒
  if (!(await waitFor(`!!document.querySelector('.gsd__chip')`, 25000))) {
    const why = await evaluate(`(() => ({
    地址: location.pathname + location.search,
    角色卡: document.querySelector('.cl__pill-text')?.textContent ?? null,
    弹窗: !!document.querySelector('.dlg'),
    弹窗标题: document.querySelector('.dlg__title')?.textContent ?? null,
    暂停: document.body.innerText.slice(0, 200),
  }))()`)
    console.log('✗ 弹窗没出来：', JSON.stringify(why, null, 2))
    console.log('  ★ 没选角色卡时「开始创作」会走 /character/new（`CreateLanding.submit` 那条）')
    process.exit(1)
  }
  /* ★ 形态那一组（2026-10-18 加进弹窗，是**第一组**）。
     点它之前先确认它在——它是"两种形态都能真的选"这件事在界面上的唯一一处。
     ★ 两组的按钮都是 `.gsd__chip`，所以下面凡是要读页数的地方都按"文字以 页 结尾"
       筛一遍：不筛的话读到的第一颗会是「独读版」。 */
  const formPicked = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.gsd__chip')].find((b) => b.textContent.trim() === '${FORM === 'shared' ? '共读版' : '独读版'}')
  if (!btn) return null
  btn.click()
  return btn.textContent.trim()
})()`)
  if (formPicked === null) {
    console.log(
      '✗ 形态那一组里没有这一颗：',
      await evaluate(
        `[...document.querySelectorAll('.gsd__chip')].map((b) => b.textContent.trim())`,
      ),
    )
    process.exit(1)
  }
  await evaluate(
    `[...document.querySelectorAll('.gsd__chip')].find((b) => b.textContent.trim() === '${PAGES} 页')?.click()`,
  )
  const picked = await evaluate(`(() => {
  const chips = [...document.querySelectorAll('.gsd__chip')]
  const pages = chips.filter((b) => b.textContent.trim().endsWith('页'))
  return {
  形态: chips.filter((b) => b.getAttribute('aria-pressed') === 'true' && !b.textContent.trim().endsWith('页')).map((b) => b.textContent.trim()),
  四档: pages.map((b) => b.textContent.trim()),
  选中: pages.find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent.trim() ?? null,
}
})()`)
  if (picked.选中 !== `${PAGES} 页`) {
    console.log(`✗ 没点中 ${PAGES} 页那一档：`, JSON.stringify(picked))
    console.log('  ★ 只能选这四档之一（`PAGE_CHOICES`）')
    process.exit(1)
  }
  // 不配音：开关默认跟着 canNarrate 走，这里显式关掉，免得这一趟还要等 TTS
  await evaluate(`(() => {
  const sw = document.querySelector('.gsd__switch')
  if (sw && sw.getAttribute('aria-checked') === 'true') sw.click()
})()`)
  const chosen = await evaluate(`(() => {
  const pages = [...document.querySelectorAll('.gsd__chip')].filter((b) => b.textContent.trim().endsWith('页'))
  return {
  页数: pages.find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent?.trim() ?? null,
  朗读: document.querySelector('.gsd__switch')?.getAttribute('aria-checked'),
}
})()`)
  console.log(
    '弹窗里选的：',
    JSON.stringify({ ...chosen, ...(picked.形态.length ? { 形态: picked.形态 } : {}) }),
  )
  await evaluate(`document.querySelector('.dlg__go').click()`)

  if (!(await waitFor(`location.pathname === '/create'`, 15000))) {
    console.log('✗ 没有跳到 /create，现在在：', await evaluate(`location.href`))
    process.exit(1)
  }
  /* ★ 形态**必须真的挂到地址上**（`CreateLanding.startRun` 那一行），
     而它是这一趟唯一一个"服务端要靠 URL 才知道"的新参数：读 `location.search`
     而不是读弹窗里的 state —— 前者是 `/create` 真正拿到的那一份 */
  const search = await evaluate(`location.search`)
  if (!search.includes(`form=${FORM}`)) {
    console.log(`✗ 地址上没有 form=${FORM}：`, search)
    process.exit(1)
  }
  console.log(`已经在 /create 上，${PAGES} 页，${FORM}，不配音。开始盯它。\n`)
}

/* ── ③ 盯着它跑 ───────────────────────────────────────────────────────── */

const ANIM_NAMES = ['dk-scan', 'dk-sweep', 'dk-breathe', 'gr-ping', 'dk-land', 'dk-land-ring']

const snapshot = () =>
  evaluate(`(() => {
  const rail = [...document.querySelectorAll('.gr__node')].map((n) => ({
    label: n.querySelector('.gr__name')?.textContent ?? '',
    state: n.dataset.state,
    note: n.querySelector('.gr__note')?.textContent ?? '',
  }))
  const bar = document.querySelector('.dk__bar')
  const fill = bar?.querySelector('.dk__bar-fill')
  const barBox = bar?.getBoundingClientRect() ?? null
  const fillBox = fill?.getBoundingClientRect() ?? null
  const frames = [...document.querySelectorAll('.dk__frame')]
  const arts = [...document.querySelectorAll('.dk__frame .dk__art')]
  const anims = document.getAnimations()
    .map((a) => ({ name: a.animationName ?? a.constructor.name, state: a.playState, t: Math.round(a.currentTime ?? -1) }))
    .filter((a) => ${JSON.stringify(ANIM_NAMES)}.includes(a.name))
  return {
    轨: rail.map((n) => n.label + ':' + n.state + (n.note ? '(' + n.note + ')' : '')).join(' '),
    条: bar ? {
      有: true,
      now: bar.getAttribute('aria-valuenow'),
      max: bar.getAttribute('aria-valuemax'),
      宽比: barBox && fillBox && barBox.width > 0 ? +(fillBox.width / barBox.width).toFixed(3) : null,
      走光: !!bar.querySelector('.dk__bar-beam'),
    } : { 有: false },
    格: frames.length,
    有图: arts.length,
    忙: frames.filter((f) => f.dataset.busy === 'true').map((f) => f.dataset.busyKind ?? '?'),
    动画: anims,
    好了: !!document.querySelector('.dk__done'),
    标题: document.querySelector('.gr__title')?.textContent ?? '',
  }
})()`)

const started = Date.now()
let lastArts = 0
let landing = null
let reducedCheck = null
let snap = null
let finished = false

while (Date.now() - started < LIMIT_MS) {
  snap = await snapshot()
  if (snap.__error) {
    console.log('采样出错：', snap.__error)
    break
  }

  // 某一格刚画好：立刻读它的入场动画（判据 3）
  if (landing === null && snap.有图 > lastArts) {
    const mid = await evaluate(`(() => {
      const art = [...document.querySelectorAll('.dk__frame .dk__art')].pop()
      if (!art) return null
      const cs = getComputedStyle(art)
      return { 透明: cs.opacity, 缩放: cs.transform, 动画: art.getAnimations().map((a) => a.animationName) }
    })()`)
    await sleep(900)
    const settled = await evaluate(`(() => {
      const art = [...document.querySelectorAll('.dk__frame .dk__art')].pop()
      if (!art) return null
      const cs = getComputedStyle(art)
      return { 透明: cs.opacity, 缩放: cs.transform }
    })()`)
    landing = { 那一瞬: mid, 落定: settled }
    console.log('落格那一瞬：', JSON.stringify(landing))
  }
  lastArts = Math.max(lastArts, snap.有图)

  // 中途验一次静止模式（判据 4）：只在"有格子在忙"的时候做，这样条与光都还在
  if (reducedCheck === null && snap.忙.length > 0 && snap.有图 > 0) {
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    await sleep(300)
    reducedCheck = await snapshot()
    await send('Emulation.setEmulatedMedia', { features: [] })
    console.log(
      '静止模式下：',
      JSON.stringify({
        动画: reducedCheck.动画,
        条: reducedCheck.条,
        有图: reducedCheck.有图,
      }),
    )
  }

  console.log(
    `[${String(Math.round((Date.now() - started) / 1000)).padStart(3)}s] ` +
      `格 ${snap.有图}/${snap.格} · 条 ${snap.条.有 ? `${snap.条.now}/${snap.条.max} 宽比 ${snap.条.宽比}${snap.条.走光 ? ' 有走光' : ''}` : '（还没出现）'}` +
      ` · 忙 ${snap.忙.join(',') || '无'} · 动画 ${snap.动画.map((a) => a.name + '@' + a.t).join(' ') || '无'}`,
  )

  if (snap.好了) {
    finished = true
    break
  }
  // ★ 头几秒**采得密**：`.dk__art` 的入场动画只有 0.5s，2.5s 一跳会整整跳过它
  //   （判据 3 于是永远"没抓到"，而那看着像"动画没播"）。10 秒之后回到 2.5s ——
  //   出一页要几十秒，密采只是白烧 CPU
  await sleep(Date.now() - started < 10000 ? 250 : 2500)
}

/* ── ④ 汇总 ───────────────────────────────────────────────────────────── */

if (OUT) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
  console.log('截图：', OUT)
}

const final = await snapshot()
console.log('\n最终：', final.标题, '·', final.轨)
console.log(
  '盘面上那句为什么：',
  await evaluate(`document.querySelector('.gr__error')?.textContent ?? '（没有那句）'`),
)
console.log('网络：', network.length === 0 ? '没有非 2xx 的响应 ✓' : network.slice(-8))
console.log('页里的错误：', errors.length === 0 ? '没有 ✓' : errors)

// 判据 2：那几条动画在**两次采样之间**有没有往前走
const moved = new Map()
for (const a of final.动画) moved.set(a.name, a.t)
console.log('\n判据小结（自己看，不替下结论）：')
console.log(`  跑完了没有：${finished ? '是' : '★ 没跑完（超时或失败）'}`)
console.log(`  进度条出现过：${snap?.条.有 ? '是' : '★ 没有'}`)
console.log(`  抓到落格那一瞬：${landing ? JSON.stringify(landing.那一瞬) : '★ 没抓到'}`)
console.log(
  `  静止模式下还剩的动画：${reducedCheck ? JSON.stringify(reducedCheck.动画) : '★ 没验到'}`,
)

ws.close()
chrome.kill()
process.exit(finished ? 0 : 1)
