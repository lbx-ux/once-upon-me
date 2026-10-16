# 03 · 草稿 / 成品两态

Status: done
依赖：无
上游：spec §三（"确定生成"要有可见后果）

## 一、问题

书号是"卡 + 版 + 形态 + 主题"的指纹（`engine/index.ts:301`），**不含时间戳**。
`runBook` 收尾就把 `book.json` 写进 `books/<id>/`，`listBooks` 立刻就能列出它——
也就是说，**书在跑完那一刻就已经是一本完整的书了**，"确定生成"无事可做。

用户要的是：跑完的书先是一份**草稿**，看过每一页、该重画的画完了、点「确定生成」，
它才成为一本成品。

## 二、要什么

1. `Book.status?: 'draft' | 'published'`（`engine/domain.ts`）。
2. `BookRequest.status?` —— **引擎原样透传**，它不定策略。
   ★ 与 `voiceId` 同一条理由（`index.ts` 已写）："默认音色是产品概念，不是引擎概念"。
   草稿还是成品同样是产品概念，所以引擎只把它抄进清单，判据留在调用方。
3. `listBooks` / `summarize` 如实带出 `status`（`lib/library.ts`），
   书架那两排由它分开。
4. 新接口 `POST /api/books/[bookId]/publish`：把 `status` 翻成 `'published'`。
   回一张凭据（`bookId` + 新的 `status`），**不回整本书**。

## 三、★ 缺省值 = 成品（一条迁移决定，必须写进注释）

盘上已经有两种**没有这个字段**的书：

1. 随仓库提交的预生成演示书（`public/demo/books/`）；
2. 这个字段之前跑出来的所有运行期书。

把缺省判成草稿会让它们**凭空从书架消失**——而"我的故事"那一栏突然少几本，
用户只会以为书丢了。所以：

```ts
/** 缺省 = 成品。理由见工单 03 §三 */
export function isDraft(book: Book): boolean {
  return book.status === 'draft'
}
```

判据写成"只有明确写着 `draft` 的才是草稿"，不是"只有写着 `published` 的才是成品"。

## 四、草稿从哪儿回去做（不许变成没人看得见的垃圾）

**书架上带标记，不离场**：草稿那一本封面角上标「还没做完」，
点进去是 `/create?book=<id>`（复用 `replayFrames` 把过程和每页状态重建出来）。

两个动作：

- **继续做** → `/create?book=<id>`
- **不要了** → 复用现成的 `DELETE /api/books/<bookId>`（`lib/book-deletion.ts` 已经会
  连派生内容一起删、还会剪 `shelf/order.json`）。**不新写一条删除路径。**

★ 为什么不做"草稿自动过期清理"：一个定时删用户东西的机制，在没有真的量到"草稿堆成灾"
之前，是在替用户做一个他没要求的决定。真堆起来的时候，先加的是"一次列出来全选删除"。

## 五、验收

- `pnpm test`：`summarize` 对缺 `status` / `'draft'` / `'published'` 三种输入的结果；
  `isDraft` 的判据
- 端到端：跑完一本 → `/shelf` 上它在「还没做完」那排且标着草稿 →
  点「确定生成」→ **重新读盘**（刷新）之后它在成品那排，`book.json` 里是 `"published"`；
  阅读器两态都能翻开（草稿也要能预览，否则"看过每一页再决定"没法成立）

## Comments

- 2026-10-16 做完了。`Book.status` / `isDraft`（`engine/domain.ts`）、
  `BookRequest.status` 原样透传、`library.ts` 的 `summarize` 带出 `status`、
  `POST /api/books/[bookId]/publish`、书架那一排草稿。

**实测**（一次真跑 + 一次浏览器里真点 + 两次 curl）：

```
跑完   → book.json: status=draft
书架   → 出现「还没做完 · 继续做 →」（2 处：可见文字 + 读屏）
点「确定生成」（CDP 真点那颗按钮）
       → 主按钮变「已装订」且禁用 · book.json: status=published
       → 书架那一排「还没做完」消失
再 POST 一次 → 200（幂等：连点两下不该看见一句红字）
退回 draft → 「还没做完」立刻回来（书架读的是盘上的事实，不是内存里的）
```

★ **缺省 = 成品**这条迁移决定写进了 `Book.status` 的注释：盘上两种老书
（预生成演示书、这个字段之前的运行期书）都没有 `status`，判成草稿会让它们凭空消失。
