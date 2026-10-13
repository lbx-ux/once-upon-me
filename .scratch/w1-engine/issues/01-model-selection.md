# 01 · 模型选型对比实测（#1）

Status: claimed（**卡在 .env.local 没有 Key**，harness 已就位）

## 要做什么

照 `docs/tech-selection.md` §12 的协议跑，不另设计一次：

```bash
# 图像：2 候选 × 5 页 = 10 张，预算 2.00 元
node scripts/w1-image-bakeoff.mts --models=wan2.7-image,qwen-image-2.0 --yes=1

# 文本：候选 × 10 本分镜，三档 JSON 约束各测一遍
node scripts/w1-text-bakeoff.mts --models=<候选1>,<候选2>,<候选3> --books=10 --jsonMode=object --yes=1
```

跑之前要先定的两件事：

1. **文本候选名单**。`GET /v1/models` 能列出当前供应商的对话模型（不含图像/视频）。
   按 §9.2 判据 1（结构化输出通过率）先粗筛，再进语感判读。
2. **视觉比对模型**（`VISION_MODEL`）。一致性 Agent 的手；没有可用的就得在
   10/20 明确写"判据 1 只有人工判读，没有机器分对照"。

## 回填位置

| 数字                            | 回填到                                                 |
| ------------------------------- | ------------------------------------------------------ |
| 每候选的 5 页一致性通过率       | `tech-selection.md` §7.2 表 + §7.4                     |
| 单张实付、支持比例、失败原因    | 同上                                                   |
| 参考图字段名与是否生效          | `providers/tokenrhythm-image.ts` 顶部 + `.env.example` |
| LLM 按页/按本通过率、平均重试   | §9.1 表                                                |
| r_redraw（首次通过率 / 重画后） | §10.1 公式的变量表                                     |
| 每本成本                        | §10.3 + README §二                                     |

## Comments

- 10/13：harness 写完，`tsc`/`eslint`/`vitest` 全绿；无 Key 时脚本**拒绝运行**
  （`IMAGE_API_KEY 未配置。横评必须真跑，不接受手工填数`）——这条错误路径实测过。
- 10/13：**没有跑过一次真调用**，所以 §7–§10 的格子现在全是空的。
  不要手工填数。
