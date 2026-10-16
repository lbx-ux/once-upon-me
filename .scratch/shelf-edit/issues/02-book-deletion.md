# 02 · 删一本书：`book-deletion.ts` 与 `/api/books/[bookId]`

Status: done（2026-10-16）
依赖：[01](01-shelf-order.md)（要划掉的那一格就在 `shelf/order.json` 里）
对应 [spec.md](spec.md) §一（删除那一节）

## 改了什么

- **新增 `src/lib/book-deletion.ts`**：`bookOnDisk`、`bookTargets`、`planBookDeletion`、
  `deleteBookEverywhere`、`BookDeletionReceipt`、`BookTargets`。
  `DeletionPlace` 从 `child-deletion.ts` **转出**（`export type { DeletionPlace }`）
  ——界面那边的渲染只有一套。
- **新增 `src/lib/book-deletion.test.ts`**。
- **新增 `src/app/api/books/[bookId]/route.ts`**：`GET`（预演）/ `DELETE`（真删），
  形状与 `/api/children/[childId]` 一样（两者共用一个 `refuse()`）。

## 为什么预演走 GET、真删走 DELETE（同一个文件里）

界面上那两步是同一件事："列出要失去什么" → "确认"。分成两个文件的话，两种拒绝
（没有这一本 / 删不干净）就要么复制一段、要么再抽一层，而复制的那天起，
"预演说能删、真删说没有"就会开始出现。

★ 预演是**按需**取的，不是书架一渲染就去数一遍：数一遍要遍历这本书的目录与 `thumbs/`
的五个档位，而大多数人永远不点删除。为每一次浏览都付一次目录遍历，是把代价放在最不
该放的地方（同 `/api/children/[childId]`）。

★ 拒绝的两种情形话不一样：

- 盘上没有这一本 → **404**。这不只是客气话：用户看到的书架是服务端渲染的，
  另一个标签页刚删掉它时，"再删一次"就会走到这里。
- 删到一半失败 → **500 + 带上那张不完整的凭据**（哪些删了、哪些没有）。
  只说"删除失败"会让人以为一样都没删，而"确实删了一半"与"什么都没删"要让用户做
  两件不同的事：前者不用重试（再删一次也不会更干净），后者可以重试。

## 凭据里的三个位置与它们各自的数字

| 行         | 预演报的                   | 真删报的                    |
| ---------- | -------------------------- | --------------------------- |
| 这本书     | `list()` 数出来的文件数    | `deletePrefix` 真删掉的条数 |
| 缩略图缓存 | 五个档位目录里数出来的     | 五个档位各删一次、加在一起  |
| 顺序记录   | 在清单里就是 1，不在就是 0 | 划掉就是 1，本来不在就是 0  |

★ 顺序那一行**不走 `deletePrefix`**：要的是"把书名划掉、别的项留着"，`saveOrder`
正好干这件事（剪枝也是它自己的事）。

★ 数出来与真删的数**不共用**——共用的话，"预演说 4 条、真删说 4 条"就变成同一个数
读了两遍，凭据也就不再能证明"真的删了这么多"。

## Comments

- 2026-10-16 为什么 `bookTargets` 里带 `images/audios/logs/others` 四个分类计数：
  凭据第一行那句人话就是它们拼的（「4 条 · 1 张图 + 1 段朗读 + 1 份过程日志 + 1 份清单」）。
  分类**不参与删除**，只参与解释。
- 2026-10-16 ★ `titleOf` 读不出来时**不跳过**：跳过的症状是"删除漏了一本书"，而凭据上
  什么都看不出来。半截 JSON 就照实写「（读不出来的一本）」。
- 2026-10-16 ★ 这一层**不导出 `DeletionPartialError`**：`child-deletion.ts` 那边导出了
  它，但 `deleteChildEverywhere` 从头到尾不抛——那个 `instanceof` 分支是够得着的假象。
  这一层把 `complete:false` 与 `failed` 原话写进凭据，路由照着回码。
- 2026-10-16 实测（`scripts/probe-shelf.mts` ⑫，跑在隔离资产根上）：确认框 3 行，
  第一行报 4 条、缩略图那一行报 1 条；确认后这一本从架上与 `GET /api/books` 里都消失，
  另外 8 本照旧。盘上核账：`books/probe-01/` **整目录消失**、
  `thumbs/384/books/` 空了、`shelf/order.json` 里不再有 `probe-01`。
