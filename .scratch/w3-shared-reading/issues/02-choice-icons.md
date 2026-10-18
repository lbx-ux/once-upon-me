# 02 · 选择点图标：封闭词表 + 手工出一批

Status: open（**提示词已成文**：2026-10-18 写出 [`docs/choice-icon-prompts.md`](../../../docs/choice-icon-prompts.md)，
20 枚的形状要点、通用骨架、盘上那两枚的实测数与验收表都在里面；**等出图**，18 枚待画）
依赖：[01](01-shape-and-prompt.md)（词表定稿在那边）

## 做什么

1. 按 `CHOICE_ICONS` 出一批小图标，走现成档位：

   ```bash
   python -I scripts/make-webp.py <源图目录> public/book/icons --preset book-icon
   ```

   `book-icon` = 1:1 / 192px / ≤15KB —— 首页那两枚云图（`choice-dino.webp` /
   `choice-ship.webp`）就是这一档，不用新增预设。

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

- [ ] 每枚 ≤15KB、192×192、`RGB`（不留 alpha）
- [ ] ★ **图没到位时露 emoji，不留裂图**：`alt=""` 的 `<img>` 在 404 时什么都不画，
      所以兜底 emoji 会正好露出来。用一个不存在的 key 实测一遍，截图。
- [ ] `docs/choice-icon-prompts.md` 里每一张的提示词可复现

## 边界

- 这一单**不阻塞** 01/03/04：词表与 emoji 兜底先行，图可以整周并行等。
- 不重出首页那两枚云图（**那本演示书一行不动**，见 spec §七）。
