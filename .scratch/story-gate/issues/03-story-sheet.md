# 03 · 闸门那一屏（`StorySheet` + 运行视图多一个相）

Status: done（2026-10-17）
依赖：[02](02-story-draft-and-api.md)
对应 [spec.md](spec.md) §二

## 改了什么

- `src/components/creation/StorySheet.tsx` + `story-sheet.css`（新）：书名、重写那一块、
  每页三个框（正文 / 画面 / 情节），问题就地标 + 汇总在最上面（带锚点）。
- `src/components/creation/GenerationRun.tsx`：`Phase` 多一格 `'story'`；
  自动保存（静默 1.2s）；`bookId` 多一个 ref（见下）；渲染按 `atGate` 分岔
  （闸门那一屏**不渲染画桌**）。
- `src/components/creation/frames.ts`：`storyDeskOf`——一份故事草稿 → "书名 + 页数、
  没有格子"的画桌，好让上面那条阶段轨**不必**多开一条分支。
- `src/app/create/page.tsx`：多一个入口分支（有 `story.json` 没 `book.json` → 闸门那一屏）。
- `src/lib/creation/state.ts`：`RunOptions.form`（形态）。`api.ts`：
  `fetchStory` / `saveStory` / `rewriteStory` / `illustrateBook`，并把四条流式请求里
  重复了四遍的"fetch → 查状态码 → 解码器读帧"抽成一个 `postStream`。

## 三处不显然的

1. **`bookId` 要一个 ref**。收尾帧把书号给到客户端，而读它的代码在**同一轮渲染**里
   （`setState` 是异步的）——读 state 会读到 `null`，症状是"编完故事却说没有书号"。
   与 `eventsRef` 同一条理由：它们是"这一轮里当场发生的事"，不是渲染的输入。
2. **①和②的流不能用同一个帧处理器**。①的收尾帧是 `{running: false, bookReady: false}`
   ——那是它的**正常终态**（书还没开始画），而共用的那个处理器会把它读成 `'failed'`。
   ②那条路只吃 `engine` 帧，下一步由 `illustrate()` 自己说。
3. **`RunOptions.form` 是闸门逼出来的**：闸门那一屏要自己校验故事（`buildTree` 要形态），
   而"独读版不许有选择点"这条判据在共读版上是**反的**。在客户端写死 `'solo'`
   会有一天把共读版的每一页都报成错。

## Comments

- 2026-10-17 自动保存与重写的关系要掐一下：手改排着队的那一笔，会在重写写盘**之后**
  落地，把旧文字盖回新故事上。做法是把 `working` 放进那个 effect 的依赖——
  重写一开始 cleanup 就把计时器清掉。
- 2026-10-17 重写那颗按钮旁边那句「重写会盖掉你手改的地方」**只在手改过时**出现
  （`dirty`）。一句常驻的警告读起来像"这个功能有危险"，而那不是事实；不弹确认框
  与书架删除那一次同一条（用户的原话是"就一个确认是否删除，还是算了"）。
- 2026-10-17 **端到端实测抓出两个 bug，都改了**（两个都只在"接着改一份停在闸门上的草稿"
  这条路上，而且都**只在真跑时**看得见——单元测试与"这一屏不报错"都测不出来）：

  **① 「就按这个画」之后阶段轨退回"还没轮到"、格数塌成 1。**
  症状（CDP 读到的）：`编故事 还没轮到 ｜ 逐页画 0 / 1`，大标题退回"开始创作中"。
  根因：`resume.story` 那一支**不重放日志**（理由是"这一屏的事实来源是 `story.json`"——
  这句话对**正文**成立），可 `eventsRef` 因此从空的开始；点画之后第一帧一到
  （`stage(begin, illustrating)`，带 `pageNo: 1`），`deskOf` 手上只有这一条，
  `total` 就按 `pageNo` 兜到 1、`title` 是 `null`。
  **①的书名与格数只在 `plan-ready` 那一条事件里**，而它只存在日志里。
  改法：那一支**仍然**尽力 `replayFrames`，但**只填 `eventsRef`、不动 `desk`**
  （闸门那一屏的桌子照旧由 `storyDeskOf` 造——日志晚几百毫秒到，桌子不能在那期间换来换去）；
  并且**只在"这一屏还没往下走"时**认这份日志（`eventsRef.current.length === 0`），
  否则点得快时会用重放回来的一份把已经到的新帧冲掉。

  **② 家长改过的书名，屏幕上一直到装订完都顶不上去。**
  `desk.title` 只有一个来源——日志里那条 `plan-ready`（`book-ready` **不带书名**，
  实测字段就是 `{bookId, path, stats}`）。而书名在闸门上**是能改的**，改完点画，
  ②每回一帧都把桌面折回①那一版书名：屏幕上写着 《云上蚂蚁家》，而 `book.json`
  的 `tree.title` 里是《云上蚂蚁家·改过的书名》——**界面与产物说的是两个名字**。
  改法：`frames.ts` 新增纯函数 `withStoryTitle(desk, story)`（相等时原样返回同一个对象，
  它在 `useMemo` 里），只在这一屏手上还有 `story` 时覆；大标题、阶段轨、`Desk` 与那两条
  致命错误**必须一起看这一份**，一个读 `desk` 一个读覆过的就会出现"标题对、轨道错"。

- 2026-10-17 上面两条各配了判据（`frames.test.ts` 新增 8 条，共 44 条）：
  `storyDeskOf` 喂给 `railOf` 之后①是 `done`、②是 `0 / 3`（一条事件都不需要）；
  `withStoryTitle` 只换书名、`frames` 与 `total` 一个都不动；`story` 为 null 时**同一个对象**。
- 2026-10-17 **量的过程本身也被绊了两下**（都不是代码的问题，记下来省下一次重踩）：
  1. 预览面板当时是收起的，`preview_click` 直接**拒绝**（"no visible part to click"）——
     与 `preview_resize` 那条纪律同一件事：面板窄/收起时先给一个具体宽高，
     否则量到的是另一套布局（这里连"有没有可见部分"都会判错）。
  2. 这一格工作区**另一个会话常驻**，它一存盘 HMR 就整页重载。于是**点击会落在 hydrate 之前**
     （第一下点完什么都没发生，网络面板里连 `POST /illustrate` 都没有）。判据因此选了
     "网络面板里有没有那个请求"，并在**同一轮 JS 里**先查 `__reactProps$` 再 `.click()`。
     最终那一跑：`sheet` 消失、轨道 `done now(0 / 3) skipped todo`、
     大标题仍是改过的那个名字、`0 / 3` **没有**塌成 `0 / 1`。
- 2026-10-17 ② 跑完之后在**产物**上再确认一次书名那一条：`book.json` 的 `tree.title`
  是《云上蚂蚁家·改过的书名》（就是这个改过的），`tree.nodes[0].body[0]` 是那句带 ★ 的
  改过的正文，三页的 body / scene / imagePrompt 与 `story.json` 逐字段相等。
  ★ 这一条是"改过的书名真的成为这一本的名字"的**唯一**硬证据：只看界面的话，
  两个 bug（书名没跟上、轨道塌了）都长得像"功能正常"。
