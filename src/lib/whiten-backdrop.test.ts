/**
 * whiten-backdrop.test.ts —— 刷底那一步的四条边界（2026-10-16 第 23 刀）
 *
 * ★ 这几条盯的不是"能不能刷白"，是刷不到的两种东西：
 *   ① 人物（底以外的一切）不许动；② 人物内部的近白高光不许动
 *   （它被轮廓封住，从四边泛洪本来就到不了——这一条要是坏了，
 *   白衬衫与眼睛里的白点会被整片吃掉，而症状看起来只是"画得有点怪"）。
 * 另外两条是"什么都不该发生"：已经是白底的不重编码，非 PNG 的原样放回。
 */

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

import { whitenBackdrop } from './whiten-backdrop.ts'

const W = 40
const H = 40

/** 造一张图：`paint(x, y)` 回 `[r, g, b]` */
async function makeImage(
  paint: (x: number, y: number) => [number, number, number],
): Promise<Uint8Array> {
  const data = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const [r, g, b] = paint(x, y)
      const offset = (y * W + x) * 3
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
    }
  }
  return new Uint8Array(
    await sharp(data, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toBuffer(),
  )
}

async function pixels(bytes: Uint8Array): Promise<{ data: Uint8Array; channels: number }> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, channels: info.channels }
}

const at = (data: Uint8Array, channels: number, x: number, y: number): number[] => {
  const offset = (y * W + x) * channels
  return [data[offset], data[offset + 1], data[offset + 2]].map((v) => v ?? -1)
}

describe('whitenBackdrop', () => {
  it('米白底刷成纯白，中间那块**一个像素都不动**', async () => {
    const bytes = await makeImage((x, y) =>
      x >= 14 && x < 26 && y >= 14 && y < 26 ? [120, 80, 60] : [247, 247, 243],
    )
    const out = await whitenBackdrop(bytes, 'image/png')
    const { data, channels } = await pixels(out.bytes)

    expect(at(data, channels, 0, 0)).toEqual([255, 255, 255])
    expect(at(data, channels, W - 1, H - 1)).toEqual([255, 255, 255])
    expect(at(data, channels, 20, 20)).toEqual([120, 80, 60])
    // 底 1600 格 - 那块 12×12 = 1456 格被刷
    expect(out.changed).toBe(W * H - 144)
    expect(out.applied).toBe(true)
  })

  it('★ 被轮廓**封住**的近白不变：白衬衫的高光、眼睛里的白点靠这一条活着', async () => {
    const bytes = await makeImage((x, y) => {
      const inside = x >= 15 && x < 25 && y >= 15 && y < 25
      const ring = x >= 14 && x < 26 && y >= 14 && y < 26 && !inside
      if (ring) return [40, 40, 50] // 轮廓（细彩铅收形那一圈）
      if (inside) return [248, 248, 244] // 封在里面的"纸白"，与外面那片一模一样
      return [247, 247, 243]
    })
    const out = await whitenBackdrop(bytes, 'image/png')
    const { data, channels } = await pixels(out.bytes)

    expect(at(data, channels, 0, 0)).toEqual([255, 255, 255])
    // 里面那一片没被刷——它虽然和底同色，但从四边泛洪到不了
    expect(at(data, channels, 20, 20)).toEqual([248, 248, 244])
  })

  it('已经是纯白：一个像素都不改，而且**字节原样返回**（不重编码）', async () => {
    const bytes = await makeImage(() => [255, 255, 255])
    const out = await whitenBackdrop(bytes, 'image/png')
    expect(out.changed).toBe(0)
    expect(out.bytes).toBe(bytes)
  })

  it('★ 暖米色那一档故意**不**吃（#F1E0CB 极差 38）：那是旧提示词的产物，不该被这一步糊过去', async () => {
    const bytes = await makeImage(() => [241, 224, 203])
    const out = await whitenBackdrop(bytes, 'image/png')
    expect(out.changed).toBe(0)
    expect(out.bytes).toBe(bytes)
  })

  it('不是 PNG 就原样放回（重编码 JPEG 会掉画质，这个项目为它付过学费）', async () => {
    const bytes = await makeImage(() => [247, 247, 243])
    const out = await whitenBackdrop(bytes, 'image/jpeg')
    expect(out.applied).toBe(false)
    expect(out.changed).toBe(0)
    expect(out.bytes).toBe(bytes)
  })

  it('★ 读不了的字节**不许把请求弄失败**：这一步是修饰，不是判据', async () => {
    // 卡那一条路的单测用的是假字节（`new Uint8Array([1,2,3])`），实测它会
    // 让 sharp 抛 "unsupported image format"——而那一抛会把整个建卡请求带下去。
    const junk = new Uint8Array([1, 2, 3, 4])
    const out = await whitenBackdrop(junk, 'image/png')
    expect(out.applied).toBe(false)
    expect(out.bytes).toBe(junk)
  })
})
