/**
 * tool-loop.ts —— 带工具的文本调用循环：模型要调工具就调、把结果喂回去、直到它给出答复
 *
 * 这是「Function Calling」在引擎侧的落点。它做四件事，每一件都对应一条判断：
 *
 * 1. **工具是注入的。** 引擎不知道"语料在哪""书架长什么样""红线词库有几条"——
 *    它只调 `ToolDef.run(args)` 拿回一段文本。与 `PlanRetriever`（`plan.ts`）是同一条边界，
 *    所以 `node scripts/engine-run.mts --mode=stub` 加上工具之后仍然不碰网络、不碰盘。
 * 2. **工具抛错不终止整条循环。** 错误原文当 tool result 喂回去，模型自己改。
 *    ★ 但**要发一条 `{kind:'error', fatal:false}` 事件**：不发的话，
 *    屏幕上"模型自己在改"与"什么都没发生"长得一模一样。
 * 3. **步数用完了必须说出来。** 到顶还停不下来，就**不带工具再问一次**，逼它给最终答复——
 *    ★ 不许静默截断。截断的症状是"故事莫名其妙短了半截"，而那是一条没有任何提示的坏法。
 * 4. **模型一次都不调工具直接给答案**是**合法结果**，不是失败。
 *    它只是说明这一次不需要查东西——正是"让模型自己决定要不要查"这句话的意思。
 *
 * ★ 与流式互斥（`TextRequest.tools` 那段）：工具循环要的是**完整回包**，
 *   而增量与 `tool_calls` 的分片拼装是两件都不简单的事。两条都是显式分支，
 *   没有"传了但被忽略"那种中间状态。
 */

import type {
  ChatMessage,
  TextGenerator,
  TextRequest,
  ToolCall,
  ToolSpec,
} from './providers/types.ts'
import type { EngineEventPayload } from './events.ts'

/**
 * 一条工具。`spec` 是给模型看的，`run` 是真的去做。
 *
 * ★ 两者放在一起是刻意的：`spec.parameters`（模型照着它写参数）与 `run` 里
 *   那套校验**必须同源**。分成两处注册的那天起，就会出现"schema 说 k 是整数、
 *   而 run 收的其实是字符串"这种只在模型写错时才暴露的漂移。
 * ★ `run` 的入参是**已经解析过的** `unknown`（可能是任何形状）——校验在 `run` 里做，
 *   做不过就抛，抛出来的那句话会原样喂回给模型（见文件头第 2 条），
 *   所以它要写成"你哪里写错了、该写什么"。
 */
export type ToolDef = {
  spec: ToolSpec
  run: (args: unknown) => Promise<string> | string
}

export type ToolLoopRequest = Omit<TextRequest, 'tools' | 'toolChoice' | 'messages'> & {
  system: string
  user: string
}

export type ToolLoopOptions = {
  text: TextGenerator
  tools: readonly ToolDef[]
  /**
   * 含首次在内的最大**工具轮数**。缺省 4。
   *
   * ★ 4 是"够用就好"而不是"尽量多"：每一轮都是一次真金白银的文本调用，
   *   而规划那一步要的是**一次回答**（一张故事表），工具只是它写之前查几步。
   *   查询次数多的场景（几百本书之后）该换的是检索质量，不是把上限抬高。
   */
  maxSteps?: number
  /** 一次工具调用之后的间隙里发什么出去。**同步调用**，不 await（事件是同步协议） */
  emit?: (payload: EngineEventPayload) => void
  /** 这一次的墙上时间从哪儿算。缺省 `Date.now`（测试要能钉住） */
  now?: () => number
}

export type ToolLoopOutcome = {
  /** 模型给的那段最终答复（规划那一步要的就是它——一张完整的故事表） */
  text: string
  modelId: string
  /** 一共调了几次工具（判据 7 的第三臂要报这个数） */
  toolCalls: number
  /** 实际用了几轮。1 = 一次都没调工具 */
  steps: number
  /** 每一次工具调用的名字与成败，按顺序。**失败也留着**（那是判据，不是噪音） */
  trail: readonly { name: string; ok: boolean; ms: number }[]
}

export async function completeWithTools(
  request: ToolLoopRequest,
  options: ToolLoopOptions,
): Promise<ToolLoopOutcome> {
  const maxSteps = options.maxSteps ?? 4
  const now = options.now ?? (() => Date.now())
  const byName = new Map(options.tools.map((one) => [one.spec.name, one]))
  const specs = options.tools.map((one) => one.spec)

  const messages: ChatMessage[] = [
    ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
    { role: 'user', content: request.user },
  ]

  const trail: { name: string; ok: boolean; ms: number }[] = []
  let modelId = options.text.modelId
  let steps = 0

  for (let step = 1; step <= maxSteps + 1; step += 1) {
    /**
     * 最后一轮（`step === maxSteps + 1`）**不带工具**：到顶还停不下来的话，
     * 我们要的是"它把手上知道的说完"，而不是"再查一次"。
     * 这一条就是文件头第 3 条——**说得出"我没查完"比静默截断好**。
     */
    const lastChance = step > maxSteps
    steps = step

    const response = await options.text.complete({
      ...baseOf(request),
      messages,
      ...(lastChance ? {} : { tools: specs, toolChoice: 'auto' as const }),
    })
    modelId = response.modelId
    const calls = response.toolCalls ?? []

    /**
     * ★ 最后一轮**仍然**要调工具：正常不该发生（这一轮请求里根本没有 `tools`），
     *   但一个坏掉的网关或一个很倔的模型做得到。
     *
     * 处置是**带着它已经写出来的东西往下走 + 发一条非致命 error**，
     * 而**不是抛**：抛出去会把"模型有点怪"升级成整步崩溃，
     * 而下游（`plan.ts` 的 schema 校验）本来就会把"文本不是一张合法故事表"
     * 说得清清楚楚——那才是有用的那句话。
     * ★ 也**不能静默**：不发这条事件的话，现场是"故事莫名其妙短了/空了"，
     *   而没有任何东西提示"工具把预算用完了"。
     */
    if (lastChance && calls.length > 0) {
      options.emit?.({
        kind: 'error',
        stage: 'planning',
        code: 'tool-budget-exhausted',
        message:
          `工具用到第 ${maxSteps} 轮上限了（这一轮已经不带工具），模型还在要求调工具。` +
          '先拿它已经写出来的部分往下走。',
        fatal: false,
      })
      return { text: response.text, modelId, toolCalls: trail.length, steps, trail }
    }

    if (calls.length === 0) {
      return { text: response.text, modelId, toolCalls: trail.length, steps, trail }
    }

    messages.push({
      role: 'assistant',
      content: response.text === '' ? null : response.text,
      toolCalls: calls,
    })
    for (const call of calls) {
      const outcome = await runOne(call, byName, options, now)
      trail.push({ name: call.name, ok: outcome.ok, ms: outcome.ms })
      messages.push({ role: 'tool', toolCallId: call.id, content: outcome.text })
    }
  }

  /**
   * 走到这里在类型上不可能（最后一轮不带工具，所以必然 `return`）。
   * 留着它是为了**未来改循环时不会静默返回一个空串**：那会被下游读成
   * "模型给了一张空的故事表"，而真正的成因是这里漏了一个分支。
   */
  throw new Error('工具循环跑完了却没拿到最终答复——这是 tool-loop.ts 的分支漏了')
}

/* ───────────────────────── 一次工具调用 ───────────────────────── */

async function runOne(
  call: ToolCall,
  byName: ReadonlyMap<string, ToolDef>,
  options: ToolLoopOptions,
  now: () => number,
): Promise<{ ok: boolean; ms: number; text: string }> {
  const startedAt = now()
  const tool = byName.get(call.name)

  /** 不认识的工具名：**不是崩溃**，是"模型编了一个名字"——喂回去让它自己改 */
  if (!tool) {
    const ms = now() - startedAt
    const text = `没有「${call.name}」这个工具。可用的是：${[...byName.keys()].join('、')}`
    options.emit?.({ kind: 'tool', name: call.name, ok: false, ms, note: text })
    options.emit?.({
      kind: 'error',
      stage: 'planning',
      code: 'tool-not-found',
      message: text,
      fatal: false,
    })
    return { ok: false, ms, text }
  }

  let args: unknown
  try {
    // ★ 模型写坏 JSON 是常态（缺引号、多一个逗号），所以**解析失败走的是同一条
    //   "喂回去"的路**，而不是抛出去把整条循环带走。
    //   空串要当 `{}`：有的网关在没有参数时回一个空串，而那是合法的调用。
    args = call.argumentsJson.trim() === '' ? {} : JSON.parse(call.argumentsJson)
  } catch (err) {
    const ms = now() - startedAt
    const text =
      `你给的参数不是合法 JSON（${err instanceof Error ? err.message : String(err)}）。` +
      `原样是：${call.argumentsJson.slice(0, 200)}`
    options.emit?.({ kind: 'tool', name: call.name, ok: false, ms, note: text })
    options.emit?.({
      kind: 'error',
      stage: 'planning',
      code: 'tool-args-invalid',
      message: text,
      fatal: false,
    })
    return { ok: false, ms, text }
  }

  try {
    const text = await tool.run(args)
    const ms = now() - startedAt
    options.emit?.({ kind: 'tool', name: call.name, ok: true, ms })
    return { ok: true, ms, text }
  } catch (err) {
    const ms = now() - startedAt
    // ★ 错误原文喂回去（文件头第 2 条）。`EngineError.message` 是人话，
    //   而工具的作者被要求把它写成"你哪里写错了、该写什么"（见 `ToolDef.run`）。
    const text = `${call.name} 没跑成：${err instanceof Error ? err.message : String(err)}`
    options.emit?.({ kind: 'tool', name: call.name, ok: false, ms, note: text })
    options.emit?.({
      kind: 'error',
      stage: 'planning',
      code: 'tool-failed',
      message: text,
      fatal: false,
    })
    return { ok: false, ms, text }
  }
}

/**
 * 请求里除了 `system` / `user` / `messages` / `tools` 之外那些（schema、温度、预算）
 * 原样带过去。
 *
 * ★ 返回值里**不含 `system` / `user`**：带工具那条路把它们拼进了 `messages`。
 *   留下的话，`payloadOf` 里那条 `req.messages ? … : system+user` 仍然是 messages 赢，
 *   但读代码的人会以为两个都在起作用——一处"看起来有效的死字段"最费时间。
 */
function baseOf(
  request: ToolLoopRequest,
): Omit<TextRequest, 'system' | 'user' | 'messages' | 'tools' | 'toolChoice'> {
  // ★ 用 delete 而不是解构丢弃：解构会留下两个"赋值了从不读"的变量，
  //   而 eslint 会为它们报两条 no-unused-vars——**闸门红了，理由却是风格**。
  //   （`_` 前缀在这一版配置里不豁免，这一点是实测的。）
  const rest: Record<string, unknown> = { ...request }
  delete rest['system']
  delete rest['user']
  return rest as Omit<TextRequest, 'system' | 'user' | 'messages' | 'tools' | 'toolChoice'>
}
