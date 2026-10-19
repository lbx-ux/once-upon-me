# spec · 有感情的朗读（`mood` → 情感标签）

**日期**：2026-10-19 · **状态**：已实施

## 一句话

把 `StoryNode.mood` 一路接到阿里云百炼 Qwen-Audio TTS 的**控制类标签**上，
让配音不再是每页一个调子。

## 起因

用户原话：「我发现现在的音频读起来没有感情，阿里云的 tts 可以支持文本有感情的朗读，
你学习一下，并给以后的配音加上有感情的朗读」。

★ 这不是新需求，是**一条早就欠着的管道**：

| 位置                         | 早就写着什么                                                  |
| ---------------------------- | ------------------------------------------------------------- |
| `domain.ts:372`              | `MOODS` 的注释：「情绪标签：**喂给配音的语气**与画面 prompt」 |
| `prompts/story-plan.ts:228`  | 提示词对模型说：「mood … **它决定配音语气**」                 |
| `providers/types.ts:255`     | `SynthesizeRequest.mood` 字段                                 |
| `qwen-speech.ts:106`（改前） | 「本适配器还没有接情绪标签（没实测过），传进来**直接报错**」  |
| `narrate.ts:22`（改前）      | 「不传 `mood` 也不传 `pronunciation`」                        |

于是 `mood` 只去了画面 prompt，配音一路是平的——**提示词承诺过的事一直没人兑现**。

## 范围（用户 2026-10-19 定的）

- **只改引擎，不重录**。盘上已有的 101 段配音（首页演示书 5 段 + 灵感书单 12 本 96 段）
  保持原样；只有这次之后新生成的书才有感情。
- **只用控制类标签**（只调怎么念），**不用富语言类**（`[giggles]` / `[sighing]` /
  `[clears throat]` 那组会往音频里插进原文没有的声音）。

## 做了什么

1. `qwen-speech.ts`：`MOOD_TAGS`（6 个 mood → 控制类标签）+ `MOOD_TAG_MODELS`
   （三个认标签的模型，**精确匹配**）+ `supportsMood`；`synthesize` 把标签拼在
   `input.text` **最前面**。
2. `providers/types.ts`：`VoiceSynthesizer.supportsMood`；`SynthesizeRequest.mood` 收窄成 `Mood`。
3. `narrate.ts`：`NarrationTarget` 带 `mood`；去重键 `voiceId:mood:textHash`；
   模型不认标签时补一条非致命事件。
4. 文档与闸门。

## 判据

- 单测：6 个 mood 的请求体前缀、词表外的 mood 不发标签、名单外的模型不发方括号、
  去重键含 mood、不支持标签时的非致命事件。
- 真跑（`.out/tts-mood-e2e.mts`）：六页**正文逐字节相同、只有 mood 不同** →
  六份文件 + `joy` 的基频明显高于 `calm`。
- 试听（`.out/mood-listening.mjs`）：9 段样本，含 `tender` 的备选对照组。

## ★ 量出来的四件事（详见 `docs/known-tradeoffs.md`）

1. **HTTP 那条路也认标签**，不只文档那页的实时 WebSocket 路。
2. 标签是**被当控制符消费掉**的，不是被念出来（`[whispers]<句>` 4.70s，
   而把"低声耳语"四个字真念出来 7.18s）。
3. **无意义标签也改音频**（`[zzzznope]` +23.1%）→ 不许发词表外的标签。
4. **这家 TTS 不确定**：同一请求连打 12 次，不带标签的也出 2 种版本，噪声底 0.24s。
   → "两次字节不同"证明不了"标签生效"。

## 已知的弱处（都留给"听")

- `tender → [empathetic]` **没测出效果**（F0 整个落在对照区间里）。
- `joy` 与 `proud` 同档，听感上会重合。
- `wonder → [amazed]` 不稳（区间与对照交叠，像"有时生效"）。
- `[excited]` 还有**回落**的情况（偶发返回不带标签那一版）——见 `docs/known-tradeoffs.md`。

## Comments

- 2026-10-19：用户选定"只改引擎、不重录"+"只用控制类"。所以**这次改动的效果，
  在现有那 101 段音频上一个字都听不出来**——要听，得新生成一本，
  或者听 `.out/mood-samples/` 里那 9 段。
