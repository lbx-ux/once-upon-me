/**
 * children-list.ts —— 「有哪些孩子、他们各长什么样」这一件事的唯一实现（服务端侧）
 *
 * 与 `cards-list.ts` 同一层、同一条理由：档案（谁）与卡（长什么样）是两个来源，
 * 而把它们对起来这件事只该有一处实现。各写一遍 join 的症状很具体：
 * 卡片墙按 childId 对、形象页按 cardId 对，于是同一份数据在两个页面上
 * 归属不同的孩子——而那种错没有报错，只有"这张形象怎么不是他"。
 *
 * 最重要的一条："有档案、没形象"是正常状态，不是错误。
 *   家长刚建的孩子在出图之前就是这样，而界面必须如实显示它——拿一张示例图去顶，
 *   就是给不存在的数据源背书。
 *   2026-10-17：示例孩子（小满 / 小宇）不再属于这一种了——他们的卡随仓库
 *   发布了（`card-source.ts`）。这一条判据没变，变的是那两张卡的事实。
 */

import { assetRoot } from './books-runtime.ts'
import { assetUrlOf } from './asset-url.ts'
import { demoAssetRoot, demoCardUrlOf, withDemoCards } from './card-source.ts'
import { listCardItems, type CardListItem, type CardUrlFor } from './cards-list.ts'
import {
  listChildren,
  listDemoChildren,
  type ChildSource,
  type ResolvedChild,
} from './children-source.ts'
import { booksOnly, listBooks, noCovers, type BookSummary } from './library.ts'
import {
  cardDigest,
  createCardStore,
  createFsStore,
  type ChildRecord,
  type AgeBand,
  type CharacterAnchor,
  type Gender,
} from './engine/index.ts'

export type ChildListItem = {
  profile: ChildRecord
  /** 示例还是家长自己建的。由来源决定，不由档案里的一个字段决定（那个字段会说谎） */
  source: ChildSource
  /** 这个孩子现在的形象。null = 还没出过图 */
  card: CardListItem | null
}

/**
 * 档案与卡对起来这件事本身。提出来是为了让 `listWallItems` 复用同一份卡表，
 * 而不是把同一个 join 写两遍——`listChildItems` 内部已经读过一次卡目录了。
 */
function joinChildrenWithCards(children: ResolvedChild[], cards: CardListItem[]): ChildListItem[] {
  const byChild = new Map<string, CardListItem>()
  for (const card of cards) {
    // 一个孩子可能有多张卡（换过命名、重建过）。取 revision 最大的那一张，
    // 与 `cards-list` 里"同 cardId 只留最新"是同一个意思，只是这里跨 cardId
    const seen = byChild.get(card.childId)
    if (!seen || seen.revision < card.revision) byChild.set(card.childId, card)
  }
  return children.map((child) => ({
    profile: child.profile,
    source: child.source,
    card: byChild.get(child.profile.childId) ?? null,
  }))
}

export async function listChildItems(
  root: string = assetRoot(),
  urlFor: CardUrlFor = assetUrlOf,
): Promise<ChildListItem[]> {
  const [children, cards] = await Promise.all([listChildren(root), listCardItems(root, urlFor)])
  return joinChildrenWithCards(children, cards)
}

/**
 * 角色墙那一屏要的：`ChildListItem` 再加用他做过几本书（工单 05 第五轮）。
 *
 * 为什么这两个数单独一函数，而不是塞进 `ChildListItem`：
 *   构造一个 `BookSummary` 要把资产根下每一本 `book.json` 都读一遍
 *   （`library.ts` 的 `listBooks`），而创作流第 1 步（`listChildPicker`）与详情页
 *   都不是非要知道这个数。要的人自己来拿，别让所有人都付这份钱。
 *
 * 数的是这个孩子名下的全部 cardId，不是只有当前那张：书里记的是 `cardId`，
 *   而一个孩子可能换过卡号——只数当前那张的话，"换过形象"的孩子会显示成
 *   从来没做过书，而那个数是错的却看着很正常。
 *
 * 只数运行期的书（`library.ts` 的口径），不含随仓库发布的演示书：
 *   那个数是"你做了几本"，把演示书灌进去就是一个假数。
 */
export type ChildWallItem = ChildListItem & {
  /** `count` 为 0 时 `lastCreatedAt` 是 null——没有"最近一本"，不是第 0 毫秒 */
  books: { count: number; lastCreatedAt: number | null }
}

export async function listWallItems(
  root: string = assetRoot(),
  urlFor: CardUrlFor = assetUrlOf,
): Promise<ChildWallItem[]> {
  const [children, cards, allBooks] = await Promise.all([
    listChildren(root),
    listCardItems(root, urlFor),
    // 只要"用他做过几本"，这一屏不摆封面 → `noCovers`（见它的注释：
    // 不设默认值，是因为"忘了给"与"这本书没有封面"不该是同一个 null）
    listBooks(await createFsStore(root), noCovers),
  ])
  /**
   * 故事草稿不算（`booksOnly`，2026-10-17）：这一句写的是"用他做过 N 本书"，
   *   而只有故事、一页没画的本子还不是一本书。把它算进来，那个数就不再是它说的话。
   */
  return withBookCounts(joinChildrenWithCards(children, cards), cards, booksOnly(allBooks))
}

/** 卡号 → 这个孩子名下的全部卡号。数书要用，两个入口共用同一份 */
function cardIdsByChild(cards: readonly CardListItem[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const card of cards) {
    const mine = out.get(card.childId) ?? new Set<string>()
    mine.add(card.cardId)
    out.set(card.childId, mine)
  }
  return out
}

/**
 * 把"用他做过几本书"挂在每一格上。
 *
 * `books` 是哪一片里的书由调用方决定，这不是随手定的参数：
 *   登录用户在数自己的书（"你做了几本"），而访客数的是示例那一片里的书
 *   （小宇那本演示书是真的，而且访客点得开它）。
 */
function withBookCounts(
  items: ChildListItem[],
  cards: readonly CardListItem[],
  books: readonly BookSummary[],
): ChildWallItem[] {
  const ids = cardIdsByChild(cards)
  return items.map((item) => {
    const mine = ids.get(item.profile.childId)
    let count = 0
    let last = 0
    for (const book of books) {
      if (!mine?.has(book.cardId)) continue
      count += 1
      if (book.createdAt > last) last = book.createdAt
    }
    return { ...item, books: { count, lastCreatedAt: count > 0 ? last : null } }
  })
}

/** 一个孩子 + 他的形象。找不到这个孩子时回 null（不抛：childId 来自 URL） */
export async function childItemOf(
  childId: string,
  root: string = assetRoot(),
  urlFor: CardUrlFor = assetUrlOf,
): Promise<ChildListItem | null> {
  const all = await listChildItems(root, urlFor)
  return all.find((item) => item.profile.childId === childId) ?? null
}

/** 版本历史里的一版：界面要的那几个数，不是整张卡 */
export type CardRevisionView = {
  /** 卡号。★ 界面看不见它，但"切回这一版"要拿它去 POST：那一屏是按孩子组织的，
   *  卡号在别处没有落脚点，让客户端自己拼 `${childId}-sheet` 就是把建卡时的命名约定
   *  复制到界面里——那条约定一改，所有已经建好的孩子会一起切不动，而报错看不出来
   */
  cardId: string
  revision: number
  /** 768 那一档：这一屏显示的是不到 400 CSS px 的相纸，要两倍屏够用（见 CharacterWall 的注释） */
  imageUrl: string
  modelId: string
  /** `character-sheet@v2` / `character-revise@v2` / `character-photo@v2`（`@v1` 是旧卡）。历史上这一版是哪份提示词出来的 */
  promptVersion: string
  /** 家长写下的「想改哪里」。第一版没有（没有上一版可比） */
  suggestion?: string
  generatedAt: number
  /** 卡的语义指纹。★ 界面不显示它，但它是"这两版到底一不一样"的判据 */
  digest: string
  /** 就是现在 `latest` 指着的那一版 */
  isCurrent: boolean
}

export type ChildDetail = {
  item: ChildListItem
  /** 从第 1 版到最新，升序——历史要按时间读 */
  revisions: CardRevisionView[]
}

/**
 * 「选一个小主角」那一屏要的那几个数（工单 03 第 4 刀）。
 *
 * 与 `ChildListItem` 分开，而不是把后者直接给客户端：
 *   后者带着 `CardListItem`（原图地址、锚点、指纹、`referencePath`……），
 *   而这一屏只需要"叫什么、多大、有没有形象、那张小图在哪"。
 *   图地址在这里算好，客户端不拼 `?w=`：档位是一张封闭表，
 *   权威在服务端（`lib/thumbs.ts`），这条约定 `childDetailOf` 已经写过一次。
 */
export type ChildPickerItem = {
  childId: string
  name: string
  nameReading: string
  ageBand: AgeBand
  /**
   * 性别（2026-10-16）。
   *
   * ★ 它必须过这道窄投影，而这不是"顺手多带一个字段"：
   *   这道投影是 `/home` 那张卡 → `/create` 那一屏的唯一通路
   *   （`create/page.tsx` 从 `listChildPicker` 反查孩子，再把 `RunForm` 交给运行视图），
   *   所以它掉一个字段的表现是——用户在 `/home` 上明明点了「男孩」，
   *   请求体里却什么都没有，模型退回按头发长短猜。
   *   这正是那条报障（「我提供给你的是男孩子，怎么生成出来有男孩有女孩子」）
   *   在界面这条路上最后的漏点：`toBookBody` 与 `parseCreateBody` 两头都补好了，
   *   中间这一格不补，整条路还是不通。
   * 与 `ChildProfile.gender` 一致，可选：老档案与示例孩子都没有这一栏。
   */
  gender?: Gender
  lookTags: readonly string[]
  interestTags: readonly string[]
  source: ChildSource
  /**
   * 这一轮会用的形象。`null` = 他还没有形象（刚建档、还没出图的那个孩子），
   * 那时第 3 步要现出一张——这不是错误，是这一屏正常的一个状态。
   */
  card: {
    cardId: string
    revision: number
    /** 240 档：列表里那张小图（原图是 2.7 MB 的 1440² PNG） */
    thumbUrl: string
    /**
     * 768 档：选中他之后第 3 步那张预览。
     * 两个档位各给一个字段、各带一个名字，而不是给一个 `url` 让调用方自己配宽度：
     *   配宽度的权力在服务端（档位是一张封闭表），而"列表里的小图"与"预览那张"
     *   本来就不是同一个消费者——合成一个字段的那天起，总有一边拿到不合适的那档。
     */
    previewUrl: string
    modelId: string
    /** 这一张卡自己的锚点。选中他之后第 3 步要预置这些，不是表单里那份默认值 */
    anchors: readonly CharacterAnchor[]
    promptFragment: string
    checklist: readonly string[]
  } | null
}

/** 创作流第 1 步的取数。与 `listChildItems` 同一份 join，只是把形状压到界面要的那几个数 */
export async function listChildPicker(root: string = assetRoot()): Promise<ChildPickerItem[]> {
  const items = await listChildItems(root)
  return items.map((item) => ({
    childId: item.profile.childId,
    name: item.profile.name,
    nameReading: item.profile.nameReading,
    ageBand: item.profile.ageBand,
    // 有才带（与请求体那三处同一条写法）：老档案没有这一栏，
    // 带一个 undefined 下去会让"没选"与"选了空"分不出来
    ...(item.profile.gender ? { gender: item.profile.gender } : {}),
    lookTags: item.profile.lookTags,
    interestTags: item.profile.interestTags,
    source: item.source,
    card: item.card
      ? {
          cardId: item.card.cardId,
          revision: item.card.revision,
          thumbUrl: assetUrlOf(item.card.referencePath, 240),
          previewUrl: assetUrlOf(item.card.referencePath, 768),
          modelId: item.card.modelId,
          anchors: item.card.anchors,
          promptFragment: item.card.promptFragment,
          checklist: item.card.checklist,
        }
      : null,
  }))
}

/**
 * 一个孩子的全部（档案 + 形象 + 版本历史）。
 *
 * 界面视图在服务端拼好再交给客户端组件：`assetUrlOf` 要决定取哪一档缩略图，
 *   而档位是一张封闭表、权威在服务端（`lib/thumbs.ts`）。把"取 768"这件事
 *   交给客户端，迟早会有人在那边手拼一个 `?w=`。
 */
export async function childDetailOf(
  childId: string,
  root: string = assetRoot(),
  urlFor: CardUrlFor = assetUrlOf,
): Promise<ChildDetail | null> {
  const item = await childItemOf(childId, root, urlFor)
  return item ? detailWith(item, root, urlFor) : null
}

/** 详情里"版本历史"那一半。★ 两个入口（自己那一片 / 访客看的示例那一片）共用它 */
async function detailWith(
  item: ChildListItem,
  root: string,
  urlFor: CardUrlFor,
): Promise<ChildDetail> {
  // 2026-10-17：`item.card` 可能是示例卡（`card-source.ts`），而它不在任何人的
  //   那一片里。这一处自己建 store，所以也要垫上示例那一层——否则示例孩子的版本历史
  //   会是空的：卡面上有形象，翻到"这一张卡走过哪些版本"却一条都没有。
  const store = await withDemoCards(await createFsStore(root))
  const cardStore = createCardStore(store)
  const cards = item.card ? await cardStore.revisions(item.card.cardId) : []
  const currentRevision = item.card?.revision ?? null

  const revisions: CardRevisionView[] = []
  for (const card of cards) {
    revisions.push({
      cardId: card.cardId,
      revision: card.revision,
      imageUrl: await urlFor(card.reference.path, 768),
      modelId: card.provenance.modelId,
      promptVersion: card.provenance.promptVersion,
      ...(card.provenance.suggestion ? { suggestion: card.provenance.suggestion } : {}),
      generatedAt: card.provenance.generatedAt,
      digest: cardDigest(card),
      isCurrent: card.revision === currentRevision,
    })
  }
  return { item, revisions }
}

/* 访客那一支（2026-10-18）：只用示例那一片
 *
 * 未登录的访客在角色墙、形象页、以及创作首页那颗「小主角」药丸里看到的是
 * 随仓库发布的示例（小满 / 小宇），而他们的图走 `public/demo/cards/…` 的静态地址
 * ——那是因为 `/api/assets` 对匿名一律 401（"别人的东西拿不到"的守门人，
 * 一个字节都没动），而静态文件不需要鉴权。
 *
 * 三条纪律，写在这里免得下次有人顺手扩大它：
 *   1. **只读 `public/demo/`**，根由 `demoAssetRoot()` 给。绝不传 `.out/web`
 *      ——那底下是所有人的作品；
 *   2. 来源必须是 `demo`（`listDemoChildren`），不能用 `listChildren(<示例根>)`：
 *      后者会让示例档案以 `source: 'runtime'` 出现（同 id 时运行期赢），
 *      于是"示例"两个字与"示例不给删"的判据一起翻面；
 *   3. "用他做过几本书"数的是示例那一片里的书——小宇那本演示书是真的，
 *      而且访客点得开它（`/reader/<书号>` 不设闸）。
 */

/**
 * 示例那一片的取数（孩子 × 卡）。★ 两个入口共用它，所以那份目录只读一遍。
 * 把 `cards` 也交出去，是因为"用他做过几本书"要用卡号去对书。
 */
async function demoListing(): Promise<{ items: ChildListItem[]; cards: CardListItem[] }> {
  const root = demoAssetRoot()
  const [children, cards] = await Promise.all([
    listDemoChildren(),
    listCardItems(root, demoCardUrlOf),
  ])
  return { items: joinChildrenWithCards(children, cards), cards }
}

/** 访客（未登录）在角色墙看到的那一份 */
export async function listDemoWallItems(): Promise<ChildWallItem[]> {
  const [{ items, cards }, books] = await Promise.all([
    demoListing(),
    listBooks(await createFsStore(demoAssetRoot()), noCovers),
  ])
  return withBookCounts(items, cards, booksOnly(books))
}

/**
 * 「选小主角」那颗药丸要的那一份：卡、名字表、以及每张卡的显示地址。
 *
 * 三样一起交出去，而不是只交卡：地址这一件事在两条支路上不是同一个函数
 *   （登录那一支是 `/api/assets` 的 240 档，访客那一支是 `public/` 下的静态图）。
 *   让调用方自己判"我是哪一支"就等于把访客那三条纪律抄到界面层去，
 *   而抄出去的那一份迟早会漂——症状是访客那颗圆点指向一个 401 的地址，
 *   页面照旧 200，只是图空着（2026-10-18 先写成这样，e2e 当场照出来了）。
 *   名字与卡一起交出去，是因为药丸上写的是孩子的名字而不是卡号；
 *   而"档案那一层才有名字"这条纪律（见 `home/page.tsx` 文件头）对示例这一支同样成立。
 *   对的键是 childId，不是 cardId——与 `listChildren` 那边同一个理由。
 */
export type CardPickList = {
  cards: CardListItem[]
  nameOf: Map<string, string>
  /**
   * 一张卡 → 那颗圆点该拉的地址。
   * 两个实现都不重新算卡上已经有的地址：示例那一支直接把 `card.faceUrl` 交出去
   *   （它就是 `demoCardUrlOf` 的结果，而那个函数每叫一次要读一遍卡目录）。
   */
  faceOf: (card: CardListItem) => string
}

/**
 * 访客（未登录）在创作首页那颗「小主角」药丸里看到的：示例那两张卡。
 *
 * 2026-10-18 加的，用户点名的就是它：角色墙上已经看得见小满 / 小宇了，
 *   而同一个人的 `/home` 那颗药丸上还写着「还没有小主角 · 先去建一个」——
 *   两屏对同一件事实给了两种说法，其中一种是假的。
 * `cards` 里的 `faceUrl` 走的是 `demoCardUrlOf`（静态 `/demo/cards/…`），
 *   所以头像是 768 那一张——静态文件看不懂 `?w=`，档位在导出时定死了。
 *   代价写明：那颗 24px 的圆点拉的是 23 KB（小满）/ 26 KB（小宇）那两个兄弟文件，
 *   比登录用户那份 240 档（实测 10 KB）大一倍多。认这笔账的理由是
 *   两屏共用同一个地址：访客在 `/character` 与 `/home` 之间来回走只下一次。
 *   真要省，该做的是导出时多生成一个 240 档兄弟文件，而不是在这里手拼宽度。
 */
export async function listDemoCardPicker(): Promise<CardPickList> {
  const { items, cards } = await demoListing()
  return {
    cards,
    nameOf: new Map(items.map((one) => [one.profile.childId, one.profile.name])),
    faceOf: (card) => card.faceUrl,
  }
}

/** 访客点开一张示例卡：只读、只碰示例那一片 */
export async function demoChildDetailOf(childId: string): Promise<ChildDetail | null> {
  const { items } = await demoListing()
  const item = items.find((one) => one.profile.childId === childId) ?? null
  return item ? detailWith(item, demoAssetRoot(), demoCardUrlOf) : null
}
