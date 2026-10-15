/**
 * replay.ts —— 离线适配器与录制器（ADR-0003 的实现处）
 *
 * ADR-0003 说"一本已经生成好的书是资产，不是一次调用"，并且要求
 * **每个演示场景都有一条不依赖网络的成功路径**。这句话要能兑现，缺的不是
 * 意愿而是一个机制：把一次真跑过的结果**录下来**，之后原样**放回去**，
 * 且放回的路径与真跑的路径在类型上完全同构（同一个 ImageGenerator 接口）。
 *
 * 于是有了这一对：
 *
 * ```
 *  live 跑一次  →  record(inner)  把 (提示词指纹 → 落盘资产) 写进 manifest
 *  offline 演示 →  replay(manifest) 按同一个指纹取回，一次网络都不发
 * ```
 *
 * ★ 三个刻意的设计选择：
 * 1. **键是提示词的指纹，不是页号**。页号会因为重新规划而漂移，指纹不会；
 *    提示词改一个字，回放当场 miss 并报错——这是对的，宁可演示失败也不要
 *    放出一页与正文不匹配的图。
 * 2. **miss 不降级**。找不到就抛 `provider-not-configured`，绝不"那就现调 live 吧"。
 *    静默回退到网络，症状是"本地好好的，评审当天网络一抖就白屏"。
 * 3. 这一对同时是**测试替身**：单元测试跑 offline 路径，不花一分钱也不碰网络。
 *    「一个适配器是假想 seam，两个才是真 seam」——live 与 replay 就是那两个。
 */

import { digest } from '../digest.ts'
import type { AssetRef } from '../domain.ts'
import { EngineError } from '../errors.ts'
import type {
  AssetStore,
  CallBudget,
  ImageGenerator,
  ImageRequest,
  ImageResponse,
  StreamBudget,
  TextDelta,
  TextGenerator,
  TextRequest,
  TextResponse,
} from './types.ts'

const MANIFEST_VERSION = 1

type ImageEntry = {
  path: string
  mime: string
  digest: string
  modelId: string
  costCny?: number
}

type TextEntry = { text: string; modelId: string }

export type ReplayManifest = {
  version: number
  createdAt: number
  images: Record<string, ImageEntry>
  texts: Record<string, TextEntry>
}

export function emptyManifest(): ReplayManifest {
  return { version: MANIFEST_VERSION, createdAt: Date.now(), images: {}, texts: {} }
}

/** 请求指纹。分开写两条而不是一个泛型函数：两条的**参与字段**是语义决定，不是随手挑的 */
export function imageKey(req: ImageRequest): string {
  return digest([req.modelTag ?? '', req.size, req.prompt].join('\n'))
}

export function textKey(req: TextRequest): string {
  // 温度参与指纹：换温度就是换一次实验，回放时不许悄悄复用别的温度的结果
  return digest(
    [req.system, req.user, String(req.temperature ?? 0.7), String(req.jsonSchema ?? '')].join('\n'),
  )
}

/* ───────────────────────── 回放 ───────────────────────── */

export function createReplayImage(store: AssetStore, manifest: ReplayManifest): ImageGenerator {
  return {
    id: 'replay-image',
    modelId: 'pregenerated',
    supportedRatios: ['3:2', '3:4', '1:1'],
    // 回放不涉及锁脸能力：图是当初那张图。报 false 是为了让"要求参考图"的路径
    // 在离线模式下也走同一条 warning 分支，而不是假装支持。
    supportsReference: false,
    async generate(req: ImageRequest): Promise<ImageResponse> {
      const key = imageKey(req)
      const entry = manifest.images[key]
      if (!entry) {
        throw new EngineError(
          'provider-not-configured',
          `离线回放里没有这一页的图（指纹 ${key}）。` +
            `要么先用 live 跑一次并录制 manifest，要么改用 live —— 但绝不允许静默回退到网络`,
        )
      }
      const bytes = await store.read(entry.path)
      if (!bytes) {
        throw new EngineError('asset-write-failed', `manifest 指向的资产不存在：${entry.path}`)
      }
      return {
        bytes,
        mime: entry.mime,
        modelId: entry.modelId,
        costCny: 0,
        referenceApplied: false,
      }
    },
  }
}

export function createReplayText(store: AssetStore, manifest: ReplayManifest): TextGenerator {
  void store
  const lookup = (req: TextRequest): TextEntry => {
    const entry = manifest.texts[textKey(req)]
    if (!entry) {
      throw new EngineError(
        'provider-not-configured',
        `离线回放里没有这条规划结果（指纹 ${textKey(req)}）`,
      )
    }
    return entry
  }
  return {
    id: 'replay-text',
    modelId: 'recorded',
    async complete(req: TextRequest): Promise<TextResponse> {
      const entry = lookup(req)
      return { text: entry.text, modelId: entry.modelId }
    },

    /**
     * 回放的"流式"**是假的**，而且它照实说（工单 07 §一.2）。
     *
     * 录下来的本来就是一整段文本，没有"一段段到"这回事。这里一次把整段交出去，
     * 并标 `streamed: false`——界面据此就知道这一轮不该演打字机。
     *
     * ★ **不许用定时器把它切成一段段**。那是在演示里造假，而 ADR-0003 的演示路径
     *   的全部价值就是"屏幕上看到的是真的发生过的事"；
     *   一个用定时器装出来的打字机效果，证的是这一页想证的反面。
     */
    async stream(
      req: TextRequest,
      _budget: StreamBudget | undefined,
      onDelta: (delta: TextDelta) => void,
    ): Promise<TextResponse> {
      const entry = lookup(req)
      if (entry.text !== '') onDelta({ text: entry.text, streamed: false })
      return { text: entry.text, modelId: entry.modelId }
    },
  }
}

/* ───────────────────────── 录制 ───────────────────────── */

/**
 * 包一层，把每次成功调用写进 manifest。
 *
 * 只录**成功**的：失败的那次没有资产可放，录下来只会让回放期拿到一个空洞。
 * 失败信息属于横评报告（scripts/w1-*.ts 自己记），不属于资产。
 */
export function recordImage(
  inner: ImageGenerator,
  store: AssetStore,
  onEntry: (manifest: ReplayManifest) => Promise<void> | void,
  manifest: ReplayManifest = emptyManifest(),
): ImageGenerator {
  return {
    id: `record(${inner.id})`,
    modelId: inner.modelId,
    supportedRatios: inner.supportedRatios,
    supportsReference: inner.supportsReference,
    async generate(req: ImageRequest, budget?: CallBudget): Promise<ImageResponse> {
      const response = await inner.generate(req, budget)
      const asset = await store.put({
        path: `assets/${imageKey(req)}.img`,
        bytes: response.bytes,
        mime: response.mime,
        originUrl: response.originUrl,
        originExpiresAt: response.originExpiresAt,
      })
      manifest.images[imageKey(req)] = toImageEntry(asset, response.modelId, response.costCny)
      await onEntry(manifest)
      return response
    },
  }
}

export function recordText(
  inner: TextGenerator,
  onEntry: (manifest: ReplayManifest) => Promise<void> | void,
  manifest: ReplayManifest = emptyManifest(),
): TextGenerator {
  return {
    id: `record(${inner.id})`,
    modelId: inner.modelId,
    async complete(req: TextRequest, budget?: CallBudget): Promise<TextResponse> {
      const response = await inner.complete(req, budget)
      manifest.texts[textKey(req)] = { text: response.text, modelId: response.modelId }
      await onEntry(manifest)
      return response
    },
    /**
     * 录制时的流式：**原样转发**内层的 delta（包括那个 `streamed` 标志），
     * 录下来的仍然是那段完整文本。
     * ★ 转发标志而不是在这儿写死 `true`：标志的意思是"这串字是不是真从网络上一段段来的"，
     *   而这里包着的内层可能是任何实现。写死就等于替它回答了一个它才知道的问题。
     */
    async stream(
      req: TextRequest,
      budget: StreamBudget | undefined,
      onDelta: (delta: TextDelta) => void,
    ): Promise<TextResponse> {
      const response = await inner.stream(req, budget, onDelta)
      manifest.texts[textKey(req)] = { text: response.text, modelId: response.modelId }
      await onEntry(manifest)
      return response
    },
  }
}

function toImageEntry(asset: AssetRef, modelId: string, costCny?: number): ImageEntry {
  return { path: asset.path, mime: asset.mime, digest: asset.digest, modelId, costCny }
}

/** 读 manifest；文件不存在时给一个空的（首次跑 live 就是这个状态，不算错误） */
export async function loadManifest(store: AssetStore, path: string): Promise<ReplayManifest> {
  const raw = await store.readJson<Partial<ReplayManifest>>(path)
  if (!raw) return emptyManifest()
  if (raw.version !== MANIFEST_VERSION) {
    throw new EngineError(
      'provider-not-configured',
      `manifest 版本 ${String(raw.version)} 与当前 ${MANIFEST_VERSION} 不匹配，请重新录制`,
    )
  }
  return {
    version: MANIFEST_VERSION,
    createdAt: raw.createdAt ?? 0,
    images: raw.images ?? {},
    texts: raw.texts ?? {},
  }
}

/** 供排障与"提交前自查"用：manifest 指向的资产到底还在不在磁盘上 */
export async function auditManifest(
  store: AssetStore,
  manifest: ReplayManifest,
): Promise<string[]> {
  const missing: string[] = []
  for (const [key, entry] of Object.entries(manifest.images)) {
    if (!entry.path) missing.push(`${key}: 没有落盘路径`)
    else if (!(await store.exists(entry.path))) missing.push(`${key}: ${entry.path} 不在磁盘上`)
  }
  return missing
}
