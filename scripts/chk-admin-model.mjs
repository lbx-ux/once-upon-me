/**
 * chk-admin-model.mjs —— 量「管理页的模型配置」那一屏**长成了什么样、那一按真做了什么**
 * （2026-10-18）
 *
 * 四件事，判据都取**只有真做才会不同**的量：
 *
 * 1. **形状**：四张卡各有一条副标题、一个「厂商 / 网关」下拉、
 *    一颗挨着「模型名」的「拉取模型列表」、一颗「测试连通」。
 *    ★ 判据是 DOM 里的**结构与位置**（那颗拉列表钮与模型名输入框是不是同一行、
 *      下拉里有没有那几条预设），不是"页面上有这几个字"。
 * 2. **预设只填地址**：选中一家之后，接口地址那一格**变成**那家的地址，
 *    而**模型名那一格一个字都没动**（这是这一轮与用户定死的一条）。
 * 3. **候选下拉里是不是列全的**（2026-10-18 补的，用户报的那一条）：
 *    那一格原来挂的是 `datalist`，而 Chrome 拿输入框里现有的字去筛它——
 *    这一格平时是填好的，26 个候选里只有它自己匹配得上，于是"拉到 26 个"与
 *    "点开只剩一个"同时成立。判据取**那颗 `<select>` 的 options 条数**
 *    （还是 datalist 的话这一项当场是 null），以及"挑一个之后值真进了文本框"。
 * 4. **测试连通**（`--live=1` 才做）：四种能力各真点一次，把结果读回来——
 *    文字看它回的话、图像看那张图是不是真回来了（`<img>` 的 data URL 长度）、
 *    视觉看读出来的锚点、语音看 `<audio>` 有没有 src。
 *    ★ 那一按是**真鼠标点**（`Input.dispatchMouseEvent` + 先 `scrollIntoView`），
 *      并记下"这点坐标最上面那一个是不是它"。
 *    ★ **默认不跑**：图像那一按一口价 0.2 元/张，不该被一次误触花掉，
 *      与 `w1-image-bakeoff.mts` 那条「不带 --yes 只打印预算」是同一条纪律。
 *
 * 用法（先起一条**独占 dist、指向受测后端**的 dev server，再给一张真登录拿到的票）：
 *
 * ```bash
 * node scripts/dev-preview.mjs --dist=.next-x --port=33xx     # BACKEND_URL 指向受测后端
 * node scripts/chk-admin-model.mjs http://127.0.0.1:33xx <xzj_session> [--live=1] [--only=text,image]
 * ```
 *
 * ★ 票由调用方传进来（与 `chk-admin-access.mjs` 同一条理由：登录要打真接口、
 *   还要处理验证码那两条路，而"这一屏长什么样"与"怎么登进去"是两件事）。
 *   传进来的那一张是**真的**，所以这一遍走的仍然真鉴权。
 * ★ 它**只写 DOM**：不点保存、不点恢复默认——磁盘上那份模型配置一个字都不动。
 *   唯一花钱的是 `--live=1` 的那四按。
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const base = args.find((item) => item.startsWith('http')) ?? 'http://127.0.0.1:3353'
const cookie = args
  .filter((item) => !item.startsWith('--'))
  .find((item) => !item.startsWith('http'))
if (!cookie) throw new Error('要传一个 xzj_session 的值（第二个位置参数）')

const LIVE = flag('live', '0') === '1'
const ONLY = flag('only', '')
  .split(',')
  .map((item) => item.trim())
  .filter((item) => item !== '')
const CHROME = flag('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const PORT = Number(flag('port', '9353'))
const SHOT = flag('shot', resolve(process.cwd(), '.out', 'model-test', 'admin-model.png'))
/** 视觉那一支用的本地图片：随仓库发布的那张示例卡参考图 */
const PHOTO = flag(
  'photo',
  resolve(process.cwd(), 'public', 'demo', 'cards', 'xiaoman-r1', 'ref.f324801f9e05.jpg'),
)

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${resolve(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'chrome-admtest')}`,
  '--window-size=1440,1400',
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
  if (res.result?.exceptionDetails) return { __error: res.result.exceptionDetails.text }
  return res.result?.result?.value
}

const errors = []
await send('Log.enable')
await send('Runtime.enable')
await send('DOM.enable')
await send('Page.enable')
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(msg.params.entry.text)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.text)
  }
})

await send('Network.enable')
await send('Network.setCookie', {
  name: 'xzj_session',
  value: cookie,
  domain: new URL(base).hostname,
  path: '/',
  httpOnly: true,
})

/**
 * 真鼠标点一下（不是 `element.click()`）：`element.click()` **绕过命中测试**，
 * 被整层盖住的按钮照样"通过"。所以这里同时问一句"这个坐标最上面那一个是不是它"
 * ——那一句才是"这一按真落到按钮上"的判据。
 * 返回 null 表示没找到；`禁用` 为真时不点（点了也白点）。
 */
async function clickAt(selector) {
  const box = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    // ★ 先滚进视口再量：不在视口里的坐标 elementFromPoint 返回 null，
    //   而真鼠标事件也落不到那儿——第一次跑就是这么让**下面两张卡**一起静默落空的
    //   （「点到了」那一项写着 落在它身上: false，比报错更难看出来）
    // ★ 这段注释里不许出现反引号：它整段是模板字符串，一个反引号就把表达式截断了
    //   （截断后的报错指在函数的第一行，看不出真正的原因）
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const top = document.elementFromPoint(x, y)
    return {
      x,
      y,
      w: r.width,
      h: r.height,
      禁用: el.disabled === true,
      落在它身上: !!top && (top === el || el.contains(top)),
      顶上是谁: top ? top.tagName + (top.className ? '.' + String(top.className) : '') : null,
    }
  })()`)
  if (!box || box.w === 0 || box.禁用) return box
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    })
  }
  return box
}

const out = {}

/* ── 打开 /admin，等模型配置那四张卡起来 ───────────────────────────────── */
await send('Page.navigate', { url: `${base}/admin` })
await sleep(1500)
for (let i = 0; i < 25; i += 1) {
  const ready = await evaluate(`document.querySelectorAll('.adm__model').length`)
  if (ready >= 4) break
  await sleep(600)
}

/* ★ 再等**挂载那一次拉取**落定（2026-10-18 补）。
 *   拉的时候那颗按钮的字是「在拉…」、候选下拉还没画出来，于是第一次跑量到的
 *   「候选下拉条数: null」是一个**还没到**的状态，不是坏——报出来会把人骗去查组件。
 *   四张卡各自拉各自的，所以要等到四张都不在拉。 */
for (let i = 0; i < 30; i += 1) {
  const settled = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.adm__model')]
    return cards.length >= 4 && cards.every((card) => {
      const cand = card.querySelector('.adm__model-cand')?.textContent ?? ''
      const btn = card.querySelector('.adm__model-line button')?.textContent ?? ''
      // ★ "不在拉"有两个时刻满足：拉完**之后**，与拉开始**之前**（那一行还是空的）。
      //   所以要的是**落定的结果**：非空、且不是「正在…」。第一次写漏了这一条，
      //   循环在第一帧就退出了，量到的仍是拉取中的状态。
      return cand !== '' && !cand.includes('正在') && !btn.includes('在拉')
    })
  })()`)
  if (settled) break
  await sleep(1000)
}

/* ── 1. 形状 ──────────────────────────────────────────────────────────── */
out.形状 = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.adm__model')]
  return cards.map((card) => {
    // ★ 那一行按**结构**找，不按按钮上的字找：拉取中那颗按钮的字是「在拉…」，
    //   而"按字找"会因此报一个假故障（第一次跑就是这么误报的）
    const line = card.querySelector('.adm__model-line')
    const pull = line?.querySelector('button') ?? null
    const select = card.querySelector('.adm__model-select')
    const test = [...card.querySelectorAll('button')].find((b) => b.textContent.includes('测试连通'))
    return {
      标题: card.querySelector('.adm__model-name')?.firstChild?.textContent?.trim() ?? null,
      药丸: card.querySelector('.adm__badge')?.textContent?.trim() ?? null,
      副标题: card.querySelector('.adm__model-sub')?.textContent?.trim() ?? null,
      网关下拉: select ? [...select.options].map((o) => o.textContent.trim()) : null,
      当前选中: select ? select.options[select.selectedIndex]?.textContent?.trim() : null,
      行: line
        ? {
            有输入框: !!line.querySelector('input'),
            有按钮: !!pull,
            候选下拉条数: line.querySelector('.adm__model-pick')?.options.length ?? null,
          }
        : null,
      拉列表钮的字: pull?.textContent?.trim() ?? null,
      测试连通: !!test,
      测试按钮禁用: test ? test.disabled : null,
      保存按钮样式: (() => {
        const save = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')
        return save ? save.className : null
      })(),
    }
  })
})()`)

/* ── 2. 预设只填地址 ──────────────────────────────────────────────────── */
// 在文字那一张卡上选「DeepSeek（OpenAI 兼容）」——它是 a 那一条（只做文字）
out.预设 = await evaluate(`(() => {
  const card = document.querySelectorAll('.adm__model')[0]
  const select = card.querySelector('.adm__model-select')
  const before = {
    接口地址: card.querySelector('.adm__model-field input[list]') ? null : null,
    模型名: [...card.querySelectorAll('.adm__model-field')].find((f) => f.textContent.includes('模型名'))?.querySelector('input')?.value ?? null,
    地址: [...card.querySelectorAll('.adm__model-field')].find((f) => f.textContent.includes('接口地址'))?.querySelector('input')?.value ?? null,
  }
  const option = [...select.options].find((o) => o.textContent.includes('DeepSeek'))
  if (!option) return { 找到: false, 选项: [...select.options].map((o) => o.textContent.trim()) }
  // ★ React 的受控 select：必须走原生 setter + 派发，直接改 value 不会触发 onChange
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setter.call(select, option.value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return { 找到: true, 选之前: before }
})()`)
await sleep(300)
out.预设.选之后 = await evaluate(`(() => {
  const card = document.querySelectorAll('.adm__model')[0]
  const fieldOf = (label) => [...card.querySelectorAll('.adm__model-field')].find((f) => f.textContent.includes(label))?.querySelector('input')?.value ?? null
  const save = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存')
  return { 地址: fieldOf('接口地址'), 模型名: fieldOf('模型名'), 保存可点: save ? !save.disabled : null }
})()`)

/* ── 3. 候选下拉里是不是**列全**的（2026-10-18 用户报的那一条）───────────
 * 「你这里写的拉取到了，可是我点击下拉框没有啊」——原来是 `datalist`，
 * 而 Chrome 拿输入框里现有的字去筛它：这一格平时是填好的（`qwen3.8-flash`），
 * 26 个里只有它自己匹配得上，于是"拉到 26 个"与"点开只剩一个"同时成立。
 * ★ 判据取**这颗 `<select>` 的 options 条数**（换成 datalist 的话它当场没有），
 *   以及"挑一个之后，值真的写进了那格自由文本框"。
 * ★ 另外记一条**排版**的：它落在输入框**下面**（`flex-basis: 100%`）。
 *   那一行灰字写着「下面那颗」——方向词得跟量出来的排版对得上，
 *   而这句话是能被量错的（第一版它挤在右边、还折了行，灰字却写着"右边"）。 */
out.候选 = await evaluate(`(() => {
  const card = document.querySelectorAll('.adm__model')[0]
  const pick = card.querySelector('.adm__model-pick')
  const input = card.querySelector('.adm__model-line input')
  const 那一行 = card.querySelector('.adm__model-cand')?.textContent?.trim() ?? null
  if (!pick) return { 有候选下拉: false, 那一行 }
  const 条数 = pick.options.length
  // 挑最后一个（不是当前值那个，才看得出"写进去了"）
  const 目标 = pick.options[条数 - 1]?.value ?? ''
  // ★ 先读输入框，再派发：React 对 change 这类离散事件是**同步**刷新的，
  //   派发之后再读就已经是新值了（第一版把那个读数叫"挑之前"，是错的）
  const 挑之前输入框 = input.value
  const ri = input.getBoundingClientRect()
  const rp = pick.getBoundingClientRect()
  const rl = card.querySelector('.adm__model-line').getBoundingClientRect()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setter.call(pick, 目标)
  pick.dispatchEvent(new Event('change', { bubbles: true }))
  return {
    有候选下拉: true,
    条数,
    占位项: pick.options[0]?.textContent?.trim() ?? null,
    挑的是: 目标,
    挑之前输入框,
    // ★ 与**那一行**比宽度，不是与输入框比：输入框那一行还与「拉取模型列表」分宽度
    //   （~298 里它只拿 ~198），拿它当基准会把"占一整行"判成 false（第一版就是这么错的）
    挑选框占一整行: Math.abs(rp.width - rl.width) < 2,
    它比输入框低: rp.top >= ri.bottom,
    宽: { 那一行: Math.round(rl.width), 输入框: Math.round(ri.width), 挑选框: Math.round(rp.width) },
  }
})()`)
await sleep(300)
out.候选.挑之后输入框 = await evaluate(
  `document.querySelectorAll('.adm__model')[0].querySelector('.adm__model-line input').value`,
)
out.候选.挑之后下拉自己弹回去了 = await evaluate(
  `document.querySelectorAll('.adm__model')[0].querySelector('.adm__model-pick').value === ''`,
)

/* ── 4. 测试连通（要 --live=1）──────────────────────────────────────────── */
out.测试 = {}
if (LIVE) {
  const wanted = ONLY.length > 0 ? ONLY : ['text', 'image', 'vision', 'speech']
  for (const capability of wanted) {
    const index = { text: 0, image: 1, vision: 2, speech: 3 }[capability]
    // 视觉那一支要先塞一张本地图片（CDP 的文件输入，不是给 input.value 赋值）
    if (capability === 'vision') {
      const doc = await send('DOM.getDocument', { depth: -1 })
      const found = await send('DOM.querySelector', {
        nodeId: doc.result.root.nodeId,
        selector: `.adm__model:nth-of-type(${index + 1}) input[type=file]`,
      })
      if (found.result?.nodeId) {
        await send('DOM.setFileInputFiles', { nodeId: found.result.nodeId, files: [PHOTO] })
        await sleep(600)
      }
    }

    // ★ 真鼠标点那一颗（`clickAt` 里同时报了"顶上是不是它"）。
    //   定位用 `.adm__test-go .adm__newgo`：保存那颗用了同一个类名，
    //   而它在 `.adm__model-actions` 里，不在 `.adm__test-go` 里。
    const clicked = await clickAt(`.adm__model:nth-of-type(${index + 1}) .adm__test-go .adm__newgo`)

    // 等结果：通了画 `.adm__test-out`，没通是一句红字。图像那一支最长等 200 秒
    let verdict = null
    const deadline = Date.now() + (capability === 'image' ? 200_000 : 60_000)
    while (Date.now() < deadline) {
      verdict = await evaluate(`(() => {
        const card = document.querySelectorAll('.adm__model')[${index}]
        const out = card.querySelector('.adm__test-out')
        const bad = card.querySelector('.adm__model-note[data-bad=true]')
        if (!out && !bad) return null
        const img = out?.querySelector('img')
        const audio = out?.querySelector('audio')
        return {
          一句话: out?.querySelector('.adm__model-note')?.textContent?.trim() ?? bad?.textContent?.trim() ?? null,
          是坏消息: !!bad,
          图: img ? { src前缀: img.src.slice(0, 22), 字节: img.src.length } : null,
          图真的解码出来了: img ? img.naturalWidth > 0 : null,
          音频: audio ? { src前缀: audio.src.slice(0, 22), 字节: audio.src.length } : null,
          它说的话: out?.querySelector('.adm__test-said')?.textContent?.trim() ?? null,
          锚点: [...(out?.querySelectorAll('.adm__test-anchors li') ?? [])].map((li) => li.textContent.trim()),
        }
      })()`)
      if (verdict) break
      await sleep(1000)
    }
    out.测试[capability] = { 点到了: clicked, 结果: verdict }
  }
} else {
  out.测试 = '（没跑：加 --live=1 才真打厂商接口，图像那一按要花钱）'
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) {
  // ★ 产物目录自己建：`.out/` 会被清掉，而"清了之后这一遍白跑"（截图是最后一步）
  //   是最没必要的一次浪费
  mkdirSync(dirname(SHOT), { recursive: true })
  writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'))
  out.截图 = SHOT
}

out.页面报错 = errors.slice(0, 8)

console.log(JSON.stringify(out, null, 2))

ws.close()
chrome.kill()
