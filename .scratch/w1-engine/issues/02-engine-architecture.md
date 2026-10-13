# 02 · 引擎架构与目录定稿、TS/规范落地（#10、#11）

Status: done

## 做了什么

```
src/lib/
├─ engine/
│  ├─ index.ts        唯一入口：runBook(request, deps) → Book，过程 = 事件
│  ├─ domain.ts       领域类型（角色卡 / 树 / 页 / 资产 / 出处 / 统计）
│  ├─ events.ts       ★ 引擎与 UI 的 seam：事件协议（SSE / MCP / 日志共用）
│  ├─ tree.ts         扁平页表 → 故事树（纯函数）
│  ├─ plan.ts         ② 规划：Schema 校验 + 带反馈的重试
│  ├─ illustrate.ts   ③ 逐页生成 + 一致性核对 + 重画（Agent）
│  ├─ digest.ts       内容指纹与规范化序列化（纯函数）
│  ├─ errors.ts       显式失败，无静默降级
│  ├─ character-card/ card.ts 派生规则（纯） + store.ts 资产读写
│  └─ providers/      types.ts 能力接口 · registry.ts env→实现 ·
│                     http.ts · openai-text · openai-vision · tokenrhythm-image ·
│                     replay.ts（录制/回放）· stores.ts（内存/磁盘）
├─ schemas/           schema.ts 自写校验器（一份定义两用） + story.ts 输出契约
└─ prompts/           story-plan.ts · image.ts —— 带版本号，学费进代码
```

**模型不写死**：全仓库零个硬编码模型 id。`registry.ts` 只认
`LLM_MODEL` / `IMAGE_MODEL` / `VISION_MODEL`，缺一个就报
「换模型不许改代码」。适配器按**协议**分（OpenAI 兼容对话 / tokenrhythm 图像），
不按厂商分——同一家换模型不改代码，换协议才加一个适配器。

**TS/规范落地**：

| 加的东西                                                                                 | 效果（实测）                                                                                                               |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `verbatimModuleSyntax`                                                                   | 0 处改动通过。它同时是「node 能直接跑 .ts」的前提：类型导入必须显式，否则运行时留个不存在的 import                         |
| `noImplicitOverride` / `noFallthroughCasesInSwitch` / `forceConsistentCasingInFileNames` | 0 处改动通过                                                                                                               |
| `allowImportingTsExtensions`                                                             | 引擎内部一律写 `./x.ts`，node 原生 ESM 才解析得了                                                                          |
| `tsconfig.engine.json` + `noUncheckedIndexedAccess`                                      | 新代码吃最严档；**已交付的三屏不吃**（实测 67 处报错，全在 `flip.ts` / `StorybookFlip` / `HeroOrbit` / `useScrollDriver`） |
| `no-restricted-imports` + `no-restricted-globals`（仅 engine/schemas/prompts）           | 禁 `react` / `next/*` / `@/components/**` / `window` / `document` / `localStorage`                                         |

## 验收：不启动浏览器跑完一本书

```
$ node scripts/engine-run.mts --mode=stub --form=shared --out=.out/engine-run
角色卡 xiaolu-r1 r1 参考图指纹=22d46f111c37 锚点 6 条
[02] 故事编好了：《小宇的云》，5 页，1 个选择点
[05] 第 1 页没法核对（比对模型不可用）
[18] 配音能力未接入（W4 落地），这本书暂时没有朗读
[19] 书做好了：xiaolu-r1-3befb9c2a76b
完成：5/5 页有图，图像调用 5 次，成本 0.00 元，耗时 0.06s
```

落盘：`cards/xiaolu-r1/{ref.<digest>.webp, r1.<digest>.json, latest}` +
`books/<bookId>/{book.json, page-1-a1.webp … page-5-a1.webp}` + `summary.json`。

`--mode=stub` 用的是仓库里已有的 5 张演示成图与固定分镜表，**零网络零花费**；
`--mode=live` 走真供应商并顺手录制 manifest；`--mode=offline` 用 manifest 回放。
三种模式跑的是同一条流水线，只有适配器不同。

## 测试

`pnpm test`：8 个文件 **130 条**（W1 之前 51 条）。新增的 79 条里
有 1 条测的是**校验器自己的 bug**：`stringList` 的 `item` 参数被当成 `min` 用，
症状是"正文太短"这种查半天的失败 → 改名 `itemMax` 并补测试钉住。

## Comments

- 10/13 Zustand **没装**。看板写"W1 架构定稿时才装"，但定稿之后仍然没有一个
  消费者（创作流 UI 在 W2），装了就是一行没人用的依赖。
  架构层面该画的边界画了：状态从 `runBook` 的入参进、从事件出。
  **W2 第一个跨组件共享状态的界面出现时再装**，那条决定记在 ADR-0006。
