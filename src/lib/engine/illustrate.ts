/**
 * illustrate.ts —— ③ 逐页生成 + 一致性校验 + 重画（★ Agent 8 分的核心落点）
 *
 * 这一层是"自主决策"唯一真实存在的地方：它自己判断画得像不像、自己决定要不要重画、
 * 重画到第几次就交给人。三件事都必须在这一层，因为它们共用同一个循环。
 *
 * ★ 四条不显然的规则：
 *
 * 1. **比对模型不可用时绝不重试**。没有判据的重画是烧钱抽签：
 *    一次 0.20 元、结果无人判定、还把"首次通过率"这个数据污染成"我们重画过"。
 *    所以 `verdict = 'unavailable'` 直接结束这一页，并明确标记"这一页没核对过"。
 *    这是**降级 B**（角色卡锁定 + 家长逐页重画）的入口，不是失败。
 * 2. **参考图没生效要当场喊**。供应商的参考图字段还是未公开状态
 *    （见 tokenrhythm-image.ts），"以为锁了脸其实没锁"的症状是整本书画完才发现不像，
 *    而那时钱已经花完了。
 * 3. **失败的图也落盘**。家长要能看见"上一版为什么不像"，
 *    技术文档也要那批图当评测数据。删掉它们等于把过程藏起来。
 * 4. **重画次数是数据不是细节**：`firstPassCount / redrawCount` 直接喂
 *    §10.1 公式里的 r_redraw 与 #2 的"首次通过率 X% / 重画后 Y%"。
 */

import { pagePrompt, DEFAULT_IMAGE_SIZE, IMAGE_PROMPT_VERSION } from '../prompts/image.ts'
import { checklistOf } from './character-card/card.ts'
import { toDataUrl } from './providers/http.ts'
import { extensionOf } from './providers/stores.ts'
import type {
  CharacterCard,
  ConsistencyResult,
  Illustration,
  Provenance,
  StoryNode,
} from './domain.ts'
import type { EngineEventPayload } from './events.ts'
import { asEngineError } from './errors.ts'
import type { AssetStore, ImageGenerator, VisionComparator } from './providers/types.ts'

export const DEFAULT_THRESHOLD = 0.75
export const DEFAULT_MAX_ATTEMPTS = 3

export type IllustrateOptions = {
  image: ImageGenerator
  /** null = 没有比对能力，走"未核对"路径（见文件头第 1 条） */
  vision: VisionComparator | null
  store: AssetStore
  card: CharacterCard
  /** 角色卡参考图的 data URL，比对与锁脸都用它 */
  referenceDataUrl: string
  bookId: string
  /** 0–1。阈值靠人工判读校准，别把分数当结论（GLOSSARY「一致性分」） */
  threshold?: number
  maxAttempts?: number
  /** 一致性是这本书的命：要求参考图却没生效时，宁可当场失败也不要画完 20 页再说 */
  requireReference?: boolean
  emit: (payload: EngineEventPayload) => void
  now: () => number
}

export async function illustrateNode(
  node: StoryNode,
  opts: IllustrateOptions,
): Promise<Illustration> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const prompt = pagePrompt({
    card: opts.card,
    page: node.imagePrompt,
    scene: node.scene,
    mood: node.mood,
  })

  let lastAsset: Illustration['asset'] | null = null
  let lastConsistency: ConsistencyResult | undefined
  let provenance: Provenance | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    opts.emit({
      kind: 'stage',
      stage: 'illustrating',
      phase: 'begin',
      pageNo: node.pageNo,
      attempt,
      total: maxAttempts,
    })

    const response = await opts.image.generate({
      prompt,
      size: DEFAULT_IMAGE_SIZE,
      // 参考图只在供应商真的支持时才带：带一个被忽略的字段比不带更糟（见 requireReference）
      referenceDataUrl: opts.image.supportsReference ? opts.referenceDataUrl : undefined,
    })

    if (opts.requireReference && response.referenceApplied === false) {
      throw asEngineError(
        new Error(
          `供应商没有应用参考图（supportsReference=${opts.image.supportsReference}）。` +
            `一致性是这本书的命，拒绝在没锁脸的情况下继续画`,
        ),
      )
    }

    const asset = await opts.store.put({
      // 失败的图也留（文件头第 3 条），所以文件名带 attempt
      path: `books/${opts.bookId}/page-${node.pageNo}-a${attempt}${extensionOf(response.mime)}`,
      bytes: response.bytes,
      mime: response.mime,
      originUrl: response.originUrl,
      originExpiresAt: response.originExpiresAt,
    })
    lastAsset = asset
    provenance = {
      modelId: response.modelId,
      promptVersion: IMAGE_PROMPT_VERSION,
      cardRevision: opts.card.revision,
      generatedAt: opts.now(),
    }

    opts.emit({
      kind: 'illustration',
      stage: 'illustrating',
      pageNo: node.pageNo,
      attempt,
      assetPath: asset.path,
      modelId: response.modelId,
      costCny: response.costCny,
    })

    if (!opts.vision) {
      lastConsistency = unjudgeable(
        node.pageNo,
        attempt,
        threshold,
        '未配置视觉比对模型，这一页没有核对过',
      )
      opts.emit({
        kind: 'consistency',
        stage: 'checking',
        pageNo: node.pageNo,
        attempt,
        ...shape(lastConsistency),
      })
      break
    }

    const pageDataUrl = toDataUrl(response.bytes, response.mime)
    const compared = await opts.vision.compare({
      referenceDataUrl: opts.referenceDataUrl,
      pageDataUrl,
      checklist: checklistOf(opts.card),
    })

    const score = compared.score
    const verdict: ConsistencyResult['verdict'] =
      score === null ? 'unavailable' : score >= threshold ? 'pass' : 'fail'
    lastConsistency = {
      pageNo: node.pageNo,
      attempt,
      score,
      verdict,
      threshold,
      missedAnchors: compared.missed as ConsistencyResult['missedAnchors'],
      reason: compared.reason,
    }
    opts.emit({
      kind: 'consistency',
      stage: 'checking',
      pageNo: node.pageNo,
      attempt,
      ...shape(lastConsistency),
    })

    if (verdict === 'pass') break

    if (verdict === 'unavailable') {
      // 判不了就停手（文件头第 1 条）：重画是烧钱抽签
      break
    }

    if (attempt < maxAttempts) {
      opts.emit({
        kind: 'retry',
        stage: 'retrying',
        pageNo: node.pageNo,
        attempt,
        maxAttempts,
        reason: describeMiss(lastConsistency),
      })
    }
  }

  const asset =
    lastAsset ??
    (await opts.store.put({
      path: `books/${opts.bookId}/page-${node.pageNo}-missing.bin`,
      bytes: new Uint8Array(),
      mime: 'application/octet-stream',
    }))
  return {
    pageNo: node.pageNo,
    attempt: lastConsistency?.attempt ?? 1,
    asset,
    provenance: provenance ?? {
      modelId: opts.image.modelId,
      promptVersion: IMAGE_PROMPT_VERSION,
      cardRevision: opts.card.revision,
      generatedAt: opts.now(),
    },
    consistency: lastConsistency,
    // 没通过 ≠ 失败：交给人，书仍然完整（降级 B）
    needsHumanReview: lastConsistency === undefined || lastConsistency.verdict !== 'pass',
  }
}

/** 整本书的逐页生成。串行而不是并发：并发是 W2 的优化，判据要先把单页跑对 */
export async function illustrateAll(
  nodes: readonly StoryNode[],
  opts: IllustrateOptions,
): Promise<{ illustrations: Illustration[]; errors: { pageNo: number; message: string }[] }> {
  const illustrations: Illustration[] = []
  const errors: { pageNo: number; message: string }[] = []
  for (const node of nodes) {
    try {
      illustrations.push(await illustrateNode(node, opts))
    } catch (err) {
      const failure = asEngineError(err)
      // 一页失败不终止整条流（§5 失败语义），但记下来，书要标"这一页缺"
      errors.push({ pageNo: node.pageNo, message: failure.message })
      opts.emit({
        kind: 'error',
        stage: 'illustrating',
        pageNo: node.pageNo,
        code: failure.code,
        message: failure.message,
        fatal: false,
      })
    }
  }
  return { illustrations, errors }
}

function unjudgeable(
  pageNo: number,
  attempt: number,
  threshold: number,
  reason: string,
): ConsistencyResult {
  return {
    pageNo,
    attempt,
    score: null,
    verdict: 'unavailable',
    threshold,
    missedAnchors: [],
    reason,
  }
}

function shape(result: ConsistencyResult) {
  return {
    score: result.score,
    verdict: result.verdict,
    threshold: result.threshold,
    missedAnchors: result.missedAnchors,
  }
}

function describeMiss(result: ConsistencyResult): string {
  const score = result.score === null ? '判不了' : `相似度 ${result.score.toFixed(2)}`
  const anchors =
    result.missedAnchors.length > 0 ? `，不像的地方：${result.missedAnchors.join('、')}` : ''
  return `${score} 低于 ${result.threshold.toFixed(2)}${anchors}${result.reason ? `（${result.reason}）` : ''}`
}
