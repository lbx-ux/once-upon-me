# 04 · 全页浮层：加一颗"回到页首"、去掉左下角那颗黑点

Status: done
Spec: ../spec.md
创建：2026-10-12（用户第 6 / 7 条要求）

## 6 · 右下角固定一个按钮，一键回到头部

新增 `src/components/BackToTop.tsx` + `back-to-top.css`，挂在 `page.tsx` 末尾。

- 滚过 **0.6 视口高**才升起来：在页首时"回到页首"是无意义按钮，还会压住首屏两句主张。
- 造型是一张纸（`#fffdf7` + 1px 极淡描边 + 紧投影），**不是深色实心圆** ——
  深色圆在 `#f7f7f8` 上是全页最重的元素，会抢视线。用户刚让我删掉左下角一颗黑圆点，
  再在右下角放一颗黑的就是左耳进右耳出。
- 48px 见方（过 44px 最小可点线），图标是内联 SVG 箭头不是 emoji。
- 藏起来写 `visibility: hidden`（与 `.book-choice` 同一条理由），
  组件侧再补 `tabIndex={-1}` 兜住淡出那 0.28s。
- `prefers-reduced-motion` 下不升起不淡出，滚动退回 `behavior: 'auto'`。

已知缺口（写在代码与 README 里，没藏）：按下去只滚不回焦点，
键盘用户的 Tab 序列还停在原处。补法要给首屏某元素加 `tabIndex={-1}` 再 focus，
那会改动已交付的 `HeroOrbit`，按「迁移单独一个提交」的纪律先记着。

## 7 · 左下角那颗黑球不是我们的东西

先 grep 再动手：`src/` 下所有 CSS 里 **`position: fixed` 与 `border-radius: 50%` 一个都没有**
（当时还没有 BackToTop，这一条现在也只有那一颗 fixed）。
所以那颗圆点不是这一页画的任何东西 —— 它是 **Next.js 15.5 自己的开发者工具指示器**
（`<nextjs-portal>`，只在 dev 下注入，生产构建里没有）。

改法：`next.config.ts` 里 `devIndicators: false`。

实测（1440×900）：关掉之后 `<nextjs-portal>` 这个元素**还在 DOM 里**，
但 host 与 `#devtools-indicators` 的 rect 都是 **0×0**，什么都不画。
所以"元素还在"不等于"没关掉"——这一条值得记，不然下次又会以为配置没生效。

★ 配置改动**要重启 dev server 才读得到**。用户那边 3000 端口上跑着的 server
不会自动生效，得重启一次。

## 验收

- [x] 三条闸门 + test + build
- [x] 浏览器实测：`.to-top` 已挂载；`nextjs-portal` rect = 0×0，`#devtools-indicator` rect = 0×0
- [ ] **BackToTop 的升起/淡出观感** —— 后台文档不画，测不了
- [ ] **用户那边重启 dev server 之后黑点是否真的没了** —— 不在本会话能验的范围
