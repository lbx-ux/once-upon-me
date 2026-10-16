# 01 · 单页重画 / 重配：引擎侧的入口

Status: done
依赖：无（但 05 依赖它）
上游：spec §二（原型那两处是定时器装的）、§四（序号与产物两条纪律）

## 一、要什么

用户做完整本之后，对某一页点了「重画」或「重配」，**只重做那一页**。
今天引擎只有 `runBook()`（一次跑完整本），单页入口要从零补。

## 二、为什么不是"重跑整本"

重跑整本 = 20 页重画一遍再付一次钱，而且会把用户已经满意的 19 页一起换掉。
而 `illustrateNode()` 本来就是按页导出的（`illustrate.ts:95`），`book.json` 里也存着
`tree.nodes`（每页的 `imagePrompt` / `scene` / `mood` / `body`），所以缺的只是
"把它单页接起来，再写回清单"这一层。

## 三、四个必须摁住的细节

### 3.1 文件名不许撞（`attemptBase`）

`illustrateNode` 按 `books/<id>/page-{n}-a{attempt}.png` 落盘。单页重画若不改编号，
`attempt` 会从 1 再来一遍，把**上一次那张**覆盖掉——而"失败的图也落盘"是这条流水线
写明的纪律（`illustrate.ts` 文件头第 3 条：家长要能看见"上一版为什么不像"）。

做法：`IllustrateOptions` 加 `attemptBase?: number`，循环里 `attempt` 从它起算。
文件继续叫 `page-7-a4.png`，事件里的 `attempt` 也仍然是**真的第几次**，单调递增。

### 3.2 事件序号要接着写（`startSeq`）

`createEventFactory` 每本书从 1 起（`events.ts:96`）。单页重做是往**同一个**
`events.jsonl` **追加**（`log.truncate` 只在一轮整本开始时才截断），所以不去接续的话，
日志里会出现两条 `seq: 1`。

判据：`seq` 是"SSE 断线重连与日志对齐"的依据，也是重放重建界面状态的依据。
**写测试钉住**：接续之后序号不撞、且仍然单调递增。

### 3.3 并发保护要共用那把租约

单页重做也要 `tryStartRun(bookId)`（`books-runtime.ts:49`），否则重画与整本重跑
会同时写同一个目录：一份日志被两轮事件交叉写入，后写的还会覆盖 `book.json`。

### 3.4 stats 口径不许悄悄变

`BookStats` 是 §10.1 的 r_redraw 与 #14「端到端耗时与成本实测」的数据源。单页重做之后：

| 字段                              | 怎么办                           |
| --------------------------------- | -------------------------------- |
| `imageCalls`                      | **累加**本次尝试数（钱真的花了） |
| `elapsedMs`                       | **累加**本次耗时                 |
| `firstPassCount` / `redrawCount`  | 沿用整本那一轮的值，不重算       |
| `nodesPlanned` / `nodesGenerated` | 不变                             |
| `totalCostCny`                    | 累加本次的 `costCny`             |

★ 不重算 `firstPassCount` / `redrawCount` 是**刻意的**：那两个数说的是"这本书第一次跑完时
一次通过了几页"，单页重画是**人事后干预**，把它算进首次通过率等于把人的判断算成模型的成绩。
这条要写进 `summarize` 的注释里——口径变了，历史数据就不可比。

## 四、接口形状

```ts
// engine/index.ts
export type PageRerunRequest = {
  bookId: string
  pageNo: number
  /** 调用方已经读出来的清单与卡：引擎不决定"清单在哪儿"，那是运行时的事 */
  book: Book
  card: CharacterCard
  voiceId?: string
  emit?: (event: EngineEvent) => void
  now?: () => number
}

export async function rerunPage(req: PageRerunRequest, deps: { providers }): Promise<Book>
export async function rerunNarration(req: PageRerunRequest, deps: { providers }): Promise<Book>
```

两者都：找到那一页的 `StoryNode`（找不到就抛 `EngineError('page-not-found')`）→
调 `illustrateNode` / `narrateNode` → **替换**（不是追加）`illustrations` / `narrations`
里 `pageNo` 相同的那一条 → `store.putJson` 回写清单 → 返回新的 `Book`。

★ "替换而不是追加"与 `frames.ts` 判据 1 是同一条：写成分页追加的话，20 页的书重画 3 页
会变成 23 条。

## 五、`narrateNode` 与那条分页 stage

`narrateAll` 现在只发**不带 pageNo** 的 `stage(narrating, begin/end)`，所以没有办法说
"**这一页**正在配音"。做法：

1. 把 `narrateAll` 循环体里那一段抽成导出的 `narrateNode(node, opts)`，
   `narrateAll` 改成循环调它（**一份实现**，不复制）。
2. `narrateNode` 在动手前后各发一条**带 `pageNo`** 的 `stage(begin/end, narrating)`。
3. `frames.ts` 的 `Frame.busy` 从 `'drawing' | null` 扩成 `'drawing' | 'voicing' | null`，
   由那条带页码的 narrating stage 推出来。

★ 第 3 条是**改行为**，不是搬动代码。`frames.ts` 文件头那段"没有 checking 这一档"的推理
要跟着改（改的是**理由**，不是结论——核对仍然没有自己的分页 stage，仍然不声称
"第 N 页正在核对"）。并在 `frames.test.ts` 里加一条新用例。

★ 重配落一份**新文件**（不复用旧路径），旧录音留着——与"失败的图也落盘"同一条纪律。

## 六、验收

- `pnpm test`：序号接续、`attemptBase` 起算、`narrateNode` 的分页 stage、`Frame.busy === 'voicing'`、
  重画时 `illustration` 仍是覆盖不是追加（判据 1 的回归）
- 端到端（工单 05 接完界面之后一起验）：点重画 → 目录里**多出一张** `page-3-a2.png`
  且旧的那张还在 → `events.jsonl` 的 `seq` 接在最大号之后 → 刷新后那一格仍是新图

## Comments

- 2026-10-16 做完了。`rerunPage` / `rerunNarration` 在 `engine/index.ts`；
  `attemptBase` 在 `illustrate.ts`；`narrateNode` + `nextTakeNo` 在 `narrate.ts`；
  `createEventFactory(clock, startSeq)` + `maxSeqOf` 在 `events.ts`。

**实测**（`node scripts/web-run.mts --pages=3 --status=draft --voice=env --rerun=2`，
真跑、真花钱，5 页里重画第 2 页）：

```
这一页的图 books/xiaoyu-r1-4c1007d9223a/page-2-a1.png → page-2-a2.png
attempt 1 → 2（接着数，不是从 1 重来）
新增文件 page-2-a2.png · 上一版那张还在：是 ✓
事件序号：重画前最大 29 · 重画后 33 条 · 无重复 ✓ · 接续 ✓
imageCalls 5 → 6 · 重画那一帧 4 条事件
```

四条判据全过：文件名没撞、上一版留着、序号接续、`imageCalls` 跟着动。

**顺手抓出来的一个真 bug**（不是这一单引入的，是这一单的界面把它顶到台前）：
`deskOf` 从第一天起就把 `pageNo: 0`（**封面**的约定）当成第 0 页算，于是真跑一本之后
画桌上多出一格写着「0」、里面是那张竖版封面，而计数写着 **`4 / 3 页画好了`**。
修法见工单 [05](05-run-view.md) §三，回归用例在 `frames.test.ts`。
