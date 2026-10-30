/**
 * plan-shared.ts —— 共读版的两步规划（2026-10-22）
 *
 * 第一步写提纲（每一页一句话），第二步**一段一段**把提纲展开成页。页数由我们的算术
 * 与 schema 的 `minItems`/`maxItems` 钉死，不再由模型自己数——这一步是这一整条路存在的理由，
 * 实测与推理写在 `prompts/story-outline.ts` 的文件头与 `docs/known-tradeoffs.md`。
 *
 * 三件事不在模型手里：
 *
 * 1. **树形**（`from` / `via`）：提纲是三个数组，顺序就是页序；树干接树干、两支各接在
 *    选择点那一页上，由下面 `assemble` 拼。模型写不出一棵形状不对的树。
 * 2. **页数**：三段各几行由 `choicePageOf(pages)` 算出来，写进 schema 的
 *    `minItems`/`maxItems`（闭区间）；展开那一步再按段的页数钉一次。模型只负责把行写满。
 * 3. **哪一页是选择点**：`choicePageOf(pages)`，主干的最后一行。它曾经交给模型定
 *    （"主干写几行就是第几页"），实测它会交出 16 页的提纲——见 `schemas/story.ts` 那段 ★。
 *
 * 审核（`reviewStory` 那一族）**在每一段写完就立刻跑一次**，不是等三段都写完：
 * 一段里有一句越线的话，另一段就没必要再写（`block` 那一类连重写都没有）。
 * 三段都过之后整本再审一次（书名 + 每一页），那一次是权威——它就是独读版走的那道闸。
 *
 * 与独读版那条一次性路径的关系：`planStory` 在拿到检索结果之后分流（`plan.ts`）。
 * 两条路的产物是同一个 `PlanOutcome`（`doc` 是同一张故事表、`tree` 由同一个 `buildTree`
 * 派生），所以下游（故事闸门、`story.json`、出图）一行都不用改。
 */

import {
  SHARED_PLAN_VERSION,
  sharedExpandSystem,
  sharedExpandUser,
  sharedOutlineSystem,
  sharedOutlineUser,
  type ExpandSection,
} from '../prompts/story-outline.ts'
import {
  asSectionExpansion,
  asStoryOutline,
  expansionCodecFor,
  outlineCodecFor,
  type ChoiceDraft,
  type NodeDraft,
  type PlanDraft,
  type SectionExpansion,
  type StoryOutline,
} from '../schemas/story.ts'
import { formatFailures, parseWith } from '../schemas/schema.ts'
import { EngineError } from './errors.ts'
import { withFeedback } from './retry-feedback.ts'
import { DEFAULT_PLAN_ATTEMPTS } from './plan-limits.ts'
import { completeWithTools } from './tool-loop.ts'
import { branchPagesOf, buildTree } from './tree.ts'
import {
  reviewPages,
  reviewProblemText,
  reviewStory,
  reviewTextsOf,
  type PageReview,
} from './review.ts'
import { judgeIfSuspect } from './review-judge.ts'
import type { StoryPlanInput } from '../prompts/story-plan.ts'
import type { RetrievalProvenance } from './domain.ts'
import type { RetrievePair } from '../rag/retrieve.ts'
import type { TextRequest } from './providers/types.ts'
import type { PlanOptions, PlanOutcome } from './plan.ts'

/** 检索那一步的结果。`null` = 这一轮没打算检索（与 `plan.ts` 那条同一条口径） */
type Retrieval = { pair: RetrievePair; provenance: RetrievalProvenance } | null

/** 展开的顺序就是装配的顺序：主干必须先写，两支的"上一页"是主干的最后一页 */
const SECTIONS: readonly ExpandSection[] = ['main', 'a', 'b']

export async function planSharedStory(
  input: StoryPlanInput,
  opts: PlanOptions,
  retrieval: Retrieval,
): Promise<PlanOutcome> {
  if (input.form !== 'shared') {
    throw new EngineError('invalid-request', 'planSharedStory 只处理共读版')
  }
  /*
   * 共读版至少要 3 页：选择点不能是第 1 页（没有铺垫），每条路之后至少还要 1 页，
   * 所以 2 + 1 = 3 是这条形状的下界。2 页的请求在 `choicePageOf` 那里会算出
   * "主干 2 + 每支 1 = 3 页"，而那不是他要的那本书——所以在这里当场说清楚，
   * 不放它进去撞页数判据。
   */
  if (input.pages < 3) {
    throw new EngineError(
      'invalid-request',
      `共读版至少要 3 页（一个选择点 + 每支至少 1 页），这次要的是 ${input.pages} 页`,
    )
  }
  const maxAttempts = opts.maxAttempts ?? DEFAULT_PLAN_ATTEMPTS
  const failures: string[] = []

  const outlineStep = await planOutline(input, opts, retrieval, maxAttempts, failures)
  const outline = outlineStep.outline

  const sections: Partial<Record<ExpandSection, SectionExpansion>> = {}
  /**
   * ★ 这里的 `attempts` 是**一共调了几次模型**（提纲 + 三段展开），不是"第几次才成功"。
   *   两步规划里"一次过"没有意义——成功的那一本最少也是 4 次调用。让这个数保持是
   *   "调用次数"，横评/账单那边读的才是同一件事。
   */
  let attempts = outlineStep.attempts
  let modelId = outlineStep.modelId

  for (const section of SECTIONS) {
    const previous = previousOf(section, sections)
    const expanded = await expandSection(
      { input, outline, section, ...(previous ? { previous } : {}) },
      { opts, maxAttempts, failures },
    )
    sections[section] = expanded.expansion
    attempts += expanded.attempts
    modelId = expanded.modelId
  }

  const { doc } = assemble(outline, {
    main: sections.main as SectionExpansion,
    a: sections.a as SectionExpansion,
    b: sections.b as SectionExpansion,
  })

  // ★ 第四个参数是"这一次要几页"（工单 D-08）。这里一定给得出，而且一定过——
  //   树是按提纲拼的，长度是算出来的。留着它是因为它同时守着一件事：
  //   装配代码改坏了会在这里当场被抓住，而不是画到钱花完才有人发现。
  const built = buildTree('shared', doc.title, doc.nodes, input.pages)
  if (!built.ok) {
    throw new EngineError(
      'schema-validation-failed',
      `共读版拼出来的树不合法（这是引擎的问题，不是模型的问题）：\n${built.problems
        .map((problem) => problem.message)
        .join('\n')}`,
    )
  }

  /*
   * 整本再走一次那道闸。分段时每一段都审过了，这一次多审的只有书名——
   * 但它是**权威**：`reviewStory` 是独读版走的同一道闸，共读版不该有一条自己的审核口径。
   * 走到这里还不 `pass` 说我们的分段审核漏了东西，所以它是引擎级错误，不是重试理由。
   */
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
    throw new EngineError('review-blocked', `这一版故事被内容审核拦下了：${reason}`, {
      detail: flagged.map(
        (page) => `${page.pageNo}:${page.problems.map((p) => p.clauseId).join(',')}`,
      ),
    })
  }

  /**
   * 语义复核（2026-10-30）：与独读版同一道兜底，位置也一样——词表过了之后、plan-ready 之前。
   *
   * 它在这里**不重试**：共读版是一次提纲 + 三次展开拼出来的，到了这一步整本已经写完，
   * 重试等于把三段全部重写一遍。所以 `flag` 与 `block` 的下一步与这道闸的上一段一样：
   * 拒发，退回去改。事件由 `judgeIfSuspect` 发。
   */
  const judged = await judgeIfSuspect(built.tree, {
    text: opts.judge,
    input: {
      theme: input.theme,
      ...(input.wish === undefined ? {} : { wish: input.wish }),
      ...(input.reviseNote === undefined ? {} : { reviseNote: input.reviseNote }),
    },
    emit: opts.emit,
    stage: 'planning',
  })
  if (judged && (judged.outcome.verdict === 'flag' || judged.outcome.verdict === 'block')) {
    throw new EngineError(
      'review-blocked',
      `这一版故事被内容审核拦下了：${judged.outcome.reason}`,
      {
        detail: judged.outcome.findings.map((finding) => `${finding.pageNo}:${finding.clauseId}`),
      },
    )
  }

  opts.emit({
    kind: 'plan-ready',
    stage: 'planning',
    form: built.tree.form,
    title: built.tree.title,
    nodeCount: built.tree.nodes.length,
    choicePages: built.tree.nodes.filter((node) => node.choice).map((node) => node.pageNo),
    branchPages: branchPagesOf(built.tree),
  })

  return {
    tree: built.tree,
    doc,
    attempts,
    failures,
    modelId,
    promptVersion: SHARED_PLAN_VERSION,
    ...(retrieval === null ? {} : { retrieval: retrieval.provenance }),
  }
}

/* ── ① 提纲 ─────────────────────────────────────────────────────────── */

async function planOutline(
  input: StoryPlanInput,
  opts: PlanOptions,
  retrieval: Retrieval,
  maxAttempts: number,
  failures: string[],
): Promise<{ outline: StoryOutline; attempts: number; modelId: string }> {
  const baseUser = sharedOutlineUser(
    retrieval === null ? input : { ...input, retrieval: retrieval.pair },
  )
  const local: string[] = []
  let modelId = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    opts.emit({ kind: 'stage', stage: 'planning', phase: 'begin', attempt, total: maxAttempts })

    const request: TextRequest = {
      system: sharedOutlineSystem(),
      user:
        local.length === 0
          ? baseUser
          : withFeedback(baseUser, [local[local.length - 1] ?? ''], '整个提纲'),
      jsonSchema: outlineCodecFor(input.pages).describe(),
      temperature: 0.8,
      maxTokens: opts.maxTokens,
    }
    // 工具只用在这一步：模型"动笔之前去看看书架上写过什么"是提纲的事，
    //   展开那一步手上已经有提纲了（与 `PlanOptions.tools` 那段的分工一致）。
    const response = await callText(request, opts, true)
    modelId = response.modelId

    const parsed = parseWith(outlineCodecFor(input.pages), response.text)
    if (!parsed.ok) {
      /**
       * 页数不对也落在这里：`outlineCodecFor` 把三段的行数写成闭区间，所以
       * "main 写了 7 行、要 8 行"报的是 `main：数量不足（7 < 8）`。
       * 那句话模型能直接照着改——这正是以前"约 20 页"做不到的事。
       */
      const message = `第 ${attempt} 次：提纲不对\n${formatFailures(parsed.failures)}`
      local.push(message)
      failures.push(message)
      if (attempt < maxAttempts) {
        opts.emit({
          kind: 'retry',
          stage: 'planning',
          attempt,
          maxAttempts,
          reason: `故事提纲不对（${parsed.failures.length} 处）`,
        })
      }
      continue
    }

    const outline = asStoryOutline(parsed.value)

    /*
     * 书名也在这里审。`reviewStory` 会把书名当成 `pageNo: 0` 一并审，
     * 但那时候三段都写完了——为了一个书名重写三段是不划算的，而且它根本不该走到那一步。
     */
    const titleReview = reviewPages([{ pageNo: 0, texts: [outline.title] }])[0]
    if (titleReview && titleReview.verdict !== 'pass') {
      opts.emit({
        kind: 'review',
        stage: 'planning',
        check: 'safety',
        verdict: titleReview.verdict,
        reason: reviewProblemText(titleReview),
      })
      if (titleReview.verdict === 'block') {
        throw new EngineError(
          'review-blocked',
          `这个书名被内容审核拦下了：${reviewProblemText(titleReview)}`,
        )
      }
      const message = `第 ${attempt} 次：书名没过内容审核\n${reviewProblemText(titleReview)}`
      local.push(message)
      failures.push(message)
      if (attempt < maxAttempts) {
        opts.emit({
          kind: 'retry',
          stage: 'planning',
          attempt,
          maxAttempts,
          reason: `书名里有不该给孩子看的内容：${reviewProblemText(titleReview)}`,
        })
      }
      continue
    }

    return { outline, attempts: attempt, modelId }
  }

  throw new EngineError(
    'schema-validation-failed',
    `${maxAttempts} 次都没能写出一份页数正确的提纲：\n${failures.join('\n')}`,
    { detail: failures },
  )
}

/* ── ② 逐段展开 ─────────────────────────────────────────────────────── */

type ExpandContext = {
  input: StoryPlanInput
  outline: StoryOutline
  section: ExpandSection
  previous?: PrevPage
}

/** 紧挨着这一段前一页的成品（用来接住语气与画面） */
type PrevPage = { pageNo: number; body: readonly string[]; imagePrompt: string }

async function expandSection(
  context: ExpandContext,
  args: { opts: PlanOptions; maxAttempts: number; failures: string[] },
): Promise<{ expansion: SectionExpansion; attempts: number; modelId: string }> {
  const { opts, maxAttempts, failures } = args
  const count =
    context.section === 'main'
      ? context.outline.main.length
      : context.section === 'a'
        ? context.outline.branchA.length
        : context.outline.branchB.length
  const withChoice = context.section === 'main'
  const codec = expansionCodecFor(count, withChoice)

  const baseUser = sharedExpandUser(context)
  /**
   * 这一轮这个段自己的失败清单。★ 不共用全局那份：上一段失败过、这一版已经改好了，
   * 把它的旧问题贴回来会让模型去改一处已经对的地方。
   */
  const local: string[] = []
  const label = sectionLabel(context.section)
  let modelId = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    opts.emit({ kind: 'stage', stage: 'planning', phase: 'begin', attempt, total: maxAttempts })

    const request: TextRequest = {
      system: sharedExpandSystem(count, withChoice),
      user:
        local.length === 0
          ? baseUser
          : withFeedback(baseUser, [local[local.length - 1] ?? ''], '这一段'),
      jsonSchema: codec.describe(),
      temperature: 0.8,
      maxTokens: opts.maxTokens,
    }
    const response = await callText(request, opts, false)
    modelId = response.modelId

    const parsed = parseWith(codec, response.text)
    if (!parsed.ok) {
      const message = `第 ${attempt} 次：${label}展开格式不对\n${formatFailures(parsed.failures)}`
      local.push(message)
      failures.push(message)
      if (attempt < maxAttempts) {
        opts.emit({
          kind: 'retry',
          stage: 'planning',
          attempt,
          maxAttempts,
          reason: `${label}展开不对（${parsed.failures.length} 处）`,
        })
      }
      continue
    }

    const expansion = asSectionExpansion(parsed.value, withChoice)
    /*
     * ★ 这一段写完就审，不等三段都写完：一句话越线，剩下的段就不用再写（`block` 那一类
     *   连重写的机会都没有）。审核用的是 `reviewStory` 的同一份"一页审哪几段字"
     *   （`reviewTextsOf`），所以它不是一条更松的旁路。
     */
    const flagged = sectionReviewOf(expansion, context).filter((page) => page.verdict !== 'pass')
    if (flagged.length > 0) {
      const blocked = flagged.some((page) => page.verdict === 'block')
      const reason = flagged.map(reviewProblemText).join('；')
      opts.emit({
        kind: 'review',
        stage: 'planning',
        check: 'safety',
        verdict: blocked ? 'block' : 'flag',
        reason,
      })
      if (blocked) {
        throw new EngineError('review-blocked', `这一版故事被内容审核拦下了：${reason}`, {
          detail: flagged.map(
            (page) => `${page.pageNo}:${page.problems.map((p) => p.clauseId).join(',')}`,
          ),
        })
      }
      const message = `第 ${attempt} 次：${label}内容审核没过\n${reason}`
      local.push(message)
      failures.push(message)
      if (attempt < maxAttempts) {
        opts.emit({
          kind: 'retry',
          stage: 'planning',
          attempt,
          maxAttempts,
          reason: `故事里有不该给孩子看的内容：${reason}`,
        })
      }
      continue
    }

    return { expansion, attempts: attempt, modelId }
  }

  throw new EngineError(
    'schema-validation-failed',
    `${label}那 ${count} 页写了 ${maxAttempts} 次都没过校验：\n${failures.join('\n')}`,
    { detail: failures },
  )
}

/**
 * 一段的字过一遍闸。页码按"它在整本书里是第几页"标（不是段内序号），
 * 因为重试提示与事件里说的都是书上的页。
 */
function sectionReviewOf(expansion: SectionExpansion, context: ExpandContext): PageReview[] {
  const start = startPageOf(context.outline, context.section)
  const last = expansion.pages.length - 1
  return reviewPages(
    expansion.pages.map((page, index) => ({
      pageNo: start + index,
      texts: reviewTextsOf({
        ...page,
        ...(context.section === 'main' && index === last && expansion.choice
          ? { choice: choiceOf(expansion.choice) }
          : {}),
      }),
    })),
  )
}

/** `ChoiceDraft` → `reviewTextsOf` 认的那个形状（九格已经由 schema 保证不缺） */
function choiceOf(draft: ChoiceDraft): {
  prompt: string
  options: { label: string; spoken: string }[]
} {
  return {
    prompt: draft.ask ?? '',
    options: [
      { label: draft.labelA ?? '', spoken: draft.spokenA ?? '' },
      { label: draft.labelB ?? '', spoken: draft.spokenB ?? '' },
    ],
  }
}

function sectionLabel(section: ExpandSection): string {
  return section === 'main' ? '主干' : section === 'a' ? 'A 支' : 'B 支'
}

function startPageOf(outline: StoryOutline, section: ExpandSection): number {
  if (section === 'main') return 1
  if (section === 'a') return outline.main.length + 1
  return outline.main.length + outline.branchA.length + 1
}

/**
 * 三段成品 → 一张故事表（`PlanDraft`，与独读版那份同一个形状）。
 *
 * `from` / `via` 在这里写死：主干是一条链，两支各自接在**选择点那一页**上、各自往下。
 * 页码按平铺顺序连续编号，回到 `tree.ts` 文件头那句约定（`from` 是表里的 1 起序号）。
 */
function assemble(
  outline: StoryOutline,
  sections: Record<ExpandSection, SectionExpansion>,
): { doc: PlanDraft } {
  const main = sections.main.pages
  const a = sections.a.pages
  const b = sections.b.pages
  const nodes: NodeDraft[] = []

  main.forEach((page, index) => {
    const isChoice = index === main.length - 1
    nodes.push({
      ...page,
      ...(isChoice && sections.main.choice ? sections.main.choice : {}),
    })
  })

  const choicePage = main.length
  a.forEach((page, index) => {
    nodes.push({
      ...page,
      ...(index === 0 ? { from: choicePage, via: 'a' } : { from: choicePage + index }),
    })
  })

  const startB = choicePage + a.length + 1
  b.forEach((page, index) => {
    nodes.push({
      ...page,
      ...(index === 0 ? { from: choicePage, via: 'b' } : { from: startB + index - 1 }),
    })
  })

  return { doc: { title: outline.title, nodes } }
}

/** 主干第一段没有"上一页"；两支的上一页都是主干的最后一页（选择点那一页） */
function previousOf(
  section: ExpandSection,
  sections: Partial<Record<ExpandSection, SectionExpansion>>,
): PrevPage | undefined {
  if (section === 'main') return undefined
  const main = sections.main?.pages ?? []
  const last = main[main.length - 1]
  if (!last) return undefined
  return { pageNo: main.length, body: last.body, imagePrompt: last.imagePrompt }
}

/**
 * 一次文本调用：带工具（只有提纲那一步会）或流式或一次性。
 *
 * 入参窄成 `{system, user}` 那一支：工具循环只吃这一种（`ToolLoopRequest`）。
 * 三步的请求都是这种形状，所以这里不是特例，是把"我们只用这一支"写进类型里。
 *
 * 与 `plan.ts` 里那段同一条纪律：`stream` 在接口上是必填的，所以不写"有就用"的兜底。
 */
async function callText(
  request: TextRequest & { system: string; user: string },
  opts: PlanOptions,
  allowTools: boolean,
): Promise<{ text: string; modelId: string }> {
  if (allowTools && opts.tools) {
    return completeWithTools(request, {
      text: opts.text,
      tools: opts.tools,
      ...(opts.maxToolSteps === undefined ? {} : { maxSteps: opts.maxToolSteps }),
      emit: opts.emit,
    })
  }
  if (opts.onDelta) {
    return opts.text.stream(
      request,
      opts.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: opts.idleTimeoutMs },
      opts.onDelta,
    )
  }
  return opts.text.complete(request)
}
