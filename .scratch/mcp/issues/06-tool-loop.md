# 06 · 引擎侧的工具循环

Status: done（2026-10-19 收工：14 条单测 · 判据 8 与 9 都钉住了 · 跑测抓到一处真 bug）
依赖：**[01](01-probe-tool-calls.md) 的结论**（D/E 两格过不过决定这一张怎么做）
依据：[spec §四](spec.md)、[ADR-0013](../docs/adr/0013-tool-calling-is-a-measured-arm.md)

## 要做的事

- [ ] `src/lib/engine/providers/types.ts`：`TextRequest` 加可选 `tools` /
      `toolChoice` / `messages`，`TextResponse` 加可选 `toolCalls`。
      **全是可选字段**——不传就是今天那条路，逐字节相同。
- [ ] `src/lib/engine/providers/openai-text.ts`：payload 里带
      `tools:[{type:'function',function:{name,description,parameters}}]`；
      解析 `choices[0].message.tool_calls`；多轮时把
      `assistant.tool_calls` 与 `role:'tool'` 回填。
- [ ] 新建 `src/lib/engine/tool-loop.ts` + `tool-loop.test.ts`。
      ★ 仍然不许 import React / next / 文件系统——**工具是注入的 `ToolDef[]`**，
      与 `PlanRetriever` 同一条边界。
- [ ] 四条边界：
  - **步数上限**（缺省 4）。到顶不下来就**不带 tools 再问一次**，逼它给最终答复——
    **不许静默截断**（截断的症状是"故事莫名其妙短了"）
  - **工具抛错不终止**：错误原文当 tool result 喂回去（模型自己能改），
    但**必须发一条 `{kind:'error', fatal:false}` 事件**——否则
    「模型自己在改」与「什么都没发生」在屏幕上分不出来
  - **非法参数**（模型给的 JSON 对不上 schema）走同一条：喂回去，不让它炸循环
  - **模型一次都不调工具**直接给答案 = 合法结果，不是失败
- [ ] **与流式互斥**：`onDelta` 与 `tools` 同时给 = 配置错误，当场抛。

## 验收

- [ ] `tool-loop.test.ts` 对上面四条边界各一条用例（用假 provider，不打网络）
- [ ] 新事件 `{kind:'tool'; name; ok; ms; note?}` 进 `events.ts`，
      并有 `describeEvent` 一句人话（中文）+ `isDisplayable` 为 true
- [ ] 判据 8：**不传 `tools` 时，规划那条的请求体逐字节等于今天**——
      照 `src/lib/engine/plan-retrieval.test.ts` 那条同族写法加一条
- [ ] `node scripts/engine-run.mts --mode=stub` 退出码 0（引擎硬约束不许破）

## 不做

- ✗ 不让引擎知道任何具体工具是什么（语料 / 书架 / 闸门都在 `plan-tools.ts`）
- ✗ 不做并行工具调用（`parallel_tool_calls:false`，步数账会变复杂）

## Comments

**2026-10-19 · 收工记录**

改的：`providers/types.ts`（`tools` / `toolChoice` / `messages` / `toolCalls`，**全是可选**）、
`providers/openai-text.ts`（拼 `tools`、解析 `tool_calls`、多轮回填）、
`engine/tool-loop.ts` + 14 条单测、`events.ts`（新 `tool` 事件）、
`components/creation/frames.ts`（工具事件落 `desk.planning`，与 `retrieved` 同一条处置）。

### ★★ 跑测抓到的真 bug：空正文 + `tool_calls` 被误判成"回了个空壳"

**这是这一单最值钱的一条，而且它差一点溜过去。**

模型决定调工具时，回包是 `finish_reason: 'tool_calls'`、`content: ''` ——
**那是正常回包**。而 `complete()` 原来无条件把空正文当失败抛掉，于是
"模型要调工具"在适配器这一层就被判成"供应商回了个空壳"。

抓它的路径值得逐步记下来：

1. `scripts/probe-tool-calls.mts` 的 A 格**早就打过**这行读数：
   「调了工具（`message.tool_calls` 非空）· **正文 0 字**」。
   当时它被读成"工具调用长这样"，**没被读成"空正文"**。
2. 三臂对照的第三臂上，**有一本直接 `call-failed`**，报的正是
   「回包里没有正文（content=string(0)，finish_reason=tool_calls）」。
3. 两件事连起来才看清：探针报了一个数，而"那个数意味着什么"隔着一整个下游。

**所以判据 6（探针）与判据 7（三臂对照）不是互为备份，是各管一段**：
探针给出的是**读数**，对照给出的是**这个读数在下游会不会坏事**。

修法：`text === '' && toolCalls.length === 0` 才抛（两个条件缺一不可），
并单独补了三条回归测试（正常回包不抛 / 没有工具调用的空正文仍然抛 /
坏掉的那条丢掉、好的留着）。

### 判据

| 判据                                  | 读数                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| 9 · 四条边界各有单测                  | ✅ 14 条：步数用完 / 工具抛错 / 坏 JSON / 一次都不调                             |
| 9 · 步数用完**要说出来**              | ✅ 到顶后**不带 tools** 再问一次，并补一条非致命 error                           |
| 9 · 工具抛错**不终止**                | ✅ 错误原文喂回，且 `tool`(ok:false) 与 `error`(fatal:false) 两条都发            |
| 8 · 不传 tools 时请求体逐字节等于今天 | ✅ `plan-tools-wiring.test.ts`：没有 `tools` / 没有 `messages`，仍是 system+user |
| 互斥当场抛                            | ✅ `tools`+`retrieve` / `tools`+`onDelta` 各一条                                 |
| 引擎硬约束不许破                      | ✅ `node scripts/engine-run.mts --mode=stub` 退出码 0                            |

### 一处设计修正（测试抓的）

第一版"最后一轮还在要工具"是**抛**。测试逼出这个分支之后看清了：抛会把
"模型有点怪"升级成整步崩溃，而下游（`plan.ts` 的 schema 校验）本来就会把
"这段文本不是一张合法故事表"说得更清楚。改成**带着已写出的文本往下走 + 一条非致命 error**。
