/**
 * probe-portrait-background.mts —— 角色标准像的**底是不是白的**（第 21 刀）
 *
 * ```bash
 * # ① 只量已经存在的那几张（不联网、不花钱）：看基线
 * node scripts/probe-portrait-background.mts
 *
 * # ② 真出一张（调图像模型，会花钱），出完当场量
 * node scripts/probe-portrait-background.mts --gen=1
 * ```
 *
 * ## 为什么需要它：用户的判据是"白底"，而"白"不能用肉眼看
 *
 * 用户在卡片墙上指出：`public/demo/cards/` 那两张是白底，现场生成的那张是**暖米色**。
 * 那句话要变成一条能复跑的判据，就得回答"多白才算白"——米色也很亮
 * （`#F5EFE0` 的亮度 240，只比纯白低 15），所以**亮度分不出来**，
 * 分得出来的是**通道差**：纯白 R=G=B，米色 R−B ≈ 20。
 *
 * | 判据 | 它排除的坏法 |
 * |---|---|
 * | 四个角都是纯白（三通道极差 ≤ 6 且最小值 ≥ 250） | 米色/灰色/渐变/带光晕的底——它们在角上就露出来 |
 * | 纯白像素占比打出来做对照 | "角是白的、片子中间是一块色块"这种半白 |
 *
 * ★ 这张表**不是**"模型听不听话"的评分：提示词只是把口径说清楚，
 *   一次抽签不能证明下一次也对。它要证的是**方向**——改之前那几张是什么样、
 *   改之后拍出来的这张是什么样，同一个量法。
 *
 * ★ 不写死"必须是纯白占比 ≥ 90%"这种门槛：人物占了画面中部，占比本来就有个自然值。
 *   所以这里**打印**占比、**断言**四角——四角是"底"的定义域里最干净的那四个点，
 *   而占比留给眼睛与下一刀去比。
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import sharp from 'sharp'

import { DEFAULT_ANCHORS } from '../src/lib/creation/default-anchors.ts'
import { imageProviderOf } from '../src/lib/engine/providers/registry.ts'
import { ageLabelOf, characterSheetPrompt } from '../src/lib/prompts/character-sheet.ts'
import { whitenBackdrop } from '../src/lib/whiten-backdrop.ts'
import { arg, readEnv } from './env.mts'

/** 现成的参考图（基线 + 手工出图那两张），改提示词之前/之后的对照都从这儿取 */
const EXISTING = ['.out/web/cards', 'public/demo/cards', 'public/demo/kids']

const GEN_OUT = resolve('.out/portrait-bg')
const SHEET_SIZE = '1440x1440'

type Measure = {
  file: string
  width: number
  height: number
  /** 四个角的平均色（每角取 12×12 的方块，避开抗锯齿的一两个像素） */
  corners: number[][]
  /** 四角三通道的极差最大值。纯白 ≈ 0；暖米色 ≈ 20 */
  cornerSpread: number
  /** 四角里最小的那个通道值。纯白 = 255；米色会在 224 上下 */
  cornerMin: number
  /** 整幅里"三通道极差 ≤ 6 且最小值 ≥ 250"的像素占比 */
  whiteShare: number
}

async function measure(file: string): Promise<Measure> {
  const image = sharp(await readFile(file)).ensureAlpha()
  const meta = await image.metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const { data, info } = await sharp(await readFile(file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const patch = 12
  const at = (x: number, y: number): number[] => {
    const sum = [0, 0, 0]
    let n = 0
    for (let dy = 0; dy < patch; dy += 1) {
      for (let dx = 0; dx < patch; dx += 1) {
        const offset = ((y + dy) * info.width + (x + dx)) * info.channels
        sum[0] += data[offset] ?? 0
        sum[1] += data[offset + 1] ?? 0
        sum[2] += data[offset + 2] ?? 0
        n += 1
      }
    }
    return sum.map((value) => Math.round(value / n))
  }
  const corners = [
    at(0, 0),
    at(info.width - patch, 0),
    at(0, info.height - patch),
    at(info.width - patch, info.height - patch),
  ]

  let white = 0
  let total = 0
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * info.channels
    const r = data[offset] ?? 0
    const g = data[offset + 1] ?? 0
    const b = data[offset + 2] ?? 0
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max - min <= 6 && min >= 250) white += 1
    total += 1
  }

  const spread = Math.max(...corners.map(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b)))
  const min = Math.min(...corners.map((corner) => Math.min(...corner)))

  return {
    file,
    width,
    height,
    corners,
    cornerSpread: spread,
    cornerMin: min,
    whiteShare: white / total,
  }
}

function report(item: Measure): void {
  const hex = (rgb: number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  console.log(
    `  ${basename(item.file)}\n` +
      `    ${item.width}×${item.height} · 四角 ${item.corners.map(hex).join(' ')}\n` +
      `    角上通道极差 ${item.cornerSpread} · 角上最小通道 ${item.cornerMin} · ` +
      `纯白像素 ${(item.whiteShare * 100).toFixed(1)}%`,
  )
}

async function existingFiles(): Promise<string[]> {
  const out: string[] = []
  for (const dir of EXISTING) {
    const entries = await readdir(resolve(dir), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.(png|jpe?g|webp)$/i.test(entry.name)) continue
      out.push(resolve(dir, entry.name))
    }
    // 卡片资产是一层子目录（`cards/<cardId>/ref.<digest>.png`）
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const inner = await readdir(join(resolve(dir), entry.name), { withFileTypes: true }).catch(
        () => [],
      )
      for (const file of inner) {
        if (file.isFile() && /^ref\./i.test(file.name)) {
          out.push(join(resolve(dir), entry.name, file.name))
        }
      }
    }
  }
  return out
}

async function main(): Promise<void> {
  const baseline = await existingFiles()
  console.log(`\n──── 已经在那儿的那几张（基线）· ${baseline.length} 张 ────`)
  const measured: Measure[] = []
  for (const file of baseline) measured.push(await measure(file))
  measured.forEach(report)

  if (arg('gen') !== '1') {
    console.log('\n（加 --gen=1 会真出一张，出完当场量——那一步会调图像模型）\n')
    return
  }

  const env = await readEnv()
  const image = imageProviderOf(env)
  const prompt = characterSheetPrompt({
    name: '小宇',
    childWord: '小男孩',
    ageLabel: ageLabelOf('4-6'),
    anchors: DEFAULT_ANCHORS,
  })
  console.log(`\n──── 新出一张（${env['IMAGE_MODEL'] ?? '（没配）'}）────`)
  console.log(prompt)
  const started = Date.now()
  const generated = await image.generate({ prompt, size: SHEET_SIZE })
  const ext = generated.mime.includes('png') ? '.png' : extname('x.jpg')
  await mkdir(GEN_OUT, { recursive: true })
  const target = join(GEN_OUT, `sheet${ext}`)
  await writeFile(target, generated.bytes)
  console.log(`\n出好了：${target}（${((Date.now() - started) / 1000).toFixed(1)} 秒）`)
  console.log('模型给的那一张：')
  report(await measure(target))

  // ★ 卡片真正会存下来的，是**刷过底**的那一份（`src/lib/whiten-backdrop.ts`）。
  //   所以判据量的是它，不是模型给的那一张——两张并排打出来，
  //   "刷底做了什么、没做什么"一眼看得出来。
  const step = await whitenBackdrop(generated.bytes, generated.mime)
  const whited = join(GEN_OUT, `sheet-whited${ext}`)
  await writeFile(whited, step.bytes)
  console.log(
    `\n刷过底的那一张（改了 ${step.changed} 个像素 · 这一步跑起来了吗=${step.applied}）：`,
  )
  const fresh = await measure(whited)
  report(fresh)

  const ok = fresh.cornerSpread <= 6 && fresh.cornerMin >= 250
  console.log(
    `\n──── 判据 ────\n  ${ok ? '✓' : '✗'} 四角是纯白（极差 ≤ 6 且最小通道 ≥ 250）\n` +
      `      实测 极差 ${fresh.cornerSpread} · 最小通道 ${fresh.cornerMin}\n`,
  )
  if (!ok) process.exitCode = 1
}

await main()
