# 04 · 主题墙与派生资产

Status: done（2026-10-15）
依赖：03

## 一、墙

12 个主题各一张水彩封面（`public/art-cards/{key}.webp`，320×180，实测平均 11 KB、
合计 0.13 MB），点一下同时填 `wish` 与 `theme`（复用 `ofTheme()`）。
选中态是一条 2px 陶土内描边，**不填色**——填色会和右下角那颗主按钮抢"这才是动作"。

它同时**吃掉那三枚 emoji 建议卡**：`SUGGESTION_THEMES` 与 `suggestions()` 就此没有消费者，
删掉并同步了 `example-wishes.test.ts`（★ 不许留一份没人读的表）。

## 二、资产怎么来的（不新出图、不花钱）

`scripts/make-webp.py` 加一档 `theme-card`（16:9 / 320 / ≤18KB）。源就是仓库里已有的
`public/art/*.webp`（本来就是 16:9），**不裁只缩**，所以这一步是恒等变换
（与跨页那档同一条道理）。派生关系写进了 `docs/cover-art-prompts.md`。

## 三、★ 删掉的一档：`chip-icon`（以及它那 12 个文件）

原计划还要一档 1:1 / 96 的"主题小圆图"，落点是书架那一行主题名前面的 emoji。
真到落地时看清楚了：**书架那一格上面已经有一张 72px 的同主题水彩**，
再挂一枚小图是**同一个主题的两张画**，而且是两套画法（README §五那条）。

于是 emoji 直接删掉（不换成图），连带删掉：

- `public/icons/themes/`（12 个文件，合计 0.03 MB）
- `make-webp.py` 的 `chip-icon` 预设
- `lib/themes.ts` 的 `themeIconPath()`
- 它唯一的消费者——`example-wishes.test.ts` 里那条断言

★ 判据是"**谁读它**"，不是"它好看"：**没有消费者的资产与没有消费者的表是同一种东西**。
本项目为后者付过学费（`SUGGESTION_THEMES` 那次），所以这次按同一条处理。

`THEMES[].emoji` 这个**字段**留着：书里那套"图没到位时露出 emoji"的兜底机制还在用
（`book/demoBook.ts`、`engine/domain.ts`），它是有消费者的。

★ 顺带把当时真量过的数记进 `make-webp.py` 的文件头：中心裁方**会切掉 16:9 画面
左右各 22%**，12 张逐张看过才算过。真要重做这一档，这一刀还得重新逐张看。

## Comments

- 图缺失时这里什么都不画，卡面留一块 `--card-paper` 的空框，文字照样读得出来
  （与选择点、第三屏同一机制）。显式 `width` / `height` + `aspect-ratio`：
  图还没到时也占住这一块，不跳。
- `alt=""`：主题名就写在图下面，读屏不必再念一遍。
- 不走 `/api/assets?w=`：静态 `public/` 走不到那条通路（Next 直接发盘上的字节，
  查询串它看不懂，挂 `?w=` 会静悄悄回原图，见 README §五「缩略档」那条）。所以预生成。
