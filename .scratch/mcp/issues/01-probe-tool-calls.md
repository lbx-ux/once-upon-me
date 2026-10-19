# 01 · 探针：这条网关上 `tools` 参数到底能不能用

Status: done（2026-10-19 收工：12 格全部有结论、0 格没结论；★ B 那一格**不稳定**）
依赖：无（**先做这一张**）
依据：[spec §一 判据 6](spec.md)、[spec §四](spec.md)

## 为什么先做它

`tools` / `tool_choice` / `role:'tool'` **从没量过**。全仓 `tool_call` / `tools:` 零命中，
`registry.ts` 里没有这个能力，`docs/tech-selection.md §9.1` 对候选模型的评价里
只有一句口碑（「结构化输出与工具调用成熟度」），**没有一行实测**。

所以「这家支持 Function Calling」在今天是一个**印象**，不是事实。

★ W1 在这件事上付过学费（`scripts/probe-embeddings.mts` 文件头写着）：
**不是「漏测」，是「把一个否定结论建立在没找到入口上」**。
所以下面八格**一格都不能少**，缺一格就是「只试了一条路」。

## 要做的事

- [ ] 新建 `scripts/probe-tool-calls.mts`。形状照
      `scripts/probe-embeddings.mts`：node 直跑、退出码 0/1、
      **只打状态码 / 耗时 / 模型名 / 错误体前 200 字**、判读表写在文件头、
      限流要退避重试（`RATE_LIMITED` 只退避这一类，能力类错误重试是浪费）。
- [ ] 八格全打：

  | 格    | 打什么                                                                      | 期望/为什么要                          |
  | ----- | --------------------------------------------------------------------------- | -------------------------------------- |
  | A     | `tools` + `tool_choice:'auto'`，问句要求用工具                              | 回包里有没有 `message.tool_calls`      |
  | B     | `tool_choice` 强制指定某个函数                                              | 支不支持强制                           |
  | C     | 多轮：`assistant.tool_calls` + `role:'tool'` 回填                           | 工具结果喂回去能不能续                 |
  | **D** | **`tools` + `response_format:{type:'json_object'}` 同给**                   | ★ 本单**承重**的一格                   |
  | **E** | **`tools` + `response_format: json_schema`**（`LLM_JSON_MODE=schema` 那档） | 同上，另一档                           |
  | F     | 判别对照：不存在的参数名 / 必填参数缺失的 tools 定义                        | 把「不支持 tools」与「参数写错了」分开 |
  | G     | 候选模型各打一遍 A 与 D（`.env.local` 那个 + §9.1 里 2–3 个）               | 结论要能说「换哪家还能用」             |
  | H     | `parallel_tool_calls:false`                                                 | 并行调用会让步数账变复杂               |

- [ ] D/E 是承重的理由：规划那一步**本来就吃 `LLM_JSON_MODE`**
      （`providers/registry.ts` 的 `textOptionsOf`），而网关把
      `tools` 与 `response_format` 判成互斥是很常见的一种实现。
      **如果 D/E 都不过**，工具那一档只剩「不带 `response_format`、靠提示词要 JSON」
      一条路——那会拿规划的输出稳定性去换工具调用，代价必须当场写清楚，
      **不许悄悄换掉**（判据 7 的三臂对照就是为了量这个代价）。

## 验收

- [ ] `scripts/probe-tool-calls.mts` 存在，`node` 直跑，退出码 0 = 「这条路上能用工具」
- [ ] **每一行结论都来自一次真实请求**，没有一行从 `/v1/models` 或文档反推
- [ ] 判读表覆盖：200 且 `tool_calls` 有值 / 200 但 `tool_calls` 缺席（= 模型不肯调，
      不是接口不支持）/ 400 参数类 / `MODEL_CAPABILITY_NOT_SUPPORTED` 一类 / 其他 → **没结论**
- [ ] 结论回填 [spec §四](spec.md) 与 `.env.example`（在 `LLM_*` 那一段加一行实测注释）
- [ ] **只要还剩一格没测成，就不许下全称否定**（限流会把「全称否定」灌水——这是
      B1 那轮踩过的第四个实例）。汇总里「有结论 / 没结论」分两栏打印

## 不做

- ✗ 不写 `tools` 的适配器（那是工单 06，本单只给结论）
- ✗ 不在这一单里决定步数上限与工具集合

## Comments

**2026-10-19 · 收工记录（判据与数字）**

产物：`scripts/probe-tool-calls.mts`（`node` 直跑）、
运行记录 `.out/probe-tool-calls.txt`（可重跑复现）、
B 那一格的追加样本在下面单独记（10 次）。

### 主轮：12 格全部有结论，0 格没结论

| 格  | 模型           | HTTP               | 读数                                                                                          |
| --- | -------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| A   | qwen3.8-flash  | 200                | **调了工具**（`read_shelf`）                                                                  |
| B   | qwen3.8-flash  | **400 / 200 交替** | ★ 见下，**不稳定**                                                                            |
| C   | qwen3.8-flash  | 200                | 网关收了，模型没再调工具，给了 154–357 字正文 ⇒ **多轮续得上**                                |
| D   | qwen3.8-flash  | 200                | **调了工具**（`tools` + `response_format:json_object` 同给）                                  |
| E   | qwen3.8-flash  | 200                | **调了工具**（`tools` + `response_format:json_schema` 同给）                                  |
| F1  | qwen3.8-flash  | 400                | `UNKNOWN_FIELD · 未知请求字段：xiaozhujue_no_such_field` ⇒ 网关**拦未知字段**                 |
| F2  | qwen3.8-flash  | 400                | `LITELLM_ERROR · 'name' is a required property - 'tools.0.function'` ⇒ 网关**确实解析 tools** |
| H   | qwen3.8-flash  | 200                | **调了工具**（`parallel_tool_calls:false` 可用）                                              |
| A   | glm-5.3-flash  | 200                | **调了工具**                                                                                  |
| D   | glm-5.3-flash  | 200                | 网关收了，但模型没调工具（221–227 字正文）                                                    |
| A   | deepseek-flash | 200                | **调了工具**                                                                                  |
| D   | deepseek-flash | 200                | **调了工具**                                                                                  |

### ★ B 那一格：同一个请求体，10 次里 7 次 400、3 次 200

第一轮与第二轮都回 400 `MODEL_TOOL_CHOICE_NOT_SUPPORTED · 当前模型或上游不支持
指定工具的强制选择方式，请改用 tool_choice=auto`；第三轮（为了留产物重跑的那次）
回了 **200 且真的调了 `read_shelf`**。于是又单独打了 6 次取样：

```
400 / 200 / 400 / 400 / 200 / 400        （追加 6 次）
累计：400 出现 7 次 · 200 出现 3 次
```

**读法**：网关后面挂着**多个上游**，对「强制点名」这件事能力不一致，
压到哪一个决定了这一次回什么。

**这不是「支持」也不是「不支持」，是「不可依赖」**——
所以设计后果只有一条：**工具循环里 `tool_choice` 只许写 `'auto'`**，
不许把强制点名当成兜底手段（写在 [ADR-0013](../docs/adr/0013-tool-calling-is-a-measured-arm.md) 与
`known-tradeoffs.md`）。

★ 这一格是**这一单最值钱的读数**，而它差一点被记成「不支持」：
前两次跑都回同一个 400，看上去是一条干净的否定结论。
**一次读数不是结论，两次也不是**——同一个请求体重跑第三次就翻了。
（与 B1 那轮「限流会把全称否定灌水」是同一族：**没量够就不许下全称**。）

### 结论

1. **`tools` + `tool_choice:'auto'` 可用**，三个模型都真的回了 `message.tool_calls`。
2. **`tools` 与 `response_format` 不互斥**（`json_object` 与 `json_schema` 两档都过）
   ⇒ **工单 06 不用放弃 `LLM_JSON_MODE`**，规划那条的 JSON 强制保持不动。
3. **多轮可续**（`assistant.tool_calls` + `role:'tool'` 回填 → 200 + 正文）。
4. **`tool_choice` 只许用 `'auto'`**（B 那一格）。
5. F1 严 + F2 是正对照 ⇒ **A 的 `tool_calls` 是真进了请求体的结果**，
   不是「参数被忽略、模型碰巧答对了」。
6. ★ 判别对照那一对（F1/F2）也顺带钉住一条实现约束：
   网关**严格校验请求体**，所以适配器不许往 body 里塞任何多余字段。

### 记账

- 调用次数：主轮 12 次 + 产物重跑 12 次 + B 取样 6 次 = **30 次**，全部一次成功，
  **全程没有触发限流**（所以「没结论」那一栏是 0，不需要退避）。
- 金额不记（口径见 `scripts/env.mts` 文件头）。
- 新 key 只读 `.env.local`；本脚本与产物里不含 key（`grep` 过）。

### ★ 这一单自己也踩了一脚，记下来防复发

**判读写错会把「正对照」记成「否定结论」。** 第一版的 `classify` 有两处错：

1. 模式写的是「未知字段」，而网关回的是「未知**请求**字段」→ F1 漏判、记成「没结论」。
2. F2 的 400 文案里有 `tools` 这个词，于是被判成「不支持 tools」——
   而它其实是「网关**解析了** tools 字段」的**正对照**。
   把正对照读成否定结论，正是这一单要防的那个错本身。

两处都改在 `classify` 里，并把顺序写进了注释（`shape` 先于 `tools-unsupported`）。
**正则漏一个词，读数就从「有结论」掉到「没结论」**——这一条比脚本本身更值得留下。
