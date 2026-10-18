/**
 * chk-shell-gate.mjs —— 侧栏那两件事 + 「未登录就进不去」那三处入口
 *
 * 用法（先起一个**自己独占 dist** 的 dev server）：
 *
 * ```bash
 * node scripts/dev-preview.mjs --dist=.next-ui15 --port=3325
 * node scripts/chk-shell-gate.mjs http://127.0.0.1:3325
 * ```
 *
 * 量两件事，每一件的判据都**只有真做出来才会不同**：
 *
 * 1. **「收起侧栏」那一格长得对不对**：箭头在框里、字就在旁边、`title` 也在
 *    （收起那个方向压成两个字「展开」，"侧栏"两个字只有 `title` 里有），
 *    以及它**在底栏的最后一格、贴着侧栏底**（用户 2026-10-17 定的位置）。
 * 2. **三处入口在未登录时都拦得住**（创作 / 生成人物 / 生成声音，用户原话）。
 *    判据是"点了之后**还停在原来那一页**" + 弹窗里有那颗带 `?next=` 的 `<a>`。
 *    ★ 只点、不点弹窗里那颗「去登录」——那是一次真导航，会把后面的测量打断。
 *    ★ 这一条是**「没登录的人不能创作」这句话唯一的实测**（2026-10-18 之后更是
 *      唯一的入口检查：那三处按下去要过 `SignInGate`，而服务端那一侧是 401）。
 *
 * ★ 2026-10-18 删掉的三项，三项都是**没有对象了**：
 *   · 量「帮助」弹窗宽度的那一项，与量"弹窗里有没有漏出来的 Markdown 星号"的那一项——
 *     那个弹窗随「权限收成一位」一起拆了（没有人需要申请权限之后，它剩下的三条说明
 *     也被用户要求一并删掉）。
 *   · 量"悬停才出现的那颗标签（`.shell__tip`）"的那一项。★ 这一项**不是**这次删的：
 *     它的对象在 2026-10-17（`90501be`）就没了——用户那天改口「还是改回一开始那样吧」，
 *     收起钮回到一整行带文字，旁边那颗悬停标签就此撤掉（理由写在 `AppShell.tsx` 里：
 *     字就在旁边，留着会变成第二个 tooltip）。它在之后那些次运行里一直读成
 *     `有提示元素: false / 变了: false`，也就是一直在**无声地失效**——所以这一轮顺手
 *     换成了上面第 1 条：同一格、问的是它现在真的有的那几样。
 *   ★ 文件也顺手从 `chk-shell-help-gate.mjs` 改名成现在这个：名字里那半句
 *     （help）已经没有对应物，而一个叫 help-gate 的脚本量的是登录闸，
 *     下一个人会照着名字去找一个不存在的弹窗。
 *
 * ★ 它**只读**：不登录、不落盘、不改库。
 * ★ 用独立的 dist（`.next-ui15`）是自己起的 server，不与别人的会话共用产物目录——
 *   共用会互相踩掉 chunk，症状是 `__webpack_modules__[moduleId] is not a function`
 *   （2026-10-17 实测：和另一条会话同用 `.next-session` 时撞上）。
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

const base = positional[0] ?? 'http://127.0.0.1:3325'
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const PORT = Number(flag('port', '9341'))
const PROFILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'chrome-ui15')

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
  if (res.result?.exceptionDetails) return { error: res.result.exceptionDetails.text }
  return res.result?.result?.value
}

const errors = []
await send('Log.enable')
await send('Runtime.enable')
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(msg.params.entry.text)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.text)
  }
})

await send('Page.enable')

/**
 * 导航到一页并等它真的 hydrate。
 *
 * ★ 闸门选的是 `AuthProvider` 那一半：未登录时侧栏那一格会渲染成「请登录」，
 *   而**服务端那一份 HTML 里也有这三个字**——所以不能用它当判据。
 *   过去这里靠"点一下「帮助」看它长不长出 `.dlg`"当判据（那只有 React 跑起来才做得到），
 *   2026-10-18 那一格拆掉之后换了回来：轮询侧栏那颗收起钮。
 *   ★ 这是一个**弱一些**的闸门（那颗钮在服务端 HTML 里也在），所以下面每一处
 *   "点了之后应该发生什么"的判断都仍然按真事件走，并且等它出现为止。
 */
async function goto(path) {
  await send('Page.navigate', { url: `${base}${path}` })
  await sleep(1500)
  for (let i = 0; i < 25; i += 1) {
    const ok = await evaluate(`!!document.querySelector('.shell__collapse')`)
    if (ok) return true
    await sleep(600)
  }
  return false
}

const out = {}

/* ── 1. 收起侧栏那一格：形状、文字、以及它在底部那一列的位置 ─────────────── */
await goto('/character')

out.箭头 = await evaluate(`(() => {
  const btn = document.querySelector('.shell__collapse')
  if (!btn) return { 有: false }
  const r = btn.getBoundingClientRect()
  const shell = document.querySelector('.shell')
  const side = document.querySelector('.shell__side')
  const foot = document.querySelector('.shell__foot')
  return {
    有: true,
    标签文字: btn.querySelector('.shell__link-label')?.textContent ?? null,
    // ★ title 留着，而且它不是多余的一遍：收起那个方向压成两个字（「展开」），
    //   "侧栏"两个字只有 title 里有（AppShell 那段注释）。判据是它**在**
     title属性: btn.getAttribute('title'),
    ariaExpanded: btn.getAttribute('aria-expanded'),
    中心: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)],
    箭头svg: !!btn.querySelector('.shell__collapse-arrow'),
    到侧栏底: side ? Math.round(side.getBoundingClientRect().bottom - r.bottom) : null,
    是底栏最后一格: foot ? foot.lastElementChild === btn : null,
    shell展开: shell ? Math.round(shell.getBoundingClientRect().width) : null,
  }
})()`)

/* ── 2. 三处入口：未登录时都拦得住 ──────────────────────────────────────── */
const entries = [
  { 名字: '生成人物', 路径: '/character', 选择器: '.cw__new' },
  { 名字: '生成声音', 路径: '/voice', 选择器: '.vc__new' },
  { 名字: '开始创作', 路径: '/home', 选择器: '.cl__go', 填一段话: '.cl__input' },
]

out.入口 = []
for (const entry of entries) {
  const row = { 名字: entry.名字, 路径: entry.路径 }
  await goto(entry.路径)
  row.停在 = await evaluate(`location.pathname`)
  /*
   * ★ 「开始创作」那颗钮是 `disabled={!ready}`，而 `ready` 是**那句话说没说**
   *   （`wish.trim() !== ''`）。所以要让这一处真的可点，得先把话说上。
   * ★ 用**原生的 value setter + 派发一个 input 事件**，不是直接赋 `el.value`：
   *   React 在受控输入上记着自己上一次渲染的那个值，直接赋值它收不到通知，
   *   state 不会变，钮会一直是灰的（2026-10-17 实测撞上）。
   *   这与 app 预览面板里那条同一个坑，只是那里有 `preview_fill` 代劳。
   */
  if (entry.填一段话) {
    row.填字 = await evaluate(`(() => {
      const el = document.querySelector('${entry.填一段话}')
      if (!el) return { 找到: false }
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
      setter.call(el, '朵朵抱着月亮，轻轻走过屋顶')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return { 找到: true, 值: el.value }
    })()`)
    await sleep(600)
  }
  // ★ 找不到那颗钮时把这一页上所有的钮报出来——"选择器写错了"与
  //   "那一颗没渲染"是两件事，不报出来的话看不出来是哪一件
  const exists = await evaluate(`!!document.querySelector('${entry.选择器}')`)
  if (!exists) {
    row.没找到 = await evaluate(
      `[...document.querySelectorAll('button')].map((b) => ({cls: b.className, text: b.textContent.trim().slice(0, 14)}))`,
    )
    out.入口.push(row)
    continue
  }
  // 真点一下（CDP 的鼠标按下/抬起，不是 `element.click()`）
  const box = await evaluate(`(() => {
    const b = document.querySelector('${entry.选择器}')
    const r = b.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    // ★ 遮挡要自己查：element.click() **绕过命中测试**，被整层盖住的按钮照样"通过"。
    //   这里用 elementsFromPoint 取点栈顶那个元素，它得是这颗钮（或它的孩子）
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const top = document.elementsFromPoint(cx, cy)[0]
    return { x: cx, y: cy, 可点: b === top || b.contains(top), 栈顶: top?.className ?? null, disabled: b.disabled }
  })()`)
  row.几何 = box
  if (!box || !box.可点 || box.disabled) {
    out.入口.push(row)
    continue
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: box.x,
    y: box.y,
    button: 'left',
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: box.x,
    y: box.y,
    button: 'left',
    clickCount: 1,
  })
  let appeared = false
  for (let i = 0; i < 15 && !appeared; i += 1) {
    await sleep(400)
    appeared = await evaluate(`!!document.querySelector('.dlg')`)
  }
  row.弹窗 = appeared
  if (appeared) {
    row.详情 = await evaluate(`(() => {
      const dlg = document.querySelector('.dlg')
      const a = dlg.querySelector('.dlg__go')
      return {
        标题: dlg.querySelector('.dlg__title')?.textContent ?? null,
        正文: dlg.querySelector('.sg__text')?.textContent?.trim().slice(0, 40) ?? null,
        去登录文字: a?.textContent?.trim() ?? null,
        去登录href: a?.getAttribute('href') ?? null,
        是a标签: a?.tagName ?? null,
      }
    })()`)
  }
  // ★ 判据：点了之后**还停在原来那一页**（弹窗拦住了那次导航）
  row.还在原页 = (await evaluate(`location.pathname`)) === entry.路径
  if (appeared) {
    await evaluate(`document.querySelector('.dlg__acts button')?.click()`)
    await sleep(300)
  }
  out.入口.push(row)
}

out.页面报错 = errors.slice(0, 8)

console.log(JSON.stringify(out, null, 2))

ws.close()
chrome.kill()
