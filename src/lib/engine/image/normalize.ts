/**
 * normalize.ts —— 把"家长手机里的那张照片"变成"参考图接口吃得下的那个形状"
 *
 * ★ 为什么归一化必须在服务端、必须在 provider 之前：
 *   上传物是外部输入——HEIC/JPEG/PNG、带旋转 EXIF、4000×3000、可能带 alpha、
 *   80 KB 也可能 12 MB。而下游那条参考图接口有一批硬条件要满足（尺寸上下限、
 *   压平 alpha、字段形状）。不先归一，这些条件就会以几种不同的 400 长回来，
 *   而每一个都要家长去猜"我这张照片哪里不对"。
 *
 * ★ 这些条件的**出处换过一次**（2026-10-21 换到阿里云百炼的 qwen-image-3.0），
 *   但规则本身一条没动——所以下面那张表里的理由按"现在这条判据是谁定的"重写了一遍：
 *   当时那家（tokenrhythm）的下限 240 与"不收带 alpha 的 PNG"是它的实测原文；
 *   这一家文档写的是宽高 1–8000（建议 384–2048）、长宽比 ≤10:1、≤10MB，**没提 alpha**。
 *   240 这条下限因此从"厂商要求"变成了**我们自己的产品决定**（短边更小的脸根本认不出），
 *   压平白底也变成"与卡片墙上那几张同一种底"（`whiten-backdrop.ts` 同源）。
 *   留着它们是对的：规则不变、理由换人，比跟着换家把整层重写一遍稳。
 *
 * 三条规则，与它们各自的理由
 *
 * | 规则 | 为什么这样做，而不是那样 |
 * | --- | --- |
 * | 短边 < 240 → 拒绝，不放大 | 静默放大交出一张糊的插画，比一句"照片太小"糟：前者家长要等到书做完才发现。这条现在是产品决定（见上） |
 * | 长边 > 上限 → 缩到上限 | 缩小不丢身份（锚点是脸/发型/比例），而 4000×3000 的手机原图会变成几 MB 的 base64 请求体 |
 * | 一律压平到白底（不管有没有 alpha） | 与卡片墙上那几张同一种底；只在该有 alpha 时才 flatten，等于把"这张图到底有没有 alpha"变成一个要信的前提 |
 *
 * `notes` 不是日志装饰，是给用户看的那句话的原料：
 *   "我们处理了你的照片"要能具体到做了什么（转了正、压平了、缩到多少），
 *   否则界面只能说一句空话。它同时进 `events.jsonl`，
 *   于是真出现 alpha 错误时，事件流里躺着那张图当时的形状。
 *   ★ 也正因为它是**给家长看的**，里面的理由必须说真话：这条曾经写着
 *   "接口明说不支持带 alpha 的 PNG"，而那句话是上一家的实测原文——换家之后它就不成立了。
 */

import sharp from 'sharp'

import { EngineError } from '../errors.ts'

/**
 * 短边下限。★ 出处换过一次（见文件头）：2026-10-13 那家服务端的原文是
 * "参考图宽高必须在 240～8000 像素之间"；2026-10-21 换到的这家文档写的是 1–8000
 * （建议 384–2048）。240 留着的理由是产品那一条：短边更小的脸，锚点根本读不出来。
 */
export const REFERENCE_MIN_SIDE = 240
export const REFERENCE_MAX_SIDE = 8000

/**
 * 默认长边上限。★ 1440 不是"越大越好"也不是随手取的：
 * 它是产品自己的出图尺寸（角色标准像与页图都是 1440），
 * 而实测通过的那次送的就是一张 1440² 的图——照已验证的形状送，不发明新形状。
 * 送更大的图只会把请求体撑成几 MB 的 base64，身份信息一个像素都没多。
 */
export const REFERENCE_DEFAULT_MAX_SIDE = 1440

export type NormalizedReference = {
  bytes: Uint8Array
  mime: string
  width: number
  height: number
  /** 逐条说人话：这张照片被做了什么。界面与事件流都消费它 */
  notes: readonly string[]
}

export type NormalizeOptions = {
  /** 长边上限，默认 1440（见 `REFERENCE_DEFAULT_MAX_SIDE` 那段）。不许超过服务端的 8000 */
  maxSide?: number
}

/**
 * @throws EngineError(`reference-invalid`) 图根本解不开、或短边小于 240。
 *   消息是给家长读的：说清是哪张照片不行、为什么、该怎么办，
 *   不出现"payload"、"downscale"这类只有我们看得懂的词。
 *   码是 `reference-invalid` 而不是 `card-invalid`：`provider-messages.ts` 按码分流，
 *   两者要给出不同的一句"你现在该做什么"（换一张照片 vs 改锚点）。
 *   合成一个码的代价实测过：家长会在"角色卡不合格，回到第 3 步改锚点"下面
 *   看到一句被括起来的"照片太小"——那句话是对的，但被放在"供排障的原文"里，
 *   而排在前面的那句在教他做一件与此无关的事。
 */
export async function normalizeReference(
  bytes: Uint8Array,
  opts: NormalizeOptions = {},
): Promise<NormalizedReference> {
  const maxSide = Math.min(opts.maxSide ?? REFERENCE_DEFAULT_MAX_SIDE, REFERENCE_MAX_SIDE)

  // EXIF 方向先转正：`rotate()` 无参 = 按 EXIF 自动旋转并把方向标记清掉。
  // 不转正的症状很具体：横拍的照片在参考图里是躺着的，模型照着躺着的画。
  const oriented = sharp(bytes, { failOn: 'none' }).rotate()

  // 只取这三个字段，所以类型也按这三个写：`sharp` 解不开一张坏图时给的是半个 metadata，
  // 硬套完整 `Metadata` 会让类型说"一定有宽高"，而这里恰恰要靠"没有"来判坏图
  let meta: { width?: number; height?: number; orientation?: number }
  try {
    meta = await oriented.metadata()
  } catch {
    meta = {}
  }
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (width === 0 || height === 0) {
    throw new EngineError(
      'reference-invalid',
      '这张照片打不开（可能不是图片，或者文件坏了）。换一张试试，或者重新拍一张。',
    )
  }
  if (Math.min(width, height) < REFERENCE_MIN_SIDE) {
    throw new EngineError(
      'reference-invalid',
      `这张照片太小了（${width}×${height}）——参考图短边至少要 ${REFERENCE_MIN_SIDE} 像素。` +
        `放大它只会画出一张糊的，所以这里直接不收。请换一张更大、更清楚的。`,
    )
  }

  const notes: string[] = []
  if (meta.orientation && meta.orientation !== 1) {
    notes.push(`按照片自带的方向转正了（EXIF orientation ${meta.orientation}）`)
  }

  const longest = Math.max(width, height)
  const scaled = longest > maxSide
  if (scaled) notes.push(`从 ${width}×${height} 缩到长边 ${maxSide}（原图太大，接口不收）`)

  // 无条件 flatten 到白底：见文件头那条规则的理由。
  // 输出固定 PNG——实测通过的那次送的就是 PNG，不在这里顺手换格式赌一把。
  const out = await oriented
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true })

  const after = out.info
  if (Math.min(after.width, after.height) < REFERENCE_MIN_SIDE) {
    // 到这一步只可能是"长边缩到上限之后短边掉下 240"——极长条形的图。
    // 与其送一张必 400 的，不如在这里说人话
    throw new EngineError(
      'reference-invalid',
      `这张照片太细长了（${width}×${height}）——缩到接口能收的尺寸后短边就不够 ${REFERENCE_MIN_SIDE} 像素了。` +
        `请把它裁成正方形一点的范围再传。`,
    )
  }
  notes.push('透明通道压平到白底（与卡片墙上那几张同一种底，见 whiten-backdrop.ts）')

  return {
    bytes: new Uint8Array(out.data),
    mime: 'image/png',
    width: after.width,
    height: after.height,
    notes,
  }
}

/** 归一后的字节 → data URL。参考图接口要的就是这个形状（两家都收 base64 data URL） */
export function referenceDataUrlOf(one: NormalizedReference): string {
  return `data:${one.mime};base64,${Buffer.from(one.bytes).toString('base64')}`
}
