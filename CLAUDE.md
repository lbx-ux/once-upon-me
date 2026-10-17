# 小主角 · Once Upon Me — 工作约定

参赛作品（2026 第九届传智杯 · AI WEB 赛道 10037）。**产品定义、技术架构、已知取舍
以 [README.md](README.md) 为准**，本文件不复述它，只写「在这里怎么干活」。

## 动手前

1. 读 README 的 **§二 技术架构**（分层约定、命名规范）与 **§五 已知取舍**。
   §五 不是废话，是**已经付过学费的地方**——每条都对应一次实测踩坑，
   绕过它等于把 bug 重做一遍。
2. 三条闸门必须过，提交前跑：

   ```bash
   pnpm format:check && pnpm lint && pnpm typecheck
   ```

   提交消息格式见 [docs/commit-convention.md](docs/commit-convention.md)。

## 四条硬约束

| 约束                                                                             | 理由                                                                 |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 设计令牌只在 `src/app/globals.css` 的 `:root` 定义一次                           | 组件层只消费 `var(--x)`；改配色只动那一块                            |
| 组件样式与组件同目录同名（`Foo.tsx` / `foo.css`），在 `globals.css` 里 `@import` | 依赖属性选择器与兄弟关系，不用 CSS Modules（理由见 README 分层约定） |
| `src/lib/engine/`（将来）不得 import React                                       | 一个 node 脚本要能跑完整本生成——这是「平台而非聚合」的技术证据       |
| 真实密钥只写 `.env.local`，或管理页写出来的 `models.runtime.json`                | 两个都在 `.gitignore` 里；仓库是公开的，密钥提交上去撤不回来         |

> 「四条硬约束」里的第四条 2026-10-17 扩了一次：管理页能换模型/接口地址/api-key 之后，
> 密钥多了一个落点（`models.runtime.json`，管理页写、`serverEnv()` 读、压过 `.env.local`）。
> 生产上建议用 `MODEL_CONFIG_FILE=/etc/xiaozhujue/models.json` 把它挪出仓库目录——
> 那个目录是部署产物，重新部署会擦掉它。**两个落点都只有一条纪律：永不入库。**

## 已交付的测量值不是常数，是契约

首页前两屏里大量数字是**实测出来的**，改动要连带改：

- 首屏交接段的三个数（`HANDOFF_START` / `--out-start` / `smoothstep` 区间）互相咬合，
  改一个要同时改另两个，推导写在 README §五。
- `useScrollDriver` 里每一处细节（帧率窗口、`setVar` 去重、reduced 下仍跑循环）
  都对应注释里写明的一次踩坑。**搬动它可以，改行为不行**，除非你重新测过。
- 看到「★」或「刻意」的注释，先读完再决定要不要违背。

## 不糊弄

这一条是本项目的美学，不是道德劝告：

- 没有的东西**直说没有**。首页那条配音播放条是**拆掉**的，不是改成"其余页写一句
  演示仅第 1 页配音"再留着：全篇只录得到第 1 页，而一个只对四分之一能响的控件，
  证的是这一页想证的反面。宁可整节不做。
- 图没到位就留一个**语义上诚实的兜底**（选择点图标在图进来前露出 emoji，
  `alt=""` 的 `<img>` 在 404 时什么都不画，不会留碎图标）。
- `prefers-reduced-motion` 下每一处动效都要有**静止终态**，不是简单地不播。
- 数字要能复现：写「约 1 MB」的地方，得说清是怎么量的、脚本在哪。

## Agent skills

### Issue tracker

spec 与实施工单以 markdown 放在 `.scratch/<feature-slug>/`（不用 GitHub Issues，理由见文档）。
见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。

### Domain docs

single-context：根 `GLOSSARY.md` + `docs/adr/`，惰性创建。见 [docs/agents/domain.md](docs/agents/domain.md)。
