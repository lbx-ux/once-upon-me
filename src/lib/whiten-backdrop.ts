/**
 * whiten-backdrop.ts —— 把标准像的底压成纯白（2026-10-16 第 23 刀）
 *
 * 为什么需要它：提示词逼不到纯白
 *
 * 用户的要求是"生成的人物也要是白底的"——卡片墙上一排三张，
 * 演示卡（`public/demo/cards/`，手工出的）是 `#FFFFFF`，现场生成的是暖米色。
 * 提示词改过一轮（`character-sheet.ts` 的【构图】段，见工单 03 第 21 刀），
 * 底色从 `#F2E1CC`（四角通道极差 38）退到 `#F7F7F3`（极差 5）——
 * 方向对了，但到不了 255：`wan2.7-image` + 这套水彩风（「可见纸质纹理」）
 * 把背景当水彩纸，会染上一点纸色。两次生成分别是 `#F7F7F3` 与 `#F7F9F1`，
 * 那是它的地板，不是措辞不够狠（`scripts/probe-portrait-background.mts` 量的）。
 *
 * 所以这一步不再指望模型：出图之后把背景真正刷白。
 *
 * 只刷"从四边连通"的那一片
 *
 * 从四条边往里泛洪，只吃近白的像素，吃到不白的地方就停。
 * 这一条不是省事，是安全：人物的内部（白衬衫的高光、眼睛里的白点）被轮廓封住，
 * 与画面边框不连通，泛洪到不了——这正是 `docs/figure-art-prompts.md` §二
 * 记的那条判断（"被轮廓封住的白高光不与画面边框连通"），抠图脚本靠的也是它。
 * 换成"全图把所有近白像素刷成白"，那些高光会被一起吃掉。
 *
 * 只认 PNG
 *
 * 输出按 PNG 无损写回。收到别的格式（比如某家模型回 JPEG）时原样返回——
 * 重编码 JPEG 会掉画质，而这个项目为"重编码会剪断证据链"付过学费
 * （`scripts/make-demo-cards.mts` 文件头那条 C2PA 的教训）。
 * 那一刻底色就还是模型给的那个，`scripts/probe-portrait-background.mts` 量得出来。
 */

import sharp, { type Channels } from 'sharp'

/**
 * 「这是纸，不是画」的判据：三通道极差 ≤ 16 且最小值 ≥ 235。
 *
 * 这两个数是从实测读数里挑的，不是随手写的（`probe-portrait-background.mts`）：
 *   模型给的底实测是 `#F7F7F3`（极差 4、最小 243）与 `#F7F9F1`（极差 8、最小 240），
 *   两张都要落进来；而人物的浅色衣服（实测那件牛仔外套的浅蓝约 200 上下）
 *   要落在外头。★ 门槛不放宽到暖米色那一档（`#F1E0CB`，极差 38、最小 203）：
 *   那种整片米底是旧提示词的产物，出现它说明别的地方不对，不该被这一步糊过去。
 */
const PAPER_SPREAD = 16
const PAPER_MIN = 235

export type WhitenResult = {
  /** 要写进卡里的字节。★ 一个像素都没改时就是传进来的那个字节（不重编码） */
  bytes: Uint8Array
  /** 刷白了多少个像素 */
  changed: number
  /**
   * 这一步跑起来了吗。false = 字节原样放回，两种情形：
   * ① 不是 PNG（见文件头"只认 PNG"）；② 这些字节 sharp 根本读不了
   * （单测里那些假字节就是这种）——★ 这一步是修饰，不是判据：
   * 图本身合不合法由卡那一层说，不该由"刷底"把一个请求整个弄失败。
   */
  applied: boolean
}

/**
 * 出图结果的整份（字节 + mime + modelId + …）→ 底刷白之后的那一份。
 *
 * 留着 `modelId` 这些字段一起带过去：卡上记的是"哪个模型画的"，
 *   刷底这一步不改变这个事实——画画的是它，改底的是我们。
 *   （要让 provenance 说得更细，那得给卡加一个字段，不在这一刀里做。）
 * 没改任何像素时原对象原样返回：调用方拿到的字节还与模型给的一模一样。
 */
export async function whitened<T extends { bytes: Uint8Array; mime: string }>(
  generated: T,
): Promise<T> {
  const { bytes } = await whitenBackdrop(generated.bytes, generated.mime)
  return bytes === generated.bytes ? generated : { ...generated, bytes }
}

function isPaper(data: Uint8Array, offset: number): boolean {
  const r = data[offset] ?? 0
  const g = data[offset + 1] ?? 0
  const b = data[offset + 2] ?? 0
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max - min <= PAPER_SPREAD && min >= PAPER_MIN
}

export async function whitenBackdrop(bytes: Uint8Array, mime: string): Promise<WhitenResult> {
  if (!mime.includes('png')) return { bytes, changed: 0, applied: false }

  let data: Buffer
  let width: number
  let height: number
  /** 类型用 sharp 自己的 `Channels`（1|2|3|4）：下面按 `raw` 回写时它要这个 */
  let channels: Channels
  try {
    const decoded = await sharp(Buffer.from(bytes))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    data = decoded.data
    width = decoded.info.width
    height = decoded.info.height
    channels = decoded.info.channels
    if (width === 0 || height === 0) return { bytes, changed: 0, applied: false }
  } catch {
    // 读不了就原样放回（理由见 `applied` 那一段）
    return { bytes, changed: 0, applied: false }
  }

  /** 已经吃过的像素。★ 不能用颜色判断"吃没吃过"——吃完就是白的，与原本就白的像素一样 */
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const at = y * width + x
    if (seen[at] === 1) return
    if (!isPaper(data, at * channels)) return
    seen[at] = 1
    stack.push(at)
  }

  // 四条边全部入队（不是四个角）：底可能是"中间被人物挡住"的一片
  for (let x = 0; x < width; x += 1) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y)
    push(width - 1, y)
  }

  let changed = 0
  while (stack.length > 0) {
    const at = stack.pop()
    if (at === undefined) break
    const x = at % width
    const y = (at - x) / width
    push(x - 1, y)
    push(x + 1, y)
    push(x, y - 1)
    push(x, y + 1)
    const offset = at * channels
    if (data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255) continue
    data[offset] = 255
    data[offset + 1] = 255
    data[offset + 2] = 255
    changed += 1
  }

  if (changed === 0) return { bytes, changed: 0, applied: true }

  const out = await sharp(data, { raw: { width, height, channels } })
    .png({ compressionLevel: 9 })
    .toBuffer()
  return { bytes: new Uint8Array(out), changed, applied: true }
}
