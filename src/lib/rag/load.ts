/**
 * load.ts —— 语料**从哪儿来**：种子索引读盘、家庭自己的书现场扫、拼成一个检索器
 *
 * ★ 这是 `src/lib/rag/` 里**唯一碰文件系统**的文件（其余全是纯函数），
 *   位置与 `engine/providers/stores.ts` 在引擎里的位置一样：
 *   纯函数不认识"盘"，要盘的都收在一个适配器里。
 *   `eslint.config.mjs` 那条 PURE_ENGINE_FILES 只禁 React / DOM / 组件目录，不禁 `node:fs`——
 *   与引擎那一侧同一条规矩。
 *
 * ---------------------------------------------------------------------------
 * 两份语料的**归属不同**，所以来路也不同（spec §三）
 *
 * | 来源     | 来路                                          | 归属     |
 * | -------- | --------------------------------------------- | -------- |
 * | ① 种子   | `src/lib/rag/index.seed.json`（随仓库提交）   | library  |
 * | ② 创作史 | 这一片存储里的 `books/<id>/story.json`（现场扫） | u/<userId> |
 *
 * ★ ②走的是**已经按用户分好片**的 store（`lib/asset-scope.ts` 的 `scopedStore`），
 *   所以"读到别人家的书"在这条路上不会发生——但 `owner` 仍然要**显式**传进来，
 *   因为 `retrieve.ts` 的 `avoid` 那一侧是拿它当**硬边界**用的，
 *   而不是拿它当"store 恰好只给了这些"。两件事必须都成立：
 *   数据来路对（store 分片）+ 检索逻辑对（owner 过滤）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { PlanRetriever } from '../engine/index.ts'
import { EngineError } from '../engine/errors.ts'
import type { AssetStore } from '../engine/providers/types.ts'
import { readStory, STORY_FILE } from '../story-draft.ts'
import {
  parseRagIndex,
  chunksFromStoryBook,
  type RagChunk,
  type RagIndex,
  type RagOwner,
} from './corpus.ts'
import { retrieveBoth, themeKeyOf, type RetrieveQuery } from './retrieve.ts'

/**
 * 取几条、门槛多高。**扫过两轮，定下来的是三个数**（2026-10-19）。
 *
 * 扫描（`node scripts/rag-bakeoff.mts --dryRun=1`，$0、可复现）在 10 个主题上量到：
 * `k=1` 平均 1.0 条范例、`k=3` 2.1 条、`k=5` 2.3 条（边际递减，取 **3**）；
 * 阈值那一侧，`minScore=1` 时 10/10 的主题取得到范例、`2` 时 6/10、`3` 时 4/10。
 *
 * ★ **第一轮之后 `DEFAULT_MIN_SCORE` 留在 2，但多了一档 `DEFAULT_NARROWED_MIN_SCORE=1`。**
 *   第一轮两臂各跑一遍（各 10 本）时，没有任何一个量给出可复现的差异
 *   （判据 ① 两轮变号；② 方向一致但幅度从 15.8 缩到 1.9 个百分点）。
 *   追下去发现**不是"检索没用"，是三分之一的样本没吃到药**：
 *   `--dryRun=1` 的预检行显示两臂提示词的差是 382、287、439、**0**、91、283、**0**、**0**、281、180 字
 *   ——火箭、鲸鱼、城堡三个主题**一条范例都取不到**，那三本两臂提示词**逐字节相同**。
 *   根因：同主题那本样书的跨页按"与家长那句话的字符重合"打分只有 1.5–1.8，
 *   被一刀切的阈值 2 挡住——**而主题在元数据里是确定的，字符重合只是它的代理**。
 *   所以第一轮那把"一刀切"的阈值换成了**按池子的收窄程度分两档**
 *   （分工写在 `retrieve.ts` 的 `RetrieveQuery.minScore` / `narrowedMinScore` 与文件头第四节）。
 *
 * ★ `DEFAULT_MIN_SCORE` 那一档**没有降**，而且它现在管的事更准了：
 *   它只在"**请求里认不出主题**"时生效（那条路上池子是整座库，低阈值会把不相关的范例
 *   喂进去——文件头第二节警告过的那种坏法）。认得出主题的请求走 `1` 那一档。
 *
 * 下面这行注释是定这几个数时的**手感**，留着当第二意见：
 * 好匹配落在 2.5–9.5 分，而"只命中一个常见 bigram"大约 2.2 分。
 */
export const DEFAULT_K = 3
export const DEFAULT_MIN_SCORE = 2
/**
 * 池子**已被收窄**时用的阈值（池子被主题或 owner 收窄，见 `retrieve.ts` 文件头第四节）。
 * 取 1 = "至少命中一个 bigram"，也就是把"同主题"这件事当准入，
 * 不再要求字符重合替它说话。★ 它的效果是把覆盖从 6/10 个主题提到 **10/10**。
 */
export const DEFAULT_NARROWED_MIN_SCORE = 1

/** 索引文件在仓库里的位置。★ 用 `process.cwd()`：`import.meta.url` 在 Next 的服务端
 *  bundle 里指向**打包产物**，不是源码目录（`lib/book-source.ts` 那几处同一条先例） */
export function seedIndexPath(): string {
  return join(process.cwd(), 'src', 'lib', 'rag', 'index.seed.json')
}

/**
 * 归属名：`u/<userId>`。
 *
 * ★ 与 `asset-scope.ts` 的 `scopePrefixOf` **差一个结尾斜杠**，而那个斜杠在那边是承重的
 *   （前缀匹配 `u/1/` 不能命中 `u/10/…`）。这里用的是**相等比较**（`retrieve.ts` 的
 *   `ownerAdmits`），所以两边各是各的形状，不去复用、也不去改那一个。
 * ★ 没有 userId 就**当场炸**，绝不返回 `u/undefined`——与 `asset-scope.ts` 那条
 *   「防的不是攻击者，是防我们自己忘了那道闸」同一条理由：
 *   一个看起来通、实际上两个陌生人在同一片里互相看得见的坏法。
 */
export function ownerOf(userId: string | null | undefined): RagOwner {
  if (!userId) {
    throw new EngineError('invalid-request', '检索没有归属：userId 为空时不许拼 owner')
  }
  return `u/${userId}`
}

let cachedSeed: RagIndex | null = null

/**
 * 读种子索引。**解析失败就抛错**（`parseRagIndex` 的纪律），不静默降级。
 *
 * ★ 进程内缓存一次：它随仓库发布、一次部署里不会变，而每一个"开一本"的请求
 *   都去读 39 kB 的 JSON 是白花的 I/O。
 *   ★ 缓存是**进程级**的，而 `--force` 重建索引之后的老进程会继续用旧的那一份——
 *     那是 dev 下的现象（改了语料要重启 dev server），不是线上问题：
 *     生成环境里语料与进程一起发布。
 */
export async function loadSeedIndex(): Promise<RagIndex> {
  if (cachedSeed) return cachedSeed
  const raw = JSON.parse(await readFile(seedIndexPath(), 'utf8'))
  cachedSeed = parseRagIndex(raw)
  return cachedSeed
}

/** 测试用：把缓存清掉（生产代码不该调它） */
export function resetSeedIndexCache(): void {
  cachedSeed = null
}

/**
 * ② 创作史：这一片存储里**已经写过**的书 → chunks。**不落盘、每次现场扫**。
 *
 * ★ 为什么不建持久索引：量级（几十本 × 20 页 ≈ 数百条，毫秒级），
 *   而且落盘的索引与书**必然**会不同步（删一本书、改一版草稿），
 *   "检索到一本已经不存在的书"是这个功能最难查的坏法。见 spec §三。
 * ★ 读不出来的那一本**跳过**，不让它把整次检索带走：与 `library.ts` 那条
 *   "一本读不出来的书不该让整个书架 500" 是同一条判断。
 */
export async function ownChunksOf(store: AssetStore, owner: RagOwner): Promise<RagChunk[]> {
  let paths: string[]
  try {
    paths = await store.list('books/')
  } catch {
    return []
  }

  const chunks: RagChunk[] = []
  for (const path of paths.filter((one) => one.endsWith(`/${STORY_FILE}`))) {
    // 书号 = 目录名（`library.ts` 那段"目录名是它唯一的家"）
    const bookId = path.slice('books/'.length, path.length - `/${STORY_FILE}`.length)
    if (bookId === '') continue
    const draft = await readStory(store, bookId).catch(() => null)
    if (!draft) continue
    chunks.push(
      ...chunksFromStoryBook({
        bookId,
        owner,
        title: draft.doc.title,
        theme: draft.input.theme,
        form: draft.input.form,
        ageBand: draft.input.child.ageBand,
        /**
         * ★ 每一格都**现兜一次类型**（2026-10-20），不是洁癖。
         *
         *   `readStory` 只做**信封校验**（`story-draft.ts` 的 `isStoryDoc`：title 是字符串、
         *   nodes 是对象数组），而 `PUT /api/books/<id>/story` 就是拿它把关的——
         *   所以盘上那一份里 `{"nodes":[{}]}` **是合法的**，`node.scene` 是 undefined。
         *   原来这里直接把它递给 `chunksFromStoryBook`，那边一句 `page.scene.trim()` 当场抛；
         *   抛出去被 `plan.ts` 的 `retrieveOnce` 接住——那一步刻意不拖垮规划——于是症状是
         *   **这一片存储的检索从此永远不工作**，而屏幕上只有"这次没检索到"。
         *   一句话：一页存坏的草稿，会让**整个账号**的检索静默停摆。
         *   ★ 兜成空串而不是补一个默认值：缺的值就是缺的（同 `RagChunk` 那条"不许填
         *     一个像样的默认值"），空场景 + 空正文的那一页会被 `chunksFromStoryBook` 跳过。
         */
        pages: (Array.isArray(draft.doc.nodes) ? draft.doc.nodes : []).map((node, index) => ({
          pageNo: index + 1,
          scene: typeof node?.scene === 'string' ? node.scene : '',
          body: Array.isArray(node?.body)
            ? node.body.filter((line) => typeof line === 'string')
            : [],
        })),
      }),
    )
  }
  return chunks
}

/**
 * 查询串 = **这一轮要写什么**。
 *
 * ★ 三样东西进查询串：家长那句话（`wish`）、重写要求（`reviseNote`）、兴趣标签。
 *   兴趣标签要进：它们是"这本书里一定会出现的东西"（恐龙、下雨），
 *   而语料里正是靠这些词才找得到同类句子。
 * ★ **主题键不进**（英文键对不上中文语料，塞进去只会让"这次查询有多长"变成一个
 *   与分数无关的数）——但**认不出来的主题要进**：那一档的 `theme` 其实是家长那句话
 *   （见 `retrieve.ts` 的 `themeKeyOf`），它是**内容**，不是约束。
 *   ★ 这条是实测逼出来的：`engine-run --retrieve` 第一次跑，"以前的故事里没有相近的"
 *     ——它只传了标签，而 `theme` 那半句被整条丢掉了，查询串薄到取不到东西。
 *     （真界面上不至于：`lib/creation/state.ts` 那句 `|| wish` 让 `wish` 也带着那句话。
 *     但"只有 theme 有内容"这条路是真的存在——脚本与将来的 MCP 工具就走它。）
 */
export function queryTextOf(input: {
  theme?: string
  wish?: string
  reviseNote?: string
  interestTags: readonly string[]
}): string {
  const theme = input.theme?.trim() ?? ''
  const themeIsContent = theme !== '' && themeKeyOf(theme) === null
  return [input.wish, input.reviseNote, themeIsContent ? theme : '', ...input.interestTags]
    .filter(Boolean)
    .join(' ')
}

export type PlanRetrieverOptions = {
  /** **已经按用户分好片**的 store（`lib/asset-scope.ts`） */
  store: AssetStore
  /** `u/<userId>`。检索时拿它当隐私边界（见 `retrieve.ts` 文件头第三条） */
  owner: RagOwner
  k?: number
  minScore?: number
  /** 池子已被收窄（主题 / owner）时用的那一档，见 `DEFAULT_NARROWED_MIN_SCORE` */
  narrowedMinScore?: number
  /** 测试用：直接给一份索引，别去读盘 */
  seed?: RagIndex
  /** 测试用：直接给自家的 chunk，别去扫盘 */
  own?: readonly RagChunk[]
}

/**
 * 拼出 `planBook` 要的那个 `retriever`。**它是同步的，而返回的那个函数是 async 的**。
 *
 * ★ 语料在**第一次调用时**才读（`loaded` 那个闭包变量），这一个选择管着两件事：
 *   ① 一次"开一本"里规划可能被调 2–3 次（重试），语料只读一遍；
 *   ② **读不到就抛在外面**——`plan.ts` 的 `retrieveOnce` 会把它接住、
 *      发一条 `retrieved {corpusVersion: null}` 与一条非致命 `error`，
 *      然后**照常把那本书编出来**。检索是一段可选的参考材料，不是这本书的前提。
 * ★ 如果改成"调用方先 await 好语料再传进来"，那件失败就没地方去了：
 *   路由手上只有 `EngineEvent`（带 `seq` / `at`），**没有事件工厂**——
 *   它发不出合法事件，于是只能静默降级。这一条是由类型逼出来的，不是偏好。
 */
export function createPlanRetriever(options: PlanRetrieverOptions): PlanRetriever {
  let loaded: { index: RagIndex; corpusVersion: string } | null = null
  const k = options.k ?? DEFAULT_K
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE
  const narrowedMinScore = options.narrowedMinScore ?? DEFAULT_NARROWED_MIN_SCORE

  const load = async (): Promise<{ index: RagIndex; corpusVersion: string }> => {
    if (loaded) return loaded
    const seed = options.seed ?? (await loadSeedIndex())
    const own = options.own ?? (await ownChunksOf(options.store, options.owner))
    // ★ 两份语料合成**一个临时索引**给 `retrieveBoth`：`corpusVersion` 留种子那一份，
    //   因为那是"语料版本"的标识——②没有版本，它每次现算（它的身份写在 chunk id 的
    //   `u/<userId>/` 前缀里，而那已经在 provenance 的 `hits` 上看得见）。
    loaded = {
      index: { ...seed, chunks: [...seed.chunks, ...own] },
      corpusVersion: seed.corpusVersion,
    }
    return loaded
  }

  return async (input) => {
    const { index, corpusVersion } = await load()
    const query: Omit<RetrieveQuery, 'polarity'> = {
      ageBand: input.ageBand,
      theme: input.theme,
      form: input.form,
      text: queryTextOf(input),
      owner: options.owner,
      k,
      minScore,
      narrowedMinScore,
    }
    // ★ `corpusVersion` 由这里带回去，不由引擎猜（`PlanRetrieval` 那条注释）
    return { pair: retrieveBoth(query, index), corpusVersion }
  }
}
