/* 由 scripts/sample-tints.py 生成 —— 不要手改，改了图就重跑脚本。
 *
 * 每一面跨页的三个主色，给"背景被当前页染一层色"用（见 storybook-flip.css §1.6）。
 * 键是站点 URL，值是三朵主色，**按彩度从高到低**排（最白的那朵在最后）：
 * CSS 那侧固定读法 = 前两朵做有色的两团、最后一朵做外圈底色。
 * 取色口径与阈值降级规则写在脚本的 docstring 里，重跑一次就能复现下面每一个数：
 *
 *     python -I scripts/sample-tints.py public/book/cover.webp public/book/spread-*.webp \
 *         --out src/components/book/spreadTints.ts
 */

export const SPREAD_TINTS: Record<string, readonly [string, string, string]> = {
  '/book/cover.webp': ['#d7cc89', '#b39069', '#fdf9e0'],
  '/book/spread-1.webp': ['#eae49d', '#bbc687', '#fdfef8'],
  '/book/spread-2.webp': ['#afa778', '#d7eef3', '#fefff9'],
  '/book/spread-3.webp': ['#cbd8db', '#fdfdf4', '#e4e7e2'],
  '/book/spread-4a.webp': ['#d5ccaf', '#d4ecef', '#eff9f4'],
  '/book/spread-4b.webp': ['#d0ccb0', '#fefce4', '#d4e1d6'],
}
