/**
 * chk-admin-access.mjs —— 量 2026-10-18 那一次改动在**管理页上真正长什么样**
 *
 * 一件事：**那一排四个开关收成了一格「权限」**，而它旁边的「作品」那一列照旧
 * （用户的原话：「还是可以看到用户创作了几本，有几个人物，后面的选项就变为是否有权限」）。
 *
 * 用法（先起一条**指向受测后端**的 dev server）：
 *
 *   node scripts/chk-admin-access.mjs http://127.0.0.1:3338 <session-cookie> [截图路径]
 *
 * ★ 会话 cookie 由调用方传进来，而不是这里去登录：登录要打真接口、还要处理
 *   验证码/口令两条路，而"管理页长什么样"与"怎么登进去"是两件事。
 *   传进来的那一张是**真的**（curl 拿到的那张），所以这一遍走的仍然是真鉴权。
 *
 * ★ 判据都是**只有真做出来才会不同**的量：
 *   · 表头里有几列"权限"（改了就该是 1，回退成四个开关就该是 4）；
 *   · 每一行那一格的 `data-on`（0/1 与 `allowed` 一一对应）；
 *   · 「作品」那一列那一句（0 本也是**照实写出来的**一句话，不是空白）；
 *   · 页面报错一条都没有（收列最容易留的是"读了已经不存在的字段"）。
 *
 * ★ 它**只读**：不点开关、不改库、不落盘（除了那张截图）。
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const base = args.find((item) => item.startsWith('http')) ?? 'http://127.0.0.1:3338'
const cookie = args
  .filter((item) => !item.startsWith('--'))
  .find((item) => !item.startsWith('http'))
if (!cookie) throw new Error('要传一个 xzj_session 的值（第二个位置参数）')

const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const PORT = Number(flag('port', '9351'))
const SHOT = flag('shot', resolve(process.cwd(), '.out', 'access-verify', 'admin.png'))
const PROFILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'chrome-access')

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
await send('Network.enable')
const host = new URL(base).hostname
await send('Network.setCookie', {
  name: 'xzj_session',
  value: cookie,
  domain: host,
  path: '/',
  httpOnly: true,
})

async function goto(path) {
  await send('Page.navigate', { url: `${base}${path}` })
  await sleep(1500)
  for (let i = 0; i < 25; i += 1) {
    const ok = await evaluate(`!!document.querySelector('.adm__table')`)
    if (ok) return true
    await sleep(600)
  }
  return false
}

const out = {}
out.打开 = await goto('/admin')

out.表 = await evaluate(`(() => {
  const table = document.querySelector('.adm__table')
  if (!table) return { 有: false, 正文: document.body.textContent.trim().slice(0, 200) }
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim())
  const rows = [...table.querySelectorAll('tbody tr')].map((tr) => {
    const cells = [...tr.children].map((td) => td.textContent.trim())
    const sw = tr.querySelector('.adm__switch')
    return {
      账号: cells[0],
      昵称: cells[1],
      作品: cells[4],
      权限开关: sw ? { 位置: sw.getAttribute('data-on'), aria: sw.getAttribute('aria-checked'), 标签: sw.getAttribute('aria-label'), 禁用: sw.disabled } : null,
      账号列动作: cells[cells.length - 1],
    }
  })
  return {
    有: true,
    表头: heads,
    权限列数: heads.filter((h) => h.includes('权限')).length,
    行: rows,
  }
})()`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) {
  writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'))
  out.截图 = SHOT
}

out.页面报错 = errors.slice(0, 8)

console.log(JSON.stringify(out, null, 2))

ws.close()
chrome.kill()
