/**
 * thumbs.ts —— 缩略图：一条**封闭的档位表** + 一次缩放
 *
 * ★ 为什么要有这一层：一张角色参考图实测 2.7–2.8 MB（1440×1440 PNG），
 *   而它在卡片墙上只有 372 CSS 像素宽；演示书三页图合计 **11.5 MB**，
 *   那是评委点开"看一本成品"第一眼看到的东西。让浏览器把原图拉下来只为显示
 *   一个小方块，是把等待转嫁给最不该等的那个人。
 *
 * ## 档位是写死的五个，`?w=` 不接受任意宽度
 *
 * 症状说清楚：如果接受任意 `?w=731`，缓存键就跟着 URL 一起无限增长——
 * 自己给自己做的一次磁盘 DoS，而且每个新宽度都要再跑一遍 sharp（实测 60–600ms）。
 * 所以传进来的值**向上取到最近的一档**（`?w=480` → 512），
 * 界面上想要多大用 CSS 摆，别拿去当缩放参数。
 *
 * | 档 | 用在哪 | 实测体积（q78 WebP） |
 * | --- | --- | --- |
 * | 240 | 主页那颗「小主角」胶囊的头像 | 卡图 10 KB |
 * | 384 | 列表里的缩略（目前没有消费者，留着是因为下一档跳得太远） | 卡图 13 KB |
 * | 512 | 卡片墙上被点开的那张？——也还没有消费者 | 卡图 29 KB |
 * | 768 | 卡片墙（显示 372px × 2 倍屏 = 744） | 卡图 73 KB / 页图 102 KB |
 * | 1024 | 阅读器的一页（显示约 700px） | 卡图 116 KB / 页图 159 KB |
 *
 * ★ 原图永远是记录（ADR-0007：参考图是"画的与查的同源"那份依据）。
 *   缩略图是**派生物**，删了能重算，所以它不进清单、不进指纹、不参与一致性核对。
 */

import sharp from 'sharp'

export const THUMB_WIDTHS = [240, 384, 512, 768, 1024] as const
export type ThumbWidth = (typeof THUMB_WIDTHS)[number]

/** 与 `scripts/make-webp.py` 同一档质量——两条路出的图不该看起来不一样 */
export const THUMB_QUALITY = 78

/**
 * 阅读器那一页用哪一档。★ 一个数写在两处用：`/api/assets` 的现缩与
 * `export-demo-book.mts` 给静态演示图预生成的 `.webp` 兄弟文件——
 * 两处各写一遍，早晚会变成"演示那台与原图那台清晰度不一样"。
 */
export const READER_PAGE_WIDTH = 1024

/** 资产根里放缩略图的前缀。与 `cards/`、`books/` 平级，是**派生**内容 */
export const THUMB_PREFIX = 'thumbs/'

/** 只有这几种能缩。★ 音频与 JSON 不在话下：给 mp3 做"缩略图"是胡话 */
const RESIZABLE = new Set(['png', 'jpg', 'jpeg', 'webp'])

export function isResizableImage(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return RESIZABLE.has(name.slice(dot + 1).toLowerCase())
}

/**
 * `?w=` → 一个合法的档，或者 null（= 不缩，回原图）。
 *
 * 不在档上的值**向上取最近的一档**：宁可给多几个像素，也不要给一张糊的。
 * 非法值（0、负数、非数字、比最大档还大）一律 null——那是要么是写错了要么是想试探，
 * 两种都不该拿原图当奖励，也不该拿一个离谱的键去写缓存。
 */
export function thumbWidthOf(raw: string | null | undefined): ThumbWidth | null {
  const text = (raw ?? '').trim()
  if (text === '') return null
  const wanted = Number(text)
  if (!Number.isFinite(wanted) || wanted <= 0) return null
  for (const width of THUMB_WIDTHS) {
    if (wanted <= width) return width
  }
  return null
}

/** 缓存键。带原图的路径与宽度；原图自己的文件名里已经有内容指纹，所以它变了键就变 */
export function thumbKeyOf(relative: string, width: ThumbWidth): string {
  return `${THUMB_PREFIX}${width}/${relative}.webp`
}

/**
 * 真缩一次。`withoutEnlargement`：★ 绝不放大——源图比档位还窄时按原样出，
 * 补不回来的像素放大只会把"小"变成"更贵的糊"（与 make-webp.py 同一条纪律）。
 */
export async function renderThumb(bytes: Uint8Array, width: ThumbWidth): Promise<Uint8Array> {
  const out = await sharp(Buffer.from(bytes))
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer()
  return new Uint8Array(out)
}
