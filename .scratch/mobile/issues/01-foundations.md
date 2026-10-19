# 01 · 地基：viewport、安全区、断点约定、`dvh`、触控目标

Status: done

## 要做什么

1. `src/app/layout.tsx` 加 `export const viewport: Viewport`，带 `viewportFit: 'cover'`。
   ★ 没有这一条，`env(safe-area-inset-*)` **恒为 0** —— 横屏时刘海正好压在书的两侧，
   而两侧正是这一轮要用满的地方。Next 15 默认只给 `width=device-width, initialScale=1`。
2. `src/app/globals.css` 的 `:root` 加安全区令牌（硬约束一：只在这里定义一次）：
   `--safe-t / --safe-r / --safe-b / --safe-l` = `env(safe-area-inset-*, 0px)`。
3. 断点约定写进 `globals.css` 的注释（CSS 没有共享常量的机制，只能写在纸面上）：
   - 手机竖屏 `(max-width: 640px)` —— 全仓已有 10 处在用，**追认**，不新开一个数；
   - 手机横屏 `(orientation: landscape) and (max-height: 560px)`。
4. `100vh` → `100vh` + `100dvh` 成对（照 `shell/studio-backdrop.css:96-104` 那条既有写法）。
   落点：`.reader-page`（`globals.css`）、`.shell`、`.studio`、`.hero`。
5. 触控目标补到 44px（**只在自己的断点档里加 `min-height`，桌面一个像素不动**）：
   `.reader__audio`、`.blr__audio`、`.book-choice__speak`、`.dlg__close`。

## 判据

- 手机上 `env(safe-area-inset-bottom)` 解析出非 0（带刘海的机型）；用探针读
  `getComputedStyle(document.documentElement).getPropertyValue('--safe-b')`。
- 五条闸门全绿。

## Comments

- 2026-10-19 完成。`src/app/layout.tsx` 的 `viewport` 导出落在这一单；四个安全区令牌
  （`--safe-t/r/b/l`）在 `globals.css` 的 `:root` 定义一次，按硬约束一只定义这一次。
- **断点约定写进了 `globals.css` 的注释**（CSS 没有共享常量，只能写在纸面上）：
  手机那一档 `(max-width: 640px)`（全仓十几处已在用，**不新开数**）；
  手机横屏 `(orientation: landscape) and (max-height: 560px)`——判据取**高度**，
  因为手机横过来**宽度反而变大**（844），拿宽度判一定漏。
- `100vh` 成对补 `100dvh` 的落点：`.reader-page`、`.shell`、`.studio`。
- ★ 这一单埋下的一个坑是**后来才量出来的**：`max-width: 640px` 与"手机横屏"**不是同一个门**，
  所以凡是"因为这是手机所以……"的规则，横屏那一档要走一遍自己的门。
  触控 44px 那条线就是这么漏过一轮的（症状：同一个朗读钮竖屏 44 高、横屏 32 高）。
  这条写进了 GLOSSARY 的「手机那一档」与 docs/known-tradeoffs.md。
