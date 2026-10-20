/**
 * review.ts —— 内容审核：生成之后的那道闸（评分表 #5「内容过滤与兜底机制」）。
 *
 * 纯函数、浏览器安全，与 `lib/story-problems.ts` 同一族。它不读盘、不调模型——语料在
 * `rag/review-corpus.ts`（条款），判据在这里。
 *
 * 为什么要有它：红线今天只活在提示词里（`prompts/story-plan.ts` 的 `RED_LINES` 三行）。
 * 模型真写出一段吓人的东西时，没有任何代码拦得住它——而那段东西会被父母的声音念给一个
 * 4 岁的孩子听。这一层就是把那句话变成"拦得住"。
 *
 * `verdict` 的四个值不是程度，是四件不同的事：
 *
 *   `pass`        词表一条都没命中 → 放行
 *   `flag`        命中 `rewrite` 条款：这一版不许出去，但可以改 → 带反馈重写；改不动才拒发
 *   `block`       命中 `block` 条款（自伤 / 危险示范）→ 当场拒发，不重试
 *   `unavailable` 该查的那一档没跑成 → 见下
 *
 * ★ `flag` 不是"提示一下照样放行"。它在闸门上的意思是"这一版不能出去"——只是补救办法是
 *   重写而不是拒发。一个会放行的警告不叫闸门。
 *
 * 词表这一档不出 `unavailable`，而这件事要写在明处：`review-corpus.ts` 里有三条
 * `detect: 'semantic'` 的条款（说教 / 情绪接住 / 适龄），它们要模型读，而今天没有跑那一档。
 * 那为什么不干脆把裁决标成 `unavailable`？因为那会让每一本书都挂着一个"未审核"，而它并不会
 * 更安全，只会让那个词失去意义。所以本模块把"没查的那几条"放在 `unchecked` 里（条款 id 的
 * 清单），让调用方说得出来。与一致性核对那条纪律不冲突：那边确实有一个会跑、会失败的比较器；
 * 这边那一档根本还不存在。等语义档落地，它的失败才该走 `unavailable`——画面那一档就是
 * "确实有比较器"的那种，所以它读不到时走的正是 `unavailable`，这个对照别丢。
 *
 * 家长那句自由输入（2026-10-19，`.scratch/safety` 工单 02）用的是同一份词表，但处置只有
 * 一种：拒发。`flag` 与 `block` 在这道闸上的下一步是同一件事——**这是别人的话，没有"我们
 * 替你重写一版"这条路**（替家长改他写的那句话，改出来的是谁的意思？）。事件里的 `verdict`
 * 仍然如实报是哪一种，让界面说得清。它在 `planStory` 的最前面：比第一句提示词早，也比检索
 * 那次 embedding 早。拦在这儿的意义一半是安全（那段内容根本没接触过模型），一半是钱。
 *
 * 词表档的边界不许含糊：它抓写得明明白白的那些，抓不到谐音、拼音、委婉说法、没有脏字的
 * 吓人（清单与理由写在 `rag/review-corpus.ts` 的文件头）。所以这个模块不宣称"覆盖了红线"，
 * 它宣称的是「命中的一律拦下；这一批词可枚举、可复核；剩下的那几类今天没有判据」。
 *
 * 画面那一档（2026-10-19 起存在）审的是另一件事：本文件上半审的是字（正文、`scene`、
 * `imagePrompt`、选择点的两句话、书名），而"图上画出了不该出现的东西"词表扫不到。那一档
 * 不在这个模块里，而且不是判据：落点在 `providers/openai-vision.ts` 的 `reviewPicture`，
 * 调用点在 `illustrate.ts`（出图之后）；问的清单是 `rag/review-corpus.ts` 的
 * `PICTURE_CLAUSES`（条款原文，不是词表词——图上没有"血"这个字，只有一片红）；它不可复现，
 * 所以不参与本文件那两个数（9/10 拦下、0 误拦），唯一的读数是
 * `scripts/picture-review-cases.mts` 量出来的误报率。本文件只做翻译
 * （`toPictureProblems` / `pictureProblemText`：条款 id → 类别 + 人话）。判断在哪一次调用里，
 * 别把 `reviewStory` 和它接起来——那会让"通过的审核"这句话分不清说的是哪一档。
 * 所以 `reviewStory` 通过只说明文字这一关过了；要知道一页的画面审没审、审出什么，
 * 读 `Illustration.pictureReview`。
 */

import {
  clauseById,
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
   * 今天没有判据的那几条语义条款 id（见文件头第三节）。
   * 它是一条如实的记录，不是一个状态：调用方可以把它说出来（日志/文档），
   *   但它不参与 `verdict` 的计算。
   */
  unchecked: readonly string[]
}

/** 语义档那几条的 id：今天没有判据（文件头第三节），如实报出来但不算进 `verdict` */
const UNCHECKED_IDS: readonly string[] = REVIEW_CLAUSES.filter(
  (clause) => clause.detect === 'semantic',
).map((clause) => clause.id)

export type PageReview = {
  pageNo: number
  verdict: ReviewVerdict
  problems: readonly ReviewProblem[]
}

/** 前后各留几个字。★ 只留一点点：`context` 是为了让人一眼确认，不是为了展示原文 */
const CONTEXT_PAD = 6

function contextOf(text: string, index: number, word: string): string {
  const from = Math.max(0, index - CONTEXT_PAD)
  const to = Math.min(text.length, index + word.length + CONTEXT_PAD)
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`
}

/**
 * 一段文字过一遍词表。
 *
 * 比对的是去掉空白之后的那份（`自 杀` 也算命中），但 `context` 用原文——
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
        // 用同一个词重新找一次；找不到就只有词本身（这种情况出现在词跨了空格时）
        context: (() => {
          const raw = text.indexOf(word)
          return raw === -1 ? word : contextOf(text, raw, word)
        })(),
      })
      // 一条条款只报一次：同一页里出现三次"血"，家长要改的是那一页，不是三处
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
 * 为什么连 `scene` / `imagePrompt` 都要审：它们不进孩子的耳朵，但进孩子的眼睛——
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
 * 它是一个带页码的短语，不是一整句话："没过"这个判断由调用方说出口
 *   （错误消息说"被内容审核拦下了"、重试事件说"故事里有不该给孩子看的内容"）。
 *   原来自带"内容检查没过"四个字，于是错误消息长成
 *   「没通过内容审核，已拦下：第 1 页内容检查没过：…」——同一件事说了两遍。
 * 条款 id 是这句话的重点（判据 5：失败原因要具体到条款 id）：
 *   家长看到"恐怖 R-01"能去翻条款，看到"生成失败"什么也做不了。
 */
export function reviewProblemText(page: PageReview): string {
  const first = page.problems[0]
  if (!first) return ''
  const where = page.pageNo === 0 ? '书名' : `第 ${page.pageNo} 页`
  const more = page.problems.length > 1 ? `（这一页还有 ${page.problems.length - 1} 处）` : ''
  return `${where}：${first.category}（${first.clauseId}）——出现了「${first.word}」${more}`
}

/* ─────────────────── 家长那句自由输入过闸（2026-10-19，`.scratch/safety` 工单 02） ───────────────────
 *
 * 与 `reviewStory` 同一套条款、同一个词表，但处置只有一种：拒发。
 *   出图那道闸上写过同一个道理（`index.ts` 里那段）：**这是别人的话，
 *   没有"重写一版"这条路**——我们替家长改他写的那句话，改出来的是谁的意思？
 *   所以 `rewrite` 与 `block` 在这里的下一步是同一件事，只是错误消息说得清是哪一种。
 *
 * ★ 为什么它必须在提示词之前、也在检索之前跑：见 `planStory` 那个调用点。
 *   在这里只记一句——`reviewInput` 是纯函数，它不关心自己站在流水线的哪一格。
 */

/** 家长写的一格自由文本。`label` 是它在那句错误消息里叫什么（"主题"/"改稿要求"） */
export type InputField = {
  label: string
  text: string
}

/** 多一格 `field`：家长要改的是那一格，不是整份表单 */
export type InputProblem = ReviewProblem & { field: string }

export type InputReview = {
  verdict: ReviewVerdict
  problems: readonly InputProblem[]
}

/**
 * 家长那几格自由文本过一遍词表。空的那几格不跑（与 `reviewText` 同一条）。
 *
 * 只审家长打进去的字：主题、那句"希望孩子得到什么"、以及"重写一版"的要求。
 *   主角名字（`childName` / `nameReading`）不在这张表里，是有意的：
 *   它是孩子档案上的字段，不是这一屏的自由输入，而且它进提示词的那一句
 *   （"名字念 X，别念错"）是把它当拼音标注用的，不是当故事内容用的。
 */
export function reviewInput(fields: readonly InputField[]): InputReview {
  const problems = fields
    .filter((field) => field.text.trim() !== '')
    .flatMap((field) =>
      reviewText(field.text).map((problem) => ({ ...problem, field: field.label })),
    )
  return { verdict: verdictOf(problems), problems }
}

/**
 * 家长那句输入没过时的一句话。把 `reviewProblemText` 那句换成"哪一格"，
 * 其余（条款 id、命中的词）一个字不差——两处的判据是同一份条款库，
 * 措辞再各写一份就会漂。
 */
export function reviewInputText(problem: InputProblem): string {
  return `${problem.field}：${problem.category}（${problem.clauseId}）——出现了「${problem.word}」`
}

/* ─────────────────── 画面审核：兜底，不是判据（2026-10-19，`.scratch/safety` 工单 01） ───────────────────
 *
 * 这一档与上面所有东西不是一类，混淆它俩是这一节唯一的风险：
 *
 *   |          | 文字（本文件上半）        | 画面（本节）                    |
 *   | -------- | ------------------------- | ------------------------------- |
 *   | 判据     | 词表，确定性、可复现      | 一个视觉模型的判断，不可复现 |
 *   | 身份     | 判据                      | 兜底                        |
 *   | 能宣称的 | "命中的一律拦下，词可复核" | "跑过的图里它报了什么、误报多少" |
 *
 *   所以本文件在这里只做翻译（条款 id → 类别 / 人话），不做判断：
 *   判断在 `providers/openai-vision.ts` 那次调用里，落点在 `illustrate.ts`。
 *   `reviewStory` / `reviewText` 与本节没有任何调用关系——别把它们接起来。
 * ★ 为什么职责划在这儿：条款库里有什么类别，是这一个文件的知识。
 *   让 `illustrate.ts` 自己去查 `clauseById`，那份知识就散出去了。
 */

/**
 * 画面审核命中的一条。没有 `word`，多一个 `where`——
 * 图上没有一个字可扫，只有"画面哪儿"，所以这两个字段与 `ReviewProblem` 正好换了个方向。
 */
export type PictureProblem = {
  clauseId: string
  category: ClauseCategory
  disposition: ClauseDisposition
  /** 那句话说的东西在画面哪个位置、是什么东西（模型给的原文） */
  where: string
}

/**
 * 视觉模型报回来的条目 → 带上类别与处置。
 *
 * 认不出的 id 一律归「恐怖」并保留原文，不丢也不抛：
 *   认不出只有两种成因——模型把 id 写歪了，或者条款库改了名。
 *   两种情况下那条发现都可能是真的，而丢掉一条安全发现是这一档唯一不能犯的错。
 *   `clauseId` 原样留着，所以"归到哪一条"这件事在 `book.json` 里仍然查得到。
 */
export function toPictureProblems(
  findings: readonly { clauseId: string; where: string }[],
): PictureProblem[] {
  return findings.map((finding) => {
    const clause = clauseById(finding.clauseId)
    return {
      clauseId: finding.clauseId,
      category: clause?.category ?? '恐怖',
      disposition: clause?.disposition ?? 'rewrite',
      where: finding.where,
    }
  })
}

/**
 * 一条画面审核结论的人话。与 `reviewProblemText` 同一个形状（页码 + 类别 + 条款 id），
 * 只把"出现了「某个词」"换成"画面上有：某处"——这两句不能各写一份的理由是同一条：
 * 屏幕上并排出现两种措辞时，读的人会以为它们是两件事。
 */
export function pictureProblemText(problem: PictureProblem, pageNo: number): string {
  const where = pageNo === 0 ? '封面' : `第 ${pageNo} 页`
  return `${where}：${problem.category}（${problem.clauseId}）——画面上有：${problem.where}`
}
