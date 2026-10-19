# 小主角 · MCP server

把「小主角」的绘本引擎按 [MCP](https://modelcontextprotocol.io) 协议暴露出去，
让 Claude Desktop / Claude Code 这样的客户端能**看得见**这个家庭的书架，
并真的编一本、画一本。

这一层不是新写的一条流水线：它包的是 `src/lib/engine/` 那四个动作
（`buildCharacterCard` / `planBook` / `illustrateBook` / `runBook`），
而过程走的是 `events.ts` 那份**早就在那儿的事件协议**——
那个文件头上写着「同一串事件喂三个消费者：前端可视化、**MCP 工具返回**、过程日志」，
这里就是它承诺过的第三个消费者。

---

## 先读这三条

1. **它是本机操作员的工具，不是公网接口。** 身份来自 `--user=<userId>`，
   没有登录、没有鉴权。它按那一行的 userId 去读 `<ASSET_ROOT>/u/<userId>/` 那一片资产。
   **不要**把它挂到任何别人连得上的地方。
2. **`--mode=live` 会真的花钱。** 出图实测 ≈154 秒、0.20 元一张，一本 20 页的书要几十分钟。
   想先看看它长什么样，用 `--mode=stub`——那一档**一分钱不花**，
   它用仓库里那份固定替身（`src/lib/stub-fixture.ts`）把整条路走完。
3. **`illustrate_book` 是异步的。** 它立刻返回「开工了」，进度靠 `book_status` 收。
   理由：一本 20 页的书要几十分钟，任何客户端的工具超时都撑不过去——
   让一个**必然超时**的工具存在，就是把这一栏做成一次演示事故。
   代价是**别关客户端**：这个进程一退，那一轮就断了。

---

## 起法

```bash
node mcp/server.mts --user=1 --mode=stub
```

| 开关                         | 说明                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `--user=<userId>`            | **必填**。没有它当场拒绝启动（`asset-scope.ts` 那条"防的不是攻击者，是防我们自己忘了那道闸"）                                                 |
| `--mode=stub\|offline\|live` | 缺省 `live`。`stub` = 仓库里的固定替身（不花钱）；`offline` = 回放录好的 manifest（要 `--manifest=`）；`live` = `.env.local` / 管理页配的模型 |
| `--asset-root=<path>`        | 缺省是 `ASSET_ROOT` 环境变量，再缺省 `.out/web`                                                                                               |

`--mode=stub` 会顺手把这一档要的那个孩子（小宇）与他的角色卡**摆好**——
看不见孩子的演示等于没走这条路。

---

## 注册到客户端

### Claude Code

```bash
claude mcp add xiaozhujue -- node mcp/server.mts --user=1 --mode=stub
claude mcp list
```

仓库根上跑（`node` 要 ≥ 22.18：它靠原生类型剥离直接跑 `.mts`）。
加完之后可以 headless 问一句：

```bash
claude -p "用 xiaozhujue 看看这个账号下有哪些孩子"
```

### Claude Desktop

编辑 `claude_desktop_config.json`
（macOS：`~/Library/Application Support/Claude/`；Windows：`%APPDATA%\Claude\`）：

```json
{
  "mcpServers": {
    "xiaozhujue": {
      "command": "node",
      "args": ["mcp/server.mts", "--user=1", "--mode=stub"],
      "cwd": "E:/project/once-upon-me"
    }
  }
}
```

★ **`cwd` 必须给仓库根**：`.env.local`、`scripts/fixtures/demo-plan.json`、
`public/book/` 都是相对当前目录找的（与 `scripts/engine-run.mts` 同一条约定）。

---

## 七条工具

| 工具              | 干什么                                                         | 花钱             |
| ----------------- | -------------------------------------------------------------- | ---------------- |
| `list_children`   | 这个账号下的孩子（名字 / 年龄档 / 兴趣 / 有没有形象）          | 不花             |
| `character_card`  | 一个孩子的角色卡：锚点 + **画师真正会拿到的那一段** + 核对清单 | 不花             |
| `list_books`      | 书架（书号 / 书名 / 形态 / 读到几页 / 做到哪一步）             | 不花             |
| `read_book`       | 一本书的正文全文（含画面场景与选择点）                         | 不花             |
| `book_status`     | 做到哪一步：最近的若干条过程（人话）+ 计数                     | 不花             |
| `plan_book`       | 编一版故事（**不画图**）                                       | 一次文本调用     |
| `illustrate_book` | 按盘上那版故事出图（**异步**）                                 | **每页一次出图** |

前五条只读本地，所以**没配模型密钥也读得动**——`providers` 是惰性建的，
只有后两条才会去要密钥。

### 一次典型的会话

```
你：给小宇做一本关于恐龙的独读版绘本

Claude：→ list_children           （看看有没有叫小宇的、他多大了）
        → character_card          （他长什么样，画面描述才好对齐）
        → list_books              （他读过什么，别重复）
        → plan_book               （编一版；进度条上会一行行过）
        ← 《小宇的恐龙朋友》，书号 xiaolu-r1-xxxx，7 个节点

Claude：故事编好了，念给你听……（把正文贴出来）
        要现在出图吗？大概 3 分钟、7 张。

你：出

Claude：→ illustrate_book         （立刻返回"开工了"）
        → book_status             （隔一会儿问一次）
        ← 已经画完
```

★ 「要现在出图吗」这一步不是协议要求的，是**产品该有的**：
出图是这条流水线上唯一真花钱的一步。工具描述里写清了代价，
所以模型自己会先问一句——如果它不问，那是提示词该改，不是客户端的问题。

---

## 它怎么保证没有骗人

`node scripts/mcp-session.mts` 会起一个真的 server、按协议驱动它，
把 14 条判据逐条打出来。其中三条是承重的：

1. **同一本书、同一串事件**：走 MCP 编出来+画出来的 `book.json`
   去掉时间字段后与 `node scripts/engine-run.mts --mode=stub --retrieve` **逐字节相同**，
   `events.jsonl` 去掉 `at` 后**逐条相同**（23 条）。
   ——两者共用同一份固定替身（`src/lib/stub-fixture.ts`），所以这条判据比的是
   **同一条代码路径**，不是两份"恰好一样"的代码。
2. **进度通知是判别对照**：给 `progressToken` 收得到、**不给就一条都没有**。
   只测一半的话，一个"无条件发通知"的实现会全绿。
3. **插画事件指的是真的文件**：事件流里那 6 个 `assetPath` 逐个 stat 一遍。
   少了它，"同一串事件"可以靠两串**都指向空气**的事件流满足。

会话记录落在 `.out/mcp-session/`：`transcript.jsonl`（双向）+ `summary.json`。

---

## 已知的坑（不假装解决了）

- **MCP server 与 Next 是两个进程，进程内租约不共享。** 同一本书可能被两边同时开跑，
  `events.jsonl` 会交叉写入。本进程内挡得住（`running` 那张表），跨进程挡不住。
  最小缓解是「`book.json` 已在就拒画」，与网页那条 409 同一条。
- **客户端断开 → 这一轮跟着死**（异步那条的代价，见上面）。
- **自写 JSON-RPC 的兼容性风险**：协议版本、通知语义、错误码都要自己守，
  靠一个真客户端的会话摁着。翻案条件见 ADR-0012。
