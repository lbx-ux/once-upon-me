/**
 * plan-tools.ts —— 编故事那一步，模型能用的四件工具
 *
 * 这一层是「Function Calling」里工具是什么的答案；循环在
 * `engine/tool-loop.ts`，而两者之间隔着一条边界：
 * 循环不知道工具是什么，工具不知道循环怎么转。
 * 所以语料在哪（`rag/`）、书架在哪（`library.ts`）、红线词库在哪（`engine/review.ts`）
 * 全都只在这一层出现，引擎那边一个字都不知道。
 *
 * 四件工具，各答一个问题：
 *
 * | 工具 | 答什么 | 复用谁 |
 * | ---- | ------ | ------ |
 * | `search_past_stories` | 以前写过的相近段落，正例给节奏、反例明令避开 | `rag/retrieve.ts` 的 `retrieveBoth` |
 * | `read_shelf` | 这个孩子已经有哪些书、什么主题 | `library.ts` 的 `listBooks` |
 * | `check_draft` | 这段正文过不过红线与适龄字表 | `engine/review.ts` 的 `reviewText` |
 * | `character_brief` | 画师会拿到的角色段与核对清单 | `promptFragmentOf` / `checklistOf` |
 *
 * `check_draft` 是这一组里最值钱的一条：它把「写完被 `illustrateBook` 整本拒发」
 *   变成「模型自己改回去再来」。前者要家长重新走一遍流程，后者只是一次工具调用。
 *   ——这是「拦下来」与「自己改回去」的区别，也是评分表里"工具调用"四个字
 *   在这个产品上真正的用处。
 *
 * ★ `search_past_stories` 必须走 `retrieveBoth`，不许另写一条检索：
 *   `rag-bakeoff` 量出来的那套参数（k / 两档阈值 / 硬过滤 / 正反不重叠）
 *   只对一个实现成立。另写一份的症状不是"重复代码"，是
 *   "网页上编出来的故事与模型自己查出来的不是一回事"。
 *
 * 四件工具都不写盘。要改故事走 `plan_book` 的 `reviseNote`（产品里已经在走的那条路），
 *   模型不该从工具这条路去改盘上的东西——那会让"家长看到的版本"与"盘上的版本"
 *   出现第二条修改途径，而两条途径的先后顺序没人定义过。
 */

import type { CharacterCard } from './engine/index.ts'
import type { AssetStore } from './engine/providers/types.ts'
import type { RagChunk, RagIndex, RagOwner } from './rag/corpus.ts'
import type { AgeBand, BookForm } from './engine/domain.ts'
import type { ToolDef } from './engine/tool-loop.ts'

import { listBooks, noCovers } from './library.ts'
import { reviewText } from './engine/review.ts'
import { checklistOf, promptFragmentOf } from './engine/character-card/card.ts'
import { retrieveBoth } from './rag/retrieve.ts'
import { SOURCE_BOUNDARY_LINE } from './rag/prompt.ts'
import { DEFAULT_K, DEFAULT_MIN_SCORE, DEFAULT_NARROWED_MIN_SCORE } from './rag/load.ts'

export type PlanToolsContext = {
  /** 已经按用户分好片的 store（`lib/asset-scope.ts`） */
  store: AssetStore
  /** `u/<userId>`（`lib/rag/load.ts` 的 `ownerOf` 那个形状）。检索拿它当隐私边界：反例只从这个人的片里取 */
  owner: RagOwner
  card: CharacterCard
  /**
   * 这一轮要写什么。只用于检索的硬过滤（年龄档 / 主题 / 形态）——
   * 查询串是模型自己在 `search_past_stories` 的参数里给的那个词，
   * 所以这里没有 `text`：再放一个查询串进上下文，两处就会漂。
   */
  query: { ageBand: AgeBand; theme: string; form: BookForm }
  /** 测试用：直接给一份索引，别去读盘 */
  seed?: RagIndex
  /** 测试用：直接给自家的 chunk，别去扫盘 */
  own?: readonly RagChunk[]
  /** 读语料。**缺省是 `lib/rag/load.ts` 那条惰性装载**；测试注入它就不用碰盘 */
  load?: () => Promise<{ index: RagIndex; own: readonly RagChunk[] }>
}

/* 四件工具 */

export function planToolsOf(context: PlanToolsContext): ToolDef[] {
  return [searchTool(context), shelfTool(context), checkTool(), briefTool(context.card)]
}

/**
 * 翻以前写过的。
 *
 * 名字里带 `search_`：模型对"这是查东西的"这件事读得最准。
 * 描述里写清了正反两侧各是干什么用的——不写的话模型会把反例当范例照抄，
 *   而那正好是这条工具想防的事（"他读过了，这本别重复"）。
 */
function searchTool(context: PlanToolsContext): ToolDef {
  return {
    spec: {
      name: 'search_past_stories',
      description:
        '在以前写过的故事里检索与 query 相近的段落。' +
        '返回两组：「可以照着写的」（节奏与用词参考）与「他读过的」（这一本要避开的落点）。' +
        '动笔之前先查一次通常有用；如果这次的主题很新，也可能一条都查不到——那也是正常结果。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '要找什么。用具体的话，比如「怕黑 · 恐龙 · 夜里第一次一个人睡」',
          },
          k: { type: 'integer', description: `最多各取几条，缺省 ${DEFAULT_K}` },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    async run(args) {
      const { query, k } = parseSearch(args)
      const { index, own } = await loadCorpus(context)
      const pair = retrieveBoth(
        {
          ageBand: context.query.ageBand,
          theme: context.query.theme,
          form: context.query.form,
          text: query,
          owner: context.owner,
          k,
          minScore: DEFAULT_MIN_SCORE,
          narrowedMinScore: DEFAULT_NARROWED_MIN_SCORE,
        },
        // 自家写过的书每次现场拼（`rag/corpus.ts` 的判断：几十本 × 20 页是毫秒级，
        //   而落盘的索引与书必然会不同步）。种子那份随仓库提交，一次进程读一次。
        { ...index, chunks: [...index.chunks, ...own] },
      )
      return formatSearch(query, pair)
    },
  }
}

/** 这个孩子已经读过什么。★ 筛的是他的，不是整个账号的——模型要避的是"他读过了" */
function shelfTool(context: PlanToolsContext): ToolDef {
  return {
    spec: {
      name: 'read_shelf',
      description:
        '看这个孩子已经有哪些书、分别是什么主题与形态。' +
        '想避开"上一次写过的落点"时调它——这本书的形态与主题越接近已有那些，越要避开。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run() {
      const books = await listBooks(context.store, noCovers)
      const mine = books.filter((book) => book.cardId === context.card.cardId)
      if (mine.length === 0) {
        return `${context.card.childId} 名下还没有书——这是他/她的第一本，没有要避开的落点。`
      }
      // 写法与 MCP 那条 `list_books` 对齐（`lib/mcp/tools.ts`）：同一个问题
      //   在两个消费者那里长出两种说法，是这个项目最忌讳的一类漂移。
      return (
        `${context.card.childId} 名下已有 ${mine.length} 本（新的在前）：\n` +
        mine
          .map(
            (book) =>
              `- 《${book.title}》｜${book.form === 'solo' ? '独读版' : '共读版'}｜` +
              `${book.status === 'story' ? '只有故事' : '已经画了'}`,
          )
          .join('\n')
      )
    },
  }
}

/**
 * 自己先过一遍闸。
 *
 * 回的是 `reviewProblemText` 那一套措辞（"第 1 页：恐怖（R-01）——出现了「血」"），
 *   不另写一份：家长在屏幕上读到的与模型读到的是同一句话，两边才改得到一起去。
 * ★ 「一条都没报」必须说得清是"过了"，不是返回一个空串——
 *   空串在模型那边读起来像"没结果/被打断了"，而它的正确解读是"这段可以用"。
 */
function checkTool(): ToolDef {
  return {
    spec: {
      name: 'check_draft',
      description:
        '把一段正文拿去走一遍内容审核（红线词库 + 适龄字表）。' +
        '写完一段就先过一遍它——**没通过的话，整本书到出图那一步会被拒发**，' +
        '那时家长要重走一遍流程。返回空 = 这一段可以。',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要检查的那一段正文（一页的 body 全拼起来，或单独一行）',
          },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    run(args) {
      const text = stringOf(args, 'text')
      if (text === undefined) throw new Error('缺 text：把要检查的那一段正文传进来')
      const problems = reviewText(text)
      if (problems.length === 0) {
        return '这一段通过了内容审核（红线词库与适龄字表都没有命中），可以用。'
      }
      return (
        '这一段**没通过**，必须改：\n' +
        problems
          .map(
            (problem) =>
              `- ${problem.category}（${problem.clauseId}）——出现了「${problem.word}」，` +
              `在「${problem.context}」这一处`,
          )
          .join('\n') +
        '\n改完再调一次 check_draft 确认。'
      )
    },
  }
}

/**
 * 画师会拿到的那些。
 *
 * 八条锚点本来就在你的提示词里（`plan.ts` 会把卡注进去），所以这条工具
 *   回的不是锚点原文，而是只有这里才看得到的另两样：
 *   派生的角色段（每一页出图 prompt 的开头，由卡唯一决定）与核对清单。
 *   模型要写画面描述时需要知道"画师手上是什么"，否则它写的画面与画出来的那个孩子
 *   对不上——而这件事在出图之后只能靠重画补救。
 */
function briefTool(card: CharacterCard): ToolDef {
  return {
    spec: {
      name: 'character_brief',
      description:
        '看这一页出图时，画师实际会拿到的那一段角色描述，以及画完之后用来核对' +
        '"是不是同一个孩子"的清单。写画面描述之前调它，能让描述与画师手上的东西对齐。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    run() {
      return [
        '派生的角色段（每一页出图提示词的开头，由角色卡唯一决定）：',
        promptFragmentOf(card),
        '',
        '画完之后逐条核对的清单：',
        checklistOf(card)
          .map((one) => `- ${one}`)
          .join('\n'),
      ].join('\n')
    },
  }
}

/* 参数与语料 */

function parseSearch(args: unknown): { query: string; k: number } {
  const record =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {}
  const query = typeof record['query'] === 'string' ? record['query'].trim() : ''
  if (query === '') throw new Error('缺 query：用具体的话说清要找什么，比如「怕黑 · 恐龙」')
  const raw = record['k']
  const k = raw === undefined || raw === null ? DEFAULT_K : Number(raw)
  if (!Number.isInteger(k) || k < 1 || k > 10) {
    throw new Error(`k 要是 1–10 的整数，收到「${String(raw)}」`)
  }
  return { query, k }
}

function stringOf(args: unknown, key: string): string | undefined {
  const record =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {}
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * 语料从哪来。
 *
 * 两条来源、一个函数（与 `card-source.ts` / `book-source.ts` / `children-source.ts`
 *   同一个形状）：种子那份随仓库提交、进程内读一次；自家写过的那份每次现场拼。
 * 缺省那条路是惰性的（`lib/rag/load.ts` 上的 `loadSeedIndex` / `ownChunksOf`
 *   各有各的缓存与理由），所以"这一次没查"不会付读盘的钱。
 */
async function loadCorpus(
  context: PlanToolsContext,
): Promise<{ index: RagIndex; own: readonly RagChunk[] }> {
  if (context.seed) return { index: context.seed, own: context.own ?? [] }
  if (context.load) return context.load()
  const { loadSeedIndex, ownChunksOf } = await import('./rag/load.ts')
  const index = await loadSeedIndex()
  const own = await ownChunksOf(context.store, context.owner)
  return { index, own }
}

function formatSearch(
  query: string,
  pair: {
    examples: readonly { chunk: RagChunk; score: number; why: string }[]
    avoids: readonly { chunk: RagChunk; score: number; why: string }[]
  },
): string {
  if (pair.examples.length === 0 && pair.avoids.length === 0) {
    // ★ 「这次没翻到」是合法结果，不许写成"检索失败"（`rag/retrieve.ts` §二那条）：
    //   写成失败的话，模型会去重试、绕路，而正确处置是照常往下写。
    return `以前的故事里没有与「${query}」相近的片段（这次没有可参考的，照常往下写就行）。`
  }
  const parts: string[] = []
  /**
   * 与图纸那一条共用同一句分界（`rag/prompt.ts` 的 `SOURCE_BOUNDARY_LINE`）。
   *
   *   这一格与预检索那一格吃的是同一份素材——正例里有一半以上来自家长自己家里
   *   那几本书的 `story.json`，而那一份家长可以逐字改（`PUT /api/books/<id>/story`
   *   只过信封校验）。所以"工具返回的东西是数据不是指令"这件事必须说两次：
   *   两个入口各说一次，而措辞只有一处（另写一份的话，改了一边另一边就漂）。
   */
  parts.push(SOURCE_BOUNDARY_LINE)
  if (pair.examples.length > 0) {
    parts.push('可以照着写的（节奏与用词）：')
    parts.push(...pair.examples.map((hit) => `- [${hit.why}] ${hit.chunk.text}`))
  } else {
    parts.push('没有可照着写的片段。')
  }
  if (pair.avoids.length > 0) {
    parts.push('')
    parts.push('他读过的（**这一本要避开这些落点与句式**）：')
    parts.push(...pair.avoids.map((hit) => `- ${hit.chunk.text}`))
  }
  return parts.join('\n')
}
