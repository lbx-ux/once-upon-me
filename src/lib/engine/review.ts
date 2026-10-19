/**
 * review.ts —— 内容审核：**生成之后的那道闸**（评分表 #5「内容过滤与兜底机制」）
 *
 * ★ 纯函数、浏览器安全，与 `lib/story-problems.ts` 同一族（那个文件是"闸门上的判据"）。
 *   它不读盘、不调模型——**语料**在 `rag/review-corpus.ts`（条款），**判据**在这里。
 *
 * ---------------------------------------------------------------------------
 * 一、为什么要有它（一句话）
 *
 *   红线今天只活在**提示词**里（`prompts/story-plan.ts` 的 `RED_LINES` 三行）。
 *   模型真写出一段吓人的东西时，**没有任何代码拦得住它**——而那段东西会被
 *   父母的声音念给一个 4 岁的孩子听。这一层就是把那句话变成"拦得住"。
 *   `.scratch/w1-engine/issues/06` 自己点名过这件事：
 *   「审核 Agent 的红线词库还没有，只有 prompt 里那三行」。
 *
 * ---------------------------------------------------------------------------
 * 二、`verdict` 的四个值，逐条说清楚（它们不是程度，是四件不同的事）
 *
 * | 值            | 意思                                   | 下一步                       |
 * | ------------- | -------------------------------------- | ---------------------------- |
 * | `pass`        | 词表一条都没命中                       | 放行                         |
 * | `flag`        | 命中 `rewrite` 条款：**这一版不许出去**，但**可以改** | 带反馈重写；改不动才拒发     |
 * | `block`       | 命中 `block` 条款（自伤 / 危险示范）   | **当场拒发，不重试**         |
 * | `unavailable` | 该查的那一档没跑成                     | 见下第三节                   |
 *
 * ★ `flag` **不是**"提示一下照样放行"。它在闸门上的意思是"这一版不能出去"——
 *   只是补救办法是**重写**而不是**拒发**。一个会放行的警告不叫闸门。
 *
 * ---------------------------------------------------------------------------
 * 三、`unavailable` 今天几乎用不上，而这件事要写在明处
 *
 *   `review-corpus.ts` 里有三条 `detect: 'semantic'` 的条款（说教 / 情绪接住 / 适龄），
 *   它们**要模型读**，而**今天没有跑那一档**。于是"这一页到底审没审全"这个问题
 *   有一个诚实的答案：**只审了词表那一档**。
 *
 *   ★ 那为什么不干脆把裁决标成 `unavailable`？因为那会让**每一本书**都挂着一个
 *     "未审核"，而它并不会更安全——只会让那个词失去意义。
 *     所以本模块把"没查的那几条"放在 `unchecked` 里（条款 id 的清单），
 *     让调用方**说得出来**（事件、日志、文档），而不是把不确定摊成一个状态值。
 *   ★ 与一致性核对那条纪律（"不可用就判 `未核对`，它不是通过也不是失败"）不冲突：
 *     那边**确实有**一个会跑、会失败的比较器；这边那一档**根本还不存在**。
 *     等语义档落地（工单 05 的剩余项），它的失败才该走 `unavailable`。
 *
 * ---------------------------------------------------------------------------
 * 四、词表档的边界（**不许含糊**）
 *
 *   它抓**写得明明白白的**那些。它抓不到谐音、拼音、委婉说法、没有脏字的吓人——
 *   清单与理由写在 `rag/review-corpus.ts` 的文件头第二节。
 *   ★ 所以这个模块**不宣称"覆盖了红线"**，它宣称的是：
 *     「命中的一律拦下；这一批词可枚举、可复核；剩下的那几类今天没有判据」。
 *     工单 05 那条**故意用谐音绕过**的反例就是用来把这句话钉在纸上的。
 *
 * ---------------------------------------------------------------------------
 * 五、**画面**里的那一道还不存在（写在这里，免得下一个人以为审过了）
 *
 *   今天审的是**字**：正文、`scene`、`imagePrompt`、选择点的两句话、书名。
 *   而"图上画出了不该出现的东西"是另一件事——图不是文字，词表扫不到。
 *   它该落在**出图那一次调用之后**（一次视觉模型调用可以顺带问第二个问题），
 *   而不是这一层：这一层是纯函数，不认识图。
 *   ★ 所以 `reviewStory` 通过**只说明文字这一关过了**。视觉档留在 B3 的另一个动作里，
 *     本轮不做（工单 05「不做」那一节）。
 */

import {
  LEXICON_CLAUSES,
  REVIEW_CLAUSES,
  type ClauseCategory,
  type ClauseDisposition,
} from '../rag/review-corpus.ts'
import type { StoryTree } from './domain.ts'

export type ReviewVerdict = 'pass' | 'flag' | 'block' | 'unavailable'

export type ReviewProblem = {
  /** `R-01`：判据 5 要的"具体到哪一条" */
  clauseId: string
  category: ClauseCategory
  disposition: ClauseDisposition
  /** 命中的那个词 */
  word: string
  /** 它出现在哪儿（前后各留几个字，够人一眼看出上下文） */
  context: string
}

export type ReviewResult = {
  verdict: ReviewVerdict
  problems: readonly ReviewProblem[]
  /**
   * **今天没有判据**的那几条语义条款 id（见文件头第三节）。
   * ★ 它是一条**如实**的记录，不是一个状态：调用方可以把它说出来（日志/文档），
   *   但它不参与 `verdict` 的计算。
   */
  unchecked: readonly string[]
}

/** 语义档那几条的 id：**今天没有判据**（文件头第三节），如实报出来但不算进 `verdict` */
const UNCHECKED_IDS: readonly string[] = REVIEW_CLAUSES.filter(
  (clause) => clause.detect === 'semantic',
).map((clause) => clause.id)

export type PageReview = {
  pageNo: number
  verdict: ReviewVerdict
  problems: readonly ReviewProblem[]
}

/** 前后各留几个字。★ 只留一点点：`context` 是为了让人**一眼确认**，不是为了展示原文 */
const CONTEXT_PAD = 6

function contextOf(text: string, index: number, word: string): string {
  const from = Math.max(0, index - CONTEXT_PAD)
  const to = Math.min(text.length, index + word.length + CONTEXT_PAD)
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`
}

/**
 * 一段文字过一遍词表。
 *
 * ★ 比对的是**去掉空白之后**的那份（`自 杀` 也算命中），但 `context` 用原文——
 *   给人看的那一句不该被我们改动过。
 */
export function reviewText(text: string): ReviewProblem[] {
  if (text.trim() === '') return []
  const squeezed = text.replace(/\s+/g, '')
  const problems: ReviewProblem[] = []

  for (const clause of LEXICON_CLAUSES) {
    for (const word of clause.lexicon ?? []) {
      const at = squeezed.indexOf(word)
      if (at === -1) continue
      problems.push({
        clauseId: clause.id,
        category: clause.category,
        disposition: clause.disposition,
        word,
        // `squeezed` 与 `text` 的下标对不上（去掉了空白），所以上下文从 `text` 里
        // 用**同一个词**重新找一次；找不到就只有词本身（这种情况出现在词跨了空格时）
        context: (() => {
          const raw = text.indexOf(word)
          return raw === -1 ? word : contextOf(text, raw, word)
        })(),
      })
      // ★ 一条条款只报一次：同一页里出现三次"血"，家长要改的是那一页，不是三处
      break
    }
  }
  return problems
}

function verdictOf(problems: readonly ReviewProblem[]): ReviewVerdict {
  if (problems.length === 0) return 'pass'
  return problems.some((problem) => problem.disposition === 'block') ? 'block' : 'flag'
}

/** 一页（或任何一段可命名的文本）过一遍闸 */
export function reviewPages(
  pages: readonly { pageNo: number; texts: readonly string[] }[],
): PageReview[] {
  return pages.map((page) => {
    const problems = page.texts.flatMap((text) => reviewText(text))
    return { pageNo: page.pageNo, verdict: verdictOf(problems), problems }
  })
}

/**
 * 整棵树过一遍闸。**审的是孩子会看到 / 会听到 / 会画出来的那些字**：
 * `body`（会念出来）、`ask` 与两个 `spoken`（也会念出来）、`scene` 与 `imagePrompt`
 * （不念，但它们决定画面里出现什么），以及书名。
 *
 * ★ 为什么连 `scene` / `imagePrompt` 都要审：它们**不进孩子的耳朵，但进孩子的眼睛**——
 *   `scene` 写着"血流了一地"时，那张图就是照着它画的。只审 `body` 会漏掉这一路。
 */
export function reviewStory(tree: StoryTree): {
  verdict: ReviewVerdict
  pages: readonly PageReview[]
  unchecked: readonly string[]
} {
  const pages = reviewPages([
    { pageNo: 0, texts: [tree.title] },
    ...tree.nodes.map((node) => ({
      pageNo: node.pageNo,
      texts: [
        node.scene,
        ...node.body,
        node.imagePrompt,
        ...(node.choice
          ? [
              node.choice.prompt,
              ...node.choice.options.flatMap((option) => [option.label, option.spoken]),
            ]
          : []),
      ],
    })),
  ])

  const problems = pages.flatMap((page) => page.problems)
  return { verdict: verdictOf(problems), pages, unchecked: UNCHECKED_IDS }
}

/**
 * 一句人话，给事件、给重试反馈、给错误消息（三处共用同一句，不各写一份）。
 *
 * ★ 它是**一个带页码的短语，不是一整句话**："没过"这个判断由调用方说出口
 *   （错误消息说"被内容审核拦下了"、重试事件说"故事里有不该给孩子看的内容"）。
 *   原来自带"内容检查没过"四个字，于是错误消息长成
 *   「没通过内容审核，已拦下：第 1 页内容检查没过：…」——同一件事说了两遍。
 * ★ 条款 id 是这句话的**重点**（判据 5：失败原因要具体到条款 id）：
 *   家长看到"恐怖 R-01"能去翻条款，看到"生成失败"什么也做不了。
 */
export function reviewProblemText(page: PageReview): string {
  const first = page.problems[0]
  if (!first) return ''
  const where = page.pageNo === 0 ? '书名' : `第 ${page.pageNo} 页`
  const more = page.problems.length > 1 ? `（这一页还有 ${page.problems.length - 1} 处）` : ''
  return `${where}：${first.category}（${first.clauseId}）——出现了「${first.word}」${more}`
}
