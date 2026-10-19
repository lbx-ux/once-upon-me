/**
 * openai-text.ts —— OpenAI 兼容的对话补全适配器
 *
 * 一个适配器覆盖一整类供应商：tokenrhythm 的对话模型、DeepSeek、通义千问、豆包、
 * 智谱、Kimi 都走 `POST {base}/chat/completions`，**只有 base、key、model 三个值不同**。
 * 所以模型名一律从环境变量来（registry.ts），本文件里不出现任何具体模型 id。
 *
 * 为什么不用各家 SDK（ADR-0002 / ADR-0004）：横评要求同一套提示词在候选之间跑，
 * 接口不统一就得写三份胶水；而"统一"这件事在这里 20 行 HTTP 就完成了。
 */

import { EngineError } from '../errors.ts'
import type {
  CallBudget,
  ChatMessage,
  StreamBudget,
  TextDelta,
  TextGenerator,
  TextRequest,
  TextResponse,
  ToolCall,
} from './types.ts'
import { findFirst, requestJson, requestSse, traceOf, type HttpDeps } from './http.ts'

export type OpenAiTextOptions = {
  /** 强制 JSON 输出的方式。见下面 jsonShape() 的注释 */
  jsonMode?: 'none' | 'object' | 'schema'
  /** 调用方没指定时用哪个 token 预算。**预算随模型走，不随阶段走**，见下面注释 */
  defaultMaxTokens?: number
  /** 供应商特有的额外字段（各家参数名不一致时在这里补，不改接口） */
  extra?: Record<string, unknown>
}

/**
 * 一次文本生成的缺省超时。180s 是**给一整张故事表**的预算，不是给一句话的。
 * 它挡住的是"把慢误判成不会"这一类错——真要压到更低，得先有实测的 P95 时延。
 */
const DEFAULT_TEXT_TIMEOUT_MS = 180_000

/**
 * 缺省 token 预算。4096 是**规划阶段的输出形状**决定的（一张 6–20 页的故事表），
 * 不是随便取的，但它是**下界而不是够用线**：
 *
 * 实测（`scripts/probe-thinking-budget.mts`，同一 prompt 只改参数，2026-10-13）——
 * 思考模型会把这个预算整条吃光，正文一个字都不写：
 *
 * ```
 * qwen3.8-max   预算 4096 → 正文 0 字符，思考 9072 字符，finish_reason=length
 * qwen3.8-flash 预算 4096 → 正文 0 字符，思考 9407 字符，finish_reason=length
 * glm-5.3-flash 预算 4096 → 正文键都不存在，思考 10552 字符，finish_reason=length
 * ```
 *
 * 所以"预算"是**模型的属性**：思考模型要么给到 16000（实测 5373–7417 tokens 才写完），
 * 要么关掉思考（`enable_thinking:false`，实测 555–847 tokens 就够，便宜 5–7 倍）。
 * 这两条都由 `.env.local` 的 `LLM_MAX_TOKENS` / `LLM_THINKING` 决定，
 * 不写在规划阶段里——写在那里就等于把一个模型参数钉死成一个产品参数。
 */
const DEFAULT_TEXT_MAX_TOKENS = 4096

export function createOpenAiText(
  deps: HttpDeps,
  modelId: string,
  opts: OpenAiTextOptions = {},
): TextGenerator {
  const jsonMode = opts.jsonMode ?? 'object'

  /**
   * 请求体。`stream` 是唯一的差别——**同一份构造**，不是抄一遍。
   *
   * ★ 抄一遍的代价是具体的：将来给 chat 请求加一个字段（比如关思考的 `enable_thinking`），
   *   改了一条路忘了另一条，症状是"流式与全量拿到的结果不一样"，
   *   而这正是 07 §一.1 要钉死的那件事。
   */
  const payloadOf = (req: TextRequest, stream: boolean): Record<string, unknown> => {
    // ★ 两条路**分开**，不是"把 system/user 也塞进 messages"：
    //   后者会改掉今天每一条路的请求体，而工单 06 的判据 8 是
    //   "不传 tools 时请求体逐字节等于今天"。`req.messages` 只有带工具那条路会给。
    const messages: unknown[] = req.messages
      ? req.messages.map(wireMessage)
      : [
          ...(req.system ? [{ role: 'system', content: req.system }] : []),
          { role: 'user', content: req.user },
        ]
    return {
      model: modelId,
      messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? opts.defaultMaxTokens ?? DEFAULT_TEXT_MAX_TOKENS,
      // ★ `plainText` 这一条走前面：要纯文本的调用**一个 JSON 相关字段都不带**。
      //   理由与实测的 400 写在 `TextRequest.plainText` 上——不是本节流，是那个参数
      //   本来就不该出现在"把一句话改好"这种调用里
      ...(req.plainText ? {} : jsonShape(jsonMode, req.jsonSchema)),
      // ★ `tools` 只在真给了的时候出现。`tool_choice` 只发 `auto` / `none`——
      //   "强制点名"这一档**不可依赖**（实测十次里七次 400，见 `TextRequest.toolChoice`），
      //   所以这一层不提供它，调用方也就写不出那句请求。
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((one) => ({
              type: 'function',
              function: {
                name: one.name,
                description: one.description,
                parameters: one.parameters,
              },
            })),
            ...(req.toolChoice && req.toolChoice !== 'auto' ? { tool_choice: req.toolChoice } : {}),
            /**
             * ★ **一轮只许回一个工具调用**（2026-10-19，被三臂对照量出来的）。
             *
             * `tool-loop.ts` 的 `maxSteps` 管的是**轮数**，不是**调用次数**——
             * 一轮里回三个工具调用，账面上是"走了 1 步、调了 3 次"。
             * 实测就是这么发生的：`--arms=tools` 那一轮平均每本调了 **4.8** 次，
             * 而轮数上限是 4。**4.8 > 4 只可能是并行调用**，
             * 也就是说"步数预算"在那条路上根本没有它看起来那么严。
             * （探针的格 H 已经打过这个参数：`parallel_tool_calls:false` 回 200 且照常调工具。）
             */
            parallel_tool_calls: false,
          }
        : {}),
      ...(opts.extra ?? {}),
      ...(stream ? { stream: true } : {}),
    }
  }

  const requireKey = (): void => {
    if (!deps.apiKey) {
      throw new EngineError('provider-not-configured', 'LLM_API_KEY 未配置，文本能力不可用')
    }
  }

  return {
    id: `openai-text(${modelId})`,
    modelId,
    async complete(req: TextRequest, budget?: CallBudget): Promise<TextResponse> {
      requireKey()

      const body = await requestJson(deps, {
        method: 'POST',
        path: '/chat/completions',
        body: payloadOf(req, false),
        signal: budget?.signal,
        // ★ 文本的缺省超时**不是** http.ts 那个 60s。两者量的是不同的东西：
        //   图像是同步出图（十几秒），文本是**生成一整张故事表**。实测 60s
        //   读不完 max 档的输出，而超时在这里最坏的后果不是慢——是它会被
        //   读成"这家不会出 JSON"，正式跑测里三个候选就这么变成了 0/10。
        //   优先级仍然是"调用级 > deps（.env 的 LLM_TIMEOUT_MS）> 本条缺省"。
        timeoutMs: budget?.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS,
      })

      const message = messageObject(body)
      // ★ 先定位 `message` 再读它的 `content`，**不是**直接 findFirst(body, ['content'])：
      //   findFirst 会跳过空串继续往深处翻，正文是 '' 时它会翻到别的同名键上
      //   （回包里回显的请求、provider_specific_fields 都可能有 content），
      //   于是"读不到"变成"读到别人的"——那比读不到更难查。
      const contentValue = message ? message['content'] : findFirst(body, ['content'])
      const text = flattenContent(contentValue)
      // ★ 从**同一个 `message` 对象**上读工具调用，理由与上面那段读 content 的注释
      //   完全相同：不回退到 `findFirst(body, ['tool_calls'])`，
      //   那会翻到回显的请求体里那份同名键上——"读不到"变成"读到别人的"。
      const toolCalls = toolCallsOf(message)

      /**
       * ★★ 空正文**只在它真的该有正文时**才算失败（2026-10-19 修的）。
       *
       * 实测的现场：模型决定调工具时，回包是
       * `finish_reason: 'tool_calls'`、`content: ''`——**那是正常回包**，
       * 而这一行原来无条件把空正文当失败抛掉，于是"模型要调工具"这件事
       * 在适配器这一层就被误判成"供应商回了个空壳"。
       *
       * 抓到它的地方值得记一笔：`probe-tool-calls.mts` 的 A 格早就打过
       * 「调了工具 · **正文 0 字**」，而那一行读数当时只被当成"工具调用长这样"，
       * 没被当成"空正文"。**证明它是个 bug 的是三臂对照的第三臂**：
       * `tools` 那一臂上有一本直接 `call-failed`，报的正是
       * 「回包里没有正文（content=string(0)，finish_reason=tool_calls）」。
       * ——"探针报了一个数"与"那个数意味着什么"之间隔着一整个下游，这一条就是那一步。
       */
      if (text === '' && toolCalls.length === 0) {
        throw new EngineError('provider-call-failed', explainEmptyContent(body, message), {
          traceId: traceOf(body) || undefined,
          detail: body,
        })
      }
      return {
        text,
        modelId: String(findFirst(body, ['model']) ?? modelId),
        usage: usageOf(body),
        traceId: traceOf(body) || undefined,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      }
    },

    /**
     * 流式（工单 07）。回的那份 `TextResponse` 与 `complete()` 是同一个形状，
     * 差别只在"正文是一段段到的"——**这一条有测试钉住**（同一份录制响应两条路径逐字段相等）。
     *
     * 两处刻意的处理：
     *
     * 1. **`reasoning_content` 一个字都不往外发**。思考模型的思考链不是正文，
     *    把它当正文喂给界面，家长看到的是"这本书正在写一段看不懂的推理"。
     *    所以只累计它的长度，用来在"一个正文都没等到"时说清原因。
     *    ★ 这条不是假想：实测里有那么一次，模型连发 9202 字思考链、正文 0 字，
     *    而我们给出的报错正是「正文预算被思考吃掉了」。
     *    ★ 代价要一起写在这里：那种情况下界面会**安静一分钟上下**（我们的 delta 一次不响），
     *    所以故事板必须有"正在编故事"这一态——**不能拿"有没有新字"当它还活着的判据**。
     * 2. **不看 `finish_reason` 就收工**：以 `[DONE]`（或流自然结束）为准。
     *    有的网关最后一帧没有 `finish_reason`，拿它当收工信号会永久挂住。
     * 3. **不送 `stream_options: {include_usage: true}`**：实测这一家不送也回 usage
     *    （`{"promptTokens":833,"completionTokens":479}`），而"送一个某些网关会拒的字段"
     *    有过前车之鉴（图像接口上 7 个未知字段全被 400 挡回）。
     *    拿不到 usage 时按接口约定**不填**，不填一个看起来合理的数。
     */
    async stream(
      req: TextRequest,
      budget: StreamBudget | undefined,
      onDelta: (delta: TextDelta) => void,
    ): Promise<TextResponse> {
      requireKey()
      // ★ 带工具与流式**互斥**，当场抛（见 `TextRequest.tools` 那段）：
      //   静默忽略 `tools` 的话，调用方以为自己拿到的是工具那一路的结果，
      //   而实际上模型连工具都没看见——两边的差别要到很久以后才看得出来。
      if (req.tools && req.tools.length > 0) {
        throw new EngineError(
          'invalid-request',
          'stream() 不支持 tools：带工具那一档走 complete()（工具循环要的是完整回包，不是增量）',
        )
      }
      let text = ''
      let reasoningLength = 0
      let seenModel = modelId
      let usage: TextResponse['usage']
      let traceId = ''

      for await (const data of requestSse(deps, {
        method: 'POST',
        path: '/chat/completions',
        body: payloadOf(req, true),
        signal: budget?.signal,
        // 总超时与 complete 同一个量级（都是"这一次调用最多花多久"）；
        // 空闲超时是另一条线，见 http.ts 的 DEFAULT_SSE_IDLE_TIMEOUT_MS
        timeoutMs: budget?.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS,
        ...(budget?.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: budget.idleTimeoutMs }),
      })) {
        let chunk: unknown
        try {
          chunk = JSON.parse(data) as unknown
        } catch {
          // 解析不了的一帧不致命：心跳、厂商自定义扩展都会长这样。但也不静默——
          // 计数留给下面的报错消息（正文一直为空时，这是唯一的线索）
          continue
        }
        const delta = deltaObject(chunk)
        const piece = delta ? flattenContent(delta['content']) : ''
        if (piece !== '') {
          text += piece
          onDelta({ text: piece, streamed: true })
        }
        if (delta) {
          const reasoning = delta['reasoning_content']
          if (typeof reasoning === 'string') reasoningLength += reasoning.length
        }
        const modelHit = findFirst(chunk, ['model'])
        if (typeof modelHit === 'string' && modelHit !== '') seenModel = modelHit
        usage = usageOf(chunk) ?? usage
        traceId = traceOf(chunk) || traceId
      }

      if (text === '') {
        throw new EngineError(
          'provider-call-failed',
          reasoningLength > 0
            ? `这一轮流式一个正文字符都没等到（reasoning_content=${reasoningLength} 字符）。` +
                `正文预算被思考吃掉了——调大 maxTokens 或换一家（与 complete() 同一条判据）`
            : '这一轮流式没有回任何 `delta.content`。回包结构可能变了，或者这家不支持 stream',
          { traceId: traceId || undefined },
        )
      }
      return {
        text,
        modelId: seenModel,
        ...(usage ? { usage } : {}),
        ...(traceId ? { traceId } : {}),
      }
    },
  }
}

/**
 * 找到流式帧里的 `delta` 对象。
 *
 * ★ 与 `messageObject` 分开写而不是参数化：`complete` 找的是 `message`、
 *   流式找的是 `delta`，两个键名不一样、位置也可能不一样。
 *   合成一个"找 message 或 delta"的函数，读的人得先在脑子里把两种情况展开——
 *   而这两个函数各自只有十行。
 */
function deltaObject(chunk: unknown): Record<string, unknown> | null {
  const walk = (obj: unknown): Record<string, unknown> | null => {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const hit = walk(item)
        if (hit) return hit
      }
      return null
    }
    if (obj && typeof obj === 'object') {
      const record = obj as Record<string, unknown>
      const delta = record['delta']
      if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
        return delta as Record<string, unknown>
      }
      for (const value of Object.values(record)) {
        const hit = walk(value)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(chunk)
}

/**
 * 一条 `ChatMessage` → 请求体里那一行。
 *
 * ★ 单独一个函数而不是在 `payloadOf` 里内联：**这里错一个字段名，坏法是静默的**
 *   （网关多半只会回一句 400 说"消息格式不对"，而不说是哪一条）。
 *   三处是按 OpenAI 的线格式写的，别按我们内部的名字猜：
 *   `tool_calls[].function.arguments` 是**字符串**、`role:'tool'` 那条带的是
 *   `tool_call_id`（下划线，不是 camelCase）、而 assistant 那条在调工具时
 *   `content` 可以是 `null`。
 */
function wireMessage(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case 'system':
    case 'user':
      return { role: message.role, content: message.content }
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.argumentsJson },
              })),
            }
          : {}),
      }
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
}

/**
 * 回包里的 `tool_calls`。**只从已经定位到的那个 `message` 上读**，
 * 不做深度搜索——理由与 `complete()` 里读 `content` 的那段完全相同。
 *
 * ★ 缺 `id` / 缺 `name` 的那些**丢掉**：留着它们的话，下一轮回填时
 *   `tool_call_id` 会是一个空串，而网关对"回一个不存在的 tool_call_id"
 *   的反应通常是整条请求 400——一次本来只是"某个字段缺了"的小事，
 *   会被放大成"这一轮全废"。
 */
function toolCallsOf(message: Record<string, unknown> | null): ToolCall[] {
  const raw = message?.['tool_calls']
  if (!Array.isArray(raw)) return []
  const calls: ToolCall[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const fn = record['function']
    const fnRecord =
      fn && typeof fn === 'object' && !Array.isArray(fn) ? (fn as Record<string, unknown>) : {}
    const id = typeof record['id'] === 'string' ? record['id'] : ''
    const name = typeof fnRecord['name'] === 'string' ? fnRecord['name'] : ''
    if (id === '' || name === '') continue
    const args = fnRecord['arguments']
    calls.push({
      id,
      name,
      // 有的网关把 arguments 直接回成一个对象（不合规但确实有）。这里照实转成字符串，
      // 让 `tool-loop.ts` 那一处解析是**唯一**一处——两处解析就会有两种坏法。
      argumentsJson: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
    })
  }
  return calls
}

/**
 * JSON 约束的三档，**默认 `object`**，这是实测决定的：
 *
 * - `none` 什么都不加，靠 prompt 里的 schema 文本 + 我们自己的校验（判据 1 测的就是这条路的通过率）
 * - `object` `response_format: {type:'json_object'}`，OpenAI 兼容层的最大公约数
 * - `schema` 再加 `json_schema` 严格模式。**各家支持度不一致**，所以它必须显式打开，
 *   不能默认——默认了就会在"这家不支持"时静默退回 none，而横评报告里写的却是强制模式。
 *
 * 横评（scripts/w1-text-bakeoff.mts）要按档分别测，档位是判据的一部分，不是实现细节。
 */
function jsonShape(mode: 'none' | 'object' | 'schema', schema: unknown): Record<string, unknown> {
  if (mode === 'none') return {}
  if (mode === 'object') return { response_format: { type: 'json_object' } }
  if (!schema) return { response_format: { type: 'json_object' } }
  return {
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'story_plan', strict: true, schema },
    },
  }
}

/**
 * 找到回包里的 `message` 对象（哪一层都行：`choices[0].message` 是常规位置，
 * 但这一层存在的意义就是容忍各家把它挪走）。
 *
 * 找到之后**从它身上读 content**，而不是继续深度搜索同名键——理由见 complete() 里的注释。
 */
function messageObject(body: unknown): Record<string, unknown> | null {
  const walk = (obj: unknown): Record<string, unknown> | null => {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const hit = walk(item)
        if (hit) return hit
      }
      return null
    }
    if (obj && typeof obj === 'object') {
      const record = obj as Record<string, unknown>
      const message = record['message']
      if (message && typeof message === 'object' && !Array.isArray(message)) {
        return message as Record<string, unknown>
      }
      for (const value of Object.values(record)) {
        const hit = walk(value)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(body)
}

/**
 * 正文取成字符串。多段正文（`content: [{type:'text',text:'…'}]`，部分供应商的默认形状）
 * 在这里拼起来——**这是我们该做的事，不是模型的毛病**，所以它不报错。
 */
function flattenContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) =>
        part && typeof part === 'object' ? (part as Record<string, unknown>)['text'] : part,
      )
      .filter((part): part is string => typeof part === 'string')
      .join('')
  }
  return ''
}

/**
 * 正文为空时，**把"为什么"说出来**。原来这里只报一句「文本响应里没有 content」，
 * 于是「我的适配器不会读」「这家在 max_tokens 内没写完」「回包结构变了」
 * 三种情况的处置完全不同，报告上却是同一行字。
 *
 * 实测依据见 `scripts/probe-chat-shape.mts`：短提示词下四家都能正常返回
 * `content`（string，`finish_reason=stop`），所以正式跑测里出现的空正文
 * 一定另有原因——**思考预算**是头号嫌疑（思考模型同时带 `reasoning_content`）。
 */
function explainEmptyContent(body: unknown, message: Record<string, unknown> | null): string {
  const finishReason = String(findFirst(body, ['finish_reason']) ?? '')
  const reasoning = message ? findFirst(message, ['reasoning_content']) : null
  const reasoningLength = typeof reasoning === 'string' ? reasoning.length : 0
  const contentShape = message
    ? 'content' in message
      ? describeValue(message['content'])
      : '**键不存在**'
    : '找不到 message'
  const detail = `content=${contentShape}，finish_reason=${finishReason || '—'}，reasoning_content=${reasoningLength} 字符`
  // ★ `finish_reason: 'tool_calls'` 且正文为空**已经不算失败了**（调用处那段注释）——
  //   走到这里说明连 `tool_calls` 也没有，那才是真的"回了个空壳"。
  //   这一句仍然留着，是为了让排障的人一眼看出"这一家连工具调用都没回"。
  if (finishReason === 'tool_calls') {
    return `这家说 finish_reason=tool_calls，但回包里既没有正文也没有 tool_calls（${detail}）`
  }
  if (finishReason === 'length' || reasoningLength > 0) {
    return `这家在 max_tokens 之内没写出正文（${detail}）。正文预算被思考吃掉了——调大 maxTokens 或换一家`
  }
  return `回包里没有正文（${detail}）。回包结构可能变了，拿 traceId 找平台`
}

/** 类型 + 长度，不回显正文（正文可能有几十 KB，塞进错误消息里会淹没真正的信息） */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `string(${value.length})`
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === 'object') return `object{${Object.keys(value as object).join(',')}}`
  return typeof value
}

function usageOf(body: unknown): TextResponse['usage'] | undefined {
  const raw = findFirst(body, ['usage'])
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const prompt = record['prompt_tokens'] ?? record['input_tokens']
  const completion = record['completion_tokens'] ?? record['output_tokens']
  if (typeof prompt !== 'number' && typeof completion !== 'number') return undefined
  return {
    promptTokens: typeof prompt === 'number' ? prompt : undefined,
    completionTokens: typeof completion === 'number' ? completion : undefined,
  }
}
