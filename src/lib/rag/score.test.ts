/**
 * score.test.ts —— bigram 切分与 BM25 的行为
 *
 * 这些用例钉的是**公式的性质**，不是具体分数：分数本身随语料变，
 * 而"词频饱和""长度归一""idf 恒正""不跨段拼 bigram"这几条是设计意图，
 * 换实现（比如哪天真有了向量档要做混合）也不许丢。
 */

import { describe, expect, it } from 'vitest'

import { bigramsOf, bm25Scores, matchedTerms } from './score.ts'

describe('bigram 切分', () => {
  it('中文按相邻两字切', () => {
    expect(bigramsOf('云变成乌龟')).toEqual(['云变', '变成', '成乌', '乌龟'])
  })

  it('标点、emoji 都丢掉（它们不承载检索语义）', () => {
    expect(bigramsOf('看，像一只大乌龟。')).toEqual(bigramsOf('看像一只大乌龟'))
    // ★ 而**空白是边界**：'云 🌙 在变' 切成三段，「云」单独成段就只剩它自己
    //   （单字段保留那个字，见下面那条用例）。两者不是一回事，别指望空格像标点那样被抹平
    expect(bigramsOf('云 🌙 在变')).toEqual(['云', '在变'])
  })

  it('★ 换行是**边界**：不跨段拼出一个并不存在的 bigram', () => {
    // 不这么切的话，末尾的「后」会与下一行开头的「远」拼成「后远」——
    // 它不在任何人的语感里，却会让两份语料因为排版而"相似"
    expect(bigramsOf('脑后\n远处')).toEqual(['脑后', '远处'])
    expect(bigramsOf('脑后\n远处')).not.toContain('后远')
  })

  it('单字段保留那个字（没有 bigram 可切，但不该变成"零词文档"）', () => {
    expect(bigramsOf('云')).toEqual(['云'])
    expect(bigramsOf('云 在 变')).toEqual(['云', '在', '变'])
  })

  it('英文数字归一成小写', () => {
    expect(bigramsOf('ABC')).toEqual(['ab', 'bc'])
    expect(bigramsOf('A1b')).toEqual(['a1', '1b'])
  })

  it('空串与纯标点没有词', () => {
    expect(bigramsOf('')).toEqual([])
    expect(bigramsOf('，。！？  ')).toEqual([])
  })
})

describe('BM25', () => {
  const doc = '正午，小飞躺在野餐垫上。'
  const other = '月亮掉进了水盆里。'

  it('命中越多分越高；一个都没命中是 0 分', () => {
    const [hit, miss] = bm25Scores('野餐垫', [doc, other])
    expect(hit ?? 0).toBeGreaterThan(0)
    expect(miss ?? 0).toBe(0)
  })

  it('★ 词频饱和：出现 4 次的分 < 出现 1 次的 4 倍（但仍然更高）', () => {
    // `b: 0` 关掉长度归一，这一步只想看词频那一项的行为——
    // 两个文档长度不同的话，长度项会把结论搅浑（下面那条专测长度）
    const once = '小飞躺在垫子上。'
    const four = '小飞小飞小飞小飞躺在垫子上。'
    const [a, b] = bm25Scores('小飞', [once, four], { b: 0 })
    expect(b ?? 0).toBeGreaterThan(a ?? 0)
    expect(b ?? 0).toBeLessThan((a ?? 0) * 4)
  })

  it('★ 长度归一：同样命中一次，长文档得分更低', () => {
    const short = '小飞躺在垫子上。'
    const long = `小飞躺在垫子上。${'远处草坡上有一排树。'.repeat(12)}`
    const [a, b] = bm25Scores('小飞', [short, long])
    expect(a ?? 0).toBeGreaterThan(b ?? 0)
  })

  it('★ idf 恒为正：一个 bigram 出现在**所有**文档里也照样给分', () => {
    // 经典版 idf（ln((N-n+0.5)/(n+0.5))）在 n=N 时会变成负数——
    // 而"这个语料只有 96 条同类句子"这个量级下，n=N 是经常发生的
    const docs = ['孩子走来了。', '孩子跑来了。', '孩子笑了。']
    const scores = bm25Scores('孩子', docs)
    for (const score of scores) expect(score).toBeGreaterThan(0)
  })

  it('查询没有词、文档为空、文档全是空词：都返回 0 而不是抛错', () => {
    expect(bm25Scores('', [doc])).toEqual([0])
    expect(bm25Scores('野餐垫', [])).toEqual([])
    expect(bm25Scores('野餐垫', ['，。！'])).toEqual([0])
  })

  it('查询里的重复词不重复计分（它是集合，不是出现次数）', () => {
    expect(bm25Scores('云变云变云变', [doc, other])).toEqual(bm25Scores('云变', [doc, other]))
  })
})

describe('matchedTerms：`why` 那句"命中了哪些 bigram"的来源', () => {
  it('取交集并去重', () => {
    // ★ 注意语料里那个逗号：标点被抹掉之后序列是「朵云正在」，所以
    //   「云变」这条 bigram 只在**真连着**的写法里才存在（下面这份就是）
    expect(matchedTerms('云变了', '天上那朵云变成了乌龟')).toEqual(['云变'])
  })

  it('没有交集就是空数组（调用方据此说"命中 0 个"）', () => {
    expect(matchedTerms('月亮', '小飞躺在垫子上')).toEqual([])
  })
})
