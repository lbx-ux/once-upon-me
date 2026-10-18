/* 由 scripts/sample-tints.py 生成 —— 不要手改，改了图就重跑脚本。
 *
 * 每一面跨页的三个主色，给"背景被当前页染一层色"用（见 storybook-flip.css §1.6）。
 * 键是站点 URL，值是三朵主色，**按彩度（最大通道 − 最小通道）从高到低**排。
 * CSS 那侧的固定读法是：前两朵做有色的两团、最后一朵做**外圈底色**。
 * ★ 原来这句写的是「最白的那朵在最后」——2026-10-18 量出来它是**取样结果、不是保证**：
 *   灵感书单那 108 张里有 **30 张**的第三朵是一支中调色（castle 的封面就是
 *   `#a9805a` 那种褐）。所以这一朵要读作「彩度最低的那一朵」，
 *   **不要**读作「最白的那个」——照后者写 CSS，那 30 张的外圈就是一块比预期重的色。
 *   想保证外圈一定浅，得给这一朵再混一次底（`color-mix`）；那是另一件事，没有做。
 *   （首页那 6 张正好条条都落在"最白"，所以这个说法一直没人发现是句过誉。）
 * 取色口径与阈值降级规则写在脚本的 docstring 里，重跑一次就能复现下面每一个数：
 *
 *     python -I scripts/sample-tints.py public/book/cover.webp public/book/spread-*.webp --out src/components/book/spreadTints.ts
 */

export const SPREAD_TINTS: Record<string, readonly [string, string, string]> = {
  '/book/cover.webp': ['#d7cc89', '#b39069', '#fdf9e0'],
  '/book/spread-1.webp': ['#eae49d', '#bbc687', '#fdfef8'],
  '/book/spread-2.webp': ['#afa778', '#d7eef3', '#fefff9'],
  '/book/spread-3.webp': ['#cbd8db', '#fdfdf4', '#e4e7e2'],
  '/book/spread-4a.webp': ['#d5ccaf', '#d4ecef', '#eff9f4'],
  '/book/spread-4b.webp': ['#d0ccb0', '#fefce4', '#d4e1d6'],
}
