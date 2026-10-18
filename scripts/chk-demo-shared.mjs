/**
 * chk-demo-shared.mjs —— 演示那本**共读版**：断网也能从封面走到封底（工单 08 §二）
 *
 * ```bash
 * node scripts/chk-demo-shared.mjs [http://127.0.0.1:3311] [--book=<演示书的书号>]
 * ```
 *
 * 它验的是 **ADR-0003 那条断网路径**在共读版这一档上成不成立。判据四条，
 * 每条都只有真做才会不同：
 *
 * | 判据                              | 什么情况下它会红                                          |
 * | --------------------------------- | --------------------------------------------------------- |
 * | **一个外部主机都没问**            | 挂了 CDN 字体、外链音频、或者把出图地址写成了绝对 URL      |
 * | 从「封面」走到「封底」，一屏不跳  | 演示书缺图 / 缺音 / 岔口画不出来（走到一半就断了）          |
 * | 岔口上两颗按钮有字、选完继续走     | 选择点只画了个壳（故事没带过来 / 形态认错）                |
 * | 全程 `/api/` 只有 GET              | 阅读时又去生成东西了（"预生成"不是真的）                   |
 *
 * ★ **不登录**：演示书走 `public/demo/books/` 那条静态路径，评审点开它的时候
 *   手上没有票。所以这个脚本也**不带任何 cookie**——带上就跑不到那条路上了。
 * ★ 走完这一趟之后底栏报过的页码要**正好是 1..路长**：跳过一页或者重复一页，
 *   都会在这里红（那是"阅读顺序 = 那条路"这条判据的用户可见版本）。
 * ★ 无头 Chrome + 直连 CDP，理由与另外两个 chk-* 相同：预览面板把 rAF 冻住，
 *   翻页补间一步都不走、选择点永远不浮出来。
 */
import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const positional = args.filter((item) => !item.startsWith('--'))
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BASE = (positional[0] ?? 'http://127.0.0.1:3311').replace(/\/+$/, '')
const BOOK = flag('book', 'xiaoyu-r1-6ca00a33b4d7')
const PORT = Number(flag('port', '9350'))
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE = resolve(ROOT, '.out', 'chrome-demo-shared')
const DEMO = resolve(ROOT, 'public', 'demo', 'books', BOOK)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
}

/** 选的是哪一支（默认 b）：`a` 是第一个选项那一支 */
const BRANCH = flag('branch', 'b')

async function main() {
  const book = JSON.parse(await readFile(join(DEMO, 'book.json'), 'utf8'))
  const choice = book.tree.nodes.find((node) => node.choice)
  const head = BRANCH === 'a' ? choice?.next[0] : choice?.next[1]
  /** 这一条路（从根走到叶）的节点序列：从选择点接着走选中的那一支 */
  const path = []
  const byId = new Map(book.tree.nodes.map((node) => [node.nodeId, node]))
  let current = byId.get(book.tree.rootId)
  while (current) {
    path.push(current)
    if (current.choice) current = byId.get(head)
    else current = current.next.length > 0 ? byId.get(current.next[0]) : undefined
  }
  console.log(`演示书  ${BOOK}（${book.tree.nodes.length} 个节点 · 这条走 ${path.length} 页）\n`)

  await rm(PROFILE, { recursive: true, force: true })
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${PROFILE}`,
    '--window-size=1440,900',
    'about:blank',
  ])

  try {
    const list = await waitJson(`http://127.0.0.1:${PORT}/json`)
    const page = list.find((item) => item.type === 'page')
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r) => (socket.onopen = r))
    const send = connect(socket)

    const assets = []
    const apiCalls = []
    const exceptions = []
    const foreign = []
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method === 'Network.requestWillBeSent') {
        const { url, method } = msg.params.request
        // ★ 演示书的字节走**静态那一条路**（`/demo/books/<书号>/page-1-a1.webp`），
        //   不是运行期那本书的 `/api/assets/...`——两条都收，判据才落在
        //   "这一支的页有没有被取过"上（第一次写只收了 `/api/assets/`，
        //   于是量出来是"0 个资产"，看着像一页都没画）
        const marker = `/demo/books/${BOOK}/`
        if (url.includes('/api/assets/')) assets.push(decodeURIComponent(url))
        else if (url.includes(marker))
          assets.push(decodeURIComponent(url.slice(url.indexOf(marker))))
        if (url.includes('/api/')) apiCalls.push(`${method} ${url.slice(url.indexOf('/api/'))}`)
        if (!url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) {
          foreign.push(url.slice(0, 120))
        }
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        exceptions.push(msg.params.exceptionDetails.text)
      }
    })
    for (const method of ['Network.enable', 'Runtime.enable', 'Page.enable']) await send(method)

    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      return res.result?.result?.value
    }
    const readout = () =>
      evaluate(
        `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() ?? null`,
      )
    const choiceOn = () => evaluate(`!!document.querySelector('.book-choice[data-on]')`)

    async function clickAt(selector) {
      const box = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      })()`)
      if (!box) return false
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', {
          type,
          x: box.x,
          y: box.y,
          button: 'left',
          clickCount: 1,
        })
      }
      return true
    }
    async function waitFor(expression, ms = 15000, step = 150) {
      const until = Date.now() + ms
      while (Date.now() < until) {
        if (await evaluate(expression)) return true
        await sleep(step)
      }
      return false
    }

    /* ── 从头走到尾（★ 不带任何 cookie：演示书对访客也读得开） ─────────────── */

    await send('Page.navigate', { url: `${BASE}/reader/${BOOK}` })
    check(
      '演示书在**没有登录**的情况下打得开（评审点开它时手上没有票）',
      await waitFor(
        `document.readyState === 'complete' && !!document.querySelector('.reader__readout')`,
      ),
    )
    check('底栏从「封面」起', (await readout()) === '封面', `现在：${await readout()}`)

    /**
     * 一路点 `›`，把底栏报过的每一屏记下来。
     * ★ 每点一下都**等它真的换了一屏**再记，而不是"点完 sleep 一下再读"：
     *   补间没走完就点第二下会跳过一屏，而那正是这一条判据要抓的东西
     *   （实测第一次写就是这么漏掉第 2 屏——那是岔口那一屏，它当然也算一屏）。
     */
    const seen = []
    for (let i = 0; i < path.length + 4; i += 1) {
      const now = await readout()
      if (now) seen.push(now)
      if (now === '封底') break
      await clickAt('[aria-label="下一页"]')
      await waitFor(
        `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() !== ${JSON.stringify(now)}`,
        8000,
      )
      if (await choiceOn()) {
        const labels = await evaluate(
          `[...document.querySelectorAll('.book-choice__label')].map((el) => el.textContent.trim())`,
        )
        check(
          '★ 岔口停在画面上：两颗按钮都有字（故事真的带到这一屏了）',
          Array.isArray(labels) && labels.length === 2 && labels.every((one) => one),
          JSON.stringify(labels),
        )
        // ★ 可点高度 ≥44px：那是**产品判断**不是合规下限（`docs/tech-selection.md` §4.2
        //   的一行：4 岁孩子的手指能稳定点中）。这里是它的机械版——量的是真几何。
        const heights = await evaluate(
          `[...document.querySelectorAll('.book-choice__btn')].map((el) => Math.round(el.getBoundingClientRect().height))`,
        )
        check(
          '★ 两颗按钮的可点高度都 ≥44px（4 岁孩子的手指那一条）',
          Array.isArray(heights) && heights.length === 2 && heights.every((h) => h >= 44),
          `实测 ${JSON.stringify(heights)} px`,
        )
        const before = await readout()
        await evaluate(`document.querySelectorAll('.book-choice__btn')[1].click()`)
        check(
          `选 ${BRANCH} 之后能接着往下读`,
          await waitFor(
            `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() !== ${JSON.stringify(before)}`,
          ),
        )
      }
    }

    check(
      '★ 从封面走到封底，一屏都没卡住',
      (await readout()) === '封底',
      `底栏现在：${await readout()}（走完 ${seen.length} 屏）`,
    )
    const pagesSeen = seen.filter((one) => /^第 \d+ 页$/.test(one))
    const numbers = pagesSeen.map((one) => Number(one.replace(/\D/g, '')))
    check(
      `★ 走过的那几屏正好是 1..${path.length}（没跳过、也没重复）`,
      numbers.length === path.length && numbers.every((n, i) => n === i + 1),
      pagesSeen.join(' → ') || '（一页都没报）',
    )

    const branchPages = path.slice(path.indexOf(choice) + 1).map((node) => node.pageNo)
    const asked = new Set(assets)
    check(
      '★ 走的那一支的图都取到了（封底的纸也算"到了结尾"）',
      branchPages.every((pageNo) => [...asked].some((url) => url.includes(`page-${pageNo}-`))),
      `这一支的第 ${branchPages.join('/')} 页；共取过 ${asked.size} 个资产`,
    )
    check(
      '★★ 从头到尾只请求本机：一本书的字节全在盘上（断网也读得了）',
      foreign.length === 0,
      foreign.length ? `问到过外面：${[...new Set(foreign)].join(' | ')}` : '外部主机 0 次',
    )
    const writes = apiCalls.filter((call) => !call.startsWith('GET '))
    check(
      '★ 全程 `/api/` 只有 GET（读一本书不生成任何东西）',
      writes.length === 0,
      `${apiCalls.length} 条，非 GET ${writes.length} 条`,
    )
    check('没有 JS 异常', exceptions.length === 0, exceptions.join('｜'))
  } finally {
    chrome.kill()
  }
}

/* ── CDP 小工具 ───────────────────────────────────────────────────────────── */

function connect(socket) {
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  return (method, params = {}) =>
    new Promise((resolve) => {
      id += 1
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
}

async function waitJson(url) {
  for (let i = 0; i < 60; i += 1) {
    try {
      return await (await fetch(url)).json()
    } catch {
      await sleep(250)
    }
  }
  throw new Error(`连不上 ${url}`)
}

try {
  await main()
} catch (err) {
  check('跑完（没有抛出去的异常）', false, err instanceof Error ? err.message : String(err))
}

const failed = results.filter((one) => !one.ok)
console.log(`\n${results.length - failed.length}/${results.length} 条通过`)
if (failed.length > 0) console.log(`红的是：${failed.map((one) => one.label).join('；')}`)
process.exit(failed.length === 0 ? 0 : 1)
