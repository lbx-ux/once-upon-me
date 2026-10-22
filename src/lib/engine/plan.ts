/**
 * plan.ts —— ② 故事规划（结构化输出 + 校验 + 带反馈的重试）
 *
 * 这条流水线是 #1「大模型集成质量」的主体，也是 §9.2 判据 1 的测量对象。
 * 三件事必须在这一层做对，缺一个通过率就会莫名偏低：
 *
 * 1. 校验与树形检查分开报。Schema 管形状（字段在不在、长度对不对），
 *    tree.ts 管语义（分支数、父子引用、形态约束）。混在一起，
 *    重试提示就会说"格式不对"，而模型上一轮其实是格式全对、分支少了一条。
 * 2. 重试必须带上具体问题（`formatFailures` / TreeProblem 清单）。
 *    原样重发一次是拿钱换同样的输出。
 * 3. 重试次数是产出数据，不是内部细节。它回填报价表 §10.1 的 N_plan，
 *    也是"这批候选里谁的结构化输出最稳"的直接证据。所以它随结果返回。
 */

import {
  STORY_PLAN_VERSION,
  storyPlanSystem,
  storyPlanUser,
  type StoryPlanInput,
} from '../prompts/story-plan.ts'
import { asPlanDraft, planDraftCodec, planJsonSchema, type PlanDraft } from '../schemas/story.ts'
import { formatFailures, parseWith } from '../schemas/schema.ts'
import { EngineError } from './errors.ts'
import { completeWithTools, type ToolDef } from './tool-loop.ts'
import { withFeedback } from './retry-feedback.ts'
import { DEFAULT_PLAN_ATTEMPTS } from './plan-limits.ts'
import { planSharedStory } from './plan-shared.ts'
import type { BookForm, RetrievalProvenance, RetrievedChunkRef, StoryTree } from './domain.ts'
import { branchPagesOf, buildTree, type TreeProblem } from './tree.ts'
import { reviewInput, reviewInputText, reviewProblemText, reviewStory } from './review.ts'
import type { EngineEventPayload } from './events.ts'
import type { TextDelta, TextGenerator, TextRequest } from './providers/types.ts'
import type { RetrievePair } from '../rag/retrieve.ts'

/**
 * 一次检索的结果：取到的东西 + 用的是哪一版语料。
 *
 * `corpusVersion` 由检索方（`rag/load.ts` 那个 helper）带回来，不由 `plan.ts` 去猜：
 *   它来自索引文件，而索引文件只有载入它的那一侧见过。
 */
export type PlanRetrieval = { pair: RetrievePair; corpusVersion: string }

/**
 * 「在动手写之前，先把以前写过的相近内容找出来」——引擎对这一层的唯一要求。
 *
 * 它是一个入参，不是一条新流水线。`README §五` 记过那次教训：
 *   横评脚本自己搭一条平行路，量出来的数「不是引擎要用的那个数」。
 *   所以检索挂在 `planStory` 的入参上，开与关都只改这一个字段——
 *   工单 06 的对照跑测要的就是"只差这一个"的两臂。
 * 传 `undefined` = 这一轮不检索（脚本、离线跑测、以及将来的"关掉它"）。
 *   那时提示词逐字节等于 v3 的内容（见 `prompts/story-plan.ts` 那条 ☆）。
 * 它是 async 的，而这件事决定了失败怎么走：装载语料的 I/O 藏在检索方自己身上
 *   （`rag/load.ts` 是惰性的），所以"索引读不到"这一类错从这里抛出来，
 *   由下面 `retrieveOnce` 的 catch 接住并发事件。
 *   ★ 反过来（让调用方在路由里先 await 好）会撞一堵墙：路由手上只有
 *   `EngineEvent`（带 `seq` / `at`），没有事件工厂——它发不出合法的 payload。
 *   让引擎自己经历这次失败，才既发得出事件、也不会有人伪造序号。
 */
export type PlanRetriever = (input: StoryPlanInput) => Promise<PlanRetrieval>

export type PlanOutcome = {
  tree: StoryTree
  /**
   * 模型吐回来的那张表（书名 + 每页草稿），也就是 `tree` 的原材料。
   *
   * 2026-10-17（故事闸门）加它：家长看到、能改的那一份就是它，
   *   盘上的 `books/<id>/story.json` 存的也是它（`lib/story-draft.ts`）。
   *   已经建好的 `tree` 不能反过来当编辑界面用——它上面带着 `nodeId` / `pathFromRoot` /
   *   `next` 这些派生出来的东西，让家长去改它们既没有意义，也不可能改对。
   */
  doc: PlanDraft
  /**
   * 这一版一共调了几次模型。1 = 一次过，是判据 1 的原始数据。
   * ★ 共读版走两步（`plan-shared.ts`）：一次成功最少 4 次调用，"1 = 一次过"在那一档
   *   不成立——它照旧按**调用次数**记，横评与成本那边读的才是同一件事。
   */
  attempts: number
  /** 每一次的失败原因，横评表要逐条列 */
  failures: readonly string[]
  modelId: string
  promptVersion: string
  /**
   * 这一版故事是看着哪些旧文本写出来的（2026-10-19）。没开检索就没有这个字段。
   * ★ 三种状态各不相同，别把它们并成两种（见 `domain.ts` 的 `RetrievalProvenance`）：
   *   没有这个字段 = 这一轮没打算检索；`corpusVersion: null` = 打算检索但没跑成；
   *   有值 = 检索跑了，`hits` 为空也是有信息量的（这次没取到相近的）。
   */
  retrieval?: RetrievalProvenance
}

export type PlanOptions = {
  text: TextGenerator
  form: BookForm
  maxAttempts?: number
  /**
   * 覆盖生成器的 token 预算。通常不传——留着它是给"同一家模型换个档"用的，
   * 常规路径上预算由适配器按模型决定。
   */
  maxTokens?: number
  /**
   * 流式增量（工单 07）。给了它就走 `stream()`，不给就走 `complete()`。
   *
   * 默认不给，是刻意的：脚本、横评、测试里的每一次规划调用都与加了这条路之前
   *   逐字节相同（同一条纪律见 `TextRequest.plainText` 的注释）。
   *   流式是界面要的东西，不是引擎的新默认——把它设成默认，等于让每一次跑测
   *   都换一条没量过的 HTTP 路径。
   * 重试时也会走流式（第二次起带着上一轮的问题重发）：界面看到的是"这一版又写了一遍"，
   *   而 `seq` 仍是发射顺序，所以两条流的 delta 不会串。
   */
  onDelta?: (delta: TextDelta) => void
  /** 流式的空闲超时（多久没有新 delta 算失败）。见 http.ts 的 DEFAULT_SSE_IDLE_TIMEOUT_MS */
  idleTimeoutMs?: number
  /**
   * 检索（2026-10-19）。不传就是这一轮不检索——与 `onDelta` 同一条纪律：
   * 新能力不做默认，因为默认一开，脚本与跑测走的就是一条没量过的路。
   */
  retrieve?: PlanRetriever
  /**
   * 让模型自己决定要不要查（2026-10-19，`.scratch/mcp` 工单 06）。
   *
   * 它与 `retrieve` 互斥，同时给会当场抛。理由不是实现难，是**它们是同一个问题的
   *   两种答案**："动笔之前先看以前写过什么"这件事，要么我们把材料先摆好（`retrieve`），
   *   要么把查找的工具交给模型（`tools`）。两个都给的话，"第三臂比第二臂好在哪"
   *   这个问题就答不出来了——两臂的差别会退化成"检索了两次 vs 一次"。
   *   工单 08 的三臂对照（关检索 / 预检索 / 模型自选工具）量的是这件事。
   * 与 `onDelta` 也互斥：工具循环要的是完整回包，而增量与 `tool_calls`
   *   的分片拼装是两件都不简单的事（`TextRequest.tools` 那段）。
   */
  tools?: readonly ToolDef[]
  /** 工具轮数上限。缺省见 `tool-loop.ts` */
  maxToolSteps?: number
  emit: (payload: EngineEventPayload) => void
}

export async function planStory(input: StoryPlanInput, opts: PlanOptions): Promise<PlanOutcome> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_PLAN_ATTEMPTS
  const failures: string[] = []

  // 两条互斥在这里当场抛（见 `PlanOptions.tools` 那段）：静默取一个的话，
  //   "第三臂"量出来的东西会是一条谁也没定义过的路，而报告上它看起来很正常。
  if (opts.tools && opts.retrieve) {
    throw new EngineError(
      'invalid-request',
      '`tools` 与 `retrieve` 是同一个问题的两种答案，不能同时给：要么预先检索，要么把工具交给模型',
    )
  }
  if (opts.tools && opts.onDelta) {
    throw new EngineError(
      'invalid-request',
      '`tools` 与 `onDelta` 不能同时给：工具循环要的是完整回包，不是流式增量',
    )
  }

  /**
   * ⓪ 家长那句自由输入过闸（2026-10-19，`.scratch/safety` 工单 02）。
   *
   * 为什么它非有不可：这一层下面紧接着的两件事都原样吃家长写的字——
   *   `retrieveOnce` 把那句话送去 embedding，`storyPlanUser` 把它拼进提示词
   *   （`主题：${input.theme}` / `家长希望孩子从中得到：${input.wish}` /
   *   `家长看完第一版之后的新要求：…`）。在这之前，那三处是任意文本直达。
   * 为什么在最前面，而不是"反正出图前还有一道"：下面那两道闸审的是模型写出来的东西。
   *   家长写"小狗流血死掉的故事"，模型照做的概率远高于它自己想起来写——
   *   那就变成"先让它写一版越线的、再拦下、再让它重写"，多花一次文本调用，
   *   而且让模型看了一遍那段内容（`ClauseDisposition` 里 `block` 那条理由）。
   * ★ 处置是拒发，`flag` 与 `block` 一样：这是别人的话，没有"重写一版"这条路。
   */
  const inputReview = reviewInput([
    { label: '主题', text: input.theme },
    ...(input.wish === undefined ? [] : [{ label: '你想让孩子得到的', text: input.wish }]),
    ...(input.reviseNote === undefined ? [] : [{ label: '改稿要求', text: input.reviseNote }]),
  ])
  if (inputReview.verdict !== 'pass') {
    const reason = inputReview.problems.map(reviewInputText).join('；')
    opts.emit({
      kind: 'review',
      stage: 'planning',
      check: 'safety',
      verdict: inputReview.verdict,
      reason,
    })
    throw new EngineError(
      'input-blocked',
      `你写的那句话里有不适合放进孩子的书里的内容：${reason}。改一下再来`,
      {
        detail: inputReview.problems.map((problem) => `${problem.field}:${problem.clauseId}`),
      },
    )
  }

  // 检索在重试循环之外，三次 attempt 共用同一份。
  //   理由是重试要改的是格式（文件头第 1 条：格式问题与语义问题分开报），
  //   不是"再找一批参考"。重试时换语料会让"这次为什么变好了"变成一个说不清的问题，
  //   而这批候选里谁的格式化输出最稳，正是要靠这个数回答的。
  const retrieval = await retrieveOnce(input, opts)
  /**
   * 共读版分流（2026-10-22）：两步规划（先提纲、再逐段展开）。
   *
   * 分流放在这里而不是函数最前面，是因为上面那两件事两种形态都要——
   * 家长那句话的过闸、检索取一次。分流之后共读版走的是另一套提示词，
   * 但产物是同一个 `PlanOutcome`，下游一行都不用改。
   */
  if (opts.form === 'shared') {
    return planSharedStory(input, opts, retrieval)
  }

  const baseUser = storyPlanUser(
    retrieval === null ? input : { ...input, retrieval: retrieval.pair },
  )

  /**
   * 最后一次失败是"内容审核没过"吗？是的话，最终那句错要用 `review-blocked`。
   *
   * ★ 2026-10-22 修：原来无论为什么失败，上界那一轮都抛 `schema-validation-failed`，
   *   而它的用户文案是「这个模型没能写出合格的故事表（换模型时最常见的坏法）」——
   *   **原因说反了**。故事被红线拦了五次，屏幕上却让家长去换模型；而错的其实是他要的
   *   那个故事（"换个说法"才对）。三处失败（Schema / 树形 / 内容）在重试上是同一条路，
   *   在**说给家长听的那句话**上不是。记最后一次，是因为重试提示用的也是最后一次那条。
   */
  let lastReview: string | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    opts.emit({ kind: 'stage', stage: 'planning', phase: 'begin', attempt, total: maxAttempts })

    const request: TextRequest = {
      system: storyPlanSystem(),
      // 第二次起，把上一轮的具体问题贴回去。这是通过率的决定因素之一
      user: attempt === 1 ? baseUser : withFeedback(baseUser, failures),
      jsonSchema: planJsonSchema(),
      temperature: 0.8,
      // 这里不给 maxTokens：预算随模型走，不随阶段走。
      //   写死在规划阶段的那版是 4096，而实测思考模型会把这个数整条花在思考链上、
      //   正文一个字都不写（见 openai-text.ts 的 DEFAULT_TEXT_MAX_TOKENS）。
      //   谁最清楚该给多少？适配器——它知道自己在跟哪个模型说话。
      maxTokens: opts.maxTokens,
    }
    // 这里不写 `opts.text.stream &&` 那种兜底：`stream` 在接口上是必填的
    //   （见 types.ts 里那段理由），写一个 "有就用、没有就算了" 的判断，
    //   等于把"必填"退回成一个建议——而它一旦真的缺失，症状是"界面上什么都没发生"
    const response = opts.tools
      ? // 带工具那一档走 `completeWithTools`（2026-10-19，`.scratch/mcp` 工单 06）：
        //   它把"模型要调工具就先调、把结果喂回去、直到它给最终答复"这件事包起来，
        //   而返回的 `text` 仍然是那张故事表——所以下面这一整段校验、重试、
        //   审核一个字都不用改。这就是"工具只是规划内部的一步"这句话的具体形状。
        await completeWithTools(request, {
          text: opts.text,
          tools: opts.tools,
          ...(opts.maxToolSteps === undefined ? {} : { maxSteps: opts.maxToolSteps }),
          emit: opts.emit,
        })
      : opts.onDelta
        ? await opts.text.stream(
            request,
            opts.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: opts.idleTimeoutMs },
            opts.onDelta,
          )
        : await opts.text.complete(request)

    const draft = parseWith(planDraftCodec, response.text)
    if (!draft.ok) {
      const message = `第 ${attempt} 次：Schema 校验未过\n${formatFailures(draft.failures)}`
      failures.push(message)
      lastReview = null
      /**
       * ★ 2026-10-20（`plan-retry.test.ts` 钉着）：`retry` **只在真的还有下一次时才发**。
       *
       * 它原来每一轮都发，于是上界那一轮（`attempt === maxAttempts`）也发——
       * 循环随即结束、抛 `schema-validation-failed`，而屏幕上最后留下的那句话是
       * 「这一版故事没通过校验，正在重写（第 3 / 3 次）」，下面根本没有第 3 次以后的重写。
       * 收尾的 fatal 帧把它换掉之前，它是那一屏唯一还在说的话：**一句空头承诺**。
       *
       * 上界那一轮的失败照旧进 `failures`（它是产出数据，回答的是"这一次为什么没过"，
       * 也是横评表逐条列的那一份），只是不再宣布"正在重写"。
       * 同一个引擎里 `illustrate.ts` 那两处 `retry`（一致性没过 / 画面没过）
       * 一直是 `attempt < lastAttempt` 的形状，这里对齐它，不是新发明的规矩。
       */
      if (attempt < maxAttempts) {
        opts.emit({
          kind: 'retry',
          stage: 'planning',
          attempt,
          maxAttempts,
          reason: `故事表格式不对（${draft.failures.length} 处）`,
        })
      }
      continue
    }

    const plan = asPlanDraft(draft.value)
    // ★ 第四个参数是"这一次要几页"（工单 D-08）。它在这里一定能给：`input.pages`
    //   是这次请求的一部分（缺省也已经在 `planBook` 里落成 20 / 8）。
    //   少了它，"要 6 给 7"会一路画到钱花完才有人发现
    const built = buildTree(opts.form, plan.title, plan.nodes, input.pages)
    if (!built.ok) {
      const message = `第 ${attempt} 次：树形不合法\n${formatProblems(built.problems)}`
      failures.push(message)
      lastReview = null
      // 同上一处：只在还有下一次时才说"正在重写"（`plan-retry.test.ts`）
      if (attempt < maxAttempts) {
        opts.emit({
          kind: 'retry',
          stage: 'planning',
          attempt,
          maxAttempts,
          reason: `故事结构不对（${built.problems.length} 处）`,
        })
      }
      continue
    }

    // ③ 内容审核（2026-10-19，`.scratch/rag` 工单 05）：在 plan-ready 之前。
    //    ★ 位置是刻意的：它必须在"这一版故事可以拿出去画"这句话说出口之前跑完——
    //      `plan-ready` 是那个承诺，而内容没过的故事不该得到那个承诺。
    //    ★ 代价上也是这里最划算：出图是这条流水线上唯一真花钱的一步，
    //      而这道闸在它之前，所以拦下来的那一版没有为插图花过钱。
    const review = reviewStory(built.tree)
    if (review.verdict !== 'pass') {
      const flagged = review.pages.filter((page) => page.verdict !== 'pass')
      const reason = flagged.map(reviewProblemText).join('；')
      opts.emit({
        kind: 'review',
        stage: 'planning',
        check: 'safety',
        verdict: review.verdict,
        reason,
      })

      // `block` 的处置是当场拒发、不重试（自伤与危险示范那两类，见 `ClauseDisposition`）：
      // 让模型看着那段内容再改一遍，本身就是一次多余的接触
      if (review.verdict === 'block') {
        throw new EngineError('review-blocked', `这一版故事被内容审核拦下了：${reason}`, {
          detail: flagged.map(
            (page) => `${page.pageNo}:${page.problems.map((p) => p.clauseId).join(',')}`,
          ),
        })
      }

      failures.push(`第 ${attempt} 次：内容审核没过\n${reason}`)
      lastReview = reason
      // 同上一处：只在还有下一次时才说"正在重写"（`plan-retry.test.ts`）。
      //   ★ 上面那条 `review` 事件**不**受影响：它报的是一个真发现（这一版里有什么、
      //   命中哪条），上界那一轮也发生过，所以它照发。压掉的只是"正在重写"这一句。
      if (attempt < maxAttempts) {
        opts.emit({
          kind: 'retry',
          stage: 'planning',
          attempt,
          maxAttempts,
          // 重试那句话里也要带条款 id（判据 5），但只带前三页：
          //   它在屏幕上是一行，二十页都说出来就没人读得完。完整的在 `failures` 里。
          reason: `故事里有不该给孩子看的内容：${flagged
            .slice(0, 3)
            .map(reviewProblemText)
            .join('；')}${flagged.length > 3 ? `…共 ${flagged.length} 处` : ''}`,
        })
      }
      continue
    }

    opts.emit({
      kind: 'plan-ready',
      stage: 'planning',
      form: built.tree.form,
      title: built.tree.title,
      nodeCount: built.tree.nodes.length,
      choicePages: built.tree.nodes.filter((node) => node.choice).map((node) => node.pageNo),
      // 两条支各自的页（工单 05 §三）：画桌要按它给岔路那几格挂色带。
      // 与上面那两行同一个来源（同一棵已经校验过的树），所以不会各说一套
      branchPages: branchPagesOf(built.tree),
    })
    return {
      tree: built.tree,
      doc: plan,
      attempts: attempt,
      failures,
      modelId: response.modelId,
      promptVersion: STORY_PLAN_VERSION,
      // 没开检索时不给这个字段（不是给一个空的）——见 PlanOutcome 那条注释
      ...(retrieval === null ? {} : { retrieval: retrieval.provenance }),
    }
  }

  /*
   * 最后一次失败是内容审核：说内容，不说"格式不对"。
   * 屏幕上的用户版由 `provider-messages.ts` 的 `review-blocked` 给（"这一版里有不该给孩子看的
   * 内容…换一个说法再试一次"），这里只把**最后一次**命中的那一页/哪一条带上——五次都贴上去
   * 是五段一样的字。逐次记录在 `detail` 里，日志与排障读它。
   */
  if (lastReview !== null) {
    throw new EngineError('review-blocked', `这一版故事里有不该给孩子看的内容：${lastReview}`, {
      detail: failures,
    })
  }

  throw new EngineError(
    'schema-validation-failed',
    `${maxAttempts} 次规划都没能产出合法的故事表：\n${failures.join('\n')}`,
    {
      detail: failures,
    },
  )
}

/** 检索那一步：跑、发事件、把结果整理成 provenance。它自己绝不抛错（见下） */
async function retrieveOnce(
  input: StoryPlanInput,
  opts: PlanOptions,
): Promise<{ pair: RetrievePair; provenance: RetrievalProvenance } | null> {
  if (!opts.retrieve) return null

  opts.emit({ kind: 'stage', stage: 'retrieving', phase: 'begin' })
  try {
    const { pair, corpusVersion } = await opts.retrieve(input)
    const provenance = provenanceOf(pair, corpusVersion)
    opts.emit({
      kind: 'retrieved',
      stage: 'retrieving',
      corpusVersion,
      examples: provenance.examples,
      avoids: provenance.avoids,
      topScore: provenance.topScore,
    })
    return { pair, provenance }
  } catch (err) {
    // ★ 检索失败不许拖垮规划：它是一段可选的参考材料，不是这本书的前提。
    //   一条检索不到的范例不该让家长看到"生成失败"——他要的那本书本来就能编出来。
    // ★ 但不许静默：两件事各记一条，因为它们回答的是不同的问题——
    //   `retrieved`（corpusVersion 为 null）回答"这一步发生了吗"（发生了，但没成）；
    //   `error`（非致命）回答"为什么没成"，把真话留在日志里。
    //   只记前者的话，索引坏了这件事就永远查不出来。
    opts.emit({
      kind: 'retrieved',
      stage: 'retrieving',
      corpusVersion: null,
      examples: 0,
      avoids: 0,
      topScore: null,
    })
    opts.emit({
      kind: 'error',
      stage: 'retrieving',
      code: 'retrieval-failed',
      message: `检索没成（照常往下编）：${err instanceof Error ? err.message : String(err)}`,
      fatal: false,
    })
    return {
      pair: { examples: [], avoids: [] },
      provenance: { corpusVersion: null, examples: 0, avoids: 0, topScore: null, hits: [] },
    }
  }
}

function refOf(
  hit: RetrievePair['examples'][number],
  polarity: 'example' | 'avoid',
): RetrievedChunkRef {
  return {
    chunkId: hit.chunk.id,
    source: hit.chunk.source,
    score: hit.score,
    polarity,
  }
}

/** 取到的两栏 → provenance。★ `topScore` 是两类一起的最高分：它是"这次检索的把握"那个数 */
function provenanceOf(pair: RetrievePair, corpusVersion: string): RetrievalProvenance {
  const hits: RetrievedChunkRef[] = [
    ...pair.examples.map((hit) => refOf(hit, 'example')),
    ...pair.avoids.map((hit) => refOf(hit, 'avoid')),
  ]
  return {
    corpusVersion,
    examples: pair.examples.length,
    avoids: pair.avoids.length,
    topScore: hits.length === 0 ? null : Math.max(...hits.map((hit) => hit.score)),
    hits,
  }
}

function formatProblems(problems: readonly TreeProblem[]): string {
  return problems
    .slice(0, 8)
    .map((problem) => `- 第 ${problem.index || '?'} 页：${problem.message}`)
    .join('\n')
}
