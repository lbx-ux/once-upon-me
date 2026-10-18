/**
 * check-reader-paper.mts —— 量那六张底图：**不艳、不吵、不暗**
 *
 * ```bash
 * node scripts/check-reader-paper.mts
 * node scripts/check-reader-paper.mts --dir=public/reader-papers   # 换目录
 * ```
 *
 * ## 为什么要有这一支
 *
 * 用户 2026-10-18 的话是三个形容词：「不要太艳」「不要抢绘本的视线」，
 * 以及他否掉点阵时那个字——「晕」。形容词当不了验收，这一支把它们变成四个数。
 *
 * | 数       | 是什么                                            | 判据                                |
 * | -------- | ------------------------------------------------- | ----------------------------------- |
 * | `period` | **周期性**：20px（点阵周期）及其倍频上的归一化自相关 | ★ 「晕」那把尺子：点阵那一行当上限   |
 * | `hf`     | 高频能量 `mean abs(L − blur1(L))`：颗粒感           | ★ 不许高过**它背后的绘本**那一行     |
 * | `chroma` | 平均彩度（max−min 通道）                            | 报数（"不要艳"最直接的一个读数）     |
 * | `dev`    | 相对 `--bg` 的偏离（p99）                           | 报数：它是"底上一点色偏"，不是一幅画 |
 *
 * ## ★ 一次量错留下的教训：`hf` 量不出「晕」
 *
 * 第一版只有 `hf`，判据写的是"新图必须比退役的点阵层安静"。**逐条全红**，
 * 而且原因不是图太吵，是**那个判据的前提是错的**。把点阵那一格印出来看：
 *
 * ```
 * 一格 20×20 的粒子那一行：247 234 234 247 247 … 247
 * ```
 *
 * 一颗粒子只占 2 个像素、只比底色深 13 级（α 是 `.18 × .5 = .09`）——
 * 逐像素的高频能量**几乎为零**（0.0001 量级），而生成的图每一颗像素都带纸纹，
 * 量出来是 0.002–0.007，**比点阵高两个数量级**。也就是说：
 * 拿 `hf` 当"晕"的尺子，等于说点阵是这一屏最安静的底——那显然不是用户的观感。
 *
 * 「晕」在这个尺寸上不是**每像素的反差**，是**规则重复**：同一颗粒子每 20px
 * 出现一次，铺满 140 万像素，眼睛会去锁那个点阵格（再与像素栅格、与浏览器的
 * 缩放比拍频）。所以真正对得上那句话的量是**周期性**——自相关。于是这一支改成：
 *
 * · `period` 拿点阵当**上限**（它在这个量上必然接近 1，那正是它会晕的原因）；
 * · `hf` 换一条**别的**参照：它背后的绘本（"不要抢绘本的视线"——底图不该比画还吵）。
 *
 * 两个数都报出来，两条都留在表上：一个量错了不要紧，**把错的量也留在记录里**，
 * 下一个人就不会再照着它推一遍。
 *
 * ## 另外两条纪律
 *
 * 1. **参照系是量出来的，不是印象里的。** 点阵那一行按 `globals.css` 的
 *    `--dot` / `--dot-size` 与那一条点阵规则的 `opacity` **合成出来**；
 *    绘本那一行是盘上真躺着的 24 张（12 本的封面 + 每一本的第 1 页）。
 *    于是"比点阵不晕""比绘本不吵"都是**可复现的比较**，不是我新造的门槛。
 *    ★ 与 `check-scrim.mts` 同一条：量具读被量对象本身，解析不出来就当场报错。
 *
 *    ★ 2026-10-18 底图换上来之后，**被退役的那一层自己那份 CSS 已经不在仓库里了**
 *    （`.blr__ambient` 换成了 `.blr__desk`）。所以这一行读的是它的**活着的同胞**：
 *    首页第二屏的 `.storybook__ambient`（`storybook-flip.css`）。这不是"找张像的凑"，
 *    有据可查：退役那一版的文件头自己写着「逐字沿用首页与第二屏那一套
 *    （`--dot` / `--dot-size` / `2px 2px` / .75px），一个数都不新造」，
 *    连 `opacity: .5` 都是照着第二屏那条改回来的（`git log -S'blr__ambient'` 能翻到）。
 *    所以这一行量的是"这个项目真在用的那张点阵"，不是一段誊抄下来的字面量——
 *    第二屏那条要是被人调亮调暗，这里跟着动，那正是它该有的脾气。
 *    ★ 连粒子半径都从那条渐变里解析出来（`.75px` / `.95px` 那一对）：写死半径的话，
 *    有人改了渐变而没想起这支脚本，量出来的就是一张**早就没有的点阵**。
 * 2. **在原生分辨率上量，不缩。** 周期性是 20px 上的事，缩图会把要量的东西抹掉。
 *
 * ## ★ 那条由 WCAG 反推的判据：**不在这里**，换了个地方
 *
 * 第一版这里有一条「最暗 1% 必须亮到 `--ink-muted` 压上去仍过 4.5:1」（由 WCAG 反推），
 * 它全红。当时的判决是"它本来就该红"：那条线（明度 ≥ 0.836，约 `#e9e9e9`）是
 * "字要压在这张图上"才成立的约束，而那时这一层按设计**一行字都不压**——
 * 遮罩在每一行文案那一带已经收成 0。拿文字的门槛去卡一层没有文字的装饰，是把两件事混成一件。
 *
 * ★ 2026-10-18 第三轮（用户：「背景铺平整个屏幕呀」）把那个前提**掀掉了**：
 *   遮罩整条删除，底图现在 `fixed; inset: 0` 铺满视口，**每一行字都真压在图上**。
 *   于是那条门槛重新成立，只是**不是在这里成立** ——
 *   `dark` 量的是整张图的"最暗 1%"（全图 p1），而字压在图上时该问的是
 *   「**那一行字脚下那一横条**里最暗的 1% 是多少」：一张四边均匀的图，
 *   全图 p1 可能落在一个没字的角落，用它去卡字是把依据选松了。
 *   所以这一条搬去了 `scripts/chk-reader-desk.mjs` 判据 2：
 *   在浏览器里把每一行字隐掉（`color: transparent`，一个字都不动布局）逐档截屏，
 *   用 sharp 量那一横条，**逐行 × 逐档 × 逐视口**判 4.5:1。那才是这条线的量法。
 *
 * 留在这里的 `dark` 因此仍是**报数**（并与绘本对照）：它现在说的是另一件事——
 * "这张底整体比画亮"，也就是「不抢绘本的视线」。名字没改，量法没改，
 * 改的只是**它不再是一个人扛那条门槛**。
 */

import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import sharp from 'sharp'

import { arg } from './env.mts'

const DIR = resolve(arg('dir', 'public/reader-papers'))
/** 量具的中间产物落这里（点阵那张合成图） */
const TMP_DIR = resolve('.out/reader-papers')
const GLOBALS_PATH = 'src/app/globals.css'
/**
 * 点阵那一行的**活的源头**。
 *
 * ★ 不是 `booklist-reader.css` —— 那一层 2026-10-18 退役了，`.blr__ambient` 在仓库里
 *   已经不存在。退役那一版的点阵是**逐字照抄首页第二屏**的（它自己的文件头写了这句话），
 *   所以这里直接读第二屏那一条：量到的仍是"这个项目真在用的那张点阵"。
 *   推导与出处见文件头「另外两条纪律」第 1 条。
 */
const DOT_TWIN_PATH = 'src/components/book/storybook-flip.css'
const DOT_TWIN_SEL = '.storybook__ambient'
/** 绘本那一行取哪几本：12 本的封面 + 每一本的第 1 页 */
const ART_GLOB = /^(cover|p1)\.webp$/

/** 解析不出来就抛：宁可这一支跑不起来，也不要它拿内置的旧数报绿 */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`解析失败：${what}\n  ★ 量具不许退回默认值——默认值会一直报绿。`)
  }
  return value
}

type Rgb = { r: number; g: number; b: number }

function hexOf(text: string, name: string): Rgb {
  const hit = must(
    new RegExp(`--${name}:\\s*#([0-9a-f]{6})\\b`, 'i').exec(text),
    `globals.css 里的 --${name}`,
  )[1] as string
  const n = Number.parseInt(hit, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** WCAG 相对明度（线性化之后加权）——与 `check-scrim.mts` 同一套 */
function luminanceOf({ r, g, b }: Rgb): number {
  const lin = (v: number): number => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

type Stats = {
  name: string
  /** 平均彩度（0–255） */
  chroma: number
  /** 高频能量（0–1 的明度尺度） */
  hf: number
  /** 周期尖峰：自相关在 20px 及其倍频上比两侧高出多少（见 `periodSpike`） */
  spike: number
  /** 相对 `--bg` 的偏离（p99，0–1） */
  dev: number
  /** 最暗 1% 的 WCAG 相对明度 */
  dark: number
  /** 平均色，一眼看出这张偏哪支色相 */
  mean: Rgb
}

const percentile = (sorted: Float64Array, p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] as number

/**
 * 「周期尖峰」：自相关曲线上，**一个周期那个位置比它两侧高出多少**。
 *
 * ★ 为什么不是直接读 `r(20)`（第一版就是那么写的，量出来六张全在 0.94–0.97，
 *   差点被读成"跟点阵一样有格"）：**平滑的图在短位移上本来就和自己很像**——
 *   一块晕染平移 20px，相关系数自然 0.95；而点阵是 1.000。两者在这一点上分不开。
 *   分开它们的是**形状**：点阵在 20、40、60…**只有那几处**是 1，19 与 21 掉到 0.49；
 *   晕染是一条平缓的曲线，20 与 19、21 几乎一样。
 *
 *   ```
 *   20px 点阵：  r(19)=0.494  r(20)=1.000  r(21)=0.496   → 尖峰 0.505
 *   晨雾那张：   r(19)=0.967  r(20)=0.966  r(21)=0.964   → 尖峰 0.000
 *   ```
 *
 *   所以量的是 `r(k) − (r(k−1)+r(k+1))/2` 在 k = 周期及其倍频上的最大值。
 *   这一个数**只对"重复"敏感，对"平滑"不敏感**，那正是「晕」那句话说的事。
 */
function periodSpike(lums: Float64Array, w: number, h: number, step: number): number {
  const n = w * h
  let sum = 0
  for (let i = 0; i < n; i += 1) sum += lums[i] as number
  const mean = sum / n
  let varr = 0
  for (let i = 0; i < n; i += 1) varr += ((lums[i] as number) - mean) ** 2
  if (varr === 0) return 0

  /** 沿 x 平移 k 像素后的归一化自相关 */
  const corr = (k: number): number => {
    let acc = 0
    let count = 0
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x + k < w; x += 1) {
        acc += ((lums[y * w + x] as number) - mean) * ((lums[y * w + x + k] as number) - mean)
        count += 1
      }
    }
    return acc / (varr * (count / n))
  }

  // ★ 1 倍频与 2 倍频都看：只对齐一次也可能是巧合，两处都尖才是周期
  let best = 0
  for (const k of [step, step * 2]) {
    best = Math.max(best, corr(k) - (corr(k - 1) + corr(k + 1)) / 2)
  }
  return best
}

/**
 * 一张图（或一张合成出来的底）→ 那几个数。
 *
 * ★ `hf` 在 **gamma 编码空间**上算（拿 sharp 的灰度图直接相减，不线性化）：
 *   高频是"肉眼看得见多少抖动"，而肉眼看的就是编码后的值。
 *   两处（图与两张参照）同一套算法，所以比较成立。
 */
async function statsOf(name: string, file: string, step: number): Promise<Stats> {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: c } = info

  const lums = new Float64Array(w * h)
  let chromaSum = 0
  let sr = 0
  let sg = 0
  let sb = 0
  for (let i = 0, px = 0; i < data.length; i += c, px += 1) {
    const r = data[i] as number
    const g = data[i + 1] as number
    const b = data[i + 2] as number
    chromaSum += Math.max(r, g, b) - Math.min(r, g, b)
    sr += r
    sg += g
    sb += b
    lums[px] = luminanceOf({ r, g, b })
  }
  const n = w * h

  // 高频：原灰度 − 模糊 1（σ=1）。★ 去掉 2px 边——模糊在边上会和外面对不齐
  const grey = await sharp(file).greyscale().raw().toBuffer()
  const blur = await sharp(file).greyscale().blur(1).raw().toBuffer()
  let hfSum = 0
  let hfN = 0
  for (let y = 2; y < h - 2; y += 1) {
    for (let x = 2; x < w - 2; x += 1) {
      const i = y * w + x
      hfSum += Math.abs((grey[i] as number) - (blur[i] as number))
      hfN += 1
    }
  }

  const sorted = Float64Array.from(lums).sort()
  const bgL = luminanceOf(BG)
  const devs = Float64Array.from(lums, (v) => Math.abs(v - bgL)).sort()

  return {
    name,
    chroma: chromaSum / n,
    hf: hfSum / hfN / 255,
    spike: periodSpike(lums, w, h, step),
    dev: percentile(devs, 0.99),
    dark: percentile(sorted, 0.01),
    mean: { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) },
  }
}

const hexText = ({ r, g, b }: Rgb): string =>
  [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

/**
 * 退役的那一层：点阵。
 *
 * ★ 逐字搬那一条 `background-image` 与 `opacity`，**从活着的源头读**
 *   （`storybook-flip.css` 的 `.storybook__ambient`，理由见文件头「另外两条纪律」1）：
 *   粒子是 `radial-gradient(circle, var(--dot) .75px, transparent .95px)`，
 *   `--dot` 是 `rgba(28,28,36,.18)`，整层再乘 `opacity: .5`。
 *   SVG 里直接把它合成为最终色（粒心 α = .18 × .5 = .09，到 .95px 处为 0）。
 * ★ 铺 20×20 个格子（400×400）再量：周期性要有一片格子才量得出来，
 *   只画一格量到的是"整张图就是那个周期"。
 */
function dotTile(): Buffer {
  const dot = must(/--dot:\s*rgba\(([\d,\s.]+)\)/i.exec(GLOBALS_CSS)?.[1], 'globals.css 里的 --dot')
  const [dr, dg, db, da] = dot.split(',').map((v) => Number(v.trim()))
  const rule = must(
    new RegExp(`\\${DOT_TWIN_SEL}\\s*\\{[^}]*\\}`, 's').exec(DOT_TWIN_CSS)?.[0],
    `${DOT_TWIN_PATH} 里的 ${DOT_TWIN_SEL} 那一条`,
  )
  const alpha = must(/opacity:\s*([\d.]+)/.exec(rule)?.[1], `点阵的 opacity（${DOT_TWIN_SEL}）`)
  const period = Number(must(/--dot-size:\s*(\d+)px/.exec(GLOBALS_CSS)?.[1], '--dot-size'))
  // ★ 两个半径是从那条渐变里解析出来的，不是写死的：写死的话，
  //   改了渐变而没想起这支脚本，量出来的就是一张早就没有的点阵。
  const grad = must(
    /radial-gradient\(\s*circle\s*,\s*var\(--dot\)\s*([\d.]+)px\s*,\s*transparent\s*([\d.]+)px\s*\)/.exec(
      rule,
    ),
    `${DOT_TWIN_SEL} 那条径向渐变`,
  )
  const core = Number(grad[1])
  const edge = Number(grad[2])
  const a = (da as number) * Number(alpha)
  const size = period * 20
  // 粒心在 (2,2)：`background-position: 2px 2px` 让粒子落在格点左上角
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<defs><pattern id="p" width="${period}" height="${period}" patternUnits="userSpaceOnUse">` +
    `<rect width="${period}" height="${period}" fill="#${hexText(BG)}"/>` +
    `<radialGradient id="d" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="rgba(${dr},${dg},${db},${a})"/>` +
    `<stop offset="${Math.round((core / edge) * 100)}%" stop-color="rgba(${dr},${dg},${db},${a})"/>` +
    `<stop offset="100%" stop-color="rgba(${dr},${dg},${db},0)"/>` +
    `</radialGradient>` +
    `<circle cx="2" cy="2" r="${edge}" fill="url(#d)"/></pattern></defs>` +
    `<rect width="${size}" height="${size}" fill="url(#p)"/></svg>`
  return Buffer.from(svg)
}

let GLOBALS_CSS = ''
/** 点阵那一行读的那份 CSS（第二屏）——见 `DOT_TWIN_PATH` */
let DOT_TWIN_CSS = ''
/** `--bg`：页面底色。点阵那一行垫在它上面，`dev` 也是相对它算的 */
let BG: Rgb = { r: 0, g: 0, b: 0 }
/** 点阵的周期：周期性那一列只在这个尺子上比 */
let STEP = 20

async function main(): Promise<void> {
  GLOBALS_CSS = await readFile(GLOBALS_PATH, 'utf8')
  DOT_TWIN_CSS = await readFile(DOT_TWIN_PATH, 'utf8')
  BG = hexOf(GLOBALS_CSS, 'bg')
  STEP = Number(must(/--dot-size:\s*(\d+)px/.exec(GLOBALS_CSS)?.[1], '--dot-size'))

  const files = (await readdir(DIR))
    .filter((f) => f.endsWith('.webp') && !f.includes('.thumb.'))
    .sort()
  if (files.length === 0) {
    throw new Error(`${DIR} 里没有底图——先跑 node scripts/make-reader-paper.mts --apply=all`)
  }

  // ── 两张参照 ──────────────────────────────────────────────────────────────
  // ★ 合成出来的那张点阵落 `.out/`，**不许落 `public/`**：那是量具的中间产物，
  //   它不是要发布的资产（`reader-paper.test.ts` 会当场把多出来的文件判成"表里没有的图"）
  await mkdir(TMP_DIR, { recursive: true })
  const dotTmp = join(TMP_DIR, 'dot-baseline.png')
  await sharp(dotTile(), { density: 72 }).png().toFile(dotTmp)
  // 名字写"仍在第二屏用"而不是"已退役"：行里的数**是从活着的那条规则读出来的**
  // （文件头「另外两条纪律」1），它今天还铺在首页第二屏上
  const dot = await statsOf('点阵（第二屏用）', dotTmp, STEP)

  /** 它背后的绘本：12 本的封面 + 第 1 页。★ 只取样，不量全部 108 张 */
  const artFiles: string[] = []
  const books = await readdir(resolve('public/booklist'))
  for (const book of books.sort()) {
    for (const file of (await readdir(join('public/booklist', book))).sort()) {
      if (ART_GLOB.test(file)) artFiles.push(join('public/booklist', book, file))
    }
  }
  if (artFiles.length === 0)
    throw new Error('没找到绘本（public/booklist/*）——参照系是量出来的，不许留空')
  const art: Stats[] = []
  for (const file of artFiles) art.push(await statsOf(file, file, STEP))
  const median = (key: 'hf' | 'chroma' | 'dev' | 'dark'): number => {
    const sorted = art.map((a) => a[key]).sort((x, y) => x - y)
    return sorted[Math.floor(sorted.length / 2)] as number
  }

  // ── 表 ────────────────────────────────────────────────────────────────────
  const rows: Stats[] = []
  for (const file of files) {
    rows.push(await statsOf(file.replace(/\.webp$/, ''), join(DIR, file), STEP))
  }

  const pct = (v: number): string => v.toFixed(3)
  const line = (s: Stats): string =>
    `  ${s.name.padEnd(16)} ${s.spike.toFixed(3).padStart(6)}  ${pct(s.hf).padStart(6)}  ` +
    `${s.chroma.toFixed(1).padStart(6)}  ${pct(s.dev)}  ${pct(s.dark)}  ` +
    `${s.mean.r},${s.mean.g},${s.mean.b}`

  console.log(`\n底图读数（原生分辨率）· 周期性只比 ${STEP}px 这一族尺子`)
  console.log(`  ${'图'.padEnd(16)} 尖峰   hf     chroma   dev    dark   均值`)
  console.log(line(dot))
  console.log(
    `  ${'绘本 24 张（中位）'.padEnd(14)}   —    ${pct(median('hf')).padStart(6)}  ` +
      `${median('chroma').toFixed(1).padStart(6)}  ${pct(median('dev'))}  ${pct(median('dark'))}  ← 参照`,
  )
  console.log(`  ${'─'.repeat(70)}`)
  for (const row of rows) console.log(line(row))

  console.log(
    `\n  判据：周期尖峰 < ${pct(dot.spike / 5)}（点阵那一行的五分之一——它才是"有格"的那一层）` +
      `；hf < ${pct(median('hf'))}（绘本中位数——底图不许比画还吵）`,
  )

  let bad = 0
  for (const row of rows) {
    if (row.spike >= dot.spike / 5) {
      bad += 1
      console.log(
        `  ✗ ${row.name}：周期尖峰 ${pct(row.spike)} 不低于点阵的 ${pct(dot.spike)} 的五分之一——它也有格`,
      )
    }
    if (row.hf >= median('hf')) {
      bad += 1
      console.log(
        `  ✗ ${row.name}：颗粒 ${pct(row.hf)} 不低于绘本中位数 ${pct(median('hf'))}——它比画还吵`,
      )
    }
  }

  const darkest = rows.reduce((a, b) => (a.dark < b.dark ? a : b))
  console.log(
    `\n  报数（不进判据）：最暗的是 ${darkest.name} ${pct(darkest.dark)}` +
      `，绘本 24 张最暗 1% 的中位数是 ${pct(median('dark'))}——这一条说的是"底图整体比画亮"` +
      `\n  ★ 字压在图上那条 4.5:1 在这里判不了（全图 p1 不等于字脚下那一横条 p1）：` +
      `量法在 scripts/chk-reader-desk.mjs 判据 2`,
  )
  console.log(
    bad === 0
      ? `\n${rows.length}/${rows.length} 张全过：没有一张带点阵那种"格"，也没有一张比绘本吵`
      : `\n${bad} 条不过（上面逐条列了）`,
  )
  process.exit(bad === 0 ? 0 : 1)
}

await main()
