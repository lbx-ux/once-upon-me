/**
 * providers/types.ts —— 能力接口（"能力适配层"里的那一层接口）
 *
 * 三条约定，每条都有理由，改之前先读完：
 *
 * 1. **按能力命名，不按供应商命名**（ADR-0002）。所以这里没有 `openai` 也没有
 *    `wan`，只有"生成图像""比对图像""合成语音"。换供应商只改 `.env.local` 的值
 *    与一个适配器文件。
 * 2. **图像返回字节，不返回 URL**。供应商的媒体地址约 1 小时过期
 *    （`E:\compete\模型.md` §7），把 URL 放进接口就等于把"记得及时下载"
 *    变成一个将来会忘的纪律。下载这一步在适配器内部完成，接口上不存在这个坑。
 * 3. **生命周期方法是一等公民**。`VoiceSynthesizer.release` 不是可选扩展：
 *    隐私设计承诺了"删孩子 → 解绑 voice_id"，接口里没有它，实现时就会"临时开个后门
 *    直接调 SDK"——那条正是 ADR-0002 点名的失效模式。
 *
 * 接口都带 `id`：报错、日志、provenance 都要说得出"这次用的是哪个实现、哪个模型"。
 * 模型 id **一律来自环境变量**，不写死（见 registry.ts）。
 */

import type { AssetRef } from '../domain.ts'

/** 一次调用的公共预算控制。超时**不重试**：异步任务可能已在服务端建单，盲目重试会重复扣费 */
export type CallBudget = {
  timeoutMs?: number
  signal?: AbortSignal
}

/* ───────────────────────── 文本（规划 / 校验 / 审核共用） ───────────────────────── */

export type TextRequest = {
  system: string
  user: string
  /** 期望 JSON 输出时给出 schema 描述；供应商不支持强制约束时它只进 prompt */
  jsonSchema?: unknown
  /**
   * 这一次要的是**纯文本**，别套 `response_format`。
   *
   * ★ 默认 `false` —— 也就是说**现有每一条路逐字节不变**（规划、审核、视觉判定都照旧
   *   受 `LLM_JSON_MODE` 管）。加这个字段不是为了换默认，是因为"文本能力"不等于
   *   "产出一份 JSON"：有的调用要的就是一句话。
   *
   * ★ 为什么不能靠 prompt 绕过去（实测，2026-10-15）：`LLM_JSON_MODE=object` 时适配器
   *   无条件带 `response_format: {type:'json_object'}`，而 OpenAI 兼容层（这里是 LiteLLM）
   *   要求 messages 里得出现 "json" 这个词。于是"把家长那句话改得更具体"这种纯文本调用
   *   会直接 400：
   *     `/chat/completions 失败 HTTP 400 · LITELLM_ERROR ·
   *      'messages' must contain the word 'json' in some form`
   *   在提示词里塞一个 "json" 能骗过这道检查，但那是**为了让一个不该来的参数过关
   *   而往提示词里写一个与任务无关的词**——下次换一家网关，这句就得再猜一次。
   *
   * ★ 与 `jsonSchema` 同时给时，这个字段优先（要纯文本就是纯文本，不套 schema）。
   */
  plainText?: boolean
  temperature?: number
  maxTokens?: number
}

export type TextResponse = {
  text: string
  modelId: string
  /** 供应商回传的真实用量；拿不到就不填，不填一个看起来合理的数 */
  usage?: { promptTokens?: number; completionTokens?: number }
  traceId?: string
}

/**
 * 流式的一小段（工单 07）。
 *
 * ★ `streamed` 不是装饰：它回答"屏幕上这一串字**是不是真的从网络上一段段来的**"。
 *   离线回放没有流可放——录下来的本来就是一整段——所以它照这个接口实现（形状统一，
 *   调用方不用分支），但必须报 `false`。**不许用定时器把它演成打字机**：
 *   ADR-0003 演示路径的全部价值就是"屏幕上看到的是真的发生过的事"（07 §一.2）。
 */
export type TextDelta = {
  /** 这一段新到的字符。累加起来就是全量正文 */
  text: string
  streamed: boolean
}

/**
 * 流式调用的预算。**与全量调用共用 `timeoutMs` 的语义会出事**
 * （07 §一.3）：全量的超时问的是"多久没回话算失败"，流式问的是"多久没有新 delta 算失败"。
 * 慢模型思考几十秒才吐第一个 token——共用一个数，就会把好结果判死在半路上。
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
   * 流式生成（工单 07）。**是必填，不是可选扩展**——
   * 可选的话，每个调用点都要写一次 `if (text.stream) … else …`，
   * 而"离线回放走另一条路"正是最容易被写成"回放时干脆不显示过程"的那种地方。
   *
   * ★ 两条硬约束（都有测试钉住）：
   *   1. **同一份响应，`stream()` 与 `complete()` 的规划结果逐字段相等**。
   *      否则"流式"就是一个悄悄改输出的开关，横评的数字（同一份 prompt 的通过率）
   *      会变成两个口径。
   *   2. `onDelta` 收到的每一段都必须是**模型真的写完的字符**。半个字段不算数
   *      （抽取那一层负责，见 `engine/plan-stream.ts`）。
   */
  stream(
    req: TextRequest,
    budget: StreamBudget | undefined,
    onDelta: (delta: TextDelta) => void,
  ): Promise<TextResponse>
}

/* ───────────────────────── 图像 ───────────────────────── */

export type ImageRequest = {
  prompt: string
  /** `WIDTHxHEIGHT`。实测供应商有**模型级白名单**，不是范围内都行（见 tokenrhythm 适配器） */
  size: string
  /** 参考图（锁脸用）。data URL 形式，适配器自己决定怎么塞进请求 */
  referenceDataUrl?: string
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
  /** 实付金额（元）。实测图像一口价 0.20 元/张，与尺寸无关 */
  costCny?: number
  providerTaskId?: string
  traceId?: string
  /**
   * 这次请求里的 `referenceDataUrl` **到底有没有进请求体**。
   * 引擎在要求参考图的情况下拿到 false，就发一条 warning 事件——
   * 一致性是这本书的命，"以为锁了脸其实没锁"必须当场可见，不能等家长发现。
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
   * 这家**有没有**把参考图送进去的那条路。
   *
   * ★ 它不是一个可以手填的开关，而是由适配器**从能力推出来**的：
   *   `supportsReference = typeof edit === 'function'`。
   *   原来它是 `IMAGE_SUPPORTS_REFERENCE` 这个环境变量——那是 W1 那条错误结论的化石
   *   （"七个字段名都被挡回 ⇒ 这家吃不了参考图"，而实际是没试 `/images/edits`）。
   *   一个可能忘记同步的字符串开关，比一个方法签名更容易骗人。
   *
   * ★ 但**能力不等于使用**：这一页要不要真拿参考图画，是引擎侧的策略
   *   （`IllustrateOptions.referenceForPages`，默认关）。理由见 illustrate.ts 那一段。
   */
  readonly supportsReference: boolean
  /** 纯文字 → 一张图。★ 这条路上没有参考图：塞进去会被适配器**当场报错**，不会静默丢 */
  generate(req: ImageRequest, budget?: CallBudget): Promise<ImageResponse>
  /**
   * 参考图 + 文字 → 一张图（可选能力）。
   *
   * 单独一个方法而不是给 `generate` 加一个可选字段，是为了让"这家不支持"这件事
   * **在类型上就看得见**：不支持的 provider 没有这个方法，调用方要么分支要么报错，
   * 没有"传了但被忽略"这一种状态可走。
   */
  edit?(
    req: ImageRequest & { referenceDataUrl: string },
    budget?: CallBudget,
  ): Promise<ImageResponse>
}

/* ───────────────────────── 视觉比对（一致性 Agent 的手） ───────────────────────── */

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

/* ── 读一张照片，说出这个孩子长什么样（2026-10-15，用户提的那条）─────────────
 * ★ 与 `VisionComparator` **分开**成一个接口，不合并进它：那个问的是
 *   "这两张图是不是同一个人"（判据是清单 + 分数），这个问的是"这张图里的人长什么样"
 *   （产物是八条锚点与几个标签）。两者的**产物形状、失败含义、提示词**都不一样，
 *   合成一个方法的代价是：下一次改其中一条提示词，会牵动另一条的行为。
 * ★ 方向也不一样：比对是**核对**（拿清单去查），这个是**描述**（从图里读出来）。
 *   描述出来的东西一律是"待用户核对的建议"，不是事实——这一点由调用方负责表达。
 */
export type PortraitAnalysisRequest = {
  /** 一张孩子的照片（data URL）。★ 调用方保证它只活在这一条请求里 */
  photoDataUrl: string
  /** 已经填好的锚点。有的话给模型当上下文（"照着这个粒度说"），没有就空着 */
  anchors?: readonly { slot: string; value: string }[]
}

export type PortraitAnalysisResponse = {
  /** 读出来的锚点。**只含认识的槽位**，值太短的已经被丢掉（见 openai-vision 里的判据） */
  anchors: readonly { slot: string; value: string }[]
  /** 从照片能看出来的外貌标签（`LOOK_TAGS` 里那些词）。看不出来就是空数组 */
  lookTags: readonly string[]
  /** 模型自己的一句话（为什么这么读）。**它不是事实，是模型的说法** */
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

/* ───────────────────────── 语音（W4 落地，接口先立） ───────────────────────── */

export type CloneRequest = {
  /** 30 秒样本。★ 适配器**不许留存**：拿到 voiceId 后调用方立即销毁字节 */
  sampleBytes: Uint8Array
  mime: string
  /** 授权声明的凭据号。厂商要求的东西必须在这里有位置，否则实现时只能塞后门 */
  consentRef: string
}

export type SynthesizeRequest = {
  voiceId: string
  text: string
  /** 情绪标签 → 语气。见 domain.ts 的 MOODS */
  mood?: string
  /** 名字读音确认过的实际读法，多音字靠它在合成时不被念错 */
  pronunciation?: Record<string, string>
}

export interface VoiceSynthesizer {
  readonly id: string
  readonly modelId: string
  clone(req: CloneRequest, budget?: CallBudget): Promise<{ voiceId: string }>
  synthesize(
    req: SynthesizeRequest,
    budget?: CallBudget,
  ): Promise<{ bytes: Uint8Array; mime: string; durationMs?: number }>
  /** ★ 生命周期：删孩子时必须调它解绑。缺了这条，隐私承诺在代码层就是假的 */
  release(voiceId: string, budget?: CallBudget): Promise<{ released: boolean }>
}

/* ───────────────────────── 资产存储 ───────────────────────── */

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
 * 返回**删掉的条数**——删除凭据要列明"每个存储位置各删了多少条"，
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

/* ───────────────────────── 一次运行拿到的全套能力 ───────────────────────── */

/**
 * `offline` = 全部走已落盘资产与回放数据（ADR-0003 的演示路径）。
 * ★ 这个字段必须存在且由调用方**显式**选择：不允许"live 调不通就悄悄退回 offline"。
 *   一次评审当天的网络故障应该以错误的面目出现，而不是以假数据的面目。
 */
export type ProviderMode = 'live' | 'offline'

export type ProviderBundle = {
  mode: ProviderMode
  text: TextGenerator
  image: ImageGenerator
  vision: VisionComparator | null
  voice: VoiceSynthesizer | null
  store: AssetStore
}
