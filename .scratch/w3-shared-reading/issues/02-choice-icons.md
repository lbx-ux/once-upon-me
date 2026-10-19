# 02 · 选择点图标：封闭词表 + 手工出一批

Status: **交付**（2026-10-19：用户手出 18 枚源图，**13 枚落盘并全部过验收**；
另外 5 枚（`kite` 收形线基本没有、`cake`/`star`/`bird`/`cat` 描边整条偏暖 = 另一支笔）
**用户同日决定不重出**，是终态不是待办——那 5 个 key 留在词表里、盘上没有文件，
命中时走实测过的 emoji 兜底。逐张读数与原因在
[`docs/choice-icon-prompts.md`](../../../docs/choice-icon-prompts.md) §九 / §十）
依赖：[01](01-shape-and-prompt.md)（词表定稿在那边）

## 做什么

1. 按 `CHOICE_ICONS` 出一批小图标，走现成档位：

   ```bash
   python -I scripts/make-webp.py <源图目录> public/book --preset book-icon --match 'choice-*'
   ```

   `book-icon` = 1:1 / 192px / ≤15KB —— 首页那两枚云图（`choice-dino.webp` /
   `choice-ship.webp`）就是这一档，不用新增预设。
   （★ 落盘目录是 `public/book`，不是这里原先写的 `public/book/icons`——
   2026-10-19 按 §八 落盘时改正；`iconUrlOf` 拼的是 `${CHOICE_ICON_DIR}/choice-${key}.webp`。
   另外 `--match 'choice-*'` 会把源目录里 `choice-` 开头的全收进来，所以源目录里
   不能放 `choice-dino` / `choice-ship`。）

2. 提示词与逐张验收记录进 `docs/choice-icon-prompts.md`（与
   `docs/cover-art-prompts.md`、`docs/figure-art-prompts.md` 同构：规格 + 逐张提示词 +
   体检数 + 废弃批次记录）。
3. 落盘位置与 `iconKey` 的对应关系**只有一处实现**（`iconKey → URL` 的函数，
   与 `artPath()` 同一形状），供阅读器与闸门取用。

## 词表的口径（三条，都是判据不是审美）

- **每枚都能当任一侧的选项**：不要"上/下""左/右"这类方向词——两条支是"恐龙背 vs
  船肚子"，不是"左边 vs 右边"。
- **一枚一个物件**，不画场景、不画人物（它是按钮里的图标，在 96–120px 上要一眼认得出）。
- **与绘本同一支笔**（水彩 + 彩铅收形）：emoji 是扁平 clip-art，与水彩是两套画法——
  这正是"不许只放 emoji"的判据；但**兜底仍然用 emoji**（见下）。

## 验收

- [x] 每枚 ≤15KB、192×192、`RGB`（不留 alpha）
      —— **已落盘的 13 枚全过**（882–1,788 B，合计 15,676 B；RIFF / `VP8 ` / `RGB` /
      192×192 / 无 `ALPH` / RIFF 长度 == 文件长度 − 8）。另 5 枚用户决定不重出，
      这 5 个 key 由 emoji 兜底（下一条实测的就是它们会走的那条路）。
- [x] ★ **图没到位时露 emoji，不留裂图**：`alt=""` 的 `<img>` 在 404 时什么都不画，
      所以兜底 emoji 会正好露出来。用一个不存在的 key 实测一遍，截图。
      —— **真跑过**：`.out/chk-choice-icon-fallback.mjs`（隔离 dev server 3311 + CDP
      逐像素相减），**13 / 13 判据、连跑两遍都过、噪声底 0 像素**。两道闸门都验了：
      词表外的 key → 连 `<img>` 都不出现（`src === null`）、emoji 露着；
      **词表内但盘上没文件** → `<img>` 真出现、网络上真 404，`alt=""` 让它交给屏幕的
      只是抗锯齿级抖动（均 6.0，对真图的 27.83、底色的 170.2）。红对照把 `alt` 改成一句话
      → Chrome 当场补出替代文字（6,216 px / 均 31.55）。读数全在 §9.1。
- [x] `docs/choice-icon-prompts.md` 里每一张的提示词可复现
      —— §五 20 张的【参考图】/【主体】两段齐全，§九 / §十 的每个数都配了可跑的命令

★ 还有一条**没做、需要决定**的（记在 §9.4）：`src/lib/choice-icons.ts` 里
`iconUrlOf` 写着"不回一个指向 404 的地址"、`hasChoiceIcon` 写着"这个 key 盘上有没有图"，
而在有 key 在词表里、盘上却没文件时**这两句都不成立**（`iconUrlOf('kite')` 今天回的就是
那个 404 地址）。真正兜住它的是 `alt=""`。改不改注释与函数名是一个决定，没有顺手改。

## 边界

- 这一单**不阻塞** 01/03/04：词表与 emoji 兜底先行，图可以整周并行等。
- 不重出首页那两枚云图（**那本演示书一行不动**，见 spec §七）。
