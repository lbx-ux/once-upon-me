# 01 · 封面地址：一条路，两个档

Status: done（2026-10-16）
依赖：无。对 [02](02-bookcase-rack.md) 是前置
对应 [spec.md](spec.md) §三

## 为什么这是一单，不是 02 里的一行

书架上要显示封面，就要有一个"运行期资产路径 → 可请求的 URL"的函数。
在那之前，这件事的答案散在两处（阅读器一处、`/api/books` 一处），
而书架要的是**第三个宽度**。三个地方各写一遍 `?w=`，早晚会变成
"书架上那张封面按 1024 在拉"——它不会报错，只会变慢，然后就没人发现。

所以先把这条路收成一条，再说 UI。

## 做了什么

1. `src/lib/book-source.ts` 加唯一入口：

   ```ts
   export function runtimeAssetUrl(path: string, width: number): string {
     return assetUrlOf(path, isResizableImage(path) ? width : undefined)
   }
   ```

   阅读器那条改用它（`READER_PAGE_WIDTH = 1024`），书架走 `SHELF_COVER_WIDTH = 384`。
   **非图（mp3 / json）不套 `?w=`**：给一段音频做"缩略图"是胡话。

2. `src/lib/library.ts`：`BookSummary` 加 `coverUrl: string | null`。
   `summarize(book, coverUrl)` 与 `listBooks(store, coverUrlOf)` 都**要求调用方把
   算地址的那个函数递进来**。

   ★ `noCovers` 刻意**不做默认值**：默认成 `null` 的话，"调用方忘了传"与
   "这本书真的没封面"就变成同一个结果，而这两件事的后果差很远。
   名字写出来摆在调用点上，忘了传是编译错误。

3. 调用点三处：`/api/books`（384）、`/shelf` 页（384）、`children-list.ts`（`noCovers`，
   因为那一屏不显示封面）。

## Comments

- 2026-10-16 实测（`scripts/probe-shelf.mts`，真浏览器截 Network）：
  `200 /api/assets/books/xiaolu-r1-bf84901c4fcd/cover.png?w=384`
  —— 走的是 384 档，不是原图、也不是阅读器的 1024。这一条判据的性质是
  「只有 URL 真走对了才会长这样」，比断言 DOM 上有个 `background-image` 有判别力。
- `library.test.ts` 钉了两件事：① 摘要原样带着调用方算出来的地址（`null` 就是没有）；
  ② `listBooks` **每一本都过一遍**那个函数、拿回来的原样进摘要。
  fixture 里那几本书**真的没有** `cover` 字段，所以传 `null` 是如实的，不是偷懒。
