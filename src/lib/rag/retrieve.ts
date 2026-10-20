/**
 * retrieve.ts —— 检索器：硬过滤 → 打分 → top-k → 阈值（★ 纯函数，只有一份排序）
 *
 * 这一节就是评分表里「检索策略是否合理」那句话的答卷，所以每条规则的"为什么"
 * 都写在这里，而不是只写在某个调用点上。
 *
 * 一、硬过滤在前，打分在后
 *
 *   `ageBand` / `theme` / `form` 是过滤键，不是打分特征。
 *   把它们做成特征的症状是具体的：「8 岁档的句子漏给 4 岁档，而分数看起来还挺高」——
 *   因为"档位不合"只扣一点分，命中的字仍然能把它顶进 top-k。
 *
 *   但两个极性的过滤强度不同，这是本模块最需要读懂的一处：
 *
 *   | 极性      | owner                | ageBand                    | theme        | form              |
 *   | --------- | -------------------- | -------------------------- | ------------ | ----------------- |
 *   | `example` | 库 + 自己            | 同档或相邻一档或通配   | 同主题或通配 | 同形态或通配      |
 *   | `avoid`   | 只取自己         | 不过滤                     | 不过滤       | 同形态或通配      |
 *
 *   · `example` 为什么要"相邻一档"：语料库里那 96 条全是 `4-6`（12 本样书的
 *     主角都写着"约 5 岁"）。只收同档的话，一个 7 岁孩子的请求一条范例都取不到——
 *     于是这一栏对四个年龄档里的三个是哑的，而那正是它最该有作用的场景
 *     （8 岁档最需要"这笔钱花得值"的证据）。
 *     而"相邻"与"隔两档"的区别是实打实的：4 岁档的句子给 8 岁看是错的参考，
 *     相邻档的句子读起来仍然对（样书的用词本来就跨这两档：每行 ≤22 字、
 *     与 `AGE_RULES` 里 `4-6` 的 12–18 字和 `6-8` 的 18–26 字都相容）。
 *   · `avoid` 为什么反过来全都不过滤：它的语义是「这个孩子已经读过了」。
 *     读过就是读过——他上个月读的是独读版 4-6 档、这次要共读版 6-8 档，
 *     落点重复一样要避。所以这一侧只守两条硬边界：owner 与形态。
 *     相似度交给打分：取的是"与你这次的要求最近的几条"，不是"所有你写过的"。
 *
 *   · `form` 两侧都要求"同形态或通配"：拿独读版的落点去避共读版的重复是错的
 *     （共读版多一个选择点，落点分布不一样）。而 `form: '*'` 是通配——
 *     库里的样书就是通配（它们是线性的，但作用只是"句子长什么样"，与形态无关）。
 *
 * 二、空结果是合法结果，而且不许在调用方被当成错误
 *
 *   过滤后为空、或全低于阈值 → 返回 `[]`。这不是"检索失败"，是"这次没有可参考的"。
 *   上游拿到 `[]` 就照常往下编故事。★ 不许兜底成「随便给几条」：
 *   给几条不相关的范例比不给范例更坏——它会把模型引到一个错误的方向，
 *   而那种坏法在界面上看不出来（故事读起来仍然通顺，只是不像这一家的书）。
 *   ★ 也不许在调用方把 `[]` 当错误去重试：这个项目在"空值算不算错"那一节
 *   付过假拦的学费（`illustrations` 那里）。
 *
 * 三、`owner` 是隐私边界，不是相关性偏好
 *
 *   `avoid` 只取 `owner === query.owner`；`example` 只取 `library` + 自己的。
 *   不这么做，症状是「别人家孩子的书正文被喂进了这个模型的上下文」——
 *   与仓库现有的「别人的书 id 在你那一片里不存在 → 404」是同一条纪律，
 *   而它比 404 严重得多（那是读不到，这是读到了别人的）。
 *   `retrieve.test.ts` 里有一条专测这个。
 *
 * 四、阈值按池子的收窄程度分两档（2026-10-19，判据 4 第二轮）
 *
 *   一句话：阈值管的是"收窄之后剩下的精度"。池子已经被元数据收窄过，
 *   阈值就不必再收窄一遍。
 *
 *   | 什么时候                                              | 用哪一档        |
 *   | ----------------------------------------------------- | --------------- |
 *   | 池子是整座库（请求里认不出主题 → 只有形态与年龄约束） | `minScore`（高） |
 *   | 池子已被主题（`example`）或 owner（`avoid`）收窄 | `narrowedMinScore`（低） |
 *
 *   改这一处的依据是实测，不是手感：同主题那本样书的跨页按"与家长那句话的
 *     字符重合"打分只有 1.5–1.8，于是 `minScore=2` 把它们全挡在门外——
 *     10 个主题里有 3 个一条范例都取不到，那三本的两臂提示词逐字节相同
 *     （剂量为零，占第一轮样本的 30%）。而主题这件事在元数据里是确定的，
 *     字符重合只是它的代理：让代理去否决信号，是这一处错的形状。
 *   ★ 为什么"认不出主题"那条路不能一起放低：那条路上池子是整座库，
 *     低阈值会把不相关的范例喂进去——而"给几条不相关的范例比不给更坏"
 *     是文件头第二节那条纪律（模型会被引到一个错误的方向，界面上看不出来）。
 */

import { AGE_BANDS, type AgeBand, type BookForm } from '../engine/domain.ts'
import { THEMES, THEME_KEYS, type ThemeKey } from '../themes.ts'
import { ANY, RAG_OWNER_LIBRARY, type RagChunk, type RagIndex } from './corpus.ts'
import { bm25Scores, matchedTerms } from './score.ts'
// `RAG_OWNER_LIBRARY` 从 `corpus.ts` 取，不在这里再写一遍 'library'：
//   两处字面量就是两份真值，而这条真值正是隐私边界那一侧的名字
//   （`corpus.ts` 里那条"种子索引零个 u/ owner"的用例读的是同一个常量）

export type RetrievePolarity = 'example' | 'avoid'

export type RetrieveQuery = {
  ageBand: AgeBand
  theme: string
  form: BookForm
  /** 查询串：这一本书的 wish / reviseNote / 已有草稿拼起来的那段话 */
  text: string
  /** 检索发起人。`avoid` 只在这个人的片里取（隐私边界） */
  owner: string
  polarity: RetrievePolarity
  /** 取几条 */
  k: number
  /**
   * 池子没被收窄时用的阈值（0 分即"一个 bigram 都没命中"）。
   *
   * 与下面那一档的分工，是 2026-10-19 第二轮对照跑测改出来的：
   *   阈值管的是"收窄之后剩下的精度"。池子已经被元数据收窄过，阈值就不必再收窄一遍；
   *   而"请求里认不出主题"那条路上池子是整座库，低阈值会把不相关的范例喂进去
   *   （文件头第二节警告过的那种坏法）。
   */
  minScore: number
  /**
   * 池子已被收窄时用的阈值，比上面那一档低。不传 = 与 `minScore` 相同（老行为）。
   *
   * 什么时候算"已被收窄"：`example` 那一侧请求里的主题认得出来
   * （于是候选只剩同主题与通配），`avoid` 那一侧永远算
   * （它的池子被 `owner` 收窄到"他自己写过的书"，而"他读过了"是硬事实）。
   * 依据是实测的：96 条种子里同主题那本样书的跨页，按"与家长那句话的字符重合"
   *   打分只有 1.5–1.8（`--dryRun=1` 的分数分布表）——主题明明对上了，
   *   却因为代理量（字符重合）偏低被阈值挡在门外。
   *   10 个主题里因此有 3 个一条范例都取不到、两臂提示词逐字节相同（剂量为零）。
   */
  narrowedMinScore?: number
}

export type RetrieveHit = {
  chunk: RagChunk
  score: number
  /** 一句话说清「为什么是它」。进事件与 provenance，是"可解释性"那一栏的原料 */
  why: string
}

/** 相邻一档的距离。`4-` ↔ `4-6` ↔ `6-8` ↔ `8+`，两边各让一步，再远不让 */
const AGE_BAND_STEP = 1

function bandDistance(a: AgeBand, b: AgeBand): number {
  return Math.abs(AGE_BANDS.indexOf(a) - AGE_BANDS.indexOf(b))
}

/** 年龄档的准入判定。`example` 用相邻，`avoid` 不过滤（见文件头那张表） */
function bandAdmits(chunk: RagChunk, query: RetrieveQuery): boolean {
  if (query.polarity === 'avoid') return true
  if (chunk.ageBand === ANY) return true
  return (
    chunk.ageBand === query.ageBand || bandDistance(chunk.ageBand, query.ageBand) <= AGE_BAND_STEP
  )
}

function themeAdmits(chunk: RagChunk, query: RetrieveQuery): boolean {
  if (query.polarity === 'avoid') return true
  if (chunk.theme === ANY) return true
  const key = themeKeyOf(query.theme)
  // 请求里没有"主题"这个东西时，不拿它当约束（见 `themeKeyOf` 那段）
  if (key === null) return true
  return chunk.theme === key
}

/**
 * 把请求里那个 `theme` 归一成主题墙的键。三种形状，只有前两种算"有主题"：
 *
 * 1. 键（`'cloud'`）——脚本、测试、以及 `bookIdOf` 那一类内部调用；
 * 2. 中文名（`'云'`）——★ 界面上走的就是这一种：
 *    `src/app/create/page.tsx` 那句 `theme: { theme: themeLabel, wish }` 里
 *    `themeLabel` 取的是 `THEMES[].label`。不归一的话，`chunk.theme === 'cloud'`
 *    与请求里的 `'云'` 永远不相等，于是这个过滤器在线上一次都不会命中——
 *    而症状是"检索永远没有范例"，不是报错。
 * 3. 家长那句话——`lib/creation/state.ts` 的 `theme: form.theme.theme.trim() || wish`：
 *    没点主题卡时，`theme` 就是他那句话。这一档不构成主题约束
 *    （它不是"主题不对"，是"这次没有主题"），所以不拿它去筛。
 *    ★ 与"过滤不命中就是空集、不许兜底"不冲突：那条管的是筛完之后为空不许放宽，
 *      这里定的是筛子本身在什么时候成立。
 *    这一档同时说明它是内容：`load.ts` 的 `queryTextOf` 用它判"该不该把这句
 *      放进查询串"（认不出来 = 它是家长的话 = 那就是内容）。
 */
export function themeKeyOf(theme: string): ThemeKey | null {
  if (THEME_KEYS.includes(theme as ThemeKey)) return theme as ThemeKey
  return THEMES.find((item) => item.label === theme)?.key ?? null
}

function formAdmits(chunk: RagChunk, query: RetrieveQuery): boolean {
  return chunk.form === ANY || chunk.form === query.form
}

function ownerAdmits(chunk: RagChunk, query: RetrieveQuery): boolean {
  if (query.polarity === 'avoid') return chunk.owner === query.owner
  return chunk.owner === RAG_OWNER_LIBRARY || chunk.owner === query.owner
}

/**
 * 一条 chunk 能不能进这次检索的候选集。
 * `excluded` 给 `retrieveBoth` 用：同一条不许既当正例又当反例（见那个函数）。
 */
function admits(chunk: RagChunk, query: RetrieveQuery, excluded: ReadonlySet<string>): boolean {
  if (excluded.has(chunk.id)) return false
  return (
    ownerAdmits(chunk, query) &&
    bandAdmits(chunk, query) &&
    themeAdmits(chunk, query) &&
    formAdmits(chunk, query)
  )
}

/**
 * 一条候选的准入阈值（`RetrieveQuery.minScore` / `narrowedMinScore` 的分工见那两个字段）。
 *
 * 只有 `example` 要看主题：`avoid` 那一侧"池子已被 owner 收窄"这件事永远成立，
 *   所以它直接走低阈值——而这是要紧的一处：`avoid` 池里全是"他自己写过的书"，
 *   把一条同主题的旧书挡在门外，等于让"别重复"这件事落空
 *   （第一轮的读数：阈值 2 时平均只列出 0.7 条避开，阈值 1 时 3.0 条）。
 */
function thresholdOf(chunk: RagChunk, query: RetrieveQuery): number {
  const narrowed = query.narrowedMinScore
  if (narrowed === undefined) return query.minScore
  if (query.polarity === 'avoid') return Math.min(query.minScore, narrowed)
  const key = themeKeyOf(query.theme)
  if (key === null) return query.minScore
  // 收窄只放宽、不收严（`Math.min`）：池子被元数据收窄过，只是不再需要阈值
  //   替它把关；它从来不是"同主题就该更严"的理由。少了这个 `min` 会有一个很坏的副作用——
  //   调用方写 `minScore: 0`（"谁来都得留着"，测试与脚本常这么写）时，
  //   带主题的请求会被这一档悄悄抬到 1，于是"0 分门槛"名不副实。
  //   2026-10-19 被 `load.test.ts` 那条合成用例当场抓到。
  return Math.min(
    query.minScore,
    chunk.theme === ANY || chunk.theme === key ? narrowed : query.minScore,
  )
}

/** `why`：说清"为什么是它"——命中了哪些 bigram、档位是怎么准入的 */
function whyOf(
  chunk: RagChunk,
  query: RetrieveQuery,
  terms: readonly string[],
  score: number,
): string {
  const parts: string[] = []
  if (query.polarity === 'avoid') {
    parts.push('你已经给他写过')
  } else if (chunk.ageBand === ANY) {
    parts.push('年龄档不限')
  } else if (chunk.ageBand === query.ageBand) {
    parts.push(`同档 ${chunk.ageBand}`)
  } else {
    parts.push(`相邻档 ${chunk.ageBand}`)
  }
  if (query.polarity === 'example') {
    const key = themeKeyOf(query.theme)
    // 只在真的按主题筛过时才说"同主题"：这次没指定主题的话，
    //   写一句"同主题"就是一句假话（这条 `why` 会进 provenance 与事件）
    parts.push(
      key === null
        ? '这次没指定主题'
        : chunk.theme === ANY
          ? '主题不限'
          : chunk.theme === key
            ? `同主题 ${key}`
            : '主题不限',
    )
  }
  // 一条靠放宽才进来的条目要说出来：它进了提示词就是事实，
  //   而"它为什么在"这件事在 provenance 里查得到才叫可解释
  if (score < query.minScore) {
    parts.push(
      `池子已收窄，按 ${query.narrowedMinScore} 分准入（${score.toFixed(2)} < ${query.minScore}）`,
    )
  }
  const shown = terms.slice(0, 3).join('、')
  parts.push(`命中 ${terms.length} 个 bigram${shown ? `（${shown}…）` : ''}`)
  return parts.join(' · ')
}

/**
 * 检索。按 `polarity` 走两套过滤强度（文件头那张表）。
 *
 * 排序：分数降序，同分按 `id` 升序。★ 同分那一半不是小事——
 * 不钉死次序的话，同一份输入两次跑出来的示例可能位置互换，
 * 而工单 06 的增益表要拿两次跑的差异说话，那种抖动会变成噪音。
 */
export function retrieve(
  query: RetrieveQuery,
  index: RagIndex,
  excluded: ReadonlySet<string> = new Set(),
): RetrieveHit[] {
  const candidates = index.chunks.filter((chunk) => admits(chunk, query, excluded))
  if (candidates.length === 0 || query.k <= 0) return []

  const scores = bm25Scores(
    query.text,
    candidates.map((chunk) => chunk.text),
  )

  return candidates
    .map((chunk, position) => ({ chunk, score: scores[position] ?? 0 }))
    .filter((row) => row.score >= thresholdOf(row.chunk, query))
    .sort(
      (a, b) =>
        b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : a.chunk.id > b.chunk.id ? 1 : 0),
    )
    .slice(0, query.k)
    .map((row) => ({
      chunk: row.chunk,
      score: row.score,
      why: whyOf(row.chunk, query, matchedTerms(query.text, row.chunk.text), row.score),
    }))
}

export type RetrievePair = { examples: RetrieveHit[]; avoids: RetrieveHit[] }

/**
 * 两条极性一起取，并保证正反不重叠。
 *
 * 为什么要一次取而不是让调用方调两遍：两条极性由同一份黑名单关联着——
 *   一条 chunk 若同时出现在「照着这个节奏写」与「不要重复这个落点」下面，
 *   提示词就自相矛盾了，而模型面对互相打架的两段话，行为是不确定的
 *   （可能照抄，也可能两边都不理）。这个不变式待在这个模块里，调用方就没机会做错。
 *
 * 先算 `avoid` 再算 `example`：反例是硬边界（"他读过了"这件事不因为
 *   取几条而变化），正例是可替换的（少一条范例故事照样编得出来）。
 *   倒过来的话，一条刚要进反例的旧书会被正例先占住，而"别重复"这件事就漏了。
 */
export function retrieveBoth(
  query: Omit<RetrieveQuery, 'polarity'>,
  index: RagIndex,
): RetrievePair {
  const avoids = retrieve({ ...query, polarity: 'avoid' }, index)
  const excluded = new Set(avoids.map((hit) => hit.chunk.id))
  const examples = retrieve({ ...query, polarity: 'example' }, index, excluded)
  return { examples, avoids }
}
