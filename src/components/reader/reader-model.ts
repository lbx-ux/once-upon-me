/**
 * reader-model.ts —— 阅读器的**页模型**（纯函数：没有 React、没有 DOM、没有磁盘）
 *
 * 这个文件存在的理由是一次返工：2026-10-15 发现阅读器把书翻成了
 * **左右各一张不同的图**，而产品要的是首页那样——一张 3:2 的横图在书脊处切开、
 * 画面是连着的，正文只叠在左半。
 *
 * ★ 值得记一笔的是**翻页几何一直是对的**（`flip.ts` 一个字没改），错的是
 *   "每一面装什么"。而这类错没有任何闸门拦得住：类型对、lint 过、几何自检也过，
 *   只有人翻开看一眼才知道不对。所以把那条关系从组件里抽出来，变成能断言的四句话：
 *
 *   1. 一页 = 一个跨页 = **一张**图：同一个 opening 的左右半是**同一张图的同一份**，
 *      两个面指着同一个 `page`（挂反了/挂成两张图，这条就红）
 *   2. 正文只跟**左半**走（右半再出一遍就是同一句话印两遍）
 *   3. 封面与封底**不是页**：页码用 `null` 说，不是 0 / `pages.length` 那种哨兵值
 *      （封底那个哨兵**恰好等于最后一页的页码**，于是"停在封底"会被下游读成
 *       "在第 P 页"——朗读按钮亮着、阅读时长记到最后一页上）
 *   4. 叶数 = 页数 + 1（flip.ts 的叶表：N 个跨页要 N+1 叶）
 */

import type { ReaderPage } from '@/lib/book-source.ts'

export type FaceHalf = 'left' | 'right'

/**
 * 一面装什么。★ **半页是一个面**，不是一整页：
 * 翻开一屏看到的是一张图的两半，不是两张图。
 */
export type ReaderFace =
  { kind: 'cover' } | { kind: 'back' } | { kind: 'art'; page: ReaderPage; half: FaceHalf }

/** P 页 → P+1 叶。叶 k 的正面是 `faces[2k]`、背面是 `faces[2k+1]`（见 flip.ts） */
export function leafCountOf(pages: readonly ReaderPage[]): number {
  return pages.length + 1
}

/**
 * 页 → 面表：封面 + 每一页的左右半（左在前、右在后）+ 封底。
 *
 * 顺序不能改：跨页 k 的**左**半挂在 L(k−1) 的背面（面号 2k−1）、**右**半挂在
 * L(k) 的正面（面号 2k）。左右对调的症状是"跨页中缝处画面接不上"。
 */
export function readerFaces(pages: readonly ReaderPage[]): ReaderFace[] {
  const faces: ReaderFace[] = [{ kind: 'cover' }]
  for (const page of pages) {
    faces.push({ kind: 'art', page, half: 'left' }, { kind: 'art', page, half: 'right' })
  }
  faces.push({ kind: 'back' })
  return faces
}

/**
 * 这一面属于第几个"打开"：0 = 封面，1…P = 第 1…P 页，`leafCount` = 封底。
 *
 * ★ 它 = `ceil(面号 / 2)`，这是叶表的直接推论（跨页 k 的两半在面号 2k−1 与 2k，
 *   恰好是同一个 ceil）。挂图的窗口按**它**算而不是按叶号：同一页的左右半在两片
 *   不同的叶上，按叶号判会让右半先于左半消失（翻到下一页时右边先空掉，像图坏了）。
 */
export function openingOf(faceIndex: number): number {
  return Math.ceil(faceIndex / 2)
}

/** 这一面要不要出正文。**只出在左半**——两半是同一张图，两边都出就是同一句印两遍 */
export function showsText(face: ReaderFace): boolean {
  return face.kind === 'art' && face.half === 'left' && face.page.body.length > 0
}

/** 底部那行页码。`page: null` = 现在这一屏不是页（封面 / 封底） */
export type Readout = { label: string; page: number | null }

export function readoutOf(q: number, pages: readonly ReaderPage[]): Readout {
  const leafCount = leafCountOf(pages)
  const near = Math.round(q)
  if (near <= 0) return { label: '封面', page: null }
  if (near >= leafCount) return { label: '封底', page: null }
  const page = pages[near - 1]
  // 走到这儿说明 q 越界或页表比叶数短（只可能是调用方传错了），照实说出来
  if (!page) return { label: `第 ${near} 页`, page: null }
  return { label: `第 ${page.pageNo} 页`, page: page.pageNo }
}
