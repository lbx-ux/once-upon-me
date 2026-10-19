# 04 · stdio 入口 + 两种客户端的注册说明

Status: done（2026-10-19 收工：Claude Code `claude mcp list` 报 ✔ Connected）
依赖：[02](02-protocol.md) [03](03-tools.md)
依据：[spec §三](spec.md)、[spec §六](spec.md)

## 要做的事

- [ ] 新建 `mcp/server.mts`（**薄壳**）与 `mcp/README.md`。
- [ ] ★ 为什么是薄壳：`.mts` **不进 `pnpm typecheck`**
      （`tsconfig.json` 的 include 是 `**/*.ts`，实测 `.mts` 不在其中——`scripts/` 一直如此）。
      所以这里只允许有「行缓冲读 stdin / 写 stdout / 组装 ctx」，
      **一行业务逻辑都不许有**，否则它就在闸门之外。
- [ ] stdin 按行缓冲（**不许假定一次 `data` 就是一条消息**；分包是常态）；
      stdout 只写协议消息 + `\n`；**诊断一律走 `process.stderr`**——
      往 stdout 多写一个字，客户端那一侧的 JSON-RPC 就断在半句话上。
- [ ] 开关：`--mode=live|offline|stub`（缺省 `live`）、`--user=<userId>`、
      `--asset-root=<path>`（缺省走 `lib/books-runtime.ts` 的 `assetRoot()`）。
- [ ] 归属：`createUserStore(assetRoot(), userId)` + `ownerOf(userId)`。
      **没有 `--user=` 就当场拒绝启动**并打一句人话——
      `asset-scope.ts` 那条「防的不是攻击者，是防我们自己忘了那道闸」同一个道理。
- [ ] 事件 → 通知（两条一起）：
  - `_meta.progressToken` 有值 → `notifications/progress`
    `{progressToken, progress: event.seq, message: describeEvent(event)}`
  - `isDisplayable(event)` 且等级够 → `notifications/message`
    `{level:'info', logger:'xiaozhujue', data: event}`
- [ ] `logging/setLevel` 真的改阈值（实现了才声明 `logging` 能力）。
- [ ] `mcp/README.md`：Claude Desktop 的 `claude_desktop_config.json` 写法 +
      Claude Code 的 `claude mcp add` 写法 + 一次真会话的复现步骤。
      **首段必须写清**：这是**本机操作员的工具**，身份来自 `--user=`，不是公网接口；
      `--mode=live` 会真的花钱（出图 0.20 元/张）；`illustrate_book` 前客户端会弹权限确认。
- [ ] `package.json` 加 `"mcp": "node mcp/server.mts"`。

## 验收

- [ ] 手敲一次：`echo '<initialize 那一行>' | node mcp/server.mts --user=1 --mode=stub`
      能回一行合法的 JSON-RPC（**这是"真能跑"的最小证据**）
- [ ] `stderr` 与 `stdout` 分开验：随便走一条会打日志的路径，
      确认 stdout 里**只有**协议消息（`node mcp/server.mts ... 2>/dev/null | jq .` 全过）
- [ ] 不给 `--user=` 时退出码非 0 且 stderr 有一句人话

## 不做

- ✗ 不做鉴权、不做 HTTP 传输
- ✗ 不在 `.mts` 里写任何判据（它验不了，逻辑全在 `src/lib/mcp/`）

## Comments

**2026-10-19 · 收工记录**

`mcp/server.mts`（薄壳）+ `mcp/README.md` + `package.json` 的 `mcp` / `mcp:session`。

### ★ 真客户端的读数

```bash
claude mcp add xiaozhujue -- node mcp/server.mts --user=1 --mode=stub
claude mcp list
#   xiaozhujue: node mcp/server.mts --user=1 --mode=stub - ✔ Connected
```

**✔ Connected 是这一单最硬的一条**：它是**别人写的客户端**对我们手写的 JSON-RPC
做的握手 + 工具表检查，通过了。判据 1 的"能连上"这一半有了。

★ **但"模型真的调了工具、拿到盘上的书名"那一半这一台机器上没跑成**：
`claude -p "……"` 回的是 `Not logged in · Please run /login`——
这个 shell 里的 `claude` 没有登录态（桌面 App 走的是另一条授权路）。
所以判据 1 记成**一半**，补法写在下面，**不许记成全过**（这一栏最忌讳的就是这个）。

补法（在已经登录的那台机器上，仓库根）：

```bash
claude mcp add xiaozhujue -- node mcp/server.mts --user=1 --mode=stub
claude -p "用 xiaozhujue 看看我书架上有哪些书，只列书名" --allowedTools "mcp__xiaozhujue"
```

**判据**：输出里出现 `.out/web/u/1/books/` 下**真有的**书名
（实测那一片里有《黑夜里的光》《影子坐下了》《小满会飞了》三本）——
只有真读了盘才会不同。★ 换成别的 `--user=` 应当**列不出**这三本（那是归属那一道的对照）。

### 三条实现上的处置

1. **`.env.local` 要自己读**：`serverEnv()` 只认 `process.env` 与管理页那份
   `models.runtime.json`，而裸 node 进程不会自动加载 `.env.local`。
   复用 `scripts/env.mts` 的 `readEnv`，不另写一份。
2. **stdin 按行缓冲**，一次 `data` 不一定是一条消息（分包是常态）；
   逐行派发**串成一条链**——不串的话两条消息的响应可能交错，
   而客户端按 `id` 配对，错配之后整条会话开始漂。
3. **诊断全走 stderr**。实测验过：`2>/dev/null` 之后 stdout 里**只有**协议消息。

### 判据

| 判据                    | 读数                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| 真客户端连得上          | ✅ `✔ Connected`                                                            |
| stdout 里只有协议       | ✅ 手敲三条消息，逐行都是合法 JSON-RPC                                      |
| 不给 `--user=` 当场拒绝 | ✅ 退出码 2 + 一句人话                                                      |
| 端到端跑得起来          | ✅ `list_children` → `plan_book` → `illustrate_book` → `book_status` 全线通 |
