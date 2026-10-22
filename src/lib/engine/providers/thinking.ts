/**
 * thinking.ts —— "把思考关掉"的那个字段，**随家而异**（2026-10-21 补）
 *
 * 为什么它值得单独一个文件：这是一个**同一个意思、两种写法**的地方，而写错的代价不对称。
 *
 * | 家 | 关掉思考要发什么 | 出处 |
 * | --- | --- | --- |
 * | 阿里云百炼（qwen 系） | `enable_thinking: false` | 本项目 2026-10-13 实测（`openai-text.ts` 那段：关掉之后 555–847 tokens 就够） |
 * | DeepSeek | `{"thinking": {"type": "disabled"}}` | 官方文档《思考模式》；**它是默认开、effort 默认 high**，所以不发这个字段 = 思考开着 |
 *
 * ★ 第二行那个"默认开"是要紧的：错写字段名不会报错（两家都忽略不认识的字段），
 *   症状是**思考一直开着**——每轮先想几千 token，慢、贵，而且思考模式下 `temperature`
 *   等参数会被静默忽略（DeepSeek 文档原话：设置不报错、也不生效）。
 *   所以判据不是"请求成功了没有"，而是"这一轮有没有 `reasoning_content`"
 *   （`scripts/probe-thinking-budget.mts` 量的是这件事）。
 *
 * ★ 认不出的模型名一律沿用 `enable_thinking: false`：那是换家之前一直在发的形状，
 *   而"换一个没量过的字段名"要有理由。DeepSeek 那个前缀判据窄一点是有意的——
 *   写宽了会把别家也塞进这条分支。
 */

/** 这一家的模型名是不是 DeepSeek。前缀判据，只认 `deepseek-` */
export function isDeepSeek(modelId: string): boolean {
  return /^deepseek-/i.test(modelId.trim())
}

/**
 * 关掉思考的字段。返回的是要**平铺进请求体顶层**的那几个键（两家的写法都是顶层）
 *
 * 只在"策略要求关"时调用它——策略本身（`LLM_THINKING=on/off`）由 `registry.ts` 判，
 * 这里只管"关"这个动作在语法上怎么写。
 */
export function thinkingOffOf(modelId: string): Record<string, unknown> {
  return isDeepSeek(modelId) ? { thinking: { type: 'disabled' } } : { enable_thinking: false }
}

/**
 * 视觉那一路（比对 / 读照片 / 画面审核）关思考的字段。
 *
 * ★ 与上面那个函数的差别只有一处，但理由很硬：**认不出的家一个字段都不发**。
 *
 * | 家 | 发什么 | 为什么 |
 * | --- | --- | --- |
 * | DeepSeek | `{"thinking":{"type":"disabled"}}` | 它的默认是**开**（effort 还是 high），不发 = 每张图都先想一遍 |
 * | 其他 | 不发 | 换到 DeepSeek 之前，视觉这条路上的请求体里没有这个字段——**它一直在正常工作**（kimi-k2.6 那一串实测就是那么来的）。没理由顺手给它加一个没量过的字段 |
 *
 * 所以这不是"两家写法不同"，是"**只有我们知道默认值对我们是错的那一家才要写**"。
 * 写宽了（给所有家都发 `enable_thinking: false`）就等于在 kimi 那条已经量过的路上
 * 换了一个参数，而收益是零。
 */
export function visionThinkingOffOf(modelId: string): Record<string, unknown> {
  return isDeepSeek(modelId) ? thinkingOffOf(modelId) : {}
}
