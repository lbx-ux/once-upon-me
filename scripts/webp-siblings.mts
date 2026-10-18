/**
 * webp-siblings.mts —— 演示资产导出时预生成的 `.webp` 兄弟文件（两个导出脚本共用）
 *
 * 为什么要有它：`public/` 下的静态文件走不到 `/api/assets?w=`——Next 直接发盘上的字节，
 * 查询字符串它看不懂，挂个 `?w=` 上去会**静悄悄回原图**（一个骗人的优化比不优化更糟）。
 * 所以演示资产在**导出时就预生成**一份小的，运行期由 `book-source.ts` / `card-source.ts`
 * 在"磁盘上有兄弟文件"时优先用它。★ 原图仍然留在目录里：它是清单指的那份记录，
 * 小的那份只是给人看的那一层。
 *
 * ★ 为什么抽成一个模块，而不是各写一份：演示书（`.png`，1024 档）与示例卡
 *   （`.jpg`，768 档）只差**扩展名**与**档位**两个参数，而"缩成什么样"在两边必须逐字一样
 *   （同一个 `THUMB_QUALITY`、同一条 `withoutEnlargement`）。两份实现漂开的那天，
 *   症状是同一屏上两张演示图清晰度不一样——而那种差异没有人会去查。
 */

import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import sharp from 'sharp'

import { THUMB_QUALITY } from '../src/lib/thumbs.ts'

export type WebpSiblingReport = {
  /** 生成了几个兄弟文件 */
  made: number
  /** 这些源图原本合计多少字节 */
  sourceBytes: number
  /** 生成出来的兄弟文件合计多少字节 */
  webpBytes: number
}

/**
 * 给 `dir` 里**每一张** `extensions` 里的图生成一个同名 `.webp` 兄弟文件。
 *
 * 名字按"把最后那一段扩展名换成 `.webp`"来定——与运行期找它时的换法是同一个
 * （`book-source.ts` 的 `demoAssetPathFor`、`card-source.ts` 的 `demoCardPathInPublic`），
 * 两边对不上的症状是"明明生成了，界面上还是拉的 327 KB 原图"。
 *
 * `withoutEnlargement`：★ 绝不放大——源图比档位还窄时按原样出。这一条与
 * `thumbs.ts` 的 `renderThumb`、`make-webp.py` 是同一条纪律，三处一个理由。
 */
export async function writeWebpSiblings(
  dir: string,
  { width, extensions = ['.png'] }: { width: number; extensions?: readonly string[] },
): Promise<WebpSiblingReport> {
  const isSource = (name: string): boolean =>
    extensions.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase()))

  let made = 0
  let sourceBytes = 0
  let webpBytes = 0
  for (const name of await readdir(dir)) {
    if (!isSource(name)) continue
    const source = join(dir, name)
    sourceBytes += (await stat(source)).size
    const out = await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer()
    webpBytes += out.length
    await writeFile(join(dir, name.replace(/\.[^.]+$/, '.webp')), out)
    made += 1
  }
  return { made, sourceBytes, webpBytes }
}
