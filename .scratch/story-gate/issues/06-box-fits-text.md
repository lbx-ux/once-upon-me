# 06 · 那两个文本框：装得下字，而且**一根滑轨都没有**

Status: **done**（2026-10-18）
对应 [spec.md](spec.md) §二（闸门那一屏的每页三个框）

## 用户原话（两次，隔了一天）

1. 「这个生成的文本长了，就自己适应一下，把这个文本框拉长，这件事不要让用户去做」
   —— 于是有了 `src/lib/use-autosize.ts`（框自己长高，`rows={2}` 只留作没有 JS 时的高度）。
2. 「我的意思是每次都把文字铺满文本框，就不要右边这个滑动的了」
   —— **第一遍没做完**：框长高了，可它长到的高度正好压在那条线的边上。

## 为什么第一遍是绿的、而用户那边是红的

判据不同。第一遍的判据（`.out/probe-six.mjs` 检②）是
`clientHeight >= scrollHeight - 1`——**那 1px 的容差正好把问题盖住**：

```
line-height: 1.7 × 14.5px = 24.65px        → 两行正文 = 49.3px
内容需要：49.3 + padding 16 + border 2      = 67.3px
框实际高：`scrollHeight + border`           = 67px     ← 短 0.30px
而 scrollHeight / clientHeight 都只能是整数：65 与 65   ← 差被吞掉，判据恒真
```

`.out/probe-autosize.mjs` 里把那一格**再调矮 1px**（66px）就：`scroll 65 > client 64`，
滑轨当场出现，宽 **15px**。也就是说"没有滑轨"与"有一根 15px 的滑轨"之间只隔 1px，
而 `scrollHeight + border` 把框放在了这条线上——整数化往**上**取的那个引擎
（另一版 Chromium、另一个缩放比、另一套字体度量）就跨过去了。用户的机器在那边，
我的 headless Chromium 在这边：**同一本书、同一份 CSS，我看不见那根滑轨，他看得见。**

## 改了什么

- `src/lib/use-autosize.ts`：`height = scrollHeight + border` → `+ border + 1`，
  再补一个 `while (el.scrollHeight > el.clientHeight)` 的兜底（最多 4 次）。
  退出条件是**浏览器自己说不再需要滑轨**，不是再猜一个数——猜出来的数正是这一处踩的坑。
- `.out/probe-autosize.mjs`（新）：量**滑轨本身**（`offsetWidth - clientWidth - 左右边框`，
  滑轨占横向空间，> 0 就是真的画了一根）、量**带小数的几何**（`rect` vs 由
  `lineHeight × 行数 + padding + border` 算出来的"需要"）。同一份探针里带一条
  `SHRINK=1`：把每格按修之前那个高度摆回去，用来证明**判据会红**（红 10/20）。
- `.out/probe-six.mjs`：检② 换成上面两条判据（删掉那 1px 容差）；
  A 段原来写死的那本草稿被别的会话清掉了，改成**自己找**（`u/1` 底下有 `story.json`
  而没有 `book.json` 的那一本）+ 期望值由那份 story.json 的 `via` 算出来。

## 读数（`.out/probe-autosize.mjs`，无头 Chrome 直连 CDP，不用登录）

```bash
node scripts/dev-preview.mjs --dist=.next-autosize --port=3351
```

```bash
node .out/probe-autosize.mjs http://127.0.0.1:3351 xiaoman-r1-638df001b4e9
```

|        | 两行那一格的 inline 高 | `rect` vs 内容需要的 67.3px | 滑轨              | 判定                           |
| ------ | ---------------------- | --------------------------- | ----------------- | ------------------------------ |
| 修之前 | `67px`                 | 67 < 67.3（短 **0.30px**）  | 0px（这一版引擎） | 10 / 20 格不合格               |
| 修之后 | `68px`                 | 68 ≥ 67.3（余量 0.7px）     | 0px               | 20 / 20 格，最紧的一格余 0.7px |

★ **没说成"我复现了那根滑轨"**：我这里（DPR 1 / 1.25 / 1.5 各量一遍）都没画出来。
量到的是它的**成因与边界**：差 1px 就有，而修之前正好差 0.3px。

## 没做的（写在这里，免得下次当成漏了）

- **「重配第 N 页」弹窗里那个 `<textarea>`（`.rvd__text`）没动**：它是 `rows={4}` +
  `min-height: 108px`，一页正文一般装得下，而且那是弹窗（长到装下会把底下的按钮顶下去）。
  同一个毛病要真在那儿犯，走的是同一把 `useAutosize`——先把这一屏收口。
- **没有把 `overflow-y` 改成 `hidden`**。那是"把滑轨藏起来"的写法：量短了的时候
  超出的字会被**切掉**，而家长是来改那段字的——藏起来比露出一根滑轨更坏。
  这条写死在探针的判据里（`overflowY === 'hidden'` 也算不合格）。
