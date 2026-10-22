/**
 * illustrate.ts —— ③ 逐页生成 + 一致性校验 + 重画（Agent 8 分的核心落点）。
 *
 * 这一层是"自主决策"唯一真实存在的地方：它自己判断画得像不像、自己决定要不要重画、
 * 重画到第几次就交给人。三件事必须在这一层，因为它们共用同一个循环。
 *
 * 七条不显然的规则：
 *
 * 1. 比对模型不可用时绝不重试。没有判据的重画是烧钱抽签：一次一张图的钱、结果无人判定、
 *    还把"首次通过率"污染成"我们重画过"。`verdict = 'unavailable'` 直接结束这一页，
 *    并明确标记"这一页没核对过"——这是降级 B（角色卡锁定 + 家长逐页重画）的入口，
 *    不是失败。
 * 2. 参考图没生效要当场喊。带不带参考图由策略决定（`referenceForPages`，缺省**开**），
 *    所以"这一页以为锁了脸其实没锁"是有可能发生的。症状是整本书画完才发现不像，而那时钱
 *    已经花完了——所以 `requireReference` 一旦为真，真走了 `edit` 而回执里没有参考图，
 *    就当场抛错，不画完再说。
 *    ★ 2026-10-21 补的边界：这里喊的是"**你说要锁脸，这一页没锁**"，不是"这家不支持"。
 *    两个前提缺一不可——**这一次真用了 `edit`**（没有 edit 的 provider 从未声称带参考图，
 *    离线回放就是这种）**且策略要求它**。判据分开的理由写在下面那个 `if` 上面。
 * 3. 失败的图也落盘。家长要能看见"上一版为什么不像"，技术文档也要那批图当评测数据。
 *    删掉它们等于把过程藏起来。
 * 4. 重画次数是数据不是细节：`firstPassCount / redrawCount` 直接喂 §10.1 公式里的
 *    r_redraw 与 #2 的"首次通过率 X% / 重画后 Y%"。
 * 5. 已经拿到的图不因后续失败而丢（2026-10-16 补）。出图与落盘那两跳抛异常时，只要手上
 *    有过一张画完的图，那一页就该是"图在这儿、只是没通过比对"，而不是"这一页没做出来"
 *    ——后者是假话。判据与实测见 `produceFailed`。它与第 3 条同源：第 3 条管"失败的图
 *    别删"，第 5 条管"别把它从书里摘出去"。
 * 6. 重画要带着上一轮的诊断去画（2026-10-20，计划表 B7）。在这之前提示词是循环外算一次、
 *    重画原样再用一遍的：比对模型说出了"哪几条锚点不像"，而那句话只进了 `retry` 事件
 *    （给人看）。于是"自己判断 → 自己重画"这半截闭环里诊断没有回到执行器，机器只是拿
 *    同一张指令再抽一次签，闭环靠人合上。现在每一轮现算 prompt，把 `missedAnchors` 拼成
 *    `anchorNote` 注进去（见 `anchorNote`）。
 *    ★ 它只认最新一次的结论，而且画面审核那一档不参与——两条理由都写在「③-c」那一段里，
 *    改之前先读那一段。
 * 7. 整本书那一层有一个**上限 3 的并发池**，但它只许并发"页与页"，不许并发"出图与比对"
 *    （2026-10-21，D-03）。要防的那个改法很自然：既然要快，就把 20 页的出图先一起发出去、
 *    回来之后统一比对、再统一重画。那样确实更快，代价是"自己判断像不像、自己决定要不要
 *    重画"这半截闭环没了——判断与执行分家之后，重画的 prompt 里就没有 `anchorNote`
 *    （第 6 条那件事会静悄悄失效），而这一层正是 Agent 那 8 分的落点。
 *    所以池子的单位是 `illustrateNode`（一整页的一生），不是某一次调用。
 */

import {
  pagePrompt,
  coverPrompt,
  anchorNoteOf,
  DEFAULT_IMAGE_SIZE,
  COVER_IMAGE_SIZE,
  IMAGE_NEGATIVE_PROMPT,
  IMAGE_PROMPT_VERSION,
} from '../prompts/image.ts'
import { checklistOf } from './character-card/card.ts'
import { toDataUrl } from './providers/http.ts'
import { extensionOf } from './providers/stores.ts'
import { pictureProblemText, toPictureProblems } from './review.ts'
import { PICTURE_CLAUSES } from '../rag/review-corpus.ts'
import type {
  CharacterCard,
  ConsistencyResult,
  Cover,
  Illustration,
  PictureReviewResult,
  Provenance,
  StoryNode,
} from './domain.ts'
import type { EngineEventPayload } from './events.ts'
import { asEngineError, EngineError } from './errors.ts'
import type {
  AssetStore,
  ImageGenerator,
  ImageResponse,
  PictureReviewer,
  VisionComparator,
} from './providers/types.ts'

/**
 * 一致性通过的分数线：**0.5**（2026-10-21 晚从 0.75 重标）。
 *
 * 0.75 是照**上一家比对模型**（`kimi-k2.6`）的分布定的（`docs/tech-selection.md` §7.5：
 * "分数双峰，阈值 0.75 正落在空隙里"，那一批是 1.00/0.95 vs 0.30/0.10）。
 * 换到 `deepseek-flash` 之后那把尺子的刻度变了，而阈值没跟着动——症状是**每一页都判 0.55、
 * 每一页都重画**，用户的原话：「第一次生成的就很标准了啊」。
 *
 * 重标的量法（`.out/tmp/compare-scale.mts`，同一张页图分别与三张卡比）：
 *
 * | 比的谁 | 分数 | 说明 |
 * | --- | --- | --- |
 * | 它自己的卡 | **0.93** | 锚点全中 |
 * | 另一张卡（男孩，同画风） | **0.20** | 头发/头身比/肤色三条不中 |
 * | 再一张卡（陌生孩子） | **0.05** | 五条全不中 |
 * | 用户手上那几页（一条锚点有偏差：头身比 1:3） | **0.55** | 模型自己说"脸型、发型、肤色基本一致" |
 *
 * 0.5 落在 0.55 与 0.20 之间：**"像、但有一条锚点偏了"不再自动重画**（那几页重画三次
 * 也还是 0.55，是白花钱），而"不是一个孩子"（≤0.2）照样拦。
 *
 * ★ 两条要说清的边界：
 *   1. 这是**一次小样本重标**（同一天、一个孩子、四组读数）。样本变大要重跑，判据是"分的双峰还在不在"。
 *   2. 0.5 意味着"一条硬锚点偏了"也能过——那是产品取舍（家长看过不满意可以手点重画），
 *      不是"模型画对了"。页面上那一行仍然照实写分数，别把它当装饰。
 */
export const DEFAULT_THRESHOLD = 0.5
export const DEFAULT_MAX_ATTEMPTS = 3

export type IllustrateOptions = {
  image: ImageGenerator
  /** null = 没有比对能力，走"未核对"路径（见文件头第 1 条） */
  vision: VisionComparator | null
  /**
   * 画面审核（`.scratch/safety` 工单 01）。null = 没有这个能力，走"没审过"路径。
   *
   * 它是必填的，不是 `?`：省略一个可选字段的症状是"这一档静悄悄地没跑"，而那个症状与
   * "审过了、没问题"在 `book.json` 上分不出来。与 `vision: … | null` 同一个写法——
   * 调用方必须表态。
   *
   * 与 `vision` 是同一个对象（`ProviderBundle.vision` 是两个接口的交集）：它们背后是同一个
   * 端点的同一个模型，不存在"配了一个没配另一个"。分成两个字段是因为问的问题不一样，
   * 不是因为可以分别配。
   *
   * 它是一道兜底，不是一道判据。文字面那道闸有词表（可枚举、可复核、读数天天一样），图上
   * 没有——栅格图里没有一个字可扫。所以这一档只能问视觉模型，而它不可复现。两个后果写死在
   * 代码里：① 它不参与评分表 #5 的那两个数（`scripts/review-cases.mts` 一个都不靠它）；
   * ② `unavailable` 时不重画——没有判据的重画是烧钱抽签（文件头第 1 条）。
   * 它不许被说成"覆盖了画面红线"，能说的只有"跑过的图里它报了什么、误报多少"。
   */
  pictureReview: PictureReviewer | null
  store: AssetStore
  card: CharacterCard
  /** 角色卡参考图的 data URL，比对与锁脸都用它 */
  referenceDataUrl: string
  bookId: string
  /** 0–1。阈值靠人工判读校准，别把分数当结论（GLOSSARY「一致性分」） */
  threshold?: number
  maxAttempts?: number
  /** 一致性是这本书的命：要求参考图却没生效时，宁可当场失败也不要画完 20 页再说。
   *  ★ 它只在"这一次真走了 `edit`"时才会抛（见下面那个 `if` 上面那张表） */
  requireReference?: boolean
  /**
   * 这一本书的每一页要不要拿角色卡的参考图去画（走 provider 的 `edit` 那条路）。
   *
   * ★ 2026-10-21：**缺省开**（此前默认关）。原来关着是三条没量全的代价，换模型后前两条消了：
   *
   * | 原来关着的理由 | 现在 |
   * | --- | --- |
   * | 那条路没有 `size` 字段，产物尺寸由模型定（实测请求 1440²、回来 1024²），而页图是按 3:2 写的 | 新这家（qwen-image-3.0）**认 size**，`size` 与文生图同一条接口同一个字段 |
   * | 参考图有没有真送出去无从确认（适配器自己写 `true`） | 响应里 `usage.input_image_count` 是**读数** |
   * | 跨页一致性到底提升多少（ADR-0007 的赌注） | **仍未量** |
   *
   * 所以它翻的是**策略**：开着它证明的是"参考图真的进了请求"，而不是"画得更像了"。
   * 后者要专门做一次开/关对照，别把前者当后者写进结论。
   *
   * 它是策略，与"provider 有没有这个能力"（`supportsReference`）仍然是两件事：
   * 没有 `edit` 的 provider（离线回放）下，调用方那一层会把策略算成 false——
   * 那不是沉默降级，是能力不在，而能力在 `describeProviders` 那一行上看得见。
   */
  referenceForPages?: boolean
  /**
   * 这一次的尝试从第几次接着数（缺省 0 = 从第 1 次起）。给单页重画用（工单 01 §3.1）。
   *
   * 这不是一个好看的选项而是必须的：文件名是 `page-{n}-a{attempt}` 拼的，重画时若从 1 重来，
   * `a1` 会把上一次那张覆盖掉——而"失败的图也落盘"是这条流水线写明的纪律。接着数之后，
   * 文件继续叫 `page-7-a4.png`，事件里的 `attempt` 也仍然是真的第几次。
   *
   * 它同时改了事件里报出的上界：`retry` 的 `maxAttempts` 与 `stage` 的 `total` 报的是
   * `attemptBase + maxAttempts`。不这样的话，第 3 次重画那条事件会念成"第 4 / 3 次"
   * ——一个自相矛盾的数字，而屏幕上没有任何东西会提示它是错的。
   */
  attemptBase?: number
  /**
   * 家长对这一页这一次重画的补充（"上一版哪里不对"）。见 `pagePrompt` 的 `fixNote`。
   *
   * 它只进 prompt，不进任何记录：`provenance` 记的是模型、模板版本、卡版本，而这句话是人的
   * 一句话，进不了那几个字段里的任何一个。要追"这一版为什么长这样"，读的是 `events.jsonl`
   * 里那几页前后的事件，不是清单。
   *
   * 与它同形但不同源的还有一个 `anchorNote`：那是比对模型上一轮的结论，由这一层自己拼
   * （`anchorNoteOf`），不从外面传——它不是人的输入。
   */
  fixNote?: string
  /**
   * 这一页的主角称呼（小男孩 / 小女孩 / 孩子），由 `childWordOf` 从"选的性别 + 外貌标签"
   * 算出来。见 `pagePrompt` 的 `childWord` 那段——它是 2026-10-16 那条"8 页里既有男孩也有
   * 女孩"报障的根因所在：这个名字以前只进标准像，不进逐页 prompt。
   *
   * 由调用方给而不是在这里算：这一层手上只有卡，而卡的锚点里一个性别词都没有（实测那张卡
   * 就是）。算得出它的是孩子那份档案。
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
  /**
   * 要喂给下一次重画的那句「上一版哪几条锚点不像」（`anchorNoteOf` 拼）。
   *
   * 2026-10-20 之前，提示词是在循环外只算一次的：自动重画那一轮用的是与上一轮逐字节相同的
   * prompt，锚点级的结论只进了 `retry` 事件（给人看）。于是"自己判断像不像、自己决定重画"
   * 这半截闭环里，诊断没有回到执行器——机器只是拿同一张指令再抽一次签，而 `fixNote` 只有
   * 家长点重画时才进得来。计划表 B7 与 `docs/business.md` §2.2 把这条折算过：
   * 每本 ¥1.8–5.3、每页 ≈154 秒。
   *
   * 它只认最新一次的结论：比对过了就清空（见下面那个赋值点）。不这么做的话，"第 1 次不像、
   * 第 2 次像了、第 2 次被画面审核拦下"这一串里，第 3 次会拿到一句已经过时的"哪里不像"
   * ——那是在给模型指一条它已经走对的路。
   */
  let anchorNote: string | undefined

  let lastAsset: Illustration['asset'] | null = null
  let lastConsistency: ConsistencyResult | undefined
  /**
   * 最后留下的那一张图上的画面审核结论（`.scratch/safety` 工单 01）。
   *
   * `undefined`（一次都没审）与 `verdict: 'unavailable'`（审了、没审成）是两件事，两者都
   * 不算通过——`needsHumanReview` 两个都收。这与 `consistency` 那段"没通过 ≠ 失败"是同一个
   * 口径：缺席不许被读成通过。
   */
  let lastPicture: PictureReviewResult | undefined
  let provenance: Provenance | null = null

  /**
   * 这一页这一次一共实付了多少（元），逐次累加。
   *
   * 2026-10-16 补上。在这之前这一页的 `costCny` 从来没人填：钱只进了 `illustration` 事件
   * （给界面看的），`Illustration` 上那个字段一直是 `undefined`，而 `summarize()` 的
   * `totalCostCny` 正是从 `illustrations` 里加出来的——于是每一本书的成本都是 0.00。
   * `scripts/web-run.mts` 头部把这条记成了"已知缺口"，现在缺口补上，那段话也跟着改了。
   *
   * 口径与 `imageCalls` 一致：钱已经花了，所以重画过几次就记几次，不是"最后那一张多少钱"。
   * 只记成功的调用——抛异常的那次由 `ImageResponse` 之外的路径出去，供应商那边同样计费，
   * 但这里没有数可记（拿不到回执），凭空按单价乘一笔才是编造。
   * `undefined` 与 `0` 在这里是一件事（都没有记账），所以用 `undefined` 表示"供应商一个价
   * 都没报"，返回时省略该字段——与 `illustrateCover` 同一个写法。
   */
  let spentCny: number | undefined

  /**
   * 重画中途停手的记录（没有就是 null）。最后并进 `consistency.reason`，见那段。
   *
   * 它不进 `errors`：那个字段的口径是"这一页没有图"，而这一页有图。两件事合成一条，以后就
   * 分不出"这一页没做出来"与"这一页做出来了、只是重画被打断"——同一条教训见 `index.ts`
   * 里 `narrations` 那段注释（一个字段只有一种含义）。
   */
  let redrawStop: { attempt: number; message: string } | null = null

  /**
   * 这一次尝试没产出图（出图那一步或落盘那一步抛了）。要么记下来，要么往上抛。
   *
   * 这条 catch 是 2026-10-16 补的，理由与下面比对那条完全同源：比对那一处原来没有 catch，
   * 异常冒到 `illustrateAll`，于是"已经画完、已经付过钱的图跟着整页一起从书里消失"。
   * 当时只修了比对那一跳，真正每一页必然要走的出图与下图那两跳没修。
   *
   * 实测（`.out/web/books/xiaolu-r1-ee69012def18`，2026-10-16）：第 6 页第 1 次画好了
   * （`page-6-a1.png`，1536×1024、3.0 MB 就躺在磁盘上），比对没过 → 重画 → 第 2 次在下图
   * 那一跳撞上 `ECONNRESET` → 整页变成 `errors` 里的一条，而阅读器上那句话是"这一页没做
   * 出来"——假的，它做出来了。
   *
   * 判据只有一条：已经拿到的 asset 不许因为后面这一次失败而丢。拿不到（第 1 次就没成）时
   * 照旧抛出去——那一页才是真的没有图。
   *
   * 它返回这条记录而不是自己写 `redrawStop`：闭包里的赋值 TypeScript 看不见，会在后面把
   * `redrawStop` 判成"永远是 null"（实测报 `Property 'attempt' does not exist on type
   * 'never'`）。写回调用点，CFA 才跟得上——这不是风格，是不报红的必要条件。
   *
   * 产出失败后不再往下一次尝试，两个方向都是刻意的：出图那一步是"生成 + 下载"一次调用，
   * 它抛出来时字节已经没了，再来一次就是重新付一次钱（而"服务端可能已经建单"正是 `http.ts`
   * 里 `ECONNRESET` 不许重试要防的事）；重试安全的那几种（DNS 解析不了 / 连接被拒 /
   * 连接超时）已经在 `requestJson` 里重试过一次，连着两次都是安全类失败，那是中断不是抖动，
   * 多试一次救不回来。所以"第 1 次彻底失败、第 2 次成功"在现在的语义下不会发生：不是漏了，
   * 是不该。
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

    /**
     * ★ 每一轮现算（2026-10-20 从循环外挪进来，见 `anchorNote` 那段）。
     *   第 1 次算出来的那一份逐字节与挪之前相同（`anchorNote` 是空的），
     *   所以"首次通过率"这个数不受这次改动影响；变的是第 2 次起。
     */
    const prompt = pagePrompt({
      card: opts.card,
      page: node.imagePrompt,
      mood: node.mood,
      ...(anchorNote ? { anchorNote } : {}),
      ...(opts.fixNote ? { fixNote: opts.fixNote } : {}),
      // ★ 身份那一行（"整本书就是这个孩子"）总是进 prompt；`childWord` 只是把
      //   "那个孩子"写成"那个孩子（小男孩）"。所以这里不是"有才加"，见 `pagePrompt` 那段
      ...(opts.childWord ? { childWord: opts.childWord } : {}),
    })

    // 走哪条路由由策略（referenceForPages）与能力（有没有 edit）同时决定。两条都是显式分支，
    // 没有"传了但被忽略"那种中间状态：那种状态的症状是整本书画完才发现没锁脸，而那时钱已经
    // 花完了
    const edit = opts.referenceForPages === true ? opts.image.edit : undefined

    // ① 出图。失败走 produceFailed：有旧图就留着，没有就抛
    let response: ImageResponse
    try {
      response = edit
        ? await edit.call(opts.image, {
            prompt,
            size: DEFAULT_IMAGE_SIZE,
            referenceDataUrl: opts.referenceDataUrl,
            // 画面里不许写字（这家真的写过正文，见 `IMAGE_NEGATIVE_PROMPT` 那段）
            negativePrompt: IMAGE_NEGATIVE_PROMPT,
          })
        : await opts.image.generate({
            prompt,
            size: DEFAULT_IMAGE_SIZE,
            negativePrompt: IMAGE_NEGATIVE_PROMPT,
          })
    } catch (err) {
      redrawStop = produceFailed(err, attempt)
      break
    }

    // 先记账再判断——钱在这一行之前就已经花掉了。记在这里（而不是事件那一段）的理由：
    // 事件那一段在下面几十行，中间有 `requireReference` 的抛与落盘失败两条出口，
    // 从那儿记账会把"这一次已经付过钱"漏掉。
    if (response.costCny !== undefined) {
      spentCny = (spentCny ?? 0) + response.costCny
    }

    /*
     * 锁脸没生效不交给 `produceFailed`，哪怕手上已经有一张旧图。这一条是想过之后才这么
     * 写的，不是漏了：`referenceApplied` 是"这一次请求是怎么发的"的属性，而它由策略与
     * 能力决定——同一个 provider 在同一个循环里不会第 1 次锁上了、第 2 次没锁。所以它实际
     * 只会在第 1 次触发，而第 1 次手上必然没有旧图（`produceFailed` 也会抛），两条路在
     * 这里重合。保留"无条件抛"是为了让文件头第 2 条那句话不被降级路径盖住：它要喊的是
     * "这一页没锁脸"，而"用上一张"正好会把这句话咽下去。
     *
     * ★ `edit &&` 这个前提是 2026-10-21 补的，它分开的是两件不同的事：
     *
     * | 情形 | 这一次发生了什么 | 这里怎么处置 |
     * | --- | --- | --- |
     * | 有 `edit`、也真用了它，而回执说参考图没进去 | **我们为一张没锁脸的图付了钱** | 当场抛 |
     * | 这家根本没有 `edit`（离线回放就是） | 这一次请求**从来没声称**要带参考图 | 不抛（调用方那一层按能力把策略关掉，见 `index.ts` 的 `withReference`） |
     *
     * 合成一条会把离线回放整条演示路打死（`createReplayImage` 没有 `edit`，而 ADR-0003
     * 的演示路径要求它跑得通），而那是"没花钱、也没人被骗"的一格——处置与上面那格不同。
     */
    if (edit && opts.requireReference && response.referenceApplied !== true) {
      throw asEngineError(
        new Error(
          `这一页要求锁脸，但参考图没进请求（referenceForPages=${String(
            opts.referenceForPages === true,
          )}、供应商有 edit=${String(Boolean(opts.image.edit))}）。` +
            `一致性是这本书的命，拒绝在没锁脸的情况下继续画`,
        ),
      )
    }

    // ② 落盘。同样：失败时已经有图就留着，没有就抛
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
        // 这句话有两种读法，取决于画面审核那一档有没有跑（2026-10-19）：两个都没有时说的是
        // "这一页整页没核对过"，只有比对缺席时说的只是那一半。分开写是因为它们的下一步不一样
        // ——前者是"这台机器没有视觉能力"，后者是"配了审核没配比对"，而后者今天在本仓库里不该
        // 出现（同一个 provider）。
        opts.pictureReview
          ? '未配置视觉比对模型，这一页的"像不像"没有核对过'
          : '未配置视觉模型，这一页没有核对过（像不像与画面都没查）',
      )
      opts.emit({
        kind: 'consistency',
        stage: 'checking',
        pageNo: node.pageNo,
        attempt,
        ...shape(lastConsistency),
      })
      // 没有视觉能力时两道核对都没做，所以这里直接停手。画面那一档也不跑：`!opts.vision`
      // 意味着这台机器没有视觉端点，而 `pictureReview` 与 `vision` 在 `ProviderBundle` 里是
      // 同一个对象。
      break
    }

    const pageDataUrl = toDataUrl(response.bytes, response.mime)
    // 比对调用本身失败（504 / 网络错 / 超时）必须与"比对给不出分"走同一条路。这里原来的
    // 写法是直接 await，异常会冒到 illustrateAll 的 catch——于是这一页连同已经画完、已经
    // 付过钱的图一起从书里消失。
    //
    // 实测（`node scripts/engine-run.mts --mode=live --pages=5`，2026-10-13）：5 页全部出图
    // （磁盘上 8 张 PNG，含重画），但比对模型在 3 页上回 504/网络错，书里只剩 2 页，
    // 汇总行还写着"2/5 页有图"——那是假的，5/5 都有图。这正是文件头第 1 条说的那种情况：
    // 裁判没到场，不是选手没跑。没到场就标"未核对"（降级 B 的入口），图留着，书是完整的。
    //
    // 2026-10-19 改了一处形状：它不再当场 break，而是先记下来——画面审核还要跑，
    // 而这一张图在"一致性没结论"时是会被留下的。
    let compared: Awaited<ReturnType<VisionComparator['compare']>> | null = null
    let compareError = ''
    try {
      compared = await opts.vision.compare({
        referenceDataUrl: opts.referenceDataUrl,
        pageDataUrl,
        checklist: checklistOf(opts.card),
      })
    } catch (err) {
      compareError = asEngineError(err).message
    }

    lastConsistency = compared
      ? {
          pageNo: node.pageNo,
          attempt,
          score: compared.score,
          verdict:
            compared.score === null ? 'unavailable' : compared.score >= threshold ? 'pass' : 'fail',
          threshold,
          missedAnchors: compared.missed as ConsistencyResult['missedAnchors'],
          reason: compared.reason,
        }
      : unjudgeable(
          node.pageNo,
          attempt,
          threshold,
          `比对调用没跑成，这一页没有核对过：${compareError}`,
        )
    opts.emit({
      kind: 'consistency',
      stage: 'checking',
      pageNo: node.pageNo,
      attempt,
      ...shape(lastConsistency),
    })

    /**
     * ③-b 画面审核（2026-10-19，`.scratch/safety` 工单 01）。
     *
     * 它只对"这一张可能被留下"的图跑，这一个判断省的是真钱：一致性没过、而且还有重画
     * 次数时，这一张马上就要被替掉，给它再花一次审核调用的钱等于买一份关于废纸的报告。
     * 反过来，"一致性判不了（`unavailable`）"的那一张是会留下的，所以它照样审——
     * 那条路上比对本身已经不工作了，画面这一档是唯一的核对。
     *
     * 这一档的处置与一致性有一条关键的不同：`unavailable` 一律不重画（下面 ④ 只对
     * `flag` 重画）。理由比一致性那条更硬——一致性至少还有一个分，而画面这一档连分都
     * 没有，"没审成"时重画就纯粹是抽签。
     */
    if (!(lastConsistency.verdict === 'fail' && attempt < lastAttempt)) {
      lastPicture = await reviewPictureOf(opts.pictureReview, node.pageNo, attempt, pageDataUrl)
      opts.emit({
        kind: 'review',
        stage: 'auditing',
        pageNo: node.pageNo,
        attempt,
        check: 'safety',
        verdict: lastPicture.verdict,
        ...(lastPicture.reason ? { reason: lastPicture.reason } : {}),
      })
    }

    /**
     * ③-c 把结论回灌给下一次重画（2026-10-20，计划表 B7）。
     *
     * 只认最新一次的比对结论：`fail` 就按它重新拼一句，其余（`pass` / `unavailable`）
     * 一律清空。三种情形各有理由——`pass`：该改的已经改对了，带着旧账去画下一轮会指错路；
     * `unavailable`：没有结论，`missedAnchors` 是空的时候 `anchorNoteOf` 本来也回
     * `undefined`，但"缺席不许被读成我知道该改哪里"这条口径值得写在这里，而不是靠那个
     * 函数的行为顺带成立；`fail`：这才是这一版新增的那条路，拼不出来（一条都没对上）时
     * 仍然是 `undefined`，那一轮就跟以前一样"再抽一次签"——没有结论就不编一句结论。
     *
     * 画面审核那一档不参与回灌，而且现在与比对这一档分家了：它报的是"图里有不该出现的
     * 东西"，不是"不像"。把"有绳套"写回出图 prompt 等于把那个概念再写进提示词一次
     * （`reviewPictureOf` 第 5 条讲的就是这件事）。所以由它触发的重画拿不到
     * `anchorNote`——`pass` 那条清空正好兼管了这件事。
     */
    anchorNote =
      lastConsistency.verdict === 'fail'
        ? anchorNoteOf(opts.card, lastConsistency.missedAnchors)
        : undefined

    //   两个理由各归各的一条：它们的下一步是同一件事（重画），但要说的话不一样，
    //   而且一起报时家长会以为是同一件事出了两遍。
    if (lastConsistency.verdict === 'fail' && attempt < lastAttempt) {
      opts.emit({
        kind: 'retry',
        stage: 'retrying',
        pageNo: node.pageNo,
        attempt,
        maxAttempts: lastAttempt,
        reason: describeMiss(lastConsistency),
      })
      continue
    }

    if (lastPicture?.verdict === 'flag' && attempt < lastAttempt) {
      opts.emit({
        kind: 'retry',
        // 这条 retry 的 `stage` 是 `'auditing'` 而不是 `'retrying'`，与一致性那条刻意不一样：
        // `describeEvent` 靠 `stage` 分辨该说哪句话，而"不太像，正在重画"套在内容审核上是一句
        // 假话（图可能画得很像，只是里头有个不该有的东西）。2026-10-18 修过同一个形状的错
        // （规划期的 retry 被念成"不太像"），这里是它的第三个分枝。
        stage: 'auditing',
        pageNo: node.pageNo,
        attempt,
        maxAttempts: lastAttempt,
        reason: lastPicture.reason ?? '这一页画面上有不该出现的东西',
      })
      continue
    }

    break
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
   * 这一句是给几个月后翻 `book.json` 的人写的：没有它，一页 `verdict: 'fail'` 配
   * `attempt: 1` 完全看不出"后面还画过、只是被打断了"，而"重画几次"正是 §10.1 的
   * r_redraw 与 #2 首次通过率的数据源（文件头第 4 条）。原始那句"哪一撮头发不对"
   * 一个字不动，只在后面续上停手的原因。
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
    // ★ 兜底用 `firstAttempt` 而不是写死的 1：单页重画时这一页的第 1 次是很久以前那次，
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
    // ★ 画面审核的结论（`.scratch/safety` 工单 01）。只有真跑过那一次才写——
    //   `unavailable`（审了没审成）也写，因为"没审成"本身是要记的事；
    //   而 `undefined`（这一档根本没跑）就让它缺席，读法与 `consistency` 缺席一致。
    ...(lastPicture === undefined ? {} : { pictureReview: lastPicture }),
    /**
     * 没通过 ≠ 失败：交给人，书仍然完整（降级 B）。
     *
     * 2026-10-19 起它收四种情况，不是两种：一致性没通过 / 没核对成 / 画面审核没通过 /
     * 画面审核没审成或根本没审。四个都要收，理由是同一条：这个字段的读法是"这一页有人得
     * 看一眼"，而"我们没审过它"正是要人看一眼的理由。
     * 缺席（`lastPicture === undefined`）也收——缺席不许被读成通过。这条口径下，
     * "没配视觉模型"的书每一页都是 `needsHumanReview: true`，而这正是今天的行为
     * （`consistency` 那半边本来就收它），没有变松也没有变紧。
     */
    needsHumanReview:
      lastConsistency === undefined ||
      lastConsistency.verdict !== 'pass' ||
      lastPicture === undefined ||
      lastPicture.verdict !== 'pass',
    // 这一次这一页实付的总额（含重画）。★ 四舍五入到分：0.2 × 3 在浮点里是
    // 0.6000000000000001，直接写进 `book.json` 会让"账目对不对"变成一道小数题
    ...(spentCny === undefined ? {} : { costCny: Math.round(spentCny * 100) / 100 }),
  }
}

/**
 * 封面：单独一条出图的路，3:4 竖版。
 *
 * 与页图有四处不同，都是有理由的：
 *
 * 1. 不比对。页图的一致性判据是"和标准像像不像"，而封面没有上一页可比。所以这里不引入
 *    一致性这条路——测不了的东西不要假装测过。但画面审核走（`.scratch/safety` 工单 01）：
 *    它问的不是"像不像"，是"里头有没有不该出现的东西"，而封面上当然可以有那种东西——
 *    它还是孩子在货架上第一眼看见的那张。
 * 2. 尺寸是 3:4（`COVER_IMAGE_SIZE`），与首页演示书的 `cover.webp` 同比例。
 * 3. 事件里 `pageNo: 0`，由 `describeEvent` 翻成"封面"。
 * 4. 重画只由画面审核触发，不由一致性触发。这正是"重画三次救不了一个构图不对的封面"
 *    不适用于画面审核的原因：那一档报的不是"这张图不好看"，是"这张图坏了"，
 *    而坏图重画一次是真的可能画好的（prompt 是干净的，靠模型重新采样）。
 * 5. **它现在也带角色卡参考图**（2026-10-21，随换模型一起补的）。在这儿之前它只走
 *    `generate`——于是页页都锁了脸、封面却是另一个孩子，而封面正是家长第一眼看见的那张。
 *    开关与页图共用 `referenceForPages`，理由写在它的类型注释里。
 *
 * 它失败就让整本书失败，不像页图那样降级：没有封面的书在货架上认不出来，而"这一页缺"
 * 是可以接受的（书还是完整的）。这个取舍是刻意的。
 * 画面审核两次都没过时也走这条：当场抛，而不是"标记一下照样发"。理由是这条路没有第二次
 * 机会——`POST /books/<id>/illustrate` 见到 `book.json` 就回 409（防止一次误点重画整本），
 * 所以一本已经有清单的书，封面永远改不了。标记着发出去 = 给家长一本封面有问题、而他
 * 没有任何办法改的书。
 * ★ 代价要说明白：这是这一档最贵的一处——封面被拦下 = 整本重做（页图已经画完、已经
 *   付过钱）。这是已知的、刻意接受的代价，不是漏了。
 */
export async function illustrateCover(opts: {
  image: ImageGenerator
  store: AssetStore
  card: CharacterCard
  bookId: string
  /** 角色卡参考图的 data URL。封面也要锁脸——见下面 §5 那段（2026-10-21 补） */
  referenceDataUrl: string
  /**
   * 封面要不要带参考图。缺省**开**，与 `IllustrateOptions.referenceForPages` 同一个缺省。
   *
   * ★ 2026-10-21 补的这一条超出了那个字段的字面范围（它叫 forPages），是刻意的：
   *   页页都锁了脸而封面是另一个孩子，比整本都不锁更糟——**家长第一眼看到的是封面**，
   *   而那一眼要判断的正是"这像不像我家孩子"。两条路的开关合成一个，是为了不留
   *   "有人只开了一半"的状态。要只动内页不动封面，在这里传 false。
   */
  referenceForPages?: boolean
  /** 画面审核（`.scratch/safety` 工单 01）。null = 没有这个能力，走"没审过"那条路 */
  pictureReview: PictureReviewer | null
  /** 出图 + 画面审核最多几次。缺省见 `DEFAULT_MAX_ATTEMPTS` */
  maxAttempts?: number
  emit: (payload: EngineEventPayload) => void
  now: () => number
}): Promise<Cover> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  /**
   * 出图的提示词整个循环只算一次。
   *
   * 这一条只对封面成立，而且理由与页图那条（文件头第 6 条）不同：封面根本没有比对
   * （判断 1 的理由），所以这里没有任何结论可以喂回去。它重画的唯一理由是画面审核报了
   * "图里有不该出现的东西"，而那一档按 `reviewPictureOf` 第 5 条刻意不回灌。
   * 所以这里不是"漏了"，是没有可回灌的东西——页图那一侧已经改了，别照抄过去。
   */
  const prompt = coverPrompt({ card: opts.card })

  // 与页图同一条判据（`illustrateNode` 那句）：策略说带参考图、而这家没有 `edit`，
  //   就不该"那就不带参考图画一张"——封面是这个孩子在货架上的脸，画错了整本书都白做
  const edit = opts.referenceForPages === true ? opts.image.edit : undefined
  if (opts.referenceForPages === true && typeof edit !== 'function') {
    throw new EngineError(
      'reference-invalid',
      '这一版要求封面也照着角色卡画，但当前图像模型没有带参考图那条路（`edit`）。' +
        '换一个能收参考图的模型，或者在调用处把封面那一档关掉',
    )
  }

  let lastAsset: Cover['asset'] | null = null
  let provenance: Provenance | null = null
  let lastReview: PictureReviewResult | undefined
  let spentCny: number | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    opts.emit({
      kind: 'stage',
      stage: 'illustrating',
      phase: 'begin',
      pageNo: 0,
      attempt,
      total: maxAttempts,
    })
    const response = edit
      ? await edit.call(opts.image, {
          prompt,
          size: COVER_IMAGE_SIZE,
          referenceDataUrl: opts.referenceDataUrl,
          negativePrompt: IMAGE_NEGATIVE_PROMPT,
        })
      : await opts.image.generate({
          prompt,
          size: COVER_IMAGE_SIZE,
          negativePrompt: IMAGE_NEGATIVE_PROMPT,
        })

    /**
     * ★ 说了要锁脸却没锁，当场抛（与页图 `requireReference` 同一条纪律）。
     *
     * 封面这一档的代价比页图大——它抛出去就是整本书失败（见文件头那段"刻意接受的代价"）。
     * 仍然选择抛：一本封面是别人的书，比"这次没出成"更坏，而且家长没有任何办法改它
     * （有清单的书 `POST /books/<id>/illustrate` 回 409）。
     */
    if (edit && response.referenceApplied !== true) {
      throw new EngineError(
        'reference-invalid',
        '封面这一版要求照着角色卡画，但请求里那张参考图没有被确认收到' +
          '（响应里没有 `usage.input_image_count`）。封面是孩子在货架上第一眼看见的那张，' +
          '拒绝在没锁脸的情况下继续',
      )
    }
    // ★ 文件名带 attempt，与页图同一个理由（文件头第 3 条）：被替掉的那几张留着，
    //   "上一版为什么不行"要看得见。留下的是 `Cover.asset.path` 指的那一张。
    lastAsset = await opts.store.put({
      path: `books/${opts.bookId}/cover-a${attempt}${extensionOf(response.mime)}`,
      bytes: response.bytes,
      mime: response.mime,
      originUrl: response.originUrl,
      originExpiresAt: response.originExpiresAt,
    })
    provenance = {
      modelId: response.modelId,
      promptVersion: IMAGE_PROMPT_VERSION,
      cardRevision: opts.card.revision,
      generatedAt: opts.now(),
    }
    // 钱在这一行之前就花掉了，所以先记（与 `illustrateNode` 同一个次序）
    if (response.costCny !== undefined) spentCny = (spentCny ?? 0) + response.costCny
    opts.emit({
      kind: 'illustration',
      stage: 'illustrating',
      pageNo: 0,
      attempt,
      assetPath: lastAsset.path,
      modelId: response.modelId,
      costCny: response.costCny,
    })

    lastReview = await reviewPictureOf(
      opts.pictureReview,
      0,
      attempt,
      toDataUrl(response.bytes, response.mime),
    )
    opts.emit({
      kind: 'review',
      stage: 'auditing',
      pageNo: 0,
      attempt,
      check: 'safety',
      verdict: lastReview.verdict,
      ...(lastReview.reason ? { reason: lastReview.reason } : {}),
    })

    if (lastReview.verdict !== 'flag') break
    if (attempt < maxAttempts) {
      opts.emit({
        kind: 'retry',
        // 与页图那条同一条理由：`stage` 是 `describeEvent` 分辨该说哪句话的依据，
        // 而"不太像，正在重画"套在内容审核上是一句假话
        stage: 'auditing',
        pageNo: 0,
        attempt,
        maxAttempts,
        reason: lastReview.reason ?? '封面画面上有不该出现的东西',
      })
    }
  }

  if (!lastAsset || !provenance) {
    // 到不了：`maxAttempts` 至少是 1。写出来是为了让 TS 收窄，也为了让"0 次"这件事
    // 万一被谁传进来时当场报错而不是回一本没有封面的书
    throw new EngineError('invalid-request', `封面的重画次数是 ${maxAttempts}，至少要 1 次`)
  }

  if (lastReview?.verdict === 'flag') {
    throw new EngineError(
      'review-blocked',
      `封面被内容审核拦下了（画了 ${maxAttempts} 次都没过）：${lastReview.reason}。` +
        `这一本得重做一次——已经在盘上的那些页图不作数`,
      { detail: lastReview.problems.map((problem) => `0:${problem.clauseId}`) },
    )
  }

  return {
    asset: lastAsset,
    provenance,
    ...(lastReview === undefined ? {} : { pictureReview: lastReview }),
    // ★ 四舍五入到分，与页图同一个理由（浮点加法写进 `book.json` 会让账目变成小数题）
    ...(spentCny === undefined ? {} : { costCny: Math.round(spentCny * 100) / 100 }),
  }
}

/**
 * 同时在画的页数上限。**3** 这个数是工单里定的，不是量出来的最优点：
 * 它要治的是"20 页串行 ≥51.4 分钟"，而 3 路已经把那一段压到 1/3 量级（实测见
 * `docs/known-tradeoffs.md` 里 D-03 那一段：真路由 + 定长假厂商，串行档与 3 路档各跑两轮）；
 * 再往上加，收益被"同一台机器"与"供应商那边的限流"吃掉，风险却全在别人手里。
 *
 * ★ 它是**上限**不是目标：页数少于 3 时按页数开（不然会开出两条空转的 worker）。
 * ★ 想要旧行为（逐页串行、事件流严格按页递增）就传 1——`scripts/` 与测试都用它复现基线。
 */
export const DEFAULT_PAGE_CONCURRENCY = 3

export type IllustrateAllOptions = {
  /** 同时出图/比对的页数上限。缺省 `DEFAULT_PAGE_CONCURRENCY`（3） */
  concurrency?: number
}

/**
 * 整本书的逐页生成。**2026-10-21 起带一个上限 3 的并发池**（工单 D-03）。
 *
 * ── 为什么现在才有 ────────────────────────────────────────────────────────
 *
 * 在这之前它是逐页串行的，而 `illustrate.ts` 自己的注释里就写着"并发池（上限 3）是判据
 * 要求的，而这一格还没落地"——评分报告把它记成"并发没做，而它自己的判据要求做"（§2.2 −6，
 * 另在 §2.8 与 §2.14 各扣一次）。阈值是量出来的：3 页的书串行实测 77.7s（比对关）/
 * 455.6s（比对开 + 1 次重画）；20 页那本撞上网络中断没量出干净耗时，但下界成立——
 * 串行里每页至少出一次图，一次出图尝试 ≈154 s，20 页 ≥51.4 分钟 > 8 分钟那条线。
 * 盘上五本真书是 12.5 / 19.1 / 174.2 / 60.6 / 70.1 分钟（`docs/business.md` §1.2）。
 *
 * ★ **那个 154 s 别当典型值读**（2026-10-21 补）。它是从一次**网络中断**的跑测里按 mtime
 *   反推的"每次尝试"，含重试与等待；同一天一次干净的探针
 *   （`scripts/probe-image-concurrency.mts`，3 路同发）量到的是 **15.2–17.7 s**
 *   （1024²、6 次），而**页图真正用的那个尺寸**（1536×1024）三次是 **16.7–18.4 s**。
 *   作为"过没过 8 分钟那条线"的**下界**它仍然成立，但拿它乘出
 *   "这本书要跑 56 分钟"就是把一次事故当成了常态。两条的完整对照写在
 *   `docs/known-tradeoffs.md` 里 D-03 那一段的"★ 二"。
 *
 * ── 三条不许被并发改掉的东西 ──────────────────────────────────────────────
 *
 * 1. **每一页自己的事件次序一字不变**。池子只是同时跑几个 `illustrateNode`，那个函数一行
 *    没改——所以"第 7 页第 2 次尝试"仍然紧跟在"第 7 页第 1 次不像"后面，重画还归属同一页。
 *    变的只有**页与页之间**的穿插：第 2 页的 `illustration` 可能排在第 1 页的 `consistency`
 *    前面。刻意不做"先把所有页画完、再统一比对"那种批量编排——那会把"自己判断像不像、
 *    自己决定要不要重画"这半截闭环拆散，而它是 Agent 那 8 分的落点。
 * 2. **返回的数组仍按页序**。完成顺序与页序无关，可 `illustrations` 进 `book.json`、
 *    进阅读器，它必须是第 1 页在前。所以下面按 `resultOf` 的下标回收，不是按谁先回来。
 * 3. **一页失败仍然只影响那一页**（§5 失败语义）：`illustrateNode` 的异常照旧被这一层接住、
 *    记进 `errors`、发一条非致命事件，其余页照跑。并发只改了"同时有几个人在做"。
 *
 * ★ `concurrency: 1` 走的是同一条路（一个 worker 顺序取页），不是另开一条分支：
 *   两条分支的话，"串行那档还对不对"每次都要单独验，而它已经没人用了。
 */
export async function illustrateAll(
  nodes: readonly StoryNode[],
  opts: IllustrateOptions,
  run: IllustrateAllOptions = {},
): Promise<{ illustrations: Illustration[]; errors: { pageNo: number; message: string }[] }> {
  const limit = run.concurrency ?? DEFAULT_PAGE_CONCURRENCY
  /**
   * ★ 0 与负数要当场拒。放它们过去是**不会自己报错的**：`limit=0` 会开出 0 个 worker，
   *   `Promise.all([])` 立刻返回，于是这本书变成"一页都没有"——一本空书，而日志里
   *   一个字都不会提。非整数（2.5）同理：`Array.from({length: 2.5})` 取整成 2，
   *   读数与说的不一样。
   */
  if (!Number.isInteger(limit) || limit < 1) {
    throw new EngineError(
      'invalid-request',
      `并发的页数上限是 ${String(limit)}，必须是 ≥1 的整数（0 会让这一本书一页都不画，而它不报错）`,
    )
  }

  const resultOf: (Illustration | undefined)[] = Array.from({ length: nodes.length })
  const failureOf: ({ pageNo: number; message: string } | undefined)[] = Array.from({
    length: nodes.length,
  })

  /**
   * 下一个要取的页号。
   *
   * `next += 1` 与读它之间没有 `await`，所以"谁拿走哪一页"是确定的：worker 之间按取号
   * 的先后各拿各的，不会有两页拿到同一个下标。这不是"碰巧安全"——JS 单线程 +
   * 同步取号，是这条写法成立的全部理由，所以它旁边必须留着这句话。
   */
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      if (index >= nodes.length) return
      const node = nodes[index]!
      try {
        resultOf[index] = await illustrateNode(node, opts)
      } catch (err) {
        const failure = asEngineError(err)
        // 一页失败不终止整条流（§5 失败语义），但记下来，书要标"这一页缺"
        failureOf[index] = { pageNo: node.pageNo, message: failure.message }
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
  }

  // 页数比上限少时就别多开——空转的 worker 不做事，但"开了几个"是读得出来的
  await Promise.all(Array.from({ length: Math.min(limit, nodes.length) }, () => worker()))

  // 回收按页序，不按完成序（见上面第 2 条）
  const illustrations: Illustration[] = []
  const errors: { pageNo: number; message: string }[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    const illustration = resultOf[index]
    if (illustration) illustrations.push(illustration)
    const failure = failureOf[index]
    if (failure) errors.push(failure)
  }
  return { illustrations, errors }
}

/**
 * 一张画好的图过一遍画面审核（`.scratch/safety` 工单 01）。
 *
 * 五条纪律，逐条都有代价：
 *
 * 1. 读不到就回 `unavailable`，绝不回 `pass`。三种读不到：没配视觉模型、这一问的调用抛了、
 *    模型没按 JSON 答。三种都不算"审过了"——与 `compare` 那条 `score: number | null`
 *    同一条纪律。
 * 2. `unavailable` 不重画（由调用方保证：只有 `flag` 才重画）。这一档连分都没有，"没审成"
 *    时重画是纯抽签，而一致性那一档至少还有一个分可以比。见文件头第 1 条。
 * 3. 报出来的每一条都带条款 id，与文字面那道闸同一个要求（判据 5）：家长要能去翻条款，
 *    而不是读到一句"这一页不合适"。
 * 4. `where` 也要带上。"第 3 页有恐怖内容"没法核对，"第 3 页左下角那只玩偶的眼睛"可以
 *    ——这一档的产物本来就是给人去翻图用的，不是给机器判的。
 * 5. 不把结论喂回出图 prompt：喂回去等于把那个概念又写进提示词一次（"画面里有绳套"→
 *    prompt 里出现"绳套"），而重画用的那个 prompt 本来是干净的，重画靠的是模型这一次
 *    重新采样。
 *    ★ 2026-10-20 起这一条与一致性那一档分家了，别再照着页图那边抄：页图现在会把比对
 *      模型的锚点结论喂回去（`anchorNote`，文件头第 6 条）。两档的区别不在"要不要回灌"，
 *      而在回灌的是什么——一致性那句是"要画成什么样"（锚点原文 + 卡上的值，没有新概念），
 *      审核这一句是"这里面有个不该有的东西"（引入的正是那个概念本身）。
 */
async function reviewPictureOf(
  reviewer: PictureReviewer | null,
  pageNo: number,
  attempt: number,
  pageDataUrl: string,
): Promise<PictureReviewResult> {
  if (!reviewer) {
    return {
      pageNo,
      attempt,
      verdict: 'unavailable',
      problems: [],
      reason: '未配置视觉模型，这一页的画面没有审过',
    }
  }

  let response: Awaited<ReturnType<PictureReviewer['reviewPicture']>>
  try {
    response = await reviewer.reviewPicture({
      pageDataUrl,
      // ★ 清单从条款库来，不是从适配器来——与 `checklistOf(opts.card)` 同一条：
      //   适配器不认识我们的条款，"审哪几条"是引擎的决定。
      clauses: PICTURE_CLAUSES,
    })
  } catch (err) {
    // 与比对那条 catch 同源：审不了 ≠ 这张图没画成。图留着，这一页标"没审过"
    return {
      pageNo,
      attempt,
      verdict: 'unavailable',
      problems: [],
      reason: `画面审核的调用没跑成，这一页没有审过：${asEngineError(err).message}`,
    }
  }

  if (response.findings === null) {
    return {
      pageNo,
      attempt,
      verdict: 'unavailable',
      problems: [],
      reason: response.reason ?? '画面审核的模型没有按格式回答，这一页没有审过',
    }
  }

  const problems = toPictureProblems(response.findings)
  return {
    pageNo,
    attempt,
    // ★ `problems.length > 0` 就是全部判据——这里故意没有阈值：
    //   画面这一档只有"有/没有"，编一个 0.8 出来只会让人以为它可以校准（见 domain.ts）。
    verdict: problems.length > 0 ? 'flag' : 'pass',
    problems: problems.map((problem) => ({ clauseId: problem.clauseId, where: problem.where })),
    // 有发现时这句话是给事件、给画桌、给 `book.json` 三处共用的那一句；
    // 没发现时留模型自己那句（它不会上屏——`pass` 那条事件不占行）
    ...(problems.length > 0
      ? { reason: problems.map((problem) => pictureProblemText(problem, pageNo)).join('；') }
      : response.reason === undefined
        ? {}
        : { reason: response.reason }),
  }
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
