/**
 * thumbs.test.ts —— 档位表与缓存键（以及"真能缩"这一件事）
 *
 * 前两组是纯映射，值钱的都在边界上：`?w=0`、`?w=abc`、`?w=999999`
 *   这些不该变成"回原图"的奖励，也不该生成一个无限长的缓存键。
 * 最后一组真跑一次 sharp：它证明这个模块在这台机器的这个 node 上装得上、缩得动
 *   （sharp 是原生模块，"import 得到"与"跑得起来"是两件事，CI 换机器就会露出来）。
 */

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { isResizableImage, renderThumb, thumbKeyOf, thumbWidthOf, THUMB_WIDTHS } from './thumbs.ts'

describe('档位表', () => {
  it('是封闭的五个宽度，且从小到大', () => {
    expect([...THUMB_WIDTHS]).toEqual([240, 384, 512, 768, 1024])
    const sorted = [...THUMB_WIDTHS].sort((a, b) => a - b)
    expect(sorted).toEqual([...THUMB_WIDTHS])
  })
})

describe('thumbWidthOf', () => {
  it('缺省与非法值一律不缩（回原图），不给试探留奖励', () => {
    for (const raw of [
      null,
      undefined,
      '',
      '  ',
      'abc',
      '0',
      '-1',
      '-240',
      'NaN',
      'Infinity',
      '1e99',
    ]) {
      expect(thumbWidthOf(raw), `?w=${String(raw)}`).toBeNull()
    }
  })

  it('比最大档还大的也不缩：那是要原图，不是要一个档', () => {
    expect(thumbWidthOf('2000')).toBeNull()
    expect(thumbWidthOf('1025')).toBeNull()
  })

  it('正好落在档上原样用；不在档上的**向上**取最近一档', () => {
    for (const width of THUMB_WIDTHS) expect(thumbWidthOf(String(width))).toBe(width)
    expect(thumbWidthOf('1')).toBe(240)
    expect(thumbWidthOf('480')).toBe(512)
    expect(thumbWidthOf('744')).toBe(768)
    expect(thumbWidthOf('900')).toBe(1024)
  })

  it('带空格的能读（URL 里 %20 之类是常态）', () => {
    expect(thumbWidthOf(' 512 ')).toBe(512)
  })
})

describe('哪些图能缩', () => {
  it('认 png/jpg/jpeg/webp，大小写无关', () => {
    for (const p of ['cards/a/ref.abc.png', 'books/b/page-1-a1.JPG', 'x.jpeg', 'y.WEBP']) {
      expect(isResizableImage(p), p).toBe(true)
    }
  })

  it('音频、清单、没扩展名的都不缩', () => {
    for (const p of ['books/b/page-1-a1.mp3', 'books/b/book.json', 'cards/a/latest', 'no-dot']) {
      expect(isResizableImage(p), p).toBe(false)
    }
  })
})

describe('thumbKeyOf', () => {
  it('键里同时带宽度与原路径：不同档不互相覆盖，同一档命中同一份', () => {
    expect(thumbKeyOf('cards/xiaoyu-r1/ref.aa.png', 768)).toBe(
      'thumbs/768/cards/xiaoyu-r1/ref.aa.png.webp',
    )
    expect(thumbKeyOf('cards/xiaoyu-r1/ref.aa.png', 240)).not.toBe(
      thumbKeyOf('cards/xiaoyu-r1/ref.aa.png', 768),
    )
  })
})

describe('renderThumb 真跑一次', () => {
  it('出的确是 WebP，且**绝不放大**（源比档窄就按原样出）', async () => {
    const tiny = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#c2410c' },
    })
      .png()
      .toBuffer()

    const out = await renderThumb(new Uint8Array(tiny), 768)
    const meta = await sharp(Buffer.from(out)).metadata()
    expect(meta.format).toBe('webp')
    // 100px 的源要 768：给出来还是 100，不是把糊的放大
    expect(meta.width).toBe(100)

    const big = await sharp({
      create: { width: 1440, height: 1440, channels: 3, background: '#c2410c' },
    })
      .png()
      .toBuffer()
    const shrunk = await sharp(Buffer.from(await renderThumb(new Uint8Array(big), 512))).metadata()
    expect(shrunk.width).toBe(512)
    expect(shrunk.height).toBe(512)
  }, 30_000)
})
