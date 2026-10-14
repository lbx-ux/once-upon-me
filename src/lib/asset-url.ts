/**
 * asset-url.ts —— 资产路径 → 浏览器能用的 URL（一个函数，两个消费者）
 *
 * 落盘的图与清单都在资产根下（`books/<id>/page-1-a1.png`、`cards/<id>/ref.<指纹>.png`…），
 * 它们**不在 `public/` 里**，所以浏览器拿不到，必须经 `/api/assets/...`。
 *
 * ★ 只有一个函数，因为只有一条查找顺序：工单 06 的阅读器还要加"预生成演示书"
 *   这第二个来源（`public/demo/`），那时扩展的也**是这一个函数**——
 *   页面里各写一遍"先查哪儿再查哪儿"，就是两份迟早会漂的真相。
 */

/** 资产路径 → URL。逐段编码：路径里可能有中文（主题名进了目录名就会），但不该整段编码掉斜杠 */
export function assetUrlOf(path: string): string {
  const encoded = path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `/api/assets/${encoded}`
}
