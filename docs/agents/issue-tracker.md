# Issue tracker: 本地 Markdown

本仓库的 spec 与实施工单以 markdown 文件的形式放在 `.scratch/` 下。

> 为什么不用 GitHub Issues：remote 确实指向 `github.com/lbx-ux/once-upon-me`，但这是参赛仓库，
> 评委拿到的是**代码包**。工程过程（spec、工单、验收记录）只有进了仓库才看得见，
> 放在站外等于没有。`.scratch/` 里的文件跟着 commit 走，`.gitignore` 不排除它。

## 约定

- 一个特性一个目录：`.scratch/<feature-slug>/`
- spec 是 `.scratch/<feature-slug>/spec.md`
- 实施工单**一单一文件**：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 编号。
  **不许**把多张工单塞进一个合并文件——合并文件会让 diff 变成整篇重写，
  看不出哪一张动了。
- 讨论与决策过程追加在文件底部的 `## Comments` 标题下
- 每张工单开头要有 **`Status:`** 行（`open` / `claimed` / `done` / `dropped`）
  - 开工前先改成 `claimed`，做完改成 `done` 并在 `## Comments` 里留下实测结果

> 本仓库**没有安装** `triage` 技能，所以不引入它那套 `needs-triage` / `ready-for-agent`
> 标签词表（引了也没有读者）。`Status:` 只用上面那四个值。
> 若日后装上 `triage`，再补 `docs/agents/triage-labels.md` 并把这张表映射过去。

## 当某个技能说「发布到 issue tracker」

在 `.scratch/<feature-slug>/` 下新建文件（目录不存在就一并建）。

## 当某个技能说「取回相关工单」

读被引用路径下的文件。通常你会直接拿到路径或工单号。

## 与 `docs/` 的分工

| 放哪                  | 放什么                                                           | 寿命                   |
| --------------------- | ---------------------------------------------------------------- | ---------------------- |
| `.scratch/<feature>/` | 一个特性的 spec 与工单：要做什么、怎么算做完、做的时候撞到了什么 | 特性做完就冻结，不再改 |
| `docs/`               | 跨特性长期有效的东西：出图提示词、提交规范、验收数字             | 长期维护               |
| `README.md`           | 项目对外的一句话与取舍                                           | 长期维护               |

一条判据：**换个人接手还需不需要看？** 需要 → `docs/` 或 `README.md`；
只是「当时为什么这么决定」的过程 → `.scratch/`。
