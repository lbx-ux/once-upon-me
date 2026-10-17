# 04 · 书架（以及另外两屏）认下"还没开始画"的那一本

Status: done（2026-10-17）
依赖：[02](02-story-draft-and-api.md)
对应 [spec.md](spec.md) §三（第二个取舍）

## 改了什么

- `src/lib/library.ts`：`BookStatus` 多一档 `'story'`；`listBooks` 除了 `books/*/book.json`
  也扫 `books/*/story.json`（一个目录**有故事没清单**就是那一本）；新增 `summarizeStory`
  与 `booksOnly`。
- `src/components/shelf/ShelfDashboard.tsx`：「正在编辑」那一栏认下它——
  `8 页 · 还没开始画` / 「继续编 →」，**没有「制作为绘本」**（那一颗打的是 publish，
  而盘上还没有 `book.json`，会以 404 告终）。两个 filter 从 `status === 'draft'` 改成
  `status !== 'published'` / `status === 'published'`。
- `src/app/(studio)/account/page.tsx` 与 `src/lib/children-list.ts`：走 `booksOnly`
  把这本摘出去（两处理由不同、结论一样：那一屏点进去是阅读器 / 那句数说的是"几本**书**"）。
- `src/lib/library.test.ts`：四条新用例。

## 三处不显然的

1. **"有 story.json 没有 book.json" 是判据**，不是清单里那个 `status`——清单还没写呢。
   ★ 两样都在时**清单说了算**：故事草稿只是这一本曾经的样子，而书已经画出来了。
2. **`booksOnly` 把 `'story'` 从返回类型里减掉**（类型谓词）：个人主页那一屏的
   `RecentBook` 只有"草稿 / 成品"两种标签，把 `'story'` 留在类型里就是逼它在下游再判一次。
3. **书号取目录名**，不读 `story.json` 里的 `bookId` 字段：后者是写进去的，而目录名是它
   唯一的家（`bookDirOf` 那段"三处各写一遍会漂"是同一个道理）。

## Comments

- 2026-10-17 删除那一层**一行没改**：`book-deletion.ts` 删的是整个 `books/<id>/` 目录，
  `bookOnDisk` 判的是"这个目录里有没有东西"——一本只有故事的本子本来就落在这条路上。
- 2026-10-17 归类：`'story'` 与 `'draft'` / `'published'` 说的都是**盘上有什么**
  （有没有图 / 用户说了算不算），**不是同一根进度轴上的三个刻度**。合成一个百分比会
  把"没画"与"没装订"说成同一件事，而它们的判据、能做的动作、要不要花钱都不一样。
- 2026-10-17 **端到端实测**（`GET /api/books`，隔离 dev server 3341）：三本同时在架上，
  三档状态都出现了，且**都认得对**：

  | 本子               | `status` | `pageCount` | `illustratedCount` | `coverUrl`          |
  | ------------------ | -------- | ----------- | ------------------ | ------------------- |
  | 停在闸门上的那一本 | `story`  | 3           | 0                  | `null`              |
  | 画完没装订的       | `draft`  | 5           | 5                  | `…/cover.png?w=384` |
  | 上一轮做的（8 页） | `draft`  | 8           | 8                  | 有                  |

  停在闸门上的那一本，标题读的也是**改过的那一个**（书名不是留在内存里的，
  是从盘上那份草稿来的）。

- 2026-10-17 **一条实测出来的边界，说清楚不装作没有**：这一条的判据是"有 `story.json`
  没有 `book.json`"，所以**②正在跑、还没装订的那几个小时里**，书架上也写着 `status: 'story'`
  （"还没开始画"），而盘上其实已经有几张 `page-*.png` 了——上面那张表里第一行的
  `illustratedCount: 0` 就是在一本已经画到第 2 页的本子上读出来的。
  这个偏差的窗口是"一次②从开跑到装订完"，之后自动消失（`book.json` 一落盘就归到 `draft`）。
  要做得更细就得在②每一步之后回写 `story.json`，那是另一个量级的开销——所以这里选择
  **写下来**而不是悄悄留着。（用户看不见这个窗口：那一屏本来就写着"正在一页一页做"。）
