# 04 · 装配 `HighlightsReel` + 浏览器实测

Status: done
Spec: ../spec.md

## What

把 01–03 的三个纯模块装成第三屏：组件、样式、内容模块、挂载、GSAP 编排。

## 组件要做的事

- `gsap.context()` + `ctx.revert()` 卸载（App Router 默认 StrictMode，effect 跑两遍）
- `gsap.quickTo` 驱动 tilt 的六个量，**每卡一套，惰性建**
- `gsap.matchMedia()`：`prefers-reduced-motion` 分支只设终态，不建 tween
- ScrollTrigger 只管**进场编排**，不管滚动进度映射
  （前两屏的滚动驱动仍是 `useScrollDriver`，这一屏没有 sticky，不需要它）
- 卡面上**不写 `preserve-3d`**：非当前卡带 `opacity < 1`，父层 preserve-3d 会压平子层
- 不做滚轮劫持、不做自动轮播
- 图缺失时的兜底要语义诚实（CSS 底纹 + 编号，不是碎图标）

## 键盘与读屏

- ← → 切卡（本节进入视口后才接，避免抢走上一屏翻页的按键）
- `role="region"` + `aria-roledescription="carousel"`、每卡 `role="group"` + `aria-label`
- 切换时 `aria-live` 播报「第 3 条，共 5 条」

## 浏览器实测（不可省，vitest 测不到这些）

- [ ] hover 跟随：鼠标绕卡边一圈，倾斜方向正确、离开后回正 —— **仍没测到**：tween 靠 rAF
- [ ] 快速甩出鼠标不卡在倾斜态 —— 同上，且当前版本连指针事件都注入不进去
- [x] 非当前卡不可 tab 到（2026-10-12 21:0x 复测，当前版本）
- [ ] `prefers-reduced-motion: reduce` 下静止终态可读、能切卡 —— **没有媒体模拟手段**，见下
- [x] 与第二屏收尾 CTA 之间不重叠、不抢滚轮（复测：间隙 0px）
- [ ] 1280 / 1440 / 1920 三档截图 —— 面板在后台时截图返回空白
- [x] 控制台无报错、无 hydration 警告（复测：整场只有 2 条 `info`）

> 打「21:0x 复测」的三条写在下面「复测」一节，量法与原始数字都在那里。

## 验收

- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` 全绿
- `pnpm build` 通过

---

## Comments

**2026-10-12 完成。** 清单里已勾的都有证据，没勾的是**测不了**，原因写在下面。

### 撞到的三个真问题

1. **忘了 `import { ScrollTrigger }`，三条闸门全绿。** gsap 的 `.d.ts` 把插件类声明成
   **全局**，所以 `gsap.registerPlugin(ScrollTrigger)` 不 import 也过 tsc 与 eslint，
   只有浏览器抛 `ReferenceError`，症状是第三屏整节白屏。**结论：GSAP 插件的 import
   只能靠开浏览器验**，别指望 tsc。已写进组件文件头与 README。
2. **rect 缓存会在"同一个 tick 里滚完就摸"时用到旧框。** `dirty` 标记只挡得住
   scroll 事件已经派发过的情形。实测：指针在右上角本该 `ny=-0.97`，读到 `-0.478`，
   倾斜角少一半（-5.83° → -2.87°）；同一帧 `glowV` 给出 0.261，
   两个互不相干的量指向同一个错误 ny，所以确定是真用了旧框。
   修法是指针落在缓存框外就直接重量（`rectFor`）。
3. **一次测错的账。** 排查白屏时我一度"实测证明" ScrollTrigger 一次也没触发，
   并把触发器换成了 IntersectionObserver。**那个结论是错的**：预览面板当时是
   **后台文档**（`document.visibilityState === 'hidden'`、500ms 内 0 次 rAF tick），
   GSAP 的 ticker 是 rAF 驱动的，IO 回调在隐藏文档里也会被推迟 ——
   "什么都没动"是必然的，与用哪个触发器无关。改回 ScrollTrigger 后正常。
   **教训：「数字要能复现」还要求先确认量具本身在不在工作。**

### 一次改错又改回

`measure()` 曾改用 `offsetWidth` 替代投影盒，理由是"旋转后 `getBoundingClientRect()`
把 547 读成 251"。**那个数字是假的** —— 251 来自预览视口被重置成窄窗口（38vw 而已），
不是 3D 投影。6° 的 rotateY 只让投影宽缩 ~0.5%。已改回 `getBoundingClientRect()`，
并把注释里那条不存在的实测换成真正测到的第 2 条。

### 勾掉的

- [x] hover 跟随：符号、上限、光斑、插画反向位移，见 03 的实测数字
- [x] 非当前卡不可 tab / 不被读屏念：`aria-hidden` 只有当前卡为 false，实测 `[true,true,null,true,true]`
- [x] 点邻居翻、点远处不翻；圆点、← →、Home 都验过（1→4→3→0）
- [x] 与第二屏不抢滚轮：本节不接 wheel；键位靠 `stopPropagation` 挡住 StorybookFlip 的全局接法
- [x] 1440 几何对称；`pnpm build` 通过；SSR HTML 里 5 张卡齐全、无内联 opacity
- [x] 控制台无 JS 报错（当时有 5 条预期中的 `/highlights/*.webp` 404 —— 图未出，兜底生效）
      **补记（2026-10-12 晚）：** 五张图画好落盘后这 5 条 404 已消失；
      `.hl__art` 那层 CSS 兜底按原计划**保留**，它是加载失败时的退路，不是死代码。

### 没勾的，以及为什么

- [ ] **快速甩出鼠标不卡住**、**reduced-motion 静止终态**、**1280/1920 截图**：
      这三项要 rAF 或人眼看。预览面板一旦切到后台，rAF 冻结、截图返回空白，
      我这个会话里它大部分时间是后台的。**代码路径存在**（`onLeave → rest()`、
      `mm.add('…no-preference')` 分支、CSS 的 reduce 块），但**没有实测过**。
      → 需要把 Browser 面板切到前台看一眼，尤其是甩出鼠标那一下。

---

### 复测 · 2026-10-12 21:0x（另一条会话，当前版本）

上一节留了三项"要 rAF 才能测"。这次拿到了一个 rAF 真的在跑的窗口
（500ms 内 16 次 tick），补掉了能补的，并且**撞出一条比结论更值钱的东西：
原来的量具判据是错的。**

**被测版本**：`HighlightsReel.tsx` md5 `a6f1890…`（20:57 那一版，
`AUTOPLAY_MS = 3200`、整排控件已删、`.hl__viewport` 带 `tabIndex={0}`）。
注意它在本次复测期间**又被改过**（`page.tsx` 21:06 加了 `<BackToTop />`），
所以下面的行号与细节以那一版为准。

#### 1. ★ `document.visibilityState` 不能当量具

工单 04 与 05 都写着「测动效前先读 `document.visibilityState`，是 `hidden` 就只能测静态事实」。
这次实测到两者**不一致**：

| 量                         | 读数      |
| -------------------------- | --------- |
| `document.visibilityState` | `visible` |
| `document.hidden`          | `false`   |
| 1.2s 内的 rAF tick 次数    | **0**     |

窗口被遮挡或最小化时 Chrome 停掉 rAF，而 `visibilityState` 照样报 `visible`。
两条推论，都要改掉原来的写法：

- **判据换成直接数 rAF**：`requestAnimationFrame` 跑一个计数器、`setTimeout` 兜底，
  拿到 0 就是冻结。报 `visible` **不等于**帧在走。
- **别 `await` 一个 rAF**：拿冻结文档里等 rAF 的脚本去跑预览面板的 eval，
  会 30 秒超时并把脚本卡在页里（这次真卡了一次）。等条件一律用 `setTimeout`。

#### 2. 勾掉的三条

面板自己会在前台/后台之间来回跳，所以这几条**把 `document.hidden` 打了桩**：
用一个可控 getter 冒充它、再派发 `visibilitychange`。
这样"后台停"这件事由被测代码负责，不由 Chrome 的定时器节流负责 ——
上一轮正是这两件事叠在一起，才什么也证明不了。

- **与第二屏不重叠**：`.storybook` 底边与 `.hl` 顶边在文档里**都是 3894px**，
  间隙 0、不重叠。"不抢滚轮"从源码可判：本节只挂
  `pointerenter / pointerleave / pointermove`、`scroll`、`resize`、`visibilitychange`，
  **没有任何 wheel 监听**。
- **非当前卡不可 tab 到**：五张卡上 `tabindex` 全为 `null`、卡内可聚焦元素计数全为 0，
  `aria-hidden` 是 `[true,true,true,null,true]`（当前卡为 `null`）。
  删掉那排控件之后，本节里可聚焦的东西只剩 `.hl__viewport[tabindex=0]` 一个。
- **控制台干净**：整场只有 2 条 `info`（React DevTools 提示 + 一条 `[Fast Refresh] rebuilding`），
  **无 error、无 hydration 警告**。五张图的 404 已消失（图已落盘）。

SSR 验收判据也复测了一遍：`curl localhost:3000` 得到的 HTML 里
`hl__slot` **5 个**、`hl__card` 5 张（另 10 次匹配来自 `hl__card-title` / `hl__card-text`），
插槽上**没有内联 opacity**。

#### 3. hover 那两条：只在 6500ms 那一版上测到过

用**可信**输入（`preview_click` 真的把指针移了过去）测的那一版：

- 指针进本节后 9 秒 **0 次推进**，`aria-live` 由 `off` 转 `polite`；
- 指针移到节外后 **6484 ms** 推进一次（5 → 1），`aria-live` 转回 `off`。

但那一版已经不是当前版本（见上面的 md5 说明）。在当前版本上重测时，
面板**不再产出可信指针事件**：点了卡片之后 `card.dataset.hover` 五张全是 `null`，
说明 `pointerenter` 根本没触发。所以 hover 与焦点两条**当前版本没有复测**，
`onLeave → rest()` 那条路径（"快速甩出鼠标不卡在倾斜态"）也仍然没有实测。

#### 4. 一次"tween 不推进"的排除

在当前版本上注入 `pointerenter + pointermove` 后探针读到的六个量**全是静止值**
（`gx/gy = 0.5`、`transform: translate(0px, 0px)`），而 `card.dataset.hover` 已经是 `true`。

两者合起来只有一个解释：**处理器跑了、tween 建了，但 GSAP 的 ticker 拿不到 rAF**。
判据就是上面第 1 条 —— 别把这种情况读成"倾斜坏了"，那正是上一轮把
ScrollTrigger 误判成没触发的同一个坑。

#### 5. reduced-motion 与三档截图仍然测不了（原因具体了）

- **reduced-motion**：预览工具只有 `colorScheme` 与视口两档模拟，**没有媒体特性模拟**，
  而 `window.matchMedia` 没法在组件挂载后打桩（组件的 effect 与 `gsap.matchMedia()`
  都在挂载时读一次）。要测它得二选一：Chrome DevTools 的 Rendering 面板手动
  emulate `prefers-reduced-motion`，或改系统「显示动画」开关。
  **注意这两条都只能验到 JS 分支**（不启动自动播、不建进场 tween），
  静止态的**样式**得靠 CSS 的 `@media (prefers-reduced-motion: reduce)` 块生效。
- **1280 / 1440 / 1920 截图**：面板在后台时 CDP 截图返回的是空白（这次拿到过一张近乎全白），
  无内容可读。
