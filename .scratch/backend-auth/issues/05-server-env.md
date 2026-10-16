# 05 —— 密钥搬到服务端：`serverEnv()` 与"请求体里不再有 env"

`Status:` **open**

## 要做什么

ADR-0008 说"密钥由用户自带、只从请求体来"。ADR-0009 把它反过来：
**密钥由站长分配、只从服务端环境来**。这一张做的就是把那句话落成代码：

- `src/lib/settings/server-env.ts`（新）：`serverEnv()` 从 `process.env` 取
  `LLM_*` / `IMAGE_*` / `VISION_*` / `TTS_*`，剪空白、空串不写（与 `toEnv` 同一条规矩）。
  它就是原来 `envFromBody` 那个位置的替代品。
- 所有会花钱的 Route Handler 三件事一起做：
  ① `env` 从请求体换成 `serverEnv()`；② 加 `requireCapability`（工单 04）；
  ③ 删掉请求体里 `env` 的解析。
  涉及：`/api/books`、`/api/books/[bookId]/pages/[pageNo]`、`/api/cards`、
  `/api/cards/revise`、`/api/cards/analyze-photo`、`/api/optimize`、
  `/api/voice/{preview,clone,delete}`。
- 客户端那条参数整条退场：`toCardBody` / `toBookBody` 的 `env` 形参、
  `book-api.ts` 的 `envOf`、`GenerationRun` / `ChildDetail` / `NewChild` /
  `NewVoicePanel` / `VoicePicker` 里传 `env` 的地方。
- 删 `src/lib/settings/request-env.ts` 与 `/api/settings/probe`：
  密钥不在用户手上了，一条"能拿请求体里的 key 去打请求"的路留着才是坏的。

## 怎么算做完

- 网络面板里任一生成请求的 body 里**搜不到 `env`**。
- 把 `.env.local` 的 `LLM_API_KEY` 换成另一把，生成照样走新的那把
  （证明它真的从服务端读，而不是从缓存/请求体来）。
- 三条闸门（format/lint/typecheck）全绿——这一次改动面很大，绿是硬要求。
