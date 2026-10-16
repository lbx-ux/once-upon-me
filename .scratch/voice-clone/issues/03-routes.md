# 03 · 两条路由：创建与删除

Status: **done**（2026-10-16）

## `POST /api/voice/clone`

请求体：`{ env, sampleBase64, mime, name?, consentRef? }` → `{ voiceId, modelId, name }`。

- env 只从请求体来（ADR-0008），服务端 `process.env` 不参与；
- 走 `voiceProviderOf(env).clone({sampleBytes, mime, consentRef})`，
  适配器内部把样本编成 data URL 发出去——**样本不进磁盘、不进日志**；
- 边界：`mime` 不在支持列表 → 400（适配器也会挡一次，这里先挡是为了给出一句人话）；
  base64 解出来的字节 > 10MB → 400；
- 供应商的错误**照原文回**（截断），不吞、不包装成成功。

## `POST /api/voice/delete`

请求体：`{ env, voiceId }` → `{ released: true }`。

- 走 `release(voiceId)`；失败抛错不吞（`qwen-speech.ts` 里那条注释已经写明理由：
  一个把失败变成 `{released:false}` 又不说的实现，会让凭据看起来是干净的）。

## 做

| 文件                                | 是什么                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/voice/clone/route.ts`  | 上面那条                                                                                                                     |
| `src/app/api/voice/delete/route.ts` | 上面那条                                                                                                                     |
| `route.test.ts`（两条）             | 用**桩 env** 走 `providers/replay` 之外的那条路不行就退一步：把 `fetch` 换成桩、断言请求体形状与错误路径。**不联网、不花钱** |

## 判据

- 真调一次（用真 key、合规样本）→ 200 + voice_id，用它合成 200，删掉后再合成 400。
  状态码/字节/耗时记进 spec 或本单 Comments。
- 非法 mime / 空样本 / 超限 → 400 且给得出原因；供应商 4xx → 502 且回原文（截断）。

## Comments

**2026-10-16 · 落地**：`/api/voice/clone`、`/api/voice/delete`，校验抽在
`lib/voices/request.ts`（8 条用例，含"没有授权凭据号就 400"），env 抽在
`lib/settings/request-env.ts`（顺带把试听那条路由也换过来了）。

**真跑一次的记录**（`.out/clone-e2e.mjs`，真 key，打的是这两条真路由）：

| 步                       | 结果                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 样本                     | 18.2 秒 · 583,008 字节 WAV（16k 单声道，由 TTS 自己生成的一段语音转出来）                                              |
| `POST /api/voice/clone`  | **200** · 3,851 / 5,667ms · `qwen-audio-3.0-tts-flash-xiaozhujue-<32hex>` · 回的 `modelId` 与请求里的 `TTS_MODEL` 一致 |
| 用它合成                 | **200** · 2,187 / 2,323ms · 44,251 字节 · md5 `c1529b1e…` / `655fb50d…`                                                |
| `POST /api/voice/delete` | **200** · 790 / 217ms · `{"released":true}`                                                                            |
| 删完再合成               | **502** · 厂商原文 `HTTP 400 · InvalidParameter · [cosyvoice]Engine error [411]`                                       |

最后一行是这一单最要紧的证据：**"删干净了"不是靠那句 200 说的，是靠"再用它就哑了"证出来的。**

★ 样本从来不在磁盘上：产品那条路上它只出现在请求体里（适配器编成 `data:` URL 发出去）。
`.out/` 下那两个文件是探针自己为了造样本写的中间物（gitignored），不是产品写的。

★ 一处**没有按原计划做**的：工单里写"非法 mime → 400"由路由判，实际上路由只认
**我们客户端那一种**（`audio/wav`）——因为选进来的 mp3/m4a 是在浏览器里被转成 WAV 才发出去的。
路由不再是"厂商的门"，而是这一屏客户端的门；厂商那层仍然由适配器挡一次（两处都在）。
