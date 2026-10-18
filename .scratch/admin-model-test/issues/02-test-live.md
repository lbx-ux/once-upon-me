# 02 · 「测试连通」：四种能力各真打一次

Status: done

## 做什么

- `model-config.ts`：加 `TEST_REQUEST`（四支各发什么）、`testLineOf(capability)`（卡片副标题）、
  `testSeedOf(capability)`（预填值：图像那句提示词、语音那句 `PREVIEW_LINE`，
  文字与视觉是空串）；`modelConfigView()` 每一节多回 `testLine` / `testSeed`。
- `model-config-state.ts`：`SectionView` 多这两格，`parseSection` **缺任一个就整份拒绝**
  （放宽成"缺了当空串"的话，服务端哪天少回这一句，那颗**按下去要花钱**的按钮底下就没有说明）；
  加 `ModelTestResult` 与 `parseModelTestResult`（`ok` / `capability` / `ms` 不齐就整份不认；
  图 / 声 / 锚点是"通的证据"，缺了当没有，不因此整份拒绝）。
- 新 `src/app/api/admin/model-test/route.ts`：`POST /api/admin/model-test`，
  `requireAdmin` 闸 + 四支真调用；`runtime` / `dynamic` 是按仓库那条测试要的**字面量**。
  失败回 200 + `ok:false` + 一句人话（`adminFailureOf` 拼的，后面附厂商原文）；
  视觉 / 语音没配全回 400 `provider-not-configured`（用的是管理页那套措辞）。
  不落盘、不重试、不写日志；视觉那张图按 `MAX_PHOTO_BYTES` 卡一道尺寸。
- `provider-messages.ts`：加 `adminFailureOf(error)`——只改写一处
  （`provider-not-configured` 在用户端说的是 ADR-0008"去找站长"，在这一屏上正确的下一步是
  "把缺的那一格填上并保存"），其余原样委托 `userFailureOf`。
- `admin/client.ts`：`testModelCapability(capability, { prompt?, photo? })`。
- `ModelConfig.tsx`：测试那一块（图像给提示词输入框、视觉给 file 输入、语音印出要念的那句、
  一颗「测试连通」+ 图像那颗旁边的花钱提示），结果区（`<img>` / `<audio>` / 它说的话 /
  锚点粒）；`save()` 与 `reset()` 之后**清掉上一次的测试结果**（配置变了，上一次的结果
  不再是这套配置的结果——留着比没有更坏）。
- `admin.css`：`.adm__test`（虚线分隔：上面是写进文件的值，下面是按下就花钱的一次调用）、
  `.adm__test-go` / `.adm__test-out` / `.adm__test-shot` / `.adm__test-audio` /
  `.adm__test-said` / `.adm__test-anchors`。

## 判据

- `pnpm vitest run src/lib/settings` 全绿，其中三条是新的同源断言：
  副标题里的 token 数 == `TEST_REQUEST.text.maxTokens`；图像副标题里的尺寸 ==
  `TEST_REQUEST.image.size` == `DEFAULT_IMAGE_SIZE`；语音预填值 == `PREVIEW_LINE`。
- `scripts/chk-admin-model.mjs … --live=1` 在隔离栈上四种各真点一次。

## Comments

- 2026-10-18 完成。四支**真打通了**（隔离栈：独占 dist 的 dev server 3353 → 真后端 8082 →
  真厂商），而且那一按是**真鼠标点**（`Input.dispatchMouseEvent`，不是 `element.click()`）：

  | 能力 | 结果                                                                                                                      |
  | ---- | ------------------------------------------------------------------------------------------------------------------------- |
  | 文字 | 0.7 秒 · `qwen3.8-flash` · 它回的是「能。」                                                                               |
  | 图像 | 27.2 秒 · `wan2.7-image` · 3.46 MB 的 data URL，浏览器**解码出来了**（`naturalWidth > 0`）                                |
  | 视觉 | 53.5 秒 · `kimi-k2.6` · 从那张示例卡参考图里读出 **7 个**中文锚点（骨相 / 眼睛 / 头发 / 头身比 / 肤色 / 特征记号 / 常服） |
  | 语音 | 1.1 秒 · `qwen-audio-3.0-tts-flash` · 55 KB 音频，`<audio>` 有 src，念的是「哗啦啦，大雨落下来。」                        |

  ★ 每一支都记了「这个坐标最上面那一个是不是它」（`elementFromPoint`）：
  四支都是 `BUTTON.adm__newgo`、`落在它身上: true`——它证明的是这一按**真落到按钮上**，
  而不是被哪一层盖着（`element.click()` 绕过命中测试，盖住照样"通过"）。
  ★ 第一次跑时下面两张卡（视觉 / 语音）静默落空：它们的坐标在视口之外，
  `elementFromPoint` 返回 `null`、鼠标事件也落不到。`clickAt` 因此加了
  `scrollIntoView({ block: 'center' })`。这条写进脚本注释了。

- **两次真故障也都撞上了**（都是在隔离栈上真打厂商时撞的，不是构造的）：
  - 图像那支有一次回 **ECONNRESET**（`tokenrhythm-prod-backup-oss.oss-cn-beijing.aliyuncs.com`
    那一段被本机代理掐断，见记忆里那条 fake-IP 代理）。★ 它顺手暴露了一句**错文案**：
    `fetchBytes` 把"把图**下回来**"那一步的失败也报成 `asset-write-failed`，
    而那句话原来只说"磁盘满了或目录不可写"——屏幕上于是让人去清磁盘（磁盘是空的）。
    已改成两件都说得对（详见 03）。
  - 视觉那支有一次回 **502（上游故障）**，界面给的是「平台那边超时或不可用。等一会儿再试，
    或者换一个模型。你们的 key 没有问题。（原文：`/chat/completions` 失败 HTTP 502）」。

- **不通那一支也真跑过**：故意把视觉那把 key 改错
  （`PUT /api/admin/model-config/vision {"apiKey":"sk-wrong-on-purpose-000"}`），
  测试回的是「这台服务器不认你填的 API key…（供我们排障的原文：`/chat/completions` 失败
  HTTP 401 · UNAUTHORIZED · …）」；随后 `DELETE` 把那份覆盖文件恢复成 `{}`。
- **没配全那一支**：另起一条 dev server（3354，把 `VISION_*` / `TTS_*` 清空）→
  400 `provider-not-configured`，文案是管理页自己那句"把缺的那一格填上并保存"。
- **非管理员**（用演示账号的票）→ **403**「这一屏只有管理员能看」。
- 全程只写 DOM：脚本从不点保存、不点恢复默认，磁盘上那份模型配置一个字都没动
  （唯一动过的是上面那次**故意**改坏的 key，已还原）。
