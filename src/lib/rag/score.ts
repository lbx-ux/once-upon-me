/**
 * score.ts —— 词法打分：中文字符 bigram + BM25。这是全部的打分（★ 纯函数）
 *
 * 为什么是「字符 bigram」，不是分词
 *
 *   中文没空格，按词切要引一个分词器（jieba 之类）与它的词典。这个语料是几百条
 *   短句（一页 1–3 句、几十字），给这个量级上重装备的收益很小，代价是三样：
 *   多一个依赖、多一份要更新的词典、以及一个"为什么这次切得不一样"的新失败模式。
 *
 *   字符 bigram 在这类同语言、同体裁、句子短的集合上给出的排序是可解释的：
 *   两句共享的字越多（且这些字在语料里越少见），分越高。而"可解释"在这一栏是要紧的——
 *   `retrieve.ts` 的 `why` 字段要能说出「命中 12 个 bigram」，
 *   换成分词 + 向量之后，那句话就得变成"余弦 0.71"，而 0.71 解释不了任何事。
 *
 *   ★ 代价写在明处（进 `docs/known-tradeoffs.md`）：同义改写与长词召回弱。
 *     "云变成了乌龟"与"天上的那团像只乌龟"共享的字很少，词法档可能召不回来。
 *     这条今天没有解——工单 01 已量：这把 key 上要不到嵌入模型，所以没有向量档可兜。
 *
 * 切法：按空白切成段，段内取 bigram，段间不跨
 *
 *   `corpus.ts` 把一页拼成「跨页短名\n正文行\n正文行」这种带换行的文本。
 *   如果不分段直接去掉标点，末尾那个字会与下一行开头那个字拼成一个并不存在的
 *   bigram（"……脑后" + "远处……" → "后远"），它既不在任何人的语感里，
 *   还会让两份语料因为排版而"相似"。所以换行与空白是边界，不是可丢的噪音。
 *
 *   单字成段时保留那个字本身（没有 bigram 可切，但不该因此变成"零词文档"——
 *   那种文档在任何查询下都是 0 分，看起来像"不相关"，其实是"没切出词"）。
 */

/** 中文字符（含扩展 A 与兼容区）或 ASCII 字母数字 */
const KEEP = /[㐀-䶿一-鿿豈-﫿0-9a-z]/i

/**
 * 一段文字 → bigram 序列（保序、允许重复：BM25 要的是词频）。
 *
 * 标点、空格、换行、emoji 一律丢掉——它们不承载检索语义，
 * 而留着只会让"这一页有没有用逗号"影响分数。
 */
export function bigramsOf(text: string): string[] {
  const out: string[] = []
  for (const segment of text.split(/\s+/)) {
    const chars = [...segment.toLowerCase()].filter((char) => KEEP.test(char))
    if (chars.length === 0) continue
    if (chars.length === 1) {
      out.push(chars[0] as string)
      continue
    }
    for (let i = 0; i + 1 < chars.length; i += 1) {
      out.push(`${chars[i]}${chars[i + 1]}`)
    }
  }
  return out
}

export type Bm25Options = {
  /** 词频饱和系数：命中次数再多也只是"确实出现了"，不是"越多越相关" */
  k1?: number
  /** 长度归一：0 = 不归一，1 = 完全归一。0.75 是 BM25 的常用值 */
  b?: number
}

/**
 * BM25（`docs/known-tradeoffs.md` 里那条"中文为什么用 bigram"的落点）。
 *
 * ```
 * idf(q) = ln(1 + (N - n(q) + 0.5) / (n(q) + 0.5))
 * score  = Σ idf(q) · f(q,D)·(k1+1) / ( f(q,D) + k1·(1 - b + b·|D|/avgdl) )
 * ```
 *
 * 用 `ln(1 + …)` 那一版 idf，不用经典版的 `ln((N-n+0.5)/(n+0.5))`：
 *   后者的 n(q) = N 时会得到负数——一个词在所有文档里都出现时反而不给分，
 *   在"这个语料只有 96 条同类句子"这种量级下会经常发生（"孩子""妈妈"这类词）。
 *   加了外面那个 `1 + …` 之后 idf 恒为正、单调递减，符合那个词的直觉。
 *
 * 没有任何命中就是 0 分，不是"随手给个基础分"：0 分在 `retrieve.ts` 里
 *   与阈值比较，会自然被丢掉。给个底分等于让"毫不相关"混进 top-k。
 */
export function bm25Scores(
  query: string,
  docs: readonly string[],
  options: Bm25Options = {},
): number[] {
  const k1 = options.k1 ?? 1.2
  const b = options.b ?? 0.75
  if (docs.length === 0) return []

  const queryTerms = [...new Set(bigramsOf(query))]
  if (queryTerms.length === 0) return docs.map(() => 0)

  const docTerms = docs.map((doc) => bigramsOf(doc))
  const totalLength = docTerms.reduce((sum, terms) => sum + terms.length, 0)
  // 全是空词文档时 avgdl 会是 0，除零；这时长度归一没有意义，取 1
  const avgdl = totalLength > 0 ? totalLength / docTerms.length : 1

  const documentFrequency = new Map<string, number>()
  for (const terms of docTerms) {
    for (const term of new Set(terms)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }

  const total = docTerms.length
  return docTerms.map((terms) => {
    const frequency = new Map<string, number>()
    for (const term of terms) frequency.set(term, (frequency.get(term) ?? 0) + 1)

    let score = 0
    for (const term of queryTerms) {
      const f = frequency.get(term) ?? 0
      if (f === 0) continue
      const n = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5))
      const norm = 1 - b + (b * terms.length) / avgdl
      score += idf * ((f * (k1 + 1)) / (f + k1 * norm))
    }
    return score
  })
}

/** 一条文档命中了查询里哪几个 bigram —— `retrieve.ts` 的 `why` 用它说人话 */
export function matchedTerms(query: string, doc: string): string[] {
  const docTerms = new Set(bigramsOf(doc))
  return [...new Set(bigramsOf(query))].filter((term) => docTerms.has(term))
}
