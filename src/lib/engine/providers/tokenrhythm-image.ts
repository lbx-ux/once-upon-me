/**
 * tokenrhythm-image.ts —— 图像生成适配器（同步出图、当场扣费）
 *
 * 四条来自实测的硬纪律，都写进了代码，不是写在注释里等人自觉：
 *
 * 1. 只允许白名单尺寸。合法范围内仍有模型级白名单：`512x512` 被拒，
 *    而 `768x768` / `1280x720` / `1440x1440` / `2048x2048` 通过（模型.md §4）。
 *    所以这里在发请求之前就拦，而不是等 400。理由很硬：这个接口一次 200 就是
 *    一张图的钱，探测参数是拿钱试错。
 * 2. 拿到 URL 立即下载。签名地址约 1 小时过期（§7），所以适配器内部完成
 *    `URL → 字节`，接口上不存在"只存链接"这条路。
 * 3. 超时不重试（§10 第 8 条）。同步接口超时是"不知道有没有扣费"，
 *    重试可能翻倍。这里直接抛错，把决定权交给引擎（它会发一条 error 事件）。
 * 4. `generate` 这条路上没有参考图字段，带进来就报错，不许静默丢掉。
 *    七个候选字段名（`image` / `image_url` / `reference_image` / `reference_images` /
 *    `images` / `input_image` / `content[]`）在 `wan2.7-image` 与 `qwen-image-2.0` 上
 *    全部被同一个错误挡回：`HTTP 400 · BAD_REQUEST · 请求包含未知字段`。
 *
 * 但参考图这条路是有的：`/images/edits`（2026-10-14 实测，见下）
 *
 * 上面第 4 条曾经被写成"这家做不了图生图"。那是错的，而且错得很典型：
 * W1 只在 `/images/generations` 上枚举字段名，从没试另一条路由，
 * 于是把"我们没找到入口"记成了"模型吃不了参考图"，
 * 这句话还一路长进了界面文案（创作流第 1 步）。
 *
 * 实测（`IMAGE_MODEL=wan2.7-image`，工单 02 §一 有全表）：
 *
 * | 送什么 | 回什么 |
 * | --- | --- |
 * | `POST /images/edits` + 1×1 像素 | `400 IMAGE_INPUT_DIMENSIONS_INVALID`：参考图宽高必须在 240～8000 像素之间 |
 * | 同上，带 alpha 的 1440² PNG | `400 IMAGE_INPUT_ALPHA_UNSUPPORTED`：不支持带透明通道的 PNG |
 * | 同上，压平白底的 1440² PNG | `200`，15.0s，一张 2.27 MB PNG |
 *
 * 那两条错误码是语义错误（尺寸、alpha），不是"字段不认识"——
 * 服务端真的在解析这张图。这也是 `image/normalize.ts` 存在的理由：
 * 它把这两个 400 在送出去之前就地解决掉，于是它们只可能是 bug。
 *
 * ⚠️ 这个接口在官方文档里一个字都没提（模型.md §0），字段可能变动，
 *    所以取字段一律走 `http.ts` 的递归查找，不硬编码 `data[0].url`。
 */

import { EngineError } from '../errors.ts'
import type { CallBudget, ImageGenerator, ImageRequest, ImageResponse } from './types.ts'
import { fetchBytes, findFirst, requestJson, traceOf, type HttpDeps } from './http.ts'

/**
 * 实测通过的尺寸。不在表里的尺寸不发请求——发出去可能就是 0.20 元。
 * 要扩充白名单：先确认那是你真正要用的尺寸，再一次性把它测掉，别拿正式跑测当探测。
 *
 * 2026-10-15 扩充 `1536x1024`（3:2 跨页）与 `1152x1536`（3:4 封面）。
 *   两个都是各发一次真请求测的，回来得与请求分毫不差（读 PNG 的 IHDR 宽高比对，
 *   不是只看 HTTP 200），各约 9.5s。
 *
 * 只加在 `wan2.7-image` 上——我只测了这个模型。`qwen-image-2.0` 那张表原样不动：
 *   白名单是模型级的，把在 A 上测过的尺寸抄给 B，就是这条纪律要防的那种事。
 *
 * ★ 顺带记一次自己踩的坑：我先把 `DEFAULT_IMAGE_SIZE` 改成了 3:2，然后直接开跑，
 *   被这张表在发请求前拦住了（三页全退回 + 封面抛错），一分钱没花。
 *   探针能过是因为它绕开了这层适配器直接打接口——**测出来的结论是对的，
 *   但"接口收这个尺寸"和"我们能发这个尺寸"是两件事**。
 */
export const SIZES_BY_MODEL: Record<string, readonly string[]> = {
  'wan2.7-image': [
    '768x768',
    '1024x1024',
    '1280x720',
    '1440x1440',
    '2048x2048',
    '1536x1024',
    '1152x1536',
  ],
  'qwen-image-2.0': ['768x768', '1024x1024', '1280x720', '1440x1440', '2048x2048'],
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

/** `edits` 那条路上实测只送过三个字段：model / image / prompt */
const EDIT_PATH = '/images/edits'
const GENERATE_PATH = '/images/generations'

export type TokenrhythmImageOptions = {
  /** 一口价 0.20 元/张（实测，与尺寸无关）。回传缺 cost_cny 时用这个兜底记账
   *  `edits` 那条路扣多少没量过，所以现在仍按这一口价记——见工单 02 的"欠着的"
   */
  unitCostCny?: number
  extra?: Record<string, unknown>
}

/**
 * 能力 = "有没有 edit 这条方法"。
 *
 * 单独一个导出函数，是为了让这条关系可被证伪：测试能拿一个没有 edit 的实现
 *   调它并看到 false，而"字面量 true"是没法这样测的——它只会在被漏改的那天不响。
 * 不读环境变量：那个开关（`IMAGE_SUPPORTS_REFERENCE`）是 W1 错误结论的化石，
 *   已随工单 02 删除。
 */
export function supportsReferenceOf(impl: { edit?: unknown }): boolean {
  return typeof impl.edit === 'function'
}

export function createTokenrhythmImage(
  deps: HttpDeps,
  modelId: string,
  opts: TokenrhythmImageOptions = {},
): ImageGenerator {
  const allowed = SIZES_BY_MODEL[modelId] ?? []
  const unitCostCny = opts.unitCostCny ?? 0.2

  /** 两条路共用的收尾：找 URL → 立刻下字节 → 组 ImageResponse。
   *  分开写就会有一处忘了"URL 一小时过期"这件事
   */
  async function finish(
    body: unknown,
    budget: CallBudget | undefined,
    referenceApplied: boolean,
  ): Promise<ImageResponse> {
    const url = findFirst(body, ['url', 'image_url'])
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new EngineError(
        'provider-call-failed',
        '图像响应里没有可用的媒体地址（字段层级可能变了）',
        { traceId: traceOf(body) || undefined, detail: body },
      )
    }
    const expiresAt = expiresAtOf(url)
    const { bytes, mime } = await fetchBytes(url, { signal: budget?.signal })
    const cost = findFirst(body, ['cost_cny', 'total_cost_cny'])
    const id = findFirst(body, ['image_id', 'id'])
    return {
      bytes,
      mime,
      modelId: String(findFirst(body, ['model']) ?? modelId),
      costCny:
        typeof cost === 'number' ? cost : typeof cost === 'string' ? Number(cost) : unitCostCny,
      providerTaskId: id === null ? undefined : String(id),
      traceId: traceOf(body) || undefined,
      referenceApplied,
      // 临时地址与它的失效时刻随字节一起交上去，落盘后进 AssetRef 只作排障用
      originUrl: url,
      originExpiresAt: expiresAt ?? undefined,
    }
  }

  function requireKey(): void {
    if (!deps.apiKey) {
      throw new EngineError('provider-not-configured', 'IMAGE_API_KEY 未配置，图像能力不可用')
    }
  }

  const edit = async (
    req: ImageRequest & { referenceDataUrl: string },
    budget?: CallBudget,
  ): Promise<ImageResponse> => {
    requireKey()
    const body = await requestJson(deps, {
      method: 'POST',
      // BASE_URL 约定已含 /v1（见 registry.ts），所以这里只写资源段
      path: EDIT_PATH,
      // 只送这三个字段：`size` 在这条路上没测过，不猜。
      //   代价是产物尺寸由模型定，所以"页图也走这条路"这件事要先量再开
      //   （见 illustrate.ts 的 referenceForPages 那一段）
      body: { model: modelId, image: req.referenceDataUrl, prompt: req.prompt },
      signal: budget?.signal,
      // 实测一次 15.0s。阈值给到 3 倍它：一次抖动不该杀掉一整页
      timeoutMs: budget?.timeoutMs ?? 45_000,
    })
    return finish(body, budget, true)
  }

  // `supportsReference` 不在这里手填：先造一个没有它的实现，再从"有没有 edit"
  //   推出来。写死 `true` 看着一样，但它和 `edit` 是两份各自独立的事实，
  //   删掉 edit 的时候不会有任何东西变红——那正是环境变量开关（IMAGE_SUPPORTS_REFERENCE）
  //   的病，换成一个字面量并不会好。现在删 edit，这一位自己就翻了。
  const implementation: Omit<ImageGenerator, 'supportsReference'> & {
    readonly supportsReference?: boolean
  } = {
    id: `tokenrhythm-image(${modelId})`,
    modelId,
    supportedRatios: [...new Set(allowed.map((size) => RATIO_OF_SIZE[size] ?? 'custom'))],
    async generate(req: ImageRequest, budget?: CallBudget): Promise<ImageResponse> {
      requireKey()
      if (allowed.length > 0 && !allowed.includes(req.size)) {
        throw new EngineError(
          'provider-call-failed',
          `尺寸 ${req.size} 不在 ${modelId} 的实测白名单里（白名单：${allowed.join(' / ')}）。` +
            `本接口一次 200 就扣一张图的钱，拒绝拿正式跑测当参数探测`,
        )
      }
      // 带参考图进来就当场报错，不走"那就不带参考图画一张"。
      //   被忽略的参考图会让整本书"看着像已经在锁脸了"——那是比报错贵得多的失败：
      //   症状要到 20 页画完、家长说"这不像我孩子"时才浮出来，而那时钱已经花完了。
      //   要参考图，走 `edit()`（同一家、另一条路由，实测通）。
      if (req.referenceDataUrl) {
        throw new EngineError(
          'provider-call-failed',
          `${GENERATE_PATH} 这条路上没有参考图字段（实测：任何未知字段都会 400「请求包含未知字段」）。` +
            `带参考图请调 edit()；拒绝把参考图悄悄丢掉继续画`,
        )
      }

      const body = await requestJson(deps, {
        method: 'POST',
        path: GENERATE_PATH,
        body: {
          model: modelId,
          // 图像接口是顶层 prompt 字符串，与视频接口的 content[] 数组不同构，
          //   两个接口不能共用请求构造代码（模型.md §4、§10 第 5 条）
          prompt: req.prompt,
          size: req.size,
          ...(opts.extra ?? {}),
        },
        signal: budget?.signal,
        timeoutMs: budget?.timeoutMs ?? 180_000,
      })
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
 * 从签名 URL 里读失效时刻（实测参数名 `x-oss-expires`，值是剩余秒数）。
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
