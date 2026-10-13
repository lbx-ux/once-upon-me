/**
 * tokenrhythm-image.ts —— 图像生成适配器（同步出图、当场扣费）
 *
 * ★ 三条来自实测的硬纪律，都写进了代码，不是写在注释里等人自觉：
 *
 * 1. **只允许白名单尺寸**。合法范围内仍有模型级白名单：`512x512` 被拒，
 *    而 `768x768` / `1280x720` / `1440x1440` / `2048x2048` 通过（模型.md §4）。
 *    所以这里在**发请求之前**就拦，而不是等 400。理由很硬：这个接口一次 200 就是
 *    一张图的钱，探测参数是拿钱试错。
 * 2. **拿到 URL 立即下载**。签名地址约 1 小时过期（§7），所以适配器内部完成
 *    `URL → 字节`，接口上不存在"只存链接"这条路。
 * 3. **超时不重试**（§10 第 8 条）。同步接口超时是"不知道有没有扣费"，
 *    重试可能翻倍。这里直接抛错，把决定权交给引擎（它会发一条 error 事件）。
 * 4. **参考图没有入口，带进来就报错，不许静默丢掉**。★ 这是实测结论，不是猜测：
 *    七个候选字段名（`image` / `image_url` / `reference_image` / `reference_images` /
 *    `images` / `input_image` / `content[]`）在 `wan2.7-image` 与 `qwen-image-2.0` 上
 *    **全部**被同一个错误挡回：`HTTP 400 · BAD_REQUEST · 请求包含未知字段`。
 *    探针脚本 `scripts/probe-image-reference.mts`（送假值探字段名，一次都不扣费——
 *    因为这个接口**未知字段必拒**，所以字段名可以零成本枚举）。
 *
 *    所以 ADR-0007 那条"用参考图锁脸"的链路，**在这一家上是空的**：
 *    跨页一致性目前只能靠 `promptFragmentOf(card)` 那段文字锚点。
 *    曾经这里做成可配置（`referenceField`），代价是"开了开关但字段名没填对"时
 *    参考图被悄悄丢掉、页面什么都看不出来——那比报错贵得多，
 *    症状是整本书画完才发现不像，而那时钱已经花完了。
 *
 *    ★ 未核实的一件事：**平台是否另有图生图 / 图像编辑接口**。
 *    本文件说的只是"`/images/generations` 这个接口没有参考图字段"，
 *    不等于"这家做不了图生图"。换供应商是另一回事（GPT-Image-2 已证支持参考图）。
 *
 * ⚠️ 这个接口在官方文档里**一个字都没提**（模型.md §0），字段可能变动，
 *    所以取字段一律走 `http.ts` 的递归查找，不硬编码 `data[0].url`。
 */

import { EngineError } from '../errors.ts'
import type { CallBudget, ImageGenerator, ImageRequest, ImageResponse } from './types.ts'
import { fetchBytes, findFirst, requestJson, traceOf, type HttpDeps } from './http.ts'

/**
 * 实测通过的尺寸（2026-10-12，真实 Key）。
 * 不在表里的尺寸**不发请求**——发出去可能就是 0.20 元。
 * 要扩充白名单：先确认那是你真正要用的尺寸，再一次性把它测掉，别拿正式跑测当探测。
 */
export const SIZES_BY_MODEL: Record<string, readonly string[]> = {
  'wan2.7-image': ['768x768', '1024x1024', '1280x720', '1440x1440', '2048x2048'],
  'qwen-image-2.0': ['768x768', '1024x1024', '1280x720', '1440x1440', '2048x2048'],
}

/** 尺寸 → 比例。3:2 与 3:4 是产品要的两个档（封面 3:4、跨页 3:2） */
const RATIO_OF_SIZE: Record<string, string> = {
  '768x768': '1:1',
  '1024x1024': '1:1',
  '1440x1440': '1:1',
  '2048x2048': '1:1',
  '1280x720': '16:9',
}

export type TokenrhythmImageOptions = {
  /**
   * 支持参考图与否。**实测结论是 false**，理由见文件头第 4 条。
   *
   * 这个开关留着只为换供应商时少改一处：填 `1` 而这家仍不支持，
   * `generate()` 会在带参考图时**直接报错**，不会把参考图悄悄丢掉。
   * 曾经这里还配一个 `referenceField` 让你填字段名——删了，
   * 因为"字段名没填对"的表现是静默降级，而不是失败。
   */
  supportsReference?: boolean
  /** 一口价 0.20 元/张（实测，与尺寸无关）。回传缺 cost_cny 时用这个兜底记账 */
  unitCostCny?: number
  extra?: Record<string, unknown>
}

export function createTokenrhythmImage(
  deps: HttpDeps,
  modelId: string,
  opts: TokenrhythmImageOptions = {},
): ImageGenerator {
  const allowed = SIZES_BY_MODEL[modelId] ?? []
  const unitCostCny = opts.unitCostCny ?? 0.2
  return {
    id: `tokenrhythm-image(${modelId})`,
    modelId,
    supportsReference: opts.supportsReference ?? false,
    supportedRatios: [...new Set(allowed.map((size) => RATIO_OF_SIZE[size] ?? 'custom'))],
    async generate(req: ImageRequest, budget?: CallBudget): Promise<ImageResponse> {
      if (!deps.apiKey) {
        throw new EngineError('provider-not-configured', 'IMAGE_API_KEY 未配置，图像能力不可用')
      }
      if (allowed.length > 0 && !allowed.includes(req.size)) {
        throw new EngineError(
          'provider-call-failed',
          `尺寸 ${req.size} 不在 ${modelId} 的实测白名单里（白名单：${allowed.join(' / ')}）。` +
            `本接口一次 200 就扣一张图的钱，拒绝拿正式跑测当参数探测`,
        )
      }

      const payload: Record<string, unknown> = {
        model: modelId,
        // ★ 图像接口是顶层 prompt 字符串，与视频接口的 content[] 数组**不同构**，
        //   两个接口不能共用请求构造代码（模型.md §4、§10 第 5 条）
        prompt: req.prompt,
        size: req.size,
        ...(opts.extra ?? {}),
      }
      // ★ 带参考图进来就**当场报错**，不走"那就不带参考图画一张"。
      //   被忽略的参考图会让整本书"看着像已经在锁脸了"——那是比报错贵得多的失败：
      //   症状要到 20 页画完、家长说"这不像我孩子"时才浮出来，而那时钱已经花完了。
      //   实测依据见文件头第 4 条（七个字段名 × 两个模型全部 400「请求包含未知字段」）。
      if (req.referenceDataUrl) {
        throw new EngineError(
          'provider-call-failed',
          `${modelId} 所在的图像接口没有参考图字段（实测：任何未知字段都会 ` +
            `400「请求包含未知字段」，七个候选字段名无一例外，见本文件头第 4 条）。` +
            `本次请求带了参考图，拒绝降级成"不带参考图继续画"——` +
            `跨页一致性目前只能靠 prompt 里的角色锚点段。` +
            `要真用参考图，得换一家支持图生图的供应商（GPT-Image-2 已证支持）`,
        )
      }
      const referenceApplied = false

      const body = await requestJson(deps, {
        method: 'POST',
        // BASE_URL 约定已含 /v1（见 registry.ts），所以这里只写资源段
        path: '/images/generations',
        body: payload,
        signal: budget?.signal,
        timeoutMs: budget?.timeoutMs ?? 180_000,
      })

      const url = findFirst(body, ['url', 'image_url'])
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

      const expiresAt = expiresAtOf(url)
      const { bytes, mime } = await fetchBytes(url, { signal: budget?.signal })

      const cost = findFirst(body, ['cost_cny', 'total_cost_cny'])
      return {
        bytes,
        mime,
        modelId: String(findFirst(body, ['model']) ?? modelId),
        costCny:
          typeof cost === 'number' ? cost : typeof cost === 'string' ? Number(cost) : unitCostCny,
        providerTaskId: (() => {
          const id = findFirst(body, ['image_id', 'id'])
          return id === null ? undefined : String(id)
        })(),
        traceId: traceOf(body) || undefined,
        referenceApplied,
        // 临时地址与它的失效时刻随字节一起交上去，落盘后进 AssetRef 只作排障用
        originUrl: url,
        originExpiresAt: expiresAt ?? undefined,
      }
    },
  }
}

/**
 * 从签名 URL 里读失效时刻（实测参数名 `x-oss-expires`，值是**剩余秒数**）。
 * 读不到就返回 null —— 不许拿"默认 1 小时"当事实，那只是个观察值。
 */
function expiresAtOf(url: string): number | null {
  try {
    const raw =
      new URL(url).searchParams.get('x-oss-expires') ?? new URL(url).searchParams.get('expires')
    if (!raw) return null
    const seconds = Number(raw)
    if (!Number.isFinite(seconds)) return null
    // x-oss-expires 是相对秒数；expires 是绝对 epoch 秒。两种都见过，按量级区分
    return seconds > 1_000_000_000 ? seconds * 1000 : Date.now() + seconds * 1000
  } catch {
    return null
  }
}
