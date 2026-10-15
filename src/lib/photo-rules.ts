/**
 * photo-rules.ts —— 「用他的照片」这条路上**浏览器也读得到**的那部分：上限、同意的三条、判据
 *
 * ★ 为什么要与 `photo-card.ts` 分开：那一份 import 了 `sharp`（归一化在服务端做），
 *   而**界面必须在传之前就知道"这张太大了"**——让家长把 40 MB 传上来再收到一句
 *   "太大了"，是把一次本地判断换成一次网络往返。同一个函数的两个读者，
 *   所以判据只有这一份，`photo-card.ts` 从它 import，不另写。
 *
 * ★ 判据同源的另一半（不在这里重写）：
 *   `AGE_BANDS`（年龄档的合法值）与 `checkAnchors`（锚点完不完整）都从引擎 import。
 *   自己抄一遍的症状 `creation/state.ts` 的文件头写着——"表单里能选中的年龄档，引擎拒绝"。
 */

import { AGE_BANDS, type CharacterAnchor } from './engine/domain.ts'
import { checkAnchors } from './engine/character-card/card.ts'

/**
 * 上传上限。
 *
 * ★ 20 MB 是**两件事的交点**，不是随手取的圆整数：
 *   ① 手机直出的一张 JPEG 常见 3–8 MB，带 HDR 的能到 15 MB 上下；
 *   ② 归一化之后长边只有 1440，也就是说**再大的照片也不多带一点身份信息**，
 *      只是多占一次请求体的内存。所以上限该定"能收下真实手机照片"，
 *      而不是"越大越好"。
 * ★ 它拦的是"选错文件"：把一个 200 MB 的视频拖进来，要当场得到一句人话。
 *   工单 02 §五 6 记着"没有上传体积上限"这条欠账，这一条就是还它。
 */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024

/**
 * 同意框旁边那三条。★ 它是**文案的真身**：界面从它渲染，
 * 不许另抄一份（同 `DEFAULT_STYLE_LABEL` 那条纪律——抄一份就会漂，
 * 而这里漂掉的是一句对家长的承诺）。
 */
export const PHOTO_CONSENT_POINTS = [
  '只用来生成这本书的插画',
  '处理完就删——原图不进资产库，也不进日志',
  '不用于训练模型',
] as const

export type PhotoCardRequest = {
  childId: string
  name: string
  ageBand: string
  /** 由外貌标签推的称呼（小男孩/小女孩/孩子）。见 `creation/state.ts` 的 `childWordOf` */
  childWord: string
  anchors: readonly CharacterAnchor[]
  photo: Uint8Array
  /** 同意是**一次勾选**，不是一行灰字。没勾就走不到归一化 */
  consent: boolean
}

/**
 * 表单**在传之前**就能判的那几条。
 *
 * ★ 用的是 `photoBytes`（一个数）而不是字节本身：判据只需要一个大小，
 *   而界面那边拿到的是 `File.size`——**不必为了说一句"太大了"先把文件读进内存**。
 *   路由那边把 `photo.length` 传进来，两边因此共用同一条规则。
 */
export type PhotoFormInput = Omit<PhotoCardRequest, 'photo' | 'childId'> & { photoBytes: number }

/**
 * 「还没到能传的地步」的判据。空数组 = 可以。
 *
 * ★ 它被两处调用：**界面**（选完文件当场说出"太大/还没同意"）与**路由**
 *   （`photoProblems` 在它之上再加一条 childId 的检查）。同源，不是同一份代码写两遍。
 */
export function photoFormProblems(input: PhotoFormInput): string[] {
  const problems: string[] = []
  // ★ 这一条必须排在最前面。它是这一格的**存在理由**：没有同意，下面的字节不该被看
  if (!input.consent) {
    problems.push('还没勾选同意。这一格不勾就不能传照片——它不是形式，是这一格唯一的凭据')
  }
  if (input.name.trim() === '') problems.push('孩子的名字还没填')
  if (!AGE_BANDS.includes(input.ageBand as (typeof AGE_BANDS)[number])) problems.push('年龄档没选')
  if (input.photoBytes === 0) problems.push('还没有选照片')
  else if (input.photoBytes > MAX_PHOTO_BYTES) {
    problems.push(
      `这张照片 ${megaOf(input.photoBytes)}，超过了 ${megaOf(MAX_PHOTO_BYTES)} 的上限。` +
        `用手机相册里的原图就行，不用先裁剪或压缩。`,
    )
  }
  for (const problem of checkAnchors(input.anchors)) problems.push(`外貌锚点：${problem}`)
  return problems
}

/** 服务端那一次判据 = 表单那几条（带真正的字节）+ 那个只有服务端知道的 childId */
export function photoProblems(input: PhotoCardRequest): string[] {
  const problems = photoFormProblems({ ...input, photoBytes: input.photo.length })
  if (input.childId.trim() === '') {
    problems.unshift('孩子还没有编号（要先建档案，照片才能挂到他名下）')
  }
  return problems
}

export function megaOf(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
