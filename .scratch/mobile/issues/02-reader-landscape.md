# 02 · 阅读器：转屏提示 + 横屏铺满

Status: done

## 要做什么

**新组件** `src/components/reader/RotateHint.tsx` + `rotate-hint.css`（同目录同名，
`globals.css` 里 `@import`）。挂载点在两个 page 各一行（它们共用 `.reader-page` 那个壳，
挂在这一层才不用在两台阅读器里各抄一遍）：

- `src/app/reader/[bookId]/page.tsx`
- `src/app/booklist/[key]/page.tsx`

只在 `(orientation: portrait) and (max-width: 640px)` 出现（**纯 CSS 控显隐**，转屏不用
JS 参与）；内容是内联 SVG 的旋转图标 + 一句提示 + 一颗「仍然竖着看」（图标不引库，
照 `AppShell` 那条约定）。

关掉之后写一份**阅读偏好**：`lib/reading-prefs.ts` 加 `rotateHint: 'ask' | 'off'`
（沿用那份文件"纯解析 + `load/save` 分开"的分法），`use-reading-prefs.ts` 加
`useRotateHint()`，`shell/SettingsDialog.tsx` 的「阅读偏好」加第三行 ——
另外两句"在哪儿改"的说明行都指着同一处，这里不能例外。

**横屏形态**：`reader-book.css` 与 `booklist-reader.css` 各加一节 §手机横屏，
**两处逐字同一条规则**（沿用文件名头上"舞台宽两处一起改"那条既有约定）：

- `.reader-page { height: 100dvh; overflow: hidden }`（页面不再滚，手势才归书）
- 舞台改按高定宽：`height: calc(100dvh - var(--reader-bar-h))`、`width: auto`、
  `aspect-ratio: 3/2`。3:2 的书装进 2.16:1 的屏幕，绑定的那条是**高度**，不裁不拉伸。
- `.reader-page__back` 从文档流里出来，变成左上角一颗浮药丸（`--surface` 底 + 44px 命中区）。
- `.reader__meta` 那行出处（书号 / 来源）收进 `sr-only`（它本来就是排障用的）；
  两句有实义的说明行（`narrationNote` / `autoNote`）照常显示、字号收 11px。
- 选择点 `.reader .book-choice` 的 `bottom` 要在横屏视口下**复量**。

**竖屏那一档的几何一个字不动**（92vw 舞台 + 12px 正文），只在上面压一层提示。

## 判据

- `chk-mobile.mjs` 判据 2（横屏书高 ≥ 0.80 视口高）与判据 3（提示的判别力）。
- `chk-shared-reader.mjs` 那条"选择点一行正文都没压住"在 **844×390** 下重跑得过。

## Comments

- 2026-10-19 完成。`RotateHint.tsx` + `rotate-hint.css` 挂在 `.reader-page` 那一层
  （两个 page 各一行），显隐**整条归媒体查询**（`(orientation: portrait) and (max-width: 640px)`），
  JS 只管"要不要问"（`xiaozhujue.reader.rotate`，设置里能改回来）。
- 横屏形态落在两台阅读器各自的 §手机横屏，**逐字同一条规则**。
  **实测 844×390：书 507×338、占视口高 86.7%**，比例仍是 1.500（没被拉变形）；
  **同一判据在 390×844 下只有 29.0%（244px）** —— 这就是"横过来"值多少。
- 判据取**高度**不取宽度：书是 3:2、屏幕是 2.16:1，绑定的那条只能是高度（宽是它推出来的）；
  量宽的话，一台更宽的手机就能"达标"，而那些空白本来就在那儿。
  另一条同时跑的判据是比例（`|ratio − 1.5| < 0.02`）——"铺开"不许靠拉伸换来。
- ★ 顺带发现并修掉的：`reader-page__back` 在横屏下变成左上角一颗 44px 圆钮之后，
  `chk-reader-desk.mjs` 判据 4（"那行字真的画在底图上面"，逐档数它自己矩形里的墨）
  开始报七档全红。**不是被盖住了**：那一行字在横屏下收进了 `sr-only`，
  量到的"20 个暗像素"正是那个箭头本身（最暗 28 = 墨色）。
  那是**判据的取材换了形状**，不是回归 —— 把阈值从 40（照"一行七个字加一个箭头"定的）
  收到 14，并把两种形状的实测数都写进注释。判据真正要区分的是"有墨 / 没墨"，
  被盖住时是 0，离两边都远。
