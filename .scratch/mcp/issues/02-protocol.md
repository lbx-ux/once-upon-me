# 02 · MCP 协议层：JSON-RPC 编解码 + 方法派发（纯函数）

Status: done（2026-10-19 收工：32 条测试 · 零依赖 · 真客户端握手通过）
依赖：无（与 01 并行可做）
依据：[spec §三.1](spec.md)、[ADR-0012](../docs/adr/0012-mcp-server-handwritten-jsonrpc.md)

## 要做的事

- [ ] 新建 `src/lib/mcp/protocol.ts` + `src/lib/mcp/protocol.test.ts`。
      手写 JSON-RPC 2.0 的**行式**编解码（MCP 的 stdio 传输 = 一行一条消息）。
- [ ] 六个方法：
      `initialize` / `notifications/initialized` / `ping` / `tools/list` /
      `tools/call` / `logging/setLevel`。
- [ ] `initialize` 的**版本协商**：认得 `2024-11-05` / `2025-03-26` / `2025-06-18`；
      客户端要的那一个在表里就回它，不在就回我们最新的那一个。
- [ ] `capabilities` 老实报：`{tools:{}, logging:{}}`。
      **不报 `resources` / `prompts` 就别声明它们**——声明了而不实现，
      是这一层最容易留下的一种谎。
- [ ] **通知（不带 `id`）绝不回话**。这是 MCP 实现里最常见的坏法，
      症状是客户端把一条响应错配到一条通知上，然后整条会话开始错位。
- [ ] `id` 原样回（数字与字符串都要原样，不许 `String(id)`）。
- [ ] 非法 JSON 一行 → 回 `-32700` 并**继续读下一行**，不退出。
- [ ] 未知方法 → `-32601`。参数形状不对 → `-32602`。
- [ ] **没 `initialize` 就 `tools/call` 要报错**（`-32002` 那一档）。
- [ ] 它是**纯的**：喂一行字符串 → 出一组待写出的字符串。**不碰 stdin / stdout**，
      不读 `process.env`。进程那一侧全在 `mcp/server.mts`（工单 04）。

## 验收

- [ ] `pnpm test` 里 `src/lib/mcp/protocol.test.ts` 全绿，且至少覆盖：
      通知不回、`id` 原样回（两种类型）、版本协商的三条分支、非法 JSON、
      未知方法、未初始化就调用
- [ ] `pnpm typecheck` 过（它在 `src/` 下，两个 config 都会扫到它）
- [ ] 这个文件里 `grep -c "process\."` = 0

## 不做

- ✗ 不做 HTTP/SSE 传输（只 stdio）
- ✗ 不做 `resources` / `prompts` / `sampling`
- ✗ 不引 `@modelcontextprotocol/sdk`

## Comments

**2026-10-19 · 收工记录**

`src/lib/mcp/protocol.ts`（零依赖、不碰 `process`）+ `protocol.test.ts` **32 条全绿**。
六个方法、版本协商三分支、通知不回话、`id` 原样回、非法 JSON 继续读，都在测试里。

### ★ 这一单被抓到的两个真 bug（都是测试抓的，不是读出来的）

1. **块注释里的 `**/*.ts` 把注释提前闭合了。** 文件头写「`tsconfig.json` 的 include
   只写到 `**/*.ts`」——而 `*/` 正好出现在那个 glob 里，于是整份文件解析失败
   （报错指向第 14 行的一个中文逗号，离真凶很远）。改成「只写到 `.ts`」。
   ★ 这一类错在**注释里**，所以任何只跑测试不看输出的人都不会发现它是什么原因。
2. **`return { session, logLevel: level }, notes` —— 逗号运算符。**
   整个返回值是 `notes`（一个数组），等级**根本没生效**，
   而 `dispatch` 的返回类型在调用处被当作对象用，读 `outcome.session` 得到 `undefined`。
   症状会是"`logging/setLevel` 回了 200 但什么都没变"——一条不会崩、只是不work 的路径。
   抓它的是那条"合法等级被接受，并且**真的改了阈值**"的用例（后半句是判据）。

### 判据

| 判据                        | 读数                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| 通知（不带 `id`）一条都不回 | ✅ 含"握手之前来的通知"那一格                                         |
| `id` 原样回（数字与字符串） | ✅ 且两条**不相等**（未被归一）                                       |
| 版本协商三条分支            | ✅ 认识的回它、不认识的回最新的、没报的也回最新的                     |
| 只声明真实现了的能力        | ✅ `['logging','tools']`（**没有** resources / prompts）              |
| 未初始化就 `tools/call`     | ✅ `-32600`（不是借来的 `-32002`——那个在规范里是 Resource not found） |
| 工具的失败 vs 协议错误      | ✅ `isError:true` 与 `-32603` 分开                                    |
| 进度通知的判别对照          | ✅ 给 token 收得到、不给 0 条（**两边都测**）                         |
| 通知排在响应前面            | ✅ 单独一条用例                                                       |

`pnpm test` 128 条相关用例全绿；`pnpm typecheck` 两个 config 都过。
