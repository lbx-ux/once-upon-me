/**
 * providers/types.ts —— 能力接口（"能力适配层"里的那一层接口）。
 *
 * 三条约定，每条都有理由，改之前先读完：
 *
 * 1. 按能力命名，不按供应商命名（ADR-0002）。所以这里没有 `openai` 也没有 `wan`，
 *    只有"生成图像""比对图像""合成语音"。换供应商只改 `.env.local` 的值与一个适配器文件。
 * 2. 图像返回字节，不返回 URL。供应商的媒体地址约 1 小时过期（`E:\compete\模型.md` §7），
 *    把 URL 放进接口就等于把"记得及时下载"变成一个将来会忘的纪律。下载这一步在适配器
 *    内部完成，接口上不存在这个坑。
 * 3. 生命周期方法是一等公民。`VoiceSynthesizer.release` 不是可选扩展：隐私设计承诺了
 *    "删孩子 → 解绑 voice_id"，接口里没有它，实现时就会"临时开个后门直接调 SDK"
 *    ——那条正是 ADR-0002 点名的失效模式。
 *
 * 接口都带 `id`：报错、日志、provenance 都要说得出"这次用的是哪个实现、哪个模型"。
 * 模型 id 一律来自环境变量，不写死（见 registry.ts）。
 */

import type { AssetRef, Mood } from '../domain.ts'

/** 一次调用的公共预算控制。超时不重试：异步任务可能已在服务端建单，盲目重试会重复扣费 */
export type CallBudget = {
  timeoutMs?: number
  signal?: AbortSignal
}

/* 工具调用（Function Calling） */

/**
 * 一个工具的对外那一份（给模型看的就是它）。
 *
 * 形状跟着 OpenAI 兼容层走（`{name, description, parameters}`），与
 * `src/lib/mcp/protocol.ts` 的 `ToolSpec`（`{name, description, inputSchema}`）是两个
 * 东西，不要合并：那一个是 MCP 协议规定的对外形状（喂别的 AI），这一个是这一层要发给
 * 模型网关的。字段名不同不是笔误，是两份规范各自的规定。
 *
 * `parameters` 与 handler 里的校验必须同源：写了 schema 不校验，那张表就是装饰。
 */
export type ToolSpec = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/**
 * 模型要求调一次工具。
 *
 * `argumentsJson` 是字符串，不是对象——这不是懒，是把一种真实的坏法摆在名字上：
 * OpenAI 兼容层回的就是一段 JSON 文本，而模型写坏它是常态（缺引号、多一个逗号）。
 * 取名 `arguments` 会诱使调用方直接当对象用，于是那段坏 JSON 会在一个想不到的地方炸；
 * 叫 `argumentsJson` 就在提醒"先解析、解析失败要当成一次正常的失败处理"。
 */
export type ToolCall = {
  id: string
  name: string
  argumentsJson: string
}

/**
 * 带工具那条路上的会话。只在 `TextRequest.messages` 用了它——
 * 不带工具时仍然走 `system` + `user` 那两个字段，逐字节与今天相同。
 */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: readonly ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

/* 文本（规划 / 校验 / 审核共用） */

/** 两种形态共有的那些 */
type TextRequestCommon = {
  /** 期望 JSON 输出时给出 schema 描述；供应商不支持强制约束时它只进 prompt */
  jsonSchema?: unknown
  /**
   * 这次调用可以用哪几个工具（2026-10-19，`.scratch/mcp` 工单 06）。
   * 不传 = 今天那条路（请求体里一个 `tools` 字段都不出现）。
   *
   * 与 `retrieve` / `onDelta` 同一条纪律：新能力不做默认。默认一开，脚本与跑测走的就是
   * 一条没量过的路。
   *
   * 与流式互斥：`stream()` 带 `tools` 会当场抛。理由是实测的形状——流式增量与
   * `tool_calls` 的分片拼装是两件都不简单的事，而规划那一步要的是"一次给全"。
   * 两条都是显式分支，没有"传了但被忽略"那种中间状态。
   */
  tools?: readonly ToolSpec[]
  /**
   * 工具选择的模式。
   *
   * 只有 `'auto'` 与 `'none'` 两个值，而且不许加"强制点名"那一档：2026-10-19 实测
   * （`scripts/probe-tool-calls.mts`，格 B），同一个请求体十次里七次回
   * `400 · MODEL_TOOL_CHOICE_NOT_SUPPORTED · 请改用 tool_choice=auto`、三次回 200。
   * 不可依赖，所以它不给调用方选。缺省 `'auto'`；`'none'` 是给"步数用完了、逼它给最终
   * 答复"那一步用的（`tool-loop.ts`）——用"不带 tools"也能达到同样效果，但它更显式。
   */
  toolChoice?: 'auto' | 'none'
  /**
   * 这一次要的是纯文本，别套 `response_format`。
   *
   * 默认 `false`，也就是说现有每一条路逐字节不变（规划、审核、视觉判定都照旧受
   * `LLM_JSON_MODE` 管）。加这个字段不是为了换默认，是因为"文本能力"不等于"产出一份
   * JSON"：有的调用要的就是一句话。
   *
   * 不能靠 prompt 绕过去（实测，2026-10-15）：`LLM_JSON_MODE=object` 时适配器无条件带
   * `response_format: {type:'json_object'}`，而 OpenAI 兼容层（这里是 LiteLLM）要求
   * messages 里得出现 "json" 这个词。于是"把家长那句话改得更具体"这种纯文本调用会直接
   * 400：`/chat/completions 失败 HTTP 400 · LITELLM_ERROR · 'messages' must contain the
   * word 'json' in some form`。在提示词里塞一个 "json" 能骗过这道检查，但那是为了让一个
   * 不该来的参数过关而往提示词里写一个与任务无关的词——下次换一家网关，这句就得再猜一次。
   *
   * 与 `jsonSchema` 同时给时，这个字段优先。
   */
  plainText?: boolean
  temperature?: number
  maxTokens?: number
}

/**
 * 一次文本调用。两种形态，只能选一种：
 *
 *   { system, user }   // 今天每一条路走的那一种
 *   { messages }       // 带工具那条路（多轮）走的那一种
 *
 * 做成判别联合而不是"都设成可选"：后者会让"两个都没给"变成一个类型上合法的调用，而它
 * 在运行期只会送出一条没有正文的消息——网关回什么全看它心情。判别联合把这件事挡在编译期，
 * 而且顺带表达了另一条纪律：两者不能同时给（同时给的话，`payloadOf` 里谁赢取决于那一行的
 * 写法，而那正是下一个人会改错的地方）。
 * 第二条分支上 `system?: undefined` 不是装饰：`{system:'x', messages:[…]}` 会当场报错，
 * 而不是静默地只发 messages。
 */
export type TextRequest = TextRequestCommon &
  (
    | { system: string; user: string; messages?: undefined }
    | { messages: readonly ChatMessage[]; system?: undefined; user?: undefined }
  )

export type TextResponse = {
  text: string
  modelId: string
  /** 供应商回传的真实用量；拿不到就不填，不填一个看起来合理的数 */
  usage?: { promptTokens?: number; completionTokens?: number }
  traceId?: string
  /**
   * 模型要求调工具（2026-10-19，工单 06）。没有这个字段 = 它给了最终答复。
   *
   * 两者不会同时有意义：回包里有 `tool_calls` 时 `content` 通常是空串（实测就是这么回的），
   * 而我们要的是"它调工具"这个决定，不是那段空文本。所以 `tool-loop.ts` 的判据是
   * "`toolCalls` 非空就继续跑"，不看 `text`。
   */
  toolCalls?: readonly ToolCall[]
}

/**
 * 流式的一小段（工单 07）。
 *
 * `streamed` 不是装饰：它回答"屏幕上这一串字是不是真的从网络上一段段来的"。离线回放没有
 * 流可放——录下来的本来就是一整段——所以它照这个接口实现（形状统一，调用方不用分支），
 * 但必须报 `false`。不许用定时器把它演成打字机：ADR-0003 演示路径的全部价值就是
 * "屏幕上看到的是真的发生过的事"。
 */
export type TextDelta = {
  /** 这一段新到的字符。累加起来就是全量正文 */
  text: string
  streamed: boolean
}

/**
 * 流式调用的预算。与全量调用共用 `timeoutMs` 的语义会出事（07 §一.3）：全量的超时问的是
 * "多久没回话算失败"，流式问的是"多久没有新 delta 算失败"。慢模型思考几十秒才吐第一个
 * token——共用一个数，就会把好结果判死在半路上。
 */
export type StreamBudget = CallBudget & {
  /** 空闲超时：多久没有新 delta 就判失败。缺省见 http.ts 的 `DEFAULT_SSE_IDLE_TIMEOUT_MS` */
  idleTimeoutMs?: number
}

export interface TextGenerator {
  readonly id: string
  readonly modelId: string
  complete(req: TextRequest, budget?: CallBudget): Promise<TextResponse>
  /**
   * 流式生成（工单 07）。是必填，不是可选扩展——可选的话，每个调用点都要写一次
   * `if (text.stream) … else …`，而"离线回放走另一条路"正是最容易被写成"回放时干脆不显示
   * 过程"的那种地方。
   *
   * 两条硬约束，都有测试钉住：① 同一份响应，`stream()` 与 `complete()` 的规划结果逐字段
   * 相等，否则"流式"就是一个悄悄改输出的开关，横评的数字会变成两个口径；② `onDelta` 收到的
   * 每一段都必须是模型真的写完的字符，半个字段不算数（抽取那一层负责，见
   * `engine/plan-stream.ts`）。
   */
  stream(
    req: TextRequest,
    budget: StreamBudget | undefined,
    onDelta: (delta: TextDelta) => void,
  ): Promise<TextResponse>
}

/* 图像 */

export type ImageRequest = {
  prompt: string
  /** `WIDTHxHEIGHT`。实测供应商有模型级白名单，不是范围内都行（见 tokenrhythm 适配器） */
  size: string
  /** 参考图（锁脸用）。data URL 形式，适配器自己决定怎么塞进请求 */
  referenceDataUrl?: string
  /**
   * 负向提示词（"画面里不要出现什么"）。2026-10-21 加，起因是换到 qwen-image-3.0 之后
   * 它**真的把正文写进了画面**——正向提示词里那句"不要放关键内容、别写字"对它不够。
   *
   * 只有支持这个字段的 provider 才会真的发出去（`qwen-image.ts`）；不支持的实现忽略它——
   * 这是**唯一**允许"传了但可能被忽略"的字段，因为它的性质是"加强一条已有的约束"，
   * 而不是"换一条路"（参考图那种被忽略的代价完全不同：那是以为锁了脸）。
   */
  negativePrompt?: string
  /**
   * 横评标注：同一个提示词在两个候选模型上跑，回放键必须区分得开。
   * 正式跑测不填它，只有 scripts/w1-image-bakeoff.ts 会填。
   */
  modelTag?: string
}

export type ImageResponse = {
  bytes: Uint8Array
  mime: string
  modelId: string
  /**
   * 实付金额（元）。★ 2026-10-21 换家之后这一位**常常是缺省的**：新那家（阿里云百炼
   * 的 qwen-image-3.0）不回传费用，而"缺省"比"编一个像样的单价"诚实——
   * 代价是 `stats.totalCostCny` 会偏小，所以别拿它当账单（见 `IMAGE_UNIT_COST_CNY`）。
   * 上一家那 0.20 元/张是**那家**的实测一口价，台账留在 `docs/known-tradeoffs.md`。
   */
  costCny?: number
  /** 供应商侧的请求号（这家回 `request_id`，见 `traceId`） */
  providerTaskId?: string
  traceId?: string
  /**
   * 这次请求里的 `referenceDataUrl` 到底有没有进请求体。
   *
   * ★ 这一位是**读数**，不是声明：适配器读的是响应里的 `usage.input_image_count`
   *   （2026-10-21 起；上一家没这个数，那时它是适配器自己写的 `true`）。
   * 引擎在"要求参考图、也真走了带参考图那条路"的情况下拿到非 true，就**当场抛**——
   * 一致性是这本书的命，"以为锁了脸其实没锁"必须当场可见，不能等家长发现。
   * （这里原来写的是"发一条 warning 事件"，而那条事件从来没有实现过：实际是抛。
   * 2026-10-21 把注释改成与代码一致。）
   */
  referenceApplied?: boolean
  /** 供应商侧的临时地址与失效时刻，只为排障与"下载是否赶上了"留证 */
  originUrl?: string
  originExpiresAt?: number
}

export interface ImageGenerator {
  readonly id: string
  readonly modelId: string
  /** 该实现支持的比例集合，用于出图前就判"这个尺寸能不能要"（判据 3） */
  readonly supportedRatios: readonly string[]
  /**
   * 这家有没有把参考图送进去的那条路。
   *
   * 它不是一个可以手填的开关，而是由适配器从能力推出来的：
   * `supportsReference = typeof edit === 'function'`。原来它是
   * `IMAGE_SUPPORTS_REFERENCE` 这个环境变量——那是 W1 那条错误结论的化石（"七个字段名
   * 都被挡回 ⇒ 这家吃不了参考图"，而实际是没试 `/images/edits`）。一个可能忘记同步的
   * 字符串开关，比一个方法签名更容易骗人。
   *
   * 但能力不等于使用：这一页要不要真拿参考图画，是引擎侧的策略
   * （`IllustrateOptions.referenceForPages`，默认关）。理由见 illustrate.ts 那一段。
   */
  readonly supportsReference: boolean
  /** 纯文字 → 一张图。★ 这条路上没有参考图：塞进去会被适配器当场报错，不会静默丢 */
  generate(req: ImageRequest, budget?: CallBudget): Promise<ImageResponse>
  /**
   * 参考图 + 文字 → 一张图（可选能力）。
   *
   * 单独一个方法而不是给 `generate` 加一个可选字段，是为了让"这家不支持"这件事在类型上
   * 就看得见：不支持的 provider 没有这个方法，调用方要么分支要么报错，没有"传了但被忽略"
   * 这一种状态可走。
   */
  edit?(
    req: ImageRequest & { referenceDataUrl: string },
    budget?: CallBudget,
  ): Promise<ImageResponse>
}

/* 视觉比对（一致性 Agent 的手） */

export type CompareRequest = {
  /** 角色卡参考图 */
  referenceDataUrl: string
  /** 本页新画的图 */
  pageDataUrl: string
  /** 逐条核对的清单，来自 card.checklistOf() —— 判据与生成同源，见 card.ts */
  checklist: readonly string[]
}

export type CompareResponse = {
  /** 0–1。拿不到就返回 null 并把 verdict 记成 unavailable，不许编一个数 */
  score: number | null
  /** 没命中的槽位（`bone` / `eyes` …） */
  missed: readonly string[]
  reason?: string
  modelId: string
  traceId?: string
}

export interface VisionComparator {
  readonly id: string
  readonly modelId: string
  compare(req: CompareRequest, budget?: CallBudget): Promise<CompareResponse>
}

/* 读一张照片，说出这个孩子长什么样（2026-10-15）
 * 与 `VisionComparator` 分开成一个接口，不合并进它：那个问的是"这两张图是不是同一个人"
 * （判据是清单 + 分数），这个问的是"这张图里的人长什么样"（产物是八条锚点与几个标签）。
 * 两者的产物形状、失败含义、提示词都不一样，合成一个方法的代价是：下一次改其中一条提示词，
 * 会牵动另一条的行为。
 * 方向也不一样：比对是核对（拿清单去查），这个是描述（从图里读出来）。描述出来的东西一律是
 * "待用户核对的建议"，不是事实——这一点由调用方负责表达。
 */
export type PortraitAnalysisRequest = {
  /** 一张孩子的照片（data URL）。★ 调用方保证它只活在这一条请求里 */
  photoDataUrl: string
  /** 已经填好的锚点。有的话给模型当上下文（"照着这个粒度说"），没有就空着 */
  anchors?: readonly { slot: string; value: string }[]
}

export type PortraitAnalysisResponse = {
  /** 读出来的锚点。只含认识的槽位，值太短的已经被丢掉（见 openai-vision 里的判据） */
  anchors: readonly { slot: string; value: string }[]
  /** 从照片能看出来的外貌标签（`LOOK_TAGS` 里那些词）。看不出来就是空数组 */
  lookTags: readonly string[]
  /** 模型自己的一句话（为什么这么读）。它不是事实，是模型的说法 */
  note?: string
  modelId: string
  traceId?: string
}

export interface PortraitAnalyzer {
  readonly id: string
  readonly modelId: string
  analyzePortrait(
    req: PortraitAnalysisRequest,
    budget?: CallBudget,
  ): Promise<PortraitAnalysisResponse>
}

/* 审一张画好的图：里面有没有不该出现的东西（2026-10-19，`.scratch/safety` 工单 01）
 *
 * 与 `VisionComparator` 分开成一个接口，理由与 `PortraitAnalyzer` 那条一样：问的问题、
 * 产物的形状、失败的读数含义都不一样。比对问的是"这两张图是不是同一个人"（产物是一个
 * 0–1 的分），审核问的是"这张图里有没有条款禁掉的东西"（产物是条款 id）。
 * 方向也不同，而且这一点决定了它不是判据：比对是核对（一个已知的东西在不在），审核是找
 * （不知道有没有）。前者能定阈值，后者只能当兜底——所以 `illustrate.ts` 里那一档的处置与
 * 比对那一档不一样。
 * 它比比对便宜一半的流量：只送一张图，不送参考图（审核与"是不是同一个孩子"无关）。
 */
export type PictureReviewRequest = {
  /** 刚画好的那一张（页图或封面） */
  pageDataUrl: string
  /**
   * 逐条核对的条款：`id` + 条款原文。给的是原文不是词表词——词表是给文字用的，
   * 一张图上没有"血"这个字，只有一片红。清单由调用方拼（与 `CompareRequest.checklist`
   * 同一条），适配器不认识我们的条款库。
   */
  clauses: readonly { id: string; text: string }[]
}

export type PictureFinding = {
  /** 命中的条款 id（`R-01`…）。★ "具体到哪一条"是这一栏判据的原文要求 */
  clauseId: string
  /** 一句话说在画面哪儿。人要去翻那张图核对，就得知道看哪儿 */
  where: string
}

export type PictureReviewResponse = {
  /**
   * 读到的条目。★ 读不到是 `null`，不是 `[]`——与 `CompareResponse.score` 那条
   *   `number | null` 同一条纪律：「没审成」与「审了、一条都没有」处置完全不同
   *   （前者不重画、标"没审过"；后者放行）。
   */
  findings: readonly PictureFinding[] | null
  reason?: string
  modelId: string
  traceId?: string
}

export interface PictureReviewer {
  readonly id: string
  readonly modelId: string
  reviewPicture(req: PictureReviewRequest, budget?: CallBudget): Promise<PictureReviewResponse>
}

/* 语音（W4 落地，接口先立） */

export type CloneRequest = {
  /** 30 秒样本。★ 适配器不许留存：拿到 voiceId 后调用方立即销毁字节 */
  sampleBytes: Uint8Array
  mime: string
  /** 授权声明的凭据号。厂商要求的东西必须在这里有位置，否则实现时只能塞后门 */
  consentRef: string
}

export type SynthesizeRequest = {
  voiceId: string
  text: string
  /**
   * 情绪 → 语气。取值见 `domain.ts` 的 `MOODS`；怎么翻成厂商的控制类标签是
   * 适配器的私事（见 `qwen-speech.ts` 的 `MOOD_TAGS`）。
   *
   * ★ 引擎这一层只负责把 `StoryNode.mood` 传下来，不认识任何厂商标签串——
   *   与 `SYNTH_PATH` 那类东西留在适配器里是同一条道理。
   */
  mood?: Mood
  /** 名字读音确认过的实际读法，多音字靠它在合成时不被念错。★ 目前没有任何适配器接它 */
  pronunciation?: Record<string, string>
}

export interface VoiceSynthesizer {
  readonly id: string
  readonly modelId: string
  /**
   * 这个模型认不认情绪标签。
   *
   * ★ 它是一个只读能力位，不是调用开关：`synthesize` 收到 `mood` 时，
   *   认就贴标签，不认就照原样送（不报错——那会让换模型的人整本配音全挂）。
   *   但"不报错"不等于"不说"：调用方（`narrateAll`）拿这一位去补一条人话，
   *   否则症状就是当初这个 bug 的样子——每一页都一个调子，而没人知道为什么。
   */
  readonly supportsMood: boolean
  clone(req: CloneRequest, budget?: CallBudget): Promise<{ voiceId: string }>
  synthesize(
    req: SynthesizeRequest,
    budget?: CallBudget,
  ): Promise<{ bytes: Uint8Array; mime: string; durationMs?: number }>
  /** ★ 生命周期：删孩子时必须调它解绑。缺了这条，隐私承诺在代码层就是假的 */
  release(voiceId: string, budget?: CallBudget): Promise<{ released: boolean }>
}

/* 资产存储 */

export type PutEntry = {
  path: string
  bytes: Uint8Array
  mime: string
  originUrl?: string
  originExpiresAt?: number
}

/**
 * 落盘与删除。
 *
 * `deletePrefix` 是"一键删除"的存储侧原语（隐私设计 §九 的三粒度靠它实现），
 * 返回删掉的条数——删除凭据要列明"每个存储位置各删了多少条"，
 * 一个不报数的删除实现没法生成那张凭据。
 */
export interface AssetStore {
  readonly id: string
  put(entry: PutEntry): Promise<AssetRef>
  putJson(entry: { path: string; value: unknown }): Promise<AssetRef>
  read(path: string): Promise<Uint8Array | null>
  readJson<T>(path: string): Promise<T | null>
  exists(path: string): Promise<boolean>
  /** 列前缀下的全部路径（排序）。书架、级联删除的凭据、manifest 审计都靠它 */
  list(prefix: string): Promise<string[]>
  deletePrefix(prefix: string): Promise<number>
}

/* 一次运行拿到的全套能力 */

/**
 * `offline` = 全部走已落盘资产与回放数据（ADR-0003 的演示路径）。
 * ★ 这个字段必须存在且由调用方显式选择：不允许"live 调不通就悄悄退回 offline"。
 *   一次评审当天的网络故障应该以错误的面目出现，而不是以假数据的面目。
 */
export type ProviderMode = 'live' | 'offline'

export type ProviderBundle = {
  mode: ProviderMode
  text: TextGenerator
  image: ImageGenerator
  /**
   * 视觉那一个模型能做两件不同的事，所以这里写的是两个接口的交集：
   * `compare` 给一致性 Agent（像不像），`reviewPicture` 给内容审核（画面里有没有
   * 不该出现的东西，`.scratch/safety` 工单 01）。
   *
   * ★ 不用两个字段、两个工厂：它们用的是同一个模型、同一把 key、同一套 HTTP 管道，
   *   分成两格只会多一处"某个调用点忘了配超时"。与 `visionProviderOf` 那段同一个理由。
   * ★ 与 `null` 的语义仍是"这台机器没有视觉能力"——两件事一起没有。
   *   只想要其中一件是不可能的：它们背后是同一个端点的同一个模型。
   */
  vision: (VisionComparator & PictureReviewer) | null
  voice: VoiceSynthesizer | null
  store: AssetStore
}
