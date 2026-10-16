/**
 * chk-rerun-dialog.mjs —— 借一次真 Chrome（CDP）看**重画弹窗渲染之后**的几何
 *
 * 用法（先起一个 dev server，并且那一本要么在跑、要么是恢复出来的草稿）：
 *
 * ```bash
 * node scripts/chk-rerun-dialog.mjs http://127.0.0.1:3321/create?book=<bookId> .out/redraw.png
 * node scripts/chk-rerun-dialog.mjs <url> --chrome="C:/path/to/chrome.exe" --port=9337
 * ```
 *
 * 它是 `.scratch/solo-run-flow/issues/08-rerun-dialogs.md` 的验收脚本，量两件事：
 *
 * 1. **图与"提示词那一块"的水平中线之差**（`中点差`）。用户说过"图片有点偏上了"，
 *    修法是 `align-items: center`。★ 判据选这个量是因为它**只有真渲染出来才存在**：
 *    顶对齐时它是一个正数，居中之后是 0；读源码读不到，算出来也只是"应该"。
 * 2. **补充框下面那句说明还在不在**（`提示句还在`）。用户把它划掉了，
 *    判据是 `null`（这一句**没有**），不是"变短了"。
 *
 * ★ **为什么不走 app 预览面板**：那边面板一隐藏，rAF 与 transition 一起冻结，
 *   量到的计算值会落在过渡起点上，看着像样式没生效。要真几何就得真帧。
 * ★ 它**只读**：点一下"重画"把弹窗叫出来，不点弹窗里的任何按钮——
 *   那两个按钮一个要花钱（重画这一页）、一个要落盘。
 *
 * ★ 第一次跑可能会"等了 14 秒仍未出现 .dlg"：dev 下 `/api/books/<id>/pages`
 *   这一条路由是**按需编译**的，冷启动那一次超过轮询窗口。等第二次跑（或先 curl
 *   一下那条接口）就正常了——这不是代码坏了，别照着它改超时以外的任何东西。
 *
 * 这台机器上 Chrome 的位置写死在 `--chrome=` 的缺省值里（Windows 默认安装路径），
 * 换个平台就传参数进来。
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

const url = positional[0]
const OUT = positional[1] ?? null
if (!url) {
  process.stderr.write(
    '用法：node scripts/chk-rerun-dialog.mjs <url> [截图路径] [--chrome=…] [--port=…]\n',
  )
  process.exit(2)
}

const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const PORT = Number(flag('port', '9337'))
/** Chrome 的临时 profile 落在 `.out/` 下（`.gitignore` 已经忽略整个 `.out/`） */
const PROFILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'chrome-chk')

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
    errors.push(
      msg.params.exceptionDetails.text +
        ' ' +
        (msg.params.exceptionDetails.exception?.description ?? ''),
    )
  }
})

await send('Page.enable')
await send('Page.navigate', { url })

// 等重放长出重画按钮（?book= 恢复是客户端重放，不是 SSR）
let ready = false
for (let i = 0; i < 30 && !ready; i += 1) {
  await sleep(1000)
  ready = await evaluate(
    `[...document.querySelectorAll('.dk__act')].some((b) => b.textContent.includes('重画') && !b.disabled)`,
  )
}
if (!ready) {
  const snap = await evaluate(`document.body.innerText.slice(0, 400)`)
  console.log('重画按钮一直没解锁——运行视图没到 ready。退出。')
  console.log('页面现状：', snap)
  ws.close()
  chrome.kill()
  process.exit(1)
}

// 点第 1 页的重画，把弹窗叫出来
const before = await evaluate(`(() => {
  const acts = [...document.querySelectorAll('.dk__act')]
  return {
    动作总数: acts.length,
    重画可用: acts.filter((b) => b.textContent.includes('重画') && !b.disabled).length,
    重配可用: acts.filter((b) => b.textContent.includes('重配') && !b.disabled).length,
    主按钮: document.querySelector('.gr__primary')?.textContent ?? null,
    主按钮禁用: document.querySelector('.gr__primary')?.disabled ?? null,
  }
})()`)
console.log('点之前：', JSON.stringify(before))
await evaluate(
  `[...document.querySelectorAll('.dk__act')].find((b) => b.textContent.includes('重画'))?.click()`,
)
// ★ 弹窗要先等 `/api/books/<id>/pages` 回来才渲染（`openEditor` 里拉的是真数据），
//   20 页的书一次预览地址要生成，900ms 不够——这里轮询
let opened = false
for (let i = 0; i < 20 && !opened; i += 1) {
  await sleep(700)
  opened = await evaluate(`!!document.querySelector('.dlg')`)
}
if (!opened) console.log('等了 14 秒仍未出现 .dlg')

const pos = await evaluate(`(() => {
  const panel = document.querySelector('.dlg')
  if (!panel) return { open: false }
  const title = document.querySelector('.dlg__title')?.textContent ?? ''
  const grid = panel.querySelector('.rdg__grid')
  if (!grid) return { open: true, title, grid: false }
  const art = grid.querySelector('.rdg__art')
  const what = grid.querySelector('.rdg__what')
  const hint = panel.querySelector('.rdg__supplement .dlg__hint')
  const a = art?.getBoundingClientRect() ?? null
  const w = what?.getBoundingClientRect() ?? null
  const cs = getComputedStyle(grid)
  return {
    open: true,
    title,
    grid: true,
    alignItems: cs.alignItems,
    art: a ? { top: Math.round(a.top), bottom: Math.round(a.bottom), h: Math.round(a.height), w: Math.round(a.width), natural: art.naturalWidth + 'x' + art.naturalHeight } : null,
    what: w ? { top: Math.round(w.top), bottom: Math.round(w.bottom), h: Math.round(w.height) } : null,
    // ★ 判据：两者中点之差——居中对齐之后它应当≈0（顶对齐时是正的一大截）
    中点差: a && w ? Math.round((a.top + a.bottom) / 2 - (w.top + w.bottom) / 2) : null,
    提示句还在: hint ? hint.textContent.slice(0, 30) : null,
    textarea: !!panel.querySelector('.rdg__supplement textarea'),
    按钮: [...panel.querySelectorAll('.dlg__acts button')].map((b) => b.textContent),
  }
})()`)
console.log('重画弹窗：', JSON.stringify(pos, null, 2))

if (OUT) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
  console.log('截图：', OUT)
}

console.log('页面里的错误：', errors.length === 0 ? '没有 ✓' : errors)
ws.close()
chrome.kill()
process.exit(0)
