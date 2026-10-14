# W1 → W2 交接（写给下一个窗口）

这份文件是**给没有本会话记忆的窗口**看的：它记的是"仓库里查不到、只在会话里说过"的东西。
仓库里已有的（架构、判据、实测数字、踩坑）不在这里复述，**只给指针**。

## 一、起点状态（2026-10-13 深夜）

- `HEAD = 2f612ba`（`docs(engine): 参考图测试`）。
- **我的这一轮改动当时还没提交**：`.gitattributes`（新）、`docs/adr/0008-*.md`（新）、
  `README.md`、`GLOSSARY.md`、`docs/tech-selection.md`、`docs/commit-convention.md`、
  `.scratch/w1-engine/spec.md`、`.scratch/w1-engine/issues/01-model-selection.md`。
  **开工前先 `git log --oneline -3` 确认它们在不在**——不在就先问用户，别重做一遍。
- 另有一条**不属于 W1 的未提交线**：首页三幕背景（`src/components/scene/`、
  `public/scenes/`、`src/lib/useScrollTick.ts`，外加 `page.tsx` / `globals.css` /
  `hero-orbit.css` / `HeroOrbit.tsx` / `highlights-reel.css` 的改动）。
  **它必须整块提交**（`page.tsx` import 了 `SceneBackdrop`），别只挑一半。
- 四条闸门当时全绿：`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`（145 条）。
  ★ `format:check` 以前在本机整仓红，那是行尾假故障，**已修**（`.gitattributes`）——
  现在红了就是真有格式问题，别再归因 CRLF，理由见 README §五「行尾」一节。

## 二、W1 交付了什么（指针，不复述）

| 东西                                                 | 去哪看                                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 引擎层（六阶段 + 适配层 + 自写 Schema）              | `src/lib/engine/`、README §二「引擎层」                                                                                                        |
| 判据 1 图像：**go**（≥3 人盲读，两组都像同一个孩子） | `docs/tech-selection.md` §7.5 / §7.6                                                                                                           |
| 判据 1 文本：7 候选 × 10 本                          | 同上 §9.1.2                                                                                                                                    |
| 思考链吃光 token 预算的实测                          | 同上 §9.1.1（`LLM_THINKING` 缺省关，与平台默认相反）                                                                                           |
| 两份横评报告                                         | `.out/bakeoff-image/image-bakeoff.md`、`.out/bakeoff-text/text-bakeoff.md`（**gitignored，只在本地**）；脚本支持 `--reportOnly=1` 从 json 重放 |
| 真跑一本翻出的三个账目问题                           | README §五「测量这一层…」第四类；回归测试在 `illustrate.test.ts`                                                                               |
| 角色卡 / 事件协议 / 预生成                           | ADR-0006 / 0007 / 0003                                                                                                                         |
| 四类测量错法（**每一类都对应一次真实返工**）         | README §五「测量这一层…」                                                                                                                      |
| seam 设计（一个入口、两处 seam）                     | `.scratch/w1-engine/issues/05-seam-design.md`                                                                                                  |

## 三、W1 没做完的三条（**都不挡 W2**，但要知道它们在）

1. **TTS 一次都没跑**。用户口径："等需要的时候我再给你候选和 key"，所以推迟。
   `VoiceSynthesizer` 是 `voice: null`，§8 仍是 C 级名单。
   ★ 但有三条不许含糊：① **阅读器里不许做"演示用播放条"**（首页那条同理由已拆掉，
   一个只对四分之一能响的控件证的是反面）；② §8.3 那条"上传样本 → 返回 voice_id
   → **可解绑/删除**"的硬约束**查文档就能否掉候选、不花钱**，该提前做；
   ③ ≥3 人盲听要排人时间，**W4 一开工就要**。
2. **一致性比对器的阈值校准错了**，所以 `r_redraw` 这个数**不能用**
   （人工说"像"，机器按 6 条锚点逐条打分只给 3/5、4/5；人是整体认的）。
   见 §9.1.3 / §9.1.4。它不挡 W2，但 **W4 做成本表时会回来**：要么重校准，
   要么在文档里直说"机器分不可信，只用人工判读"。
3. **`buildTree` 不校验页数**（实测 `mimo` 返回 7 页、请求 2 页给了 3 页，引擎都收了）。
   小而明确，谁顺手谁修。另外**离线回放的 manifest 不还原 `consistency`**，
   所以离线演示里看不到"未核对/不通过"的 Agent 行为——ADR-0003 的演示路径要靠它。

## 四、三条口径（**别从仓库历史里反推，历史里的措辞已经改过一次**）

1. **模型与密钥由用户自带**（[ADR-0008](../../docs/adr/0008-model-and-key-provided-by-user.md)）。
   不做选型。创作流要有一步让用户填模型名 + API key，拼成**一张 per-request 的 `Env`**
   交给 `createProviders`——`registry.ts` 的 `Env` 就是**参数**，所以引擎不用改一行。
   密钥只在内存里活一次请求：**不落盘、不进日志、不进录制 manifest**。
   顺带一次检查：现有错误消息"真实密钥只写 `.env.local`"是**对开发者说的**，
   用户看到的那句得能指导操作。
2. **TTS 推迟**（见上）。
3. **`tech-selection.md` 里的"定稿"一律读作"默认推荐"**（GLOSSARY 有这条词的定义）。
   判据 2（语感盲评）从闸门降为可选——用户本来就会用自己的模型。

## 五、这个仓库的干活规矩

在仓库里能查到的（**必读**）：根 `CLAUDE.md`（四条硬约束 + 不糊弄 + 三条闸门）、
`docs/commit-convention.md`（提交消息格式）、`README.md` §五（已付过学费的地方，
不是废话，绕过它等于把 bug 重做一遍）。

**只在会话里说过、仓库里没有的四条**：

- **git 由用户自己操作**。写好文件、把命令交出去；不要 `add` / `commit` / `push` /
  `rebase`。这一轮已经有两次未提交的改动被 git 操作清掉过。
- **成本金额不进任何汇报**。该花的调用照花（"预算充足"），但脚本不打印、总结里不写，
  只写"花了多少次调用 / 多少秒"。金额只出现在 `docs/tech-selection.md` 里。
- **不许拿正式跑测当参数探测**。参数在专门的探针脚本里探明白（`scripts/probe-*.mts`），
  正式跑测只跑最后定下来的那一种配置。
- **没测成不许记成测出来**。裁判没到场不能判选手没跑；通过率的分母不含调用失败。
  （这条已写进 README §五，但它是这个项目最容易重犯的错，所以在这里再说一遍。）

技能调用点（checklist §九，看板里有标记）：`ui-ux-pro-max`（设计系统 / 儿童可用性）、
`gsap`（翻页与过程动效）、`tdd`（校验管线）、`grilling`（自审）、
`codebase-design`（seam 与模块边界）、`domain-modeling`（词汇表与 ADR）。

## 六、W2 的第一件事

按 `E:\compete\执行看板.md` 的 W2 一节，**⛔ 不许推迟的是 Agent 事件流架构**
（#2 的 8 分 + #17 的 3 分压在上面）。
[ADR-0004](../../docs/adr/0004-no-vercel-ai-sdk.md) 定了"自写 SSE、不引 Vercel AI SDK"，
并留了一个 **200 行翻案阈值**，写着"首周要确认或推翻"——**从这里开始**。

W2 的产出物是「独读版全链路：创作流 → 生成 → 阅读器」。
按仓库惯例，先写 `.scratch/<slug>/spec.md` 与工单，再动手。
