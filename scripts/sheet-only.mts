/**
 * sheet-only.mts —— 只用已经出好的 raw-*.png 重拼那张对照表（不再调模型、不再花钱）
 *
 * ```bash
 * npx tsx scripts/sheet-only.mts
 * ```
 *
 * ★ 它单独存在，是因为拼图那一步**会**写错（第一版画布算矮了，sharp 直接抛错），
 *   而那一步写错时不该逼着人重新出一次图上一次钱。逻辑与 `make-default-avatar.mts`
 *   的 `sheetOf` 同源——两边都要改的时候记得一起改（这是这一份唯一的欠账）。
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import sharp from 'sharp'

const RAW_DIR = resolve('.out/avatars')
const WASH = '#e9f0f4'

async function circle(bytes: Buffer, size: number): Promise<Buffer> {
  const square = await sharp(bytes).resize(size, size, { fit: 'cover' }).png().toBuffer()
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" ` +
      `r="${size / 2}" fill="#fff"/></svg>`,
  )
  return sharp(square)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

const SIZES = [64, 44, 22]
const CELL = 96
const BIG = 268
const PAD = 8
const GAP = 16

async function main(): Promise<void> {
  const files = (await readdir(RAW_DIR))
    .filter((name) => /^raw-\d+\.png$/.test(name))
    .sort((a, b) => Number(/\d+/.exec(a)?.[0] ?? 0) - Number(/\d+/.exec(b)?.[0] ?? 0))
  if (files.length === 0) throw new Error(`没有 ${RAW_DIR}/raw-*.png`)

  const width = PAD + BIG + GAP + SIZES.length * CELL + PAD
  const rowH = BIG + GAP
  const height = PAD + files.length * rowH

  const layers: sharp.OverlayOptions[] = []
  for (const [row, name] of files.entries()) {
    const bytes = await readFile(join(RAW_DIR, name))
    const top = PAD + row * rowH
    if (row === 0) console.log(`第一张：${name}`)
    layers.push({
      input: await sharp(bytes).resize(BIG, BIG, { fit: 'cover' }).png().toBuffer(),
      left: PAD,
      top,
    })
    for (const [col, size] of SIZES.entries()) {
      layers.push({
        input: await circle(bytes, size),
        left: PAD + BIG + GAP + col * CELL + Math.round((CELL - size) / 2),
        top: top + Math.round((BIG - size) / 2),
      })
    }
  }

  const sheet = await sharp({ create: { width, height, channels: 3, background: WASH } })
    .composite(layers)
    .png()
    .toBuffer()
  const target = join(RAW_DIR, 'sheet.png')
  await writeFile(target, sheet)
  console.log(
    `对照表：${target}（${width}×${height}）\n` +
      `每一行 = 一张候选，行号就是 raw-<n>.png 的 n；` +
      `最左 268px 原样，右边三列是 64 / 44 / 22 裁成圆`,
  )
}

await main()
