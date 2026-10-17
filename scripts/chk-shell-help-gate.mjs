/**
 * chk-shell-help-gate.mjs —— 量 2026-10-17 那一批前端（工单 07 / 15 那两批之后新加的）
 *
 * 用法（先起一个**自己独占 dist** 的 dev server）：
 *
 * ```bash
 * node scripts/dev-preview.mjs --dist=.next-ui15 --port=3325
 * node scripts/chk-shell-help-gate.mjs http://127.0.0.1:3325
 * ```
 *
 * 量四件事，每一件的判据都**只有真做出来才会不同**：
 *
 * 1. **「收起侧栏」那颗箭头旁边的说明只在鼠标真悬停时出现**（用户 2026-10-17 要的
 *    Gemini 那种）。判据是 CDP 发一次**真鼠标移动**前后的 `visibility` 之差——
 *    不是读 CSS 里有没有 `:hover`（那条读得到，但它不证明它生效）。
 *    ★ 起因：上一版那颗钮上用 `title=`，浏览器自己在旁边画了一个提示框，
 *      和自绘的那个叠在一起，一次出现两个。
 * 2. **「帮助」弹窗的宽度**。上一轮在 app 预览面板里量到 237px（传的是 520），
 *    怀疑是面板隐藏时 transition 冻在起点——这里用真 Chrome、真帧再量一次，
 *    判据是它的宽度是不是 `min(520, 视口 - 边距)`。
 * 3. **弹窗里没有漏出来的 Markdown 星号**。JSX 里的文字是普通文本，
 *    写 `**粗体**` 出来就是两个字面的星号（实测撞过两次），判据是正文里
 *    一个 `**` 都没有。
 * 4. **三处入口在未登录时都拦得住**（创作 / 生成人物 / 生成声音，用户原话）。
 *    判据是"点了之后**还停在原来那一页**" + 弹窗里有那颗带 `?next=` 的 `<a>`。
 *    ★ 只点、不点弹窗里那颗「去登录」——那是一次真导航，会把后面的测量打断。
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

/** 真鼠标移动（不是改 class、也不是 `elementFromPoint`）——`:hover` 只认真事件 */
async function moveMouse(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
}

/**
 * 导航到一页并等它真的 hydrate。
 *
 * ★ 闸门选的是 `AuthProvider` 那一半：未登录时侧栏那一格会渲染成「请登录」，
 *   而**服务端那一份 HTML 里也有这三个字**——所以不能用它当判据。
 *   用 `.shell__link--btn`（「帮助」）在点击后能长出 `.dlg` 这件事当判据更硬：
 *   那只有 React 跑起来才做得到。这里退一步用一个便宜的近似——
 *   轮询 `document.querySelector('.shell__collapse')` 并且试着点一次帮助，
 *   点不出弹窗就再等。
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

/* ── 1. 收起侧栏那颗箭头：悬停前后 ───────────────────────────────────────── */
await goto('/character')

out.箭头 = await evaluate(`(() => {
  const btn = document.querySelector('.shell__collapse')
  if (!btn) return { 有: false }
  const tip = btn.querySelector('.shell__tip')
  const r = btn.getBoundingClientRect()
  const shell = document.querySelector('.shell')
  const side = document.querySelector('.shell__side')
  return {
    有: true,
    有提示元素: !!tip,
    提示文字: tip?.textContent ?? null,
    // ★ title 属性有没有：上一版那颗钮上挂着 title，浏览器自己画一个提示框，
    //   与自绘的那个叠在一起（一次出现两个）。判据是 null
    title属性: btn.getAttribute('title'),
    ariaLabel: btn.getAttribute('aria-label'),
    中心: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)],
    箭头svg: !!btn.querySelector('.shell__collapse-arrow'),
    // ★ 那颗钮要在**侧栏的右上角**（用户原话）：比较它的顶边与侧栏内容区的顶边
    到侧栏顶: side ? Math.round(r.top - side.getBoundingClientRect().top) : null,
    侧栏右缘差: side ? Math.round(side.getBoundingClientRect().right - r.right) : null,
    shell展开: shell ? Math.round(shell.getBoundingClientRect().width) : null,
    未悬停_visibility: tip ? getComputedStyle(tip).visibility : null,
    未悬停_opacity: tip ? getComputedStyle(tip).opacity : null,
  }
})()`)

// 真鼠标移到那颗箭头上
const center = out.箭头?.中心
if (center) {
  await moveMouse(center[0] - 200, center[1] + 200)
  await sleep(250)
  const before = await evaluate(
    `(() => { const t = document.querySelector('.shell__tip'); return t ? {v: getComputedStyle(t).visibility, o: getComputedStyle(t).opacity} : null })()`,
  )
  await moveMouse(center[0], center[1])
  await sleep(700)
  const after = await evaluate(
    `(() => { const t = document.querySelector('.shell__tip'); return t ? {v: getComputedStyle(t).visibility, o: getComputedStyle(t).opacity} : null })()`,
  )
  out.悬停 = {
    悬停前: before,
    悬停后: after,
    变了: JSON.stringify(before) !== JSON.stringify(after),
  }
}

/* ── 2/3. 「帮助」弹窗：宽度 + 有没有漏出来的星号 ─────────────────────────── */
await evaluate(`document.querySelector('.shell__link--btn')?.click()`)
let opened = false
for (let i = 0; i < 15 && !opened; i += 1) {
  await sleep(400)
  opened = await evaluate(`!!document.querySelector('.dlg')`)
}
out.帮助弹窗 = opened
  ? await evaluate(`(() => {
      const dlg = document.querySelector('.dlg')
      const r = dlg.getBoundingClientRect()
      const cs = getComputedStyle(dlg)
      const text = dlg.textContent
      return {
        标题: dlg.querySelector('.dlg__title')?.textContent ?? null,
        小节: [...dlg.querySelectorAll('.help__q')].map((q) => q.textContent),
        // ★ 判据：一个 ** 都不许有（JSX 里的星号是两个字面字符）
        星号数: (text.match(/[*]{2}/g) ?? []).length,
        强调tag: [...dlg.querySelectorAll('b')].map((b) => b.textContent),
        宽: Math.round(r.width),
        高: Math.round(r.height),
        maxWidth: cs.maxWidth,
        视口宽: window.innerWidth,
        邮箱: dlg.querySelector('.help__mail')?.getAttribute('href') ?? null,
        按钮: [...dlg.querySelectorAll('.dlg__acts button')].map((b) => b.textContent),
      }
    })()`)
  : { 没打开: true }

// 关掉它（点遮罩或那颗钮都行；这里点 footer 那颗，它只 setOpen(false)）
await evaluate(`document.querySelector('.dlg__acts button')?.click()`)
await sleep(400)

/* ── 4. 三处入口：未登录时都拦得住 ──────────────────────────────────────── */
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
