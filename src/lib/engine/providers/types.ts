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

export interface TextGenerator {
  readonly id: string
  readonly modelId: string
  complete(req: TextRequest, budget?: CallBudget): Promise<TextResponse>
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
   * 能不能带参考图（判据 2「锁脸能力」的前提）。
   *
   * ★ 默认 false，**实测确认才翻成 true**：一致性策略 whole-in 参考图，
   *   一个"以为支持其实没生效"的字段会让整本书悄悄退回纯文字描述出图，
   *   而页面上什么都看不出来——直到家长说"这不像我孩子"。
   */
  readonly supportsReference: boolean
  generate(req: ImageRequest, budget?: CallBudget): Promise<ImageResponse>
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
