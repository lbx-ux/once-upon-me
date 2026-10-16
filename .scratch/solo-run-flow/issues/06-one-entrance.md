# 06 · 入口归一：删掉四步，全站只剩一个开书的地方

Status: done
依赖：[05](05-run-view.md)
上游：spec §三

## 一、为什么

今天开书有两条腿：`/home` 的一句话，与 `/create` 的四步表单（孩子是谁 / 想讲什么 /
角色卡 / 生成）。用户定了：**四步整条删掉，入口统一到 `/home`**。

★ 这也是仓库既有的判断：`CreateLanding` 文件头写着"它**不自己造一套表单**……
两条路径迟早会漂"。删掉之后这句话才真的成立。

## 二、要改的入口（三处 + 一条兜底）

| 在哪                                       | 今天       | 改成                                     |
| ------------------------------------------ | ---------- | ---------------------------------------- |
| `reader/[bookId]`「再做一本」/「回创作流」 | `/create`  | `/home`                                  |
| `shelf`「新建故事」（那本虚线书）          | `/create`  | `/home`                                  |
| `ChildDetail`「去出一张形象」              | `/create`  | `/character/new`（出形象本来就在那一屏） |
| 裸着访问 `/create`                         | 走四步表单 | `redirect('/home')`——留给书签与手打地址  |

★ `/create` **不带参数时不许自己造一句话或自己选一张卡**：它现在是一个运行视图，
没有"这一轮"就无事可做。与其在它里面摆一个"还没开始"的空态，不如把人送回去。

## 三、要删的

- `CreateFlow.tsx`：四步的渲染、`StepShell`、`card` 那半份状态（出形象 / 复用已有卡）、
  `children` 那一份（列小主角）、`reducer` 里的 `child` / `theme` / `card` 三个 action。
  ★ 文件本身**不删**，它变成 `GenerationRun.tsx` 的一部分（工单 05）——
  画桌、事件收集、`deskOf` 每帧重算那几条判断都是要留下的。
- `lib/creation/state.ts`：`STEPS` 与 `StepKey` 收缩到只剩运行那一步；
  `stepProblems` 整条删（没有"下一步"了，缺什么在弹窗与运行视图上当场说）；
  `CreationState.child` / `.theme` / `.card` 只剩运行需要的那几个字段（`childId`/`name`/
  `nameReading`/`ageBand`/`lookTags`/`interestTags`/`cardId`/`theme`/`wish`）。
- `fields.tsx` 的 `ChildFields` / `AnchorFields` **不删**：`/character/new` 还在用它们
  （工单 03 第二刀就是为这件事把选项搬过去的）。只删 `CreateFlow` 里对它们的调用。

## 四、`/create` 参数契约（改完之后）

```
/create?wish=…&theme=<key>&card=<cardId>&pages=<n>&voice=<voiceId>
/create?book=<bookId>            ← 从书架「继续做」进来，恢复一份草稿
```

★ `theme` 仍然按今天的规矩翻译：URL 上带的是 `THEMES` 的 **key**，
`theme: label` 才是进请求体的那个值（`CreateFlow` 现有那段 `seed` 逻辑照搬）。
★ `wish` 与 `theme` 都没有 → 重定向 `/home`（同 §二那条兜底）。

## 五、验收

- 全仓库 `grep '/create'`：只剩「跳转目标 + 兜底重定向」两种出现，
  没有一处还在指望它显示一个表单
- 从书架、阅读器、角色卡那三条路各点一次，都能到该去的地方
- `pnpm typecheck` 过（删掉的东西如果还有读者，它会在这里报出来——
  这是这次删除最可靠的验收手段）

## Comments

- 2026-10-16 做完了。四条入口改向都改了；四步整条删掉；裸 `/create` 的处理见下。

**★ 计划里写错的一条，做的时候发现了**：工单里原本写「ChildDetail『去出一张形象』→
`/character/new`」。那是错的：`/character/new` 建的是**另一个孩子**（新的 childId），
指向那里会造出一个重复的孩子，**比没有入口更糟**。真相是那条四步流程里
藏着**全站唯一一处"给一个已经存在的孩子出形象"**的能力（CreateFlow 第 1 步选人 →
第 3 步出图），而"有档案、没形象"是一个**正常状态**（新建时出图失败就停在这里，
`NewChild` 文件头第 3 条写着它）。所以要删的是流程，不是那个能力：
`ChildDetail` 的空态里补上了八条锚点（`AnchorFields`）+ 一颗「出一张形象」，
请求体走 `toCardBody`（与 `/character/new`、与引擎同一份契约）。

**裸 `/create` 也从"一句 redirect"变成了"先找回刚才那一本"**：
`sessionStorage` 里那个书号（`lib/creation/last-run.ts`）服务端读不到，
所以这一步必须在客户端（`ResumeLastRun.tsx`）——找不到才回 `/home`。
不留这一步的话，生成到一半刷新就再也回不到那一屏了，而那是原 `CreateFlow`
文件头写明的承诺之一。**它不是唯一一条路**：真正的入口是书架上那一排草稿。

**删掉的**：`CreateFlow.tsx`、`create-flow.css`（只剩表单零件的那几条，切成 `fields.css`）、
`STEPS` / `StepKey` / `stepProblems(state, key)`（收窄成 `childProblems(child)`，
`/character/new` 与 `/character/[childId]` 仍在用）、`CreationState.step`、
`globals.css` 里那两条没有读者的 `.create-page*`。
`fields.tsx` 的 `ChildFields` / `AnchorFields` **没删**（两个角色屏在用它）。

**顺带清掉的指针**：六处注释里写着的 `create-flow.css` 都改指 `fields.css`
（留了"原名"作为历史）。一句指向已经不存在的文件的话，比没有更糟。
