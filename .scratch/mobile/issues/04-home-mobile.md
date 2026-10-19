# 04 · 首页三屏

Status: done

## 首屏：新的横向卡带

新 `src/components/hero/ThemeStrip.tsx` + `theme-strip.css`：

- 12 张用 `themeCardPath()`（已有的 `public/art-cards/`，320×180，全 12 张约 0.13MB），
  **不是**首屏那批 1280×720（合计 1.16MB）。
- `overflow-x: auto` + `scroll-snap-type: x mandatory` + 每张 `scroll-snap-align: center`，
  首尾各插一个 spacer 让第一张也能居中；图下一行小点报"第几张 / 共 12"。
- **零 JS**：没有 rAF、没有自转、没有手势代码。`prefers-reduced-motion` 天然满足
  （没有动效要停）。这条写进 `theme-strip.css` 文件头。
- 语义：`<ul>/<li>` + `<img alt={theme.label}>`，照 `HeroOrbit` 那条既有约定。

### 环与卡带怎么二选一

两个都渲染、用媒体查询二选一，并**把两边都压到可接受**：

- `.home-hero`（环那一层）在 `(max-width: 640px)` 下 `display: none`；
- 环里那 12 张 `<img>` 包一层 `<picture>`，加一条 `media="(max-width: 640px)"` 的
  `srcset` 指到 `art-cards/` —— **藏起来的图照样会被取**，这条 source 把它从 12×90KB
  压到 12×11KB，加起来比一张原图还小；
- `HeroOrbit` 的 `useEffect` 加**一条窄屏早退**：`matchMedia('(max-width: 640px)')` 命中
  就不挂 rAF、不挂 pointer 监听、不写内联 transform。省下的是一条常驻循环，比下载重。
  ★ 这打破组件头上那句"零断点"的契约 —— **同一次改掉那句话**并写明为什么这次可以
  （加的是"不跑"，不是"另一套布局"）。
- ★ 环那 12 张**不能改成 `loading="lazy"`**：README 写明它们**就是这一页的 LCP**。

### 接力

`lib/theme-handoff.ts` 的 `captureRing()` 量的是 `[data-orbit-index]` 的位置，手机上那些
卡片是 `display: none`（`getBoundingClientRect` 全 0）。文件头那张退化表里已经有"12 张没量齐
→ 退回默认进场"这一行，**要验它真的命中**（而不是量出 12 个 (0,0) 的坐标飞出来）。

## 第二屏

- 删掉 `.storybook { min-width: 1280px }`；
- `≤640px` 那一档 `.storybook__book` 的宽从 `min(1120px, 74vw, 90vh)` 换成
  `min(1120px, 94vw, 62vh)`（390px 上 `74vw` 只给 289px）；
- ★ 区间那三个咬合的数（`HANDOFF_START` / `--out-start` / `smoothstep`）**只在断点档里
  覆盖，不动桌面那三个**，手机上复量一次。

## 第三屏

- 删掉 `.hl { min-width: 1280px }`；
- 卡片宽 `clamp(214px, 19.1vw, 302px)` 在 390px 上取 214px（够放一张半），复验；
- 指针倾斜在触屏上没有对应物 → 把 `(hover: none)` 并进已有的
  `prefers-reduced-motion` 那一档给**静止终态**。

## 判据

- `chk-mobile.mjs` 判据 1（无横向溢出，`/` 那一行）。
- 三屏在 390×844 上各截图一遍人工过目（`chk-run-motion.mjs` 那套真帧探针的环境）。

## Comments

- 2026-10-19 完成。三条 `min-width: 1280px`（`.home-hero` / `.storybook` / `.hl`）一起删；
  新 `ThemeStrip.tsx` + `theme-strip.css` 只在手机那一档显示，环与卡带**两个都渲染**。
- ★ 环那 12 张 `<img>` 包了 `<picture>` + `media="(max-width: 640px)"` 的 `<source>`
  指到 `art-cards/`：**藏起来的图照样会被取**，这条 source 把代价从 12×90KB 压到 12×11KB
  （合计 0.13MB）。`HeroOrbit` 的窄屏早退（不挂 rAF、不挂指针监听）与它一起落。
- ★ 接力的退化路径**验过了**：`captureRing()` 量的是 `[data-orbit-index]` 的位置，
  手机上那 12 张是 `display: none`。原来那条"不完整 → `[]`"的守卫**不会触发**——
  `display: none` 的卡片照样会被 `querySelectorAll` 找到，矩形全零而**数量对得上**，
  于是会静悄悄地得到 12 次从角落飞出的 `scale≈0` 动画。加了零尺寸保护之后走的是
  "退回默认进场"那条，浏览器里确认过 12 个 figure 全是零尺寸。
- `.storybook__book` 在手机上从 `min(1120px, 74vw, 90vh)` 换成 `min(1120px, 94vw, 62vh)`
  （原式在 390px 上取 `74vw` = 289px，一跨页只有 179px 半页宽、正文约 11 字一行）。
  第三屏 `.hl` 的卡片宽在 390px 下取 `clamp` 下限 214px，指针倾斜在触屏上没有对应物
  （`(hover: none)` 并进静止终态那一档）。
- ★ **横屏那一档没做，写进了 docs/known-tradeoffs.md**（"首页在手机横屏下仍是桌面版面"）：
  三屏高度是按"三幕各占约 1.9–2.3 个视口高"咬合出来的，横屏只有 390 高，
  要改就得把 `HANDOFF_START` / `--out-start` / `smoothstep` 那组数重新测一遍。
  它在横屏下**不坏**（无横向溢出、内容够得着），只是没为那个方向调过版面。
