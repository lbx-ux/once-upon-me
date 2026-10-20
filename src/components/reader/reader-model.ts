/**
 * reader-model.ts —— 阅读器的**页模型**（纯函数：没有 React、没有 DOM、没有磁盘）
 *
 * 这个文件存在的理由是一次返工：2026-10-15 发现阅读器把书翻成了
 * **左右各一张不同的图**，而产品要的是首页那样——一张 3:2 的横图在书脊处切开、
 * 画面是连着的，正文只叠在左半。
 *
 * ★ 值得记一笔的是**翻页几何一直是对的**（`flip.ts` 一个字没改），错的是
 *   "每一面装什么"。而这类错没有任何闸门拦得住：类型对、lint 过、几何自检也过，
 *   只有人翻开看一眼才知道不对。所以把那条关系从组件里抽出来，变成能断言的四句话：
 *
 *   1. 一页 = 一个跨页 = **一张**图：同一个 opening 的左右半是**同一张图的同一份**，
 *      两个面指着同一个 `page`（挂反了/挂成两张图，这条就红）
 *   2. 正文只跟**左半**走（右半再出一遍就是同一句话印两遍）
 *   3. 封面与封底**不是页**：页码用 `null` 说，不是 0 / `pages.length` 那种哨兵值
 *      （封底那个哨兵**恰好等于最后一页的页码**，于是"停在封底"会被下游读成
 *       "在第 P 页"——朗读按钮亮着、阅读时长记到最后一页上）
 *   4. 叶数 = 页数 + 1（flip.ts 的叶表：N 个跨页要 N+1 叶）
 */

import type { ReaderPage, ResolvedStory, StoryChoiceView, StoryView } from '@/lib/book-source.ts'

export type FaceHalf = 'left' | 'right'

/**
 * 一面装什么。★ **半页是一个面**，不是一整页：
 * 翻开一屏看到的是一张图的两半，不是两张图。
 */
export type ReaderFace =
  { kind: 'cover' } | { kind: 'back' } | { kind: 'art'; page: ReaderPage; half: FaceHalf }

/** P 页 → P+1 叶。叶 k 的正面是 `faces[2k]`、背面是 `faces[2k+1]`（见 flip.ts） */
export function leafCountOf(pages: readonly ReaderPage[]): number {
  return pages.length + 1
}

/**
 * 页 → 面表：封面 + 每一页的左右半（左在前、右在后）+ 封底。
 *
 * 顺序不能改：跨页 k 的**左**半挂在 L(k−1) 的背面（面号 2k−1）、**右**半挂在
 * L(k) 的正面（面号 2k）。左右对调的症状是"跨页中缝处画面接不上"。
 */
export function readerFaces(pages: readonly ReaderPage[]): ReaderFace[] {
  const faces: ReaderFace[] = [{ kind: 'cover' }]
  for (const page of pages) {
    faces.push({ kind: 'art', page, half: 'left' }, { kind: 'art', page, half: 'right' })
  }
  faces.push({ kind: 'back' })
  return faces
}

/**
 * 这一面属于第几个"打开"：0 = 封面，1…P = 第 1…P 页，`leafCount` = 封底。
 *
 * ★ 它 = `ceil(面号 / 2)`，这是叶表的直接推论（跨页 k 的两半在面号 2k−1 与 2k，
 *   恰好是同一个 ceil）。挂图的窗口按**它**算而不是按叶号：同一页的左右半在两片
 *   不同的叶上，按叶号判会让右半先于左半消失（翻到下一页时右边先空掉，像图坏了）。
 */
export function openingOf(faceIndex: number): number {
  return Math.ceil(faceIndex / 2)
}

/** 这一面要不要出正文。**只出在左半**——两半是同一张图，两边都出就是同一句印两遍 */
export function showsText(face: ReaderFace): boolean {
  return face.kind === 'art' && face.half === 'left' && face.page.body.length > 0
}

/**
 * 自动朗读（设置 · 阅读偏好里的那一条）在**第 opening 个跨页**上该念哪一屏。
 *
 * 三个答案，两端各占一头：
 * · `begin` —— 封面：这一屏**不是页**，没什么可念的，而"从头念"要从**第 1 屏**起。
 *   ★ 它与 `readoutOf` 在封面给的 `page: null` **不是同一件事**：那边说的是
 *     "这一屏没有页码"，这边要回答的是"接下来念哪儿"。跟着那个 null 走的话，
 *     按一次「自动朗读」会**一句都不念**——按钮亮着、书在封面上一动不动。
 * · `done` —— 封底：这一本念完了，这一趟到此为止。
 * · `speak` —— 念这一屏（1-based）。
 *
 * ★ 那个差一是真会犯的：写成 `opening >= screenCount`，最后一页**会被念两遍**
 *   （一遍算"第 N 屏"、一遍算"封底那张白纸"）——`readoutOf` 那条哨兵注释
 *   （封底那个值恰好等于最后一页的页码）记的就是同一类错法。
 *   `screenCount + 1` 才是封底，因为叶数 = 屏数 + 1（`leafCountOf`）。
 *
 * ★ 用的是**屏序号**不是页码：两个阅读器的展示口径不同（`/reader` 报"第 N 页"、
 *   书单那本样书报"第 a–b 页"），而"念第几屏"是它们共有的那一件事。
 *   换算成各自口径上的数字是组件的事。
 */
export type AutoCue = { kind: 'begin' } | { kind: 'done' } | { kind: 'speak'; screen: number }

export function autoCueOf(opening: number, screenCount: number): AutoCue {
  if (opening <= 0) return { kind: 'begin' }
  if (opening >= screenCount + 1) return { kind: 'done' }
  return { kind: 'speak', screen: opening }
}

/** 底部那行页码。`page: null` = 现在这一屏不是页（封面 / 封底） */
export type Readout = { label: string; page: number | null }

export function readoutOf(q: number, pages: readonly ReaderPage[]): Readout {
  const leafCount = leafCountOf(pages)
  const near = Math.round(q)
  if (near <= 0) return { label: '封面', page: null }
  if (near >= leafCount) return { label: '封底', page: null }
  const page = pages[near - 1]
  // 走到这儿说明 q 越界或页表比叶数短（只可能是调用方传错了），照实说出来
  if (!page) return { label: `第 ${near} 页`, page: null }
  /**
   * ★ 给人看的那个数用的是**这条路上的序号**，不是 `page.pageNo`（2026-10-18，共读版）。
   *
   *   独读版里这两个数相等（`pageNo` 就是 1..N），所以这一处改动**不改独读版的任何读数**；
   *   而共读版里它们必须分开：`pageNo` 是**资产编号**（`page-7-a1.webp`、事件流里的进度），
   *   路径序号才是"孩子读到第几页"。同一个孩子沿着 B 支走，他的第 2 页在表里可能是第 11 页——
   *   底栏若报 11，家长会以为漏读了九页。
   * ★ `page` 仍然是 `pageNo`：阅读记录要记的是**书里那一页**（那是全表唯一的编号）。
   */
  return { label: `第 ${near} 页`, page: page.pageNo }
}

/* ═══════════════════════ 共读版：阅读顺序**是那条路**，不是页号 ═══════════════════════ */

/**
 * ★★ 这一节是共读版与独读版**唯一**真正分岔的地方，也就是"阅读器不肯分裂成两台"
 *    那句话的成本所在。
 *
 * 独读版里"第 k 页"就是资产 `page-k-a1.webp`，两个概念重合，所以 `readerPages()`
 * 排一排就完事。共读版里它们必须分开：
 *
 * | 概念     | 独读版         | 共读版                              |
 * | -------- | -------------- | ----------------------------------- |
 * | `pageNo` | 第几页         | **资产编号**（事件流与文件名用它）   |
 * | 阅读顺序 | `linearOrder`  | **从根走到叶的那条路**              |
 * | 共 N 页  | `nodes.length` | **路长**（那张表还含走不到的一支）   |
 *
 * ★ 不做这一层的症状**没有任何闸门拦得住**：`readerPages()` 把两条支排成相邻的两页，
 *   于是孩子选了一次、看到的却是两条路连着读下来——树的形状在屏幕上完全看不出来，
 *   而类型、lint、几何自检全绿。所以这一层得是**能被断言的纯函数**，不是组件里的 for 循环。
 */

/** 孩子选的那一支（对应 `via`）。`null` = 还没选 */
export type Pick = 'a' | 'b' | null

/**
 * 从根走到叶的那条路。
 *
 * ★ **走到没选过的选择点就停下**——停下才有那一屏"画面停住，出现两个大按钮"
 *   （产品定义原话）。所以还没选的时候，这条路**比整本书短**：
 *   它就是"到目前为止他能读到的那些页"。
 * ★ 选过之后从选择点接着往下走，走到叶子为止（一支的结尾）。
 */
export function storyPath(story: ResolvedStory, pick: Pick): StoryView[] {
  const byId = new Map(story.nodes.map((node) => [node.nodeId, node]))
  const path: StoryView[] = []
  const seen = new Set<string>()
  let current: StoryView | undefined = byId.get(story.rootId)
  while (current) {
    // 书是引擎写的、`buildTree` 校验过（只许向前引用），所以环不可能出现。
    // 但这一层读的是**盘上的 JSON**，而一个被手改过的 `book.json` 不该把服务端渲染挂死。
    if (seen.has(current.nodeId)) break
    seen.add(current.nodeId)
    path.push(current)
    if (current.choice) {
      if (pick === null) break
      // 选择点的 `next` 顺序 = 选项顺序（tree.ts 按 via=a/b 排过），所以 a 就是第 0 个
      current = byId.get(current.next[pick === 'a' ? 0 : 1] ?? '')
      continue
    }
    current = byId.get(current.next[0] ?? '')
  }
  return path
}

/**
 * 那条路 → 页表（面表、叶数、翻页几何全都不认得"树"，它们只认页）。
 * ★ 这一层翻译是刻意的：`flip.ts` 的几何**一个字都不用改**（它是 W2 之前就为这一步留的），
 *   共读版换掉的只是"喂给它哪些页、按什么顺序"。
 */
export function pathPages(path: readonly StoryView[]): ReaderPage[] {
  return path.map((view) => ({
    pageNo: view.pageNo,
    imageUrl: view.imageUrl,
    audioUrl: view.audioUrl,
    body: view.body,
    missing: view.missing,
  }))
}

/**
 * 这一本书**现在最多能翻到第几叶**（`qTarget` 的上界）。
 *
 * ★ `blocked` = "前面没路了、而且拦住它的是那个没选过的选择点"。那时**封底那一片叶不给**：
 *   不挡的话一路点 `›` 就翻到最后一屏「读完啦」，孩子一次都没选过，
 *   而"选择点"这三个字从头到尾没起作用——那等于把共读版做成了独读版加一页。
 * ★ 挡住的是"越过它"，不是"翻页"：往回翻永远自由（反悔是允许的，首页那本也是）。
 * ★ 独读版与"已经选过"的共读版都拿满（`leafCountOf`），所以这一条**不改独读版的量程**。
 */
export function maxLeafOf(pages: readonly ReaderPage[], blocked: boolean): number {
  return leafCountOf(pages) - (blocked ? 1 : 0)
}

/** 这一屏该浮出的选择点。不是选择点那一屏就是 `null` */
export function choiceScreenOf(
  path: readonly StoryView[],
  opening: number,
): StoryChoiceView | null {
  if (opening <= 0) return null
  return path[opening - 1]?.choice ?? null
}

/**
 * 选择点那一屏要念的三段，**按这个顺序**：引导提问 → 选项 A → 选项 B。
 *
 * ★ 顺序就是按钮的左右顺序：`options[0]` 对应 `via: 'a'`（`tree.ts` 保证），
 *   所以"念的第二段"与"左边那颗按钮"永远是同一个选项。
 *   ★ 这一行原来写在 `ReaderBook` 的 `ChoicePoint` 里（那颗「🔊 念一遍」按来念）。
 *     2026-10-20 自动朗读也要念这三段，于是抽到这里：两处各写一遍就是两份会漂的顺序
 *     ——念的是 A、亮的是 B，而屏幕上没有任何东西会说出这件事。
 *
 * ★ 缺一段就**把它留在原位**当 `null`：判据是"三段齐了才念"（只对两个选项能响的按钮，
 *   证的是反面），而不是把数组压短——压短之后下标与选项就对不上了。
 */
export function choiceClipsOf(choice: StoryChoiceView): readonly (string | null)[] {
  return [choice.promptAudioUrl, choice.options[0].audioUrl, choice.options[1].audioUrl]
}

/**
 * ★ 这里原来还有一个 `pressedOf(path, opening, pick)`——"这一屏该按着哪一颗"，
 *   2026-10-18 收尾时删掉了。理由是它**没有消费者，而且恒等于 `pick`**：
 *   控件只在 `choiceScreenOf(...) !== null` 的那一屏被渲染，所以"这一屏是不是选择点"
 *   这个判断已经由渲染条件做过了，再包一层纯函数只是把同一件事说两遍。
 *   （一条永远不会与它的退化形式不同的抽象，比没有更糟：下一个人会以为它兜住了什么。）
 *   真正要守住的那一条——**选过之后回翻，按下态还在、可以改选**——是
 *   `pick` 与 `choiceScreenOf` 两条各自的直接推论，两条都有自己的测试。
 */
