/**
 * check-scrim.mts —— 工作台那层纸光**到底够不够厚**，按 WCAG 量，不靠眼睛
 *
 * ```bash
 * node scripts/check-scrim.mts                          # 默认 1440×900，天空带切十段
 * node scripts/check-scrim.mts --viewport=1920x1080
 * node scripts/check-scrim.mts --bands=20 --cols=160
 * ```
 *
 * 为什么要有这支脚本（docs/known-tradeoffs.md 那条规矩的直接应用）
 * ---------------------------------------------------------------------------
 * 工作台改成"天空 + 纸光"之后，界面上靠上那几行字都压在一张画上。首页为同一件事
 * 付过学费：第三屏那两行灰字，逐带要求 α ≥ 0.92…0.96 —— 那不是"雾再厚一点"的问题，
 * 是**那两行本来就不该压在画上**。这次不想再靠"看着挺清楚"下结论。
 *
 * 而且 docs/known-tradeoffs.md 明写着场景图的量法在 `E:/ui/scripts/check-art.py`，**那份不在仓库里**。
 * 换个人接手就量不出来了。所以这一层的量具进仓库。
 *
 * ★ 它读的是 CSS 本身
 * ---------------------------------------------------------------------------
 * 渐变的那几档 α、`background-position`、天空带的高度、侧栏那层纸的 α、三种墨色的
 * 十六进制，**全部从 CSS 里解析**，一个都不在这里重抄。理由与 docs/known-tradeoffs.md 那条
 * "两处手写的数会各自漂移"一模一样：一份写在脚本里的 α 表，改 CSS 的人不会想到来改它，
 * 于是量出来的是一份早就不存在的设计。解析不出来就**当场报错退出**，
 * 不许退回到内置默认值——退回默认值的量具会一直报绿。
 *
 * 合成口径与首页那次逐像素复核一致：**先在 gamma 编码空间混色**（CSS 就是这么叠的），
 * **再按 WCAG 线性化算明度**。反过来的话，薄雾那一档会算出偏乐观的数。
 *
 * ★ 为什么按**文档**分带而不是按视口分带
 * ---------------------------------------------------------------------------
 * 背景层是 `absolute`（贴在文档顶部那一段），不是 `fixed`。所以"这一行字压在天光上
 * 清不清楚"取决于它在**文档里的位置**，与滚到哪儿无关——量一次，管所有滚动位置。
 * （第一版背景是 fixed，那时按视口分带才是对的；两种几何不能混用，
 * 这也是为什么量具与被量对象必须同源。）
 * 天空带以下那一段是纯纸 `--paper`，纸本身的四种墨色也由本表算（不再从 globals.css
 * 的注释里手抄）；卡面上那三层（`--surface` 卡身 / `--card-paper` 相纸 /
 * `--sky` 声音卡里那一格）同样算，见下面"卡面上那三层"那一段。
 *
 * 报什么
 * ---------------------------------------------------------------------------
 * 1. 十段表：每一段最暗 1% 的合成明度，与三种墨色在那一点的对比度（门槛 4.5:1）
 * 2. 灰字与橙色字的**最长安全横向区间**（逐列取该段最暗处，保守）——
 *    读法是"这一段里，x 在这个区间内放灰字才不违规"
 * 3. 纯纸与两层卡面的四条墨色对比度（门槛同一条）
 * 4. 唯一的硬断言：`--ink` 在天空带内**每一段每一列**都过 4.5:1。
 *    这条过了，才允许说"深墨字可以直接压在天光上"——那是整套设计省掉厚雾的前提。
 *    红了就改 CSS 的 α，**不许改这里的门槛**（门槛是 WCAG 的，不是我们的参数）。
 */

import { readFile } from 'node:fs/promises'

import sharp from 'sharp'

import { arg } from './env.mts'

// ── 小工具 ─────────────────────────────────────────────────────────────────

/** 解析不出来就抛：宁可这支脚本跑不起来，也不要它量一份内置的旧数 */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`解析失败：${what}\n  ★ 这一层不许退回默认值——量具里的默认值会一直报绿。`)
  }
  return value
}

type Rgb = { r: number; g: number; b: number }

function parseHex(text: string, name: string): Rgb {
  const hit = must(
    new RegExp(`--${name}:\\s*#([0-9a-f]{6})\\b`, 'i').exec(text),
    `globals.css 里的 --${name}`,
  )
  const n = Number.parseInt(hit[1] as string, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** 一个 CSS 选择器块 `{ ... }` 的内容（CSS 里没有嵌套花括号，所以这个匹配够用）
 *  ★ 必须**行首**的选择器：这份文件的注释里也写着 `.sb__veil` 这些名字，
 *    用 `indexOf` 会先撞上注释，然后从注释后面找到下一个 `{`——量出来的是别人的块。
 *    （第一次跑就是这么炸的：报"实得 0 档"而不是量错，算它运气好。）
 *  ★ 同一个选择器写了几条规则就**全部拼起来**再解析。这份 CSS 里
 *    `.sb__sky, .sb__veil { 几何 }` 与 `.sb__veil { 渐变 }` 是两条，
 *    只取第一条会量到一个没有渐变的块里（第二次跑就是这么炸的）。 */
function block(css: string, selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${esc}\\s*\\{`, 'gm')
  let body = ''
  let found = false
  for (let hit = re.exec(css); hit; hit = re.exec(css)) {
    const open = hit.index + hit[0].length - 1
    const close = css.indexOf('}', open)
    if (close < 0) throw new Error(`解析失败：${selector} 的块没有闭合`)
    body += css.slice(open + 1, close) + '\n'
    found = true
  }
  return found ? body : null
}

/** 选择器必须在（这份 CSS 里存在并且可解析），否则报错 */
function blockMust(css: string, selector: string): string {
  const body = block(css, selector)
  if (body === null) {
    throw new Error(
      `解析失败：CSS 里找不到行首的选择器 ${selector}\n  ★ 改了背景层的结构，就要连着改量具——不许让它量一份旧设计`,
    )
  }
  return body
}

type Stop = { a: number; p: number }

function parseStops(body: string, where: string): Stop[] {
  const stops = [...body.matchAll(/rgba\(\s*var\(--paper-rgb\)\s*,\s*([\d.]+)\s*\)\s*([\d.]+)%/g)]
  if (stops.length < 2) {
    throw new Error(
      `解析失败：${where} 里至少要有两档 rgba(var(--paper-rgb), α) P%，实得 ${stops.length} 档`,
    )
  }
  return stops.map((m) => ({ a: Number(m[1]), p: Number(m[2]) / 100 }))
}

/** 分段线性插值：CSS 的渐变在两个色标之间就是这条线 */
function ramp(stops: Stop[], t: number): number {
  if (t <= (stops[0]?.p ?? 0)) return stops[0]?.a ?? 0
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1]!
    const next = stops[i]!
    if (t <= next.p) {
      const span = next.p - prev.p
      return span <= 0 ? next.a : prev.a + ((t - prev.p) / span) * (next.a - prev.a)
    }
  }
  return stops[stops.length - 1]?.a ?? 0
}

/** WCAG 相对明度：吃 0–255 的 **gamma 编码**值 */
function luminance(c: Rgb): number {
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

// ── 从 CSS 读设计 ──────────────────────────────────────────────────────────

const VIEWPORT = (() => {
  const [w, h] = arg('viewport', '1440x900').split('x')
  return { w: Number(w), h: Number(h) }
})()
const BANDS = Number(arg('bands', '10'))
const COLS = Number(arg('cols', '120'))
const ROWS_PER_BAND = Number(arg('rows', '8'))
const THRESHOLD = 4.5 // WCAG 正文级 AA。★ 不是可调参数

const globals = await readFile('src/app/globals.css', 'utf8')
const backdropCss = await readFile('src/components/shell/studio-backdrop.css', 'utf8')
const shellCss = await readFile('src/components/shell/app-shell.css', 'utf8')

const PAPER = must(
  (() => {
    const hit = /--paper-rgb:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(globals)
    return hit ? { r: Number(hit[1]), g: Number(hit[2]), b: Number(hit[3]) } : null
  })(),
  'globals.css 里的 --paper-rgb',
)
/** `.sb__sky` 那层 multiply 的底。★ 读不到就报错：图与底是同一次合成，
 *  少读一个等于量了一张不同的图（第一版正是"没有这层底"的那张） */
const SKY_TINT = parseHex(globals, 'sky')
const INKS = {
  '--ink': parseHex(globals, 'ink'),
  /* ★ `--ink-soft` 也要在表里：它是卡片上 `strong` 那一档（`.cd__hint strong`），
     不进表就没人会发现它被改暗/改亮到了线上 */
  '--ink-soft': parseHex(globals, 'ink-soft'),
  '--ink-muted': parseHex(globals, 'ink-muted'),
  '--accent': parseHex(globals, 'accent'),
  /* ★ `--danger` 也在表里：卡面上那颗「删掉他」hover 时就是它（`.cw__del:hover`），
     而"红色在卡面上够不够"这件事以前没人量过——它一直是靠"红了就行"选出来的 */
  '--danger': parseHex(globals, 'danger'),
  /* ★ `--warn` 是 2026-10-18 配色审查 C1 新拆出来的一颗（`--danger` 原来一个人演
     两个角色：真失败与"只是要你留意"）。它一出生就进表——新令牌**不许**在没人量的
     情况下落地，否则它就重走了 `--danger` 当年"靠红了就行"那条路。
     实测六面全过：--paper 5.54 · --surface 5.93 · --card-paper 5.20 · --sky 5.24
     · --page-paper 5.55 · 玻璃合成 5.22。 */
  '--warn': parseHex(globals, 'warn'),
  /* 压在天空上的次级文字。★ 它必须在这张表里，否则改暗一点/亮一点没人会发现 */
  '--ink-on-sky': parseHex(globals, 'ink-on-sky'),
} as Record<string, Rgb>

const SKY_BODY = blockMust(backdropCss, '.sb__sky')
const SKY_URL = must(
  /background-image:\s*url\(['"]?([^'")]+)['"]?\)/.exec(SKY_BODY)?.[1],
  '.sb__sky 的 background-image',
)
const SKY_POS = must(
  /background-position:\s*([\d.]+)%\s+([\d.]+)%/.exec(SKY_BODY)?.slice(1),
  '.sb__sky 的 background-position（两个百分比）',
).map(Number) as [number, number]

/** 天空带有多高。单位只认 vh —— 它是"文档顶部那一段"，与视口高挂钩 */
const SKY_VH = must(
  Number(/--sky-h:\s*([\d.]+)vh/.exec(blockMust(backdropCss, '.sb'))?.[1]),
  '.sb 的 --sky-h（形如 `--sky-h: 112vh`）',
)
const SKY_H = Math.round((VIEWPORT.h * SKY_VH) / 100)

const VEIL = parseStops(blockMust(backdropCss, '.sb__veil'), '.sb__veil')

/** 可选的第三层：径向阅读光。★ 缺席是**明说**的，不是拿默认值补上的 */
const GLOW = (() => {
  const body = block(backdropCss, '.sb__glow')
  if (!body) return null
  const geo = must(
    /radial-gradient\(\s*([\d.]+)%\s+([\d.]+)%\s+at\s+([\d.]+)%\s+([\d.]+)%/.exec(body)?.slice(1),
    '.sb__glow 的 radial-gradient 几何（RX% RY% at X% Y%）',
  ).map(Number) as [number, number, number, number]
  return {
    rx: geo[0] / 100,
    ry: geo[1] / 100,
    cx: geo[2] / 100,
    cy: geo[3] / 100,
    stops: parseStops(body, '.sb__glow'),
  }
})()

/** 侧栏那层纸。读不到就只量内容区——不猜一个 α */
const SIDE_PAPER = (() => {
  const body = block(shellCss, '.shell__side') ?? ''
  const hit = /rgba\(\s*var\(--paper-rgb\)\s*,\s*([\d.]+)\s*\)/.exec(body)
  return hit ? Number(hit[1]) : null
})()
const SIDE_W = (() => {
  const hit = /--side-w:\s*(\d+)px/.exec(shellCss)
  return hit ? Number(hit[1]) : 232
})()

// ── 把 scene-1 按 CSS 的口径铺到"文档顶部那一段"上 ────────────────────────

const skyPath = 'public' + SKY_URL
const skyBuf = await readFile(skyPath)
const skyMeta = await sharp(skyBuf).metadata()
const skyInfo = await sharp(skyBuf).ensureAlpha().raw().toBuffer()
const IW = must(skyMeta.width, 'scene 宽度')
const IH = must(skyMeta.height, 'scene 高度')

/** `cover`：纵横都铺满、保持比例、多出来的裁掉；再按 background-position 摆。
 *  ★ 铺的盒子是 W × SKY_H（天空带那块），不是整个视口 */
const scale = Math.max(VIEWPORT.w / IW, SKY_H / IH)
const drawnW = IW * scale
const drawnH = IH * scale
const offX = (VIEWPORT.w - drawnW) * (SKY_POS[0] / 100)
const offY = (SKY_H - drawnH) * (SKY_POS[1] / 100)

/** `background-blend-mode: multiply`（`.sb__sky` 与 `--sky` 之间）。
 *  ★ 混合模式是在 **sRGB 的 gamma 编码值**上逐通道相乘的，所以直接乘再除 255 就是
 *    CSS 给出的那个数——不要先线性化。这一层不建模的话，量出来的是一张"没有那层底"的图。 */
function multiply(base: Rgb, tint: Rgb): Rgb {
  return { r: (base.r * tint.r) / 255, g: (base.g * tint.g) / 255, b: (base.b * tint.b) / 255 }
}

function skyAt(x: number, y: number): Rgb {
  const ix = Math.min(IW - 1, Math.max(0, Math.floor((x - offX) / scale)))
  const iy = Math.min(IH - 1, Math.max(0, Math.floor((y - offY) / scale)))
  const i = (iy * IW + ix) * 4
  return multiply({ r: skyInfo[i]!, g: skyInfo[i + 1]!, b: skyInfo[i + 2]! }, SKY_TINT)
}

/** 纸色按 α 压在天上：CSS 的 over，在 gamma 编码空间里混 */
function over(base: Rgb, a: number): Rgb {
  const k = Math.min(1, Math.max(0, a))
  return {
    r: PAPER.r * k + base.r * (1 - k),
    g: PAPER.g * k + base.g * (1 - k),
    b: PAPER.b * k + base.b * (1 - k),
  }
}

/** 合计 α。两层同色，over 的结合律允许直接这么合 */
function combined(y: number, x: number): number {
  const veil = ramp(VEIL, y / SKY_H)
  if (!GLOW) return veil
  const dx = (x / VIEWPORT.w - GLOW.cx) / GLOW.rx
  const dy = (y / SKY_H - GLOW.cy) / GLOW.ry
  return 1 - (1 - veil) * (1 - ramp(GLOW.stops, Math.hypot(dx, dy)))
}

// ── 量 ─────────────────────────────────────────────────────────────────────

type BandRow = {
  band: number
  y0: number
  y1: number
  dark1L: number
  dark1E: number
  contrast: Record<string, number>
  safe: Record<string, [number, number] | null>
  /** 该段合成色的 **R−B** 冷暖度：负=偏冷（青/蓝），正=偏暖（橙/米）。
   *  ★ 加这一列不是为了好看，是为了把"滚到中段底色又变橙了"这句话变成能断言的东西：
   *    天空带**最后一段**与它下面那块纯纸必须同号，否则交界处就是一次冷→暖的换色 */
  rb: { mean: number; min: number; max: number }
}

function measure(): BandRow[] {
  const rows: BandRow[] = []
  const regionLeft = SIDE_W
  const regionW = VIEWPORT.w - SIDE_W

  for (let b = 0; b < BANDS; b++) {
    const y0 = (b * SKY_H) / BANDS
    const y1 = ((b + 1) * SKY_H) / BANDS
    const lums: number[] = []
    let rbSum = 0
    let rbCount = 0
    let rbMin = Infinity
    let rbMax = -Infinity
    // 每列取该段内 ROWS_PER_BAND 行里的最暗处：列是"这一行字能不能放"的单位
    const colMin: number[] = []
    for (let c = 0; c < COLS; c++) {
      const x = regionLeft + ((c + 0.5) * regionW) / COLS
      let worst = Infinity
      for (let r = 0; r < ROWS_PER_BAND; r++) {
        const y = y0 + ((r + 0.5) * (y1 - y0)) / ROWS_PER_BAND
        const px = over(skyAt(x, y), combined(y, x))
        const L = luminance(px)
        lums.push(L)
        if (L < worst) worst = L
        const rb = px.r - px.b
        rbSum += rb
        rbCount += 1
        if (rb < rbMin) rbMin = rb
        if (rb > rbMax) rbMax = rb
      }
      colMin.push(worst)
    }
    lums.sort((p, q) => p - q)
    const dark1 = lums[Math.max(0, Math.floor(lums.length * 0.01)) - 1] ?? lums[0]!
    const encode = (L: number): number => {
      const s = L <= 0.0031308 ? L * 12.92 : 1.055 * L ** (1 / 2.4) - 0.055
      return Math.round(s * 255)
    }
    /** 该段里"每一行都过线"的最长连续横向区间（视口 %）。
     *  ★ 报最长的一段，不报头尾：中间断一格却报 x 16–100% 是在骗排版的人——
     *    第一次跑就出过这个形状（有一段有一列云影不过线）。 */
    const safeRange = (rgb: Rgb): [number, number] | null => {
      const need = luminance(rgb)
      const toPct = (i: number): number =>
        Math.round(((regionLeft + (i * regionW) / COLS) / VIEWPORT.w) * 100)
      let best: [number, number] | null = null
      let runStart = -1
      for (let c = 0; c <= COLS; c++) {
        const ok = c < COLS && contrast(colMin[c]!, need) >= THRESHOLD
        if (ok && runStart < 0) runStart = c
        if (!ok && runStart >= 0) {
          if (!best || c - runStart > best[1] - best[0]) best = [toPct(runStart), toPct(c)]
          runStart = -1
        }
      }
      return best
    }

    const cr: Record<string, number> = {}
    const sf: Record<string, [number, number] | null> = {}
    for (const [name, rgb] of Object.entries(INKS)) {
      cr[name] = contrast(dark1, luminance(rgb))
      sf[name] = safeRange(rgb)
    }
    rows.push({
      band: b + 1,
      y0: Math.round((y0 / SKY_H) * 100),
      y1: Math.round((y1 / SKY_H) * 100),
      dark1L: Math.round(dark1 * 255 * 10) / 10,
      dark1E: encode(dark1),
      contrast: cr,
      safe: sf,
      rb: { mean: rbSum / rbCount, min: rbMin, max: rbMax },
    })
  }
  return rows
}

const rows = measure()

// ── 报 ─────────────────────────────────────────────────────────────────────

const fmt = (n: number, d = 2): string => n.toFixed(d)
const pct = (r: [number, number] | null): string => (r ? `x ${r[0]}–${r[1]}%` : '无一处过线')

console.log(`\n== 工作台纸光  ${SKY_URL} (${IW}×${IH}, ${(skyBuf.length / 1024).toFixed(1)} KB)`)
console.log(
  `   × multiply 底色 --sky rgb(${SKY_TINT.r},${SKY_TINT.g},${SKY_TINT.b})` +
    ` —— 图只有顶上 20% 是蓝的，下面七成是准白，这层底把那个色偏铺到整段`,
)
console.log(
  `   视口 ${VIEWPORT.w}×${VIEWPORT.h} · 天空带 = 文档顶部 ${SKY_VH}vh = ${SKY_H}px · ` +
    `内容区 x≥${SIDE_W}px · 切 ${BANDS} 段 × ${COLS} 列 × ${ROWS_PER_BAND} 行`,
)
console.log(`   veil ${VEIL.map((s) => `${fmt(s.a)}@${Math.round(s.p * 100)}%`).join(' → ')}`)
console.log(
  GLOW
    ? `   glow ${fmt(GLOW.rx)}×${fmt(GLOW.ry)} @ ${Math.round(GLOW.cx * 100)}%,${Math.round(GLOW.cy * 100)}%  ` +
        GLOW.stops.map((s) => `${fmt(s.a)}@${Math.round(s.p * 100)}`).join('/')
    : `   glow 这一层不存在（CSS 里没有 .sb__glow）——本表只量 sky + veil 两层`,
)
if (SIDE_PAPER === null) {
  console.log(`   侧栏：app-shell.css 里没有可解析的 rgba(var(--paper-rgb), α) —— 本表只量内容区`)
} else {
  console.log(`   侧栏那层纸 α=${fmt(SIDE_PAPER)}（另算，见下）`)
}
console.log(
  `\n   段       天空带内 y     dark1L dark1E   --ink  --ink-muted   --accent  --ink-on-sky   灰字最长安全段   橙字最长安全段   R−B 冷暖`,
)
for (const r of rows) {
  console.log(
    `   ${String(r.band).padStart(2)}  ${String(r.y0).padStart(3)}–${String(r.y1).padStart(3)}%  ` +
      `${fmt(r.dark1L, 1).padStart(7)} ${String(r.dark1E).padStart(6)}  ` +
      `${fmt(r.contrast['--ink']!).padStart(5)} ${fmt(r.contrast['--ink-muted']!).padStart(9)}  ` +
      `${fmt(r.contrast['--accent']!).padStart(8)} ${fmt(r.contrast['--ink-on-sky']!).padStart(10)}   ` +
      `${pct(r.safe['--ink-muted']).padEnd(16)} ${pct(r.safe['--accent']).padEnd(15)} ` +
      `${r.rb.mean >= 0 ? '+' : ''}${fmt(r.rb.mean, 1)} (${fmt(r.rb.min, 0)}…${fmt(r.rb.max, 0)})`,
  )
}

if (SIDE_PAPER !== null) {
  const sideLum = luminance(over(skyAt(SIDE_W / 2, SKY_H * 0.12), SIDE_PAPER))
  console.log(`\n   侧栏（x=${SIDE_W / 2}，取天空带 12% 那一处代表）：`)
  for (const [name, rgb] of Object.entries(INKS)) {
    console.log(`     ${name.padEnd(12)} ${fmt(contrast(sideLum, luminance(rgb)))}:1`)
  }
}

/** 天空带以下那一大段：`.sb` 的 `background: var(--paper)`，没有图也没有雾，
 *  就是一张纯色纸。**这一段才是灰字与橙字真正的家**（governing rule 里"必须在一张纸里"
 *  的那张纸），所以它的四条对比度由这里算，不再从 globals.css 的注释里手抄——
 *  两处手写的数会各自漂移，这条规矩本项目已经付过学费。
 *  ★ 判据比天空带更严：天空带只断言 `--ink` 与 `--ink-on-sky`，这里**四种全断言**，
 *  因为 `--ink-muted` 与 `--accent` 别处没得去。 */
const PAPER_L = luminance(PAPER)
const PAPER_CR = Object.fromEntries(
  Object.entries(INKS).map(([name, rgb]) => [name, contrast(PAPER_L, luminance(rgb))]),
) as Record<string, number>
console.log(
  `\n   天空带以下（文档 y > ${SKY_VH}vh）是纯 --paper rgb(${PAPER.r},${PAPER.g},${PAPER.b}) —— ` +
    `灰字与橙字的家：`,
)
for (const [name, v] of Object.entries(PAPER_CR)) {
  console.log(
    `     ${name.padEnd(12)} ${fmt(v)}:1 ${v >= THRESHOLD ? '' : `  ✗ 低于 ${THRESHOLD}`}`,
  )
}

/**
 * 卡面上那一层：**不是**纸，是纸上面压着的卡（`--surface`）、被拿在手里的相纸
 * （`--card-paper`），以及声音卡里那一格冷纸（`--sky`）。
 *
 * ★ `--sky` 是 2026-10-16 加进这张表的：那一格原来铺的是暖相纸（`--card-paper`），
 *   用户把声音那一屏改成了冷色，那一格改成 `--sky`，而**里面照样是正文**
 *   （一句真语料 + 一颗按钮）。也就是说"卡面上有正文的面"从两层变成了三层——
 *   量具不跟着走，就有一层没量过的面留在那儿。
 *
 * ★ `--page-paper` 是 2026-10-18 配色审查 B3 加进这张表的，起因是同一个毛病：
 *   书页纸（`reader-book.css` 里那张 `#fbf7ef`；首页第二屏那一份已随那屏下架）此前是
 *   **五个字面量**，从来没进过任何一张表——而它上面真的落着正文（同一句话
 *   在两台阅读器上都排在它上面，还有那两颗选择点的纸片按钮）。
 *   它现在是令牌了，也就在这张表里了。
 *
 * ★ 为什么这两行必须进这支脚本（工单 05）
 * ---------------------------------------------------------------------------
 * 2026-10-15 角色墙的卡身从 `--card-paper` 换成 `--surface`。当时要回答的问题是
 * "换底色会不会把字读坏"，而手算一遍再抄进注释的数是**会漂移的那份**
 * （globals.css 的文件头就写着这条教训）。所以让量具自己去读那两个令牌：
 * 谁改了令牌，这两行当场变；下面的断言红了，就是那一屏真的读不了了。
 * ★ 门槛与纯纸同一条：卡面上落的也是正文级的小字（13–15px），不是大标题。
 */
const CARD_FACES = ['surface', 'card-paper', 'page-paper', 'sky'] as const
const CARD_CR: Record<string, Record<string, number>> = {}
for (const face of CARD_FACES) {
  const L = luminance(parseHex(globals, face))
  CARD_CR[face] = Object.fromEntries(
    Object.entries(INKS).map(([name, rgb]) => [name, contrast(L, luminance(rgb))]),
  ) as Record<string, number>
}
console.log(
  `\n   卡面上那四层（卡身 --surface / 相纸 --card-paper / 书页纸 --page-paper / ` +
    `声音卡那一格 --sky）—— 与纸同一条门槛：`,
)
console.log(
  `     ${''.padEnd(12)} ${Object.keys(INKS)
    .map((n) => ` ${n}`.padStart(13))
    .join('')}`,
)
for (const face of CARD_FACES) {
  console.log(
    `     ${('--' + face).padEnd(12)} ${Object.values(CARD_CR[face]!)
      .map((v) => `${fmt(v)}${v >= THRESHOLD ? ' ' : '✗'}`.padStart(13))
      .join('')}`,
  )
}

/**
 * 个人主页那一屏的四个令牌（2026-10-17）。
 *
 * ★ 为什么它要进这支脚本：那一屏的强调色**不是全站那颗橙**，是用户指定另开的一组
 *   （`--pf-accent` / `--pf-paper` / `--pf-hairline` / `--pf-accent-rgb`，
 *   理由写在 `globals.css` 那一段里）。全站那支橙的四条对比度由上面两张表管着，
 *   这一组**没有任何别的地方量**——而它里面真的落着 12px 的字
 *   （「3 张角色卡」「可朗读」那两枚标签），掉到 4.5 以下就是真的读不了。
 *
 * ★ 两个门槛不一样，别把它们写成同一个：
 *   · `--pf-accent` 压在 `--surface`（白卡）上 —— **过 4.5**。那是 12px 标签的字色，正文级。
 *   · `--pf-accent` 压在 `--pf-paper`（头像那个圆底）上 —— 只过 **3:1**。
 *     那里画的是**图形**不是字（那六个头像 SVG 的记号），非文字元素那条线是 3:1。
 *     实测是 4.48:1，**差一点点没过 4.5**，而它本来也不必过。
 *   · `--ink-muted` 压在 `--pf-paper` 上 —— 那个空圈的图形色，同上 3:1，实测 4.63。
 */
const PF_SURFACE = { r: 255, g: 255, b: 255 }
const pfAccent = parseHex(globals, 'pf-accent')
const pfPaper = parseHex(globals, 'pf-paper')
/**
 * ★ 这一行原来在**下面**（个人主页那几行检查之后），而那几行会先写 `fail`——
 *   于是它们一旦不过，这支脚本抛的是 `ReferenceError: Cannot access 'fail'
 *   before initialization`，而不是把它标红。**量具坏了会装成"跑通了"**，
 *   所以把声明提到第一处写入之前。
 */
let fail = false
const PF_CHECKS: [string, number, number][] = [
  [
    '--pf-accent / --surface（12px 标签的字色）',
    contrast(luminance(PF_SURFACE), luminance(pfAccent)),
    THRESHOLD,
  ],
  [
    '--ink-muted / --pf-paper（头像那个空圈，图形）',
    contrast(luminance(pfPaper), luminance(parseHex(globals, 'ink-muted'))),
    3,
  ],
]
console.log('')
console.log('   个人主页那一屏（--pf-*，另一组令牌）：')
for (const [label, v, limit] of PF_CHECKS) {
  const ok = v >= limit
  if (!ok) fail = true
  console.log(`     ${fmt(v)}:1  门槛 ${limit}  ${ok ? '' : '✗ '}${label}`)
}
/* ★ `--pf-accent` 在头像圆底上**不**断言 4.5：那里是图形不是字。
   但把它印出来——它是"这个蓝够不够看得见"的旁证，掉到 3 以下才该出事。 */
const pfOnPaper = contrast(luminance(pfPaper), luminance(pfAccent))
if (pfOnPaper < 3) fail = true
console.log(
  `     ${fmt(pfOnPaper)}:1  门槛 3（图形）  ${pfOnPaper >= 3 ? '' : '✗ '}--pf-accent / --pf-paper（头像记号）`,
)

/**
 * ── 个人主页那层蓝底（`ProfileBackdrop`，2026-10-17）─────────────────────────
 *
 * 用户拿参考稿说「复刻一下背景」，`/account` 从此铺的是**四条渐变**而不是工作台那片天
 * （`AppShell` 按路径二选一）。这一层与 `.sb` 的取法**相反**：
 *
 *   · `.sb` 是 `absolute`、随文档滚动，所以"哪一行字压在天上"按文档分段量（上面那十段表）；
 *   · 这一层是 `fixed`、整屏不随滚动，而"哪一行字压在哪儿"仍然是个确定答案——
 *     **取整屏最深的那一个采样点**就够（这一层全是极浅的冷色，最深点是个常数）。
 *
 * ★ 取最深点而不是逐段算，理由与下面"运行视图那两层玻璃"那一条逐字相同：
 *   固定背景 + 会滚动的正文，逐段算会得出"这一屏的上半页可以、下半页不行"
 *   这种没法照着排版的结论。保守界的代价只是"最深那一点也得过线"。
 *
 * ★ 这一层与那三团光晕的 α、位置**逐字照搬参考稿**。所以这张表有两个用处：
 *   一是拦住"顺手把光晕调浓一点"，二是**把这一屏的排版法律写下来**——
 *   `--ink-muted`(4.16) 与 `--pf-accent`(4.12) 在这层上**做文字不过线**，
 *   于是它们必须待在一张纸里（`.pf__card` / `.pf__pw` / `.pf__book`）。
 *   那两行刻意**不断言**（它们是"不许用"，不是"要达标"），但必须印出来：
 *   下一个往上加字的人要先看见这两个数。
 *
 * ★ 数字与现场（2026-10-17，1440×900 实测；最深一点落在 **1265,90**，
 *   也就是第二团光晕的圆心）：
 *   `--ink` **13.99**:1（页头大标题）· `--pf-ink-on-wash` **6.96**:1（直接坐在底上的次级文字）
 *   · `--ink-muted` **4.18**:1 ✗ · `--pf-accent` **4.05**:1 ✗
 *   · 侧栏那层纸压在这层上：`--ink-muted` **4.80** · `--accent`（全站那颗橙在这个
 *   固定背景上的唯一落点）**4.66** —— 两条都过 4.5，所以侧栏一个颜色都不用改。
 */
const pfbCss = await readFile('src/components/account/profile-backdrop.css', 'utf8')
const PFB_BODY = blockMust(pfbCss, '.pfb')

/** `--pf-glow-N-rgb: R, G, B`（与 `--paper-rgb` 同一种写法，所以另写一个小解析） */
function parseTriple(text: string, name: string): Rgb {
  const hit = must(
    new RegExp(`--${name}:\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)`).exec(text),
    `globals.css 里的 --${name}（形如 \`--x-rgb: 1, 2, 3\`）`,
  )
  return { r: Number(hit[1]), g: Number(hit[2]), b: Number(hit[3]) }
}

/** 最底下那一层：`linear-gradient(180deg, var(--paper), var(--pf-wash-bottom))` */
const PFB_BASE = (() => {
  must(
    /linear-gradient\(\s*180deg\s*,\s*var\(--paper\)\s*,\s*var\(--pf-wash-bottom\)\s*\)/.exec(
      PFB_BODY,
    ),
    '.pfb 的 linear-gradient（形如 `linear-gradient(180deg, var(--paper), var(--pf-wash-bottom))`）',
  )
  return { top: PAPER, bottom: parseHex(globals, 'pf-wash-bottom') }
})()

/**
 * 上面那三团。★ 顺序就是层序（写在最前的最上），所以合成时要从后往前叠。
 *
 * ★ 半径那一档**不是** `0.42 × 视口`：`radial-gradient(circle at …)` 不写尺寸时，
 *   圆的半径默认是**到最远那个角**的距离，色标里的百分比再乘在**那条半径**上。
 *   当成长边的一半算，1440×900 下会把第一团从 616px 算成 605px——
 *   差得不大，但那是"算错了刚好看着像对的"，所以按定义算。
 */
const PFB_GLOWS = (() => {
  const re =
    /radial-gradient\(\s*circle at ([\d.]+)% ([\d.]+)%\s*,\s*rgba\(var\(--pf-glow-(\d)-rgb\),\s*([\d.]+)\)\s*,\s*transparent ([\d.]+)%\s*\)/g
  const out = [...PFB_BODY.matchAll(re)].map((m) => ({
    cx: Number(m[1]) / 100,
    cy: Number(m[2]) / 100,
    color: parseTriple(globals, `pf-glow-${m[3]}-rgb`),
    a: Number(m[4]),
    r: Number(m[5]) / 100,
  }))
  if (out.length < 3) {
    throw new Error(
      `解析失败：.pfb 里应该有三条 rgba(var(--pf-glow-N-rgb), α) 的 radial-gradient，实得 ${out.length} 条`,
    )
  }
  return out
})()

/** 到最远那个角的距离——`circle` 的默认尺寸（farthest-corner） */
function farthestCorner(cx: number, cy: number, w: number, h: number): number {
  return Math.max(
    Math.hypot(cx, cy),
    Math.hypot(w - cx, cy),
    Math.hypot(cx, h - cy),
    Math.hypot(w - cx, h - cy),
  )
}

/** 一点上的颜色：底 → 最下面那团 → 中间那团 → 最上面那团（CSS 的层序） */
function washAt(x: number, y: number): Rgb {
  const t = Math.min(1, Math.max(0, y / VIEWPORT.h))
  let c: Rgb = {
    r: PFB_BASE.top.r + (PFB_BASE.bottom.r - PFB_BASE.top.r) * t,
    g: PFB_BASE.top.g + (PFB_BASE.bottom.g - PFB_BASE.top.g) * t,
    b: PFB_BASE.top.b + (PFB_BASE.bottom.b - PFB_BASE.top.b) * t,
  }
  for (const glow of [...PFB_GLOWS].reverse()) {
    const cx = glow.cx * VIEWPORT.w
    const cy = glow.cy * VIEWPORT.h
    const R = farthestCorner(cx, cy, VIEWPORT.w, VIEWPORT.h) * glow.r
    const a = R <= 0 ? 0 : glow.a * Math.max(0, 1 - Math.hypot(x - cx, y - cy) / R)
    if (a <= 0) continue
    c = {
      r: glow.color.r * a + c.r * (1 - a),
      g: glow.color.g * a + c.g * (1 - a),
      b: glow.color.b * a + c.b * (1 - a),
    }
  }
  return c
}

/** 整屏扫一遍，取最暗的那一点（= 对文字最不利的那一点） */
const PFB_DARKEST = (() => {
  let best = { x: 0, y: 0, c: washAt(0, 0), l: 1 }
  for (let iy = 0; iy <= 180; iy++) {
    for (let ix = 0; ix <= 288; ix++) {
      const x = (ix / 288) * VIEWPORT.w
      const y = (iy / 180) * VIEWPORT.h
      const c = washAt(x, y)
      const l = luminance(c)
      if (l < best.l) best = { x, y, c, l }
    }
  }
  return best
})()

/* ★ 侧栏也压在这一层上（`.shell__side` 自己那层 α=0.78 的纸），
   而那一层纸的 α 原来是照着**天空**定的。换背景就得重新量——
   它是全站的主色（橙）在这一屏唯一的落点，破了没人会发现。 */
const PFB_SIDEBAR = SIDE_PAPER === null ? null : over(PFB_DARKEST.c, SIDE_PAPER)

type WashRow = { label: string; v: number; limit: number | null }
const PF_WASH_ROWS: WashRow[] = [
  {
    label: '--ink / 那层蓝底最深处（页头大标题）',
    v: contrast(PFB_DARKEST.l, luminance(parseHex(globals, 'ink'))),
    limit: THRESHOLD,
  },
  {
    label: '--pf-ink-on-wash / 那层蓝底最深处（直接坐在底上的次级文字）',
    v: contrast(PFB_DARKEST.l, luminance(parseHex(globals, 'pf-ink-on-wash'))),
    limit: THRESHOLD,
  },
  {
    /* ★ 这两行 limit 是 null：不是"要达标"，是"**不许这么用**"。
       印出来是为了让下一个往这层上加字的人先看见这两个数。 */
    label: '--ink-muted / 那层蓝底最深处  ← 这一层上不许做文字，放进纸里用',
    v: contrast(PFB_DARKEST.l, luminance(parseHex(globals, 'ink-muted'))),
    limit: null,
  },
  {
    label: '--pf-accent / 那层蓝底最深处  ← 同上，因此 `.pf__pw` 是一张纸',
    v: contrast(PFB_DARKEST.l, luminance(pfAccent)),
    limit: null,
  },
]
if (PFB_SIDEBAR) {
  PF_WASH_ROWS.push(
    {
      label: `--ink-muted / 侧栏那层纸(${fmt(SIDE_PAPER)} 的纸)压在蓝底上`,
      v: contrast(luminance(PFB_SIDEBAR), luminance(parseHex(globals, 'ink-muted'))),
      limit: THRESHOLD,
    },
    {
      label: `--accent / 侧栏那层纸压在蓝底上（全站那颗橙在这一屏唯一的落点）`,
      v: contrast(luminance(PFB_SIDEBAR), luminance(parseHex(globals, 'accent'))),
      limit: THRESHOLD,
    },
  )
}

console.log('')
console.log(
  `   个人主页那层蓝底（ProfileBackdrop，固定背景，最深一点在 ${Math.round(PFB_DARKEST.x)},${Math.round(PFB_DARKEST.y)}）：`,
)
for (const row of PF_WASH_ROWS) {
  const ok = row.limit === null ? null : row.v >= row.limit
  if (ok === false) fail = true
  const mark = ok === null ? '— ' : ok ? '' : '✗ '
  console.log(`     ${fmt(row.v)}:1  ${mark}${row.label}`)
}

/**
 * ── 运行视图那两层玻璃（2026-10-17） ─────────────────────────────────────────
 *
 * 上面那条阶段轨、底下那条输入条，以及故事闸门那一屏的每一张卡，铺的是
 * `--surface-glass`（半透明白）而不是 `--surface`（纯白）：它们**压在天光上**，
 * 而全白的板压上去会把背景切成三块（用户的原话是"两个白色的背景不透明度减小一点"）。
 *
 * ★ 为什么它必须进这支脚本：上面 `CARD_FACES` 量的是**实心**面（`parseHex` 读的就是
 *   一个十六进制值）——半透明的面叠在天光上根本算不出来，"跳过"就等于这一层
 *   成了没人检查过的正文面。而这一层上真的落着 13–15px 的字：
 *   `.gr__name`（阶段轨的格名）/ `.gr__story`（底部那句话）/ `.ss__label`（闸门的字段名）。
 *
 * ★ 取**整条天空带最暗的那一个采样点**：这三块的位置是流动的（底部那条是 `sticky`，
 *   滚到哪儿就压在哪儿），所以定一个**保守的界**比逐段算更诚实——逐段算会得出
 *   "第 3 段可以、第 7 段不行"这种没法照着排版的结论。保守的代价只是 α 收得高一点。
 *
 * ★ 合成口径与前两张表**逐字相同**：先在 gamma 编码空间混色（CSS 就是这么叠的），
 *   再按 WCAG 线性化算对比度。
 *
 * ★ 卡在门槛上的是 **`--accent`**（不是 `--ink-muted`）：两条线的斜率差不多，
 *   而 accent 起跑就低一档。实测 2026-10-17：α=0.80 → 4.90/4.76；
 *   α=0.68 → 4.65/4.52；α=0.60 → 4.49/4.37（**两个都破**）。
 *   所以这个令牌的底是 **α ≈ 0.69**，现取 0.70。
 *   ★ 这条值得写进脚本而不是只写进 CSS：它是一支未来会被用来"再调薄一点"的杠杆，
 *     而"底在哪"必须能被重新量出来，不能靠上一版注释里的一个估计数。
 *
 * ★ **闸门那些框（`--paper-glass`）故意不在这里单开一行**：框是**叠在**卡片那层
 *   `--surface-glass` 之上的，两层白只会让合成结果更不透明（0.45 压在 0.70 上 = 0.835）。
 *   也就是说这一张表算的是**最稀的那一层**，它就是下界——给框再加一行只会得到
 *   一组必然更高的数，那种"永远会过"的断言不是闸门，是装饰。
 */
const GLASS_ALPHA = must(
  Number(
    /--surface-glass:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)/.exec(globals)?.[1],
  ),
  'globals.css 的 --surface-glass（形如 `--surface-glass: rgba(255, 255, 255, 0.88)`）',
)

/** 白按 α 压在一个底色上：与 `over()` 同一条 over 公式，只是这一层的颜色是白 */
function whiteOver(base: Rgb, alpha: number): Rgb {
  const k = Math.min(1, Math.max(0, alpha))
  return {
    r: 255 * k + base.r * (1 - k),
    g: 255 * k + base.g * (1 - k),
    b: 255 * k + base.b * (1 - k),
  }
}

/**
 * 整条天空带里最暗的那一点。
 * ★ 采样格网与上面那张表同一套密度（`BANDS × COLS × ROWS_PER_BAND`）：
 *   上表要把结果按段归好，这里要的是**全局最暗的那一个**，所以在同一个格网上再扫一遍。
 *   两处密度取自同几个常量，所以不存在"玻璃面量的是另一套格点"。
 */
const darkestSky = (() => {
  let worst = { L: Infinity, px: { r: 0, g: 0, b: 0 } }
  const regionLeft = SIDE_W
  const regionW = VIEWPORT.w - SIDE_W
  for (let b = 0; b < BANDS; b++) {
    const y0 = (b * SKY_H) / BANDS
    const y1 = ((b + 1) * SKY_H) / BANDS
    for (let c = 0; c < COLS; c++) {
      const x = regionLeft + ((c + 0.5) * regionW) / COLS
      for (let r = 0; r < ROWS_PER_BAND; r++) {
        const y = y0 + ((r + 0.5) * (y1 - y0)) / ROWS_PER_BAND
        const px = over(skyAt(x, y), combined(y, x))
        const L = luminance(px)
        if (L < worst.L) worst = { L, px }
      }
    }
  }
  return worst
})()

const glassBase = whiteOver(darkestSky.px, GLASS_ALPHA)
const GLASS_CR: Record<string, number> = Object.fromEntries(
  Object.entries(INKS).map(([name, rgb]) => [name, contrast(luminance(glassBase), luminance(rgb))]),
) as Record<string, number>

console.log('')
console.log(
  `   运行视图那两层玻璃（--surface-glass α=${GLASS_ALPHA}，压在天光上）—— 与纸同一条门槛：`,
)
console.log(
  `     取的是整条天空带最暗的那一点：合成后 rgb(${Math.round(glassBase.r)},` +
    `${Math.round(glassBase.g)},${Math.round(glassBase.b)})（那一处天光 rgb(${Math.round(
      darkestSky.px.r,
    )},${Math.round(darkestSky.px.g)},${Math.round(darkestSky.px.b)})）`,
)
for (const [name, v] of Object.entries(GLASS_CR)) {
  if (v < THRESHOLD) fail = true
  console.log(`     ${name.padEnd(12)} ${fmt(v)}:1 ${v >= THRESHOLD ? ' ' : '✗'}`)
}

/**
 * ── 只读块/错误块那一层浅底（`--surface-soft`，2026-10-18 配色审查 E1）─────────
 *
 * `--surface-soft` 是 `rgba(28, 28, 36, 0.05)` —— 与玻璃同一个毛病：**它是半透明的，
 * 算不出来**，所以 `CARD_FACES` 那张表（只读十六进制）够不着它。全站 32 处在用它，
 * 而它上面落着 12–13px 的正文与状态色（`.nv__error` / `.vc__why` / `.adm__error` /
 * `.cl__gate` / `.dk__notes li` …）。
 *
 * ★ 为什么它必须进脚本：审查里漏掉的那两处（占位符 2.35:1、首页第三屏 2.04:1）
 *   是**同一个病**——"颜色写在组件里、压在没被任何一张表列过的面上"。
 *   量具的表是白名单制的，白名单之外的面就是没人看的面。
 *
 * ★ 取最暗的那个底（`--paper`）算，因为这一层**不只落在白卡上**：
 *   `globals.css` 的 `.reader-page__empty code` 就压在页面底上——那里是 `--paper`。
 *   （`--bg` 与 `--paper` 的相对亮度只差 0.0014，读数同档，所以一行够用。）
 *
 * ★ 这一行把 `--accent` **明确排除在外**，因为它在这一档只有 **4.40:1**，够不着 4.5。
 *   也就是说：**`--surface-soft` 上的字不许用 `--accent`**——除非那一块确定压在白卡上
 *   （那样合成出的是 `#f4f4f4`，4.51:1，刚够）。今天全站 32 处一处都没这么用
 *   （把这句写下来的那一刻是逐块 grep 过的），所以排除它不会放过任何现存问题。
 * ★ 它是**排除**而不是"降门槛"：门槛还是 4.5，只是这一层上那颗颜色被指名禁用。
 *   改 CSS 让它够得着，或者别在这层上用它——两条路都在，改门槛不在。
 */
const SOFT_ALPHA = must(
  Number(
    /--surface-soft:\s*rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(globals)?.[1],
  ),
  'globals.css 的 --surface-soft（形如 `--surface-soft: rgba(28, 28, 36, 0.05)`）',
)
const SOFT_TINT = (() => {
  const m = /--surface-soft:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)/.exec(
    globals,
  )
  must(m, '解析 --surface-soft 的 rgb')
  return { r: Number(m![1]), g: Number(m![2]), b: Number(m![3]) }
})()
/** 任意色按 α 压在任意底上。★ 上面那两个 `over()`（纸压在天上）与 `whiteOver()`
 *  （白压在天光上）都把其中一端写死了——这一层两端的颜色都不是常量，所以要第三个。 */
function tintOver(base: Rgb, tint: Rgb, alpha: number): Rgb {
  const k = Math.min(1, Math.max(0, alpha))
  return {
    r: tint.r * k + base.r * (1 - k),
    g: tint.g * k + base.g * (1 - k),
    b: tint.b * k + base.b * (1 - k),
  }
}
const softBase = tintOver(PAPER, SOFT_TINT, SOFT_ALPHA)
const SOFT_CR: Record<string, number> = Object.fromEntries(
  Object.entries(INKS).map(([name, rgb]) => [name, contrast(luminance(softBase), luminance(rgb))]),
) as Record<string, number>
console.log('')
console.log(
  `   只读块/错误块那层浅底（--surface-soft α=${SOFT_ALPHA}，压在 --paper 上）—— 与纸同一条门槛：`,
)
console.log(
  `     最暗的落法：合成后 rgb(${Math.round(softBase.r)},${Math.round(softBase.g)},${Math.round(
    softBase.b,
  )})`,
)
for (const [name, v] of Object.entries(SOFT_CR)) {
  /* `--accent` 在这一档够不着 4.5（4.40）——指名禁用，不参与断言（理由见上） */
  if (name === '--accent') {
    console.log(
      `     ${name.padEnd(12)} ${fmt(v)}:1   ← 这一层不许用它（对 --paper 够不着 ${THRESHOLD}；` +
        `压在白卡上才是 4.51）`,
    )
    continue
  }
  if (v < THRESHOLD) fail = true
  console.log(`     ${name.padEnd(12)} ${fmt(v)}:1 ${v >= THRESHOLD ? ' ' : '✗'}`)
}

/** ★ 交界不许换色。天空带**最后一段**的冷暖度与它下面那块纯纸必须同号——
 *  异号就是"往上滚是天、往下滚又变橙"那个割裂感本身。
 *  判据用**均值**不用极值：云是暖的（R>B），那属于画面内容，不是接缝；
 *  接缝看的是"这一段整体偏什么"。 */
const PAPER_RB = PAPER.r - PAPER.b
const lastBand = rows[rows.length - 1]!
if (Math.sign(lastBand.rb.mean) !== Math.sign(PAPER_RB)) {
  fail = true
  console.log(
    `   ✗ 天空带最后一段 R−B ${fmt(lastBand.rb.mean, 1)} 与纯纸 ${PAPER_RB} 异号 —— ` +
      `交界处会有一次冷→暖的换色（这就是"割裂感"）`,
  )
} else {
  console.log(
    `\n   ✓ 交界不换色：天空带最后一段 R−B ${fmt(lastBand.rb.mean, 1)} 与纯纸 ${PAPER_RB} 同号` +
      `（都是冷白）。往上翻到第 1 段是 ${fmt(rows[0]!.rb.mean, 1)}——那是云与天，是画面内容。`,
  )
}
for (const [name, v] of Object.entries(PAPER_CR)) {
  if (v < THRESHOLD) {
    fail = true
    console.log(
      `   ✗ 纯纸上的 ${name} 只有 ${fmt(v)}:1（门槛 ${THRESHOLD}）—— 改 --paper，别改门槛`,
    )
  }
}
/** ★ 卡面四条全断言。卡上有 13px 的次级文字与橙色链接（`.cw__eyebrow`、`.cw__use`），
 *  所以这里不能只查 `--ink`。实测三层的四条都在 4.5 以上，`--surface` 还更高——
 *  这条断言的意义不是"现在过"，是**下次有人为了好看把卡面调深时当场拦住他**。 */
for (const face of CARD_FACES) {
  for (const [name, v] of Object.entries(CARD_CR[face]!)) {
    if (v < THRESHOLD) {
      fail = true
      console.log(
        `   ✗ --${face} 上的 ${name} 只有 ${fmt(v)}:1（门槛 ${THRESHOLD}）—— 卡面调浅，别改门槛`,
      )
    }
  }
}
/** ★ 这两条才是硬断言：它们被**定义**成"可以压在天空上"，所以必须整段过。
 *  --ink-muted 与 --accent 不在这里——它们只能在上面那张表报出的安全区间里，
 *  那是排版时看的事，不是这支脚本能替人决定的（governing rule）。 */
for (const name of ['--ink', '--ink-on-sky'] as const) {
  for (const r of rows) {
    if (r.contrast[name]! < THRESHOLD) {
      fail = true
      console.log(
        `   ✗ 第 ${r.band} 段 ${name} 只有 ${fmt(r.contrast[name]!)}:1（门槛 ${THRESHOLD}）`,
      )
    }
  }
}
console.log(
  fail
    ? `\nFAIL：${THRESHOLD}:1 没过 —— 那一段不能放这个颜色的字，或者把 α 加厚。\n      ★ 门槛是 WCAG 的，改 CSS 不改这里。\n`
    : `\nPASS：${BANDS} 段全部 ${THRESHOLD}:1 过 —— "天上可以放 --ink 与 --ink-on-sky"这两条成立。\n` +
        `      灰字/橙色字仍然只能放在上面那张表的安全区间里（governing rule）。\n`,
)
process.exit(fail ? 1 : 0)
