/**
 * qwen-image.ts —— 图像生成适配器（阿里云百炼 · 千问-图像生成与编辑 3.0）
 *
 * 接口文档：https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference
 * （2026-10-21 读的；`docs.bailian.console.aliyun.com` 那个域名在本机抓不到，同文在 help.aliyun.com）
 *
 * ## 走哪条路：DashScope 原生同步，**不是** OpenAI 兼容模式
 *
 * 文档给了三种接入方式，实测之后走的是第三种里最直白的那一种：
 *
 * | 接入方式 | 地址 | 实测（2026-10-21） |
 * | --- | --- | --- |
 * | OpenAI 兼容 | `/compatible-mode/v1/images/generations` | **HTTP 404**（空响应体）。文档示例用的是 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` 那种业务空间专属域名，共享域名上没有这个路由 |
 * | DashScope 同步 | `/api/v1/services/aigc/multimodal-generation/generation` | **200**，约 20s，`usage` 与 `request_id` 都在响应体里 |
 * | DashScope 异步 | `/api/v1/services/aigc/image-generation/generation` + 轮询 | 没用：一次一张，不需要建单轮询那一套 |
 *
 * ★ 这条 404 值得记一笔：文档正文说"现有域名仍可正常使用"，那句话对**原生**路由成立、
 *   对兼容模式这条路不成立。**"文档说支持"与"这个地址上打得通"是两件事**——
 *   探针第一版就是照着兼容模式写的，第一次跑直接 404。
 *
 * 原生这条路的地址与语音那家**是同一个**（`https://dashscope.aliyuncs.com/api/v1`），
 * 所以 `registry.ts` 那里也用上了与 `TTS_BASE_URL` 同一条 `pathPrefix` 判据。
 *
 * ## 两条路：一条路由管两件事，差一个 `{image}` 段
 *
 * 请求体是原生那套 `input.messages[0].content[]` 数组，与视频接口同构、
 * 与 OpenAI 的顶层 `prompt` 不同构：
 *
 * | 送什么 | content 数组 | 得什么 |
 * | --- | --- | --- |
 * | 纯文字 | `[{text}]` | 文生图（T2I） |
 * | 文字 + 图 | `[{image}, {text}]` | 图生图（I2I），3.0 系列 1–3 张，卡里的 data URL 直接可用 |
 *
 * ## 三件随文档一起来的、比上一家强的事实（都写进了代码）
 *
 * 1. **`size` 在 I2I 上同样生效**。上一家带参考图那条路没有 `size` 字段、产物尺寸由模型定
 *    （实测 1440² 请求回 1024²），那是 `referenceForPages` 当初默认关的三条理由之一。
 *    ★ 格式与 OpenAI 那套不同：这里是 `宽*高`（星号），`ImageRequest.size` 是 `宽x高`，
 *    转换在这一层做一次（`nativeSizeOf`）——两边混用的症状是 400，而错误文案里只有尺寸。
 * 2. **`usage.input_image_count` 如实回报参考图进没进请求**（T2I 为 0）。上一家的
 *    `referenceApplied` 是适配器自己写的 `true`（"发了就算数"）；这里它是**读数**。
 *    这一位不是装饰：`photo-card.ts` 与 `illustrate.ts` 都靠它决定"要不要当场失败"。
 * 3. **`request_id` 在响应体里**（成功与失败都给）。所以这条路上报障**报得出号**——
 *    兼容模式那条路只把它放在 `x-request-id` 响应头，而共享底座不暴露响应头。
 *
 * 响应里也**没有** `cost_cny`。计费信息只有 `usage.output_image_type` 的档位
 * （`qima_output_1k` / `qima_output_2k`，阈值是面积 2,250,000）。产品用的三个尺寸
 * （1536×1024 / 1152×1536 / 1440×1440）面积都 ≤ 2,073,600 ⇒ **都是 1k 档**。
 * 所以记账按 `unitCostCny` 平记——**那是兜底记账，不是实测单价**，没配就不记。
 *
 * ## 四条纪律（随上一家的文件搬过来，不随文件消失）
 *
 * 1. **只允许实测过的尺寸**。不在表里的尺寸在发请求之前就拒：这个接口一次 200 就是一张图的钱，
 *    探测参数不能拿正式跑测做。**白名单是模型级的**，在 A 上测过的尺寸不能抄给 B。
 * 2. **拿到 URL 立即下载**。签名地址会过期（这次实测回来的地址带 `Expires=<epoch>`），
 *    适配器内部完成 `URL → 字节`，接口上不存在"只存链接"这条路。
 * 3. **超时不重试**，5xx 也不重试。同步接口超时是"不知道有没有扣费"，502/504 时上游
 *    可能已经画完；重试可能翻倍。只有 429 是"被挡在门外"，那一种才重（见下面那段）。
 * 4. **`generate` 这条路上不带参考图**，带进来就报错，不许静默丢掉：被忽略的参考图会让
 *    整本书"看着像已经在锁脸了"，而代价要到 20 页画完、家长说"这不像我孩子"时才浮出来。
 *
 * ## 429 退避（2026-10-21，工单 D-03）
 *
 * 这一层原来一次都不重试，那是**对的**——第 3 条那条纪律防的是"不知道有没有扣费"。
 * 加它是因为上面多了一个会主动制造限流的东西：上限 3 的并发池（`illustrate.ts` 的
 * `illustrateAll`）。D-03 把这条写成了代价，不是顺手加的优化。
 *
 * | 回什么 | 我们那边扣钱了吗 | 重试 |
 * | --- | --- | --- |
 * | 429（容量限流） | 没有：请求被挡在门外 | 重试，退避 1.2s × 第几次 |
 * | 5xx（上游故障） | **不知道** | 不重试 |
 * | 超时 / 中止 | 不知道 | 不重试（第 3 条） |
 *
 * ★ 与 `qwen-speech.ts` 的 `ENROLL_ATTEMPTS` **不是**同一条判据：那边重的是"5xx 与 429"，
 *   因为它重试的是**建音色**——那件事不按次计费。这一边重试一次是一张图的钱。
 *   两个数各自量过各自的事，合并成一个共用常量就是把两种代价混成一种。
 *   ★ 这一家的限流长什么样**还没量过**（`scripts/probe-image-concurrency.mts` 是量它的），
 *   所以退避目前是照 `qwen-speech.ts` 的形状取的（失败是秒级的，等太久只会让"点一下"卡住）。
 *
 * ## 本文件里的实测数字跟着探针走
 *
 * 探针是 `scripts/probe-qwen-image.mts`，没跑过的地方写着「待测」——
 * 不许把"接口文档这么写"当成"我们量过"。
 */

import { EngineError } from '../errors.ts'
import type { CallBudget, ImageGenerator, ImageRequest, ImageResponse } from './types.ts'
import {
  fetchBytes,
  findFirst,
  requestJson,
  traceOf,
  type HttpDeps,
  type JsonCall,
} from './http.ts'

/**
 * 原生同步那条路。★ 不是 `/images/generations`：那个地址（连 `/compatible-mode/v1` 一起）
 * 在共享域名上是 404，实测过（见文件头那张表）。
 */
const GENERATE_PATH = '/services/aigc/multimodal-generation/generation'

/**
 * `ImageRequest.size`（`宽x高`，全仓库统一的写法：白名单、`prompts/image.ts` 的常量、
 * 测试都在用它）→ 原生协议的 `宽*高`。
 *
 * 两边混用的症状是 400，而错误文案里只有尺寸——所以转换只做一次，就在发请求这一层。
 */
function nativeSizeOf(size: string): string {
  return size.replace('x', '*')
}

/**
 * 一次出图的客户端上限。
 *
 * 文档给 SDK 的建议是"显式设 600s，多图（n 大）或并发场景从 600 起"。我们一次只要一张、
 * n 恒为 1，所以不照抄那个数——但也不能用上一家那 180s：这一家是带思考的图像模型，
 * 单张实测耗时见文件头（探针量的那个数才是依据）。`IMAGE_TIMEOUT_MS` 能压过它。
 */
const DEFAULT_TIMEOUT_MS = 300_000

const IMAGE_ATTEMPTS = 4
const IMAGE_BACKOFF_BASE_MS = 1_200

/** 429 才是"门外"，没有 `httpStatus` 的（超时、连接被掐）一律不重试 */
function isRateLimited(err: unknown): boolean {
  return err instanceof EngineError && err.httpStatus === 429
}

/** 退避等待；已经中止时立刻返回（不再白等一档） */
function backoff(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 把"试了几次"写回那句开发者消息里；结构化字段原样带走（界面分流靠的是它们） */
function withAttempts(error: EngineError, attempts: number): EngineError {
  return new EngineError(
    error.code,
    `${error.message}（这一条我们连着试了 ${attempts} 次，每次都被限流挡回来）`,
    {
      traceId: error.traceId,
      detail: error.detail,
      httpStatus: error.httpStatus,
      providerCode: error.providerCode,
    },
  )
}

/**
 * 这一次**付费**调用，带着限流退避。
 *
 * ★ 重发的是逐字节同一个请求（同一个 prompt、同一个 size）：429 挡回来的请求没有被受理，
 *   所以重发不会画出两张图。别的失败一律原样抛出去——`requestJson` 自己那一层已经处理过
 *   "确定没到服务端"的连接级失败，能走到这里的失败都是"可能已经到过"的。
 */
async function payingCall(deps: HttpDeps, call: JsonCall, backoffMs: number): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestJson(deps, call)
    } catch (err) {
      if (attempt >= IMAGE_ATTEMPTS || !isRateLimited(err)) {
        // 第一次就撞上限流也照原样抛：加一句"试了 1 次"没有信息，只会让消息更长
        throw attempt === 1 || !(err instanceof EngineError) ? err : withAttempts(err, attempt)
      }
      await backoff(backoffMs * attempt, call.signal)
    }
  }
}

/**
 * 每个模型**实测通过**的尺寸。不在表里的尺寸不发请求：一次 200 就是一张图的钱。
 *
 * ★ 白名单是模型级的。文档给的合法范围（面积 512²–2048²、比例 1:8–8:1）**不是**这张表——
 *   文档说"收"，与"我们量过它真按这个尺寸回来"是两件事。上一家那张表里就有一个
 *   `512x512` 被模型级白名单拒掉的实例。
 *
 * ★ 填表规矩：跑 `node scripts/probe-qwen-image.mts`，**读 PNG 的 IHDR 核宽高与请求分毫不差**
 *   才算过，然后把日期与那次读数写进下面这段注释。
 *
 * 2026-10-21 实测（`scripts/probe-qwen-image.mts`，`qwen-image-3.0`，四个尺寸各一次真请求）：
 *
 * | 尺寸 | 用途 | 请求 → 产物 | 耗时 | 体积 |
 * | --- | --- | --- | --- | --- |
 * | 1536x1024 | 页图（3:2 跨页） | 1536×1024 → 1536×1024 ✓ | 6.4s | 2.53 MB |
 * | 1152x1536 | 封面（3:4 竖版） | 1152×1536 → 1152×1536 ✓ | 6.3s | 2.72 MB |
 * | 1440x1440 | 角色标准像 | 1440×1440 → 1440×1440 ✓ | 7.5s | 3.15 MB |
 * | 1024x1024 | `make-default-avatar.mts` 那张 | 1024×1024 → 1024×1024 ✓ | 4.2s | 1.71 MB |
 *
 * 四次都 `rewrite_status=not_use`——这正是我们显式关掉的提示词改写（`prompt_extend: false`）
 * 生效的凭据。
 *
 * **带参考图那一次（同一天，真卡 `xiaolu-r1` 的参考图 + 归一化）**：
 *
 * | 请求 | 产物 | 耗时 | `input_image_count` |
 * | --- | --- | --- | --- |
 * | 1536x1024（页图 3:2） | 1536×1024 ✓ **逐位相等** | 11.5s | **1** |
 *
 * ★ 两行读数各回答一件事，而且都是上一家答不上的：**尺寸在 I2I 上被遵守**
 *   （上一家那条路没有 `size` 字段），**参考图真的进了请求**（适配器的 `referenceApplied`
 *   就是读这一位，不再是自己写一个 `true`）。带图比纯文字慢约 1.8 倍（11.5s vs 6.4s）——
 *   `IMAGE_TIMEOUT_MS` 是照这个量级留的余量。
 */
export const SIZES_BY_MODEL: Record<string, readonly string[]> = {
  'qwen-image-3.0': ['1536x1024', '1152x1536', '1440x1440', '1024x1024'],
  // ★ 空的：这个型号**一次都没量过**。空表 = 任何尺寸都发不出去（这是有意的，
  //   见 `requireMeasuredSize` 的第二条）。要用它就照上面的规矩先量一遍再填。
  'qwen-image-3.0-pro': [],
}

/** 尺寸 → 比例。3:2 与 3:4 是产品要的两个档（封面 3:4、跨页 3:2） */
const RATIO_OF_SIZE: Record<string, string> = {
  '768x768': '1:1',
  '1024x1024': '1:1',
  '1440x1440': '1:1',
  '2048x2048': '1:1',
  '1280x720': '16:9',
  '1536x1024': '3:2',
  '1152x1536': '3:4',
}

export type QwenImageOptions = {
  /**
   * 一张图记多少钱。★ 响应里没有费用字段，所以**没有配它就不记账**（`costCny` 留空）——
   * 兜底值必须是 env 里给的那个，不能在代码里编一个"看起来合理"的数：
   * 上一家的 0.20 元是那家实测的一口价，对这一家不是任何东西。
   * `usage.output_image_type` 会说是 1k 还是 2k 档，而产品用的三个尺寸都在 1k 档内
   */
  unitCostCny?: number
  /**
   * 提示词智能改写（`prompt_extend`）。
   *
   * ★ 缺省 **false**，这与这家文档的默认相反（文档默认 true、还"建议开启"）。理由是我们的
   *   prompt 不是一句大白话：它带着角色卡派生出来的锚点段（骨相/瞳色/头身比/那撮翘发）与
   *   画风锁，而"判据与生成同源"是这本书一致性的地基（`card.ts` 的文件头）。让厂商的改写
   *   模型动那段文字，等于把地基交给一个我们没量过的黑盒——症状会是"画出来不太像，但
   *   提示词里明明写着"。要开它做对照，`IMAGE_PROMPT_EXTEND=on`。
   *   `enable_thinking` 只在 `prompt_extend=true` 时生效，所以不单独发这个字段。
   */
  promptExtend?: boolean
  /** 别的顶层扩展字段（`negative_prompt` / `seed` / `watermark` 之类）。不猜的默认值都在这儿之外 */
  extra?: Record<string, unknown>
  /** 限流退避的基数（缺省 1.2s）。存在的理由只有一个：让"重试的次序与次数"能被测住，
   *  而不必让测试真等 7 秒。生产上没有人该动它（同 `qwen-speech.ts` 的 `enrollBackoffMs`） */
  backoffMs?: number
  /** 单次调用的缺省超时。压过 `deps.timeoutMs` */
  timeoutMs?: number
}

/**
 * 能力 = "有没有 edit 这条方法"。
 *
 * 单独一个导出函数，是为了让这条关系可被证伪：测试能拿一个没有 edit 的实现调它并看到 false，
 *   而"字面量 true"是没法这样测的——它只会在被漏改的那天不响。不读环境变量：
 *   那个 `IMAGE_SUPPORTS_REFERENCE` 开关是 W1 那条错误结论的化石，已随工单 02 删除。
 */
export function supportsReferenceOf(impl: { edit?: unknown }): boolean {
  return typeof impl.edit === 'function'
}

export function createQwenImage(
  deps: HttpDeps,
  modelId: string,
  opts: QwenImageOptions = {},
): ImageGenerator {
  const allowed = SIZES_BY_MODEL[modelId] ?? []
  const unitCostCny = opts.unitCostCny
  const backoffMs = opts.backoffMs ?? IMAGE_BACKOFF_BASE_MS
  const timeoutMs = opts.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const promptExtend = opts.promptExtend ?? false

  function requireKey(): void {
    if (!deps.apiKey) {
      throw new EngineError('provider-not-configured', 'IMAGE_API_KEY 未配置，图像能力不可用')
    }
  }

  /**
   * 发请求之前拦一道。
   *
   * 三种情形三句不同的话，因为它们要人做的事不同：
   *
   * | 情形 | 该干什么 | 消息说的是 |
   * | --- | --- | --- |
   * | 模型名根本不在表里（多半是换了家、或者还写着上一家的名字） | 改 `IMAGE_MODEL` | "这个适配器只认 …" |
   * | 模型在表里，但这一格的**表还是空的**（这个模型一次都没量过） | 跑探针 | "还没量过，先跑 probe-qwen-image.mts" |
   * | 模型量过了，就是这个尺寸没量 | 换尺寸或补量它 | "不在实测白名单里（白名单：…）" |
   *
   * 合成一句的代价很具体：换模型的人会去查尺寸表，而真正该改的是模型名。
   */
  function requireMeasuredSize(size: string): void {
    if (!(modelId in SIZES_BY_MODEL)) {
      throw new EngineError(
        'provider-call-failed',
        `这个适配器只认 ${Object.keys(SIZES_BY_MODEL).join(' / ')}，` +
          `当前 IMAGE_MODEL=「${modelId}」不在其中。换模型名，或者先把 script 里的适配器补上`,
      )
    }
    if (allowed.length === 0) {
      throw new EngineError(
        'provider-call-failed',
        `${modelId} 的实测尺寸表还是空的——这个模型一次都没量过，所以任何尺寸都不发请求` +
          `（一次 200 就是一张图的钱，不拿正式跑测当探测）。先跑 ` +
          `node scripts/probe-qwen-image.mts --model=${modelId} 量一遍`,
      )
    }
    if (!allowed.includes(size)) {
      throw new EngineError(
        'provider-call-failed',
        `尺寸 ${size} 不在 ${modelId} 的实测白名单里（白名单：${allowed.join(' / ')}）。` +
          `本接口一次 200 就扣一张图的钱，拒绝拿正式跑测当参数探测`,
      )
    }
  }

  /**
   * 两条路共用的收尾：找 URL → 立刻下字节 → 组 ImageResponse。
   * 分开写就会有一处忘了"地址会过期"这件事。
   *
   * ★ `referenceApplied` 是**读出来的**，不是传进来的常量：
   *   `usage.input_image_count` 是我们能拿到的最硬的凭据（T2I 为 0，I2I 按实际输入数回）。
   *   读不到 usage 就报 false——"没法确认"不许写成"确认了"。调用方拿到 false 会当场失败，
   *   这正是要的：宁可少画一页，也不要安静地存下一张"另一个孩子"的图。
   */
  async function finish(
    body: unknown,
    budget: CallBudget | undefined,
    requestedReference: boolean,
  ): Promise<ImageResponse> {
    /**
     * 取地址要**从 `output` 那棵子树里找**，不在整个响应体上递归找。
     *
     * 原生协议里输入与输出用的是同一个键名（`content[].image`）：请求里那个是 data URL，
     * 响应里那个是签名地址。在整份 body 上找 `image` 的话，一旦哪天响应把请求回显一份
     * （兼容模式就爱这么干），我们第一个捞到的会是**我们自己那张 2 MB 的 base64**——
     * 而症状是"下载了一个 data URL、存下一张谁都看不懂的字节"。
     */
    const output = (body as { output?: unknown } | null)?.output ?? body
    const url = findFirst(output, ['image', 'url', 'image_url'])
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new EngineError(
        'provider-call-failed',
        '图像响应里没有可用的媒体地址（字段层级可能变了）',
        {
          traceId: traceOf(body) || undefined,
          detail: body,
        },
      )
    }
    const { bytes, mime } = await fetchBytes(url, { signal: budget?.signal })
    const rawCost = findFirst(body, ['cost_cny', 'total_cost_cny'])
    // ★ `findFirst` 找不到时回 `null`，而 `Number(null)` 是 0——不先挡一下，
    //   "没报费用"会被记成"花了 0 元"，那是比缺一个数更坏的假读数
    const reported = rawCost === null ? Number.NaN : Number(rawCost)
    const inputImages = findFirst(body, ['input_image_count'])
    return {
      bytes,
      mime,
      modelId: String(findFirst(body, ['model']) ?? modelId),
      // 回传里有费用就用它；没有就用 env 给的那个；两个都没有就**不填**——
      //   `stats.totalCostCny` 因此会偏小，而"偏小且说得出为什么"比一个编出来的数强
      ...(Number.isFinite(reported)
        ? { costCny: reported }
        : unitCostCny !== undefined
          ? { costCny: unitCostCny }
          : {}),
      /** `request_id`：报障要报给厂商的那一串号。这条路上它真的在响应体里
       *  （兼容模式那条路只在 `x-request-id` 响应头，而共享底座不暴露响应头） */
      traceId: traceOf(body) || undefined,
      referenceApplied: requestedReference && typeof inputImages === 'number' && inputImages >= 1,
      // 临时地址与它的失效时刻随字节一起交上去，落盘后进 AssetRef 只作排障用
      originUrl: url,
      originExpiresAt: expiresAtOf(url) ?? undefined,
    }
  }

  /**
   * 两条路共用的请求体。★ 差别只有 content 数组里那一个 `{image}` 段，
   * 所以这里只有一个构造函数（上一家是两条路由 + 两个 body，这一家是一份 body 加一段）。
   */
  function bodyOf(req: ImageRequest, referenceDataUrl?: string): Record<string, unknown> {
    return {
      model: modelId,
      input: {
        messages: [
          {
            role: 'user',
            // 图在前、文字在后：文档示例就是这个次序（多图时按数组顺序定义图像顺序）
            content: [
              ...(referenceDataUrl ? [{ image: referenceDataUrl }] : []),
              { text: req.prompt },
            ],
          },
        ],
      },
      parameters: {
        // ★ 星号不是笔误：原生协议用 `宽*高`，`ImageRequest.size` 是全仓库统一的 `宽x高`
        size: nativeSizeOf(req.size),
        // 一次一张。多图（n>1）会让"一张图一次扣费"的记账与并发池的假设都不成立
        n: 1,
        // 显式发，不吃厂商默认（这家默认 true 且"建议开启"）：见 QwenImageOptions.promptExtend
        prompt_extend: promptExtend,
        // 负向提示词（只有 3.0 系列支持这一位，而我们的白名单里就是它）。
        //   ★ 为什么要有它：这家把正文写进画面过（见 `prompts/image.ts` 的
        //   `IMAGE_NEGATIVE_PROMPT`）。正向提示词里写"别写字"对它不够，这一位才是开关。
        ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
        ...(opts.extra ?? {}),
      },
    }
  }

  const edit = async (
    req: ImageRequest & { referenceDataUrl: string },
    budget?: CallBudget,
  ): Promise<ImageResponse> => {
    requireKey()
    requireMeasuredSize(req.size)
    const body = await payingCall(
      deps,
      {
        method: 'POST',
        // BASE_URL 约定已含 /api/v1（见 registry.ts 的 pathPrefix 判据）
        path: GENERATE_PATH,
        body: bodyOf(req, req.referenceDataUrl),
        signal: budget?.signal,
        timeoutMs: budget?.timeoutMs ?? timeoutMs,
      },
      backoffMs,
    )
    return finish(body, budget, true)
  }

  // `supportsReference` 不在这里手填：先造一个没有它的实现，再从"有没有 edit"推出来。
  //   写死 `true` 看着一样，但它和 `edit` 是两份各自独立的事实，删掉 edit 的时候
  //   不会有任何东西变红——那正是环境变量开关（IMAGE_SUPPORTS_REFERENCE）的病
  const implementation: Omit<ImageGenerator, 'supportsReference'> & {
    readonly supportsReference?: boolean
  } = {
    id: `qwen-image(${modelId})`,
    modelId,
    supportedRatios: [...new Set(allowed.map((size) => RATIO_OF_SIZE[size] ?? 'custom'))],
    async generate(req: ImageRequest, budget?: CallBudget): Promise<ImageResponse> {
      requireKey()
      requireMeasuredSize(req.size)
      // 带参考图进来就当场报错，不走"那就不带参考图画一张"。
      //   这家其实**有**参考图入口（同一条路上的 content 数组里多一段 `{image}`），
      //   所以要报的是"走错方法了"，不是"这家不支持"——两条消息混为一谈，
      //   下一个人会去改配置，而真正该改的是调用点（`edit()`）。
      if (req.referenceDataUrl) {
        throw new EngineError(
          'provider-call-failed',
          `这家要参考图请调 edit()（同一条 ${GENERATE_PATH}，多一段 {image}）；` +
            `拒绝把参考图悄悄丢掉继续画`,
        )
      }

      const body = await payingCall(
        deps,
        {
          method: 'POST',
          path: GENERATE_PATH,
          body: bodyOf(req),
          signal: budget?.signal,
          timeoutMs: budget?.timeoutMs ?? timeoutMs,
        },
        backoffMs,
      )
      return finish(body, budget, false)
    },
    edit,
  }

  return {
    ...implementation,
    // 这一行是推导，不是申报：`edit` 被删掉的那天它会自己变成 false
    supportsReference: supportsReferenceOf(implementation),
  }
}

/**
 * 从签名 URL 里读失效时刻。
 *
 * 三种参数名都读：`x-oss-expires`（相对秒数，上一家实测的）、`expires`、`Expires`。
 * ★ 最后一个不是凑数：百炼回的地址长这样 `…?Expires=1788…&OSSAccessKeyId=…`，
 *   而 `URLSearchParams.get()` **区分大小写**——只写小写的话这里会永远返回 null，
 *   症状是"排障时以为对方没给过期时间"，而其实是我们的读法少了一种。
 * 读不到就返回 null——不许拿"默认 24 小时"当事实，那只是文档里的一个观察值。
 */
function expiresAtOf(url: string): number | null {
  try {
    const params = new URL(url).searchParams
    const raw = params.get('x-oss-expires') ?? params.get('expires') ?? params.get('Expires')
    if (!raw) return null
    const seconds = Number(raw)
    if (!Number.isFinite(seconds)) return null
    // x-oss-expires 是相对秒数；Expires 是绝对 epoch 秒。两种都见过，按量级区分
    return seconds > 1_000_000_000 ? seconds * 1000 : Date.now() + seconds * 1000
  } catch {
    return null
  }
}
