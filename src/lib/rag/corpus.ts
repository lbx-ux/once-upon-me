/**
 * corpus.ts —— 语料的形状与切块（★ 纯函数，不碰文件系统）
 *
 * 这一层只回答两件事：一份语料切出来是什么形状，以及它怎么变成指纹。
 * 读盘在调用方（`scripts/build-rag-index.mts` 写索引、工单 04 的 loader 读索引），
 * 检索在 `retrieve.ts`。三个模块分开，是因为它们各自会被单独测、单独替换。
 *
 * 三份语料，归属不同所以落点不同（spec §三）
 *
 * | 来源       | 谁的东西   | 落点                                            |
 * | ---------- | ---------- | ----------------------------------------------- |
 * | ① 种子     | 仓库资产   | `index.seed.json`（随仓库提交，`library`）       |
 * | ② 创作史   | 用户私有 | 不落索引，每次现场扫（`u/<userId>`）          |
 * | ③ 审核条款 | 仓库资产   | 代码即语料（`review-corpus.ts`），不进这个索引 |
 *
 * ★ ② 一个字节都不许进仓库、也不许跨 owner 取。 这条不是"最好别"，是判据：
 *   `corpus.test.ts` 里有一条「种子索引里零个 `u/` owner」。
 *   不这么做，症状是「别人家孩子的书正文被喂进了这个模型的上下文」——
 *   与仓库现有的「别人的书 id 在你那一片里不存在 → 404」是同一条纪律，
 *   而它比 404 严重得多（那是读不到，这是读到了别人的）。
 *
 * 切块：**一个跨页 / 一页 = 一个 chunk，不做滑窗**
 *
 *   一页正文 1–3 句、几十字，天然就是一个语义单元。滑窗是给长文档准备的，
 *   在这个粒度上它只会把一个完整画面切成两半，让 top-k 取到半页。
 *   语料长大到单条超过几百字时再回来看这条。
 *
 * `text` 与 `source` 必须分开（一条不显眼但要紧的纪律）
 *
 *   `text` 是给模型看的那段字，里面不许出现书名、页码、跨页短名这类出处标识；
 *   `source` 是给人看的出处（进 provenance、进提示词的括注）。
 *
 *   混在一起的后果是具体的：范例段里每条后面跟着「（来源：样书《…》第 3 跨页）」，
 *   模型会把那半句也当成可抄的语料的一部分——而它抄进去的东西会印在一本
 *   给孩子的书上。出处另存之后，提示词里那句括注由 `prompt.ts` 自己拼。
 */

import { AGE_BANDS, type AgeBand, type BookForm } from '../engine/domain.ts'
import { canonicalDigest } from '../engine/digest.ts'
import { EngineError } from '../engine/errors.ts'

/** 元数据里"不限"的写法。它是通配，不是"不知道"——「不知道」该在切块时就填清楚 */
export const ANY = '*' as const
export type Any = typeof ANY

export const RAG_OWNER_LIBRARY = 'library'

/**
 * 归属。★ `library` 是仓库资产，`u/<userId>` 是某个家庭的私有物，
 * 而这一格是检索时唯一一道隐私边界：`owner` 不匹配的 chunk 不许出现在结果里。
 */
export type RagOwner = typeof RAG_OWNER_LIBRARY | `u/${string}`

/**
 * 切块的种类。
 *
 * 只有两种。原计划里的 `'prompt'`（`docs/*-art-prompts.md` 的画面提示词段）推迟了，
 *   理由不是"来不及"，是它今天没有消费者：本轮接的是规划（吃正文）与审核（吃条款），
 *   出图那条按 spec §六 本轮不接。往索引里塞一类没人读的 chunk，
 *   下一个改语料的人得替它猜"这堆是给谁用的"——同一条纪律见
 *   `example-wishes.ts` 里「留一份没人读的表，下一个改句子的人会漏改它」。
 *   接出图那条时再加 `'prompt'`，那时它有明确的消费者与过滤条件。
 */
export type RagKind = 'spread' | 'page'

export type RagChunk = {
  /** 稳定 id，人读得懂：`library/cloud#s2`、`u/12/books/bk_ab#p7` */
  id: string
  kind: RagKind
  owner: RagOwner
  /**
   * 五项元数据都是硬过滤的键，不是打分的特征（spec §五）。
   * ★ 把约束做成打分特征的症状是「8 岁档的句子漏给 4 岁档，而分数看起来还挺高」。
   */
  ageBand: AgeBand | Any
  /**
   * 主题。★ 刻意不是 `ThemeKey`：`library` 那批是主题墙上那 12 个键，
   * 而 ② 这一侧的主题来自家长输入，今天是一个自由的字符串。
   * 收窄成 `ThemeKey` 会把"家长写了个别的主题"变成类型错误，
   * 而那不是错误，是它本来就允许的。
   */
  theme: string | Any
  form: BookForm | Any
  /** 给模型看的那段字。不含出处标识（见文件头） */
  text: string
  /** 给人的出处：`样书《小飞看见的那朵云》第 3 跨页 · 风来了` / `《…》第 7 页` */
  source: string
}

export type RagIndex = {
  /** ① 的内容指纹。同输入必须同指纹（spec 判据 2），所以它只由 chunks 决定 */
  corpusVersion: string
  builtAt: number
  chunks: readonly RagChunk[]
}

/* ① 种子：12 本样书 */

/**
 * 样书的结构形状。★ 刻意不 import `components/booklist/booklist.ts`：
 * `src/lib/rag/**` 与 `src/lib/engine/**` 同档，那条 ESLint 禁令不许它引组件目录
 * （`eslint.config.mjs` 的 PURE_ENGINE_FILES）。所以这里声明结构，由脚本把真对象递进来。
 * 结构对得上就行——`BooklistBook` 天然满足它。
 */
export type BooklistSpreadSource = { caption: string; text: readonly string[] }
export type BooklistBookSource = {
  key: string
  title: string
  /**
   * 主角锚点。★ 它不进 `text`：那是一整段外貌约束（"约 5 岁的东亚孩子：乌黑短发…"），
   * 混进正文范例会教模型描写长相——而长相是角色卡的职责，
   * `story-plan.ts` 的 imagePrompt 那一行明写着「不要描述主角的长相」。
   * 它的用处只有一处：给这一条的年龄档留个出处（下面 `ageBandOfSample` 读的就是它）。
   */
  hero: string
  spreads: readonly BooklistSpreadSource[]
}

/**
 * 样书的年龄档。
 *
 * 不是拍脑袋：12 本样书的 `hero` 每一本都写着「约 5 岁」（2026-10-19 逐本核过，
 *   `grep -h "hero:" src/components/booklist/books/*.ts | grep -o "约 [0-9]* 岁" | sort | uniq -c`
 *   → `12 约 5 岁`）。5 岁落在 `4-6` 这一档，所以这一批的 `ageBand` 是 `4-6` 有据可依。
 *   将来某本样书改写成别的年龄，这里要跟着改——所以它读的是 `hero` 而不是写死一个常量。
 */
export function ageBandOfSample(hero: string): AgeBand | Any {
  const year = /约\s*(\d+)\s*岁/.exec(hero)?.[1]
  if (!year) return ANY
  const age = Number(year)
  if (age < 4) return '4-'
  if (age <= 6) return '4-6'
  if (age <= 8) return '6-8'
  return '8+'
}

/**
 * 12 本样书 → chunks。
 *
 * `form` 填 `ANY`（对两种形态都开放），这不是"没记"：
 *   样书本身是线性的（8 个跨页、一个选择点都没有），而它在这里的作用是
 *   「同一个年龄档、同一个主题下写完了的句子长什么样」——句子与节奏与形态无关。
 *   把它标成 `solo` 的后果很具体：共读版（`shared`）那一半请求按 `form` 过滤之后
 *   一条都取不到，于是半个产品的检索是哑的。
 *   真正需要形态约束的是避重那一侧（拿独读版的落点去避共读版的重复是错的），
 *   那条约束落在 ② 的 chunk 上，它自己有准确的形态。
 */
export function chunksFromBooklist(books: readonly BooklistBookSource[]): RagChunk[] {
  const chunks: RagChunk[] = []
  for (const book of books) {
    book.spreads.forEach((spread, index) => {
      const lines = spread.text.filter((line) => line.trim() !== '')
      if (lines.length === 0) return
      chunks.push({
        id: `${RAG_OWNER_LIBRARY}/${book.key}#s${index + 1}`,
        kind: 'spread',
        owner: RAG_OWNER_LIBRARY,
        ageBand: ageBandOfSample(book.hero),
        theme: book.key,
        form: ANY,
        // 跨页短名在最前面：它是这一页的浓缩（"风来了""又像船"），
        // 检索时它比正文更容易命中主题词，展示时它也是这一条的标题
        text: [spread.caption, ...lines].join('\n'),
        source: `样书《${book.title}》第 ${index + 1} 跨页 · ${spread.caption}`,
      })
    })
  }
  return chunks
}

/* ② 创作史：某个家庭自己的书 */

/**
 * 一本书的一页。★ 形状对着 `story.json` 里的 `nodes`（`lib/story-draft.ts`）写，
 * 但只取需要的四个字段：切块要的不是整棵树，是"这一页写了什么"。
 * 树形引用（`from` / `via`）不进语料——检索要的是内容，不是结构。
 */
export type StoryPageSource = {
  pageNo: number
  scene: string
  body: readonly string[]
}
export type StoryBookSource = {
  bookId: string
  /** `u/<userId>`。调用方有责任给对：给错了就是跨 owner 泄露（文件头那条纪律） */
  owner: RagOwner
  title: string
  theme?: string
  form?: BookForm
  ageBand?: AgeBand
  pages: readonly StoryPageSource[]
}

/**
 * 一本书 → chunks（不落盘，每次现场扫）。
 *
 * 为什么不建持久索引：量级。几十本 × 20 页 ≈ 数百条，读盘 + 切块 + 打分为毫秒级。
 *   同一条纪律见 ADR-0007 的「`summaries()` 是一次前缀扫描，量级到几千张卡要换实现」——
 *   换实现的那一天由当时的量决定，现在不预设一个与书不同步的索引。
 *   落盘还有第二个代价：索引与书不同步是必然会发生的一件事（删一本书、改一版草稿），
 *   而"检索到一本已经不存在的书"是这个功能最难查的坏法。
 *   整层"用文件不用服务"的决定记在 [ADR-0011](../../../docs/adr/0011-index-is-a-file-not-a-vector-db.md)
 *     （它是同一条纪律的第三次：ADR-0003 的资产 → ADR-0007 的卡 → 这里的索引）。
 */
export function chunksFromStoryBook(book: StoryBookSource): RagChunk[] {
  const chunks: RagChunk[] = []
  for (const page of book.pages) {
    const scene = page.scene.trim()
    const body = page.body.map((line) => line.trim()).filter((line) => line !== '')
    // 场景与正文都是这一页的内容：场景给"这一页在讲什么"，正文给"句子长什么样"。
    // 两个都空的那一页不是语料（它连一个字都没有），跳过
    if (scene === '' && body.length === 0) continue
    chunks.push({
      id: `${book.owner}/books/${book.bookId}#p${page.pageNo}`,
      kind: 'page',
      owner: book.owner,
      // ★ 缺哪个填哪个、缺的填 ANY：不许把"没有"填成一个像样的默认值
      //   （空值不等于默认值，这个项目在"空值算不算错"那一节付过学费）
      ageBand: book.ageBand ?? ANY,
      theme: book.theme ?? ANY,
      form: book.form ?? ANY,
      text: clampChunkText([scene, ...body].filter((line) => line !== '').join('\n')),
      source: `《${book.title}》第 ${page.pageNo} 页`,
    })
  }
  return chunks
}

/**
 * 一条 chunk 的正文进提示词之前的字上界。
 *
 * ★ 为什么这里必须有上界：`story.json` 只过信封校验——`story-draft.ts` 的
 *   `isStoryDoc` 只认"title 是字符串、nodes 是对象数组"（那个文件头写着为什么
 *   它刻意只管信封）。于是家长存回来的那一份里 `scene` / `body` 的长度没有任何东西在管，
 *   而 chunk 的正文会原样进故事规划的提示词（`rag/prompt.ts` 的 `retrievalBlock`）。
 *   一个 100 kB 的 scene 足以把整条用户消息淹没——那时模型丢掉的是"要输出 JSON"这件事本身，
 *   而屏幕上的症状是"生成失败"，看不出跟检索有关。
 *
 * 这个数是算出来的，不是拍的：它正好等于 codec 允许的一页上限
 *   （`schemas/story.ts`：`scene` ≤ 200，`body` ≤ 4 条 × 120 字 = 480，合计 680），
 *   所以它永远不会截断一条合法的页。
 *   两个来源的实测分布（2026-10-20，`data` 见 `.scratch/prompt-audit/ledger.md`）：
 *     种子语料 96 条 47–65 字；盘上 11 本真书的 79 页 40–103 字。
 *     两处都离 680 很远——这道闸挡的是病态输入，不是正常内容。
 *   改了它要连带看一眼 codec：`rag/corpus.test.ts` 有一条判据盯着
 *     "上界 ≥ codec 允许的一页"（放宽 codec 而不抬这个数，那条会红）。
 */
export const MAX_CHUNK_CHARS = 680

/** 截断留个记号：不静默——"这一段被削过"是读的人该知道的一件事 */
const ELLIPSIS = '…'

/** 太长就削到上界并留一个 `…`。★ 按码点算，一个 emoji 不该被腰斩成半个 */
function clampChunkText(text: string): string {
  const points = [...text]
  return points.length <= MAX_CHUNK_CHARS
    ? text
    : points.slice(0, MAX_CHUNK_CHARS).join('') + ELLIPSIS
}

/* 指纹与解析 */

/**
 * ① 的内容指纹。
 *
 * ★ 只由 `chunks` 决定，不含 `builtAt`：否则"重跑一次脚本"就会让指纹变，
 *   而它要回答的问题是"语料变没变"。这条由测试摁着（重跑必须同指纹 = spec 判据 2）。
 * 走 `canonicalDigest`：对象键排序，所以"改了源文件里的字段顺序"不算内容变化。
 * 按 id 排序之后再取指纹（与 `canonicalJson` 排对象键是同一条判断）：
 *   切块的顺序不影响检索能取到什么，只影响并列时的先后。
 *   不排的话，"把 12 本书的导入顺序换一下"会让整份索引的指纹变，
 *   而语料一个字节都没变——那种假警报多了，真警报就没人看了。
 */
export function corpusVersionOf(chunks: readonly RagChunk[]): string {
  return canonicalDigest([...chunks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
}

export function buildRagIndex(chunks: readonly RagChunk[], builtAt: number): RagIndex {
  return { corpusVersion: corpusVersionOf(chunks), builtAt, chunks: [...chunks] }
}

const KINDS: readonly RagKind[] = ['spread', 'page']

/**
 * 解析索引文件。坏了就报错，不静默降级（`errors.ts` 那条纪律）。
 *
 * 为什么不信任磁盘上那份：它是生成物，而生成物可能来自另一个版本的代码
 *   （改过 `RagChunk` 的形状之后没重跑脚本）。静默接受一个字段对不上的索引，
 *   症状是"检索到的东西缺一半字段"，而它会在很远的地方才炸。
 *   同一条纪律见 `replay.ts`：回放 miss 就报错，绝不静默退回网络。
 */
export function parseRagIndex(raw: unknown): RagIndex {
  const fail = (why: string): never => {
    throw new EngineError('schema-validation-failed', `索引文件不合格：${why}`, {
      detail: ['重新跑一次：node scripts/build-rag-index.mts'],
    })
  }

  if (!raw || typeof raw !== 'object') fail('根不是一个对象')
  const root = raw as Record<string, unknown>
  if (typeof root['corpusVersion'] !== 'string' || root['corpusVersion'] === '') {
    fail('缺少 corpusVersion')
  }
  if (typeof root['builtAt'] !== 'number') fail('缺少 builtAt')

  // 取成局部常量再 `Array.isArray`：直接对 `root['chunks']` 判类型，
  //   TS 不会把那个下标访问表达式收窄（`noUncheckedIndexedAccess` 下它是 `unknown`）
  // ★ `return fail(...)`：让控制流知道这一支走不到底，否则下面的 `rawChunks` 还是 unknown
  const rawChunks = root['chunks']
  if (!Array.isArray(rawChunks)) return fail('chunks 不是数组')

  const chunks: RagChunk[] = []
  rawChunks.forEach((item: unknown, index: number) => {
    const at = `第 ${index + 1} 条`
    if (!item || typeof item !== 'object') fail(`${at} 不是一个对象`)
    const chunk = item as Record<string, unknown>
    const need = (field: string): string => {
      const value = chunk[field]
      // `return fail(...)` 而不是"先 fail 再 return value"：前者的控制流分析
      // 知道这一支走不到底（fail 回 never），后者要靠 TS 认 `never` 收窄，
      // 而它对"箭头函数赋值给 const"这种写法不认（实测 4 处报错，2026-10-19）
      if (typeof value !== 'string' || value === '') return fail(`${at} 的 ${field} 不是非空字符串`)
      return value
    }
    const kind = need('kind')
    if (!KINDS.includes(kind as RagKind)) fail(`${at} 的 kind「${kind}」不认识`)
    const owner = need('owner')
    if (owner !== RAG_OWNER_LIBRARY && !owner.startsWith('u/')) {
      fail(`${at} 的 owner「${owner}」既不是 library 也不是 u/<userId>`)
    }
    const ageBand = need('ageBand')
    if (ageBand !== ANY && !AGE_BANDS.includes(ageBand as AgeBand)) {
      fail(`${at} 的 ageBand「${ageBand}」不认识（只收 ${AGE_BANDS.join(' / ')} 与 ${ANY}）`)
    }
    chunks.push({
      id: need('id'),
      kind: kind as RagKind,
      owner: owner as RagOwner,
      ageBand: ageBand as AgeBand | Any,
      theme: need('theme'),
      form: need('form') as BookForm | Any,
      text: need('text'),
      source: need('source'),
    })
  })

  return {
    corpusVersion: root['corpusVersion'] as string,
    builtAt: root['builtAt'] as number,
    chunks,
  }
}
