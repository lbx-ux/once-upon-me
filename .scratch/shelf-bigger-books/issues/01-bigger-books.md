# 01 · 把 `--book-w` 抬到 192（那一档的满额）

**Status:** done

## 要做什么

1. `src/components/shelf/shelf.css`
   - `--book-w: clamp(104px, 13vw, 156px)` → `clamp(104px, 15vw, 192px)`
   - `--book-gap: clamp(14px, 1.6vw, 22px)` → `clamp(14px, 1.8vw, 24px)`
   - `--label-h: 54px` → `58px`
   - `.shelf__name` 字号 `13px` → `14px`
   - 三条注释跟着改：为什么 192 是**缩略图钉死的**、不是审美挑的（见 spec）
2. `src/lib/library.ts`：`SHELF_COVER_WIDTH` 的注释里 156/312 那两个数要改，
   并写明**这个常量这一次没有动**（192 正是它的天花板），免得下一个人以为漏改了。
3. `scripts/probe-shelf.mts`：文件头 ③ 那条注释里 "104–156px" → "104–192px"。

★ 别改 `.shelf__rack` 的 `--cover-h` / `--row-h` / `--board-top`：它们是 `calc(--book-w …)`
推出来的，手改就是把这个文件头那条设计毁掉。

## 怎么算做完

- 真浏览器上量到的 `--book-w` 实际像素：1440 下 192，375 下 104。
- `node scripts/probe-shelf.mts` 全过（尤其判据 ① 书立在板上、③ 仍是 `?w=384`、⑤ 375 不溢出）。
- 三条闸门：`pnpm format:check && pnpm lint && pnpm typecheck`。
- 1440 / 375 各一张截图。

## Comments

- 2026-10-17 三处都按上面改了（`--book-w` 192 / `--book-gap` 24 / `--label-h` 58 /
  `.shelf__name` 14px）。量到的数：
  - **用户真书架**（1440×1000，走应用内预览 3311）：
    `--book-w 192`、封面 192×256、书名条 58、`--board-top 314`、`--row-h 366`、
    虚线那本封面 192px、横向溢出 0。
  - **离线量法**（`.out/shelf-geom/`，真 Chrome 打开真 CSS）：
    1440 → 192/256/58/314/366，书的底边在架内 y=314 = `--board-top 314`（差 0），一行 5 本；
    375 → 104/139/48/187/225，底边 186.66 vs 板顶 187（差 0.34），一行 3 本，溢出 0。
  - **探针**（隔离根 `--base=http://localhost:3334`）：全过。唯一红的是"控制台没有 error"，
    打印出来是三行 `401 (Unauthorized)`，对着服务器日志查到是 `GET /api/auth/me`——
    登出态探针浏览器撞认证端点，与这一单无关。**没有为了让闸门变绿去缩小这条判据**。★
    顺带补了一件事：这条判据以前红了只打一行红字、不打印日志内容，分辨不出"页面真报错"
    和"冷编译那一下的资源抖动"——现在失败会把 errs / exceptions 逐条打出来。
- 截图：[.out/shelf-1440.png](../../.out/shelf-1440.png)（隔离根，8 本真封面 + 虚线那本）、
  [.out/shelf-geom/geom-375.png](../../.out/shelf-geom/geom-375.png)。
- `library.ts` 的 `SHELF_COVER_WIDTH` **一个字没动**（192 就是这一档的天花板），
  只改了它上面那段注释，写明这次没动、越过它才要改。
- 闸门：`format:check` / `lint` / `typecheck` 全过。**未提交**。
