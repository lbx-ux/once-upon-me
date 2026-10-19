# spec · MCP / 工具集成（评分表 #6，4%）

> Status: done（2026-10-19 收工）
> **两半都落地了**：工单 01–05 是 **MCP 那一半**（别人调我们），
> 06–09 是 **Function Calling 那一半**（我们的模型调工具）+ 文档。
>
> ★ 两半的结局不一样，这一点必须说清：
> · **MCP 那一半是"实现并接出去"**——七条工具、真客户端握手通过、与 `engine-run` 逐字节等价。
> · **Function Calling 那一半是"实现、量过、默认关"**——三臂对照在 n=5 上看不出差别，
> 而每本多 4 次文本调用是确定的代价（[ADR-0013](../../docs/adr/0013-tool-calling-is-a-measured-arm.md)）。
> 默认关不是"没做"，是按 ADR-0005 的纪律：**代价确定、收益没量出来，就不开**。
> 排期位：`E:\compete\计划表.md` 的 **B2**（10/25 – 10/29，与 B3 内容过滤同窗）
> 关联：[ADR-0002](../docs/adr/0002-provider-adapter-layer.md) 适配层 ·
> [ADR-0004](../docs/adr/0004-no-vercel-ai-sdk.md) 不引框架（事件协议是自研的） ·
> [ADR-0011](../docs/adr/0011-index-is-a-file-not-a-vector-db.md) 索引就是一个文件 ·
> 本特性新增 [ADR-0012](../docs/adr/0012-mcp-server-handwritten-jsonrpc.md) 与
> [ADR-0013](../docs/adr/0013-tool-calling-is-a-measured-arm.md)
> 术语以根 [GLOSSARY.md](../GLOSSARY.md) 为准

---

## 零、一句话

**把 `events.ts` 那句「同一串事件喂三个消费者：前端可视化、MCP 工具返回、过程日志」
里从来没有存在过的第三个消费者真的做出来**——引擎之外加一层 stdio MCP server，
让任何 MCP 客户端（Claude Desktop / Claude Code）能看见这个家庭的书架，
并真的编一本、画一本。

**同时**给规划那一步接上 Function Calling：让**我们自己的模型**决定要不要翻语料、
查书架、查角色卡、自检那段正文——那是评分表「工具调用」四个字最正的字面答案。

### 这不是两件事的两种说法

|                  | 谁调谁                                                           | 喂哪一栏                                              |
| ---------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| MCP server       | **别人的 AI 调我们的引擎**（我们的引擎是「外部工具」）           | #6 MCP / 工具集成                                     |
| Function Calling | **我们的模型调我们的工具**（语料 / 书架 / 闸门是「外部数据源」） | #6 的「Function Calling」半 + #2 Agent 的「工具调用」 |

分开做、分开验。合成一句话讲的话，两栏都只能讲一半。

---

## 一、判据（先说怎么算做完）

### MCP 那一半

| #   | 判据                                                                | 怎么验（取只有真做才会不同的量）                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 一个**真 MCP 客户端**能连上并**真的查盘**                           | ★ **一半**：`claude mcp list` 报 `✔ Connected`（**别人写的客户端**对我们手写的 JSON-RPC 握手 + 工具表检查通过）。**"模型真的调了工具"那一半这台机器上没跑成**——`claude -p` 回的是 `Not logged in`（这个 shell 的 CLI 没有登录态）。补法与判据见 [工单 04](issues/04-server-entry.md) 的 Comments |
| 2   | 走 MCP 那条路与 `engine-run --mode=stub` 是**同一本书、同一串事件** | ✅ `node scripts/mcp-session.mts`：`book.json` 去掉时间字段后**逐字节相同**；`events.jsonl` 去掉 `at` 后**逐条相同**（23 条）；**另加一条**——事件里那 6 个插画 `assetPath` 逐个 stat，真的在盘上                                                                                                 |
| 3   | 进度通知是**真的**，不是永远发或永远不发                            | ✅ 同一场会话里跑两遍：带 `_meta.progressToken` → 收 4 条；**不给 → 0 条**                                                                                                                                                                                                                       |
| 4   | 空态与负例说得清                                                    | ✅ 未知方法 → `-32601`；不存在的 `bookId` → `isError` + 一句人话；`form` 写错 → 列出合法值                                                                                                                                                                                                       |
| 5   | 会话记录可重跑                                                      | ✅ `.out/mcp-session/transcript.jsonl`（52 条双向）+ `summary.json`（14 条判据）                                                                                                                                                                                                                 |

★ 判据 2 第四条（逐个 stat）是**后加的**：前三条能被一个假象满足——
两串**都指向空气**的事件流也是"逐条相同"的。

★ 判据 1 只记**一半**，不许记成全过。「没跑成」与「测出来」分开写，
是这一栏最忌讳的一件事（`docs/known-tradeoffs.md` 量法那一族）。

★ 判据 4 那一格是**付过学费的地方**（`docs/known-tradeoffs.md` 里「空值算不算错」那一族）：
探针在空态上也会全绿——所以判据里既有「空态要说得清」也有「负例要报错」，两者都要跑。

### Function Calling 那一半

| #   | 判据                                       | 怎么验                                                                                                              |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 6   | 网关到底支不支持 `tools`，**是被量出来的** | `node scripts/probe-tool-calls.mts`，八格每格一次真请求 + 判别对照，判读表写进脚本文件头                            |
| 7   | 三臂对照：工具调用到底有没有用             | 同一批主题 × N 本：**关检索 / 预检索 / 模型自选工具**，取 Schema 一次通过率 + 平均重试次数 + 工具调用计数           |
| 8   | 默认不变                                   | 不传 `tools` 时，规划那条的请求体与事件流**逐字节等于今天**（与 `plan-retrieval.test.ts` 那条「重试不再检索」同族） |
| 9   | 工具循环的边界有单测                       | 超步数、工具抛错、非法参数、模型一次都不调工具直接给答案                                                            |

★ 判据 7 的「显著提升」是官方原话，所以它必须是**对比**，不是「用上了」——
与 B1（RAG）那条同一条纪律。输了就保持默认关，并把数写进文档（ADR-0005）。

---

## 二、现状（2026-10-19 立这一份时逐条核过）

- `grep -rn "mcp"`：只有注释与文档里的承诺，**零实现**。
- `tool_call` / `tools:`：全仓零命中。
- 现成的底子：`engine/index.ts` 的四个动作；`events.ts` 的事件协议（带 `seq` / `at` /
  `stage` / `describeEvent`）；`lib/asset-scope.ts` 的归属前缀；`lib/rag/load.ts` 的
  `ownerOf` + `createPlanRetriever`。
- 现成的返回协议是给 MCP 用的——`describeEvent` 那句
  「放在引擎侧而不是 UI 侧：MCP 返回与日志也要同一句话」就是为这一轮写的。

---

## 三、MCP server 的形状（三个决定，都有理由）

### 3.1 自写 JSON-RPC，零新依赖

协议面只有六个方法（`initialize` / `tools/list` / `tools/call` / `ping` /
`logging/setLevel` / `notifications/initialized`）与一种传输（stdio）。
理由与代价写进 [ADR-0012](../docs/adr/0012-mcp-server-handwritten-jsonrpc.md)，
**翻案条件是判据 1**：真客户端连不上就引 SDK。

### 3.2 只做 `tools` + `logging`，不做 `resources` / `prompts`

`resources`（把每本书当可订阅对象 + `notifications/resources/updated`）是**另一条路**，
它解决的是「客户端要有对象的句柄」这个问题——而我们今天要的是「AI 能查、能动手」。
真需要时再加，不在这一轮里预铺。

### 3.3 长任务是异步的

`illustrate_book` **立刻返回**，进度走 `notifications/message`，用 `book_status` 收。
理由：一本 20 页的书实测 ≈154 s/页，任何客户端的工具超时都撑不过去。
让一个**必然超时**的工具存在，就是把这一栏做成一次演示事故。

代价照实写进 `known-tradeoffs.md`：客户端断开 → MCP 进程退出 → 这一轮跟着死。

---

## 四、Function Calling 的形状

### 4.0 ★ 实测（2026-10-19，工单 01；产物见 `.out/probe-tool-calls.txt`）

十二格全部有结论、零格没结论（全程没触发限流）：

| 结论                                    | 读数                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **`tools` + `tool_choice:'auto'` 可用** | qwen3.8-flash / glm-5.3-flash / deepseek-flash **三家都真的回了 `message.tool_calls`**             |
| **`tools` 与 `response_format` 不互斥** | `json_object` 与 `json_schema` 两档都过 ⇒ **不用放弃 `LLM_JSON_MODE`**                             |
| **多轮可续**                            | `assistant.tool_calls` + `role:'tool'` 回填 → 200 + 正文                                           |
| ★ **`tool_choice` 只许用 `'auto'`**     | 强制点名**不稳定**：同一请求体 10 次里 **7 次 400**（`MODEL_TOOL_CHOICE_NOT_SUPPORTED`）、3 次 200 |
| 网关**严格校验请求体**                  | 未知顶层字段 → `400 UNKNOWN_FIELD`；写坏的 `tools` → `'name' is a required property`               |

★ 最后两行是**判别对照**（F1/F2），它们的作用是把「A 回了 tool_calls」从
「参数可能被忽略了、模型碰巧答对了」里救出来：网关既会拦未知字段、
也真的解析 `tools`，所以 A 的 `tool_calls` 是**参数真进了请求体**的结果。

★ 强制点名那一格差一点被记成一条干净的否定结论（前两次跑都回同一个 400）——
**第三次同一个请求体就翻了**。所以它的读数是「不可依赖」，不是「不支持」。
详见工单 01 的 Comments。

### 4.1 工具是**注入**的，引擎不知道它们是什么

与 `PlanRetriever`（`plan.ts`）同一条边界：引擎只调 `ToolDef.run(args)`，
拿回一段文本。语料在哪、书架在哪、红线词库在哪，引擎都不知道——
所以 `node scripts/engine-run.mts --mode=stub` 加上工具之后仍然不碰网络、不碰盘。

### 4.2 新能力不做默认

`tools` 与 `retrieve` 同为可选入参，**不传就是今天那条路**（逐字节相同）。
默认一开，脚本与跑测走的就是一条没量过的路——这是 B1 已经付过一次的学费。

### 4.3 与流式互斥

`onDelta` 与 `tools` 同时给 = 配置错误，**当场抛**。
两条都是显式分支，没有「传了但被忽略」那种中间状态（`ImageGenerator.edit` 那段同一条）。

---

## 五、七个工具（四条写、三条读）

计划表那张草图列了四个（`plan_book` / `illustrate_book` / `character_card` /
`book_status`）。这里补三条读的并说清理由：**AI 得先看得见，才动得了手**——
一个只能「无中生有地编一本」而看不见书架的助手，在这个产品里没有位置。

| 工具              | 干什么                                                                  | 复用谁                                                 |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `list_children`   | 这个账号下的孩子（名字 / 年龄档 / 兴趣标签 / 有没有卡）                 | `createProfileStore`                                   |
| `character_card`  | 锚点 + 风格段 + **出图时真正会用的角色段与核对清单**                    | `createCardStore` + `promptFragmentOf` / `checklistOf` |
| `list_books`      | 书架（书号 / 书名 / 形态 / 读起来几页 / `story`\|`draft`\|`published`） | `listBooks` + `noCovers`                               |
| `read_book`       | 这一本的正文全文（含选择点与画面描述）                                  | `readStory`                                            |
| `book_status`     | 做到哪一步：`events.jsonl` 最后 N 条的**人话** + 分类计数               | `createFsEventLog` + **`describeEvent`**               |
| `plan_book`       | 编故事（同步；过程走进度通知）                                          | `planBook`                                             |
| `illustrate_book` | 按盘上那版故事出图（**异步**）                                          | `illustrateBook`                                       |

★ `character_card` 回「出图时真正会用的那一段」而不是只回八条锚点：模型要写画面描述，
它需要知道画师会拿到什么。这也让这条工具**不是重复劳动**（锚点本来就在提示词里，
再回一遍等于没说）。

---

## 六、盘上的形状

```
mcp/server.mts                 入口（薄壳：行缓冲读 stdin、写 stdout、诊断走 stderr）
mcp/README.md                  两种客户端的注册写法 + 一次真会话的复现步骤
src/lib/mcp/protocol.ts        JSON-RPC 编解码 + 方法派发（★ 纯函数，可测）
src/lib/mcp/tools.ts           七条工具（服务端）
src/lib/plan-tools.ts          规划那一步的四条工具，绑到 {store, owner, card}
src/lib/engine/tool-loop.ts    带工具的文本调用循环（工具是注入的）
src/lib/engine/providers/stub.ts  固定替身（从 scripts/engine-run.mts 抽出来共用）
scripts/probe-tool-calls.mts   探针（工单 01）
scripts/mcp-session.mts        会话记录 + 等价判据（工单 05）
```

★ `mcp/server.mts` 是 `.mts` 因此**不进 `pnpm typecheck`**（`tsconfig.json` 的 include 是
`**/*.ts`，实测 `.mts` 不在其中；`scripts/` 一直如此）。所以入口必须是一层**薄壳**，
逻辑全在 `src/lib/mcp/*.ts` 里——那边既过 typecheck 又跑 vitest。

---

## 七、不做

- **不引 MCP SDK**（见 ADR-0012）。
- **不做 `resources` / `prompts`**（见 3.2）。
- **不把插画当 image content 回给模型**：`read_book` 只回文本。让模型「看得见画」
  是另一件事（字节、缩放、成本都要定），不塞进这一轮。
- **不做 HTTP / SSE 传输**：只 stdio。
- **不做鉴权**：MCP server 是**本机操作员的工具**，身份来自 `--user=`。
  它不是公网接口——这一条写在 `mcp/README.md` 首段，不许含糊。
- **不动 `illustrate.ts` 的重画反馈回灌**（评分 §3.2 那条 ~20 行）：那是 Agent 栏的
  **另一笔**，一改就动了重画率与成本口径，得单独测。这一轮不夹带。
