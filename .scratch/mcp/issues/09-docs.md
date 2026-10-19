# 09 · 文档回填：这一栏的交付物一半在文档里

Status: done（2026-10-19：ADR-0012/0013 · known-tradeoffs 三笔 · GLOSSARY · README）
依赖：其余全部
依据：[spec §一](spec.md)

## 要做的事

- [ ] `docs/adr/0012-mcp-server-handwritten-jsonrpc.md`：
      不引 `@modelcontextprotocol/sdk` 的理由与**代价**（协议版本、通知语义、
      错误码都要自己守），翻案条件是判据 1。形状照 ADR-0011（「索引就是一个文件」）
      ——同一个判断的第四次。
- [ ] `docs/adr/0013-tool-calling-is-a-measured-arm.md`：
      工具调用是**可量测的第三臂、默认关**，与 ADR-0005 同一条纪律。
      把判据 7 的实测数字填进去（**含不显著时的 MDE**）。
- [ ] `docs/known-tradeoffs.md` 三笔：
  - **MCP server 与 web 是两个进程，进程内租约不共享**——同一本书可能被两边
    同时开跑，`events.jsonl` 交叉写入。最小缓解是「`book.json` 已在就拒画」。
    **不假装解决了**。
  - **自写 JSON-RPC 的兼容性风险**。
  - **`illustrate_book` 是异步的**：客户端断开 → 进程退出 → 这一轮跟着死；
    而同步那条路在任何客户端上都必然超时。两害相权选了前者。
- [ ] `GLOSSARY.md` 新词（至少：MCP 工具、工具循环、规划工具、会话记录）
- [ ] `README.md`：§二 目录结构加 `mcp/` 与 `src/lib/mcp/`；
      §三 脚本表加 `mcp` / `probe-tool-calls` / `mcp-session`
- [ ] `.env.example`：`LLM_*` 那一段加一行实测注释（工单 01 的结论）
- [ ] `E:\compete\计划表.md` 的 B2 打勾（`[x]` 的判据是拿得出产物——
      产物是 `.out/mcp-session/` 与三臂报告，不是"写完了"）

## 验收

- [ ] 三条闸门 + 测试：`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`
- [ ] README 里每一句关于 MCP 的话都能在代码里指到出处（**不许有一句只活在文档里**）
- [ ] 首页没有引入任何新资产（这一轮不动美术）

## 不做

- ✗ 不写"商业文档"那一部分（B4 是另一笔）
- ✗ 不改 README §一 的项目介绍（产品定义那边没变）
