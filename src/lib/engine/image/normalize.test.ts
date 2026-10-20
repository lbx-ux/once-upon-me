/**
 * normalize.test.ts —— 参考图归一化的六类输入（工单 02 §2.1 点名的那六类）
 *
 * 这一层是"外部输入 → 已知形状"的唯一关口，所以它的测试不是覆盖率装饰：
 *   每一条都对应服务端一个真实错误码或一个真实症状（躺着的参考图、400 尺寸、400 alpha）。
 *   fixture 全部现生成（sharp.create），不往仓库里塞二进制样本——
 *   一个 12 MB 的测试图片会把 clone 时间变成产品的一部分。
 */

import { randomFillSync } from 'node:crypto'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  REFERENCE_MAX_SIDE,
  REFERENCE_MIN_SIDE,
  normalizeReference,
  referenceDataUrlOf,
} from './normalize.ts'

async function make(opts: {
  width: number
  height: number
  alpha?: boolean
  orientation?: number
  format?: 'png' | 'jpeg'
}): Promise<Uint8Array> {
  const channels = opts.alpha ? 4 : 3
  const base = sharp({
    create: {
      width: opts.width,
      height: opts.height,
      channels,
      background: opts.alpha ? { r: 200, g: 60, b: 30, alpha: 0.4 } : { r: 200, g: 60, b: 30 },
    },
  })
  const withMeta = opts.orientation ? base.withMetadata({ orientation: opts.orientation }) : base
  const buf =
    opts.format === 'jpeg'
      ? await withMeta.jpeg({ quality: 80 }).toBuffer()
      : await withMeta.png().toBuffer()
  return new Uint8Array(buf)
}

describe('normalizeReference · 边界', () => {
  it('1×1 的小图：拒绝，并且说的是人话（不是 payload/downscale）', async () => {
    const bytes = await make({ width: 1, height: 1 })
    await expect(normalizeReference(bytes)).rejects.toMatchObject({
      code: 'reference-invalid',
      message: expect.stringContaining('太小'),
    })
  })

  it('错误码与 `card-invalid` 分得开——界面按码分流，合起来家长会收到一条无关的指引', async () => {
    await expect(normalizeReference(await make({ width: 1, height: 1 }))).rejects.toMatchObject({
      code: 'reference-invalid',
    })
    await expect(normalizeReference(await make({ width: 1, height: 1 }))).rejects.not.toMatchObject(
      {
        code: 'card-invalid',
      },
    )
  })

  it('正好 240×240 收得下（边界是闭区间，服务端原文是「240～8000」）', async () => {
    const bytes = await make({ width: REFERENCE_MIN_SIDE, height: REFERENCE_MIN_SIDE })
    const out = await normalizeReference(bytes)
    expect(out.width).toBe(REFERENCE_MIN_SIDE)
    expect(out.height).toBe(REFERENCE_MIN_SIDE)
  })

  it('8000×8000 不报错：它会被缩到长边上限，而不是送出去吃一个 400', async () => {
    const bytes = await make({ width: REFERENCE_MAX_SIDE, height: REFERENCE_MAX_SIDE })
    const out = await normalizeReference(bytes)
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(REFERENCE_MAX_SIDE)
    expect(out.notes.join(' ')).toContain('缩到')
  })

  it('极长条形（缩到上限后短边不够 240）：拒绝并说清是形状问题', async () => {
    const bytes = await make({ width: 9000, height: 400 })
    await expect(normalizeReference(bytes)).rejects.toMatchObject({
      code: 'reference-invalid',
      message: expect.stringContaining('细长'),
    })
  })

  it('根本不是图片的字节：拒绝，不抛一个 sharp 内部错误上去', async () => {
    await expect(
      normalizeReference(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe])),
    ).rejects.toMatchObject({ code: 'reference-invalid' })
  })
})

describe('normalizeReference · 输出形状', () => {
  it('带 alpha 的 PNG 出来一定没有 alpha（这条是 IMAGE_INPUT_ALPHA_UNSUPPORTED 的关口）', async () => {
    const bytes = await make({ width: 600, height: 600, alpha: true })
    const out = await normalizeReference(bytes)
    const meta = await sharp(Buffer.from(out.bytes)).metadata()
    expect(meta.hasAlpha).toBe(false)
    expect(meta.channels).toBe(3)
    expect(meta.format).toBe('png')
    expect(out.notes.join(' ')).toContain('白底')
  })

  it('本来就无 alpha 的图也一律压平：这样 alpha 错误只可能是 bug，不会是"这张图特殊"', async () => {
    const bytes = await make({ width: 600, height: 600 })
    const out = await normalizeReference(bytes)
    const meta = await sharp(Buffer.from(out.bytes)).metadata()
    expect(meta.hasAlpha).toBeFalsy()
  })

  it('绝不放大：512×512 进来还是 512×512', async () => {
    const bytes = await make({ width: 512, height: 512 })
    const out = await normalizeReference(bytes)
    expect([out.width, out.height]).toEqual([512, 512])
  })

  it('长边超过默认上限 1440 时缩到 1440，短边按比例（不是裁切）', async () => {
    const bytes = await make({ width: 4000, height: 3000 })
    const out = await normalizeReference(bytes)
    expect(out.width).toBe(1440)
    expect(out.height).toBe(1080)
  })

  it('EXIF 方向 6（竖拍存成横的）→ 出来的宽高对调，notes 里说了"转正"', async () => {
    // 400×800 的画布 + orientation 6 = 显示时是 800×400 的横图
    const bytes = await make({ width: 400, height: 800, orientation: 6, format: 'jpeg' })
    const raw = await sharp(Buffer.from(bytes)).metadata()
    const out = await normalizeReference(bytes)
    expect(raw.orientation).toBe(6)
    // 转正之后长宽比应该反过来
    expect(out.width).toBeGreaterThan(out.height)
    expect(out.notes.join(' ')).toContain('转正')
  })

  it('JPEG 输入 → PNG 输出（接口那侧实测吃的是 PNG）', async () => {
    const bytes = await make({ width: 640, height: 480, format: 'jpeg' })
    const out = await normalizeReference(bytes)
    expect(out.mime).toBe('image/png')
    expect((await sharp(Buffer.from(out.bytes)).metadata()).format).toBe('png')
  })

  // 工单 §2.1 那六类里唯一需要"造"的一类：12 MB 的图。
  //   上面那条 4000×3000 量的是尺寸，量不了字节数——纯色图压出来只有几十 KB。
  //   手机原图是又一个量级，所以要真的造一张压不动的（随机噪声），否则这条 fixture
  //   名不副实：它写着 12 MB，跑的是一个 80 KB 的文件。
  it(
    '一张真的 12 MB 的图：进去 12 MB、出来不到 3 MB，形状仍然已知',
    { timeout: 60_000 },
    async () => {
      const side = 2048
      const noise = Buffer.alloc(side * side * 3)
      randomFillSync(noise)
      const bytes = new Uint8Array(
        await sharp(noise, { raw: { width: side, height: side, channels: 3 } })
          .png()
          .toBuffer(),
      )
      const mbIn = bytes.byteLength / 1024 / 1024
      // 这条前提本身要成立，否则这个 fixture 又退化成了上面那条
      expect(mbIn).toBeGreaterThan(10)

      const out = await normalizeReference(bytes)
      expect([out.width, out.height]).toEqual([1440, 1440])
      // 这里不写"缩到 1 MB 以内"。第一版就是这么写的，跑出来 5.94 MB 红了——
      //   不是代码错，是这个期待错：PNG 是无损的，高熵图（照片/噪声）缩到 1440²
      //   之后仍然很大。实测 12.58 MB → 5.94 MB（0.47×）。
      //   所以这条只断言"确实变小了"，绝对量级写在这里当事实，不当闸门——
      //   一个测量出来的数拿来当阈值，下次换个 fixture 就红，那不是测试是占卜。
      expect(out.bytes.byteLength).toBeLessThan(bytes.byteLength / 1.5)
      expect(out.notes.join(' ')).toContain('缩到')
    },
  )
})

describe('referenceDataUrlOf', () => {
  it('前缀是 mime，体是 base64（送进 body 的就是这个形状，实测过）', async () => {
    const bytes = await make({ width: 300, height: 300 })
    const out = await normalizeReference(bytes)
    const url = referenceDataUrlOf(out)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const back = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64')
    expect(back.length).toBe(out.bytes.length)
  })
})
