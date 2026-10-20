# 正确性通读 · TODO 清算 · 质量收口（2026-10-20）

一次面向正确性的全面检查。工作区起点是干净的（`git status` 无改动），
所有改动都在 `src/` 内，`server/`（Java）只读。

**一句话结论**：这个仓库的注释密度与"已经付过学费的地方"写得很实，通读下来
**没有发现会让功能整体失效的缺陷**；找到 4 条真问题（**4 条全部已修**——其中那条
租约泄露按你选的口径先补了路由测试脚手架），外加 2 条低危记录。
TODO 池**已经排干**（详见 §3）。

| 桶                       | 条数 | 去哪      |
| ------------------------ | ---- | --------- |
| 已修复（带回归测试）     | 4    | §1.1–§1.4 |
| 质量收口（命名/注释）    | 2    | §4        |
| 待决策                   | 0    | ——        |
| 未决（低危，附验证路径） | 2    | §2.1      |
| 已排除（查过、不是问题） | 9    | §2.2      |

> ★ 交付后追加的一轮（2026-10-20 当天）：你选了"先补路由测试脚手架再改"（B 方案），
> 于是 §1.4 那条从"待决策"变成了"已修复 + 端到端用例"——**本仓库第一批驱动
> Route Handler 的测试**就是那一轮长出来的。

---

## 0. 两次全量校验

**基线**（动手之前，`.out/baseline.log`）

```
=== TYPECHECK === $ tsc --noEmit && tsc --noEmit -p tsconfig.engine.json   EXIT=0
=== LINT ===     $ eslint .                                               EXIT=0
=== FORMAT ===   All matched files use Prettier code style!               EXIT=0
=== TEST ===     Test Files 102 passed (102) · Tests 1404 passed (1404)   EXIT=0
=== BUILD ===    ✓ Compiled successfully in 16.5s · 静态页 6/6             EXIT=0
```

**最终**（全部改动落地之后；每一格的退出码都是**直接取那条命令的**）

```
=== TYPECHECK === EXIT=0
=== LINT ===     EXIT=0
=== FORMAT ===   All matched files use Prettier code style!   EXIT=0
=== TEST ===     Test Files 105 passed (105) · Tests 1417 passed (1417)    EXIT=0
=== BUILD ===    ✓ Compiled successfully in 9.2s · 静态页 6/6 · EXIT=0
```

> ★ 收尾这一遍第一次是把 build 写成 `pnpm build | tail -25` 取的读数，
> 而那种写法 `$?` 拿到的是 `tail` 的退出码——那一次"EXIT=0"证明不了构建成功。
> 所以又整跑了一遍、逐条取真退出码（上面这一格就是那一次）；日志：
> `.out/final-verify.log`、`.out/final-build.log`、`.out/v4.log`、`.out/v5.log`。

**另外真跑了一次引擎**（离线替身档，**不花钱、不碰网络**）：

```
node scripts/engine-run.mts --mode=stub --form=shared --out=.out/engine-run-check
→ 有图 5/5 页 · 页级失败 0 · 图像调用 6 次（含封面）· 0.07s
   书：.out/engine-run-check/books/xiaolu-r1-3befb9c2a76b/book.json
```

它走的是**产品那条路**（`runBook` = `planBook` + `illustrateBook`，共读版 + 一个选择点），
也就是这次动过的两个模块：五页全部穿过改过的 `illustrateNode` 循环与收尾断言。

基线是绿的，所以「先修到绿再开始」这一步没有内容可做——这本身是一条读数：
**三条闸门（+ 构建）在我动手之前就是真的**。

---

## 1. 已修复

### 1.1 规划期最后那一次失败，也在说"正在重写"（假话）

|      |                                                                       |
| ---- | --------------------------------------------------------------------- |
| 位置 | `src/lib/engine/plan.ts:250` / `:268` / `:309`（三处 `retry` 发射点） |
| 类型 | 事件语义与实际控制流不符（屏幕上留一句假话）                          |

**输入/场景 → 代码路径 → 错误结果**

模型连续 3 次交回不合法的故事表（`maxAttempts` 缺省 3）。
第 3 次失败时 `plan.ts` 照旧 `opts.emit({kind:'retry', attempt:3, maxAttempts:3, …})`，
紧接着 `continue` → `for` 结束 → 抛 `schema-validation-failed`。

而 `retry` 这条事件在屏幕上的原话是
「这一版故事没通过校验，**正在重写（第 3 / 3 次）**」（`events.ts` 的 `describeEvent`）。
它是一句**承诺**：马上会有下一次。可下面一次都没有，收尾的 fatal 帧把它换掉之前，
那是这一屏唯一还在说的话。

**判据其实就在同一个引擎里**：`illustrate.ts` 的两处 `retry`（一致性没过 / 画面没过）
**都带着 `attempt < lastAttempt`**，只有 `plan.ts` 这三处没有。

**修复**：三处各加同一条守卫 `if (attempt < maxAttempts)`；失败原因一个字不少——
它们照旧进 `failures`，最后那条错误消息的 `detail` 里逐条列着。

**回归测试**：`src/lib/engine/plan-retry.test.ts`（新文件，5 条）

- 每一次都坏（schema）：`maxAttempts=3` → 只发 `attempt=[1,2]` 两条，且每条 `attempt < 3`
- 每一次都坏（树形）：`maxAttempts=2` → 只发 `attempt=[1]`
- 只剩一次机会：**一条都不发**
- 内容审核没过（`flag`）：同形，且那句里带条款 id（`R-01`）
- 一次就过：一条 `retry` 都没有（钉住它别被改坏）

> 判别力已实测：把守卫临时改回旧行为（`attempt < maxAttempts + 1`），
> 这条测试当场红 2 条；改回来又全绿。

### 1.2 `maxAttempts < 1` 时，那一页会变成一个 0 字节的"图"

|      |                                                                    |
| ---- | ------------------------------------------------------------------ |
| 位置 | `src/lib/engine/illustrate.ts:176`（补的闸）/ `:570`（原来的兜底） |
| 类型 | 空壳产物 + `errors` 语义被绕过                                     |

**输入/场景 → 代码路径 → 错误结果**

`maxAttempts = 0`（脚本 `--maxAttempts=0` 就是一次手滑）→ `for` 一次都不进 →
`lastAsset` 是 `null` → 收尾那条兜底

```ts
const asset = lastAsset ?? (await opts.store.put({ … 'page-N-missing.bin' … }))
```

**写一个 0 字节的文件**，然后这一页照常出现在 `illustrations` 里：
`errors` 里没有它（"这一页缺"这句真话说不出来了）、`stats.nodesGenerated` 多算一页、
阅读器拿到一张破图。这正是 CLAUDE.md「不糊弄」那一节点名的那件事的反面。

**修复**（两处，都是"让那句话说得出来"）：

- `illustrate.ts:176` 当场拒绝：`maxAttempts < 1` → `invalid-request`。
  ★ 同一条闸**这个文件里本来就有**——`illustrateCover` 在 `:762` 对封面做了同一件事，
  缺的只是页图这一侧。
- `illustrate.ts:570` 兜底改成断言（拼接不出图时**抛**，交给 `illustrateAll`
  记进 `errors`）。它今天到不了，留着是为了将来改循环时不会静默交出空壳
  （与 `tool-loop.ts` 末尾那句同一个用途）。

**回归测试**：`src/lib/engine/illustrate.test.ts` 新增 2 条

- `illustrateNode(maxAttempts: 0)` → 抛 `至少要 1 次`，且 `store.all()` **为空**（判据落在盘上）
- `illustrateAll(maxAttempts: 0)` → 这一页进 `errors`、不进 `illustrations`

（今天从 HTTP 传不进 0：`maxIllustrationAttempts` 只有脚本会设。所以这是一条
**护栏**，不是线上故障。）

### 1.3 `postStream` 的注释与签名不符（`api.ts:193-206`）

原文写着「返回的是一个**收尾**函数而不是 Promise：调用方要能在卸载时喊停
（`AbortController`）」——而返回类型一直是 `Promise<void>`，签名里从来没有过"收尾函数"。

更要紧的一层：**全仓没有任何调用方传 `signal`**（`src/components/` 里
`AbortController` 一处都没有）。所以那句注释描述的是一个不存在的机制，
下一个人读它会得出"取消已经接好了"的结论。

改成了事实陈述 + 说明为什么今天没接（服务端那侧是"客户端断开 ≠ 后端停手"，
界面上也没有"停止生成"那颗钮）。**这一条只改注释**：没有行为改动，
参数也没删（删参数是跨 4 个导出函数的重构，与正确性无关）。

### 1.4 预流准备失败时租约不还 → 这本书**永远**"正在生成中"

|          |                                                                                               |
| -------- | --------------------------------------------------------------------------------------------- |
| 位置     | `src/app/api/books/route.ts:282`（`log.truncate`）· `[bookId]/story/rewrite/route.ts:137-139` |
| 类型     | 状态机：失败后状态不一致（`finishRun` 漏在一条错误路径上）                                    |
| 触发条件 | 资产根写不进去：只读挂载、磁盘满、目录权限（`mkdir` / `writeFile` 抛）                        |

**输入/场景 → 代码路径 → 错误结果**（修之前的形状）

```ts
if (!tryStartRun(runKey)) return jsonError(409, 'book-busy', …)
…createProviders（这一段**有** catch → finishRun）…
await log.truncate(bookId)        // ← 裸的，写盘，会抛
const stream = new ReadableStream({ … finally { finishRun(runKey) } })
```

`truncate` 抛出时 `finishRun` **永远不执行**：① 用户拿到一个未捕获的 500；
② 这本书记在这一**进程**里永远是"在跑"，此后每一次点它都收
409「这本书正在生成中」，直到进程重启。而紧邻的 `createProviders` 失败就老老实实
还了租约（`books:271` / `rewrite:132`），`story/route.ts` 的 `writeStory` 也接住了
——所以它是同一套纪律上**只漏掉的那一格**。

**修复**（两条路由各一处，形状相同）：把预流那一小段包进 `try`，失败时
`finishRun(runKey)` + 回一句人话。★ 用 `asset-write-failed` 而不是
`userFailureOf(err)`：后者会把一条非 `EngineError` 的异常规约成
`provider-call-failed`，而那句文案在 `provider-messages.ts` 里是讲**厂商那边**的
成败的——磁盘写不进去说成"调模型失败"就是一句假话。这个码在本仓库里已有先例
（`story/route.ts` 的 `writeStory` 失败走的就是它）。

**按你选的口径（先补测试脚手架再改）**：这一层以前没有测试缝，所以先长出
`src/app/api/books/route-leases.test.ts`——**本仓库第一批驱动 Route Handler 的测试**。
四样全在测试里临时搭，不需要真后端、不碰真厂商：

| 要什么   | 怎么给                                                                     |
| -------- | -------------------------------------------------------------------------- |
| 登录态   | 自己用 `APP_JWT_SECRET` 签一张 `scope: 'session'` 的 HS256 票，塞进 cookie |
| 权限     | 一个只回 `/api/auth/me` 的**假后端**（`node:http`，端口系统挑）            |
| 资产根   | `mkdtemp` 一个临时目录，`ASSET_ROOT` 指过去                                |
| 模型配置 | 三个 `*_BASE_URL` 一律指向 `127.0.0.1:9`（discard 端口，没人监听）         |

★ `127.0.0.1:9` 是刻意的：**这一组用例绝不许打到真厂商**。配一个"看起来像真的"
地址之所以也能跑通，是因为它在任何一条意外路径上都只会立刻 `ECONNREFUSED`——
而不是把一次请求发出去。

**三条用例（红→绿都实测过）**

| 用例                                       | 修之前                                      | 修之后                                    |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------- |
| 重写一版：`events.jsonl` 是个目录 → EISDIR | **红**：`POST` 直接抛，租约还挂着           | 绿：500 + `asset-write-failed` + 租约已还 |
| 开一本：同上                               | **红**：同上                                | 绿：同上                                  |
| 对照档：健康资产根                         | 绿（200 + SSE，流里出现 `fatal`，租约已还） | 绿（同左）                                |

★ **判别力是逐条量过的**：单独把 `books/route.ts` 的补丁还原 → 只有"开一本"那条红
（`1 failed | 2 passed`）；单独把 `rewrite` 的补丁还原 → 只有"重写一版"那条红。
两条各钉各的，不是一条用例顺带遮住另一条。
★ **对照档不是装饰**：它证明这套脚手架**能走过截断那一步**、引擎真的跑起来了
（它会去连 discard 端口、必然失败，于是流里有一条 `fatal`）——少了它，
上面两条在"任何请求都到不了租约之后"的实现下也会绿。
（`format:check` 的坑顺手记一条：测试头部的注释里写了 `src/**/ *.test.ts`，
那个 `*/` 会把块注释提前关掉，vitest 报的是一句与真错处无关的 parse error。）

---

## 2. 记下来的（没有待决策项）

> 原先这一节只有一条待决策（租约泄露）——按你选的口径已经落地成
> §1.4，所以这里剩下的全是"记录在案"的：两条低危、九条已排除、一份 Java 只读审查。

### 2.1 未决（低危，附验证路径）

1. **`stats.imageCalls` 在一条窄路上少记一次**
   `src/lib/engine/index.ts:941-944`。口径是"各页 `attempt` 之和 + 失败页数 ×1 + 封面 1"。
   逐条核对过：**失败页恰好各出 1 次图**（`illustrate.ts` 的 `produceFailed` 在
   没有旧图时直接抛，不会重试），所以 `errors.length` 这个加法是**对的**。
   少记的只有一种情形：第 2 次**出图成功但落盘失败**（`illustrate.ts:352`）——
   那次的钱算进了 `spentCny`（`costCny` 那句注释写了"没有数可记"的是**抛异常**那次），
   而次数按 `attempt: 1` 记。**验证路径**：`illustrate.test.ts` 里
   `scriptedImage(['ok', store 抛])` 一把，看 `summarize` 的返回值；
   要修的话得让 `PageFailure` 带上"试了几次"（口径变更，会动 `BookStats` 的读法），
   所以没顺手改。

2. **`404 story-not-found` 排在 `409 book-exists` 之前**
   `src/app/api/books/[bookId]/illustrate/route.ts:90-94`。故事被手工清掉、而书已经画完时，
   用户读到的是"回「创作」重新编一版"，下一步却撞上 `/api/books` 的 409
   「这个主题你已经有一本了」——两句话接不上。**不涉及钱**（404 在付费那一段之前返回），
   只是文案次序。**验证路径**：删掉 `books/<id>/story.json` 再打这条路由。

### 2.2 已排除（查过、确认不是问题——留档，免得下次重查）

| 查什么                                       | 结论                                                                                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http-range.ts` 的 off-by-one / 边界         | 闭区间处理正确；空文件、`bytes=-0`、`bytes=-1`、`start>=size`、后缀超长、`last<first`、多段、大小写+空格，`http-range.test.ts` 逐条有用例                                                            |
| 缩略图缓存键会不会端出过期图                 | 不会：能进 `?w=` 的图要么文件名带 12 位指纹（`ref.<digest>.png`），要么带 attempt 号（`page-7-a4.png`），同路径换内容是"表达不出来"的。非指纹名一律 `no-store`（`assets/[...path]/route.ts:63,176`） |
| 缓存键要不要含 `Range`                       | 不用：206 的复用由 HTTP 缓存按 `Range` 匹配，且朗读音频不是指纹名 → `no-store`，压根不进缓存                                                                                                         |
| `/api/assets/...%zz` 会不会 500              | 不会。实测（`curl` → :3311）**400**：Next 在进 handler 之前就拒了（`decodeURIComponent` 那一步到不了）                                                                                               |
| `../` 越过自己那一片                         | `asset-scope.ts:93` 的 `assertInsideScope` + 底层 `resolve` 双层；`asset-scope.test.ts` 有用例                                                                                                       |
| localStorage / sessionStorage 旧数据与坏数据 | 四处（`reading-log` / `reading-prefs` / `reading-path` / `last-run`）都是**逐字段**校验 + 读两侧都接住异常，坏数据退化成"没记录过"                                                                   |
| 条件 hook                                    | eslint 的 `react-hooks/rules-of-hooks` 在闸门里，绿                                                                                                                                                  |
| GSAP context 泄漏                            | `useEnterTimeline` / `HighlightsReel` / `HeroOrbit` 三处的 cleanup 与注册对称（`mm.revert()` / `ctx.revert()` / `removeEventListener`）                                                              |
| 模型输出带偏路径拼接                         | 引擎产物名全部由代码拼（`books/<id>/page-N-aK.<ext>`，扩展名走 `extensionOf(mime)`）；`book.json` 被手改成 `../` 也过不了 store 那一层                                                               |

### 2.3 `server/`（Java）只读审查：未见缺陷

按登录/权限/钱三条线看了一遍（6010 行，12 个测试文件）：

- **JWT**（`JwtService`）：算法**写死 HS256**（`signWith(key, Jwts.SIG.HS256)`，
  注释记着"自动挑 HS512 会让 Next 那侧 401"）；`scope` 区分会话票与设密码票；
  密码代次 `pv` 而不是比时间（秒精度那个坑有注释）。
- **内部令牌**（`InternalTokenFilter`）：`MessageDigest.isEqual` 常量时间比较；
  令牌不进日志；只豁免 `/api/health`；没配时不生效的**前提**是 `StartupChecks`
  在生产会拒绝启动（已核）。
- **短信**（`SmsRateLimiter` + `SmsCodeStore`）：三层频控（同号 / 同 IP / 全局每日 300）；
  验证码存 HMAC、5 分钟过期、最多试 5 次、核验通过即删（一次性）；
  `SecureRandom` 取码。
- **密码**（`LoginAttemptGuard`）：同号 15 分钟内 5 次错 → 锁 10 分钟，时钟可注入。
- **归属**：`VoiceService` 每条查询都带 `userId`（删别人的在 SQL 里不成立）；
  `AdminController` 四类动作**全部**走 `requireAdminFresh`（角色 + 新鲜度，不认旧票里的角色）。
- **库**：`SchemaUpgrades` 只加列、只补值，幂等，不 DROP/MODIFY。
- **异常**：`GlobalExceptionHandler` 未预料到的异常只回"程序出错"，细节只进日志；
  405/404/415 各自认领状态码（不混进 500）。

---

## 3. 第三步：TODO 处置表

**盘点方法与覆盖**：对 `src/`、`mcp/`、`scripts/` 用了
`rg -niw -e todo -e tbd -e fixme -e hack -e xxx`，另加一组中文变体
（待办/待接/待补/暂缓/以后再/将来再/暂时先/先不做/留到），
另加 `@todo` / `ToDo` / `WIP` / `TEMP` / 占位 / 临时 / 后续。**530 个文件。**

| #   | 位置                                        | 原内容（摘）                                                                            | 处置                 | 理由                                                                                                         |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | `src/app/page.tsx:124`                      | 「这两个按钮从 W1 起就是死的（`<button>` 没有 handler，两条 TODO 都过期了）…现在接上…」 | **保留**（不改一字） | 它不是待办，是**已经结清的账**：正文里写着那两条 TODO 过期了、并且写明了当时怎么修的。删掉等于把这笔教训抹掉 |
| 2   | `src/components/book/StorybookFlip.tsx:652` | 「★ 2026-10-17 接线（原 TODO 是"创作流程做出来后换成指向 /create 的 Link"）…」          | **保留**（不改一字） | 同上：这是"接线那天留下的日期与落点理由"（为什么是 `/home` 不是 `/create`），是资产不是欠账                  |

**除此之外，池子里一条都没有了**：

- 唯一一处独立的 `xxx` 命中是 `scripts/build-rag-index.mts:23` 的一句
  「`scripts/` 现在是一个 `node xxx.mts` 就能跑的世界」——**不是标记**。
- `src/components/**` 里的 `todo` 命中全部是**界面状态枚举**
  （`'done' | 'now' | 'todo'`，见 `frames.ts:562`、`wait-copy.ts:63`）——**不是标记**。
- `src/lib/auth/state.ts:19` 提到的那条待办，正文写的是"到今天就消了"。

所以这一节的结论是**池子已经排干**：两条都是"记着某条 TODO 已经做完"的注释。
按"禁止批量删除"的纪律，我一条都没删——**删掉它们才是把唯一的证据销毁**。

> **另有一类东西不属于本节的盘点范围，但得让你知道它在那儿**：
> `.scratch/**/issues/*.md` 里有约 **200 条 `- [ ]` 未勾选的验收框**（34 个工单），
> `docs/booklist/*.md` 里还有 **50 条**。前者是各工单的**验收清单**（工单顶部标着
> `Status: claimed`/已交付，框没勾），后者是 12 本灵感书的**出图/录音清单**
> （那是另一条线在推进的活）。两者都不是代码里的 TODO，按 issue-tracker 的约定
> 也不该由这一轮来"清算"——勾一个框的前提是逐条复验那份工单的交付物，
> 那是另一件事。**一处未动。**

---

## 4. 第四步：质量收口清单

四类里各只做了**一处**（其他候选要么越界、要么找不到能回答"这让哪个风险更不容易
再发生"的改动）。

### 4.1 类型收紧 / 命名修正：`books-runtime.ts` 的租约函数形参

| 改了什么                                                                                                                            | 对应哪个风险                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tryStartRun(bookId)` / `finishRun(bookId)` / `isRunning(bookId)` → `(runKey)`；文件头第 2 条补一句"键是 `userId/bookId`，不是书号" | 审查风险点 2（引擎状态机）+ 并发保护。**原样传一个书号进去是一处会静默失效的调用**：两个账号在同一本书上互不遮挡——而"互不遮挡"与"写错了键"症状**一模一样**（都表现为"哪里都没报错"）。把这件事放进参数名与文件头，是让它在调用点上看得见的最便宜的办法 |

★ 这是**方向 4（命名修正）**里"名字与行为矛盾"的那一种：注释写"按书号串起来"，
而 `runKeyOf` 的实现在下面写着"键里要带上是谁"。改的是**局部**（三个形参 + 一段文件头），
调用点一个字不用改（都是位置参数），也不跨文件重命名。

**回归测试**：`src/lib/books-runtime.test.ts`（新文件，3 条）

- 同一个人的同一本书：第二次被挡住
- ★ 甲在跑时乙不受影响（工单 16 那条），且 `finishRun(mine)` 不会顺手放掉 `theirs`
- 键里真的带着是谁（`runKeyOf('1','bk') === '1/bk'`）

### 4.2 错误处理一致性 / 文档正确性：`creation/api.ts` 的 `postStream`

§1.3。判据是"这个函数**当下**的失败语义是什么"——注释与签名不符属于同一类
"下一个人读错代码的入口"。**这让风险点 1（流式与异步）更不容易再发生**：
它原本会让人以为"取消已经接好了"，于是要么去追一个不存在的机制，要么在别处
再造一份取消逻辑。

### 4.3 没做的（说明为什么）

- **重复逻辑提取**：只找到一处值得的（`illustrateCover` 与 `illustrateNode` 各有
  一段"记账与 `spentCny` 累加"），但两处的**次序与注释都不同**（封面在 header 里多一层），
  提纯出来会变成"为了三行而多一层跳转"，且属于与正确性无关的重构。**不动**。
- **吞错**：`src/` 里没有空 catch（唯一几处在 `scripts/chk-perf.mjs`，
  那是浏览器探针脚本里"这两个 API 在无头环境下没有"的显式忽略）。检查过的
  每一处 `catch {}` 都在注释里写明了为什么不抛。**无需改**。
- **类型收紧**：`src/` 里 `as any` / `@ts-ignore` / `@ts-expect-error` **一处都没有**
  （`scripts/` 里也没有）。**无需改**。

---

## 5. 改过的文件与收尾读数

```
src/lib/engine/plan.ts            三处 retry 加上界守卫（+注释说明判据）
src/lib/engine/illustrate.ts      maxAttempts<1 的闸；missing.bin 兜底改成断言
src/lib/creation/api.ts           postStream 的注释改成事实
src/lib/books-runtime.ts          形参 bookId → runKey；文件头补一句
src/app/api/books/route.ts               truncate 包进租约（B 方案那一轮）
src/app/api/books/[bookId]/story/rewrite/route.ts  同上
src/lib/engine/plan-retry.test.ts      新增（5 条）
src/lib/engine/illustrate.test.ts      追加 2 条（import 改成同时取 illustrateAll）
src/lib/books-runtime.test.ts          新增（3 条）
src/app/api/books/route-leases.test.ts 新增（3 条，★ 本仓库第一批路由级测试）
```

测试总数 1404 → **1417**（+13）。**没有动**：`server/`、`docs/`、
任何 CSS、任何 `next.config`/`tsconfig`/`eslint` 配置，也没有改任何既有测试的判据。
（`.scratch/` 下只新增了这份报告与它自己的目录，没有改任何既有工单。）

收尾那一遍 `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` 与
`pnpm build` 的读数见 `.out/final-verify.log`、`.out/final-build.log`、`.out/v5.log`
（本文档顶部 §0 是摘要；逐条都取了**那条命令自己的**退出码）。
