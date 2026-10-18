# 02 · 我的音色：本地那份记录、合并音色表、模型绑定

Status: **done**（2026-10-16）

## 一条记录长什么样

```ts
export type MyVoice = {
  voiceId: string // 厂商回的
  name: string // 用户起的（默认「我的声音」）
  modelId: string // ★ 建它时的 TTS_MODEL —— 跨模型直接 400（实测），所以要记
  createdAt: number
  consentRef: string // 授权凭据号：删除时要能说出"这条音色是基于哪一次授权建的"
}
```

存 `localStorage['xiaozhujue.voices.v1']`。**样本不进这里**——样本从不上传以外的任何地方。

## 做

| 文件                                | 是什么                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/voices/store.ts`           | `loadMyVoices()` / `addMyVoice()` / `removeMyVoice()` / `MY_VOICES_KEY`。容错与 `settings/state.ts` 同一套：读不懂就当空、坏一条丢一条                                                    |
| `src/lib/voices/catalog.ts`         | `voiceCatalog(mine, currentModelId): VoiceOption[]`：预设在前、我的在后；`VoiceOption` 多两个字段 `source: 'preset' \| 'mine'`、`usable: boolean`（模型对不上的**不许选**，并在卡上说明） |
| `store.test.ts` / `catalog.test.ts` | 坏 JSON、坏条目、去重、模型不匹配那条判据                                                                                                                                                 |
| `SettingsProvider`                  | 多暴露一个 `voices`（合并表）与 `myVoices` + `refreshVoices()`——**一个值只有一个家**，`/home` 与设置抽屉都读它                                                                            |

## 判据

- 存进去 3 条，读回来还是 3 条且顺序稳定（新的在前）。
- 把 `modelId` 换成别的模型 → 那一条 `usable === false`，卡上给出原因。
- `voiceId` 重复时**不产生两张卡**（同一支声音出现两次，用户怎么点都一样）。

## Comments

**2026-10-16 · 落地**：`lib/voices/store.ts` + `lib/voices/catalog.ts` + `voices.test.ts`（10 条）。
`SettingsProvider` 多出 `voices` / `myVoices` / `rememberVoice` / `forgetVoice` 四样，
`/home` 的药丸与设置抽屉都改读它（不再各自 map `DEFAULT_VOICES`）。

浏览器里量到的：

- 建完一条 → `localStorage['xiaozhujue.voices.v1']` 里是
  `{voiceId, name, modelId, createdAt, consentRef}`，**没有一个字段是样本**；
- 当前音色被自动设成它，而 `settings` 里仍然**没有 key**（ADR-0008 照旧）；
- 把 `modelId` 换成别的模型再刷新：那张卡是「用不了」，两个钮都 `disabled`，
  `why` 里点名两个模型并写明"实测报 400"，而**「删掉它」还在**——一条废掉的音色
  更需要能删；
- 「删掉它」删掉当前音色时，`speech.voice` 被清空（不回落到另一个声音）。

★ 顺带一条**实测反证**（真跑时撞出来的，值得记）：删掉的音色再拿去合成，厂商回的是
`[cosyvoice]Engine error [411]`，而**跨模型**也是同一个 411。也就是说光看错误分不出
"模型换了"还是"音色没了"——所以"建它时的模型"这个字段不是记账，是**唯一**能分辨这两件事的判据。

---

**2026-10-18 · 用户报：「做绘本时，选择自己生成的声音就会报错，选择其他声音就不会」**

屏幕上是这一句：**「音色 id 太长了（64 字以内），多半是别的字段串进来了」**
——而它出现在"开始创作"之后，于是**这一本做不出来**。

**先量，别猜。** 探针 `.out/voice-id-shape.mts`（走**同一个适配器、同一个 prefix**，
拿厂商自己的 TTS 输出当样本，**建完立刻 release**，账号里不留东西）：

```
create_voice 成功 3910ms
  voice_id = qwen-audio-3…f14f（68 字）
  ★ 64 字那条线：**超了 4 字**
  含空格/引号/花括号：没有（是个正常 id）
release 150ms → released=true
```

拆开是 `qwen-audio-3.0-tts-flash`(24) + `-xiaozhujue-`(12) + 32 位随机 = **68**。
也就是说：

- **64 这个数是当初猜的**（`book-api.ts` 的注释写"写长了必然是别的字段串进来了"，
  那是在解释这个猜测，不是在记一次测量）。厂商的 id **本来就是 68 字**，条条如此。
- 它拦下的恰好是**用户自己录的那一条**：预置那两个只有 17 / 12 字，永远碰不到这条线
  ——所以这个 bug 只在"用自己克隆的音色"那条路上出现，与用户描述的形状**逐字吻合**。
- 后端的列是 `voice_id VARCHAR(128)`（`server/src/main/resources/db/schema.sql:177`），
  存得下 68 ✓ ——所以是**界面比库更严**，而不是库里塞不下。这一条决定了新上界取多少。

**改法**：

1. 新文件 `src/lib/voices/id.ts` —— 这条判据原来有**两个家**（`book-api.ts` 的
   `MAX_VOICE_ID = 64` 与 `rerun-api.ts` 里**硬写的 64**），同一个数写两遍，
   改一处不会想到另一处。现在两处都 import 它。
2. 上界 **64 → 128**：与后端那一列**同一个数**（于是"界面放行、库里放不下"这种错法不会出现）。
3. "别的字段串进来了"这件事**没有不管**，只是换了判据：**看字符集，不看长度**——
   厂商 id 的字符集是 `[A-Za-z0-9._-]`，而一个串了字段的字符串必然带空格 / 引号 /
   花括号 / 斜杠 / 中文。旧的那条判据是**用长度猜形状**，两头都不准（真 id 被误伤，
   128 字以内的串字段照样过）。
4. 报错那句话里补上**实际长度**（旧的那句只说了界限，用户没法判断差多少）。

**判据留在测试里**：`id.test.ts` 拿**实测那条 68 字的 id 字符串**当输入（不是随手编一个
长得像的），断言它过；`book-api.test.ts` 那条"太长要拦住"从 65 改成 129，
并新增一条"串了字段"的（`我的声音 小宇` 这种 128 字以内、必须靠字符集拦下的）。
`rerun-api.ts` 那条也一并换成同一个函数 —— 重跑一页也要能用自己的声音。
