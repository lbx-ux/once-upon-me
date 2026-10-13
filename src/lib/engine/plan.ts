/**
 * plan.ts —— ② 故事规划（结构化输出 + 校验 + 带反馈的重试）
 *
 * 这条流水线是 #1「大模型集成质量」的主体，也是 §9.2 判据 1 的测量对象。
 * 三件事必须在这一层做对，缺一个通过率就会莫名偏低：
 *
 * 1. **校验与树形检查分开报**。Schema 管形状（字段在不在、长度对不对），
 *    tree.ts 管语义（分支数、父子引用、形态约束）。混在一起，
 *    重试提示就会说"格式不对"，而模型上一轮其实是格式全对、分支少了一条。
 * 2. **重试必须带上具体问题**（`formatFailures` / TreeProblem 清单）。
 *    原样重发一次是拿钱换同样的输出。
 * 3. **重试次数是产出数据，不是内部细节**。它回填报价表 §10.1 的 N_plan，
 *    也是"这批候选里谁的结构化输出最稳"的直接证据。所以它随结果返回。
 */

import {
  STORY_PLAN_VERSION,
  storyPlanSystem,
  storyPlanUser,
  type StoryPlanInput,
} from '../prompts/story-plan.ts'
import { asPlanDraft, planDraftCodec, planJsonSchema } from '../schemas/story.ts'
import { formatFailures, parseWith } from '../schemas/schema.ts'
import { EngineError } from './errors.ts'
import type { BookForm, StoryTree } from './domain.ts'
import { buildTree, type TreeProblem } from './tree.ts'
import type { EngineEventPayload } from './events.ts'
import type { TextGenerator } from './providers/types.ts'

export type PlanOutcome = {
  tree: StoryTree
  /** 第几次调用才成功。1 = 一次过，是判据 1 的原始数据 */
  attempts: number
  /** 每一次的失败原因，横评表要逐条列 */
  failures: readonly string[]
  modelId: string
  promptVersion: string
}

export type PlanOptions = {
  text: TextGenerator
  form: BookForm
  /** 含首次在内的最大次数。默认 3：两次带反馈的重试足够暴露"这家不会出 JSON" */
  maxAttempts?: number
  /**
   * 覆盖生成器的 token 预算。**通常不传**——留着它是给"同一家模型换个档"用的，
   * 常规路径上预算由适配器按模型决定。
   */
  maxTokens?: number
  emit: (payload: EngineEventPayload) => void
}

export async function planStory(input: StoryPlanInput, opts: PlanOptions): Promise<PlanOutcome> {
  const maxAttempts = opts.maxAttempts ?? 3
  const failures: string[] = []
  const baseUser = storyPlanUser(input)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    opts.emit({ kind: 'stage', stage: 'planning', phase: 'begin', attempt, total: maxAttempts })

    const response = await opts.text.complete({
      system: storyPlanSystem(),
      // 第二次起，把上一轮的具体问题贴回去。这是通过率的决定因素之一
      user: attempt === 1 ? baseUser : withFeedback(baseUser, failures),
      jsonSchema: planJsonSchema(),
      temperature: 0.8,
      // ★ 这里**不给** maxTokens：预算随模型走，不随阶段走。
      //   写死在规划阶段的那版是 4096，而实测思考模型会把这个数整条花在思考链上、
      //   正文一个字都不写（见 openai-text.ts 的 DEFAULT_TEXT_MAX_TOKENS）。
      //   谁最清楚该给多少？适配器——它知道自己在跟哪个模型说话。
      maxTokens: opts.maxTokens,
    })

    const draft = parseWith(planDraftCodec, response.text)
    if (!draft.ok) {
      const message = `第 ${attempt} 次：Schema 校验未过\n${formatFailures(draft.failures)}`
      failures.push(message)
      opts.emit({
        kind: 'retry',
        stage: 'planning',
        attempt,
        maxAttempts,
        reason: `故事表格式不对（${draft.failures.length} 处）`,
      })
      continue
    }

    const plan = asPlanDraft(draft.value)
    const built = buildTree(opts.form, plan.title, plan.nodes)
    if (!built.ok) {
      const message = `第 ${attempt} 次：树形不合法\n${formatProblems(built.problems)}`
      failures.push(message)
      opts.emit({
        kind: 'retry',
        stage: 'planning',
        attempt,
        maxAttempts,
        reason: `故事结构不对（${built.problems.length} 处）`,
      })
      continue
    }

    opts.emit({
      kind: 'plan-ready',
      stage: 'planning',
      form: built.tree.form,
      title: built.tree.title,
      nodeCount: built.tree.nodes.length,
      choicePages: built.tree.nodes.filter((node) => node.choice).map((node) => node.pageNo),
    })
    return {
      tree: built.tree,
      attempts: attempt,
      failures,
      modelId: response.modelId,
      promptVersion: STORY_PLAN_VERSION,
    }
  }

  throw new EngineError(
    'schema-validation-failed',
    `${maxAttempts} 次规划都没能产出合法的故事表：\n${failures.join('\n')}`,
    {
      detail: failures,
    },
  )
}

function withFeedback(user: string, failures: readonly string[]): string {
  return [
    user,
    '',
    '【上一次你的输出不合格，问题如下——只改这些问题，别重写整个故事】',
    failures[failures.length - 1] ?? '',
    '只输出 JSON。不要解释，不要围栏之外的任何字。',
  ].join('\n')
}

function formatProblems(problems: readonly TreeProblem[]): string {
  return problems
    .slice(0, 8)
    .map((problem) => `- 第 ${problem.index || '?'} 页：${problem.message}`)
    .join('\n')
}
