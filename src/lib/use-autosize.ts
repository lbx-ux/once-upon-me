'use client'

/**
 * use-autosize.ts —— 输入框自己长高，不让家长去拖右下角那个把手
 *
 * ```tsx
 * const ref = useRef<HTMLTextAreaElement>(null)
 * useAutosize(ref, node.body.join('\n'))
 * return <textarea ref={ref} rows={2} value={…} />
 * ```
 *
 * 2026-10-18 用户原话：「这个生成的文本长了，就自己适应一下，把这个文本框拉长，
 *   这件事不要让用户去做」。在那之前故事闸门每一格都是 `rows={2}` 固定两行 +
 *   `resize: vertical`——模型写四句正文，家长读到的是一格带滚动条的框，
 *   而要读完得自己拖着它长高。模型写多长不是家长能预知的，所以这件事只能由框自己做。
 *
 * 为什么不用 `field-sizing: content`（CSS 那一行就能干这件事）：它到今天仍然
 *   只有 Chromium 实现（Safari / Firefox 都不认），而不认的时候症状是那两行照旧
 *   ——不会报错、不会降级出滚动条，只是这件事没发生。一个"在某些浏览器上静悄悄不生效"
 *   的写法，比一个到处都生效的 15 行 hook 难查。
 *
 * 为什么 `useLayoutEffect` 而不是 `useEffect`：`useEffect` 在浏览器画完这一帧之后
 *   才跑，于是每次改一个字都会先看见一次"旧的矮框"再跳成高的（长文本上很明显）。
 *   这个坑在这个仓库里出现过一次同类（`useEnterTimeline` 的文件头写着"晚一帧就是闪一下"）。
 *
 * `rows={2}` 仍然要留着：它是没有 JS 时的那个高度（服务端先渲染出来的 HTML 就是这样），
 *   而不是一个随便的兜底。所以别把 `rows` 删成 1 ——那会让首屏那一瞬间变成一条缝。
 *
 * ★ 2026-10-18 当天第二遍（用户："就不要右边这个滑动的了"）："装得下"不等于"不出现滑轨"。
 *   第一遍验的是 `clientHeight >= scrollHeight - 1`，而那 1px 的容差正好把问题盖住——
 *   换成"框绝不需要滑轨"之后，两行那一格原来是短 0.3px 的，见 `fit()` 里那一段注释。
 *   重现（无头 Chrome + 直连 CDP，不用登录）：`.out/probe-autosize.mjs`。
 */

import { useLayoutEffect, type RefObject } from 'react'

/**
 * 让 `ref` 指着的那个 `<textarea>` 高到装下全部内容。
 *
 * 量法与单位都在这一行里，改它之前先读这三句：
 *   1. `height = 'auto'` 先松开旧高度，否则 `scrollHeight` 量到的是上一次设的那个高
 *      （框只会越长越高，删掉几行它也不会缩回去——那是这个 hook 最容易写错的一处）；
 *   2. 全站的 `box-sizing: border-box` 来自 Tailwind preflight，于是 `height` 里
 *      含边框，而 `scrollHeight` 只算到 padding——不加那圈边框的宽度，
 *      每一格都会永远差 2px（内容最下面那半行被切掉，而滚动条又不出现）；
 *   3. 只会调两次 `getComputedStyle`（一次），没有 ResizeObserver：
 *      观察自己的高度会绕成"我改高度 → 观察者触发 → 我再改"的死循环，
 *      而真正需要重算的外因只有宽度变了（换行位置变了行数才变），所以听 `resize` 就够。
 */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = (): void => {
      el.style.height = 'auto'
      const style = getComputedStyle(el)
      const border =
        (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
      /* 半像素那一刀（2026-10-18 第二遍，用户："我的意思是每次都把文字铺满文本框，
         就不要右边这个滑动的了"）。第一遍写的是一句 `height = scrollHeight + border`，
         而那正是压在边界上的一个数：
           · `scrollHeight` 与 `clientHeight` 都只能是整数，而这一格的内容高度天生
             带小数——`line-height: 1.7 × 14.5px = 24.65px`，两行正文就是 49.3px；
           · 实测（`.out/probe-autosize.mjs`）两行那一格：框高 67px，内容要 67.3px
             ——短 0.3px，而两个读数把它吞成了 65 = 65；
           · 同一个探针里把那一格调矮 1px（66px）：`scroll 65 > client 64`，
             滑轨当场出现，宽 15px。也就是说"没有滑轨"与"有一根 15px 的滑轨"
             之间只隔 1px，而 `scrollHeight + border` 正好把框放在这条线上——
             整数化往上取的那个引擎（另一版 Chromium、另一个缩放比、
             另一套字体度量）就跨过去了。这就是"我这儿看不见、他那台机器上有"的来源。
          所以这里补 1px：一格的 1px 看不出来，而一根 15px 的滑轨很显眼，
            还把正文挤窄（挤窄之后那些字重新断行，更多格子跟着长高）。
            判据从"框变高了"换成"框绝不需要滑轨"，见下面那个 while。 */
      el.style.height = `${el.scrollHeight + border + 1}px`
      /* 兜底：还有比 1px 更大的差时（网页字体后到、度量变了、宽度当场变了），
         让浏览器自己说还差不差，差就再补。退出条件是"它说不再需要滑轨"，
         不是再猜一个数——猜出来的数正是这一处第一遍踩的坑。 */
      let guard = 0
      while (el.scrollHeight > el.clientHeight && guard < 4) {
        el.style.height = `${(parseFloat(el.style.height) || 0) + 1}px`
        guard += 1
      }
    }
    fit()
    // 窄屏那一档（`story-sheet.css` 的 760px 断点）会让同一个字段换一种断行，
    // 于是"几行"当场变了——不重算的话，转一下屏幕就有一格又被切掉
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [ref, value])
}
