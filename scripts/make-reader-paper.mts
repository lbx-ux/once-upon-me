/**
 * make-reader-paper.mts —— 出阅读器那 6 张底图
 *
 * ```bash
 * # ① 出全部候选，并拼一张对照表（调图像模型）
 * node scripts/make-reader-paper.mts
 *
 * # 只补一张（某一张超时之后补它，别六张重出）
 * node scripts/make-reader-paper.mts --only=wood
 *
 * # 只拼对照表，**不调模型**：拿盘上已有的原图拼，缺哪张就少哪一格
 * node scripts/make-reader-paper.mts --sheet
 *
 * # ② 落 public/reader-papers/（原尺寸 webp + 设置里那一格用的缩略图）
 * node scripts/make-reader-paper.mts --apply=all
 * node scripts/make-reader-paper.mts --apply=wood
 * ```
 *
 * ## 它换掉的是什么
 *
 * 2026-10-18 用户看了上一轮落地的「桌面」那一层说：「背景点阵的样式有点晕，
 * 这也背景改为一张图片……图片不要太艳，不要抢绘本的视线」。
 * 于是两台阅读器的 `.blr__ambient` / `.reader__ambient`（点阵）整层退役，
 * 换成本脚本出的这几张图。**点阵不进选项**——它就是要被换掉的那个。
 *
 * ## 提示词的来源与它真正的渲染者
 *
 * 提示词是按 `gpt-image-2-style-library` 那份风格库的模板 **`illustration-art-style`
 * （插画与艺术风格）** 写的：它要求"定义构图、主体、配色、笔触材质、情绪、完成度"，
 * 六个概念**复用同一个模板、只换主体与配色**（那份库对"多概念"的指定）。
 *
 * ★ **但真正渲染它的不是 gpt-image-2，是本仓库接的那个 `wan2.7-image`**
 *   （`IMAGE_MODEL`，见 `src/lib/engine/providers/tokenrhythm-image.ts` 的白名单）。
 *   这一条必须写在明处：`make-default-avatar.mts` 的文件头记过一次同类的坑——
 *   一条"写给 gpt-image-2 的提示词"直接喂给另一个模型，主体与反面约束会被整段忽略。
 *   **所以出完必须看图**，不能只看脚本退出码。
 *
 * ## 六张为什么在这六个维度上分开
 *
 * 分开的是**材质与色相**，不是"风格的说法"（`make-default-avatar.mts` 那三次返工
 * 已经证伪了"换个说法就能变好看"这条路）：纸 / 木 / 布 / 雾 / 陶土 / 白垩。
 * 用户要的是"多给几张，我自己挑"，所以这一轮**不替他挑**：
 * 六张全落 `public/`，挑哪张是设置里的事（`src/lib/reader-paper.ts`）。
 *
 * ## 尺寸与体积
 *
 * 出图 `1536x1024`（3:2，在 `SIZES_BY_MODEL['wan2.7-image']` 白名单里）。
 * 落库**不放大也不裁**，就是原生尺寸，webp q=72 —— 目标每张 ≤ 200KB。
 * ★ 1920 宽的窗口上 `cover` 要放大 1.25×（DPR2 的屏 2.5×）。认下这一条，
 *   与 `studio-backdrop.css` 那份先例同一个写法：底图是**晕染**，放大看出来才怪。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import sharp from 'sharp'

import { imageProviderOf } from '../src/lib/engine/providers/registry.ts'
import { arg, flag, readEnv } from './env.mts'

const RAW_DIR = resolve('.out/reader-papers')
const OUT_DIR = resolve('public/reader-papers')

/** ★ `wan2.7-image` 的模型级白名单里的 3:2（见 `tokenrhythm-image.ts`）。
 *  不在白名单里的尺寸在**发请求之前**就被拦下——那是钱的问题，不是洁癖 */
const SIZE = '1536x1024'

/** 设置里那一格的缩略图。132×88 大约是 `.prefs__swatch` 的两倍宽（DPR2 有余量） */
const THUMB_W = 132
const THUMB_H = 88

/**
 * 落库的 webp 质量。
 *
 * ★ 72 是第一版，六张里有三张落在 220–284KB（`linen` 最重）——**超过这一层的预算**：
 *   它是页面底的一张晕染，不该比一本书的跨页图还重。同尺寸不缩（1536×1024 已经是原生），
 *   只降质量到 64，实测六张全落到 200KB 以下。
 * ★ 降质量对这类图的风险是**色带**（大面积的缓变最容易被量化成台阶），
 *   所以降完要跑 `scripts/check-reader-paper.mts`：那里的 `hf`（高频能量）
 *   会跟着涨——真出带子它当场就能看出来。
 */
const QUALITY = 64

/** 读屏与缩略图都用它；`plain` 那一档不存在图，由设置页自己画一块纯色 */
const NAME_OF: Record<string, string> = {
  paper: '暖纸',
  wood: '木桌',
  linen: '亚麻',
  mist: '晨雾',
  clay: '陶土',
  chalk: '白垩',
}

/**
 * 共用构图段。
 *
 * ★ 第一句就是这一轮最要紧的约束：**没有主体**。绘本那一面是这一屏唯一的主角，
 *   底图上但凡出现"一个东西"（一只杯子、一道窗光、一片叶子），视线就会被分走。
 *   这也是它与头像那批图**正好相反**的地方——那批要"一眼看出是个什么"。
 */
const FRAME =
  '横构图 3:2。★ 这张图**没有主体**：画面里没有任何"东西"，只有一整片材质本身，' +
  '四边到边都一样，不要视觉中心、不要明暗焦点、不要构图上的重心；' +
  '不画边框、不画暗角、不画四角压暗、不画投影、不画地平线、不画任何直线分界。'

/**
 * 共用配色段。取值全部来自 `globals.css` 的 `:root`：
 * `--bg` #f7f7f8、`--card-paper` #f7efe3、`--paper` #f4f8f9、`--ink-muted` #6b6a74、
 * `--accent` #c2410c。
 * ★ "整幅必须亮"这句是"不要抢绘本的视线"在提示词里的落点：绘本是有明暗有饱和的画，
 *   底图只要一直待在浅色那一档，两者就不会打架。
 */
const PALETTE =
  '整幅只用这几支颜色的浅色邻近色：页面底近白 #f7f7f8、暖相纸米色 #f7efe3、' +
  '纸白 #f4f8f9、墨灰 #6b6a74、极淡的陶土橙 #c2410c；' +
  '★ 整幅必须亮、必须轻，最暗的地方也只能停在"淡灰"这一档，不要灰、更不要深色。'

/** 反面约束：逐条点名我**真会**遇到的那些坏法，不是想得起来的那几个词 */
const NEGATIVE =
  '不要文字、不要字母、不要数字、不要印章、不要签名、不要水印；' +
  '不要任何物件：不要书、不要纸页、不要杯子、不要笔、不要植物、不要花、不要石头、不要玩具；' +
  '不要人、不要人脸、不要手、不要动物；不要风景、不要山、不要树、不要天空、不要云；' +
  '不要强光斑、不要窗户投下的光形、不要影子、不要深色块、不要黑色、不要深褐；' +
  '不要高对比的细节、不要锐利的边缘、不要细密的颗粒噪声；' +
  '★ 不要重复图案：不要格纹、不要波点、不要条纹、不要瓷砖缝；' +
  '★ 不要任何"一眼看得出是什么"的局部。'

/**
 * 六张候选。`note` 是给人看的一句话，`prompt` 交给模型。
 * 首行一律是主体（那份风格库把"主体与任务"排在第一块）。
 */
const CONCEPTS: { key: string; note: string; prompt: string }[] = [
  {
    key: 'paper',
    note: '暖纸：手工纸的纤维特写，米白偏暖，最轻的一张（默认档）',
    prompt: [
      '一张手工纸的纤维特写。',
      '纸面铺满整幅，颜色在近白 #f7f7f8 与暖相纸米色 #f7efe3 之间；',
      '看得出极淡的纸浆纤维与帘纹：纤维细、短、方向杂乱，深浅差不出一档；',
      '有三四处极淡的水彩渍，只比纸面深一点点、边界完全晕开、没有硬边；',
      '★ 整幅只有纸，纸以外什么都没有。',
      FRAME,
      PALETTE,
      NEGATIVE,
    ].join('\n'),
  },
  {
    key: 'wood',
    note: '木桌：柔焦的旧木桌面，几道很宽的淡木纹',
    prompt: [
      '一张旧木桌面的特写，柔焦。',
      '木纹是几道**很宽、很淡**的横向纹路，颜色在暖相纸米色 #f7efe3 与稍暖一点的浅棕之间来回，',
      '最深处也只到淡灰，深浅差不出一档；',
      '★ 没有木节、没有裂缝、没有拼板缝、没有反光、没有打磨过的高光；',
      '像一张被擦了很多年的桌面，被人从很近的地方、用很大的光圈拍下来。',
      FRAME,
      PALETTE,
      NEGATIVE,
    ].join('\n'),
  },
  {
    key: 'linen',
    note: '亚麻：米灰布纹，经纬还在但对比极低',
    prompt: [
      '一块亚麻布的特写，柔焦。',
      '看得出极淡的经纬交织：一横一竖的细线，但对比极低，退后一步看是一片米灰；',
      '颜色在暖相纸米色 #f7efe3 与纸白 #f4f8f9 之间，略偏中性冷灰；',
      '★ 布面平整：没有褶皱、没有阴影、没有缝线、没有包边、没有叠起来的边角。',
      FRAME,
      PALETTE,
      NEGATIVE,
    ].join('\n'),
  },
  {
    key: 'mist',
    note: '晨雾：极淡的水彩晕染，偏青，没有形状',
    prompt: [
      '一片极淡的水彩晕染，像清晨的雾。',
      '画面上只有两大块极淡的青灰与米白在缓慢地分开：',
      '青灰带一点点蓝绿、比纸白 #f4f8f9 只深一点点，米白就是暖相纸米色 #f7efe3；',
      '★ 边界完全晕开：看不出任何形状、没有任何笔触方向、没有一朵云、没有一条边；',
      '整幅像一张被水打湿又晾干的纸。',
      FRAME,
      PALETTE,
      NEGATIVE,
    ].join('\n'),
  },
  {
    key: 'clay',
    note: '陶土：灰泥墙，加了很多白的陶土橙',
    prompt: [
      '一面陶土灰泥墙的特写，柔焦。',
      '灰泥的颗粒极细，颜色是**加了很多白**的陶土橙 —— 接近暖相纸米色 #f7efe3 但偏红一点点；',
      '★ 它必须是一面很浅的墙，不是一面土墙：整片都停在浅色那一档；',
      '墙面平整，没有裂纹、没有剥落、没有抹刀痕、没有光斑、没有阴影。',
      FRAME,
      PALETTE,
      NEGATIVE,
    ].join('\n'),
  },
  {
    key: 'chalk',
    note: '白垩：细灰泥，中性冷白，比页面底只冷一点点',
    prompt: [
      '一面白垩灰泥墙的特写，柔焦。',
      '颜色是接近纸白 #f4f8f9 的中性冷白，比页面底 #f7f7f8 只冷一点点、几乎看不出来；',
      '颗粒极细、四边均匀、平整，像一块刚刮平的石膏板；',
      '★ 没有裂纹、没有脏痕、没有手印、没有光斑、没有阴影、没有接缝。',
      FRAME,
      PALETTE,
      NEGATIVE,
    ].join('\n'),
  },
]

/** 行标签。★ 键名一律 ASCII：sharp 走的 librsvg 没有中文衬底字体时画出来是一排空框 */
function labelOf(key: string, width: number, height: number): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" rx="6" fill="#17171d"/>` +
      `<text x="10" y="${height / 2 + 5}" font-family="monospace" font-size="15" ` +
      `fill="#f4f8f9">${key}</text></svg>`,
  )
}

/**
 * 拼对照表：两列三行，每格一张原图 + 左边一条键名。
 *
 * ★ 它存在的理由与 `check-scrim.mts` 同一条：**"看着还行"不是判据**。
 *   不过这一轮要看的恰好是"看着"——读数（`scripts/check-reader-paper.mts`）
 *   能挡住"太艳、太吵、太暗"，挡不住"这张我不喜欢"。两件事都要，缺一条都不够。
 */
async function sheetOf(raw: { key: string; bytes: Buffer }[]): Promise<Buffer> {
  const CELL_W = 560
  const CELL_H = Math.round((CELL_W * 1024) / 1536)
  const PAD = 16
  const GAP = 14
  const LABEL_W = 96
  const COLS = 2
  const rows = Math.ceil(raw.length / COLS)
  const width = PAD * 2 + COLS * (LABEL_W + CELL_W) + (COLS - 1) * GAP
  const height = PAD * 2 + rows * (CELL_H + GAP)

  const layers: sharp.OverlayOptions[] = []
  for (const [i, { key, bytes }] of raw.entries()) {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const left = PAD + col * (LABEL_W + CELL_W + GAP)
    const top = PAD + row * (CELL_H + GAP)
    layers.push({ input: labelOf(key, LABEL_W - 8, 28), left, top: top + 6 })
    layers.push({
      input: await sharp(bytes).resize(CELL_W, CELL_H, { fit: 'cover' }).png().toBuffer(),
      left: left + LABEL_W,
      top,
    })
  }
  return sharp({ create: { width, height, channels: 3, background: '#f7f7f8' } })
    .composite(layers)
    .png()
    .toBuffer()
}

/** 一张原图 → 落库的那两个文件（原尺寸 webp + 缩略图） */
async function apply(key: string, bytes: Buffer): Promise<string> {
  await mkdir(OUT_DIR, { recursive: true })
  const full = await sharp(bytes).webp({ quality: QUALITY }).toBuffer()
  const thumb = await sharp(bytes)
    .resize(THUMB_W, THUMB_H, { fit: 'cover' })
    .webp({ quality: 70 })
    .toBuffer()
  await writeFile(join(OUT_DIR, `${key}.webp`), full)
  await writeFile(join(OUT_DIR, `${key}.thumb.webp`), thumb)
  return `${key}.webp ${(full.length / 1024).toFixed(0)}KB ＋ ${key}.thumb.webp ${(thumb.length / 1024).toFixed(1)}KB`
}

async function main(): Promise<void> {
  const apply_ = arg('apply')

  if (flag('sheet')) {
    const present: { key: string; bytes: Buffer }[] = []
    for (const { key } of CONCEPTS) {
      const bytes = await readFile(join(RAW_DIR, `${key}.png`)).catch(() => null)
      if (bytes) present.push({ key, bytes })
      else console.log(`（少 ${key}——盘上没有，这一格空着）`)
    }
    if (present.length === 0) throw new Error(`盘上一张都没有：${RAW_DIR}`)
    await writeFile(join(RAW_DIR, 'sheet.png'), await sheetOf(present))
    console.log(`\n对照表：${join(RAW_DIR, 'sheet.png')}（${present.length} 张，没调模型）`)
    return
  }

  if (apply_) {
    const wanted = apply_ === 'all' ? CONCEPTS.map((c) => c.key) : [apply_]
    for (const key of wanted) {
      const bytes = await readFile(join(RAW_DIR, `${key}.png`)).catch(() => null)
      if (!bytes) throw new Error(`没有 ${join(RAW_DIR, `${key}.png`)}——先不带参数跑一次出图`)
      console.log(`${key.padEnd(6)} → ${await apply(key, bytes)}`)
    }
    console.log(`\n落好了：${OUT_DIR}`)
    return
  }

  const env = await readEnv()
  const image = imageProviderOf(env)
  const only = arg('only')
  const wanted = only ? CONCEPTS.filter((c) => c.key === only) : CONCEPTS
  if (wanted.length === 0) throw new Error(`--only=${only} 不在候选里`)
  await mkdir(RAW_DIR, { recursive: true })

  const raw: { key: string; bytes: Buffer }[] = []
  for (const { key, prompt } of wanted) {
    const started = Date.now()
    try {
      const generated = await image.generate({ prompt, size: SIZE })
      await writeFile(join(RAW_DIR, `${key}.png`), generated.bytes)
      raw.push({ key, bytes: Buffer.from(generated.bytes) })
      console.log(
        `${key.padEnd(6)} ${NAME_OF[key]}  ${((Date.now() - started) / 1000).toFixed(1)} 秒  ` +
          `${(generated.bytes.length / 1024).toFixed(0)}KB  ${generated.modelId}`,
      )
    } catch (err) {
      /**
       * ★ 一张失败**不掀掉整批**：出图超时是"服务端可能已建单"，**不要重试**
       *   （`tokenrhythm-image.ts` 第 3 条纪律），拿 `--only=<key>` 单独补那一张。
       *   盘上已经出来的那几张是好好的——`make-default-avatar.mts` 就是在这里
       *   咬过一次：一张超时让整张对照表都拿不到。
       */
      console.log(`${key.padEnd(6)} ✗ ${(err as Error).message}`)
    }
  }

  if (raw.length > 1) {
    await writeFile(join(RAW_DIR, 'sheet.png'), await sheetOf(raw))
    console.log(
      `\n对照表：${join(RAW_DIR, 'sheet.png')}\n` +
        `★ 先看图（提示词是照 gpt-image-2 的风格库写的，真正出图的是 IMAGE_MODEL）：\n` +
        `  "有没有出现一只杯子/一道窗光"这类事，只有看图才知道\n` +
        `★ 再跑读数：node scripts/check-reader-paper.mts\n` +
        `落库：node scripts/make-reader-paper.mts --apply=all`,
    )
  }
}

await main()
