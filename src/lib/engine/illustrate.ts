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
 * 2. **参考图没生效要当场喊**。带不带参考图由**策略**决定（`referenceForPages`，默认关），
 *    所以"这一页以为锁了脸其实没锁"是有可能发生的（策略开了、provider 却没有 `edit`）。
 *    症状是整本书画完才发现不像，而那时钱已经花完了——所以 `requireReference` 一旦为真，
 *    拿到 `referenceApplied === false` 就当场抛错，不画完再说。
 *    ★ 这条曾经指向"供应商的参考图字段还是未公开状态"；那句话已被推翻
 *    （`/images/edits` 实测通，见 tokenrhythm-image.ts 文件头）。但**这条纪律不跟着翻**：
 *    要喊的从来不是"这家不支持"，而是"你说要锁脸，这一页没锁"。
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
  /**
   * **这一本书的每一页**要不要拿角色卡的参考图去画（走 provider 的 `edit` 那条路）。
   *
   * ★ 默认关。这不是"能力没做出来"——`edits` 已经实测通了（工单 02 §一）——
   *   而是**三条都没量过**（第一条 2026-10-14 量到了一半，见下）：
   *     1. `edits` 那条路**没有 `size` 字段**（实测只送过 model/image/prompt 三个），
   *        所以产物尺寸由模型定。★ 现在知道了：**实测回来的是 1024×1024**
   *        （`scripts/e2e-image-reference.mts`，两次 1024²、约 1.8 MB、9.4s/9.8s），
   *        而页图是按 **1440²** 写的——也就是说开了这个开关，页图尺寸会变。
   *        变小的那 30% 对"书里那一页"够不够，**还是没看**，所以它仍然默认关；
   *     2. `edits` 扣多少钱没量过（generations 是一口价 0.20 元/张）；
   *     3. 一页一页带着参考图画，跨页一致性**到底提升多少**——这正是 ADR-0007 的赌注，
   *        要用比对器量出来，不能靠"支持了就该开"。
   *   所以它是一个**策略开关**，与"provider 有没有这个能力"（`supportsReference`）分开。
   *   量完之前开着它等于拿正式跑测当探测。
   */
  referenceForPages?: boolean
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

    // 走哪条路由由**策略**（referenceForPages）与**能力**（有没有 edit）同时决定。
    // ★ 两条都是显式分支，没有"传了但被忽略"那种中间状态：那种状态的症状
    //   是整本书画完才发现没锁脸，而那时钱已经花完了
    const edit = opts.referenceForPages === true ? opts.image.edit : undefined
    const response = edit
      ? await edit.call(opts.image, {
          prompt,
          size: DEFAULT_IMAGE_SIZE,
          referenceDataUrl: opts.referenceDataUrl,
        })
      : await opts.image.generate({ prompt, size: DEFAULT_IMAGE_SIZE })

    if (opts.requireReference && response.referenceApplied === false) {
      throw asEngineError(
        new Error(
          `这一页要求锁脸，但参考图没进请求（referenceForPages=${String(
            opts.referenceForPages === true,
          )}、供应商有 edit=${String(Boolean(opts.image.edit))}）。` +
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
    // ★ 比对**调用本身**失败（504 / 网络错 / 超时）必须与"比对给不出分"走同一条路。
    //   这里原来的写法是直接 await，异常会冒到 illustrateAll 的 catch——于是这一页
    //   连同**已经画完、已经付过钱的图**一起从书里消失：
    //
    //   实测（`node scripts/engine-run.mts --mode=live --pages=5`，2026-10-13）：
    //   5 页全部出图（磁盘上 8 张 PNG，含重画），但比对模型在 3 页上回 504/网络错，
    //   书里只剩 2 页，汇总行还写着"2/5 页有图"——那是假的，5/5 都有图。
    //
    //   这正是文件头第 1 条说的那种情况：**裁判没到场，不是选手没跑**。
    //   没到场就标"未核对"（降级 B 的入口，见第 1 条），图留着，书是完整的。
    let compared: Awaited<ReturnType<VisionComparator['compare']>>
    try {
      compared = await opts.vision.compare({
        referenceDataUrl: opts.referenceDataUrl,
        pageDataUrl,
        checklist: checklistOf(opts.card),
      })
    } catch (err) {
      lastConsistency = unjudgeable(
        node.pageNo,
        attempt,
        threshold,
        `比对调用没跑成，这一页没有核对过：${asEngineError(err).message}`,
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
