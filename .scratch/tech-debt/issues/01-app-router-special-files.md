# 01 · App Router 的三个特殊文件（错误边界 / 加载态 / 404）

Status: done

这一栏此前是**空的**——全仓 `find` 零命中 `error.tsx` / `loading.tsx` / `not-found.tsx`。
官方两条原文点名的是同一个意思：评分表「AI 交互体验」写「**错误边界**处理优雅」、
「前端交互体验」写「**加载状态优雅**」。而客户端一抛，用户看到的是 Next 自带的那张页。

## 做了什么

四个路由文件 + 一套视图，颜色全部走令牌（`check:colors` / `check:scrim` 都过）：

| 文件                           | 边界落在哪                               | 显形时机       |
| ------------------------------ | ---------------------------------------- | -------------- |
| `src/app/error.tsx`            | 根布局底下那棵树（所有页的渲染期异常）   | 立刻           |
| `src/app/loading.tsx`          | 根布局底下那棵树（**整页**，含工作台壳） | **晚 120ms**   |
| `src/app/(studio)/loading.tsx` | `(studio)/layout` **里面** —— 只换内容区 | **晚 120ms**   |
| `src/app/not-found.tsx`        | 未匹配的 URL + 任何 `notFound()`         | 立刻（真 404） |

三档共用一个 `src/components/system/SystemNotice.tsx`（+ 同名 CSS）。合成一个组件的
理由不是省几行：这三屏回答的是同一类问题（"这一屏现在没有内容，为什么，下一步去哪"），
分三份就是把同一张纸的留白、字号、按钮画三遍。

**为什么 `(studio)` 要单独一份 loading**：根那一档的边界在所有 layout **之外**，
它一显形连侧栏一起换掉（下面判据 2a 的读数里 `shell=false` 就是这件事）——
读起来像"整个应用重启了"。工作台又恰恰是全站唯一"每次进来都现读盘"的一组
（五屏都是 `force-dynamic`），慢的那一下正落在这里。组内那一档的边界在
`(studio)/layout` 里面，被换掉的只有 `.studio` 那一块（判据 3：`shell=true`）。

**为什么晚 120ms**：与 AppShell 的 `PENDING_SHOW_AFTER_MS` 同一个数、同一条规矩 ——
工作台来回切的实测是 45–62ms（`next.config.ts` 的 `staleTimes` 那段），
立刻显形的加载态在那条路上只会闪一下。延迟写在 CSS 的 `animation-delay` 里、
不是 `setTimeout`：导航比门槛快时这个组件会被整个卸载，定时器那套还得自己收尸。

**文案三条规矩**（与「不糊弄」同源）：不猜原因（不写"可能是网络问题"）、
不承诺没验过的事（不写"你的数据没有丢"）、错误编号照原样给出来
（`error.digest` 与生产环境那条 `console.error` 是同一个串，截图就能定位）。

**刻意没做 `global-error.tsx`**：它会顶掉根布局，于是既没有令牌也没有两个 Provider，
要另搭一套最小样式；而它能多接住的那一类（根布局自己抛）在这个站里基本不存在 ——
根布局只挂 Provider，`AuthProvider` 自己把 `/api/auth/me` 的失败收在 `meError` 里。
为一个接不住东西的边界写第二套页面，是拿"看起来完整"换维护面。

## 判据

`scripts/chk-system-pages.mjs`（新增，直连 CDP）：

| #   | 量什么                                                                 |
| --- | ---------------------------------------------------------------------- |
| 1a  | `/no-such-page-chk` 的 Document 响应是 **404**                         |
| 1b  | 那一屏是那张纸：标题、品牌记号、纸色 `rgb(251,247,239)`、圆角 14、居中 |
| 1c  | 两条出口的 `href` 逐个对：`["/","/booklist"]`                          |
| 2a  | 客户端导航进工作台 → 出现的是**根**那一档（`scope=page`）              |
| 2b  | 那张纸**前 120ms 读到的 `opacity` 是 0**                               |
| 2c  | 之后升到 1（它是真的会显形，不是永远 0）                               |
| 3   | 工作台**组内**导航 → 出现 `scope=shell` 那一档，且 `.shell` 还在       |

判据 2/3 要**拦 RSC 与 page chunk**才量得到（`Fetch` 域，各拦 1.5s）——
不拦的话纸只活约 325ms（dev 里取 page chunk 的时间），短于"延迟 120 + 渐显 300"，
判据 2c 会读不到 `opacity=1`，而它正是用来分辨"还没显完"与"永远不会显"的那一格。
★ 这一条是**实测踩出来的**：第一版只拦 RSC，2c 就是这么红的。

## Comments

- 2026-10-20 落地，`node scripts/chk-system-pages.mjs http://127.0.0.1:3311` → **7/7 过**。
  几条读数：404 的 Document 状态 `404`；纸宽 520、圆角 14px、纸色 `rgb(251,247,239)`、
  在 1440×900 下垂直居中；根那一档首次出现在 t≈1739ms、头 6 次采样（150ms）`opacity=0`、
  后段 `opacity=1`；组内那一档 t≈1633ms 出现且 `.shell` 全程在场。
- **`error.tsx` 不在上面那份探针里**：要验它得先有一条会抛的路由，而仓库里不该
  留着那样一条。它是一次性读数（2026-10-20，临时路由 `src/app/boomtemp/page.tsx`，
  **验完已删**，`git status` 里没有它）：
  - 服务端渲染期抛 → 边界接住，h1「这一页没能打开」、错误编号 `2635856441` 显示出来、
    两颗动作是 `<button>重试</button>` 与 `<a href="/home">回到工作台</a>`；
  - **hydrate 之后**再抛（`useEffect` + `setTimeout(400)`）也接得住 ——
    这一条特意试了：首帧就抛的话 React 会把 hydration 那次失败当成 hydration 错误、
    直接客户端重画一遍，**边界根本不响**（第一个版本的临时路由就撞在这个上）；
  - 按「重试」那一棵子树**真的重挂了**：点后 t=43ms 采样到 `.notice` 没了、
    被抛的那一屏画了出来；t=449ms 又抛（那条临时路由每挂载一次就抛一次）→ 边界再次接住。
- 闸门：`pnpm format:check`（prettier 认了新文件）· `pnpm lint` · `pnpm typecheck` ·
  `pnpm check:colors` · `pnpm check:scrim` 全过；`NEXT_DIST_DIR=.next-verify npx next build`
  也过（构建产物表见同一天的提交说明——`/` 仍是静态）。
