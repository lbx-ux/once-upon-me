# 01 · 撤掉书架的柜身，书与板落在天光上

Status: done（2026-10-16）
前情：[.scratch/shelf-bookcase/](../../shelf-bookcase/spec.md)（已冻结，不回头改）
对应 [spec.md](../spec.md) §一、§二、§三

## 改了什么

- `src/components/shelf/shelf.css`：删掉 `.shelf__case` 整条规则（`--card-paper` 暖纸 +
  `--hairline` 细边 + `--sheet-shadow` + 20px 圆角 + 三层内边距）。原处留一块墓碑注释，
  写清"撤掉之后没有东西顶上来"以及**为什么不补一个差不多的 padding**。
  文件头的颜色那段改成：暖色在这儿的身份还是**物件**（搁板 `--shelf-wood`、
  封面缺席时那张 `--card-paper` 相纸），但柜身那层大色块没有了。
- `src/components/shelf/ShelfDashboard.tsx`：结构从 `.shelf__case > .shelf__rack`
  变成 `.shelf__rack` 直接是 `main.shelf` 的孩子。文件头加一段"第二轮"。
  ★ 组件结构没别的变化——这一轮**只动色，不动空**。
- `scripts/probe-shelf.mts`：`ProbeResult` 加 `hasCase` / `rackBg` / `rackTop` / `skyH`，
  判据加三条（见下）。文件头补 ⑦⑧，并把 ③ 那条的来龙去脉写清（见"假红"那一节）。

## 判据（`node scripts/probe-shelf.mts`，隔离 dev server `--dist=.next-shelfprobe --port=3333`）

```
✓ 柜身不在（查不到 .shelf__case）：false
✓ 架子自己没有底色（板是 background-image）：rgba(0, 0, 0, 0)
✓ 书架落在天空带里：顶边 50 < --sky-h 1120
```

| 量                        | 1440×1000 | 375×812 |
| ------------------------- | --------- | ------- |
| `--book-w` / `--cover-h`  | 156 / 208 | —       |
| `--board-top` / `--row-h` | 262 / 314 | —       |
| 书的底边 − `--board-top`  | **0**     | **1**   |
| 横向溢出                  | 0         | 0       |

板：`100% 314px, 100% 314px` / `repeat-y, repeat-y` / 2 层。
封面请求：`200 /api/assets/books/xiaolu-r1-bf84901c4fcd/cover.png?w=384`。
控制台 0 error / 0 异常。→ **全过**（`.out/probe-cold.txt` 是冷编译那一趟的原样输出）。

- ★ 这三条**只有在真撤干净时才过**：留一个 `background: var(--paper)`、或者把类名换掉
  但样式还在，都会红。撤柜身这件事没有别的地方会响——不写判据，它就只能靠人眼看截图。
- ★ `--sky-h` 是**借一个临时块解成像素**量出来的（`getPropertyValue('--sky-h')` 给的是
  未解析的 `112vh`）。`rackTop 50 < 1120` 这条是"压在天光上"这件事的前提，
  也是下一次有人动 `--sky-h` 时唯一会响的地方。

## ★ 冷编译那一趟的假红（这一轮真踩了）

第一次跑（`.next-shelfprobe` 刚清掉、dev server 刚起、探针是第一个访客）报：

```
✗ 书架真的去拉了封面
```

而 curl 取 SSR 出来的 HTML，里面**明明**有 `?w=384` 的内联背景——请求是发出去的，
只是**冷编译那一趟 CDP 的 `Network.responseReceived` 整条收不到**（热了以后再跑就有）。

修法不是"多重试几次"，是**换证据源**：页内 `performance.getEntriesByType('resource')`
里那份记录（带 `responseStatus`）与 CDP 的 Network 事件**取并集**，谁都不当默认值：

```ts
const coverReqs = [
  ...new Map(
    [...cdpCovers, ...wide.covers].map((c) => [`${c.status} ${c.url}`, c] as const),
  ).values(),
]
```

然后**故意把冷态复现一遍**（`rm -rf .next-shelfprobe` → 重启 → 让探针当第一个访客）
确认全过，才算修好。★ 顺手记：这条判据原来的写法在冷态下是**假红**，
而"假红的闸门最后一定会被无视"——这是这份脚本存在的意义反面。

★ 页内那段脚本是**模板字面量里的字符串**，两个地雷（这一轮两个都踩了）：

1. 反引号：写 `\`var(--sky-h)\``会把模板字面量提前闭合 →`SyntaxError: Expected a semicolon`。
2. 正则字面量的斜杠：`/\/api\/assets\/.*cover/i` 里的反斜杠会被模板字面量吃掉一个，
   剩下 `//api/...` **把后面整行注释掉** → `SyntaxError: Unexpected token '.'`。
   改成 `new RegExp('/api/assets/.*cover', 'i')`。

★ 连**解释这两个地雷的注释本身**也不能含反引号——写这段的时候又踩了一次
（`SyntaxError: Expected unicode escape`）。所以那几行注释里一个反引号都没有。

## Comments

- 2026-10-16 澄清（用户在原截图上圈住书架右半边，写「和背景有点突兀把」）：
  问「是**空**（柜身收到贴住书）还是**色**（暖色压在天上太硬）」→
  用户选 **「色的那头：暖色柜身压在天上太硬」**，预览图里柜身整个不见。
  **没选**"柜身收到贴住书"那一项 → 所以**右半边那条通长的板是故意留的**，
  见 [spec.md](../spec.md) §一。
- 2026-10-16 闸门：`pnpm typecheck` 干净；`pnpm format:check` 与 `pnpm lint` **红了，
  但红的不是这一单**——全部落在另一个会话正在做的 voice-clone 那一批
  （`.scratch/voice-clone/*`、`src/app/api/voice/clone|delete/route.ts`、
  `src/lib/audio/*`、`src/components/studio/NewVoicePanel.tsx`）。
  只对自己这三个文件跑了 `prettier --write`（**没有**全仓跑），
  指定路径复跑：`prettier --check` 与 `eslint` 都是干净退出。
- 2026-10-16 `node scripts/check-scrim.mts`：**PASS**，10 段全部 4.5:1 过。
  撤柜身后这一屏压在天空上的字只有空态那句 `.shelf__empty`（`--ink-on-sky` 7.86:1），
  书名条仍在 `--surface` 上（17.85:1）——都没有因为撤柜身而换底。
