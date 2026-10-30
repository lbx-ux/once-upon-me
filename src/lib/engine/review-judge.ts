/**
 * review-judge.ts —— 语义复核：词表之外那一档，只在可疑信号命中时问一次模型（2026-10-30）
 *
 * 它是评分表 #5 的第二档，也是 `review.ts` 文件头里那句"等语义档落地"的兑现处。
 * 三件事划清，混淆任何一件都会让"审核"这个词失去意义：
 *
 *   |            | 词表闸（`review.ts`）        | 语义复核（本文件）              |
 *   | ---------- | ---------------------------- | ------------------------------- |
 *   | 判据       | 词表命中，确定性、可复现     | 模型判断，不可复现              |
 *   | 身份       | 判据                         | 兜底                            |
 *   | 什么时候跑 | 每一段都跑                   | 只在 `suspicion.ts` 命中时跑一次 |
 *   | 能宣称的   | "命中的一律拦下，词可复核"   | "跑了多少本、报了什么、丢了几条" |
 *
 * 所以任何地方都不许说"我们覆盖了红线"——能说的是这一路的两句话加起来：
 * 词表命中的一律拦下；词表没命中的里面，可疑的那几本**另外问过一次模型，并且它的引用
 * 逐条回原文核过**。
 *
 * 四条实现上的决定：
 *
 * 1. **`quote` 必须回原文里逐字找得到。** 找不到就丢，并记进 `dropped`。
 *    这是这一档唯一的防幻觉手段：模型很擅长概括一段气氛，而概括过的句子没有任何一条
 *    能被家长指出来改。丢了不抛——一条编造的发现不该让整本书失败，但也不能算数。
 * 2. **页码对不上时，按引用内容重新定位。** 模型把第 5 页的一句引成第 7 页是常事。
 *    引用在全书唯一出现时，以**引用**为准（那是它真读到的东西）；出现在多页、或者
 *    一页都找不到，就丢掉（分不清是哪一页时，报出来对家长没有用）。
 * 3. **跑不成走 `unavailable`，不拦。** 它与画面那一档同一条：没有判据的拦截是假拦。
 *    词表那一道已经过了，网络错误不该变成"你的故事不安全"。调用方会看到一条
 *    `verdict: 'unavailable'` 的事件，界面能说出来"这一档没跑成"。
 * 4. **一次一本，一版一次。** 重试时故事变了，会再跑一次；同一版不重复问。
 *    这一次调用**不计入** `PlanOutcome.attempts`——那个数是"规划重试了几次"，
 *    是成本与横评的口径；把兜底调用混进去，两份账都开始说不清。
 *
 * ★ 与 `review.ts` 的关系是调用关系，不是合并：`review.ts` 保持纯函数（词表、可测、
 *   浏览器安全），这一层负责 async 与模型。把它塞进 `review.ts` 会让那 1550 条用例里
 *   一大片忽然需要假供应商——而它们要测的是词表。
 *
 * ★ **读数一：手写的边界样本**（`node scripts/safety-judge-cases.mts`，`deepseek-flash`）：
 *   越线 10/10 拦下（委婉死亡 ×3、留白吓人 ×3、说教 ×2、情绪悬着 ×1、超龄 ×1），
 *   正常 10/10 放行，`dropped` 0，没测成 0，单次 0.4–1.5 s。
 *   触发闸对越线 10/10 命中、对正常样本 2/10（两条本身就有短页）。
 *
 * ★ **读数二：盘上的真书与 12 本样书**（`node scripts/safety-judge-real-books.mts`）：
 *   5 本真书 + 12 本样书 × 每本 3 次 = 51 次。**触发 0/17**——生产上这一批一本都不会多花调用。
 *   直接问模型（绕过触发闸）时 **1/17 本、3/51 次**报，全是《慢慢来》末句
 *   「慢慢来，也很好。」判成 R-07 说教。人工读全文：那是与书名呼应的点题句，
 *   不是"教他做人"的段落——**记为误报边界，不为这一条改提示词**（单一样本上调参是过拟合）。
 *   其余 16 本三次全放行；`dropped` 0、没测成 0。
 *
 * ★ **漏拦率这一轮量不了**：那 17 本假定干净、没有人工标注的"本该被拦"的真值；
 *   人工通读也没有发现这五类里的越线。所以能说的是"这一批上没有发现漏拦"，
 *   **不是**"漏拦率是 0"。要后者，得先有一份标好的语料。
 *   在那之前，任何地方都不许写"语义档覆盖了 XX%"。
 */

import {
  SAFETY_JUDGE_VERSION,
  safetyJudgeSystem,
  safetyJudgeUser,
} from '../prompts/safety-judge.ts'
import { formatFailures, parseWith } from '../schemas/schema.ts'
import { safetyFindingsCodec, safetyJsonSchema } from '../schemas/safety.ts'
import { clauseById, type ClauseCategory } from '../rag/review-corpus.ts'
import { suspicionOf, type Suspicion, type SuspicionInput } from './suspicion.ts'
import type { StoryTree } from './domain.ts'
import type { EngineEventPayload } from './events.ts'
import type { TextGenerator, TextRequest } from './providers/types.ts'
import type { ReviewProblem, ReviewVerdict } from './review.ts'

export type JudgeFinding = ReviewProblem & { pageNo: number }

export type JudgeOutcome = {
  /** `unavailable` = 触发过、但这一次没问成（见文件头第 3 条） */
  verdict: ReviewVerdict
  findings: readonly JudgeFinding[]
  /**
   * 模型报了、但回原文里找不到（或页码分不清）的条数。
   * ★ 它是一个读数，不是一个错误：这一档的幻觉率就靠它回答。
   */
  dropped: number
  /** 一句话，给事件与错误消息。`pass` 时是空串（这一档没有"通过了"这句话要说） */
  reason: string
  modelId: string
  promptVersion: string
}

/** 这一次触发它的信号。调用方拿它写日志（`judgeIfSuspect` 不外传，但测试要看） */
export type JudgeTrace = {
  signals: readonly Suspicion[]
}

function squeeze(text: string): string {
  return text.replace(/\s+/g, '')
}

/** 每一页（含书名 0）能拿去核对引用的那份文本 */
function pageTextsOf(tree: StoryTree): Map<number, string> {
  const pages = new Map<number, string>()
  pages.set(0, squeeze(tree.title))
  for (const node of tree.nodes) {
    const choice = node.choice
      ? [node.choice.prompt, ...node.choice.options.flatMap((o) => [o.label, o.spoken])]
      : []
    pages.set(node.pageNo, squeeze([...node.body, ...choice].join('')))
  }
  return pages
}

/**
 * 引用在哪一页。见文件头第 2 条：
 *   先说它自己报的那一页；对不上就全书唯一匹配；还是不行就 `null`（丢掉）。
 */
function locateQuote(
  quote: string,
  claimed: number,
  pages: ReadonlyMap<number, string>,
): number | null {
  const needle = squeeze(quote)
  if (needle.length < 2) return null
  if ((pages.get(claimed) ?? '').includes(needle)) return claimed
  const hits = [...pages.entries()].filter(([, text]) => text.includes(needle))
  return hits.length === 1 ? hits[0]![0] : null
}

function problemText(finding: JudgeFinding): string {
  const where = finding.pageNo === 0 ? '书名' : `第 ${finding.pageNo} 页`
  return `${where}：${finding.category}（${finding.clauseId}）——出现了「${finding.word}」`
}

/** 一条发现的一句话，给事件、重试反馈、错误消息三处共用（与 `reviewProblemText` 同形） */
export function judgeProblemText(finding: JudgeFinding): string {
  return problemText(finding)
}

function reasonOf(findings: readonly JudgeFinding[]): string {
  return findings.slice(0, 3).map(problemText).join('；')
}

function unavailable(message: string, modelId: string): JudgeOutcome {
  return {
    verdict: 'unavailable',
    findings: [],
    dropped: 0,
    reason: `语义复核没跑成：${message}`,
    modelId,
    promptVersion: SAFETY_JUDGE_VERSION,
  }
}

/**
 * 问一次模型。不做信号判断——那是 `judgeIfSuspect` 的事，测试与脚本要单独跑这一层时用它。
 */
export async function judgeStory(tree: StoryTree, text: TextGenerator): Promise<JudgeOutcome> {
  const request: TextRequest = {
    system: safetyJudgeSystem(),
    user: safetyJudgeUser(tree),
    jsonSchema: safetyJsonSchema(),
    // 复核不是创作：同样的稿子问两次，答案不该变。温度 0 不保证确定性（画面那一档量过），
    //   但它是这个方向上唯一的旋钮。
    temperature: 0,
  }

  let raw: string
  try {
    raw = (await text.complete(request)).text
  } catch (err) {
    return unavailable(err instanceof Error ? err.message : String(err), text.modelId)
  }

  const parsed = parseWith(safetyFindingsCodec, raw)
  if (!parsed.ok) {
    const first = parsed.failures[0]
    const where = first?.path ? `${first.path}：` : ''
    return unavailable(
      `回答不是预期的 JSON（${where}${first?.message ?? formatFailures(parsed.failures, 1)}）`,
      text.modelId,
    )
  }

  const pages = pageTextsOf(tree)
  const findings: JudgeFinding[] = []
  let dropped = 0
  for (const draft of parsed.value.findings) {
    const pageNo = locateQuote(draft.quote, draft.pageNo, pages)
    if (pageNo === null) {
      dropped += 1
      continue
    }
    const clause = clauseById(draft.clauseId)
    const category: ClauseCategory = clause?.category ?? '适龄'
    findings.push({
      pageNo,
      clauseId: draft.clauseId,
      category,
      // 认不出的 id 归 `rewrite`，与画面那一档同一条：保留原文，但不给它拒发的权力
      disposition: clause?.disposition ?? 'rewrite',
      word: draft.quote,
      context: draft.why,
    })
  }

  const verdict: ReviewVerdict = findings.some((finding) => finding.disposition === 'block')
    ? 'block'
    : findings.length > 0
      ? 'flag'
      : 'pass'

  return {
    verdict,
    findings,
    dropped,
    reason: verdict === 'pass' ? '' : reasonOf(findings),
    modelId: text.modelId,
    promptVersion: SAFETY_JUDGE_VERSION,
  }
}

export type JudgeWiring = {
  /** 没有文本能力 = 这一条路不做语义复核（脚本、离线回放）。应用层始终给 */
  text: TextGenerator | undefined
  input?: Omit<SuspicionInput, 'tree'>
  emit: (payload: EngineEventPayload) => void
  stage: 'planning' | 'auditing'
}

/**
 * 可疑才问。返回 `null` = 没触发（正常的一本书走的就是这一条，零调用）。
 *
 * 非 `pass` 的结论**由这里发事件**（三处调用点共用同一份文案）；`pass` 不发——
 * 界面在 `frames.ts` 里对 `verdict: 'pass'` 是直接 `break` 的，发了也没人看，
 * 而"这一档跑过了"这件事在 `JudgeOutcome.dropped` 与脚本里看得见。
 */
export async function judgeIfSuspect(
  tree: StoryTree,
  wiring: JudgeWiring,
): Promise<{ outcome: JudgeOutcome; signals: readonly Suspicion[] } | null> {
  if (!wiring.text) return null
  const signals = suspicionOf({ tree, ...wiring.input })
  if (signals.length === 0) return null

  const outcome = await judgeStory(tree, wiring.text)
  if (outcome.verdict !== 'pass') {
    wiring.emit({
      kind: 'review',
      stage: wiring.stage,
      check: 'safety',
      verdict: outcome.verdict,
      reason: outcome.reason,
    })
  }
  return { outcome, signals }
}
