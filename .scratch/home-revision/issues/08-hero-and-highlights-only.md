# 08 · 首页只留首屏标题与第三屏亮点（第三轮）

Status: done

用户 2026-10-19 第三次看首页，原话：

> 首页我还是不喜欢，这接给上面的 12 个主题删了，还有第二屏的示例绘本，
> 这个也不要了，删了，就留第一屏的标题和第三部分的亮点

即：**首页从三节砍到两节** —— 首屏（品牌 + 主张句 + 两颗按钮）与第三屏
（五条亮点的轮播 / 竖排卡）。删掉的是：

- 首屏上那 12 个主题。它有两个形态：桌面是 `HeroOrbit` 的 3D 环，
  手机是这一轮刚做的 `ThemeStrip` 横向卡带（09 那一单）。
- 第二屏那本滚动翻开的示例绘本（`StorybookFlip`，含页面里的正文、
  选择点、朗读控件、页码条）。

## 这不是"display: none"，是**把两节连同它们的组件一起下架**

本仓那条规矩（CLAUDE.md「不糊弄」＋ `.pf__section` 那次）：**没有的东西直说没有**，
不留一段"看起来还在、其实没人渲染"的代码或样式 —— 那样下一个人会照它做判断。
所以这一单的删法是把整条依赖链删掉，而不是在 `page.tsx` 里少写两行：

| 删掉的                                                                                   | 它只服务谁                              |
| ---------------------------------------------------------------------------------------- | --------------------------------------- |
| `hero/HeroOrbit.tsx`、`hero/hero-orbit.css`                                              | 那个环（首屏的壳抽出成 `Hero`）         |
| `hero/ThemeStrip.tsx`、`hero/theme-strip.css`                                            | 手机上顶替环的卡带（09 那一单）         |
| `book/StorybookFlip.tsx`、`book/storybook-flip.css`、`book/BookSpine.tsx`                | 第二屏那本书                            |
| `book/demoBook.ts`、`book/spreadTints.ts`、`lib/demo-book-audio.ts`                      | 那本书的内容 / 纸色 / 朗读在不在        |
| `lib/useScrollDriver.ts`、`lib/orbit.ts`、`lib/orbit.test.ts`                            | 两节共用的滚动驱动 / 环的摆位数学       |
| `lib/theme-handoff.ts`（+ 测试）、`StartCreating` 里那次量环、`CreateLanding` 的进场接力 | 环上那 12 张 → 工作台主题墙的那一次接力 |
| `scripts/chk-book-narration.mjs`                                                         | 那本书的朗读（它打的正是首页那 5 段）   |

**不删**：`public/book/`（26 个文件，那本书的图与 5 段 mp3）与
`public/scenes/scene-2.webp`。理由与 `public/demo/books/` 那条一致 ——
资产还在、还能用，只是不再由首页带路；删二进制不是这一单该顺手做的事。

## 连带要改的（每条都是"不改就会坏/会说假话"）

1. `app/page.tsx`：两节 + `SceneBackdrop` + `BackToTop`；首屏不再读盘
   （`readDemoBookAudio` 只服务那本书），于是首页回到**零服务端 IO**。
2. `SceneBackdrop`：`ANCHORS` 从三节变两节（`.hero` / `.hl`），
   第 2 幕（午后草坡那张，构图是"一本书落在草地上翻开"）随第二屏一起退场。
3. `chk-mobile.mjs` 判据 7：7c（第二屏正文块）整条删掉，换一条**新的 7c** ——
   "首页现在只有两节"（`.storybook` / `.hero-orbit` / `.theme-strip` 一个都不在 DOM 里，
   且 `.hl` 的顶边 ≤ 1.2 屏）。7a / 7b / 7d / 7e 照旧，只改文案里指路的路径。
4. `check-reader-paper.mts` 的点阵孪生：它读的是 `.storybook__ambient`
   （"活的源头"），现在改读 `.hero__ambient`（首屏那一条，同一套
   `--dot` / `--dot-size` / `2px 2px` / `.75px`）。
5. 文档：`README.md` 首页那一段与脚本表、`docs/known-tradeoffs.md` 新增一节
   （三处实测的坏 → 这一轮为什么整节下架 → 哪些契约作废）、`globals.css` 里
   几条指路的注释、`math.test.ts` 里那条"复现交接段推导"的用例。

## 不在这一单里

- 不改第三屏（五条亮点的内容、轮播、竖排卡）一个像素。
- 不动 `src/lib/engine/`。
- 不删 `public/` 下任何资产。

## Comments

- 2026-10-19 完工。删了 **16 个文件**（清单见上表），新增 `hero/Hero.tsx` + `hero/hero.css`
  （`hero-orbit.css` 的净身版：一屏高、文案居中、点阵与柔光、两颗按钮、那 200ms 退场）。
- **量到的形状**（`chk-mobile.mjs`，61/61 通过）：
  · 首屏就是一屏：390×844 上 844px、360×640 上 640、412×915 上 915；亮点顶边与它相等
  （旧版首屏是 `max(1120px, 168vh)` = 1.68 屏）。
  · 首页只剩两节：`.storybook` / `.hero-orbit` / `.theme-strip` 在 DOM 里**一个都没有**。
  · 主张句右端 350 ≤ 350（390）· 320 ≤ 320（360）· 372 ≤ 372（412）。
  · 亮点竖排卡正文列 305 / 279 / 325；那五张图**5 次请求 / 5 个不同 URL**，
  手机那五张与桌面轮播那五张是同一批 URL。
  · 桌面 1440×900：`.hl` 五张图照常取全（5/5）。
- **两条判据是照形状标定的，形状一换就自己红了**（重标定的过程记在
  docs/known-tradeoffs.md 那一节）：
  · 7c 原来量"第二屏正文块够不够宽 / 撞不撞底部控件"——那一屏没了，改成"首页只剩两节"。
  · 7d 原来量"滚到亮点之前 0 次请求"——两节之后 `.hl` 的顶边就在 1 屏处，
  头两张卡落进 Chrome 的懒加载余量、跟着首次加载一起取（实测 +339ms 发出）。
  这不是回归，是**页短了的必然**；改判"五张各下一次"＋"两套 DOM 同一批 URL"。
- **差一点删错的地方**：`.book-choice` 那一族住在 `storybook-flip.css` §6，但它真正的
  消费者是**独读版阅读器**（`ReaderBook.tsx`）。整族搬进了 `reader-book.css`，
  连它那两条仍然成立的规矩（`visibility: hidden` 开关、`--tilt` / `--lift` 拆 transform）。
  阅读器里那段"静止模式推翻首页那两条"随之删掉（没有可推翻的东西了）。
  教训：删样式文件要按"**选择器还有没有别的读者**"分类，不是按"文件属于哪一屏"。
  同一条也保住了 `book/flip.ts`（两台阅读器在用）。
- **`pnpm check:colors` 在动手之前就是红的**（不是这一轮引入）：`hero-orbit.css` 里
  `.btn--ghost` 的 `rgba(255, 255, 255, .86)` 与 `.btn__spin` 的 `rgba(255, 255, 255, .35)`。
  搬进 `hero.css` 时一并改成 `rgba(var(--surface-rgb), …)`（同一个色），闸门现在是绿的。
- **不改的**：`public/book/`（26 个文件，含那 5 段 mp3）与 `public/scenes/scene-2.webp`
  留在盘上没人引用（与 `public/demo/books/` 同一档）。首页从此**不演示"朗读"**——
  能听见的地方是阅读器，这一条记在 docs/known-tradeoffs.md 那一节里，免得日后当成故障。

---

## 2026-10-19 晚 · 用户澄清：**只有手机那一档**

> 我只让你删的是移动段的，没让你删 web 端的首页啊，web 端的首页和以前一样

所以这一单的"整条下架"**只对手机那一档成立**。web 端把 14 个文件
（`git checkout HEAD --` 逐个拿回）与四处连带改动全部恢复；另外两个
（`Hero/ThemeStrip.tsx`、`theme-strip.css`，从未提交）**没有回来**，
手机那一档现在连主题都不演。

两节怎么收、三处"藏起来不等于不花钱"的账、判据 7c/7d 的重标定与新增的 7f/7g、
桌面基线五项全等、以及 7e 修掉的那处"一直在假绿"——全部记在
[docs/known-tradeoffs.md](../../../docs/known-tradeoffs.md) 同名那一节里。
本单的 Status 保持 done，但**它的范围要按这句话读**：改的是手机。
