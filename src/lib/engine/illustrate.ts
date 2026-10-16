/**
 * illustrate.ts —— ③ 逐页生成 + 一致性校验 + 重画（★ Agent 8 分的核心落点）
 *
 * 这一层是"自主决策"唯一真实存在的地方：它自己判断画得像不像、自己决定要不要重画、
 * 重画到第几次就交给人。三件事都必须在这一层，因为它们共用同一个循环。
 *
 * ★ 五条不显然的规则：
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
 * 5. **已经拿到的图不因后续失败而丢**（2026-10-16 补）。出图与落盘那两跳抛异常时，
 *    只要手上有过一张画完的图，那一页就该是"图在这儿、只是没通过比对"，
 *    而不是"这一页没做出来"——后者是**假话**。判据与实测见 `produceFailed`。
 *    ★ 与第 3 条同源：第 3 条管"失败的图别删"，第 5 条管"别把它从书里摘出去"。
 */

import {
  pagePrompt,
  coverPrompt,
  DEFAULT_IMAGE_SIZE,
  COVER_IMAGE_SIZE,
  IMAGE_PROMPT_VERSION,
} from '../prompts/image.ts'
import { checklistOf } from './character-card/card.ts'
import { toDataUrl } from './providers/http.ts'
import { extensionOf } from './providers/stores.ts'
import type {
  CharacterCard,
  ConsistencyResult,
  Cover,
  Illustration,
  Provenance,
  StoryNode,
} from './domain.ts'
import type { EngineEventPayload } from './events.ts'
import { asEngineError } from './errors.ts'
import type {
  AssetStore,
  ImageGenerator,
  ImageResponse,
  VisionComparator,
} from './providers/types.ts'

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
  /**
   * 这一次的尝试**从第几次接着数**（缺省 0 = 从第 1 次起）。给**单页重画**用（工单 01 §3.1）。
   *
   * ★ 为什么不是一个好看的选项而是必须的：文件名是 `page-{n}-a{attempt}` 拼的，
   *   重画时若从 1 重来，`a1` 会把**上一次那张**覆盖掉——而"失败的图也落盘"是这条
   *   流水线写明的纪律（文件头第 3 条：家长要能看见"上一版为什么不像"）。
   *   接着数之后，文件继续叫 `page-7-a4.png`，事件里的 `attempt` 也仍然是**真的第几次**。
   *
   * ★ 它同时改了事件里报出的**上界**：`retry` 的 `maxAttempts` 与 `stage` 的 `total`
   *   报的是 `attemptBase + maxAttempts`。不这样的话，第 3 次重画那条事件会念成
   *   "第 4 / 3 次"——一个自相矛盾的数字，而屏幕上没有任何东西会提示它是错的。
   */
  attemptBase?: number
  /**
   * 家长对**这一页**这一次重画的补充（"上一版哪里不对"）。见 `pagePrompt` 的 `fixNote`。
   * ★ 它只进 prompt，**不进任何记录**：`provenance` 记的是模型、模板版本、卡版本，
   *   而这句话是人的一句话，进不了那几个字段里的任何一个。要追"这一版为什么长这样"，
   *   读的是 `events.jsonl` 里那几页前后的事件，不是清单。
   */
  fixNote?: string
  /**
   * 这一页的**主角称呼**（小男孩 / 小女孩 / 孩子），由 `childWordOf` 从"选的性别 + 外貌标签"
   * 算出来。见 `pagePrompt` 的 `childWord` 那段（它是 2026-10-16 那条
   * "8 页里既有男孩也有女孩"报障的**根因所在**：这个名字以前只进标准像，不进逐页 prompt）。
   *
   * ★ 由调用方给而不是在这里算：`illuminateNode` 手上只有**卡**，而卡的锚点里
   *   一个性别词都没有（实测那张卡就是）。算得出它的是孩子那份档案。
   */
  childWord?: string
  emit: (payload: EngineEventPayload) => void
  now: () => number
}

export async function illustrateNode(
  node: StoryNode,
  opts: IllustrateOptions,
): Promise<Illustration> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  /** 这一次的尝试编号区间。缺省就是 1..maxAttempts（见 `attemptBase` 那段） */
  const firstAttempt = (opts.attemptBase ?? 0) + 1
  const lastAttempt = firstAttempt + maxAttempts - 1
  const prompt = pagePrompt({
    card: opts.card,
    page: node.imagePrompt,
    scene: node.scene,
    mood: node.mood,
    ...(opts.fixNote ? { fixNote: opts.fixNote } : {}),
    // ★ 身份那一行（"整本书就是这个孩子"）**总是**进 prompt；`childWord` 只是把
    //   "那个孩子"写成"那个孩子（小男孩）"。所以这里不是"有才加"，见 `pagePrompt` 那段
    ...(opts.childWord ? { childWord: opts.childWord } : {}),
  })

  let lastAsset: Illustration['asset'] | null = null
  let lastConsistency: ConsistencyResult | undefined
  let provenance: Provenance | null = null

  /**
   * 这一页这一次一共实付了多少（元），**逐次累加**。
   *
   * ★ 2026-10-16 补上。在这之前这一页的 `costCny` **从来没人填**：钱只进了
   *   `illustration` 事件（给界面看的），`Illustration` 上那个字段一直是 `undefined`——
   *   而 `summarize()` 的 `totalCostCny` 正是从 `illustrations` 里加出来的，
   *   于是**每一本书的成本都是 0.00**。`scripts/web-run.mts` 头部把这条记成了
   *   "已知缺口"，现在缺口补上，那段话也跟着改了。
   *
   * ★ 口径与 `imageCalls` 一致：**钱已经花了**，所以重画过几次就记几次，
   *   不是"最后那一张多少钱"。只记成功的调用——抛异常的那次由
   *   `ImageResponse` 之外的路径出去，供应商那边同样计费，但这里**没有数可记**
   *   （拿不到回执），凭空按单价乘一笔才是编造。
   *
   * `undefined` 与 `0` 在这里是一件事（都没有记账），所以用 `undefined` 表示
   *   "供应商一个价都没报"，返回时省略该字段——与 `illustrateCover` 同一个写法。
   */
  let spentCny: number | undefined

  /**
   * 重画中途停手的记录（没有就是 null）。最后并进 `consistency.reason`，见那段。
   *
   * ★ 它**不进 `errors`**：那个字段的口径是"这一页没有图"，而这一页有图。
   *   两件事合成一条，以后就分不出"这一页没做出来"与"这一页做出来了、只是重画被打断"
   *   ——同一条教训见 `index.ts` 里 `narrations` 那段注释（"一个字段只有一种含义"）。
   */
  let redrawStop: { attempt: number; message: string } | null = null

  /**
   * 这一次尝试**没产出图**（出图那一步或落盘那一步抛了）。要么记下来，要么往上抛。
   *
   * ★ 这条 catch 是 2026-10-16 补的，理由与下面比对那条**完全同源**：
   *   比对那一处原来没有 catch，异常冒到 `illustrateAll`，于是"已经画完、已经付过钱的图
   *   跟着整页一起从书里消失"。当时只修了比对那一跳，**真正出图与下图那两跳没修**——
   *   而它们才是每一页必然要走的。
   *
   *   实测（`.out/web/books/xiaolu-r1-ee69012def18`，2026-10-16）：第 6 页第 1 次画好了
   *   （`page-6-a1.png`，1536×1024、3.0 MB 就躺在磁盘上），比对没过 → 重画 →
   *   第 2 次在**下图那一跳**撞上 `ECONNRESET` → 整页变成 `errors` 里的一条，
   *   而阅读器上那句话是"这一页没做出来"——**假的，它做出来了**。
   *
   * 判据只有一条：**已经拿到的 asset 不许因为后面这一次失败而丢**。
   * 拿不到（第 1 次就没成）时照旧抛出去——那一页才是真的没有图。
   *
   * ★ 它**返回**这条记录而不是自己写 `redrawStop`：闭包里的赋值 TypeScript 看不见，
   *   会在后面把 `redrawStop` 判成"永远是 null"（实测报 `Property 'attempt' does not
   *   exist on type 'never'`）。写回调用点，CFA 才跟得上——这不是风格，是不报红的必要条件。
   *
   * ★ 产出失败后**不再往下一次尝试**，两个方向都是刻意的：
   *   - 出图那一步是"生成 + 下载"**一次调用**，它抛出来时字节已经没了，再来一次就是
   *     重新付一次钱；而"服务端可能已经建单"正是 `http.ts` 里 `ECONNRESET` 不许重试要防的事。
   *   - 重试安全的那几种（DNS 解析不了 / 连接被拒 / 连接超时）**已经在 `requestJson`
   *     里重试过一次**。连着两次都是安全类失败，那是中断不是抖动
   *     （参考 10-15 那次约 36 分钟的本机网络中断），多试一次救不回来。
   *   所以"第 1 次彻底失败、第 2 次成功"**在现在的语义下不会发生**：不是漏了，是不该。
   */
  const produceFailed = (err: unknown, attempt: number): { attempt: number; message: string } => {
    const failure = asEngineError(err)
    // 没得可留：这一页确实什么都没有，交回 illustrateAll（记 errors、书标"这一页缺"）
    if (!lastAsset) throw err
    opts.emit({
      kind: 'error',
      stage: 'illustrating',
      pageNo: node.pageNo,
      code: failure.code,
      message:
        `第 ${node.pageNo} 页的重画没跑成（第 ${attempt} 次尝试）：${failure.message}。` +
        `书上留的是第 ${lastConsistency?.attempt ?? 1} 次那张——它只是没通过比对，` +
        `不是"没做出来"`,
      fatal: false,
    })
    return { attempt, message: failure.message }
  }

  for (let attempt = firstAttempt; attempt <= lastAttempt; attempt += 1) {
    opts.emit({
      kind: 'stage',
      stage: 'illustrating',
      phase: 'begin',
      pageNo: node.pageNo,
      attempt,
      total: lastAttempt,
    })

    // 走哪条路由由**策略**（referenceForPages）与**能力**（有没有 edit）同时决定。
    // ★ 两条都是显式分支，没有"传了但被忽略"那种中间状态：那种状态的症状
    //   是整本书画完才发现没锁脸，而那时钱已经花完了
    const edit = opts.referenceForPages === true ? opts.image.edit : undefined

    // ── ① 出图。失败走 produceFailed：有旧图就留着，没有就抛 ──────────────
    let response: ImageResponse
    try {
      response = edit
        ? await edit.call(opts.image, {
            prompt,
            size: DEFAULT_IMAGE_SIZE,
            referenceDataUrl: opts.referenceDataUrl,
          })
        : await opts.image.generate({ prompt, size: DEFAULT_IMAGE_SIZE })
    } catch (err) {
      redrawStop = produceFailed(err, attempt)
      break
    }

    // ★ 先记账再判断——钱在这一行之前就已经花掉了。记在这里（而不是事件那一段）
    //   的理由：事件那一段在下面几十行，中间有 `requireReference` 的抛与落盘失败两条出口，
    //   从那儿记账会把"这一次已经付过钱"漏掉。
    if (response.costCny !== undefined) {
      spentCny = (spentCny ?? 0) + response.costCny
    }

    /**
     * ★ 锁脸没生效**不交给 `produceFailed`**，哪怕手上已经有一张旧图。
     *   这一条是**想过之后**才这么写的，不是漏了：`referenceApplied` 是"这一次请求
     *   是怎么发的"的属性，而它由**策略与能力**决定——同一个 provider 在同一个循环里
     *   不会第 1 次锁上了、第 2 次没锁。所以它实际只会在第 1 次触发，
     *   而第 1 次手上必然没有旧图（`produceFailed` 也会抛）。两条路在这里重合。
     *   保留"无条件抛"是为了让文件头第 2 条那句话**不被降级路径盖住**：
     *   它要喊的是"这一页没锁脸"，而"用上一张"正好会把这句话咽下去。
     */
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

    // ── ② 落盘。同样：失败时已经有图就留着，没有就抛 ────────────────────
    let asset: Illustration['asset']
    try {
      asset = await opts.store.put({
        // 失败的图也留（文件头第 3 条），所以文件名带 attempt
        path: `books/${opts.bookId}/page-${node.pageNo}-a${attempt}${extensionOf(response.mime)}`,
        bytes: response.bytes,
        mime: response.mime,
        originUrl: response.originUrl,
        originExpiresAt: response.originExpiresAt,
      })
    } catch (err) {
      redrawStop = produceFailed(err, attempt)
      break
    }

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

    if (attempt < lastAttempt) {
      opts.emit({
        kind: 'retry',
        stage: 'retrying',
        pageNo: node.pageNo,
        attempt,
        maxAttempts: lastAttempt,
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

  /**
   * 判决连同"为什么最后停在第 attempt 次"一起说清。
   *
   * ★ 这一句是给**几个月后翻 `book.json` 的人**写的：没有它，一页 `verdict: 'fail'`
   *   配 `attempt: 1` 完全看不出"后面还画过、只是被打断了"，
   *   而"重画几次"正是 §10.1 的 r_redraw 与 #2 首次通过率的数据源（文件头第 4 条）。
   *   原始那句"哪一撮头发不对"一个字不动，只在后面续上停手的原因。
   */
  const consistency =
    lastConsistency && redrawStop
      ? {
          ...lastConsistency,
          reason:
            `${lastConsistency.reason ?? ''}` +
            `；★ 之后的重画没跑成（第 ${redrawStop.attempt} 次尝试：${redrawStop.message}），` +
            `书上留的是第 ${lastConsistency.attempt} 次那张——它只是没通过比对，不是"没做出来"`,
        }
      : lastConsistency

  return {
    pageNo: node.pageNo,
    // ★ 兜底用 `firstAttempt` 而不是写死的 1：单页重画时这一页的第 1 次是**很久以前**那次，
    //   报成 1 会让"这一页一共画过几次"这件事在书里变得不可查（`attemptBase` 那段）
    attempt: lastConsistency?.attempt ?? firstAttempt,
    asset,
    provenance: provenance ?? {
      modelId: opts.image.modelId,
      promptVersion: IMAGE_PROMPT_VERSION,
      cardRevision: opts.card.revision,
      generatedAt: opts.now(),
    },
    consistency,
    // 没通过 ≠ 失败：交给人，书仍然完整（降级 B）
    needsHumanReview: lastConsistency === undefined || lastConsistency.verdict !== 'pass',
    // 这一次这一页实付的总额（含重画）。★ 四舍五入到分：0.2 × 3 在浮点里是
    // 0.6000000000000001，直接写进 `book.json` 会让"账目对不对"变成一道小数题
    ...(spentCny === undefined ? {} : { costCny: Math.round(spentCny * 100) / 100 }),
  }
}

/**
 * 封面：**一次单独的出图**，3:4 竖版。
 *
 * ★ 与页图的三处不同，都是有理由的：
 *
 * 1. **不比对、不重画**。页图的判据是"和标准像像不像"，而封面没有上一页可比；
 *    它也不是"这一页画错了"的那种错，重画三次救不了一个构图不对的封面。
 *    所以这里不引入一致性这条路——测不了的东西不要假装测过（CLAUDE.md「不糊弄」）。
 * 2. **尺寸是 3:4**（`COVER_IMAGE_SIZE`），与首页演示书的 `cover.webp` 同比例。
 * 3. **事件里 `pageNo: 0`**，由 `describeEvent` 翻成"封面"（见 events.ts 那条注释）。
 *
 * 它**失败就让整本书失败**，不像页图那样降级：没有封面的书在货架上认不出来，
 * 而"这一页缺"是可以接受的（书还是完整的）。这个取舍是刻意的。
 */
export async function illustrateCover(opts: {
  image: ImageGenerator
  store: AssetStore
  card: CharacterCard
  bookId: string
  title: string
  emit: (payload: EngineEventPayload) => void
  now: () => number
}): Promise<Cover> {
  opts.emit({
    kind: 'stage',
    stage: 'illustrating',
    phase: 'begin',
    pageNo: 0,
    attempt: 1,
    total: 1,
  })
  const response = await opts.image.generate({
    prompt: coverPrompt({ card: opts.card, title: opts.title }),
    size: COVER_IMAGE_SIZE,
  })
  const asset = await opts.store.put({
    path: `books/${opts.bookId}/cover${extensionOf(response.mime)}`,
    bytes: response.bytes,
    mime: response.mime,
    originUrl: response.originUrl,
    originExpiresAt: response.originExpiresAt,
  })
  opts.emit({
    kind: 'illustration',
    stage: 'illustrating',
    pageNo: 0,
    attempt: 1,
    assetPath: asset.path,
    modelId: response.modelId,
    costCny: response.costCny,
  })
  return {
    asset,
    provenance: {
      modelId: response.modelId,
      promptVersion: IMAGE_PROMPT_VERSION,
      cardRevision: opts.card.revision,
      generatedAt: opts.now(),
    },
    ...(response.costCny === undefined ? {} : { costCny: response.costCny }),
  }
}

/**
 * 整本书的逐页生成。串行而不是并发：**并发是 W3 的优化**（10/13 从 W2 挪后，
 * 见 `.scratch/w2-solo-flow/issues/05-generate-orchestration.md` §三）。
 *
 * 挪后的判据是实测而不是偏好：3 页的书串行实测 77.7s（比对关）/ 455.6s（比对开 + 1 次重画），
 * 而"要不要上并发池（上限 3）"的规则是**先量到 20 页 > 8 分钟**才做。
 *
 * ★ 2026-10-15：20 页真跑过一趟（`.out/web/books/xiaolu-r1-bf84901c4fcd`），
 *   但那一趟**没能量出串行整本的干净耗时**——中段撞上约 36 分钟的本机网络中断
 *   （18 页 `fetch failed`，两个不同供应商同时段一起坏，见工单 05 的 Comments）。
 *   阈值仍然判"过线"，靠的是下界：串行里每页**至少**出一次图，而"一次出图尝试"的耗时是从
 *   mtime 量的——运行起点（`book.json` 的 mtime − `stats.elapsedMs` = 18:15:32）到 p3 落图
 *   18:28:23.3 共 **770.5s、5 次尝试，≈154 s/次**；20 页至少 20 次 ⇒ **≥ 51.4 分钟 > 8 分钟**。
 *   所以并发池（上限 3、优先并发比对）是**判据要求的**，而这一格**还没落地**——
 *   它是独立的一单，不要因为读到这段就顺手在这里开并发。
 * ★ 这句话以前写的是"并发是 W2 的优化"：**一句与计划不符的注释，
 *   就是下一个人读错代码的入口**（工单 05 的验收里点名了它）。
 */
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
