/**
 * asset-url.ts —— 资产路径 → 浏览器能用的 URL（一个函数，两个消费者）
 *
 * 落盘的图与清单都在资产根下（`books/<id>/page-1-a1.png`、`cards/<id>/ref.<指纹>.png`…），
 * 它们**不在 `public/` 里**，所以浏览器拿不到，必须经 `/api/assets/...`。
 *
 * 只有一个函数，因为只有一条查找顺序：工单 06 的阅读器还要加"预生成演示书"
 *   这第二个来源（`public/demo/`），那时扩展的也是这一个函数——
 *   页面里各写一遍"先查哪儿再查哪儿"，就是两份迟早会漂的真相。
 */

/**
 * 资产路径 → URL 的那一段编码：逐段编码（路径里可能有中文——主题名进了目录名就会），
 * 但不该整段编码掉斜杠。
 *
 * 2026-10-18 抽出来，因为静态演示资产（`/demo/...`）那两个出口也要同一段：
 *   原来是 `asset-url.ts` 与 `book-source.ts` 各写一份三行的，示例卡一来就是第三份。
 *   三份"逐段编码"里任一份写漏（比如整段编码，或者忘了过滤空段），
 *   症状都是"看着像路径不对，其实是一个 %2F"。
 */
export function encodeAssetPath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** 资产路径 → URL。
 *
 * `width` 是想要的近似宽度，不是一个档号——档位是一张封闭表，
 * 权威在服务端（`lib/thumbs.ts` 的 `thumbWidthOf` 会把它向上归到最近的一档）。
 * 所以界面层写 768 还是 700 都不会错，写错了也只是拿到更大的一档，
 * 不会像"客户端自己拼 `?w=` 拼出一个没人认的宽度"那样静默回原图。
 *
 * 只有走这条出口的资产能缩。`public/demo/` 下那批静态文件对查询字符串一无所知，
 *   给它挂 `?w=` 会静悄悄把原图发出去（一个骗人的优化比不优化更糟）；
 *   那批走的是另一条路：导出时预生成 `.webp` 兄弟文件，见 `book-source.ts`
 *   与 `card-source.ts`。
 */
export function assetUrlOf(path: string, width?: number): string {
  const encoded = encodeAssetPath(path)
  return width ? `/api/assets/${encoded}?w=${width}` : `/api/assets/${encoded}`
}
