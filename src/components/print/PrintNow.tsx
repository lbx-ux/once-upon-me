'use client'

/**
 * PrintNow —— 那一颗「打印 / 存成 PDF」，以及自动弹一次（2026-10-29）
 *
 * 这一屏的"导出 PDF"走的是浏览器自己的打印（`@media print` + `@page A4 landscape`），
 * 不引 PDF 库：运行期直接依赖只有五个（README §四），多一个库换来的只是
 * "把字体与图重排一遍"——而浏览器本来就会做这件事，中文还能正确嵌进去。
 * 代价说清楚，写在 `print-book.css` 与 `docs/known-tradeoffs.md` 里：
 * 产物是"打印对话框里的另存为 PDF"，不是一个后台生成的下载链接。
 *
 * 两条判断
 *
 * 1. **图与字体都到位了才让点。**
 *    `window.print()` 不会等图：没加载完就打印，出来的是几张空纸。
 *    所以按钮先是「正在等图片…」，`img.decode()` 全落地（含 404——那种 reject 也算落地）
 *    与 `document.fonts.ready` 都过了才可用。★ 这句"等"是真的在等，不是装饰：
 *    一本书十几张图、单张 2 MB 上下，这个等待肉眼可见。
 * 2. **自动弹打印只认 `?auto=1`。**
 *    直接访问这一屏（例如从地址栏、从探针）只铺开纸，不弹对话框——
 *    弹窗拦在一次"我只是想看看"的路上是一种冒犯；而从阅读器那颗按钮进来时
 *    带着 `auto=1`，该弹。
 */

import { useEffect, useState } from 'react'

export default function PrintNow({ auto }: { auto: boolean }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let gone = false
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.print-book img'))
    const settled = images.map((image) =>
      image.complete ? Promise.resolve() : image.decode().catch(() => undefined),
    )
    Promise.all(settled)
      .then(() => document.fonts?.ready)
      .then(() => {
        if (!gone) setReady(true)
      })
      .catch(() => {
        if (!gone) setReady(true)
      })
    return () => {
      gone = true
    }
  }, [])

  useEffect(() => {
    if (!auto || !ready) return
    // 留一帧给上面那次 `setReady` 的重渲染，再弹（否则对话框里可能还是"正在等"那一版）
    const timer = setTimeout(() => window.print(), 150)
    return () => clearTimeout(timer)
  }, [auto, ready])

  return (
    <button
      type="button"
      className="print-page__go"
      disabled={!ready}
      onClick={() => window.print()}
    >
      {ready ? '打印 / 存成 PDF' : '正在等图片…'}
    </button>
  )
}
