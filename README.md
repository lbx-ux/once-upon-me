# 小主角 · Once Upon Me

> 说出孩子的名字和爱好，得到一本**以他为主角**、用**你的声音**朗读、可以反复探索的定制绘本。

参赛作品：**2026 第九届传智杯 · AI WEB 网页开发挑战赛** | 赛道主题「智启未来：AI 驱动的 Web 应用创新挑战」｜选题方向：**多模态 AI 创意平台**

**在线演示**：[http://123.56.148.105](http://123.56.148.105) ｜ 演示账号 **`123456`** / 口令 **`123456`**（6 位短账号，在登录页切到「密码登录」那一档再填）

> 演示站跑在 **IP + HTTP** 上（域名备案要 1–3 周，赶不上提交），所以**口令在公网是明文传输的**。
> 请只当演示环境用，不要在上面填任何真实手机号或密码；库里的内容是演示数据，随时可能被清空重建。
> 想在自己机器上跑，见 [§三 安装运行指南](#三安装运行指南)。

---

## 一、项目介绍

### 一句话定义

以自己孩子为主角、用父母的声音朗读、可以反复探索的定制绘本。

### 项目截图

四张按**用户真走一遍的顺序**排：先在首页认识它，然后在工作台说一句话，最后看它长出来的那两本书。

**① 首页首屏** —— 12 张绘本封面绕成一个 3D 环，正中是那一句「开始创作」，底下一句「看一本成品」通向灵感书单。
首页三节：这一屏 + 第二屏那本一页页翻开的《小宇的云》+ 五条项目亮点。
（★ **手机上是两节**：首屏只剩正中那一摞文案，第二屏不出现 —— 用户 2026-10-19 的口径「只删移动那一档，
web 端首页和以前一样」，见 `.scratch/home-revision/issues/08`。）

![首页首屏：一屏正中那句「开始创作」](docs/screenshots/01-home-hero.png)

**② 工作台 · 创作输入** —— 一本书的全部输入就是这三样：一句话、一张角色卡、一档声音。「今天想讲一个什么样的故事？」

![工作台：一句话 + 角色卡 + 声音，就是这本书的全部输入](docs/screenshots/02-studio-create.png)

**③ 独读版阅读器**（睡前那一档）—— 一屏一图一句，翻页即读。**刻意不给孩子做选择的机会**：越选越兴奋，睡不着。

![独读版阅读器：一屏一图一句](docs/screenshots/03-reader-solo.png)

**④ 共读版 · 选择点**（白天陪玩那一档）—— 故事在岔口停下、画面留在大图上，两个大按钮各带**图标 + 朗读**双通道（孩子不识字）；选完接着走，两条支各自收尾。这一屏之后**一次生成都不发生**——书是预生成的，阅读顺序就是你选的那条路。

![共读版：恰好一个选择点，两个大按钮，图标 + 朗读](docs/screenshots/04-reader-shared-choice.png)

### 解决什么问题

市面上的个性化童书能换掉书里的**名字**，换不掉**形象和声音**；而免费 DIY 工具链（豆包 + 即梦 + 剪映）要家长自己动手 4–8 小时。我们做的是一个**个性化内容引擎**：给它一段故事，它把孩子变成主角，用父母的声音讲出来，并且保证每一页都是同一个孩子。

### 一个引擎，两种形态

同一本故事，对应两个真实场景——**场景决定形态**：

| 形态                             | 场景     | 交互                                                                                                                                                                    |
| -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **独读版**（线性，约 20 页）     | 睡前     | 全屏翻页，一屏一图一句，父母声音朗读。**不给孩子做选择的机会**——越选越兴奋，睡不着                                                                                      |
| **共读版**（一棵树，一个选择点） | 白天陪玩 | 读到选择点画面停下，出现两个大按钮；孩子不识字，所以选项走**「大图标 + 语音朗读」双通道**；选择点插入引导性提问，把「看故事」变成**「聊故事」**；两条支各自收出一个结尾 |

判据：**去掉互动，绘本仍成立；去掉绘本，互动不成立。** 这说明它们是同一个东西的两种形态，而不是两个产品——这是「平台」而非「聚合」的证据。

★ 共读版的形状是**恰好一个选择点**（不是产品定义那一版设想的"多几层分支"——
落地时收窄成一档，理由是钱：两条支不能汇合，每加一层要多付一整条尾巴，
那笔账在 [GLOSSARY](GLOSSARY.md) 的「共读版」条里，完整推导见 [docs/known-tradeoffs.md](docs/known-tradeoffs.md) 的「共读版：一棵树、恰好一个选择点」一节）。
形态由**引擎的一个入参**决定（`form`），不是两套结构、也不是两个入口函数。

### 社会价值

**留守儿童场景**：在外打工的父母录 30 秒声音，孩子在家听爸妈读一本自己当主角的绘本。声音可以跨越距离。

一本 20 页的 API 成本实测 **¥5.8–11.6**（量法 `node scripts/cost-model.mts`），
也就是"一个家庭负担得起"这件事有数了：**成本、定价与竞品对照在 [docs/business.md](docs/business.md)**。
★ 但要说清：那条留守儿童的路**没有做过任何一家访谈**，它是基于产品能力的推断，不是调研结论。

### 当前进度

| 阶段                              | 日期        | 状态                                                                                                                                                                                                                                                           |
| --------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 启动 · 选型与定义                 | 10/11–10/13 | 已完成（组队 / 报名 / 缴费见 [`docs/launch-checklist.md`](docs/launch-checklist.md)，技术选型见 [`docs/tech-selection.md`](docs/tech-selection.md)）                                                                                                           |
| **W1 · 角色一致性验证（生死线）** | 10/14–10/20 | **已完成**——图像判据 1 已 go（10/13，≥3 人盲读）；文本判据出结论；语音横评也已补做                                                                                                                                                                             |
| W2 · 独读版全链路                 | 10/21–10/27 | **已完成**：一句话 → 故事闸门 → 出图配音 → 书架 → 阅读器，一条路走通                                                                                                                                                                                           |
| W3 · 共读版                       | 10/28–11/03 | **已完成**：一棵树、恰好一个选择点、两支各自收尾；阅读顺序 = 那条路                                                                                                                                                                                            |
| W4 · 声音克隆 + 三个校验 Agent    | 11/04–11/10 | 声音克隆**已完成**（两个默认音色 + 上传父母声音，见 [`src/app/api/voice/clone`](src/app/api/voice/clone/route.ts)）；**一致性已落地**（`illustrate.ts` 逐页比对 + 重画闭环）、**内容审核已落地**（2026-10-19，`engine/review.ts`，两道闸）、**连贯那一个未做** |
| W5 · 打磨与材料                   | 11/11–11/17 | 进行中——本文件与下面那四张截图就属于这一档                                                                                                                                                                                                                     |
| **省赛作品提交截止**              | **11/18**   | —                                                                                                                                                                                                                                                              |

**已经能用的**：首页三节（12 张封面的环形轨道 / 一页页翻开的示例绘本 / 五条项目亮点；手机上两节）、**灵感书单那 12 本样书**、
工作台（主题墙 / 角色卡 / 一句话创作 / 生成过程 / 故事闸门）、**独读版与共读版两台阅读器**、
**配音（TTS）与声音克隆**、书架与作品归属、管理页（站长换模型 / 接口地址 / api-key，**改完不重启**）；
**内容审核与检索（RAG）**（2026-10-19）：故事先过一道内容红线（词表档，命中即拦、
原因具体到条款 id），再在**动笔之前**取几段以前写过的文本进提示词——两段都落在
`src/lib/` 的纯函数里（`engine/review.ts`、`rag/`），量具是 `scripts/review-cases.mts` 与
`scripts/rag-bakeoff.mts`；
**同一道闸有三处落点、审的是三种不同的东西**（2026-10-19 补齐后两处）：
① **家长那句自由输入**（`/create` 的第一句、"希望孩子得到什么"、"重写一版"的要求）
在 `planStory` **最前面**过同一份词表——它比第一句提示词早，也比检索那次 embedding 早，
所以拦下来时**一次模型调用都没发出去**（脚本量的就是这个 0）；
② **模型写出来的字**（正文 / `scene` / `imagePrompt` / 选择点那两句 / 书名），
在 `plan-ready` 之前与第一次出图之前各一道；
③ **画出来的图**：`imagePrompt` 是审过的，但**模型自己往图里加的东西**没有——
出图之后另问视觉模型一遍（`providers/openai-vision.ts` 的 `reviewPicture`）。
★ 第三处与前两处**身份不同**：前两处是**判据**（词表，可枚举、可复核，读数天天一样，
9/10 拦下 / 0 误拦），第三处是**兜底**——一张栅格图里没有一个字可扫，问视觉模型是这条路上
**唯一有仪器**，而它的读数不可复现。所以它不参与上面那两个数，
唯一的读数是 `scripts/picture-review-cases.mts` 量出来的**误报率**：拿盘上**真出过的
87 张图**跑，**0 张误报**（这是第二次读数；第一次是 **32 张 = 36.8%**，成因是那六条条款
原文是写给"字"的、不是写给"图"的——推导见 `docs/known-tradeoffs.md` 与
[`.scratch/safety/issues/01`](.scratch/safety/issues/01-picture-review.md)）。
★ 但**正例那一栏就是它自己的反例**：三张合成示意图都报了，其中一张还**报错了条款**
（把举起的棍子读成"绳套与横梁"，判成自伤 R-04，而画的是 R-02 的暴力）；
而那张**真插画**（两个男孩抢玩具、一个把另一个推倒）**第一轮没报、第二轮报了 R-02**——
**同一份输入、同一个提示词，读数翻边**（`temperature: 0` 不是确定性）。
所以这一档能给的最强说法是「**抓得住显式的，抓不住柔化的**」，不是"覆盖"；
两边也都有 N 次读数撑着（量具里的 `--repeat=N` 就是为这件事加的）：
显式那两张正例 **3/3 满票**、柔化那张真插画 **3 次里只报 1 次**；
而同一轮把**最难的反例**（第一版误报过的那 32 张）各跑 3 次，翻出 **2 次误报**
（2/95 次调用，**都是 R-06 的边界画面、都是 3 里报 1**）。
★ 所以读法是：**翻边长在判据自己的模糊带上，不是均匀噪声**——
这也正是处置写成"图留着 + 人工复核"、而不是删图的原因（误报不销毁任何东西）。
★ **不许**在任何地方（含答辩）说我们的内容过滤"覆盖了红线"：谐音 / 拼音 / 委婉说法 /
没有脏字的吓人都是词表的盲区，图上那一档的读数也只是一个量级（按次 ~2% 量级，
且随抽样方式晃）；
以及 `src/lib/engine/` 这一层——引擎、供应商适配层、自写 Schema 校验、带版本号的分阶段提示词。
它的验收方式是 `node scripts/engine-run.mts --mode=stub`：**不启动浏览器、不联网、不花钱跑完一本书**。

**手机那一档（2026-10-19，2026-10-20 改版）**：十三条路由 × 五个手机视口都不横向溢出；
**看绘本时竖屏弹一层"把手机横过来"（可关掉）**，横过来书按屏幕高铺开
（844×390 下 **576×388，占视口高 98.5%**，竖屏同一判据只有 29%），**手指跟手翻页**；
横屏时**底栏拆进左右两条页边**（翻页钮落在两只拇指下面），页边各 131px、一个像素不压书；
浏览器那条地址栏网页碰不到，能给的是**一颗全屏钮**（Android 有效，iOS 上不出现）；
工作台侧栏在窄屏收成底部标签栏；书架那一屏原先挤成一团（书名条被切掉、角标竖成三行），
现在书大一号、角标整枚换行。**首页在手机上是两节**（不是把桌面那三节缩进去）：
首屏只剩正中那一摞文案（环整块不演、也不白下那 12 张 2.8 MB 的封面），第二屏那本书整节不出现，
亮点那五条换成竖排五张全宽卡；主张句折行不再被切。
**桌面那一版一个像素没动**（1440×900 上 `.hero-experience` 1512 / 书 810×540 /
`.book__text` 300×182 / `.hl__card` 518×571 / `.hl__viewport` 1425×643，逐项与第二轮记下的基线相等）。
量法是 `node scripts/chk-mobile.mjs URL`（76 条：手机上还量"那 12 张封面一张都没取"，
桌面上反向量"三节都在、12 张照常取全"，横屏量"书高 ≥ 95% 视口 ＋ 控件一个都不压书"
（**844×390 与 640×360 两档、两台阅读器各一次**））。
★ 平台约束：iOS 既不支持 `screen.orientation.lock()`、`requestFullscreen()` 也只对 `<video>` 生效，
所以**做不成"锁死横屏"**，而那颗全屏钮在 iOS 上**根本不出现**（能力探测失败就返回空）——
细节与实际读数在 [`docs/known-tradeoffs.md`](docs/known-tradeoffs.md) 的「手机横屏阅读」那一节。

**页面级性能读数（2026-10-20）**：在这之前仓库里的性能数字**全是资产级的**
（缩略档 35.8×、首屏少拉 305.9 KB、每帧写入 18.6 次），**一条页面级指标都没有**——
而评分表那一栏的原话是「首屏加载速度、渲染性能」。现在有了：
`node scripts/chk-perf.mjs URL` 对着**生产构建**（`NEXT_DIST_DIR=.next-perf pnpm build`
之后一个 `next start`，不是 dev——dev 是现场编译的，在它上面量出来的 LCP 说的不是上线后那件事），
三个视口 × 三条路由共九格，每格连跑 3 次取中位、每格先清一次缓存；
**报的是 CPU ×4 那一档**（这台机器 24 核，不节流那档的 TBT 必然是 0.0——
一个说得通但什么也没说的数），分档用的是 Web Vitals 那套公认值
（LCP 2.5 / 4.0 s、CLS 0.1 / 0.25、TBT 200 / 600 ms），不是自己拍的。

**九格全部落在「好」这一档**（×4、中位数）：桌面 1440×900 首页 LCP **488 ms** / FCP 380 /
TTFB 10 / CLS **0.000** / TBT **92.0 ms**（1 个长任务）/ 传 1631 KB / 那 12 张封面照常取全，
LCP 元素是 `IMG`；`/booklist` LCP 612 ms、`/login` 524 ms。平板 768×1024 首页 LCP 396 ms /
TBT **115.0 ms**（3 个长任务，九格里最高的一格）。手机 390×844 `/booklist` 272 ms、
`/login` 224 ms。**CLS 九格全是 0.000**——最容易出事的那一屏（首页 12 张封面从 0 撑开）
一个像素都没跳，所以 `next/image` 那条最常见的理由（防位移）在这里**没有需求**。
★ 但要说清这一支量的是哪一半：**本机 localhost 上的绝对秒数不是用户侧的秒数**
（没有网络延迟、没有真实设备），它量的是**我们自己这段代码**。
★ 而且**同一份构建隔 40 分钟复跑，整片低约三成**（首页 488 → 328 ms，四条判据照过），
所以上面那几个秒数读作**上界**；稳的是「都远低于 2.5 s」与「CLS 一直是 0」这两句话。

★ **手机首页是九格里唯一量不出 LCP 的一格，而那不是"很差"，是"没有候选"**：
390×844 下那一屏只剩正中一摞文案（环整块不演、12 张封面一张不取），
而它们是带 `hero-rise` 入场动画进来的（`opacity: 0` 起步的合成动画不产生新的内容绘制），
于是 LCP 一个候选都没有。这一条**自己有证伪点**：同一格换到
`prefers-reduced-motion: reduce`（动画的静止终态）再量，LCP 284 ms、元素是 `P`；
而同一个脚本在 390×844 的 `/booklist` / `/login` 上、在 1440 与 768 的首页上都量得出候选，
所以不是探针坏了。报告里那一格写「**无候选**」，不写 `NaN`、也不写"差"。

**构建那一半**（`NEXT_DIST_DIR=.next-perf NEXT_BUILD_CPUS=4 pnpm build`）：
首页 31.1 kB / **First Load JS 168 kB**（共享的 102 kB 里 54.2 kB + 46 kB 是两块主 chunk）、
`/booklist` 106 kB、`/login` 108 kB、`/shelf` 112 kB、`/reader/[bookId]` 114 kB、
`/create` 125 kB、`/home` 151 kB。**六条页面路由全是 `ƒ`（按需服务端渲染）**，
一条预渲染的静态页都没有——首页的 TTFB 因此含一次 SSR，这是它的形状。
★ 九格里传输量最大的一格**不是首页而是 `/login`**：右栏那支 `picnic-loop.mp4`
（`autoplay muted loop`）一个人就 2.1 MB，还是那一格 LCP 元素的来源。
这一档以后加页面 / 加封面可以直接重跑，判据与手法（含"节流到底生没生效"要**直接量尺子**、
不许拿页面指标去证）写在 [`docs/known-tradeoffs.md`](docs/known-tradeoffs.md)
的「页面级性能读数」那一节。

**还没有的**：**连贯校验**（原「三个校验 Agent」里剩下的那一个——一致性与内容审核都已落地，
见上面）；域名与 HTTPS（现在只有 IP + HTTP，见开头「在线演示」那条）；
深色模式（只做了浅色一档；`prefers-reduced-motion` 下的**静止终态**是每一处都有的）。

关于技术选型的口径：框架与工程链已拍板（[`docs/tech-selection.md`](docs/tech-selection.md) §2–§6），
而图像 / 语音 / 大模型三家**不由我们替用户选死**——产品形态是**用户自己输入模型 + 自己提供 API key**
（[ADR-0008](docs/adr/0008-model-and-key-provided-by-user.md)），
W1 横评交出的是**默认推荐值与兼容性证据**（哪些模型验过、各自会怎么坏），不是产品边界。

> 数字都带出处：图像与文本的实测结论在 [`docs/tech-selection.md`](docs/tech-selection.md) §7 / §9，
> 每条都写明是用哪个脚本、哪次运行量出来的。

---

## 二、技术架构

### 技术选型

| 层     | 选型                                                           | 理由                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 框架   | **Next.js 15** + React 19                                      | App Router + Server Components + 流式渲染，能用全栈能力简化后端逻辑，不必另起一个 Node 服务                                                                                                                                                                                                                                                                                                                               |
| 语言   | **TypeScript**（`strict: true`）                               | strict 模式。引擎层要能在 node 里不启动浏览器就跑通整本生成，没类型就没法验证                                                                                                                                                                                                                                                                                                                                             |
| 样式   | **Tailwind CSS v4**                                            | v4 的 `@theme` 让设计令牌同时是 CSS 变量和工具类，一处定义两处可用                                                                                                                                                                                                                                                                                                                                                        |
| 包管理 | **pnpm**                                                       | 安装脚本白名单能精确到单个依赖，本地与 CI 行为一致                                                                                                                                                                                                                                                                                                                                                                        |
| 规范   | ESLint（`next/core-web-vitals` + `next/typescript`）+ Prettier | 三条闸门（format:check / lint / typecheck）进提交前必过，见 docs/commit-convention.md                                                                                                                                                                                                                                                                                                                                     |
| 动效   | **GSAP 3.15**（亮点那一屏 + 工作台的进场）                     | 亮点那张"被一角托起的纸"要每帧跟随指针，`quickTo` 的补间与自定义属性写入比自己写 rAF 稳。工作台只用来跑**挂载时那两条**进场时间线（`lib/useEnterTimeline.ts` 与 `AppShell` 里侧栏那一条，**只 `from()`，终态归 CSS**）。前两节（环与那本书）的滚动驱动是 `useScrollDriver`，第三屏那 5 张卡片的指针跟随用 GSAP，`SceneBackdrop` 换幕用 `useScrollTick`（边界与理由见 [docs/known-tradeoffs.md](docs/known-tradeoffs.md)） |
| 测试   | **Vitest**（`environment: 'node'`）                            | 只测纯函数（轮播索引、指针→倾斜映射、共用数学）。不引 jsdom / Playwright——GSAP 是否真写了 transform 是浏览器事实，用 preview 实测，不用 jsdom 测库的内部行为                                                                                                                                                                                                                                                              |

> **技术选型的定稿在 [`docs/tech-selection.md`](docs/tech-selection.md)**，本表是它的摘要。
> 框架与工程链已拍板（§2–§6）。图像 / 语音 / 大模型三家**不由我们替用户选死**：
> 产品形态是**用户自己输入模型 + 自己提供 API key**
> （[ADR-0008](docs/adr/0008-model-and-key-provided-by-user.md)），
> W1 横评给出的是**默认推荐值与兼容性证据**——哪些模型验过、各自会怎么坏。
> 引擎侧只认三个环境变量（`LLM_MODEL` / `IMAGE_MODEL` / `VISION_MODEL`）与
> `*_BASE_URL` / `*_API_KEY`，而 `registry.ts` 的 `Env` 是**参数**不是 `process.env`，
> 所以"用户自带的模型与密钥"不需要改一行引擎代码。

### 目录结构

```
once-upon-me/
├─ CLAUDE.md                     在这里怎么干活（不复述本文件）
├─ GLOSSARY.md                   本项目的词：形态 / 角色卡 / 一致性分 / 预生成 …
├─ .scratch/<feature>/           一个特性的 spec 与工单（本地 issue tracker）
├─ docs/
│  ├─ tech-selection.md          ★ 技术选型定稿（§二 那张表的全文与依据）
│  ├─ business.md                ★ 一本多少钱、卖多少、卖给谁（实测成本 + 定价 + 竞品对照）
│  ├─ launch-checklist.md        启动期：组队 / 报名 / 缴费 / 提交物红线
│  ├─ adr/                       关键决策：0001 框架 … 0011 检索的索引就是一个文件（不引向量库）
│  ├─ cover-art-prompts.md       12 张封面的出图提示词（AI 生成记录）
│  ├─ demo-book-art-prompts.md   演示绘本 8 张的出图提示词 + 交付与废弃批次记录
│  ├─ demo-narration-script.md   配音稿与时长预算（★ 那 5 段朗读挂在首页第二屏那本书上，
│  │                              音频在 public/book/，验收脚本 scripts/chk-book-narration.mjs）
│  ├─ booklist/                  ★ 灵感书单那 12 本样书：README.md 是总纲，每本一篇 <key>.md
│  ├─ highlights-art-prompts.md  亮点那 5 张卡片的出图提示词 + 验收记录（图已落盘）
│  ├─ brand-mark-prompt.md       品牌标记的提示词与裁切依据
│  ├─ commit-convention.md       提交规范（消息格式 / 粒度 / 禁区）
│  └─ agents/                    工程技能的配置：issue-tracker.md、domain.md
├─ public/
│  ├─ art/                       12 张绘本封面（1280×720 WebP，合计 1.16 MB）
│  │                             ＋登录页右栏那一段：`picnic-loop.mp4`（768×768、10.1s，
│  │                             **1.94 MB —— 全仓最重的一个文件**）与它的静止帧
│  │                             `picnic-loop.webp`（960×960、82 KB）
│  ├─ art-cards/                 上面那 12 张派生的 320×180 小图（工作台主题墙用，合计 0.13 MB）
│  ├─ book/                      演示绘本的 1 封面 + 5 跨页 + 2 枚选择点图标（WebP，合计 0.46 MB）
│  ├─ booklist/{key}/            ★ 灵感书单那 12 本样书：一本一个目录，9 张图 + 8 段音频
│  │                             （**分批到达**：还没出图时目录不存在，界面据实显示"画还没到位"）
│  ├─ highlights/                亮点那 5 张卡片插画（1280×720 WebP，合计 0.51 MB）
│  ├─ reader-papers/             两台阅读器那层底图：6 张 3:2 + 6 张缩略图
│  │                             （WebP，合计 1.23 MB，★ 引擎自己出的图）
│  ├─ scenes/                    三幕背景场景图（1365×768 WebP，合计 103.5 KB）
│  └─ brand/
│     └─ mark.webp               首屏品牌标记（560×560，23.8 KB）
├─ mcp/
│  ├─ server.mts                 ★ MCP server（stdio）——**薄壳**：读命令行、拼上下文、把 stdin 的行喂给 dispatch
│  └─ README.md                  两种客户端的注册写法 + 一次真会话的复现步骤 + 「它是本机操作员的工具」
├─ scripts/
│  ├─ make-webp.py               源图 → WebP，五档预设（hero / book-spread / book-cover / book-icon / theme-card）
│  ├─ mcp-session.mts            ★ 起一个真的 MCP 会话跑 14 条判据（含与 engine-run 的等价对照）
│  ├─ probe-tool-calls.mts       ★ 探针：这条网关上 tools / tool_choice 到底能不能用（八格）
│  ├─ make-favicon.py            品牌标记 → src/app/icon.ico 的 favicon 脚本
│  ├─ check-scrim.mts            ★ 工作台那层纸光够不够厚：读 CSS、按 WCAG 出十带表
│  ├─ make-reader-paper.mts      阅读器那六张底图：调引擎出图 → 对照表 → 落 public/
│  └─ sample-tints.py            跨页图 → 三朵主色，生成 book/spreadTints.ts（染色层用）
├─ vitest.config.mts             只跑 src 下的 .test.ts，environment: 'node'
└─ src/
   ├─ app/                       App Router
   │  ├─ icon.ico                favicon（16/32/48 三帧，Next 自动挂载）
   │  ├─ globals.css             ★ 设计令牌唯一来源 + Tailwind 配置 + 页面层样式
   │  ├─ layout.tsx              根布局（zh-CN、metadata）
   │  ├─ error.tsx               ★ 根错误边界（渲染期抛错 → 一张纸 + 重试，`digest` 照原样给出来）
   │  ├─ loading.tsx             页面这一级的加载态（**晚 120ms 才显形**，快导航因此一格都不闪）
   │  ├─ not-found.tsx           404（未匹配的路由 + 任何 `notFound()`；状态码是真的 404）
   │  ├─ (studio)/loading.tsx    ★ 工作台**组内**那一档：边界在 `(studio)/layout` 里面，只换内容区
   │  └─ page.tsx                首页：三幕场景背景 + 12 张封面的环形轨道 + 示例绘本 + 五条项目亮点
   ├─ components/
   │  ├─ BackToTop.tsx            右下角"回到页首"（滚过 0.6 视口才出现，客户端组件）
   │  ├─ back-to-top.css          组件样式
   │  ├─ system/
   │  │  ├─ SystemNotice.tsx      ★ 三个「系统页」共用的那张纸（错误 / 正在打开 / 404 各一档）
   │  │  └─ system-notice.css     组件样式（★ 延迟显形那 120ms 与 AppShell 同一条规矩）
   │  ├─ shell/
   │  │  ├─ AppShell.tsx          工作台外壳：侧栏 + 内容区，四屏共用
   │  │  ├─ app-shell.css         组件样式（侧栏那层纸、当前项那张抽出来的卡、焦点环）
   │  │  ├─ StudioBackdrop.tsx    工作台背景：与首页第一幕同一片天（★ 两层）
   │  │  └─ studio-backdrop.css   组件样式（★ 十带对比度表与 governing rule 在它文件头）
   │  ├─ hero/
   │  │  ├─ HeroOrbit.tsx        ★ 首屏：12 张封面的 3D 环形轨道 + 中心那一摞文案（客户端组件）
   │  │  ├─ hero-orbit.css       组件样式（全局引入，见下；含 `.btn` 那两颗按钮）
   │  │  ├─ HeroTypewriter.tsx   一行轮流打两句主张（客户端组件）
   │  │  ├─ hero-typewriter.css  撑宽度的占位 + 实时文字 + 光标（≤640 折行，见文件头）
   │  │  └─ StartCreating.tsx    ★「开始创作」那一颗 + 那 200ms 退场 + 跨页接力
   │  ├─ book/
   │  │  ├─ StorybookFlip.tsx    ★ 首页第二屏：一页页翻开的示例绘本《小宇的云》，中途一个选择点
   │  │  ├─ storybook-flip.css   组件样式（区间与叶模型写在文件头；`≤640` 那一档整节不出现）
   │  │  ├─ demoBook.ts          那本书的内容：四个跨页（一支 a、一支 b）
   │  │  ├─ flip.ts              叶绕书脊的翻页几何（★ 纯函数，不碰 DOM / React；三处共用）
   │  │  ├─ BookSpine.tsx        书脊
   │  │  └─ spreadTints.ts       四张跨页的纸色（点阵孪生表的真值来源之一）
   │  ├─ booklist/               ★ 灵感书单那 12 本样书（只读）
   │  │  ├─ booklist.ts          内容根：类型、`BOOKLIST`（12 本，与 THEMES 同序）、资产路径
   │  │  ├─ books/{key}.ts       一本一个文件：书名、主角锚点、8 个跨页的正文（= 朗读稿）
   │  │  ├─ booklist.test.ts     结构约束：同序、8 跨页、每跨页 42–60 字、无数字与字母…
   │  │  ├─ BooklistWall.tsx     `/booklist` 那面墙（服务端组件，问盘之后按实情渲染）
   │  │  ├─ booklist-wall.css    组件样式
   │  │  ├─ BooklistReader.tsx   `/booklist/<key>` 的全屏阅读器（一跨页一张 3:2 图）
   │  │  └─ booklist-reader.css  组件样式（★ 与 reader-book.css 各一套类名，理由在文件头）
   │  ├─ scene/
   │  │  ├─ SceneBackdrop.tsx    页面级背景：两幕场景 + 长交叉溶解（客户端组件；锚点见文件头）
   │  │  └─ scene-backdrop.css   组件样式（每层的雾、background-position、权重消费）
   │  └─ highlights/
   │     ├─ HighlightsReel.tsx   亮点那一屏：GSAP 指针跟随 + 轮播（手机上是竖排五张，客户端组件）
   │     ├─ highlights-reel.css  组件样式（★ 谁写 transform 那张表在它文件头）
   │     └─ highlights.ts        五条亮点的文案与胶囊（卡上不写排期）
   └─ lib/
      ├─ themes.ts               12 个主题的 key / 中文名 / 主题词
      ├─ booklist-assets.ts      ★ 样书的资产**在不在盘上**（服务端读一次目录，界面据此渲染）
      ├─ useScrollDriver.ts      滚动驱动机器（绘本节在用，首屏待迁）
      ├─ useScrollTick.ts        页面级滚动 tick（`SceneBackdrop` 在用）
      ├─ useEnterTimeline.ts     工作台每一屏挂载时那一条进场时间线（GSAP core，只 from()）
      ├─ useEnterTimeline.test.ts 只测纯部分：交错上限、步进顺序、整场收在 1.2s 内
      ├─ math.ts                 clamp / smoothstep / lerp / noNegZero（★ 纯函数；`reel.ts` / `tilt.ts` 共用）
      ├─ math.test.ts            手算值、区间外饱和、退化区间不返回 NaN
      ├─ reel.ts                 轮播状态；offset 走**环形最短位移**（第 1 条的左边是第 5 条）
      ├─ reel.test.ts            两侧永远填满、跨界判据、可见性三者不合并、环形取模的负数坑
      ├─ tilt.ts                 归一化指针 → 倾斜量（★ 纯函数，符号表在测试里）
      ├─ tilt.test.ts            四角与中心的符号表、上限、出界夹取、-0 与 NaN
      ├─ asset-url.ts            资产路径 → URL（可选挂 `?w=`）
      ├─ thumbs.ts               ★ 封闭的缩略档表 + 一次 sharp 缩放（档位为什么不能任意，写在文件头）
      ├─ thumbs.test.ts          非法 `?w=` 一律不缩、向上归档、缓存键、真缩一次且绝不放大
      ├─ cards-list.ts           「有哪些角色卡」的唯一实现（API / 角色墙 / 主页胶囊共用）
      ├─ kid-names.ts            演示孩子的名字从哪来（读不到就退回 childId，不编名字）
      ├─ engine/                 ★ 生成引擎（W1 定稿，见下「引擎层」）
      ├─ mcp/                    ★ MCP 那一层：protocol.ts（JSON-RPC，纯函数）+ tools.ts（七条工具）
      ├─ plan-tools.ts           ★ 编故事那一步模型能调的四件工具（检索 / 书架 / 自检 / 角色段）
      ├─ stub-fixture.ts         ★ 固定替身：不花钱不联网跑完一本书（engine-run 与 MCP 共用一份）
      ├─ schemas/                结构化输出的校验器 + 契约（自写，一份定义两用）
      └─ prompts/                分阶段提示词，带版本号
```

★ 有一条**分层上的新边界**要说清：`src/lib/mcp/` 与 `src/lib/plan-tools.ts` 是**服务端**的
（它们读盘、跑引擎），而 `mcp/server.mts` 只是一层**薄壳**——因为 `.mts` 不进
`pnpm typecheck`（`tsconfig.json` 的 include 只写到 `.ts`），逻辑留在 `src/lib/` 里
才既过闸门又跑测试（理由与代价记在 [docs/known-tradeoffs.md](docs/known-tradeoffs.md)）。

### 分层约定

| 层           | 位置               | 规则                                                                                |
| ------------ | ------------------ | ----------------------------------------------------------------------------------- |
| **设计系统** | `app/globals.css`  | 令牌只在 `:root` 定义一次；同时通过 `@theme inline` 暴露给 Tailwind                 |
| **组件层**   | `components/<域>/` | 组件自己的样式与组件同目录、同名（`HeroOrbit.tsx` / `hero-orbit.css`）              |
| **页面层**   | `app/`             | 只做组装与页面级规则（★ 首页那三条桌面 `min-width: 1280px` 兜底 2026-10-19 已退休） |

组件样式**保持全局引入而非 CSS Modules**：几条规则依赖 `.hero[data-leaving='true'] .hero__brand`、`.storybook__stage[data-choice]` 这类属性选择器与 `:nth-child(2n)`，改 Modules 要同时重写类名与这些选择器，收益为零。类名都带前缀（`hero-` / `hl-` / `reader__`），冲突风险低。

### 命名规范

| 类别              | 规则                                                | 示例                                  |
| ----------------- | --------------------------------------------------- | ------------------------------------- |
| 目录              | 全小写 kebab-case                                   | `components/hero/`、`lib/story-tree/` |
| React 组件文件    | PascalCase，与默认导出同名                          | `HeroTypewriter.tsx`                  |
| 纯逻辑 / 工具模块 | kebab-case                                          | `lib/themes.ts`、`character-card.ts`  |
| App Router 路由段 | kebab-case 英文                                     | `/create`、`/reader/[bookId]`         |
| 样式文件          | 与所属组件同名                                      | `hero-typewriter.css`                 |
| 美术资源          | 全小写英文语义名，与提示词文档一致                  | `public/art/dino.webp`                |
| 脚本文档          | 文件名 kebab-case 英文，正文中文                    | `docs/cover-art-prompts.md`           |
| 类型 / 组件       | PascalCase                                          | `OrbitItem`、`StoryPage`              |
| 常量              | SCREAMING_SNAKE                                     | `THEMES`、`MAX_RETRY`                 |
| 环境变量          | SCREAMING_SNAKE，服务端专用不加 `NEXT_PUBLIC_` 前缀 | `LLM_API_KEY`                         |

### 引擎层（W1 定稿并跑通）

引擎与 UI 严格解耦，已落到：

```
src/lib/
├─ engine/
│  ├─ index.ts        唯一入口，四个动作：buildCharacterCard / **planBook**（①编故事）/
│  │                  **illustrateBook**（②–⑦）/ runBook（前两个的复合，脚本与跑测走它）
│  ├─ domain.ts       领域类型（角色卡 / 树 / 页 / 资产 / 出处 / 统计）
│  ├─ events.ts       ★ 引擎与 UI 的 seam：事件协议（界面 / MCP / 日志共用）
│  ├─ tree.ts         扁平页表 → 故事树（★ 纯函数）
│  ├─ plan.ts         ② 规划：Schema 校验 + 带反馈的重试（含「按家长那句话重写一版」）
│  ├─ illustrate.ts   ③ 逐页生成 + 一致性核对 + 重画（Agent 的落点）
│  ├─ digest.ts       内容指纹与规范化序列化
│  ├─ errors.ts       显式失败，无静默降级
│  ├─ character-card/ card.ts 派生规则（纯）· store.ts 资产读写
│  └─ providers/      types.ts 能力接口 · registry.ts env→实现 · http.ts ·
│                     openai-text · openai-vision · tokenrhythm-image ·
│                     replay.ts（录制/回放）· stores.ts（内存/磁盘）
├─ rag/               ★ 检索（2026-10-19）：corpus.ts 切块与内容指纹 · score.ts 中文 bigram + BM25 ·
│                     retrieve.ts 两条极性（范例 / 避开）· prompt.ts 范例那一段 ·
│                     load.ts 读种子索引 + 现场扫自家的书 · review-corpus.ts 审核条款 ·
│                     index.seed.json（生成物，随仓库提交，见 `scripts/build-rag-index.mts`）
├─ story-draft.ts     ★ 故事草稿（`books/<id>/story.json`）：①与②之间落在盘上的那一份
├─ story-problems.ts  ★ 闸门上的判据：改过的故事还能不能画（浏览器安全的纯函数）
├─ schemas/           自写校验器（一份定义同时出 JSON Schema 与运行时校验）+ 故事契约
└─ prompts/           story-plan.ts · image.ts —— 带版本号，实测踩过的坑写进约束
```

> **①编故事 与 ②逐页画 是两个动作**（2026-10-17，「故事闸门」）：出图是这条流水线上唯一
> 真正花钱的一步，而它原来紧跟在编故事后面——家长在读到故事第一个字之前，整本的钱已经花了。
> 拆开之后界面能把那一版故事摊出来给家长逐条改，改完点「就按这个画」才出图。
> `runBook` 留着**不是为了兼容**：脚本、横评、离线跑测走的是它，而它是那两个动作的复合
> （`split.test.ts` 钉着"两条路产出同一串事件、同一本书"）。

> **检索（RAG）落在 `src/lib/rag/`**（2026-10-19）：三份语料**归属各不相同**
> （12 本样书的种子 / 这个家庭自己的创作史 / 审核条款），索引**就是一个文件**、
> 随仓库提交，排序是中文 bigram + BM25——**不引向量数据库**，理由是实测的
> （[ADR-0011](docs/adr/0011-index-is-a-file-not-a-vector-db.md)）。
> 它挂在规划那一步的一个入参上（`retrieve`），**不传就是这一轮不检索**，
> 所以"开与关"是同一行代码的两个值，不是两条流水线。
> 检索策略与那五个量的读数：`docs/known-tradeoffs.md` 的「检索那一层」一节。

**三条硬性约束，都有机械执法**：

| 约束                            | 怎么把门                                                                                                                                         | 怎么验收                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `lib/engine/` 不得 import React | `eslint.config.mjs` 对 engine/schemas/prompts/**rag** 四个目录禁 `react` / `next/*` / `@/components/**` / `window` / `document` / `localStorage` | `node scripts/engine-run.mts --mode=stub` 不启动浏览器跑完一本书                       |
| 新代码吃最严 TS 档              | `tsconfig.engine.json` 叠 `noUncheckedIndexedAccess`，`pnpm typecheck` 两个 config 都跑                                                          | 已交付的那几屏**不吃**这一档（实测 67 处报错，全在动过的测量代码里）——留作单独一次迁移 |
| 模型名不写死                    | `providers/registry.ts` 只认 `LLM_MODEL` / `IMAGE_MODEL` / `VISION_MODEL`，缺一个就报「换模型不许改代码」                                        | 全仓库零个硬编码模型 id                                                                |

### 后端（Java）：只管「你是谁」与「你能用什么」

2026-10-16 起多了一个 Spring Boot 进程（`server/`）。它与前端的分工只有一句话：
**密钥、引擎、作品文件都在 Next 那一侧；Java 只管账号、权限与音色记录。**

| 归 Next（`src/`）                           | 归 Java（`server/`）                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 模型密钥、`serverEnv()`、模型配置           | 手机号/密码、会话票、**有没有创作权**（一位）                                              |
| 引擎、prompt、资产（`ASSET_ROOT` 下的字节） | MySQL 里的那几张表：`users` / `user_permissions` / `voices` / `sms_send_log` / `sms_codes` |
| BFF 路由（`/api/*`）                        | 短信频控、登录失败锁、管理页那些动作                                                       |

**浏览器只跟 Next 说话**，从不直接打 Java：

```
浏览器 ──同源──> Next Route Handler ──127.0.0.1:8080 + X-Internal-Token──> Java ──> MySQL
                 （httpOnly cookie `xzj_session`）
```

三条不显然的地方：

- **票在 httpOnly cookie 里，一个字节都不回给 JS**（`lib/auth/session.ts`）。
  Next 自己验 HS256 签名（不引 jose），**权限每次都问 Java**（`GET /api/auth/me`），
  所以站长勾掉一个开关之后那个人**下一次点「开始创作」就生效**，不必等 7 天的票过期。
- **判不了就不放行**：Java 连不上时回 503，不是放行。反过来会让"后端挂了"
  变成一个"所有人白用你的密钥"的窗口，而那个窗口没人看得见。
- **公网那一侧只有 Nginx**。Java 与 MySQL 都只听 `127.0.0.1`——所以"8080 暴不暴露"
  不是一个配置问题，是**绑定地址**决定的（见下面那张部署图与工单 03 的记录）。

★ 站长那一侧还有一个**不进 Java** 的能力：在管理页换模型 / 接口地址 / api-key
（密钥只从 Next 的服务端环境来，见 ADR-0009 与 §三「管理页」那一节）。

生产是**同机四件**（工单 03/10，**2026-10-19 两半都已上线**：
后端 10-17，前端 10-19。所以 `http://123.56.148.105` 上是真站点，
不是占位页 —— 首页、登录、灵感书单、阅读器都在）：

```
公网 ──:80──> Nginx ──┬── /            ──> Next 生产 127.0.0.1:3000
                      └── /backend/    ──> Java 127.0.0.1:8080（要 X-Internal-Token）
                                            └──> MySQL 127.0.0.1:3306（库 xiaozhujue）

数据与代码分开：作品在 /var/lib/xiaozhujue/assets，代码在 /opt/xiaozhujue/
（部署只写 /opt/xiaozhujue/app 那一棵，作品目录**不在射程内**——合在一起手一抖就是一次真实的数据损失）
秘密只在服务器上：/etc/xiaozhujue/api.yml（640 root:xzj），由 systemd 挂进来
```

---

**还没做的**（按周次）：`stores/`（Zustand，W2 第一个跨组件共享状态的界面出现时再装）、
`components/creation|reader|panels`（W2–W3）、配音适配器（W4）、审核 Agent（W4）。

---

## 三、安装运行指南

### 环境要求

| 依赖    | 版本                       | 说明                      |
| ------- | -------------------------- | ------------------------- |
| Node.js | **≥ 20**（开发用 24.12.0） | Next.js 15 要求           |
| pnpm    | **10+**（开发用 12.11.2）  | 未安装时：`npm i -g pnpm` |

**运行期依赖里有一个原生模块：`sharp`**（图像缩放，`/api/assets?w=` 与演示书导出都用它）。
它按平台装预编译包（`@img/sharp-*` 那一组 optionalDependencies），**不需要编译脚本**，
所以 `pnpm-workspace.yaml` 的 `allowBuilds` 里没有它、也不该加——
装完 `node -e "require('sharp')"` 不报错就是通了（本机实测：一张 1440×1440 PNG 缩到 1024 WebP 约 190–580 ms）。

> **注意**：`pnpm-workspace.yaml` 里配置了 `allowBuilds.unrs-resolver`。pnpm 10.6+ 起该配置**只从这里读取**，写在 `package.json` 的 `pnpm` 字段里会被忽略。它是 `eslint-config-next` 的传递依赖，需要执行 postinstall 编译原生绑定，缺了它 eslint 会报解析错误。

### 安装与启动

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

```bash
pnpm dev
```

打开 http://localhost:3000

#### 本地起后端（账号与权限那一半）

```bash
& .\server\run-local.cmd
```

**必须用这个脚本（或等价的 bash 一行），不要直接 `mvn spring-boot:run`。**
理由只有一条，而它咬过人：Java 那一侧**不读** `.env.local`（它读进程环境，
生产上读 `/etc/xiaozhujue/api.yml`），而 `APP_JWT_SECRET` 不带的话它会
**自生成一把随机的**——症状是「登录返回 200，之后每个请求 401」，
与"鉴权写错了"长得一模一样。`run-local.cmd` 就是把 `.env.local` 读进环境再跑 maven。

等价的一条（Git Bash 里）：

```bash
set -a; . ./.env.local; set +a; mvn -o -f server/pom.xml spring-boot:run
```

★ 后端起在哪一个 H2 库上是**看谁的工作目录**决定的：spring-boot 插件给子进程设的
working directory 是项目目录（`server/`），所以 `-f server/pom.xml` 那种写法用的是
`server/.local-db/`——**账号都在那一个里**。用 `java -jar server/target/*.jar`
从仓库根起（没有这个"项目目录"的概念）会落到 `<仓库>/.local-db/`，
那是一个**空库**：症状是"我的账号怎么没了"。

★ 2026-10-18 又撞了一次（同一个坑的第二种症状：**管理页进不去**——空库里没有
`100000` 这个账号，而登录接口对"库里没有这个号"说的是「这个号码还没设过密码」，
与"库换了一个"差着十万八千里）。所以现在多了一道保险：`application-local.yml`
的地址读 `APP_H2_PATH`，而 `run-local.cmd` 会把它设成**按脚本自己所在目录算出来的
绝对路径**（`server/.local-db/xiaozhujue`）。"从哪个目录起"从此不影响用哪个库——
上面那条 `-f server/pom.xml` 的等价写法仍然对（插件的工作目录本来就是 `server/`），
只是两种写法现在都钉在同一个文件上。

### 全部脚本

| 命令                | 作用                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`          | 启动开发服务器（产物写 `.next/`）                                                                                           |
| `pnpm dev:preview`  | 第二个开发服务器，产物写 `.next-preview/`，端口 3100                                                                        |
| `pnpm build`        | 生产构建                                                                                                                    |
| `pnpm start`        | 启动生产服务器（需先 build）                                                                                                |
| `pnpm lint`         | ESLint 检查（含引擎层的依赖禁令）                                                                                           |
| `pnpm typecheck`    | **两个 config 各跑一遍**：全局一档，`tsconfig.engine.json` 对引擎/契约/提示词三个目录再叠 `noUncheckedIndexedAccess` 严一档 |
| `pnpm test`         | Vitest 跑一遍纯函数测试（**1202 条**，全在 node 环境——W1 那会儿是 130 条，见下面那条）                                      |
| `pnpm test:watch`   | Vitest watch 模式                                                                                                           |
| `pnpm format`       | Prettier 格式化                                                                                                             |
| `pnpm format:check` | 只检查不写入（CI 用）                                                                                                       |
| `pnpm mcp`          | 起 MCP server（stdio）——**要 `--user=<userId>`，见 [`mcp/README.md`](mcp/README.md)**                                       |
| `pnpm mcp:session`  | ★ 起一个真的 MCP 会话跑一遍判据（14 条），落 `.out/mcp-session/`                                                            |

引擎与跑测的脚本不进 `package.json`（它们是 node 直接跑的 `.mts`，不是 npm 生命周期）：

| 命令                                                    | 作用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/engine-run.mts --mode=stub`               | ★ 引擎验收：不启动浏览器、不联网、不花钱跑完一本书                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `node scripts/engine-run.mts --mode=live`               | 真供应商跑一本，并顺手录制离线回放包                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `node scripts/engine-run.mts --mode=offline`            | 用录好的 manifest 回放（ADR-0003 的断网演示路径）                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `node scripts/w1-image-bakeoff.mts --models=a,b`        | 图像横评：同一角色 5 页 × N 候选，产出盲评包与横评表                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `node scripts/w1-text-bakeoff.mts --models=a,b`         | 大模型横评：同一批主题 × 10 本的 Schema 通过率与重试次数                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `node scripts/probe-tool-calls.mts`                     | ★ 探针：这条网关上 `tools` / `tool_choice` 到底能不能用（八格，判读表在文件头）                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `node scripts/make-probe-library.mts --out=DIR`         | 造一个**隔离资产根**（9 本 `probe-01…09`）给会写盘、会删文件的探针用                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `node scripts/export-demo-cards.mts --from=DIR --apply` | ★ 把示例角色卡导出成随仓库发布的 `public/demo/cards/`（默认只打印计划）                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `node scripts/e2e-demo-cards.mts`                       | ★ 示例卡对每个人都有、**别人的东西拿不到**（打本机一台 dev server）                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `node scripts/probe-shelf.mts`                          | 书架那一屏的布局与编辑判据（要一台 dev server + Chromium）                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `node scripts/make-reader-paper.mts`                    | 出阅读器那六张底图候选 + 对照表（调图像模型；`--sheet` 只拼表、`--apply=` 落 `public/`）                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `node scripts/check-reader-paper.mts`                   | ★ 底图的四组读数（周期尖峰 / 高频 / 彩度 / 偏离）+ 点阵那一行对照；文字对比度那条**不在这里**（在 `chk-reader-desk.mjs` 里）                                                                                                                                                                                                                                                                                                                                                                                                 |
| `node scripts/chk-reader-desk.mjs URL`                  | ★ 阅读器那层底图：铺满整块视口、**压在图上的每一行字逐档量真像素是否过 4.5:1**、设置里挑的那档真到了这一屏、**底图之外那行「← 回灵感书单」真画在图上面**（四条，两台阅读器都跑；`--w=844 --h=390` 可换横屏视口）                                                                                                                                                                                                                                                                                                             |
| `node scripts/chk-mobile.mjs URL`                       | ★ 手机那一档 76 条（五个视口 × 十三条路由）：不横向溢出、**横屏把书铺开**（书高 ≥ 95% 视口 ＋ **控件一个都不压书**；844×390 与 640×360 两档、两台阅读器各量一次）、旋转提示的判别力、**真触摸事件后跟手翻页**、触控目标 ≥ 44×44、**书架那一屏不"挤"**、**首页两副形态**（手机上：主张句不被切 / 只有两节、首屏就是一屏 / 竖排卡正文列 ≥ 240 / 那五张图各下一次且两套 DOM 同一批 URL / **那 12 张封面一张都没取**；桌面上反向：**三节都在、12 张照常取全**）（自己签票登录，`--user=1`；空架时明说跳过）                      |
| `node scripts/chk-paper-picker.mjs URL`                 | ★ 设置里挑一档 → 落盘 → 阅读器换底 这一条链从"点"量到"图文件名"                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `node scripts/chk-perf.mjs URL`                         | ★ **页面级**性能读数（TTFB / FCP / LCP 连元素 / CLS 连位移源 / TBT 连窗口）：三个视口 × 三条路由，每格 CPU 不节流与 ×4 各连跑 3 次取中位、每格清一次缓存；四条判据（节流真的生效——**直接量尺子**：页内一段固定忙循环必须慢出 2× 以上、每格都量到真有内容的首屏、桌面首页那 12 张封面确实取了、量不出 LCP 的格子**减动效补跑得出来**）。★ 要对**生产构建**跑（`NEXT_DIST_DIR=.next-perf pnpm build` + 一个 `next start`），dev server 上量的是另一件事                                                                        |
| `node scripts/chk-storybook-keys.mjs URL`               | ★ 首页第二屏那本书的 ← → **归谁**：书铺在这一屏时才接管、第三屏按方向键**不翻**（那条被评委当场看见的 bug）、接缝（书底边只露 20px）也不接、静止模式照常翻、手机那一档不接键、第三屏自己的轮播键还在（十条；同一支探针在修前那一版上是 4/10）                                                                                                                                                                                                                                                                                |
| `node scripts/chk-system-pages.mjs URL`                 | ★ 三个系统页：`/no-such-page` 是**真 404**、那张纸的几何与两条出口、加载态**晚 120ms 才显形**（拦 RSC 与 page chunk 各 1.5s 才量得到）、工作台**组内**导航时侧栏还在（七条）                                                                                                                                                                                                                                                                                                                                                 |
| `node scripts/mk-shared-fixture.mjs`                    | 造/拆**共读版**的验收夹具书（`--missing` 再造成缺一页图的；`--clean` 拆掉；不进仓库）                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `node scripts/chk-shared-reader.mjs URL`                | ★ 共读版阅读器 53 条（真帧 + 网络）：阅读顺序 = 那条路、选完零生成、静止终态、键盘、缺图兜底纸、**整趟只请求本机**（`--w=844 --h=390` 把"选择点不压正文"那条在横屏下复量）                                                                                                                                                                                                                                                                                                                                                   |
| `node scripts/chk-path-memory.mjs URL`                  | ★ 路径记忆 18 条：选过的那一支记得住——**含一次真销毁**（关掉标签页另开一个）、清了/坏了/串了都退回"没选过"                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `node scripts/chk-demo-shared.mjs URL`                  | ★ 演示那本共读版：**不登录**打开、封面走到封底一屏不跳、岔口按钮 79px、**整趟不碰外部主机**（断网演示那条判据）                                                                                                                                                                                                                                                                                                                                                                                                              |
| `node scripts/e2e-shared-reading.mts --base=URL`        | ★ 共读版全链路：一句话 → 编故事 → 闸门改一个字 → 出图配音 → 书里选一支（**真花钱**；`--until=story` 只验到闸门）                                                                                                                                                                                                                                                                                                                                                                                                             |
| `node scripts/verify-mirror.mts --dir=DIR`              | ★ 本机那份镜像**自足吗**：每本书清单引用的每个资产在不在（工单 12）                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `scripts/pull-from-server.sh`                           | ★ 把服务器上的作品与数据库快照**单向**拉回本机（`--full` 全量）                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `node scripts/adopt-legacy-assets.mts --user=<登录名>`  | 把平铺的老数据搬进某个账号那一片（默认只打印计划，`--apply` 才动）                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `node scripts/check-secrets.mts`                        | 密钥自查：产物里有没有出现 `.env.local` 里那几个真值                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `node scripts/cost-model.mts`                           | ★ **一本绘本要花多少钱**：价目表（目录自带单价，免费）+ 一次规划 / 一次比对 / 一次画面审核 / 三个计费字符样本的 token 与钱 + 盘上真书的出图次数与计费字符，拼成一页成本表（报告落 `.out/cost-model/report.md`；`--from-cache` 复用、`--prices-only` 不花钱）                                                                                                                                                                                                                                                                 |
| `node scripts/anchor-note-cases.mts`                    | ★ **锚点回灌的 A/B**：同一页、同一份页级三项，A 组用今天的提示词（**空对照**）、B 组只多一句"上一版哪几条锚点不像"（那句取自书上**真实记录**的 `missedAnchors`，页级三行从 `book.json` 读不重抄），逐张过同一个 `compare`；报通过率 + Wilson 区间、分数分布、"点名的那几条还在不在"、以及**这个 N 下的 MDE**；每页先出一张无提示的驾驶席并**同一份字节连打 3 次**量尺子自己的噪声底（**真花钱**；`--dry=1` 只把两组提示词打出来、一张不出；出图/比对没跑成的格子记「没测成」，不进任何分子分母，报告落 `.out/anchor-note/`） |
| `bash server/deploy.sh`                                 | 后端部署：构建 → 上传 → 重启 → 带重试的冒烟（工单 03）                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `bash server/backup.sh [--verify]`                      | 每日数据库备份（服务器上由 cron 调）；`--verify` 会真灌一次再删                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `bash scripts/deploy-web.sh --provision`                | 前端那一半的一次性准备（幂等）：装运行时、建目录、写 `web.env` / systemd unit / Nginx conf，**一律不启动**                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `bash scripts/deploy-web.sh --assets`                   | 一次性把本机作品搬上服务器（`.out/web/u` → `/var/lib/xiaozhujue/assets`）                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `bash scripts/deploy-web.sh [--full] [--expect=文本]`   | 前端部署：`git archive` 打包 → 上传 → 按依赖指纹决定 install → 构建到 `.next-new` → 换目录 → 带重试的冒烟 → 失败自动回滚（`--expect` 是新构建里搜得到那句话才算成）                                                                                                                                                                                                                                                                                                                                                          |
| `bash scripts/deploy-web.sh --go-live` / `--rollback`   | ★ 上前端那一步本身（启用 Nginx site + web unit，默认不碰这两个开关）／ 秒级换回上一份 `.next`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `bash scripts/deploy-web.sh --test-page`                | 在 80 上放一个 Nginx 静态占位页（**不经过 Next**），用来单独测"公网连不连得上"；`--go-live` 会自动撤掉它                                                                                                                                                                                                                                                                                                                                                                                                                     |

> 两个横评脚本**必须真跑**：没有 `IMAGE_API_KEY` 时直接拒绝运行，
> 不带 `--yes=1` 时只打印预算。理由写在 CLAUDE.md「不糊弄」——
> 数字要能复现，不接受手工填数。

★ `pnpm test` 那个数**只涨不跌**（2026-10-18 实测 1045 条），而这正是它值得记一笔的地方：
W3（共读版）落地时，树的形状（恰好一个选择点、两支深度差 ≤ 1）、选择点那九格、
闸门那一屏的两个数（路长 / 要画的张数）、摘要里"路长 ≠ 节点数"的口径分离、
以及路径记忆的解析纪律，**每一样都变成了可测的纯函数**——所以一条用例都没删，
只加了（工单 06/07 那两单自己加的是 11 条：`library.test.ts` 6 条 + `reading-path.test.ts` 5 条）。
浏览器那一半（阅读顺序、真销毁之后的按下态、缺图兜底纸、演示书的断网那条路）
**不在 vitest 里**：vitest 是 `environment: 'node'`（见 `vitest.config.ts` 文件头），
那些事实由 `chk-shared-reader.mjs`（40 条）、`chk-path-memory.mjs`（18 条）与
`chk-demo-shared.mjs`（11 条）在无头 Chrome 里量。

`dev:preview` 的存在理由与实测症状写在 [`next.config.ts`](next.config.ts) 的注释里：
两个 `next dev` 默认共用同一个 `.next/`，一边跑 `pnpm build` 另一边就会
`Cannot find module './712.js'`。产物目录分开就互不干扰，端口的道理一样。

用它之后有三件值得知道的事（都实测过，不是猜测）：

- **`pnpm build` 也要带上自己的产物目录**：`NEXT_DIST_DIR=.next-build pnpm build`。
  默认的 `pnpm build` 写的就是 `.next/`，会把**别人正在跑的 dev server** 的 chunk 换掉，
  症状正是上面那条 `Cannot find module './712.js'`。这一条本轮又踩了一次——
  分开了 dev 的目录却忘了 build 也是共用的，所以写下来。
- **Next 会自己改写 `tsconfig.json`**：它把 `<distDir>/types/**/*.ts` 加进 `include`
  并把数组重排成多行。加进 `include` 无害（只是编辑器要用的路由类型），
  但重排会让 `pnpm format:check` 报 `tsconfig.json` —— 跑一次 `npx prettier --write tsconfig.json`
  即可，Next 之后不会再改那次写入。
- **`.next-preview/` 必须留在 ESLint 的 ignores 里**（`eslint.config.mjs` 用的是
  `.next*/**`）。漏掉它的后果不是"多几条警告"：`eslint .` 会去 lint 构建产物，
  实测多出 1414 条问题（123 个 error），把真问题的信号彻底淹掉。

### 环境变量

见 `.env.example`。**真实密钥只写在 `.env.local`，该文件已被 `.gitignore` 排除** —— 仓库是公开的，密钥一旦提交就撤不回来。

★ 2026-10-17 起密钥有**两个落点**，纪律是同一条（两个都在 `.gitignore` 里）：

| 落点                                                     | 谁写               | 什么时候用                              |
| -------------------------------------------------------- | ------------------ | --------------------------------------- |
| `.env.local`                                             | 人手工写           | 开发机；也是换服务器时的随身那份        |
| `models.runtime.json`（可用 `MODEL_CONFIG_FILE` 换位置） | **管理页写出来的** | 站长在界面上换模型 / 接口地址 / api-key |

两者同时存在时**后者压过前者**（`serverEnv()` 按请求现读，合并规则在 `lib/settings/runtime-config.ts`）。
生产上建议 `MODEL_CONFIG_FILE=/etc/xiaozhujue/models.json` 把它挪出仓库目录——
那个目录是部署产物，重新部署会擦掉它。

### 管理页：站长能换模型，改完不用重启

`/admin` 那一屏底下有四张卡（文字 / 图像 / 视觉 / 语音），每张能改三格：
**模型名、接口地址、api-key**。三条不显然的地方：

- **改完立刻生效，不重启**。这一条不是"实现得凑巧"：`serverEnv()` 每次请求现读那份文件，
  **刻意没有模块级缓存**。验证方式也刻意选成"只有真做才会不同"的那一个——
  改完立刻问 `GET /api/auth/me`，里面的 `speechModel` 是**引擎现读 `TTS_MODEL`** 给的，
  它必须当场变；只验"文件写进去了"证的是别的（见 `.out/verify-model-config.mjs`）。
- **响应里一个 key 都不许有**。管理页只回"这一格配了没有、是从哪儿来的"
  （`env` / `admin` / null），值的部分永远是 `null`。这条判据在测试里是**在整个响应体里搜那五个真值**，
  而不是"某一格是不是 null"——后者只挡住一种写法。
- **空 ≠ 清掉**。只想换模型名的人不该顺手把自己的 key 清掉；要清就走那颗
  「恢复默认」，确认框里说的是"点完这个能力会变成空值"（它读的是 `process.env`，
  不是合并后的那份——这一位判错，确认框就会说"那边都有配，不会空"）。

★ 语音那一栏有一条**警告**：克隆出来的音色绑死在创建它时的模型上（实测跨模型 400 `[411]`），
所以换语音模型会让用户手里那些克隆音色**当场失效**。这条写在卡上，不只在文档里。

**2026-10-18 在这张卡上加了「厂商 / 网关」与「测试连通」**（用户给了四张别家后台的截图，
「模型选择可以弄成这样的」）：

- **「厂商 / 网关」下拉只替你填接口地址，不填模型名**。换一家手抄地址的坏法是抄错一个字母
  而**保存成功**，一直到真生成一本书才以 404 的面目出现。表在
  [`src/lib/settings/gateways.ts`](src/lib/settings/gateways.ts)，**按能力过滤**
  （语音那一路的地址是 `…/api/v1`，与对话那一路不是一家）；它是**地址书签不是背书**——
  本仓只实测过当下在用的那一家，所以卡片上写着"照各家文档抄的，选完点「测试连通」就知道通不通"。
- **「拉取模型列表」挪到「模型名」那一格右边**（原来在卡片底部那行灰字里，离站长当时看着的
  那一格隔着两格）。它按的还是**服务端那份配置里**的地址——还没保存的地址在服务端不存在。
- **拉到的那几个候选，在「模型名」下面那颗「挑一个」里是列全的**（2026-10-18 第二轮补的：
  第一版挂的是 `datalist`，Chrome 拿输入框里现有的字去筛它，于是"拉到 26 个"与
  "点开只剩一个"同时成立——病根与改法见 [docs/known-tradeoffs.md](docs/known-tradeoffs.md) 的「`datalist` 会拿输入框里现有的字筛候选」一节）。
  ★ 那一格**仍然是自由文本框**，挑选框只是器具：图像在用的 `wan2.7-image` 不在
  网关 `/models` 返回的那 26 个里，做成强制选择框会当场丢掉它正在用的值。
- ★ **「测试连通」真打厂商接口，也就真花钱**：文字发一句话（上限 64 token）、图像按产品自己的
  尺寸 1536×1024 出一张（**一口价 0.2 元/张**，这话就写在按钮旁边）、视觉读你选的一张本地图、
  语音念卡片上印的那一句。通了把**证据本身**摆出来（图显示、音频能播、文字与视觉把话写出来），
  没通给一句能照做的话，后面附厂商原文。
  ★ 发出去的那点东西由服务端写着（`model-config.ts` 的 `TEST_REQUEST`），卡片副标题说的就是它
  ——两处各写一份的话，副标题会停在"64 token"而实际发 4096（有一条测试钉着这个同源）。

可复现的检查是 [`scripts/chk-admin-model.mjs`](scripts/chk-admin-model.mjs)：形状（四张卡各有下拉、
那一行里既有输入框又有按钮）+ 预设只填地址（选完之后模型名那一格一个字没动）+ `--live=1` 时
四种能力各真打一次。★ 默认**不跑** live 那一半：图像那一按一口价，不该被一次误触花掉
（与 `w1-image-bakeoff` 那条「不带 `--yes` 只打印预算」同一条纪律）。

### 美术资源的重新生成

`public/art/` 里的 12 张封面由原始 JPG 转换而来（源图 1376×768 → 居中裁精确 16:9 → 1280×720 WebP，逐张从 q=78 递减试到 ≤130KB）。转换脚本是 [`scripts/make-webp.py`](scripts/make-webp.py)，源图目录与产出目录都用参数传：

```bash
python -I scripts/make-webp.py <源图目录> public/art
```

提示词与画面规格见 [`docs/cover-art-prompts.md`](docs/cover-art-prompts.md)。

文件名与 `src/lib/themes.ts` 里的 `key` 必须一一对应——对不上首屏就是一片空白。

脚本有六个预设，不传 `--preset` 就是 `hero`（首屏用，行为与加预设之前一字不差）：

| 预设          | 比例 | 目标宽 | 单张上限 | 用在                                                      |
| ------------- | ---- | ------ | -------- | --------------------------------------------------------- |
| `hero`        | 16:9 | 1280   | 130KB    | 首屏 12 张卡片封面                                        |
| `book-spread` | 3:2  | 1536   | 220KB    | 演示绘本的内页跨页                                        |
| `book-cover`  | 3:4  | 1024   | 150KB    | 演示绘本的竖版封面                                        |
| `book-icon`   | 1:1  | 192    | 15KB     | 选择点那两枚小云图                                        |
| `theme-card`  | 16:9 | 320    | 18KB     | 工作台主题墙（源是 `public/art` 那 12 张，派生）          |
| `figure`      | 2:3  | 256    | 22KB     | 输入框上方那 12 个站着的小主角（★ 唯一保留 alpha 的一档） |

★ `theme-card` 那一档是**派生**（源就是仓库里已有的 `public/art/*.webp`），
见 [`docs/cover-art-prompts.md`](docs/cover-art-prompts.md) §十。
★ `figure` 那一档的源不能直接给出图，**中间要先过一道去底**：

```bash
python -I scripts/cutout.py <立绘源图目录> .out/figures-rgba --tol 2 --choke 0 --min-island 40
python -I scripts/make-webp.py .out/figures-rgba public/figures --preset figure
```

[`scripts/cutout.py`](scripts/cutout.py) 只去掉**与画面四边连通**的近白区，
被彩铅轮廓线封住的内部白（眼白、高光）原样保留；它是 `ALPHA_PRESETS` 这一档能成立的前提
（`make-webp.py` 里那句按预设选 `RGB`/`RGBA` 的 `convert` 是这件事的另一半）。
★ 上面那三个旗标**都是量出来的，不是默认值**：`--tol 2` 是保住发丝级浅色细节的下限
（源图是 JPEG，一片平白的背景带 ±10 噪声，所以紧阈值必须配 `--min-island 40` 一起用，
两步的机制与实测分布写在 `cutout.py` 的文件头）。**改这三个数之前先读那一段。**
出图提示词、逐张体检数与 12 条身份锚点见 [`docs/figure-art-prompts.md`](docs/figure-art-prompts.md)。
**实测**（2026-10-15，落地那一版，`make-webp.py` 自己打的那一行，不是预算）：
12 张逐张 **10–17 KB**、合计 **0.15 MB**、平均 **13 KB**，源图 6.47 MB → **44.0×**。

灵感书单那 12 本样书同样走这两档预设（封面 `book-cover`、跨页 `book-spread`），
一本一个目录，**图与音频同目录同序号**（`p3.webp` ↔ `p3.m4a`／`p3.mp3`，所以
"第 3 张图的音频是哪个"是一句物理事实；容器两种都认、`.m4a` 优先，
因为第一本是拿 `.mp3` 出的——见 `docs/booklist/README.md` §四 那条 ★）：

```bash
python -I scripts/make-webp.py <源图目录> public/booklist/dino --preset book-cover --match 'cover*'
```

```bash
python -I scripts/make-webp.py <源图目录> public/booklist/dino --preset book-spread --match 'p*'
```

规格、12 本索引与逐页提示词见 [`docs/booklist/`](docs/booklist/README.md)。
★ 这一批是**一本一本出的**（用户 2026-10-15 定）：图与音频没齐时界面据实显示——
没画的那一页是一张写着"画还没到位"的纸，书单那张卡上写真实的「画还在画 · n/8」。

演示书那 8 张的转换命令与验收记录见 [`docs/demo-book-art-prompts.md`](docs/demo-book-art-prompts.md)。**跨页与图标那两条不下刀**：跨页的源图与预设同为 3:2（一张跨页 = 两个 3:4 的页面，与 3:4 的封面同比例），
图标的源图本来就是 1:1；只有封面那条真的裁（2:3 → 3:4）。
它们的源图比提示词规格小一档（跨页 1264×848 而非 1536×1024），**按源尺寸落盘、没有放大**，
所以脚本会打 6 条 `偏小` 告警——这一条与两批废弃批次的教训都记在那份文档的 §五。

**脚本只裁不补。** 源图裁完比目标窄就按原尺寸落盘并打 `偏小` 告警，**绝不放大**——缺的
像素补不回来，放大只是把糊变成更贵的糊。看到这个告警应当回头按提示词里写的尺寸重出图，
而不是改脚本里的数字。

亮点那一屏那 5 张同样走 `hero` 预设（16:9 / 1280 / ≤130KB，与那 12 张封面同规格，不必新增预设）：

```bash
python -I scripts/make-webp.py <源图目录> public/highlights
```

源 4.41 MB（5 张 JPG）→ 530,536 B（5 张 WebP，单张 89–117 KB），8.7×。
逐张的验收记录（四边信箱检测 + 右下角亮度 + 五张的逐张判读）见
[`docs/highlights-art-prompts.md`](docs/highlights-art-prompts.md) §四。

**阅读器那层底图**（`public/reader-papers/`）是这一族里唯一**由引擎自己出图**的一档——
它不走 `make-webp.py`，因为源图就是引擎同名模型直接产出的：

```bash
node scripts/make-reader-paper.mts              # 出 6 张候选（调图像模型，源 PNG 落 .out/reader-papers/）
node scripts/make-reader-paper.mts --sheet      # 只拼那张对照表，不调模型
node scripts/make-reader-paper.mts --apply=all  # 落 public/reader-papers/
node scripts/check-reader-paper.mts             # 四组读数 + 点阵那一行对照
```

六张原图（3:2，`1536x1024`）+ 六张缩略图（设置弹窗里那一格用，132×88）：
**实测合计 1.23 MB，单张 183–266 KB、缩略图 188–860 B**。按体积算它是这片资产里最厚的一档
（`book-spread` 那一档是 ≤220 KB，跨页图单张 159–235 KB），而它铺的是**一整层页面底**、
不是一页正文——为什么认下这个体积、以及"要不要压到 200 KB 以下"的取舍，
写在 [docs/known-tradeoffs.md](docs/known-tradeoffs.md) 的「阅读器的底」一节。`src/lib/reader-paper.test.ts` 有一条断言钉着
"表里每一档都在盘上、盘上没有表里没有的图"。提示词用的是
`gpt-image-2-style-library` 的「插画与艺术风格」模板，但**渲染器是引擎自己那台**
（`wan2.7-image`），所以那六张是**逐张看过**的，不是照模板产出就完事——
经过（含"为什么不能只信模板"）写在 [`scripts/make-reader-paper.mts`](scripts/make-reader-paper.mts) 的文件头。

---

## 四、团队信息

| 项       | 内容           |
| -------- | -------------- |
| 队名     | 破晓微光       |
| 成员     | 范嘉庆、胡锦宇 |
| 学校     | 太原理工大学   |
| 参赛组别 | A 组           |
| 指导老师 | 王琦           |
| 赛区     | 北部赛区       |

---

## 五、原创声明

本作品为原创，未抄袭、未直接使用开源项目包装参赛。首屏 12 张绘本封面插画由 AI 生成，完整提示词见 [`docs/cover-art-prompts.md`](docs/cover-art-prompts.md)；品牌标记小插画同为 AI 生成，提示词与落盘前的裁切依据见 [`docs/brand-mark-prompt.md`](docs/brand-mark-prompt.md)。两类画面均不含任何文字、水印或签名。

首屏那 12 张卡曾经还配过 12 段 AI 生成的短片（以同主题的封面静帧为输入帧），**现已整条移除**（换回静帧的理由与实测见 [docs/known-tradeoffs.md](docs/known-tradeoffs.md)）；封面静帧本身还在，提示词见 [`docs/cover-art-prompts.md`](docs/cover-art-prompts.md)、成品在 `public/art/`。

首页首屏那个 3D 环形卡片轨道（`components/hero/HeroOrbit.tsx`）同样是独立实现：椭圆参数方程布点、`preserve-3d` 遮挡排序、三层视差、拖拽惯性与帧率节流全在组件内部自己完成，**没有引入任何动画库**；视觉上参考了公开站点的「卡片环绕中心」构图。

亮点那一屏（`HighlightsReel`）**用了 GSAP**——指针跟随的每帧补间用 `quickTo` 比自己再写一套 rAF 平滑更稳。边界写死在 [docs/known-tradeoffs.md](docs/known-tradeoffs.md)：GSAP 只在这一屏（首页前两节的滚动驱动是 `useScrollDriver`，第三屏那一节没有滚动驱动）。

首页亮点那一屏那 5 张卡片插画同样是 AI 生成（同一套水彩绘本提示词模板），源 JPG 不入库，只保留压缩后的 5 张 WebP（合计 0.51 MB）与转换脚本 [`scripts/make-webp.py`](scripts/make-webp.py)；提示词与逐张验收记录见 [`docs/highlights-art-prompts.md`](docs/highlights-art-prompts.md)。

页面级背景那 3 张三幕场景插画（`public/scenes/`，1365×768 WebP，合计 103.5 KB）也是 AI 生成，同一套水彩绘本提示词模板的变体。它与上面几批的差别在于：**提示词与逐张验收记录留在出图侧的工作区，没有随仓库提交**（那条流水线的脚本与文档不属于本仓库）；因此 `scene-backdrop.css` 的文件头把源图尺寸、压缩后字节数、以及每一档雾的 α 是怎么量出来的就地写全了，[docs/known-tradeoffs.md](docs/known-tradeoffs.md) 那条也把结论抄了一份。
