# 05 · 会话记录 + 「同一本书、同一串事件」等价判据

Status: done（2026-10-19 收工：14/14 条过 · 逐字节等价 · 23 条事件逐条相同）
依赖：[04](04-server-entry.md)
依据：[spec §一 判据 2 / 3 / 5](spec.md)、先例 `src/lib/engine/split.test.ts`

## 要做的事

- [ ] 新建 `scripts/mcp-session.mts`：它**就是那个客户端**——
      起 `mcp/server.mts` 子进程，按协议走
      `initialize` → `notifications/initialized` → `tools/list` →
      `list_children` → `character_card` → `plan_book` → `illustrate_book` → `book_status`。
- [ ] 落两份产物到 `.out/mcp-session/`：
      `transcript.jsonl`（**双向**：发出去的与收到的，各带一个方向字段）
      与 `summary.json`（每一条请求的耗时、结果摘要、进度通知条数）。
- [ ] **等价判据**（判据 2，照 `split.test.ts` 那条写）：
      `--mode=stub` 下走 MCP 产出的
      `books/<id>/book.json` 去掉时间字段后与
      `node scripts/engine-run.mts --mode=stub --out=.out/engine-run` 的**逐字节相同**；
      `events.jsonl` 去掉 `at` 后**逐条相同**。
- [ ] **进度通知的判别对照**（判据 3）：
      一次带 `_meta.progressToken`、一次不带，数 `notifications/progress` 的条数。
      「给 token 收到 N 条、不给收到 0 条」才算过——只测其中一边测不出
      「永远发」与「永远不发」这两种坏法。
- [ ] **配套小重构**：把 `scripts/engine-run.mts` 里那份固定替身
      （`stubProviders` + demo 卡 + `scripts/fixtures/demo-plan.json`）抽到
      `src/lib/engine/providers/stub.ts`，两个入口共用。
      ★ 不抽的话，判据 2 比的是两百行重复代码里两份「恰好一样」的东西，
      而不是同一条代码路径——那条判据当天就失去意义。
- [ ] 等价判据要**跑两次都过**（同输入同产物），并把两次的指纹打在输出里。

## 验收

- [ ] `node scripts/mcp-session.mts` 退出码 0，`.out/mcp-session/` 两份产物齐
- [ ] 判据 2 的三条对比逐条打印「相同 / 不同」（不同就打印第一条不同的地方）
- [ ] 判据 3 的两边条数都打出来
- [ ] 判据 4 的负例：脚本里顺带打一次未知方法与一次不存在的 `bookId`，
      断言 `-32601` 与 `isError: true`
- [ ] 判据 5：`transcript.jsonl` 能被人从第一行读到最后一行看懂（它是给人看的证据）

## 不做

- ✗ 不把这份脚本塞进 vitest（它起子进程、落盘，是**验收脚本**不是单测；
  单测在 `src/lib/mcp/*.test.ts`）

## Comments

**2026-10-19 · 收工记录（14/14 条过）**

`node scripts/mcp-session.mts` —— 它自己起 `engine-run` 当对照臂、起 `mcp/server.mts`
当被测臂，按协议驱动，最后逐条判。产物：`.out/mcp-session/transcript.jsonl`（52 条双向消息）
与 `summary.json`。

### 判据 2：同一本书、同一串事件

```
✅ 两边的书号相同：xiaolu-r1-3befb9c2a76b
✅ book.json 去掉时间字段后逐字节相同：相同
✅ events.jsonl 去掉 at 后逐条相同（23 条）：相同
✅ 插画事件指的 6 个文件真的在盘上：6/6
```

★ 第四条是**后加的**，因为前三条能被一个假象满足：两串**都指向空气**的事件流
也是"逐条相同"的。所以要逐个 `stat` 一遍事件里那些 `assetPath`。

★ 时间字段的白名单（`TIME_KEYS`）是**按名字列的**：漏一个 → 这条判据永远不过；
多删一个 → 这条判据永远能过（**那更坏**）。每一项都要说得出它是哪来的时间。

### ★ 跑出来的两处真差异（都不是"哪边写错了"）

1. **对照臂读错了文件。** 第一版比的是 `engine-run` 的 `books/<id>/events.jsonl`
   ——而它**根本不写那个文件**：`engine-run` 是一次跑完的脚本，
   原始事件在它 `summary.json` 的 `eventsRaw` 里。于是读出 0 条 vs 23 条。
   改成读 `summary.json` 的 `eventsRaw`。
2. **对照臂少了一个开关。** 修完上一条之后是 21 vs 23，差的正好是
   `stage:retrieving` + `retrieved` 两条——因为**两边做的不是同一件事**：
   MCP 的 `plan_book` 每次都带检索器（与 `/api/books` 一样），
   而 `engine-run` 的检索是可选开关（它文件头写着"默认不开——这一条命令是架构验收"）。
   对照臂补上 `--retrieve` 之后一致。
   ★ 写进注释了：**这不是"为了让判据过而改对照臂"**，是让对照臂走产品那条路。

### 判据 3：进度通知的判别对照

```
✅ progressToken 给了 → 收 4 条，最后一条「故事编好了：《小宇的云》，5 页，1 个选择点」
✅ ★ 不给 → 0 条
```

两条都在同一场会话里跑：第一条 `plan_book` 带 token，第二条换一个主题、不带。
只测一半的话，一个"无条件发通知"的实现会全绿。

### 判据 4：空态与负例

```
✅ 未知方法 → -32601
✅ 不存在的书号 → isError + 「找不到书号 no-such-book 的故事草稿。先用 list_books…」
✅ 参数写错 → isError + 「form 只接受 solo / shared，收到「睡前版」」
```

### 判据 5：会话记录

`.out/mcp-session/transcript.jsonl`：52 条，双向各带一个 `dir` 字段，人能从头读到尾。
`.out/mcp-session/summary.json`：14 条判据 + 书号。
