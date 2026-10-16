# 01 · 次序：`shelf/order.json` 与 `applyOrder`

Status: done（2026-10-16）
对应 [spec.md](spec.md) §一（顺序那一节）

## 改了什么

- **新增 `src/lib/shelf-order.ts`**：`SHELF_ORDER_PATH`、`loadOrder`、`saveOrder`、
  `applyOrder`、`pruneOrder`、`moveTo`。
- **新增 `src/lib/shelf-order.test.ts`**。
- `src/app/api/books/route.ts`：加 `PUT`（body `{order: string[]}`，剪枝 → 写盘 → 回
  `{order}`）；`GET` 的返回值也过一遍 `applyOrder`。
- `src/app/(studio)/shelf/page.tsx`：`applyOrder(await listBooks(...), await loadOrder(store))`。

## 三条规则（每条一条用例）

1. **清单没见过的最前**。理由见 spec §一（"我的书是不是没存上"）。
2. **死 id 忽略**，写盘时顺手剪；文件不因为空了就删。
3. **清单只管次序、不管存在**：`applyOrder` 认识的 id 就是 `books` 里那几本，
   多余的丢、缺的补（补到最前面）。

## 两处不显然的

- **`loadOrder` 要 `try/catch` 并退回默认序。** 不是防御性编程，是两个 store 实现的
  一个真实分歧：`readJson` 对**半截 JSON**（进程被杀时最后写的那一件）——
  **内存 store 抛错、fs store 回 null**。`library.ts` 为同一件事写过一次。
  一个排不上顺序的书架该照常显示，不该整页 500。
- **`moveTo(order, id, index)` 的下标是"去掉被拖的那一本之后"数出来的。**
  拖动时算出来的目标位置天然就是这个口径（`rest` 与那个假想的列一模一样），
  所以调用方那边的下标可以直接传进来——"抽掉的那一本在目标前面还是后面"
  那种偏移是这类代码最常见的一处错，签名把它消掉了。
- **`SHELF_ORDER_PATH` 在 `books/` 外面**：`listBooks` 扫的是 `books/` 前缀下的
  `book.json`，同一棵树里再塞一个非书的文件，迟早会被某次遍历当成书数进去。

## Comments

- 2026-10-16 为什么不用 `localStorage`：书架是服务端渲染的，浏览器里存顺序 = 首屏按
  默认序渲染、挂载后再跳一次，正是 `ShelfDashboard.tsx` 文件头刚说过的"挂载前后两副面孔"。落盘还顺带让"换台设备顺序还在"自然成立。
- 2026-10-16 为什么 `PUT` 写的是**全量次序**而不是"把 X 挪到 Y"：拖动会连着改好几次，
  一次一次增量下发等于把"当前这一份是什么"复制到两端；全量是幂等的，重发一次不会有
  第二种结果。剪枝（`pruneOrder`）之后**回写剪过的那一份**，让调用方与服务端对齐。
- 2026-10-16 ★ `PUT` **不做"最多 N 条"那种上限**：书架上有几本书由盘上那几本决定，
  这里再多一道闸门只会变成第二个真相（真要有几万本，先出问题的是 `listBooks`）。
