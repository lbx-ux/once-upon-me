# 01 · 引擎：一条流水线拆成两段（`planBook` / `illustrateBook`）

Status: done（2026-10-17）
对应 [spec.md](spec.md) §二

## 改了什么

- `src/lib/engine/index.ts`：`runBook` 拆成 `planBook`（①，含 `plan-ready` 事件）与
  `illustrateBook`（②–⑦，原样搬过去）；`runBook` 保留为**两者的复合**。
  新增 `RunDeps.startSeq`、`IllustrateDeps.planMs` / `createdAt`、`StoryPlan` 类型。
- `src/lib/engine/plan.ts`：`PlanOutcome` 多一个 `doc`（模型吐回来的那张表）。
- `src/lib/prompts/story-plan.ts`：`StoryPlanInput.reviseNote`，`STORY_PLAN_VERSION` → `story-plan@v2`。
- `src/lib/engine/split.test.ts`（新）。

## 三个数字的来处

| 字段                       | 为什么必须有                                     | 不传的坏法                                               |
| -------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `RunDeps.startSeq`         | ①与②是**两个请求**，往同一个 `events.jsonl` 追加 | 日志里两条 `seq: 1`，而 `seq` 正是重放重建界面状态的依据 |
| `IllustrateDeps.planMs`    | ②的 `stats.elapsedMs` 要把①那一段加上            | 脚本跑出来的书与界面做出来的书口径不同，#14 的数不可比   |
| `IllustrateDeps.createdAt` | `Book.createdAt`（书架按它排次序）               | 界面那条会记成"按「就按这个画」那一刻"，两条路含义不同   |

## Comments

- 2026-10-17 **顺手删了一个死形参**：`summarize({planAttempts})` 从来没人读
  （`BookStats` 里没有这个字段）。拆开之后②手上根本没有规划这回事，再传一个 0 进去就是编。
  那个数改落在故事草稿的 `provenance.attempts` 上，有读者。
- 2026-10-17 实测：`split.test.ts` 五条全过。其中最关键的一条是
  `runBook(request) === illustrateBook(request, planBook(request).tree, …)`——
  **逐字段相等，连 `stats` 都相等**（`now: () => 0` 的时钟下）。
  这一条守的是"脚本/横评走的那条路"与"线上产品走的那条路"是同一条。
- 2026-10-17 引擎侧 269 条测试全绿（含新增 5 条）。
- 2026-10-17 **端到端实测**（隔离 dev server 3341，真模型，走界面：开一本 → 闸门 → 就按这个画）：
  - `events.jsonl` 的序号从①的 `1, 2` **接着**②的 `3, 4 …` 数下去，全表 57 条**没有重复号**
    ——`startSeq` 那一条在这条真路上成立（这是"重放就是依据"的前提）。
  - `book.json` 的 `stats.elapsedMs = 1_950_240` ＝ ①存进故事草稿的 `planMs 10_902`
    ＋ ②自己那一段 `1_939_338`。**"机器时间"这个口径是量出来的**：分两步做也不会
    把家长看故事的那几十分钟算进去（①到②之间实际隔了很久）。
