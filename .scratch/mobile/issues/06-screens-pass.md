# 06 · 其余各屏逐屏补档

Status: done

多数屏幕已经有 640–880 的某一档（`booklist-wall` / `create-landing` / `character-wall` /
`desk` / `child-detail` / `shelf` / `profile-home` / `login` / `new-child`），这一单是
**逐屏过一遍**，把还顶出宽度的收掉：

- `/home`（创作落地页）：`clamp` 字号与卡宽；
- `/character`：`.cw__wall { grid-template-columns: repeat(auto-fill, minmax(292px, 372px)) }`
  在 390px 上会顶出（292 + 内边距 > 390），改 `minmax(0, 1fr)`；
- `/shelf`：`--book-w` 在手机上复量（书立在板上那套几何由 `--book-w` 一路 calc 出来）；
- `/voice`、`/create` 运行视图：内边距与卡宽；
- `/login`、`/account`：已有 900 / 620 档，**复验**即可；
- `/admin`：**保留横向滚**（`admin.css` 那条判断仍然成立：横滚比把 8 列压到读不出好），
  只加一行"← 左右滑看全表"。
  ★ **2026-10-19 后一句已被推翻**：用户说「左右滑动看全表这几个字不用写，在 web 和移动端
  都不用写」——元素与 `.adm__scrollhint` 两条样式都已删除。**横滚照旧保留**，
  撤的只是那一行字（表格自己横滚看得见，不用写出来）。

## 判据

- `chk-mobile.mjs` 判据 1 覆盖这八条路由 × 五个视口。

## Comments

- 2026-10-19 完成，逐屏过了一遍。判据落在 `chk-mobile.mjs` 判据 1：
  **五个视口（390×844 / 360×640 / 412×915 / 844×390 / 768×1024）× 八条路由
  （`/`、`/booklist`、`/booklist/dino`、`/reader/<演示书>`、`/home`、`/shelf`、
  `/character`、`/login`）全部 `scrollWidth ≤ clientWidth + 1`** —— 40 条，全过。
- `/login` 与 `/account` 本来就有 900 / 620 档，没动；`/character` 那面角色墙
  在窄屏已经是 `minmax(0, 1fr)` 单列；`/shelf` 的 `--book-w: clamp(104px, 15vw, 192px)`
  在 390px 下取 104px，够。
- ★ 唯一需要动的共性问题是**触控目标**（44px 那条线），它落在阅读器与工作台两处，
  分别由 02 / 05 两单处理。
- ★★ **2026-10-19 更正（08 那一单）**：上面那句「`/shelf` … 104px，够」是**错的**，
  而判据 1 那句「五个视口 × 八条路由全部 `scrollWidth ≤ clientWidth + 1`」在这里
  **绿得没有意义**——两条原因：①`scrollWidth` 只问"整页有没有横着溢出去"，
  不问"里面挤没挤"（字折成三行、书名条被压成 0 高，一个像素都没溢出）；
  ②`/shelf` **未登录时是一排空架子**（`page.tsx` 里 `if (!userId) return <ShelfDashboard books={[]} />`），
  判据 1 那次跑没有带票，量的是一个"什么都没有"的页面。
  104px 给的内宽只有 90px，三枚角标（max-content 133px）装不下，用户在手机上看到的
  就是那三根竖着的字柱。修法与实测见 [`08-shelf-cramped.md`](08-shelf-cramped.md)，
  以及 `chk-mobile.mjs` 判据 6（它自己签票，空架时明说跳过）。
