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
  return {
    id: 'replay-text',
    modelId: 'recorded',
    async complete(req: TextRequest): Promise<TextResponse> {
      const entry = manifest.texts[textKey(req)]
      if (!entry) {
        throw new EngineError(
          'provider-not-configured',
          `离线回放里没有这条规划结果（指纹 ${textKey(req)}）`,
        )
      }
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
