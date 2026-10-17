# 06 · 接线：开始创作 / 看一本成品（Request 7 的 bug）

Status: done（2026-10-14：接线与收尾都做完并实测，见文末两条 Comments。
★ 2026-10-17 又改过一次落点，**§二第 2 条与 §四第 2 条已作废**，看文末最后一条 Comment）
依赖：无——**这一单应该最先做**，它是用户报的那个"点不动"
对应 Request 7：现在点击开始创作根本进入不到主页

## 一、根因（已定位，不是路由坏了）

[src/app/page.tsx:95-103](../../../src/app/page.tsx)：

```tsx
<div className="hero__cta">
  {/* TODO: 创作流程做出来后换成指向 /create 的 Link */}
  <button className="btn" type="button">
    开始创作 →
  </button>
  {/* TODO: 阅读器做出来后换成指向成品示例的 Link */}
  <button className="btn btn--ghost" type="button">
    看一本成品
  </button>
</div>
```

两条 TODO **都过期了**：创作流 `/create` 与阅读器 `/reader/[bookId]` 都已经建成
（W2 工单 04/06），但首页这两个按钮**从来没有链接**。点一个没有 handler 的
`<button>` 当然什么都不发生。用户看到的 `/create` 是手敲 URL 进去的。

另外**主页 `/home` 本身还不存在**（[05](05-home-dashboard.md)），所以
"进入不到主页"其实是两件事：一个死按钮（本单修）+ 一个没有的页面（05 建）。

## 二、改什么

1. `开始创作 →`：
   - 本单先指 `/create`（一分钟的事，让按钮先活过来）
   - [05](05-home-dashboard.md) 落地后**改指 `/home`**——用户的设计意图是
     "点开始创作 → 进主页"。改这一下也归本单收尾，不许忘了
2. `看一本成品` → `/reader/xiaoyu-r1-4fe055c5723b`（`public/demo/books/` 里那本真的存在）
3. 两条过期 TODO 注释**删掉**——TODO 的意义是"还欠着"，欠条还清了就撕掉，
   留着它下次的人会以为功能还没做

实现上用 next/link 的 `Link`（客户端路由），不是 `<a>` 整页刷新——
`/reader` 那套 rAF 驱动对整页刷新没有意见，但 SPA 导航便宜且没有闪烁。

## 三、顺手要面对的一条（不擅自改，列出来给用户拍板）

[page.tsx:53-59](../../../src/app/page.tsx) 的打字机第二句是
"得到一本**以他为主角、用你的声音朗读**的定制绘本"。
"用你的声音朗读"在 TTS 落地（[08](08-voice.md)）之前是**兑现不了的承诺**——
和 `demoBook.ts` 里那句 `BOOK_BYLINE` 是同一个问题（已单独向用户报过，未动）。

三个选项，本单**不替用户选**：

- A. 签 [08](08-voice.md) 尽快落地，这句话就活了（用户 Request 6 正是这个方向）
- B. 在那之前把"用你的声音朗读"改成能兑现的说法（比如"以他为主角的定制绘本"）
- C. 保持不动，接受首页有一句超前的话（★ 与项目美学冲突，列在这里是为了显式）

## 四、验收

- [x] 首页点"开始创作"真的进 `/create`（实测，见 Comments）
- [x] 首页点"看一本成品"真的进阅读器，演示书三页的图都对（实测，见 Comments）
- [x] 两条过期 TODO 已删（换成一条说明"为什么它是死的"，`src/app/page.tsx:95`）
- [x] 这两个 Link 不带动画，`prefers-reduced-motion` 下行为不变（无补间可验，属结构性成立）
- [x] [05](05-home-dashboard.md) 落地后："开始创作"指向 `/home`（本单收尾时补勾）
- [x] 四条闸门

## Comments

**2026-10-14 · 建单**

- 根因定位在 [spec §三](../spec.md) 有全文；本单是全部工单里最小的一张，
  排第一是因为用户现在就点不动。
- §三 那条是**既有的未决事项**（W2 时已单独报过 `BOOK_BYLINE`），不是本单引入的。

**2026-10-14 · 接线完成 + 实测**

改动：`src/app/page.tsx` 加 `import Link from 'next/link'`，两个 `<button>` 换成
`<Link href="/create">` 与 `<Link href="/reader/xiaoyu-r1-4fe055c5723b">`，
两条过期 TODO 换成一条说明"它为什么是死的"（留着的是**教训**，不是欠条）。

实测（dev server :3000，Chrome 面板）：

| 动作                   | 结果                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| 读 `.hero__cta` 的 DOM | 两个都是 `A`，`href` 分别是 `/create` 与 `/reader/xiaoyu-r1-4fe055c5723b`                           |
| 点"开始创作"           | `pathname: /create`，`title: 做一本自己的绘本 · 小主角`                                             |
| 点"看一本成品"         | `pathname: /reader/xiaoyu-r1-4fe055c5723b`，`title: 雨天的桥 · 小主角`                              |
| 阅读器渲染             | `leafCount: 3`，`.reader__cover` 的文字是"雨天的桥" + "用 → ← 或点右下角翻页"                       |
| 三页的图               | `.reader__art` 的 `background-image` 分别指向 `page-1/2/3-a1.png`，无 404                           |
| 资产真的在             | `GET /api/assets/books/xiaoyu-r1-4fe055c5723b/page-1-a1.png` → **200 · image/png · 3,399,199 字节** |
| 控制台                 | error 级 **0 条**                                                                                   |

★ **一次没能做到的事，如实记**：这次用的是 `element.click()`（脚本触发），
**不是真正的鼠标点击**——`preview_click` 报
`the press at (69, 366) could not be attributed to a frame`，
实测原因是 `innerWidth: 0 / innerHeight: 0`、`document.visibilityState: "hidden"`：
**预览面板当时不可见**（这条环境事实 W2 已记过一次）。
所以本次证明的是"**这两个 Link 接对了、能导航到正确的路由，且目标页真的渲染**"，
**没有**证明"鼠标点在按钮上会跳"——后者要等面板可见时再点一次才算数。
按纪律：**没测成的那一条不许记成测过了。**

`pnpm typecheck` 与 `pnpm lint` 都过（lint 的 2 条 `no-img-element` 警告是既有的，
属于 README §五「刻意未做」里 `next/image` 那一档）。

**2026-10-14 · 收尾：入口全部接完**

- 首页"开始创作"→ `/home`（工作台的「创作」那一屏，一句话进去）。
  创作流本身仍在 `/create`，直接访问照样能用。
- `/home` 那一屏的三个控件各自接了一条真实的线：
  胶囊 → `?card=`（第 3 步预置"就用这张"）、骰子与建议卡 → 输入框 + `?theme=`、
  ↑ → `/create?wish=…`。整条链的实测表在 [05](05-home-dashboard.md) 文末。
- ★ 一处措辞是这一轮改的：`src/app/page.tsx` 那条注释原来写"主页是'我做过什么'的地方"——
  仪表盘搬去 `/shelf` 之后这句话就不成立了，注释比代码更容易烂掉的地方就在这儿。
- 闸门：`format:check` / `lint`（0 error 0 warning）/ `typecheck` 全绿，`pnpm test` 254 通过。

**2026-10-17 · 用户口径变了三处（本单 §二第 2 条与 §四第 2 条就此作废）**

用户看着首屏与第二屏的截图给的落点，原话：「首页点击开始创作和换成你的孩子，
跳转到创作那页，点击看一本成品，跳转到灵感书单那一页」。三颗按钮现在的落点：

| 按钮                   | 位置                               | 落点                            | 本轮动作                           |
| ---------------------- | ---------------------------------- | ------------------------------- | ---------------------------------- |
| `开始创作 →`           | 首屏 `.hero__cta`（StartCreating） | `/home`（工作台「创作」那一屏） | 无——已经是这个落点，本轮复测确认   |
| `看一本成品`           | 首屏 `.hero__cta`                  | **`/booklist`（灵感书单）**     | 改：原指 `/reader/xiaoyu-r1-4fe0…` |
| `把主角换成你的孩子 →` | 第二屏 StorybookFlip 收尾          | **`/home`**                     | 改：原来是一颗**死** `<button>`    |

- ★ 第三行那条是一直欠着的：`StorybookFlip.tsx` 的 `{/* TODO: 创作流程做出来后换成
指向 /create 的 Link */}` 从写下那天起就没兑现过（与 §一 里首屏那两条是同一类欠条）。
  现在换成了 `<Link className="book-cta" href="/home">`，并给它补 `text-decoration: none`
  （这个仓库没有全局 `a` 重置，每条链接样式自己写），其余 `border: 0` / `color:#fff`
  对它正好也够用。
- 演示书 `xiaoyu-r1-4fe055c5723b` **没删也没改**，只是首页那颗不再带路——它现在只剩
  `/shelf` 空态那一个入口（`ShelfDashboard.tsx` 里那条注释同轮改了）。书单那 12 本
  各自能整本翻，比只给一本更能回答"做出来长什么样"。

实测（隔离 dev server `:3311` + `.next-session`，1440×900，本轮）：

| 判据                                          | 结果                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 首屏两颗的 DOM                                | 都是 `A`，`href` 分别 `/home` 与 `/booklist`；`__reactProps$` 上 `onClick` 在                           |
| `.book-cta` 的 DOM                            | `A`（不再是 `BUTTON`），`href="/home"`，文字仍「把主角换成你的孩子 →」                                  |
| `.book-cta` 的样式                            | `color: rgb(255,255,255)` / `background: rgb(26,26,32)` / `text-decoration-line: none` / `height: 52px` |
| `.storybook__end` 揭示前后的 `pointer-events` | `none` → `auto`（`.storybook__end[data-on]` 那条，未改）                                                |
| 点「开始创作」                                | `pathname /home`、`title 创作 · 小主角`、`.cl__go` 在（`data-leaving` 也真的置上了）                    |
| 点「看一本成品」                              | `pathname /booklist`、`title 灵感书单 · 小主角`、`.blw__card` **12** 张                                 |
| 点「把主角换成你的孩子」                      | `pathname /home`、`title 创作 · 小主角`、`.cl__go` 在                                                   |
| 控制台                                        | 只有 `/api/auth/me` 的 401（未登录，既有），无别的 error                                                |

★ **两条没做到的，如实记**：

1. 点下去用的都是 `element.click()`，**不是真鼠标命中**。原因是**预览面板当前不可见**
   （`preview_show_pane` 报 "This session isn't open in any window"）：`innerWidth` 起手是 0，
   `preview_click` 声称成功但 `preview_network` 里没有任何 `/booklist` 请求——
   与 `06` 上一轮同一个环境事实。
2. **第二屏那颗没能"翻到最后一页"再点**：面板不可见时 **rAF 是冻结的**，
   滚动驱动不推进，`.storybook__end` 永远拿不到 `data-on`（pager 一直读「封面」）。
   所以那一行的证据是"手动补 `data-on` 看 `pointer-events` 变 `auto`" + "`element.click()` 能进 `/home`"，
   **不是**"滚到底、露出按钮、拿鼠标点它"。这一条留给面板可见时补。

`pnpm lint` / `pnpm typecheck` 全绿；`pnpm format:check` 只红在 `scripts/make-default-avatar.mts`
与 `scripts/sheet-only.mts` 两个**未跟踪**的文件上（不是本轮碰的），本轮改的四个文件都过。
