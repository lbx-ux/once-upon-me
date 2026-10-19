# 04 · 规划那条：把检索结果注进规划调用

Status: done（2026-10-19 收工：提示词 v4 · 事件两条 · provenance · `--retrieve` 端到端通了）
依赖：03
依据：[spec §六](spec.md)、`E:\compete\计划表.md` B1

## 这一张改什么（★ 只改入参，不新起流水线）

`E:\compete\计划表.md` 的 B1 自己记了那条教训：横评脚本搭一条平行流水线，
量出来的数字「不是引擎要用的那个数」。所以这里改的是**引擎自己的那条路**：

| 文件                                | 改什么                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `src/lib/prompts/story-plan.ts`     | `StoryPlanInput` 加 `exemplars` / `avoid`；系统或用户提示词加那两段；**升 v4** |
| `src/lib/engine/plan.ts`            | `PlanOptions` 加 `retriever?`；调用前检索、把结果拼进 `baseUser`               |
| `src/lib/engine/index.ts`           | `PlanDeps` 递下去；`Provenance.retrieval` 回填                                 |
| `src/lib/engine/domain.ts`          | `Provenance` 加可选 `retrieval` 字段                                           |
| `src/lib/engine/events.ts`          | `Stage` 加 `retrieving` + `STAGE_LABELS` + 事件 `retrieved`                    |
| `src/components/creation/frames.ts` | ★ 只改那段注释，**4 格不动**（见下）                                           |

## 几个必须说清的判断

1. **重试时也检索一次吗？** 不。检索发生在**进循环之前**，`attempts` 那三次共用同一份
   范例——理由是重试要改的是**格式**（`plan.ts` 文件头第 1 条已经说清：
   格式问题与语义问题分开报），而不是「再找一批参考」。重试时换语料，
   会把「这次为什么变好了」变成一个说不清的问题，而横评要靠这个数。
2. **`retrieved` 事件的 `hits` 是数，不是内容。** 内容进 `Provenance.retrieval.hits`；
   事件流只报「检索到 n 条、最高分多少、哪一档」——事件要能过 SSE 且逐帧便宜。
3. **`retrieving` 是 `planning` 内部的一步**，不是与它并列的第五个阶段。
   所以 `frames.ts` 的 4 格**不动**，它进「编故事」那一格的 `note`。
   ★ 那段注释现在写着「`auditing` 与 `review` 在全仓库从未 emit」——
   本轮之后这句话**变成假的**（工单 05 会 emit 它）。必须**改写**成新的事实，
   不许留着一句已经过期的注释（这个项目对「★/刻意」注释的规矩是：先读完再决定要不要违背）。
4. **检索失败不许拖垮规划。** `/embeddings` 挂了、索引读不到 → 走词法档；
   连词法档也读不到 → **空结果照常编故事**，并在事件里记一条
   `retrieved { hits: 0, mode: 'lexical' }`。★ 但**不许静默**：
   `mode` 与实际用了哪一档必须写进 provenance（「这次到底有没有检索」必须可答）。
5. **提示词升 v4 是必须的**（`story-plan.ts` 文件头那段 ☆ 已经写清规矩：
   改了不升版，横评数据与线上产物就对不上了）。`story-plan@v3` 的输出仍然合法。

## 验收

- [x] 没检索时提示词**逐字节不变**（`plan-retrieval.test.ts` 第一条：
      不给 retriever 时 `prompts[0] === storyPlanUser(INPUT)`，且返回里没有 `retrieval` 字段）
- [x] 给一个假 retriever → 注进了用户提示词、`retrieval.hits` 回填、**在末尾**（三条用例）
- [x] 假 retriever 抛错时：规划照常成功（`attempts: 1`），事件里有 `retrieved{corpusVersion:null}`
      与非致命 `error{code:'retrieval-failed'}`，provenance 也如实记成"没跑成"
- [x] `retrieval` 是**可选**的：老的 `story.json` 照读（`story-draft.test.ts` 三条：
      写得出去读得回来、`corpusVersion: null` 不被读成"没有检索"、形状不对当没有）
- [x] 工作台那两句话（判据 6 的一半）：`frames.test.ts` 四条钉住
      「正在翻以前写过的故事…」与三种 `retrieved` 文案的去处
- [x] `engine-run --mode=stub` exit 0（没加 `--retrieve` 的那条基线一个字没变）；
      **加了 `--retrieve=1` 也 exit 0**，而且真的翻到了东西（见 Comments）
- [x] `format:check` / `lint` / `typecheck` + 全量 1172 条测试过

## 不做

- ✗ 不在这一张里写对照跑测（工单 06）
- ✗ 不动 `reviseNote` 那条重写路（它走同一个 `planStory`，自动吃到检索，无需另改）

## Comments

**2026-10-19 · 收工记录**

改了 9 个文件：`prompts/story-plan.ts`（v4）· `engine/plan.ts` · `engine/index.ts` ·
`engine/events.ts` · `engine/domain.ts` · `lib/story-draft.ts` · `components/creation/frames.ts`

- `Desk.tsx` + `desk.css` · 两个路由。新增测试 `plan-retrieval.test.ts`（7 条）
  与 `frames.test.ts` 里 4 条；`story-draft.test.ts` 加 3 条。

**端到端（真跑一次）**：`node scripts/engine-run.mts --mode=stub --retrieve=1` ——
事件流的前三条是

```
[01] 正在翻以前写过的故事…
[02] 翻到了 3 段可以照着写的
[03] 正在编故事…
```

它**不联网**（语料是仓库里那份索引 + 这一片存储里的旧书），所以判据 1 那条
「不碰网络跑完一本书」加了这个开关之后仍然成立。`--retrieve` 默认**不开**：
新能力不做默认（与 `onDelta` 同一条纪律）。

### 五处落地时才看清的事

1. ★★ **主题过滤器在线上本来会一次都不命中。** 追数据流时发现的：界面送的是
   `THEMES[].label`（`create/page.tsx` 的 `themeLabel` = `'云'`），而库里 chunk 存的是
   **键**（`'cloud'`）。严格相等 ⇒ 永远不相等 ⇒ 症状是"检索永远没有范例"，
   **不报错**。修法是把标签归一成键（`retrieve.ts` 的 `themeKeyOf`），
   而第三种形状（家长那句话，`state.ts` 的 `|| wish`）**不构成主题约束**、同时也是**内容**。
2. ★ **`engine-run --retrieve` 第一次跑，"以前的故事里没有相近的"**——它只传标签，
   而 `theme` 那半句被整条丢在查询之外，查询串薄到取不到东西。
   于是查询串的规则补了一条：**认不出来的主题进查询串**（它是家长的话 = 内容）。
   补完再跑：翻到了 3 段。（真界面上不至于——`|| wish` 让 `wish` 也带着那句话。）
3. ★ **路由发不出事件。** 第一版在路由里 `try { createPlanRetriever(...) } catch { onEvent(...) }`，
   被类型挡住：路由手上只有 `EngineEvent`（带 `seq` / `at`），**没有事件工厂**。
   所以装载改成**惰性**（`PlanRetriever` 是 `async`，语料在第一次调用时才读），
   失败于是抛在 `plan.ts` 的 `retrieveOnce` 里——**由引擎自己发那两条事件**，
   既发得出、也不会有人伪造序号。这一条是被类型逼出来的，不是偏好。
4. **`retriever` 挂在 `RunDeps` 上**（不是 `PlanDeps`）：`runBook` 里也包含编故事，
   而脚本与横评走的就是 `runBook`——挂在 `PlanDeps` 上它们就传不进来，
   而"脚本走的路 == 产品走的路"正是 `split.test.ts` 摁着的那件事。
5. **`retrieved` 事件里的 `corpusVersion` 允许是 `null`**（这一轮没检索成），
   而 `null` 与"取到 0 条"是**两件事**，屏幕上也是两句话。
   `story-draft.ts` 的读取器专门为这一格写了判定（写成"必须是非空字符串"就会把
   "没检索成"读成"没有检索"）。

### 一处口径修正与一处验证缺口

- **`dk__plan-retry` 改名 `dk__plan-note`**：那个位置原来只装"编故事失败过一次"那句原话，
  现在也装检索结果，类名与三处注释都跟着改准了（`frames.ts` 的 `DeskState.planning`、
  `Desk.tsx`、`desk.css`）。
- ★ **HTTP 那一跳没有端到端验过**：`/api/books` → `planBook` 那两行要真打起来需要
  Java 后端在 8080（`requireCapability`），而当前工作区没起它。
  两侧各自有单测（`load.test.ts` 覆盖 `createPlanRetriever`，`plan-retrieval.test.ts`
  覆盖 `planBook` 收 `retriever`），中间那一跳靠类型与三行代码。
  **记在这里，不在工单 07 的验收里假装它验过了。**
