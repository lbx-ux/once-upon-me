# 07 · 文档

Status: done（2026-10-15）
依赖：01–06

## 改了什么

- `README.md` **§五** 新增「工作台与首页共用同一片天空」：那张十带表、governing rule、
  `scene-1` 只有顶上 20% 是蓝的逐行读数、两条刻意不做（毛玻璃 / 视差）、
  "随文档走而不是满屏 fixed"的理由、`--sky` 那层 multiply 的推导、
  以及"动效未被验证"这条实话说在前面。
- `README.md` **§二** 动效那一行：GSAP 从"仅第三屏"改成"第三屏 + 工作台的进场"，
  并写明工作台那处**只 `from()`、终态归 CSS**。
- `README.md` **§一** 目录：新增 `components/shell/`（四个文件）、
  `lib/useEnterTimeline.*`、`public/art-cards/`、`scripts/check-scrim.mts`；
  `make-webp.py` 那句"四档预设"改成五档。
- `docs/cover-art-prompts.md`：`art-cards/` 那 12 张的派生说明（不是新出图）。

## ★ 一处刻意没做

README §一的目录树**本来就落后于工作区**（`components/studio/`、`components/shelf/`、
`components/creation/`、工作台那四条路由都不在里面）。这一单只补**本次改动引入的**条目，
没有顺手把那棵树补齐——那是一次独立的审计，混进来只会让这一单的 diff 读不出重点。
