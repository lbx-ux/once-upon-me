# MCP server 自写 JSON-RPC，不引官方 SDK

「MCP / 工具集成」（评分表 #6）落地时，把引擎接给外面的 AI 有两种做法：
引 `@modelcontextprotocol/sdk`，或**手写那六个方法的 JSON-RPC**。本项目选第二种。

★ 这是同一个判断的**第四次**（[ADR-0003](0003-pregenerated-assets-decouple-demo-from-api.md)
「预生成资产」→ [ADR-0007](0007-character-card-as-asset.md)「角色卡是文件资产」→
[ADR-0011](0011-index-is-a-file-not-a-vector-db.md)「索引就是一个文件」→ 本份）。
四次的题目不同，形状一样：**能落成一份可逐字节比对的东西，就别落成一台要运维的、
或者一层要跟着别人版本走的东西。** 前三次的"别人"是向量库与外部服务，
这一次是**一份正在快速演进的协议实现**。

**为什么不是 SDK**

① **协议面只有六个方法、一种传输。** `initialize` / `notifications/initialized` /
`ping` / `tools/list` / `tools/call` / `logging/setLevel`，全都走 stdio 上的一行一条
JSON-RPC。SDK 带来的是这一整套加上它自己的传输层、类型系统与一长串依赖——
而我们要的只是那六个方法。
② **返回协议本来就是我们自己的。** `events.ts` 的文件头写着
「同一串事件喂三个消费者：前端可视化、**MCP 工具返回**、过程日志」，
而 `describeEvent` 那句「放在引擎侧而不是 UI 侧：MCP 返回与日志也要同一句话」
就是为了这一天写的。工具回给客户端的那段文本**不是 SDK 的产物**，
是引擎侧已经定了形状的东西——SDK 能省的只有外面那层信封。
③ **它必须跑得起来而不用先建一次。** 与 ADR-0003 同一条：这一栏的演示路径要的是
`node mcp/server.mts --mode=stub` 在**断网、零成本**的情况下把整条路走完。
一份随仓库提交的 300 行实现，和一个要在 `node_modules` 里解析出正确版本的依赖树，
前者在评审当天能演示的概率更高。

**代价（照实写，不粉饰）**

- **协议版本要自己跟**。超集层（`resources` / `prompts` / `sampling`）与将来新增的
  通知语义，都得有人回来看一眼。今天只声明 `tools` + `logging` 两个能力，
  声明了就真实现（`logging/setLevel` 真的改阈值）。
- **兼容性只能靠一个真客户端摁着**。所以判据里有一条是
  `claude mcp list` 报 `✔ Connected`——**别人写的客户端**对我们手写的握手 + 工具表
  检查通过。这一条不过就翻案引 SDK。
- **`src/lib/mcp/protocol.ts` 是本仓测出来的**，不是抄文档抄的：
  「通知（不带 `id`）绝不回话」与「`id` 原样回」这两条各自对应一种真实的坏法
  （错配、卡住等一个永远不来的回复），它们都有单测。

- Status: accepted
- Considered Options: `@modelcontextprotocol/sdk`（官方实现，协议演进跟着它走，
  但为六个方法引一整棵树，且它管不着我们自己的返回协议）；
  **自写 JSON-RPC + 一个真客户端会话当判据**（选中）
- Consequences: ① 协议面自己守，翻案条件是判据 1（真客户端连不上）；
  ② `.mts` 入口**不进 `pnpm typecheck`**（`tsconfig.json` 的 include 只写到 `.ts`），
  所以 `mcp/server.mts` 必须是**薄壳**，逻辑全在 `src/lib/mcp/*.ts` 里——
  那边既过 typecheck 又跑 vitest；③ 只做 `tools` + `logging`，
  `resources` / `prompts` 不声明、不预铺（声明了而不实现是这一层最容易留下的一种谎）
