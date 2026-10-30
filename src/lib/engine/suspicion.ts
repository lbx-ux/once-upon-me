/**
 * suspicion.ts —— 「这一本值得再问一次模型吗」（2026-10-30，评分表 #5 的第二档）
 *
 * 它不是判据，是**花钱的闸门**：词表那一档一条都没命中之后，本模块决定要不要再花一次
 * 文本调用，让模型去读词表读不到的那几类（留白吓人、委婉的死亡、结尾讲道理、情绪悬着、
 * 超龄）。判据在 `review-judge.ts`，读法在 `prompts/safety-judge.ts`。
 *
 * 三条设计约束，每条都对应一种真实的坏法：
 *
 * 1. **信号必须是客观、可复现、可测的。** 只有五类：家长那几格里的高敏词根、正文里
 *    几乎只出现在越线写法里的信号词、一组委婉死亡的二元词（"睡着了" + "再也"）、
 *    超长句，以及"短得反常 / 句子数不够"这两种形状。没有"读起来有点阴"这种判断——
 *    那种判断本身就是模型该干的活，放在这里等于用两个不确定的东西互相证明。
 * 2. **信号只决定"问不问"，不决定"过不过"。** 主题里写"离开"完全可以是一本正常的书
 *    （小候鸟迁徙），所以它只让这本书多过一次模型；模型说完没问题，照样放行。
 *    把信号当判据，等于把"可疑"写成"有罪"。
 * 3. **默认不触发。** 12 个预设主题一个都不含下面的词根，正常页正文也远长于 8 个字，
 *    所以大多数书**零额外调用**。带"一个人""一直等"这类句子的书会多问一次——
 *    那是刻意的边界，不是漏；一个每本都跑的兜底闸，成本会从"偶尔一次"变成"每本一次"，
 *    而它挡住的东西并没有变多。
 *
 * ★ 三类信号的门槛都不是拍的：
 *   · 8 个字是`body` 的下限感——一句完整的话（"他站在门口等妈妈回来"）就有 10 个字，
 *     短于 8 的正文要么是拟声词（"哗啦啦。"），要么是模型在回避写具体的事；
 *   · 句子数 < 页数是同一件事的整本版：`body` 是一句一段，20 页的书正常有 40–70 句。
 *   · 词根表只收"在童书里通常指向离别/死亡/孤独"的那些，不收"哭""难过"这种正常的情绪词
 *     （R-08 允许情绪出现，只是要求被接住）。
 *
 * ★ **2026-10-30 下午补的三类**（`story-stem` / `story-pair` / `long-sentence`）是被真书
 *   复核逼出来的：原来只扫家长的输入与页面的形状，于是"主题 cloud、每页都不短、句子数也够"
 *   的书里写着"门后面有东西在等她"时，一条信号都不响——闸门在最该跑的那一类样本上不跑。
 *   补的时候刻意没有把"睡着""走了""星星"这类常见词单收：睡前书每一页都有它们。
 *   "睡着"进的是二元表（与"再也 / 没醒"同时出现才算），"星星"只收"变成星星"。
 *   触发率与误拦的读数见 `scripts/safety-judge-real-books.mts`。
 *
 * ★ 分析报告里还提过第三类信号——「画面审核的置信度落在 0.4–0.6」。**这一类没有做**，
 *   而且不是漏了：`PictureReviewResponse` 里没有置信度（只有 `findings` 与 `reason`），
 *   要加就得先改视觉适配器与它的提示词，让模型自己报一个 0–1 的数。而那个数是模型的
 *   自评，不是概率——这一档的其它两处（一致性分、审核结论）都有实测的翻边记录，
 *   再引入一个没有标定过的分数，只会让"什么时候该复核"变成第三个不确定的东西。
 *   今天画面那一档该做的仍然是它原来的事：跑过的图里报了什么、误报多少
 *   （`scripts/picture-review-cases.mts`）。
 */

import type { StoryTree } from './domain.ts'

export type SuspicionCode =
  'theme-stem' | 'story-stem' | 'story-pair' | 'long-sentence' | 'terse-page' | 'short-story'

/** 一条信号。`detail` 是给人看的一句话，会进日志与错误详情，不进孩子的书 */
export type Suspicion = {
  code: SuspicionCode
  detail: string
}

export type SuspicionInput = {
  /** 家长写的那几格自由文本。缺省 = 这一轮没有（比如 `illustrateBook` 只拿得到树） */
  theme?: string
  wish?: string
  reviseNote?: string
  tree: StoryTree
}

/**
 * 高敏词根。★ 它们**不是红线词**——红线词在 `rag/review-corpus.ts` 里，命中就是拒发。
 * 这一张表收的是"没有红线词、但常常出现在委婉写法里"的构件：
 *
 *   · 离开 / 走了 / 消失 / 不见了 / 找不到 / 最后一次 / 再也——离别与死亡的常见委婉
 *   · 一个人 / 孤独 / 丢下——孤独与遗弃
 *   · 想念 / 想妈妈——思念（可以是正常的，但要确认结尾接住了）
 *   · 睡着——"睡着了没醒"是词表明知抓不到的写法
 *
 * 不收「死」「血」「自杀」：那些词表已经拦下了，到这里说明它已经过了第一道闸。
 */
const STEMS: readonly string[] = [
  '离开',
  '走了',
  '消失',
  '不见了',
  '找不到',
  '最后一次',
  '再也',
  '一个人',
  '孤独',
  '丢下',
  '想念',
  '想妈妈',
  '睡着',
  '走丢',
  '分开',
]

/** 一页正文的字数下限（去空白后）。见文件头第 3 条 */
export const TERSE_PAGE_CHARS = 8

/**
 * 故事正文里的**直接信号词**（2026-10-30 下午补，起因见文件头「为什么有 story-stem」）。
 *
 * 与 `STEMS` 的分工：那一张看的是**家长写的**（主题/愿望），这一张看的是**模型写出来的**。
 * 没有这一张，闸门会在最该跑的那一类样本上不跑：一本主题叫"cloud"、每页正文都不短、
 * 句子数也够的书，写着"门后面有东西在等她"——上面三类信号一条都不响。
 *
 * 收的是"没有红线词、但在这五类里几乎只出现在越线写法中"的构件：
 *   · 留白吓人：有东西 / 看着你 / 盯着你 / 黑暗里 / 床底下 / 门外有 / 呼吸声 / 伸出一只手
 *   · 委婉死亡：变成星星 / 去了很远 / 一直等（"一直等"也覆盖 R-08 的悬着结尾）
 *   · 说教：这个故事告诉我们 / 小朋友要 / 应该懂得 / 一定要懂得
 *   · 孤独：一个人
 * 单收「星星」「睡着了」「走了」这些**常见**词会误触发（童书里到处都是）——
 * 它们进的是下面那张二元表，不是这张。
 */
const STORY_STEMS: readonly string[] = [
  '有东西',
  '看着你',
  '盯着你',
  '黑暗里',
  '床底下',
  '门外有',
  '呼吸声',
  '伸出一只手',
  '变成星星',
  '去了很远',
  '一直等',
  '一个人',
  '这个故事告诉我们',
  '小朋友要',
  '应该懂得',
  '一定要懂得',
]

/**
 * 委婉死亡的**二元表**：单独一个 "睡着了" 是睡前书的常态，与 "再也 / 没醒" 同时出现才是
 * "睡着了没醒"那一族。这条规则是被真书逼出来的——`照片里的小船` 最后一页写着
 * "他想着照片里的男孩，睡着了"（2026-10-30 复核时就在盘上），只按单字触发，
 * 每一本睡前书都会多花一次调用，而真正要抓的那一类并没有变多。
 */
const STORY_PAIRS: readonly { a: string; bs: readonly string[] }[] = [
  { a: '睡着', bs: ['再也', '没有醒', '不醒', '没醒', '一直睡'] },
  { a: '走了', bs: ['再也', '不回来', '没回来', '永远'] },
  { a: '很远', bs: ['去', '不回来'] },
]

/** 一句正文超过这个字数就该问一次（`AGE_RULES` 的 4-6 档是 12–18 字，30 是两倍） */
export const LONG_SENTENCE_CHARS = 30

/** 每一类最多报几条 detail。它是日志，不是清单墙 */
const MAX_DETAILS_PER_CODE = 3

function squeeze(text: string): string {
  return text.replace(/\s+/g, '')
}

/**
 * 这一本要不要再过一次模型。
 *
 * 返回空数组 = 不触发（正常的一本书走的就是这一条），有内容 = 触发，`detail` 说明为什么。
 * 纯函数、不读盘、不调模型——与 `review.ts` 同一族，所以它能进 vitest 的 node 环境。
 */
export function suspicionOf(input: SuspicionInput): Suspicion[] {
  const signals: Suspicion[] = []

  const fields: readonly { label: string; text: string | undefined }[] = [
    { label: '主题', text: input.theme },
    { label: '你想让孩子得到的', text: input.wish },
    { label: '改稿要求', text: input.reviseNote },
  ]
  const hits: string[] = []
  for (const stem of STEMS) {
    const field = fields.find((entry) => (entry.text ?? '').includes(stem))
    if (!field) continue
    hits.push(`${field.label}里出现了「${stem}」`)
    if (hits.length >= MAX_DETAILS_PER_CODE) break
  }
  for (const detail of hits) signals.push({ code: 'theme-stem', detail })

  /* 故事正文那三类：直接信号词、委婉二元组、超长句。 */
  const pageTextOf = (node: (typeof input.tree.nodes)[number]): string =>
    squeeze(
      [
        ...node.body,
        ...(node.choice
          ? [
              node.choice.prompt,
              ...node.choice.options.flatMap((option) => [option.label, option.spoken]),
            ]
          : []),
      ].join(''),
    )

  const storyHits: string[] = []
  const title = squeeze(input.tree.title)
  for (const stem of STORY_STEMS) {
    const node = input.tree.nodes.find((entry) => pageTextOf(entry).includes(stem))
    if (node) storyHits.push(`第 ${node.pageNo} 页出现了「${stem}」`)
    else if (title.includes(stem)) storyHits.push(`书名出现了「${stem}」`)
    else continue
    if (storyHits.length >= MAX_DETAILS_PER_CODE) break
  }
  for (const detail of storyHits) signals.push({ code: 'story-stem', detail })

  const pairHits: string[] = []
  for (const pair of STORY_PAIRS) {
    const node = input.tree.nodes.find((entry) => {
      const text = pageTextOf(entry)
      return text.includes(pair.a) && pair.bs.some((tail) => text.includes(tail))
    })
    if (node) {
      const text = pageTextOf(node)
      const tail = pair.bs.find((candidate) => text.includes(candidate)) ?? pair.bs[0]
      pairHits.push(`第 ${node.pageNo} 页同时出现了「${pair.a}」与「${tail}」`)
    } else {
      const tail = pair.bs.find((candidate) => title.includes(pair.a) && title.includes(candidate))
      if (tail) pairHits.push(`书名同时出现了「${pair.a}」与「${tail}」`)
    }
    if (pairHits.length >= MAX_DETAILS_PER_CODE) break
  }
  for (const detail of pairHits) signals.push({ code: 'story-pair', detail })

  const longSentences: string[] = []
  for (const node of input.tree.nodes) {
    for (const sentence of node.body) {
      const length = [...squeeze(sentence)].length
      if (length <= LONG_SENTENCE_CHARS) continue
      longSentences.push(`第 ${node.pageNo} 页有一句 ${length} 个字`)
      if (longSentences.length >= MAX_DETAILS_PER_CODE) break
    }
    if (longSentences.length >= MAX_DETAILS_PER_CODE) break
  }
  for (const detail of longSentences) signals.push({ code: 'long-sentence', detail })

  const terse: string[] = []
  for (const node of input.tree.nodes) {
    const chars = squeeze(node.body.join('')).length
    if (chars >= TERSE_PAGE_CHARS) continue
    terse.push(`第 ${node.pageNo} 页的正文只有 ${chars} 个字`)
    if (terse.length >= MAX_DETAILS_PER_CODE) break
  }
  for (const detail of terse) signals.push({ code: 'terse-page', detail })

  const sentences = input.tree.nodes.reduce((sum, node) => sum + node.body.length, 0)
  if (sentences < input.tree.nodes.length) {
    signals.push({
      code: 'short-story',
      detail: `整本只有 ${sentences} 句正文，比 ${input.tree.nodes.length} 页还少`,
    })
  }

  return signals
}
