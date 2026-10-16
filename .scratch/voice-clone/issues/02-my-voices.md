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
