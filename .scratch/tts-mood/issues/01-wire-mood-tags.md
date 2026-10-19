# 01 · 把 `mood` 接到情感标签上（适配器 + 引擎）

**Status:** done · 2026-10-19

## 要做什么

见 [`../spec.md`](../spec.md)。工单这一张只覆盖**代码**，实测台账在 `02`。

## 动了哪些文件

| 文件                                           | 改了什么                                                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/engine/providers/qwen-speech.ts`      | `MOOD_TAGS` / `MOOD_TAG_GLOSS` / `MOOD_TAG_MODELS` / `supportsMood` / `speechTextOf`；`synthesize` 里的"带 mood 就报错"换成"拼标签"；**文件头第 5 条重写**（它原来写的是反话），并把"这家 TTS 不确定"这条踩坑记在第 5 条里 |
| `src/lib/engine/providers/types.ts`            | `VoiceSynthesizer.supportsMood`（只读能力位）；`SynthesizeRequest.mood` 从 `string` 收窄成 `Mood`                                                                                                                          |
| `src/lib/engine/narrate.ts`                    | `NarrationTarget.mood`；`targetsOfNode`/`narrateNode` 填 `node.mood`；去重键 `voiceId:mood:textHash`；`narrateAll` 的"这个模型不认标签"非致命事件；**文件头第 4 条重写**，规则 1 补 mood 那一节                            |
| `src/lib/engine/narrate.test.ts`               | 假 voice 加 `supportsMood`；`node()` 收 mood；新增"情绪"一节 6 条                                                                                                                                                          |
| `src/lib/engine/rerun.test.ts`                 | 假 voice 加 `supportsMood`                                                                                                                                                                                                 |
| `src/lib/engine/providers/qwen-speech.test.ts` | 把"带 mood 必须报错"**反过来**，新增"情绪标签"一节 5 条                                                                                                                                                                    |

## 几个刻意的决定

1. **标签在适配器里生成，引擎层不出现任何厂商词。** 引擎只搬运 `Mood` 这个
   与供应商无关的领域词（与 `SYNTH_PATH` 留在适配器里是同一条道理）。
2. **`calm` 不发标签。** 平稳叙述就是这个音色的默认状态。这一格也是最容易想改的一格。
3. **贴在最前面，不逐句贴。** 逐句贴实测会多出 **0.36s 的开头静音**、整段多约 0.96s
   （`.out/tts-mood-place.mjs`）——对一个"点一下就播"的控件，开头 0.36s 的死气是缺陷。
   而"标签只管到下一刀"这个担心，实测在**两句正文上跨过了第一个句号**（两处停顿都变短了）。
   三句、49 字那一段上没量干净（厂商对同一段文本会给出不同版本，逐段时长不可比）——
   这一条**没测出来就是没测出来**，记在 `02` 里。
4. **名单外的模型不发标签、也不报错**，改由 `narrateAll` 说一句人话。
   报错会让换模型的人整本配音全挂（而这是本次**新引入**的故障），
   静默变平则是当初这个 bug 的样子——两条都不能要。

## Comments

- 2026-10-19：全部完成，`pnpm test` 1245 passed（97 files）、`typecheck` 双 tsconfig 全过。
- 2026-10-19：★ `pnpm lint` / `format:check` 见工单 `02` 的 Comments（那边记闸门结果）。
- 2026-10-19：`src/lib/mcp/`（**未跟踪**，另一个会话正在写）在 `pnpm typecheck` 里报 3 条
  与本次改动无关的错（`AGE_BAND_LABELS` / `bookExists` / `EventLog`）。
  `tsconfig.engine.json` 单独跑是干净的——**引擎这一侧没有错**。
  那是别人的活，没有动它。
