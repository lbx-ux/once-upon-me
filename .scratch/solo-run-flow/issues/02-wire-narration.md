# 02 · 把配音这条线接通（今天它是断的）

Status: done
依赖：无
上游：spec §四.1（音色只有一个家）

## 一、今天的事实

`CreateBookBody`（`lib/book-api.ts`）里**没有 `voiceId`**，`toBookBody()`（`lib/creation/state.ts`）
也不传。所以从界面跑出来的每一本书，`runBook` 收到的 `request.voiceId` 都是 `undefined`，
引擎走 `index.ts:207` 那条非致命 error：

> 没指定音色（voiceId），这本书没有朗读

**结论：从界面做出来的书，一次朗读都没有过。** 这不是"没做"，是"接了但没接上"——
而它是用户要的那个「是否配音」开关的直接前置。

## 二、要什么

1. `CreateBookBody` 加 `voiceId?: string`。
2. `parseCreateBody` 校验它：字符串、trim 后 64 字以内（音色 id 是厂商侧的一个标识，
   写长了必然是别的字段串进来了）。**不填是合法的**——不填就是"这本不配音"，如实说。
3. `toBookBody()` 接受一个 `voiceId`，有才传（与 `wish` 那条 `...(wish ? {wish} : {})` 同一写法：
   **不传一个空串让引擎去猜**）。
4. `POST /api/books` 把它透传进 `BookRequest.voiceId`（那个字段本来就有，只是没人用）。

## 三、音色只有两个来源，别造第三个

| 谁决定               | 存在哪                          | 谁写                             |
| -------------------- | ------------------------------- | -------------------------------- |
| 这一本**要不要**朗读 | 这一次请求的 `voiceId`（有/无） | 弹窗那个开关（工单 04）          |
| 用**哪个**音色       | `settings.speech.voice`         | `/home` 那颗药丸、`/voice`、弹窗 |

★ 弹窗里**不新造一份状态**：它读的、写的都是 `settings.speech.voice` 那一个字段
（`SettingsProvider.patch('speech', …)`）。复制一份的那天起，同一个值就有了两个家。

## 四、缺语音能力时怎么表现

`canNarrate`（`SettingsProvider` 给的 `speechReady(settings)`）为假时：

- 弹窗里的「朗读」开关**禁用**，并说清为什么（缺 key 还是缺模型，`speechReady` 那句话就是）；
- 点它**直接打开设置抽屉**（缺的东西在哪里就把哪里打开——仓库既有习惯，
  见 `CreateLanding.optimize()` 与 `CreateFlow` 那颗「打开模型与密钥」）；
- **不许静默降级成不配音**：那会让用户以为"我开了朗读"而书里没有声音。
  运行视图在**生成之前**就要把那句"这一本不会有朗读"说了（今天 `CreateFlow` 已经这么干）。

## 五、验收

- `pnpm test`：`parseCreateBody` 带 `voiceId` 过、不带也过、超长被拒
- 端到端：关掉朗读跑一本 → `book.json` 的 `narrations` 为 `[]`、
  阅读器**没有**播放控件、运行视图上那句说明在生成**之前**就出现了；
  开着朗读跑一本 → `narrations` 非空、阅读器有播放控件

## Comments

- 2026-10-16 做完了。`CreateBookBody.voiceId` → `parseCreateBody` 校验（64 字上限）
  → `toBookBody(form, env, {voiceId})` → `POST /api/books` 透传进 `BookRequest.voiceId`。

**实测**（同一次真跑，`--voice=env` 用的是 `.env.local` 里那个音色）：

```
清单：status=draft · voiceId=longjielidou_v3.6 · narrations 3 条
```

`narrations` 里三页各一条 `page-N-a1.mp3`，`voiceId` 与请求里那个一致——
**这是从界面这条路上第一次真的做出带朗读的书**。在此之前 `voiceId` 这个字段
根本不在请求体里，引擎收到的永远是 `undefined`，走那条"没指定音色"的非致命 error。

**另外补了一条**：`Book.voiceId`（引擎侧）。`narrations` 为空有"不做"与"没做成"
两种成因，运行视图要按这个区别说不同的话（"不配音" vs "有 3 页没配上音"），
所以那个事实必须记在清单上，不能靠推断——同一条纪律见 `domain.ts` 的"缺图 vs 未核对"。

**还补了一个探针缺口**：`scripts/web-run.mts` 的白名单里原来**没有** `TTS_*`，
所以它跑出来的书永远走"没有朗读"那条——那不是探针的判据，是它根本没把语音那张表递过去。
