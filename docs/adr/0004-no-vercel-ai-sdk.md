# 不引 Vercel AI SDK，生成过程的事件流自己写

官方技术栈表把 Vercel AI SDK 列成「推荐首选」，所以这条要解释为什么不用。
它的价值集中在 React 侧：`useChat` / 生成式 UI / 工具调用结果的流式渲染——
**为对话式界面设计的**。而本项目的形态不是对话：一轮创作是一条
「规划 → 逐页生成 → 逐页校验 → 重画」的**批处理流水线**，前端要的是
`{page: 7, stage: 'illustrating'} / {page: 9, stage: 'retrying', reason: '相似度 0.71'}` 这种
自定义事件，不是 message 数组。三条理由：

1. **引擎不许 import React**（`lib/engine/` 的硬约束，验收方式是 node 脚本跑完整本生成），
   而 AI SDK 的收益恰恰长在 React 那一侧。
2. **供应商是国内的**，且都走 OpenAI 兼容 HTTP。中间加一层 SDK 只是多一个
   要知道内部实现才能调对的依赖。
3. **事件协议是自研的**：它同时要喂前端可视化、喂 MCP 工具返回、喂技术文档里的
   过程日志。套进通用消息模型反而要绕。

留一条翻案条件而不是把话说死：**若 W2 首周实测发现"流式解析 + Schema 校验 + 重试"
这三样自己写超过约 200 行且开始重复**，再引 `ai` 核心包（它是框架无关的，
只用它的 `streamText` / `generateObject`，不引 React 那一半）。ADR 状态就是为这种情况留的。

- Status: proposed（W2 首周确认或推翻）
- Considered Options: 用 Vercel AI SDK 全量（多一个运行时依赖 + 与"引擎不碰 React"的主张冲突）；用 LangChain.js（更重，链式抽象层对一条固定流水线是纯负担）
- Consequences: 结构化输出、重试、流式解析这三件事要自己写，并各自有测试缝
  （`tdd` 的适用范围正是这些**确定性校验逻辑**，不是模型输出本身）
