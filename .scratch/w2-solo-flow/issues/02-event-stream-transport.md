# 02 · Agent 事件流架构：传输、落盘、重放（⛔ #2 的 8 分 + #17 的 3 分压在它上面）

Status: done（2026-10-14 凌晨；唯一挪后的是两条**界面层**的复现，见验收表）
依赖：无（判决见 [01](01-adr0004-threshold.md)，**两单互不阻塞**）

## 背景

协议已经有了：[`engine/events.ts`](../../../src/lib/engine/events.ts) 定义了事件形状、
`seq`/`at` 的工厂、`isDisplayable`（哪条该占一行）与 `describeEvent`（一句话人话）。
那份文件头写着"传输（SSE / ReadableStream）不在这里，在 app/api 那一层"——
**这一单就是把那一层建出来**。

W1 交付时能验证的只有"node 脚本按顺序拿到事件"。缺的三件事：
**跨进程传**（浏览器要看得见）、**落盘**（刷新/断线/演示回放要有东西可放）、
**界面消费**（事件不是给开发者看的一串 log，是产品要展示的东西）。

## 一、帧形状（先定这个，别的一起跟着定）

SSE 的 `event:` 名分两类：

| 帧              | `data:` 内容               | 进不进 `events.jsonl` | 谁看                      |
| --------------- | -------------------------- | --------------------- | ------------------------- |
| `event: engine` | 一条 `EngineEvent`（JSON） | **进**                | 过程面板、MCP、日志、重放 |
| `event: delta`  | 展示用增量（工单 07）      | **不进**              | 只有正在看着屏幕的那个人  |

★ 为什么增量不落盘：落盘的判据是"**重放这份日志必须能重建出同一串界面状态**"。
token 级增量满足不了这条（重放时打字机动画没有意义，而且日志会从几十行变成几十万行），
它对"过程理解"没有增量价值——每 200ms 一条"正在写第 3 页"才有。
把两个不同寿命的东西塞进一个通道，结果一定是日志被废掉。

★ 两条通道**是同一个 seam**（`engine/index.ts` 的 `RunDeps`），只是两种帧：
不许在 app 层另起一条独立的进度通道——那就成了第三个消费者各接一根线。

## 二、做什么

### 2.1 Route Handler

`POST /api/books` → `Content-Type: text/event-stream`，body 是表单（含模型与密钥，
工单 [03](03-model-and-key.md)）。内部：拼 `Env` → `createProviders` → `runBook`，
把 `onEvent` 推进一个 `ReadableStream`。

- **不用 `EventSource`**（它只支持 GET，而带密钥的请求必须是 POST，密钥不许进 query string：
  query 会进服务器访问日志、进浏览器历史、进 Referer）。客户端走
  `fetch` + `response.body.getReader()` + 一个自写的 SSE 帧解码器。
- **不引 SSE 库**（`eventsource-parser` 那一类）。帧格式就三行（`event:` / `data:` / 空行），
  自写的成本比核对一个库的行为更低——而且它与工单 01 的量法有关，属于"自写的行数"那一栏。
- 后端要显式关掉缓冲：`Cache-Control: no-cache, no-transform`、`X-Accel-Buffering: no`
  （反向代理会攒够一批才吐，症状是"事件一次性全到"，看起来像引擎没吐事件）。

### 2.2 落盘

`books/<bookId>/events.jsonl`，一行一条 **engine** 事件，**事件一产生就 append**
（不是跑完再写：跑完再写等于中断时什么都不剩，而"中断"正是最需要日志的时候）。

书号是"卡 + 主题指纹"，不含时间戳，所以重跑同一本书会写进**同一个目录**。
第二轮开跑时**截断**旧日志（不是追加）——否则重放会把两轮混成一条时间线。

### 2.3 重放

`GET /api/books/<bookId>/events`：读 `events.jsonl`，**按同一个帧格式**原样吐回去。
前端刷新后的顺序：

1. 先重放日志（把已经发生过的过程画出来）
2. 再看 `books/<bookId>/book.json` 在不在：
   - 在 → 完成，展示成品与"进入阅读"入口
   - 不在 → **这一轮没有跑完**，页面如实这么说 + 给重试入口

★ 这一条是这一单最容易写错的地方：**不许把"没有 book.json"显示成"还在生成中"**。
界面上一个永远转下去的圈，比一句"这一轮没有完成"糟糕得多——前者在撒谎，
后者在请用户做一件事。同理，重放结束后**不许**接着摆一个空的进度条等新事件。

### 2.4 断线与并发

- **不做**断线续传（不做 `Last-Event-ID`、不做服务端脱离请求继续跑）。
  客户端断开 = 这一轮放弃。已落盘的资产与日志留在盘上，页面显示"这一轮没有完成"。
  ★ 明写在这里是因为"看起来像在后台接着跑"是很容易无意中做出来的效果
  （比如在服务端起了个不受请求生命周期约束的任务）——**不许无意中做出来**。
- 同一 `bookId` 同时只允许一轮生成在跑（进程内的 in-flight 集合）。
  书号一样 = 目录一样，两轮同参会互相覆盖文件、把日志写乱。
  撞上时的文案要说人话："这本书正在生成中——等它跑完再点，或者改一个主题再试。"

## 三、验收

- [x] SSE 帧编解码往返：事件 → 帧 → 事件，逐字段相等（纯函数，进工单 [09](09-validation-tdd.md) 的 tdd 范围）
      → `src/lib/sse.test.ts` 13 条（含逐字节喂、CRLF、多行 data 跨 chunk 切开）+ `event-log.test.ts` 9 条
- [x] 真跑一本：把 SSE 原始字节存下来，与 `events.jsonl` 逐条对照——
      **engine 帧逐条相等，delta 帧一条都不在 jsonl 里**
      → `node scripts/web-run.mts --pages=3`：17 条 ↔ 17 条，逐条相等；delta 0 条
- [~] 刷新一次生成中的页面：看到的是已发生的日志 + "这一轮没有完成"，不是转圈
  → **接口层已验**（跑动中 `running:true`、同一本书并发 POST 回 409、跑完后
  `running:false / bookReady:true`）。**界面层的复现挪到 [04](04-creation-flow.md) / [05](05-generate-orchestration.md)**
  ——那两单才有页面可刷。另留了一个真实样本：`.out/web/books/xiaoyu-r1-73cdf2d0051a/`
  有日志、没有 `book.json`（我改文件时 HMR 把这轮打断了），正好当"没跑完"的夹具
- [x] 跑完一本后刷新：日志重放 + `book.json` 存在 → 状态帧 `bookReady:true` ✓
- [x] **密钥不出现在 SSE 与 jsonl 的任何位置**（与工单 [03](03-model-and-key.md) 共用同一条检查）
      → 脚本每次跑都查：完整值 + 前 8 字符，线上流与日志两处都 0 命中
- [x] `pnpm build` 过（本仓库第一次有 Route Handler，Node-only import 要在构建期炸）
      → 两条路由都是 `ƒ (Dynamic)`，各 127 B（引擎没被拖进任何 bundle）
- [x] `lib/engine/` 仍不 import React：`eslint.config.mjs` 那条规则没被放宽
- [x] 另加一条工单里没写、但实测必须有的：**per-request `Env` 的优先级**
      → 请求体把 `VISION_MODEL` 送成空串（服务端 `.env.local` 里有值），三页全部走"未核对" ✓

## 四、边界

- **不改事件协议的形状**。`events.ts` 是三个消费者共用的接口，改它要走 ADR。
  这一单只加传输与落盘。若做 06/07 时发现协议真缺一个变体（比如"这一页缺"要有专门的事件），
  那是**单独一次提交**，并在 `events.ts` 的注释里写清是谁在消费它。
- 不做鉴权、不做多用户、不做并发多本书。这一周的形态是单机演示（W5 的部署另说）。
- 不做服务端事件推送的持久连接保活（心跳注释行）。本机演示的对象是浏览器与 localhost，
  没有中间代理会掐空闲连接；真上线遇到再加，并在这里记下为什么加。

## Comments

**2026-10-14 凌晨 · 落地记录**

代码：`src/lib/sse.ts`（帧编解码，纯）· `src/lib/book-stream.ts`（帧协议）·
`src/lib/event-log.ts`（落盘日志）· `src/lib/book-api.ts`（请求契约，纯）·
`src/lib/books-runtime.ts`（资产根 + 在跑账本）· `src/app/api/books/route.ts` ·
`src/app/api/books/[bookId]/events/route.ts` · `scripts/web-run.mts`（验收脚本）。

引擎侧**没有改行为**，只加了三处导出（工单 [01](01-adr0004-threshold.md) 第一条判据的现场）：
`bookIdOf` / `bookDirOf` / `manifestPathOf`（让 app 层不必自己拼 `books/<id>/…`），
`asEngineError`（消费者要把异常规约成 `code`+人话），`BOOK_FORMS` 与 `AgeBand`
（表单要能枚举合法值，而不是抄一份字面量）。`git diff src/lib/engine/*.ts` 里没有一行逻辑改动。

### 实测

| 项                              | 数                                                                  |
| ------------------------------- | ------------------------------------------------------------------- |
| 线上 engine 帧 ↔ 日志           | 17 ↔ 17，逐条相等（`JSON.stringify` 级）                            |
| delta 帧                        | 0（工单 [07](07-streaming-text.md) 还没做，通道先建好了）           |
| 密钥泄漏                        | 0 命中（完整值 + 前 8 字符，线上流与日志两处）                      |
| 重放接口喂"1 条好的 + 1 条半行" | 解出 1 条，`skippedLines: 1` ✓                                      |
| per-request `Env` 优先级        | 请求体送空 `VISION_MODEL` → 3 页全"未核对" ✓（`.env.local` 里有值） |
| 3 页 · 比对开着 · 1 次重画      | **455.6s**（≈2.5 分钟/页）                                          |
| 3 页 · 比对关掉                 | **77.7s**（≈26 秒/页）                                              |

★ 后两行是**串行整本耗时**的第一批数（工单 [05](05-generate-orchestration.md) §三 要它）：
**比对调用是主要开销**，不是出图。关掉比对快 6 倍。这条一并抄进 05 的 Comments。

### 翻出来的两个问题（都不是这一单本来要做的）

1. **在跑的账本不能是模块级变量**（已修）。第一版 `const running = new Set()` 写在模块里，
   实测：`POST /api/books` 正在跑时 `GET /api/books/<id>/events` 回的是
   `{"running": false}` —— **每个 Route Handler 在 dev 下各自编译、各自实例化模块**，
   模块级变量不跨路由共享。症状本来会是"连点两次都开跑、日志交叉写入、成品被覆盖"，
   而并发保护那行代码看上去完全正确。改成挂 `globalThis`（`Symbol.for` 做键）后实测
   `running:true` 与 409 都对了。理由写进了 `books-runtime.ts` 的文件头。
2. **`BookStats.totalCostCny` 恒为 0**（**没修，另开工单**）。起因是我拿它当
   "per-request Env 生效"的探针（送一个不同的单张成本，看账目跟谁走），结果两种取值都对不上。
   查下来：`illustrate.ts` 返回 `Illustration` 时**没有带上 `costCny`**，
   而 `index.ts` 的 `summarize()` 是在 sum `item.costCny ?? 0`。所以每本书的
   `book.json` 都写着成本 0，而 W1 的 `engine-run.mts` 早有一句
   "机器读数常年是 0，打出来是**假数**"——当时只是决定不打印，没往上游查。
   ★ 探针的教训同 README §五 第三类：**拿一个恒零的量当判据，是拿更弱的事实回答更强的问题**。
   已换成"送空值 → 看行为变不变"。

### 顺带改到的三处（不属于这一单，但为它服务）

- `scripts/dev-preview.mjs`：加 `--dist=` / `--port=`，并把 `spawn('next', …, {shell:true})`
  换成直接跑 next 的入口。后者是因为启动器是**直接 `node` 调它**的（不走 pnpm），
  而 `node_modules/.bin` 在 PATH 里是 pnpm 给的，实测报 `'next' 不是内部或外部命令`。
- `.gitignore`：`/.next*/` 取代逐个列的三个产物目录。每条会话一个目录，
  逐个列的后果是**忘了补一行就把构建产物提交了**（同一条道理在 eslint 与 prettier 的
  ignores 里已经写过两次）。
- `tsconfig.json`：我的 dev server（`.next-w2`）按 Next 的行为把它的 types 写进了 `include`，
  已把那一行摘掉并格式化。★ 这条是**并行会话的固有摩擦**：每个 dev server 都会改这个文件，
  谁最后跑谁改。目前是摘掉自己那行、格式化一次收工。
