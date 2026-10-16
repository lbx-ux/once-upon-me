/**
 * probe-shelf.mts —— 书架（/shelf）那屏的布局判据：**书是不是真的立在板上**
 *
 * 用法（仓库根，先起一个自己的 dev server，别占用别人会话的 :3000）：
 *
 * ```bash
 * node scripts/make-probe-library.mts --out=.out/shelf-probe          # ① 造隔离资产根
 * ASSET_ROOT=.out/shelf-probe node scripts/dev-preview.mjs --dist=.next-shelfprobe --port=3333
 * node scripts/probe-shelf.mts                                       # ② 探
 * node scripts/probe-shelf.mts --base=http://localhost:3000          # 或指向现成的
 * ```
 *
 * ★★ **从 2026-10-16 起这个脚本会写盘、还会删文件**（拖动换位写 `shelf/order.json`，
 *   删除那一节真删 `books/<id>/` 与它的缩略图）。所以它跑在
 *   `make-probe-library.mts` 造出来的**隔离资产根**上，且删除那一节**双重守卫**：
 *   只删书号以 `probe-` 开头的书。指向 `.out/web`（用户自己的书架）时
 *   **跳过并说明**，绝不误删用户唯一那本书。
 *
 * 需要**一个 Chromium 内核浏览器**（Chrome / Edge / Playwright 装的那份都行）：
 * 本仓库没装 playwright / puppeteer，这里用 CDP 直连浏览器，探测脚本本身就是全部依赖。
 * 找不到时 `--chrome="C:/Program Files/Google/Chrome/Application/chrome.exe"` 指一个。
 *
 * ★ 为什么不走 app 内置预览（2026-10-16 实测）：预览面板隐藏时 rAF 与 transition
 *   一起冻结，`getBoundingClientRect` 会读到过渡**起点**，量出来的几何是错数——
 *   看着就像样式没生效。所以几何判据必须打真浏览器。
 *
 * 判据选的是"只有真做对了才会不同的量"，不是"页面上有没有这些字"：
 *   ① 书真的**立在板上**：书的底边 y 与 `--board-top` 差 ≤ 1px。
 *      这组数是咬合的（`--cover-h` = `--book-w`×4/3，`--board-top` = `--cover-h`
 *      + 书名条高），改 `--book-w` 漏改 `--row-h` 时这一条最先红。
 *   ② 搁板是**通长**的：板不是每格一张，而是容器背景按行高平铺
 *      （`background-size: 100% var(--row-h); repeat-y`）。一行没摆满时
 *      平铺周期仍等于行高——按格画板的话末行右侧那片空处就没有板，看着是半截货架。
 *   ③ 封面走 384 档：书在这一屏只有 104–156px 宽，1024 档是阅读器一整页的。
 *      这条**截真请求**——只有 URL 走对了才会长这样。证据取两处并集
 *      （CDP 的 Network 事件 + 页面的 resource timeline）：冷编译那一趟
 *      CDP 那条链路会整条丢，只剩一处时这条判据是假红。
 *   ④ 封面真的到了（200 + 不是 0 字节）。
 *   ⑤ 375 没有横向溢出（`--book-w` 是 clamp，收窄靠它）。
 *   ⑥ 控制台没有 error。
 *   ⑦ **书与板直接压在天光上**：查不到 `.shelf__case`，且架子自己没有底色
 *      （`background-color` 是透明的——板是 `background-image`，底色必须是空的）。
 *      2026-10-16 第二轮撤掉了那块 `--card-paper` 的暖纸柜身（用户："和背景有点突兀"）。
 *   ⑧ 架子落在天空带里（`--sky-h` 用临时块解出来）：这是"暖色压在天光上太硬"
 *      这件事成立的前提，也是下一次有人改 `--sky-h` 时唯一会响的地方。
 *   ⑨ **页头是看得见的**：`h1` 是「书架」且**高度 > 8px**（`sr-only` 那一版是 0 高）、
 *      顶边在第一排书之上；「编辑」是一颗 `<button>`，右边缘与书架右缘对齐。
 *      这条守的是"标题还挂在 `sr-only` 上"那种半成品。
 *   ⑩ 点「编辑」之后：架子带 `data-editing`、每本书一颗 ✕、虚线那本**不在**，
 *      而且**点一本书 URL 不变**（编辑模式下点书不许跳走）。
 *   ⑪ **真的拖一次**（CDP 的 `Input.dispatchMouseEvent`：按下 → 横移过邻居中心 → 松手）：
 *      DOM 次序真的变了。★ 然后**重载一次**再查一遍——重载那一步才是"写进盘里了"
 *      的证据；只看 DOM 变了，证明的只是"本地状态改了"。
 *   ⑫ **真删一本**（只删 `probe-` 那本，且专挑**有封面**的那一本——只有它的图被真缩过，
 *      才会把"删了卡没删图"那条老路走一遍）：确认框**只有一句话**（框里一个数字都没有、
 *      没有逐行清单，两颗按钮是「算了」/「确认删掉」）→ 先走一遍**「算了」**（框收了、
 *      书还在、接口里也在）→ 再确认，那一本从架上与 `/api/books` 里一起消失、
 *      另外几本照旧，而且**页面上什么回执都不留**（用户："书架底下什么也不要留"）。
 *      ★ 判据是"它有多短"而不是"它写了什么"：旧版那张表上有 11 条 / 18 条那两个数，
 *        还有三个位置名——2026-10-16 用户看完说「也不要写这么多，就一个确认」。
 *        这一节顺便留一张 `shelf-confirm-1440.png`（旧版那张是他画了红叉发过来的，
 *        回话时得有新的一张）。
 *   ⑬ 键盘那一格真有（`←/→`）：聚焦那一本、发一次真的 `ArrowRight`，
 *      次序换过来、读屏那一句也报了第几位、而且**服务端那份也跟着变了**。
 *
 * ★ **改完组件等 HMR 落定再跑**（2026-10-16 实测）：刚存盘就开跑，页面拿到的还是
 *   上一个客户端 bundle，症状是"点 ✕ 没反应"——看着像功能坏了，其实是跑到一半。
 * ★ 自定义属性得**在一个元素上解出来**才能拿到像素值：`getPropertyValue('--book-w')`
 *   给的是未解析的 `clamp(...)`。脚本里借一个临时块量 `offsetHeight`。
 *
 * 产物：`.out/shelf-1440.png` 与 `.out/shelf-375.png`（--out 改）。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { arg } from './env.mts'

const BASE = arg('base', 'http://localhost:3333').replace(/\/+$/, '')
const OUT = resolve(arg('out', '.out'))
const CDP_PORT = 9431

/** 找一个能说 CDP 的浏览器。版本号会变（chromium-1228 今天、明天就是 1229），所以列目录不写死 */
function findChrome(explicit: string): string {
  const candidates: string[] = []
  if (explicit) candidates.push(explicit)
  const local = process.env.LOCALAPPDATA
  if (local) {
    const pwRoot = join(local, 'ms-playwright')
    for (const dir of existsSync(pwRoot)
      ? readdirSync(pwRoot).filter((d) => d.startsWith('chromium-'))
      : []) {
      candidates.push(join(pwRoot, dir, 'chrome-win64/chrome.exe'))
      candidates.push(join(pwRoot, dir, 'chrome-win/chrome.exe'))
    }
  }
  for (const root of (['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432'] as const)
    .map((k) => process.env[k])
    .filter((v): v is string => Boolean(v))) {
    candidates.push(join(root, 'Google/Chrome/Application/chrome.exe'))
    candidates.push(join(root, 'Microsoft/Edge/Application/msedge.exe'))
  }
  candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  )
  const hit = candidates.find((c) => c && existsSync(c))
  if (!hit) {
    throw new Error(
      '没找到 Chromium / Chrome / Edge。用 --chrome="C:/Program Files/Google/Chrome/Application/chrome.exe" 指一个。',
    )
  }
  return hit
}

type CdpMsg = {
  id?: number
  method?: string
  params?: {
    request?: { url: string }
    response?: { status: number; url: string }
    entry?: { level: string; text: string }
    exceptionDetails?: { text: string; exception?: { description?: string } }
  }
  result?: { result?: { value?: unknown }; exceptionDetails?: { text: string }; data?: string }
}

type ProbeResult = {
  missing?: true
  vars: { bookW: number; coverH: number; labelH: number; boardTop: number; rowH: number }
  bgSize: string
  bgRepeat: string
  bgLayers: number
  hasCase: boolean
  rackBg: string
  rackTop: number
  skyH: number | null
  covers: { url: string; status: number }[]
  bookCount: number
  newBook: boolean
  bookBottomInRack: number | null
  cover: { h: number; w: number } | null
  h1: string | null
  /** 页头那个一级标题的盒子。★ `sr-only` 那一版的高度是 0——⑨ 就靠这个数 */
  h1Box: { x: number; y: number; w: number; h: number } | null
  /** 「编辑 / 完成」那颗按钮 */
  editText: string | null
  editTag: string | null
  editBox: { x: number; y: number; w: number; h: number; right: number } | null
  /** 书架自己的盒子（右缘要对齐按钮的右缘） */
  rackBox: { x: number; y: number; w: number; h: number; right: number }
  editing: boolean
  removes: number
  grabs: number
  /** DOM 里那一排书号，从左到右（⑪ 拖完之后看它变没变） */
  order: string[]
  /** 其中以 `probe-` 开头的（删除那一节的守卫，见文件头） */
  probeIds: string[]
  /** 有封面的那几本（`data-ready`）：删除那一节专挑它们，好把"缩略图缓存"那一行也走成真的 */
  readyIds: string[]
  /** 确认框里那一整段字（一句话版本；逐行清单只在删到一半失败时才出现） */
  confirmText: string | null
  /** 那句话里《》中间的书名（"问的是哪一本"就是它） */
  confirmTitle: string | null
  /** 确认框上那几颗按钮各写着什么（`['算了', '确认删掉']`） */
  confirmButtons: string[]
  hasConfirm: boolean
  /** 页面自己那一行提示（顺序没存上 / 数不出要删什么…）。★ 它本该是空的 */
  notice: string | null
  /** 刚被点过的那个元素叫什么。点偏了的时候，这一条比"有没有出现"好查得多 */
  active: string | null
  overflow: number
}

/** 页内跑的那段。结果经 `returnByValue` 回来，形状见 `ProbeResult` */
const PAGE_PROBE = `(() => {
  const rack = document.querySelector('.shelf__rack')
  if (!rack) return { missing: true }
  const cs = getComputedStyle(rack)
  const box = (e) => { const r = e.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      bottom: Math.round(r.bottom), right: Math.round(r.right) } }
  const books = [...rack.querySelectorAll('.shelf__book')]
  const first = books[0]
  const cover = first ? first.querySelector('.shelf__cover') : null
  // 自定义属性得在一个元素上解出来才有像素值（getPropertyValue 给的是未解析的 clamp）
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;visibility:hidden'
  rack.appendChild(probe)
  const px = (name) => { probe.style.height = 'var(' + name + ')'; return Math.round(probe.offsetHeight) }
  const vars = {
    bookW: px('--book-w'), coverH: px('--cover-h'), labelH: px('--label-h'),
    boardTop: px('--board-top'), rowH: px('--row-h'),
  }
  probe.remove()
  // ③ 页内那份封面请求记录用的正则（为什么这么拼见下面 covers 那三条注释）
  const coverRe = new RegExp('/api/assets/.*cover', 'i')
  // ⑧ 天空带有多高：--sky-h 定义在 .sb 上，同样借一个临时块解成像素
  const skyEl = document.querySelector('.sb')
  let skyH = null
  if (skyEl) {
    const d = document.createElement('div')
    d.style.cssText = 'position:absolute;visibility:hidden'
    d.style.height = 'var(--sky-h)'
    skyEl.appendChild(d)
    skyH = Math.round(d.offsetHeight)
    d.remove()
  }
  // ⑨ 页头：标题与那颗「编辑」。★ 用 box 而不是"有没有这个元素"——
  //   sr-only 那一版元素也在，只是屏幕上没有（高度 0）。
  //   ★ 这一行里不许出现反引号：它整段是模板字面量里的字符串，一个反引号就把
  //     模板提前闭合了（这一轮又踩了一次，与下面 covers 那段注释同源）
  const h1 = document.querySelector('h1')
  const edit = document.querySelector('.shelf__edit')
  // ⑪ DOM 里那一排书号，从左到右
  const slots = [...rack.querySelectorAll('li[data-book-id]')]
  const order = slots.map((one) => one.getAttribute('data-book-id') || '')
  const confirmEl = document.querySelector('.shelf__confirm')
  return {
    vars,
    bgSize: cs.backgroundSize,
    bgRepeat: cs.backgroundRepeat,
    bgLayers: cs.backgroundImage.split('linear-gradient').length - 1,
    // ⑦ 柜身还在不在 / 架子自己有没有底色（见文件头 ⑦）
    hasCase: !!document.querySelector('.shelf__case'),
    rackBg: cs.backgroundColor,
    rackTop: Math.round(box(rack).y + window.scrollY),
    skyH,
    // ③ 封面那几条真请求的另一份记录：浏览器自己的 resource timeline。
    //    ★ 与 CDP 的 Network 事件互为备份：dev server **冷编译**那一趟里
    //      Network.responseReceived 会整条收不到（2026-10-16 实测：第一次跑报
    //      "书架真的去拉了封面 ✗"，热了以后重跑就有）。两份取并集，谁都不当默认值。
    //    ★ 正则用 new RegExp 拼、不写字面量斜杠包裹：这段整块是**页内脚本的字符串**，
    //      斜杠转义在模板字面量里会被吃掉一个反斜杠，剩下两个斜杠把后面整行注释掉
    //      （2026-10-16 真踩了：SyntaxError: Unexpected token '.'。同类还有反引号，
    //        下面这几行注释里就不许出现反引号——写这句的时候又踩了一次）
    covers: performance
      .getEntriesByType('resource')
      .filter((e) => coverRe.test(e.name))
      .map((e) => ({ url: e.name.replace(location.origin, ''), status: e.responseStatus || 0 })),
    // ★ 数"书"要排掉末位那本虚线的「新建故事」：它带同一个 shelf__book 类
    //   （样式共用），但把它数成一本创作出来的书就是在给这一屏灌水
    bookCount: books.filter((b) => !b.classList.contains('shelf__book--new')).length,
    newBook: !!rack.querySelector('.shelf__book--new'),
    bookBottomInRack: first ? Math.round(box(first).bottom - rack.getBoundingClientRect().top) : null,
    cover: cover ? box(cover) : null,
    h1: h1 ? h1.textContent : null,
    h1Box: h1 ? box(h1) : null,
    editText: edit ? edit.textContent : null,
    editTag: edit ? edit.tagName.toLowerCase() : null,
    editBox: edit ? box(edit) : null,
    rackBox: box(rack),
    editing: rack.getAttribute('data-editing') === 'true',
    removes: rack.querySelectorAll('.shelf__remove').length,
    grabs: rack.querySelectorAll('.shelf__grab').length,
    order,
    probeIds: order.filter((id) => id.indexOf('probe-') === 0),
    readyIds: order.filter(
      (id) => !!document.querySelector('li[data-book-id="' + id + '"] .shelf__cover[data-ready]'),
    ),
    confirmText: confirmEl ? confirmEl.innerText : null,
    confirmTitle: (() => {
      const lead = confirmEl ? confirmEl.querySelector('.shelf__confirm-lead') : null
      const m = lead ? new RegExp('《(.+?)》').exec(lead.innerText) : null
      return m ? m[1] : null
    })(),
    confirmButtons: confirmEl
      ? [...confirmEl.querySelectorAll('button')].map((b) => b.innerText)
      : [],
    hasConfirm: !!confirmEl,
    notice: document.querySelector('.shelf__notice')
      ? document.querySelector('.shelf__notice').innerText
      : null,
    active: document.activeElement
      ? document.activeElement.className || document.activeElement.tagName
      : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})()`

async function main(): Promise<void> {
  const chrome = findChrome(arg('chrome', ''))
  const profile = mkdtempSync(join(tmpdir(), 'cdp-shelf-'))
  const browser = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      '--window-size=1440,1000',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  async function wsUrl(): Promise<string> {
    for (let i = 0; i < 60; i++) {
      try {
        const list = (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) =>
          r.json(),
        )) as { type: string; webSocketDebuggerUrl?: string }[]
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
      } catch {
        /* 还没起来 */
      }
      await sleep(250)
    }
    throw new Error('浏览器没起来')
  }

  const socket = new WebSocket(await wsUrl())
  await new Promise((r) => (socket.onopen = r))
  let seq = 0
  const pending = new Map<number, (m: CdpMsg) => void>()
  const events: CdpMsg[] = []
  socket.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as CdpMsg
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)?.(m)
      pending.delete(m.id)
    } else if (m.method) {
      events.push(m)
    }
  }
  const send = (method: string, params: Record<string, unknown> = {}): Promise<CdpMsg> => {
    const id = ++seq
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((r) => pending.set(id, r))
  }
  const evaluate = async (expression: string): Promise<unknown> => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails))
    return res.result?.result?.value
  }
  const load = async (w: number, h: number): Promise<void> => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await send('Page.navigate', { url: `${BASE}/shelf` })
    for (let i = 0; i < 120; i++) {
      await sleep(250)
      if (await evaluate(`document.querySelector('.shelf__rack') !== null`)) break
    }
    await sleep(1800)
  }
  const shoot = async (name: string, w: number, h: number): Promise<void> => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await sleep(700)
    const res = await send('Page.captureScreenshot', { format: 'png' })
    mkdirSync(OUT, { recursive: true })
    const data = res.result?.data
    if (!data) throw new Error('截图没拿到')
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'))
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Log.enable')

  let bad = 0
  const check = (ok: boolean, what: string) => {
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗'} ${what}`)
  }

  /** 一次真的指针事件。`buttons` 1 = 按着左键（拖动途中要一直是 1） */
  const mouse = async (type: string, x: number, y: number, buttons: number): Promise<void> => {
    await send('Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      buttons,
      clickCount: 1,
    })
  }
  type Box = { x: number; y: number; w: number; h: number; cx: number; cy: number }
  const rectOf = async (selector: string): Promise<Box | null> =>
    (await evaluate(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
      })()`,
    )) as Box | null
  /** 真按下去再抬起来（浏览器会据此派发一次 click）。
   *  ★ 按之前先把它滚进视口**再重新量一次**：CDP 的坐标是**视口**坐标，
   *    `getBoundingClientRect` 也是——但一个在视口下方的元素，它的 y 会大于视口高度，
   *    那时派发出去的事件落在谁身上只有浏览器知道（实测就是"点了没反应"）。
   *    2026-10-16 真踩了：确认框那一行按钮正好在 1000px 下面一点。 */
  const clickOn = async (selector: string): Promise<boolean> => {
    const found = (await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)})
         if (!el) return false
         el.scrollIntoView({ block: 'center', inline: 'nearest' })
         return true })()`,
    )) as boolean
    if (!found) return false
    await sleep(250)
    const box = await rectOf(selector)
    if (!box) return false
    await mouse('mousePressed', box.cx, box.cy, 1)
    await sleep(60)
    await mouse('mouseReleased', box.cx, box.cy, 0)
    return true
  }
  /** 按住 → 分几步横移 → 松手。★ 分步是必要的：一步跳过去只会有一次 move，
   *  而"拖过邻居的中心"这件事正是边走边判的 */
  const dragTo = async (from: Box, x: number, y: number): Promise<void> => {
    await mouse('mousePressed', from.cx, from.cy, 1)
    const steps = 6
    for (let i = 1; i <= steps; i += 1) {
      await mouse(
        'mouseMoved',
        from.cx + ((x - from.cx) * i) / steps,
        from.cy + ((y - from.cy) * i) / steps,
        1,
      )
      await sleep(70)
    }
    await mouse('mouseReleased', x, y, 0)
  }
  const probe = async (): Promise<ProbeResult> => (await evaluate(PAGE_PROBE)) as ProbeResult
  /** 把编辑模式拨到想要的那一档。★ 写成"拨到"而不是"点一下"：那颗按钮是**开关**，
   *  在第一版里，前一段已经在编辑模式时后一段再点一下会把它关掉，
   *  症状是"点得到 ✕"这一条突然红（元素根本不在）——那是探针自己把自己绊倒 */
  const ensureEditing = async (on: boolean): Promise<void> => {
    if ((await probe()).editing === on) return
    await clickOn('.shelf__edit')
    await sleep(400)
  }

  try {
    console.log(`浏览器：${chrome}`)
    console.log(`站点：${BASE}`)

    console.log('──── 1440×1000 ────')
    await load(1440, 1000)
    let wide = (await evaluate(PAGE_PROBE)) as ProbeResult
    /** 最后一次读到的封面请求（轮询时每轮更新；见下面那段的理由） */
    let lastCovers: { url: string; status: number }[] = wide.covers
    console.log(JSON.stringify(wide, null, 2))

    check(!wide.missing, '书架容器在')
    check(wide.bookCount >= 1, `架子上真有书（${wide.bookCount} 本，不含新建那一格）`)
    check(wide.newBook, '末位那本"虚线书"在')
    check(
      wide.bookBottomInRack !== null && Math.abs(wide.bookBottomInRack - wide.vars.boardTop) <= 1,
      `书的底边落在板顶：${wide.bookBottomInRack} vs --board-top ${wide.vars.boardTop}`,
    )
    check(
      wide.bgRepeat.includes('repeat-y') && wide.bgSize.endsWith(`${Math.round(wide.vars.rowH)}px`),
      `板是平铺的、一格 = 行高：${wide.bgSize} / ${wide.bgRepeat}`,
    )
    check(wide.bgLayers === 2, `板是两层（书的投影 + 板本身）：${wide.bgLayers}`)
    // ⑦⑧ 第二轮撤柜身（见文件头）：这两条只有在真的撤干净、且架子确实压在天光上时才过
    check(!wide.hasCase, `柜身不在（查不到 .shelf__case）：${wide.hasCase}`)
    check(
      wide.rackBg === 'rgba(0, 0, 0, 0)' || wide.rackBg === 'transparent',
      `架子自己没有底色（板是 background-image）：${wide.rackBg}`,
    )
    check(
      wide.skyH !== null && wide.rackTop < wide.skyH,
      `书架落在天空带里：顶边 ${wide.rackTop} < --sky-h ${wide.skyH}`,
    )
    check(wide.h1 === '书架', `一级标题是「书架」：${JSON.stringify(wide.h1)}`)
    check(
      wide.h1Box !== null && wide.h1Box.h > 8,
      `标题真的看得见（高 ${wide.h1Box?.h}px；挂在 sr-only 上的那一版是 0）`,
    )
    check(
      wide.h1Box !== null && wide.cover !== null && wide.h1Box.y < wide.cover.y,
      `标题在第一排书之上：y ${wide.h1Box?.y} < ${wide.cover?.y}`,
    )
    check(
      wide.h1Box !== null && wide.cover !== null && wide.h1Box.x <= wide.cover.x,
      `标题在左边：x ${wide.h1Box?.x} ≤ 第一本 ${wide.cover?.x}`,
    )
    check(
      wide.editTag === 'button' && wide.editText === '编辑',
      `右上角那颗是 <button> 且写着「编辑」：${wide.editTag} / ${JSON.stringify(wide.editText)}`,
    )
    check(
      wide.editBox !== null && Math.abs(wide.editBox.right - wide.rackBox.right) <= 1,
      `它右边缘与书架右缘对齐：${wide.editBox?.right} vs ${wide.rackBox.right}`,
    )
    check(
      wide.cover !== null && Math.abs(wide.cover.h - wide.vars.coverH) <= 1,
      `封面是 3:4：高 ${wide.cover?.h} vs --cover-h ${wide.vars.coverH}`,
    )
    check(
      wide.cover !== null && wide.cover.w === Math.round(wide.vars.bookW),
      `封面宽 = --book-w：${wide.cover?.w} / ${wide.vars.bookW}`,
    )

    // ③④ 封面那条网络请求：只有 URL 走对了才会长这样。
    //   ★ 两个来源取并集（CDP 的 Network 事件 + 页面的 resource timeline）——
    //     冷编译那一趟 CDP 那条链路会整条丢，只剩一处证据时这条判据是假红。
    //   ★★ 而且要**等**：`/api/assets/[...path]` 那条路由在被第一次问到之前是没编译的，
    //     冷的那一趟封面请求要好几秒才回来。等一次固定的 1800ms 会把"还没拿到"
    //     读成"根本没拉"（2026-10-16 实测：同一个 URL，前一秒空、后一秒两条 200）。
    //     所以这里轮询到有证据为止，而不是判一次。
    const readCovers = (): { url: string; status: number }[] => {
      const cdpCovers = events
        .filter((e) => e.method === 'Network.responseReceived')
        .map((e) => e.params)
        .filter((p) => /\/api\/assets\/.*cover/i.test(p?.response?.url ?? ''))
        .map((p) => ({
          url: p?.response?.url?.replace(BASE, '') ?? '',
          status: p?.response?.status ?? 0,
        }))
      return [
        ...new Map([...cdpCovers, ...lastCovers].map((c) => [`${c.status} ${c.url}`, c])).values(),
      ]
    }
    let coverReqs = readCovers()
    for (let i = 0; i < 40 && coverReqs.length === 0; i += 1) {
      await sleep(500)
      wide = (await evaluate(PAGE_PROBE)) as ProbeResult
      lastCovers = wide.covers
      coverReqs = readCovers()
    }
    console.log(
      '封面请求：',
      coverReqs.map((c) => `${c.status} ${c.url}`),
    )
    check(coverReqs.length >= 1, '书架真的去拉了封面')
    check(
      coverReqs.some((c) => c.url.includes('w=384')),
      '封面走的是 384 档（不是原图、也不是阅读器的 1024）',
    )
    check(
      coverReqs.every((c) => c.status === 200),
      '封面请求都是 200',
    )

    await shoot('shelf-1440.png', 1440, 1000)

    /* ── ⑩ 编辑模式 ─────────────────────────────────────────────────── */

    console.log('──── 编辑模式（⑩） ────')
    const browse = await probe()
    /**
     * ★★ 守卫：**只有架子上真有 `probe-` 开头的书**（= 探针跑在
     * `make-probe-library.mts` 造的隔离夹子上）才动会写盘的那两节。
     * 指向用户自己的书架时（`--base=http://localhost:3000` 那条用法）：
     * 编辑模式与页面本身照旧看，但**拖动与键盘不跑、删除更加不跑**——
     * 一次"验收"把用户自己排好的次序改了、或者把他唯一那本书删了，
     * 那不是验收，那是事故。
     */
    const guarded = browse.probeIds.length > 0
    if (!guarded) {
      console.log(
        '⚠ 这个书架里没有 probe- 开头的书：拖动 / 键盘 / 删除三节**跳过**（它们会写盘）。',
      )
      console.log('  想跑全：先 node scripts/make-probe-library.mts --out=.out/shelf-probe，')
      console.log('  再 ASSET_ROOT=.out/shelf-probe 起一台 dev server。')
    }
    check(await clickOn('.shelf__edit'), '点得到右上角那颗「编辑」')
    await sleep(400)
    const edit = await probe()
    check(edit.editing, `架子进了编辑模式：data-editing=${edit.editing}`)
    check(edit.editText === '完成', `那颗按钮变成「完成」：${JSON.stringify(edit.editText)}`)
    check(
      edit.removes === browse.order.length && edit.grabs === browse.order.length,
      `每本书都有一颗 ✕ 与一枚抓手：${edit.removes} / ${edit.grabs} / ${browse.order.length} 本`,
    )
    check(!edit.newBook, '虚线那本「新建故事」不在（它是入口，不是可摆的一本书）')

    // 编辑模式下点一本书**不许跳走**（那一刻它不是链接了）
    const pathBefore = await evaluate('location.pathname')
    const firstCover = await rectOf(`li[data-book-id="${browse.order[0]}"] .shelf__cover`)
    if (firstCover) await dragTo(firstCover, firstCover.cx, firstCover.cy)
    await sleep(400)
    check(
      (await evaluate('location.pathname')) === pathBefore,
      `编辑模式下点一本书不跳走：还在 ${String(await evaluate('location.pathname'))}`,
    )
    check(!(await probe()).hasConfirm, '点一下书也不会顺手弹出确认框')
    const afterPress = await probe()
    check(
      afterPress.order.join(' ') === browse.order.join(' '),
      '原地按一下没有把次序弄乱（按下与抬起落在同一处 → 不写盘）',
    )
    await shoot('shelf-edit-1440.png', 1440, 1000)

    /* ── ⑪ 真的拖一次 ───────────────────────────────────────────────── */

    console.log('──── 拖一次（⑪） ────')
    if (!guarded) {
      console.log('跳过（见上）')
    } else {
      const ids = (await probe()).order
      const [a, b] = [ids[0] ?? '', ids[1] ?? '']
      const boxA = await rectOf(`li[data-book-id="${a}"] .shelf__cover`)
      const boxB = await rectOf(`li[data-book-id="${b}"] .shelf__cover`)
      if (boxA && boxB) {
        /**
         * ★ 落点要按**重排之后**的位置算，不能按 B 现在的位置算：
         *   按下那一刻被拖的那一本就 `position: fixed` 脱离布局了，剩下的书**整体左移一格**——
         *   B 会挪到 A 原来的那一格里。所以目标是"A 原来那一格的右侧偏中"：
         *   指针落在 B 的新格子里、且在它中心线右边 → 判定为"插在 B 后面"。
         *   （第一版按 B 原位置 + 0.3 宽 算，落点正好压在**第三本**的新格子里，
         *     于是 A 被插到了第三本后面——次序没坏，是探针瞄错了。第二版修的是瞄法。）
         */
        await dragTo(boxA, boxA.x + boxA.w * 0.8, boxA.cy)
        await sleep(900)
        const dragged = await probe()
        const expected = [ids[1] ?? '', ids[0] ?? '', ...ids.slice(2)]
        check(
          dragged.order.join(' ') === expected.join(' '),
          `拖过一格：${ids.slice(0, 3).join(' ')} → ${dragged.order.slice(0, 3).join(' ')}`,
        )
        // ★ 重载一次：**这一步才是"写进盘里了"**。只看 DOM 变了，证明的是本地状态改了
        await load(1440, 1000)
        const reloaded = await probe()
        check(
          reloaded.order.join(' ') === expected.join(' '),
          `重载之后次序还在：${reloaded.order.slice(0, 3).join(' ')}`,
        )
      } else {
        check(false, '量不到前两本的矩形，拖不了')
      }
    }

    /* ── ⑬ 键盘挪一格（和拖动等价的那条路） ──────────────────────────── */

    console.log('──── 键盘挪一格（⑬） ────')
    if (!guarded) console.log('跳过（见上）')
    else {
      await ensureEditing(true)
      const beforeKey = (await probe()).order
      const mover = beforeKey[0] ?? ''
      const follower = beforeKey[1] ?? ''
      const focused = (await evaluate(
        `(() => { const el = document.querySelector('li[data-book-id="${mover}"] .shelf__book')
         if (!el) return null
         el.focus()
         return document.activeElement === el ? document.activeElement.className : null })()`,
      )) as string | null
      check(focused === 'shelf__book', `编辑模式下那一本聚焦得到：${focused}`)
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'ArrowRight',
        code: 'ArrowRight',
        windowsVirtualKeyCode: 39,
      })
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'ArrowRight',
        code: 'ArrowRight',
        windowsVirtualKeyCode: 39,
      })
      await sleep(900)
      const afterKey = await probe()
      check(
        afterKey.order[0] === follower && afterKey.order[1] === mover,
        `右方向键把它往后挪了一格：${beforeKey.slice(0, 3).join(' ')} → ${afterKey.order.slice(0, 3).join(' ')}`,
      )
      const spoken = String(await evaluate(`document.querySelector('[role="status"]').textContent`))
      check(spoken.includes('移到了第 2 位'), `读屏那一句跟上了（"${spoken}"）`)
      const savedOrder = (await evaluate(
        `fetch('/api/books').then((r) => r.json()).then((d) => d.books.map((b) => b.bookId))`,
      )) as string[]
      check(
        savedOrder[0] === follower && savedOrder[1] === mover,
        `键盘挪完也写进盘了：${savedOrder.slice(0, 3).join(' ')}`,
      )
    }

    /* ── ⑫ 真删一本（只删 probe- 那本） ──────────────────────────────── */

    console.log('──── 删一本（⑫） ────')
    const probeIds = (await probe()).probeIds
    if (!guarded) {
      // ★ 双重守卫（见文件头）：指向用户自己的书架时**一本书都不删**
      console.log('跳过：这个资产根里没有 probe- 开头的书——')
      console.log('      说明探针没跑在 make-probe-library.mts 造的夹子上，删除那一节不执行。')
    } else {
      /**
       * ★ 挑**有封面的那一本**来删，不是随便挑第一本：只有它的图被真的缩过、
       *   `thumbs/<档>/books/<id>/` 里真的有东西。删一本没有封面的（`probe-02` 那种），
       *   "缩略图缓存"那一行报的是 0——凭据没错，但**派生内容那一刀就没被验到**，
       *   而那正是 `child-deletion.ts` 记过的那个真实的漏（"删了卡没删图"）。
       */
      const one = await probe()
      const victim = one.readyIds.find((id) => one.probeIds.includes(id)) ?? one.probeIds[0]!
      await ensureEditing(true)
      check(await clickOn(`li[data-book-id="${victim}"] .shelf__remove`), `点得到《${victim}》的 ✕`)
      await sleep(700)
      const planned = await probe()
      check(planned.hasConfirm, '确认框出来了')
      if (planned.notice) console.log(`   页面自己说的话：${planned.notice}`)
      console.log(`   刚被点过的是：${planned.active}`)
      // ★ 判据是"它有多短"。旧版那张表写着「这本书 11 条 / 缩略图缓存 18 条 / 顺序记录 没有」
      //   ——三个位置名 + 两个"多少条"。一句话版本里这些**一个都不该有**，
      //   所以查的不是"有没有出现某句话"，而是"那几个数在不在"（真做才不同）。
      //   ★ 数 `N 条` 那种数，不是"框里一个数字都没有"：书名自己就带数字
      //     （探针夹子叫「探针样书 01」）——判据写宽一格就会假红
      const text = planned.confirmText ?? ''
      console.log(`   确认框：${JSON.stringify(text)}`)
      check(!/[0-9]+\s*条/.test(text), '确认框里没有"多少条"那种数（旧版是 11 条 / 18 条）')
      check(
        !text.includes('缩略图') && !text.includes('顺序记录') && !text.includes('会失去'),
        '没有逐行清单（旧版那三行位置名一个都不在）',
      )
      check(text.includes(`《${planned.confirmTitle}》`), '它说清问的是哪一本（书名在这句话里）')
      check(
        JSON.stringify(planned.confirmButtons) === JSON.stringify(['算了', '确认删掉']),
        `两颗按钮就是「算了」与「确认删掉」：${JSON.stringify(planned.confirmButtons)}`,
      )

      // ★ 留一张证据图：用户是**拿着一张截图**提这个要求的（旧版那张逐行清单上画了个红叉），
      //   回话时给他新那一张。先滚到框上再拍——`shoot` 会把视口改成 1440×1000，
      //   而确认框在书架下面，不滚的话截到的是书。
      await evaluate(
        `(() => { const el = document.querySelector('.shelf__confirm'); if (el) el.scrollIntoView({ block: 'center' }) })()`,
      )
      await sleep(300)
      await shoot('shelf-confirm-1440.png', 1440, 1000)

      // ★ 「还是算了」那条路（用户点名的那半句）：点了它，框收起来、**书还在架上**。
      //   没有这一条的话，一颗永远删下去的「算了」也能让上面那些判据全绿
      await clickOn('.shelf__cancel')
      await sleep(400)
      const cancelled = await probe()
      check(!cancelled.hasConfirm, '点「算了」框就收了')
      check(cancelled.order.includes(victim), `点「算了」之后《${victim}》还在架上`)
      const afterCancel = (await evaluate(
        `fetch('/api/books').then((r) => r.json()).then((d) => d.books.map((b) => b.bookId))`,
      )) as string[]
      check(afterCancel.includes(victim), '接口里也还在（「算了」一个字节都没删）')

      check(await clickOn(`li[data-book-id="${victim}"] .shelf__remove`), '再点一次 ✕')
      await sleep(400)
      check((await probe()).hasConfirm, '确认框又出来了')
      check(await clickOn('.shelf__danger'), '点得到「确认删掉」')

      // ★★ **等它真的消失**，别等一个固定的毫秒数：`DELETE /api/books/<id>` 这条路由
      //    在这之前从没被问过（`GET` 预演撤掉之后这里就是第一次），冷编译要好几秒——
      //    固定 1500ms 会把"还在编译"读成"没删掉"（2026-10-16 实测就是这一条假红）。
      let after = await probe()
      for (let i = 0; i < 40 && after.order.includes(victim); i += 1) {
        await sleep(500)
        after = await probe()
      }
      if (after.order.includes(victim)) {
        console.log(`   它没走。确认框上那句话：${JSON.stringify(after.confirmText ?? '')}`)
        console.log(`   页面自己说的话：${after.notice ?? '(空)'}`)
      }
      check(!after.order.includes(victim), `《${victim}》从架上没了`)
      check(
        after.order.length === probeIds.length - 1,
        `别的书照旧：${after.order.length} 本（删之前 ${probeIds.length} 本）`,
      )
      check(!after.hasConfirm, '确认框自己收了——删完不留回执（用户："书架底下什么也不要留"）')
      const bodyText = String(await evaluate('document.body.innerText'))
      check(
        !bodyText.includes('已删掉') && !bodyText.includes('删掉《'),
        '页面上找不到"已删掉《…》"那类回执行',
      )
      const listed = (await evaluate(
        `fetch('/api/books').then((r) => r.json()).then((d) => d.books.map((b) => b.bookId))`,
      )) as string[]
      check(!listed.includes(victim), `接口里也没有了（${listed.length} 本）`)
    }

    console.log('──── 375×812 ────')
    await load(375, 812)
    const narrow = (await evaluate(PAGE_PROBE)) as ProbeResult
    check(narrow.overflow === 0, `375 下没有横向溢出（${narrow.overflow}px）`)
    check(
      narrow.bookBottomInRack !== null &&
        Math.abs(narrow.bookBottomInRack - narrow.vars.boardTop) <= 1,
      `窄屏上书的底边仍落在板顶：${narrow.bookBottomInRack} vs ${narrow.vars.boardTop}`,
    )
    await shoot('shelf-375.png', 375, 812)

    console.log('──── 控制台 ────')
    const errs = events
      .filter((e) => e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error')
      .map((e) => e.params?.entry?.text)
    const exceptions = events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map(
        (e) =>
          (e.params?.exceptionDetails?.text ?? '') +
          ' ' +
          (e.params?.exceptionDetails?.exception?.description ?? ''),
      )
    check(errs.length === 0 && exceptions.length === 0, '控制台没有 error / 异常')

    console.log(bad === 0 ? '\n全过' : `\n${bad} 条没过`)
  } finally {
    browser.kill()
    socket.close()
  }
  process.exit(bad === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
