/**
 * tree.ts —— 扁平页表 → 故事树（纯函数）。
 *
 * "一棵树、两种形态"在代码里就是这个样子：独读版 = 没有任何选择点的树，它不是另一套结构、
 * 另一条流水线。两种形态各写一套的话，产品就成了"两个功能"，而本项目全部的主张
 * （一个引擎、两种形态 → 平台而非聚合）当场失效。代价是独读版也要走一遍树的校验，
 * 分支版能做的事独读版天然也能做——这个代价是主动付的，换来的正是那句判据。
 *
 * 输入约定（见 schemas/story.ts）：`from` 是父节点在表里的 1 起序号，缺省 = 前一页。
 * 只允许向前引用（父序号必须小于自己），于是环在定义上不可能出现——与其写一个找环算法，
 * 不如让环无法被表达。这是选"序号"而不是"自造 ID"的第二个理由。
 *
 * ★★ 两条分支不可能汇合（2026-10-18 才说清的一条推论）：下面那三条规则（每节点最多一个
 *   父；选择点恰好两子；非选择点不得有第二个孩子）合起来意味着"某个节点由两条支共同接上"
 *   无法被表达——汇合节点要么需要两个父（撞第一条），要么得挂回选择点（撞第二条）。
 *   不是没实现，是无法表达。所以一条支必须自带到结尾的全部页，每加一层分支就要多付一整条
 *   尾巴。这是"共读版恰好一个选择点"以及不做 2 层的根因，也是 ADR-0006 里那段
 *   "为什么不扩 `from`"的由来。
 *   别被 `FORM_RULES.shared` 旧版那句"两条分支走回同一个结尾附近"误导——那是提示词层面
 *   的一句近似（靠叙事做到），不是结构上的承诺。
 */

import type { BookForm, ChoiceOption, Mood, StoryChoice, StoryNode, StoryTree } from './domain.ts'
import { MOODS } from './domain.ts'
import type { NodeDraft } from '../schemas/story.ts'

/**
 * 这个结构问题该由界面上的哪一组框收下（工单 05，2026-10-18）。
 *
 * 不给 = 那一页的「情节」——它是界面上唯一一个能承载"这一页的结构不对"这句话的框
 * （正文与画面各有自己的判据，结构类的话落在它们下面就是指出错地方）。
 *
 * `'choice'` 是这一条新加的：选择点那一族问题（两条分支、写了一半、多出来的孩子、整本
 * 一个都没有）原来也落在「情节」上，于是「缺 `spokenA`（A 那颗按钮）」这句话出现在一个
 * 与它无关的框下面，而闸门新摊开的那一组框（提问 / 图标 / 两个选项）什么都没说。
 * 收下它的是 `story-problems.ts`。
 *
 * 值取自 `StoryField` 那一套名字（`lib/story-problems.ts`），但这一层不 import 它
 * （它 import 这里，绕成环），所以两边靠名字对齐——`story-problems.test.ts` 里有一条
 * 用例钉着这个映射。只有这一档：`mood` 那一句（"不在枚举里"）本来也想标，但它在
 * `planStory` 那条路上到不了——schema 的 `enumOf(MOODS)` 先拦下并报了同一件事。
 * 一个到不了的标记是死代码，所以不写。
 */
export type TreeProblemField = 'choice'

export type TreeProblem = { index: number; message: string; field?: TreeProblemField }

export type BuildTreeResult =
  { ok: true; tree: StoryTree; problems: [] } | { ok: false; tree: null; problems: TreeProblem[] }

/**
 * 建一棵树。所有问题一次全报，不是遇到第一个就返回：
 * 规划失败时我们要把整份问题清单塞进重试提示（plan.ts），
 * 一次只报一条会让重试次数等于问题条数——那是拿钱换啰嗦。
 *
 * ── 第四个参数 `pages`：这一次要的是几页（2026-10-21，工单 D-08）─────────────
 *
 * 在那之前**页数一个数都不查**：请求 2 页拿到 3 页、横评里要 6 给 7、`--pages=8` 那次
 * 长出 14 个节点（选择点在第 6 页 → 每条路 10 页），全都照收。它是真实的成本漏洞：
 * 出图是这条流水线上唯一真花钱的一步，多出来的页每一页 0.2 元，而书上、屏幕上
 * 没有任何东西提示"这一本比你要的长"。
 *
 * ★ **量的是"一条路读下来几页"，不是表里几个节点**，两种形态共用这一条：
 *   独读版是单链，两者相等；共读版表里一定比它多（两条支各占各的，提示词里写着
 *   "表里的页数会比 {pages} 多几页"）。拿节点数去卡共读版会把它自己的正确形状判错——
 *   `pages=8` 那本正确时是 11 个节点，正好是 `tree.ts` 文件头那句"路长 8 页时 1 层 ≈11 张图"。
 *   ★ 所以 `BookRequest.pages` 那句"共读版是主干页数"是**写松了**：主干（选择点之前的
 *   那几页）只是路长的一部分。真口径是"一条路的页数"。
 *
 * ★ 它只在**建树这一步**查，也就是"模型被要求写 N 页"这一次。`illustrate` 那条路由
 *   （拿着盘上那份草稿再建一次树）**不传它**，那是刻意的：故事闸门之后家长可以自己
 *   增删页面，而"我删了一页"不该变成"这一本画不出来"。请求的页数是**请求时**的一条
 *   约束，不是盘上那一份的永久属性。
 *
 * ★ 路径长度只有一处算法（`computePaths`），所以这一条放在树建好之后量
 *   （`pathLengthsOf`），不在这里自己再走一遍 `from`。
 *
 * `pages` 不传 = 不查（老调用点、以及不知道请求页数的那些路）。
 */
export function buildTree(
  form: BookForm,
  title: string,
  drafts: readonly NodeDraft[],
  pages?: number,
): BuildTreeResult {
  const problems: TreeProblem[] = []
  if (drafts.length === 0) {
    return { ok: false, tree: null, problems: [{ index: 0, message: '一页都没有' }] }
  }

  const nodes: StoryNode[] = []
  /** 1 起序号 → 该节点的子节点（下标） */
  const childOf = new Map<number, { index: number; via: string }[]>()

  drafts.forEach((draft, i) => {
    const pageNo = i + 1
    const parent = draft.from ?? (i === 0 ? null : i)
    if (i === 0 && draft.from !== undefined) {
      problems.push({ index: pageNo, message: '第一页不能有父节点' })
    } else if (parent !== null && (parent < 1 || parent >= pageNo)) {
      problems.push({ index: pageNo, message: `父节点序号 ${parent} 不合法（必须小于本页且存在）` })
    }

    if (parent !== null && parent >= 1 && parent < pageNo) {
      const siblings = childOf.get(parent) ?? []
      siblings.push({ index: i, via: draft.via ?? '' })
      childOf.set(parent, siblings)
    }

    const mood = (MOODS as readonly string[]).includes(draft.mood) ? (draft.mood as Mood) : 'calm'
    if (mood !== draft.mood) {
      problems.push({ index: pageNo, message: `mood「${draft.mood}」不在枚举里` })
    }

    nodes.push({
      nodeId: `n${pageNo}`,
      pageNo,
      scene: draft.scene,
      body: draft.body,
      imagePrompt: draft.imagePrompt,
      mood,
      choice: toChoice(draft, pageNo, problems, form),
      next: [],
      pathFromRoot: [],
    })
  })

  /* 形态约束：选择点必须恰好两条、且标了 a/b；非选择点不得有第二个孩子 */
  for (const [parentNo, children] of childOf) {
    const parent = nodes[parentNo - 1]
    if (!parent) continue
    if (parent.choice) {
      if (children.length !== 2) {
        problems.push({
          index: parentNo,
          field: 'choice',
          message: `选择点有 ${children.length} 条分支，必须是 2 条`,
        })
      }
      const vias = children.map((c) => c.via)
      if (!vias.includes('a') || !vias.includes('b')) {
        problems.push({
          index: parentNo,
          field: 'choice',
          message: `两条分支要分别标 via=a 与 via=b，实际是 ${vias.join(',') || '（空）'}`,
        })
      }
      // 顺序 = 选项顺序：via=a 的孩子对应 options[0]。反了的话孩子点"骑恐龙"
      // 却走到"上船"那一页，而页面上完全看不出来。
      const ordered = [...children].sort((a, b) => (a.via === 'a' ? -1 : b.via === 'a' ? 1 : 0))
      parent.next = ordered.map((child) => nodes[child.index]?.nodeId ?? '').filter(Boolean)
    } else if (children.length > 1) {
      problems.push({
        index: parentNo,
        // 也是选择点那一族：这一页有两条以上的路，却没说这两条路是什么
        field: 'choice',
        message: `这一页没有 choice，却有 ${children.length} 个子节点`,
      })
    } else {
      parent.next = children.map((child) => nodes[child.index]?.nodeId ?? '').filter(Boolean)
    }
  }

  /*
   * 共读版恰好一个选择点（2026-10-18）。
   *
   * 产品定义那一版设想的是"多几层分支"，落地时收窄成一档，理由是钱：两条支不能汇合
   * （见文件头那条 ★），所以一条支必须自带到结尾的全部页，每加一层要多付一整条尾巴
   * ——路长 8 页时 1 层 ≈11 张图、2 层 ≈14（43% 的书那个孩子永远读不到）、3 层 ≈22（64%）。
   * 而选择的上界本来也不是页数给的，是年龄给的（`StoryChoice` 那条注释：「两个选项
   * （孩子不识字，两个已经够）」）。多做几层不等于多做几次选择。
   *
   * 这一条只在结构上拦（多于一个就报错、让模型重试）。它不是审美：多出来的那个选择点会让
   * "两条路各自收尾"这句话变成假话——第一条岔路的某一支会被第二条岔路接走，
   * 于是有一支只走了半截。
   */
  if (form === 'shared') {
    const choices = nodes.filter((node) => node.choice)
    if (choices.length === 0) {
      problems.push({
        index: 0,
        field: 'choice',
        message: '共读版一个选择点都没有——那就是独读版，请改 form 或补分支',
      })
    } else if (choices.length > 1) {
      problems.push({
        index: 0,
        field: 'choice',
        message:
          `共读版这一版只支持一个选择点，实际有 ${choices.length} 个` +
          `（第 ${choices.map((node) => node.pageNo).join('、')} 页）——` +
          '两条支各自要收出一个完整的结尾，多出来的岔路会把其中一支截断',
      })
    }
    const only = choices.length === 1 ? choices[0] : undefined
    if (only) {
      const [headA, headB] = only.next
      // 两个头都有才量深度：分支数不对时上面已经报过，这里不重复报第三遍
      if (headA && headB) {
        const pagesA = pagesFrom(nodes, headA)
        const pagesB = pagesFrom(nodes, headB)
        if (Math.abs(pagesA - pagesB) > 1) {
          problems.push({
            index: only.pageNo,
            field: 'choice',
            message:
              `两条分支的页数差太多（一支 ${pagesA} 页、另一支 ${pagesB} 页）——` +
              '一半的孩子读到的东西会明显更少，而书上没有任何东西提示这件事',
          })
        }
      }
    }
  }
  if (form === 'solo' && nodes.some((n) => n.choice)) {
    problems.push({ index: 0, field: 'choice', message: '独读版不许有选择点（睡前越选越兴奋）' })
  }

  if (problems.length > 0) return { ok: false, tree: null, problems }

  const rootId = nodes[0]?.nodeId ?? ''
  const paths = computePaths(nodes, rootId)
  const withPaths = nodes.map((node) => ({ ...node, pathFromRoot: paths.get(node.nodeId) ?? [] }))
  const tree: StoryTree = { form, title, rootId, nodes: withPaths }

  /*
   * 页数（2026-10-21，工单 D-08）。放在树建好之后：路长只有 `computePaths` 一处算法，
   * 这一条要用的是它的结果，不是第二个真相。
   *
   * 每一条路都要等于请求值——共读版有两条路（两支页数已经强制差 ≤1），而孩子走哪一条
   * 都是"这一本"。只卡最长的那条会让"一支 8 页、一支 7 页"过关，
   * 而那一支的孩子比要的少读一页。
   *
   * 它报在 `index: 0`（这一层报"整本书"级问题的既有写法，与"共读版一个选择点都没有"
   * 同一格）；共读版另外挂上 `field: 'choice'`——改这一条要动的是那两条支，
   * 而不是某一页的情节。
   */
  if (pages !== undefined) {
    const lengths = pathLengthsOf(tree)
    /**
     * 2026-10-22：共读版的 **±1 容差撤掉了**。
     *
     * 那条容差（2026-10-21 深夜加的）是给旧的一次性路径打的补丁：20 页的共读版表里要 29–39 个节点，
     * 而模型数不准（实测 21 / 没有选择点 / 12），严格相等时这一档几乎发不出去。
     * 现在共读版改走两步规划（`plan-shared.ts`），页数是**构造出来的**：
     * 主干 `C` 行 + 每支 `pages−C` 行，一条路必然是 `pages` 页。
     *
     * 留着容差只会有一种后果：**装配代码哪天错了一页，这本书会安静地过关**，
     * 而书架上显示的是真实页数——家长要 20 页，拿到 19 页，屏幕上没有任何东西解释这件事。
     * 所以它现在是严格相等；共读版也不再需要"差不多"。
     *
     * ★ 独读版一直是严格相等（表里几页就是几页），这一条没有变过。
     */
    if (lengths.some((length) => length !== pages)) {
      /**
       * 措辞是这一条的一半功能：模型要照着这句话改，而"页数不对"四个字它改不动。
       *
       * ★ 共读版那两句必须把"路长 ≠ 表里几个节点"这件事说出来。第一版写的是
       *   `页数 4 ≠ 请求 8`，而模型上一版明明交了 6 页——它没有理由知道我们数的是哪一份
       *   （表里 6 个节点、两条路各 4 页）。一句它读不懂的反馈，等于把重试变成原样重发。
       */
      const actual =
        lengths.length > 1
          ? `两条路读下来 ${lengths.join(' 页 / ')} 页`
          : form === 'shared'
            ? `两条路读下来都是 ${lengths[0]} 页`
            : `页数 ${lengths[0]}`
      /**
       * 共读版再往前一步：把**它自己那一版的算式**算给它看（2026-10-21 补）。
       *
       * 起因是实测：`story-plan@v6` 已经把公式写进提示词了，模型照样每次都差一页
       *   （请求 4 → 它写 5/5、5/5、6/6 三遍）。它读得懂公式，但读不懂"我这一版错在哪"——
       *   而上面那两句只说"两条路都是 5 页 ≠ 请求 4"，它得自己反推选择点在第几页。
       *   这跟当初"页数 4 ≠ 请求 8"那次是同一个病：一句它读不懂的反馈，等于原样重发。
       *
       * 所以这里把它自己的 `C`（选择点在第几页）代进去，给出三个数：
       *   每支该写 `pages − C` 页（它写了 `L − C` 页）、表里应正好 `pages + (pages − C)` 个节点
       *   （它写了 `nodes.length` 个）。改哪一头都行，但两条路都得正好 `pages` 页。
       */
      const choiceNode = form === 'shared' ? tree.nodes.find((node) => node.choice) : undefined
      /**
       * 差几页也要说出来，而且要说**怎么改**。
       *
       * 实测（2026-10-21，DeepSeek `deepseek-flash` + `story-plan@v6`，每个页数跑 1–3 次）：
       *   请求 8 → 1/1 一次过；请求 6 → 1/2；请求 4 → 1/3。
       *   失败的形状很稳定：**每支的尾巴多写一页**（请求 4 → 两条路 5/5，表里 7 个节点）。
       *   给公式没用，给"你这一版差几页、删哪儿"才有用——模型改稿读的是这句话。
       */
      const advice =
        choiceNode && choiceNode.pageNo > 0 && choiceNode.pageNo < pages && lengths[0] !== undefined
          ? (() => {
              const tailShould = pages - choiceNode.pageNo
              const tailActual = lengths[0] - choiceNode.pageNo
              const delta = tailActual - tailShould
              const fix =
                delta > 0
                  ? `每支末尾**删掉 ${delta} 页**`
                  : delta < 0
                    ? `每支末尾**补 ${-delta} 页**`
                    : '页数对了，问题在别处'
              return (
                `。这一版的算式：选择点在第 ${choiceNode.pageNo} 页 → 每支应各写 ${tailShould} 页` +
                `（这一版写了 ${tailActual} 页）→ 表里应正好 ${pages + tailShould} 个节点` +
                `（这一版 ${nodes.length} 个）。改法：${fix}；也可以把选择点前移/后移来凑，两种都行`
              )
            })()
          : ''
      problems.push({
        index: 0,
        ...(form === 'shared' ? { field: 'choice' as const } : {}),
        message:
          form === 'shared'
            ? `${actual} ≠ 请求 ${pages}（表里 ${nodes.length} 个节点，两条支各占各的——` +
              `页数按**一条路走下来**算，不按表里几页算）${advice}`
            : `${actual} ≠ 请求 ${pages}`,
      })
      return { ok: false, tree: null, problems }
    }
  }

  return { ok: true, tree, problems: [] }
}

/**
 * 一条分支有多少页：从这个头节点往下走到它自己那条链的末端，节点个数。
 *
 * 它量的是"这一支的孩子会读到几页"，不是树的深度（两者在单链上相等，但页才是家长与孩子
 * 能看见的那个量）。所以名字里写 `pages` 不写 `depth`。不会死循环：父引用只许向前
 * （`from < 自己`），图是一条有向森林，走不到回头路；节点数上界是 schema 给的 40，
 * 递归深度跟着它，不需要改成迭代。
 *
 * ★ 名字叫 `pagesFrom` 而不是 `branchPagesOf`：后者是同一族里另一个公开函数（收
 *   `StoryTree`、回两条支各自的页码表），两个同名的函数会让整个服务端编译不过——
 *   2026-10-18 真的这么炸过一次，症状是"所有接口 500"，而报错只在 dev server 的错误页里，
 *   `tsc` 那句（Duplicate function implementation）要自己想起来去跑。
 */
function pagesFrom(nodes: readonly StoryNode[], startId: string): number {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  let deepest = 0
  const walk = (id: string, depth: number): void => {
    if (depth > deepest) deepest = depth
    const node = byId.get(id)
    if (!node) return
    for (const childId of node.next) walk(childId, depth + 1)
  }
  walk(startId, 1)
  return deepest
}

/**
 * 一侧选项的四个平铺格子 → `ChoiceOption`。
 *
 * `label` 与 `spoken` 缺一不可——它们是孩子在按钮上看见与从耳朵里听见的东西；
 * 图标是装饰，缺了就用兜底值（与 codec 的 `withDefault` 是同一对默认值）。
 * 收 `null` 而不是抛：这一层负责把"写了几个格子"翻译成一句能照着改的话，
 * 抛出去的话，家长看到的是一句关于内部字段的错误码。
 */
function optionOf(draft: NodeDraft, side: 'A' | 'B'): ChoiceOption | null {
  const label = (side === 'A' ? draft.labelA : draft.labelB)?.trim() ?? ''
  const spoken = (side === 'A' ? draft.spokenA : draft.spokenB)?.trim() ?? ''
  if (label === '' || spoken === '') return null
  const iconKey = (side === 'A' ? draft.iconA : draft.iconB)?.trim() ?? ''
  const emoji = (side === 'A' ? draft.emojiA : draft.emojiB)?.trim() ?? ''
  return {
    iconKey: iconKey === '' ? 'generic' : iconKey,
    emoji: emoji === '' ? '✨' : emoji,
    label,
    spoken,
  }
}

/**
 * 这一页的草稿算不算一个选择点——写了一个格子就算。只有这一处判断，两个消费者都从这里取：
 *
 * - `toChoice()` 用它决定"要不要组装出一个 choice"（写了一半的走那条报错）；
 * - 故事闸门用它决定这一页摊不摊那九个框（工单 05 §一）。摊开的判据必须比 `toChoice` 宽：
 *   写了一半的那一页正是最需要能改的那一页，用"树建成了"当判据的话，树正因为这半页建不
 *   起来，于是那三个框不出现、家长改不了，屏幕上只有一句红字。
 *
 * 判据落在 `label + spoken` 齐全的选项上，不是"九个格子里有任意一个"：`iconA` /
 * `emojiA` / `iconB` / `emojiB` 在 codec 里是 `withDefault`，过一遍校验就会给每一页都
 * 填上（`'generic'` / `'✨'`），拿它们当判据等于每页都是选择点。
 */
export function isChoicePage(draft: NodeDraft): boolean {
  return (
    (draft.ask?.trim() ?? '') !== '' ||
    optionOf(draft, 'A') !== null ||
    optionOf(draft, 'B') !== null
  )
}

/**
 * 九个平铺格子 → `choice`。
 *
 * 为什么线格式是平铺的、而这里又组装成嵌套的 `StoryChoice`：见 `schemas/story.ts` 里
 * `nodeDraftCodec` 上方那段——旧写法（`choice.options` 是个对象数组）实测单次通过率 17%，
 * 而失败里七成是"`options` 交回一个空数组"。模型写不好的那一层留在线格式里少写，
 * 领域模型该是什么样还是什么样。
 *
 * 一个格子都没写 = 这一页不是选择点（不写是常态，不报错）；写了但没写全 = 报错，
 * 而且报的那句话要点名缺哪几格。
 */
function toChoice(
  draft: NodeDraft,
  pageNo: number,
  problems: TreeProblem[],
  form: BookForm,
): StoryChoice | undefined {
  const ask = draft.ask?.trim() ?? ''
  const a = optionOf(draft, 'A')
  const b = optionOf(draft, 'B')

  // ★ 「一个格子都没写」这一条只有一处实现（`isChoicePage`）——故事闸门拿它决定
  //   "这一页摊不摊那九个框"，两处各写一遍的话，界面与校验会开始不一样
  if (!isChoicePage(draft)) return undefined
  if (form === 'solo') {
    problems.push({ index: pageNo, message: '独读版不该出现 choice' })
    return undefined
  }
  if (ask !== '' && a && b) return { prompt: ask, options: [a, b] }

  const missing: string[] = []
  if (ask === '') missing.push('ask（给家长念的那句提问）')
  if (!a) missing.push('labelA / spokenA（A 那颗按钮，走 via=a 那一支）')
  if (!b) missing.push('labelB / spokenB（B 那颗按钮，走 via=b 那一支）')
  problems.push({
    index: pageNo,
    // ★ 这一句最容易落错地方：它说的是选择点那九格缺了哪几个，
    //   所以要挂进闸门新摊开的那一组框（工单 05），不是那一页的「情节」
    field: 'choice',
    message: `选择点写了一半：缺 ${missing.join('、')}——一个选择点 = 一句提问 + 两个选项，一个都不能少`,
  })
  return undefined
}

/** 从根到每个节点的路径。父链唯一（上面已保证），所以这就是个 BFS，不需要访问集防环 */
function computePaths(nodes: readonly StoryNode[], rootId: string): Map<string, readonly string[]> {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const paths = new Map<string, readonly string[]>()
  const queue: string[] = [rootId]
  paths.set(rootId, [rootId])
  while (queue.length > 0) {
    const current = queue.shift() as string
    const node = byId.get(current)
    if (!node) continue
    const path = paths.get(current) ?? [current]
    for (const childId of node.next) {
      if (!childId || paths.has(childId)) continue
      paths.set(childId, [...path, childId])
      queue.push(childId)
    }
  }
  return paths
}

/** 选择点所在的页号，进度条要提前标出来（events.ts 的 plan-ready 带它） */
export function choicePagesOf(tree: StoryTree): number[] {
  return tree.nodes.filter((node) => node.choice).map((node) => node.pageNo)
}

/**
 * 两条支各自的页码（1 起）。`a` 是第一个选项那一支，`b` 是第二个——与 `choice.next`
 * 的顺序（`buildTree` 按 via 排过）严格对应。
 *
 * 判据是"这一页从根走过来的路经不经过选择点的哪一个孩子"，不是"选择点之后的每一页都算
 * 岔路"。后者今天就能说假话：表里的平铺顺序与两支的路不是一回事（a 支的页可以排在 b 支的
 * 页后面——验证夹具就是这么摆的），而"第 N 页之后"只认得平铺顺序。所以这一层必须看
 * `pathFromRoot`。
 *
 * 选择点那一页不属于任何一支：它从根走过来的路上还没有这两个孩子，而两条路都要经过它，
 * 它在主干上。独读版（没有选择点）回两个空表，不是抛：调用方只要照常什么都不标就行。
 */
export function branchPagesOf(tree: StoryTree): { a: number[]; b: number[] } {
  const choice = tree.nodes.find((node) => node.choice)
  const headA = choice?.next[0] ?? ''
  const headB = choice?.next[1] ?? ''
  const a: number[] = []
  const b: number[] = []
  if (headA === '' || headB === '') return { a, b }

  for (const node of tree.nodes) {
    if (node === choice) continue
    if (node.pathFromRoot.includes(headA)) a.push(node.pageNo)
    else if (node.pathFromRoot.includes(headB)) b.push(node.pageNo)
  }
  return { a: a.sort((left, right) => left - right), b: b.sort((left, right) => left - right) }
}

/**
 * 草稿那一层每一页属于哪一条支（1 起页号 → `'a' | 'b' | null`）。
 *
 * 为什么要有它、而不是复用 `branchPagesOf(tree)`：闸门那一屏必须在树建不起来的时候也能
 * 标出分支（工单 05 对 `isChoicePage` 立的正是同一条判据：写了一半的树正是最需要能改的
 * 时候）。那棵树不存在，于是只能从平铺的草稿上算——`via` 就是"从父节点走的是哪条边"，
 * 一路继承下去即可。
 *
 * 一条向前的单趟就够，不需要 BFS：`buildTree` 要求父节点序号严格小于本页，所以在任何一份
 * 合法草稿里父页一定在前面。不合法的那几页（`from` 指到后面、指到自己）在这里算不出归属
 * 就回 null——那是标记，不是校验：真正的错由 `buildTree` 报，这里跟着它显示就好，
 * 报错的地方多一个只会让人在两个地方读同一句话。
 *
 * 缺省父节点与 `buildTree` 逐字同一条（`draft.from ?? (i === 0 ? null : i)`）：两处各写
 * 一遍的话，一份没写 `from` 的草稿会在闸门上被标成"不属于任何一支"，而它其实好好地长在
 * 主干上。选择点那一页回 `null`（主干），与 `branchPagesOf` 那条是同一条事实的两种写法。
 */
export function branchLabelsOf(drafts: readonly NodeDraft[]): readonly ('a' | 'b' | null)[] {
  const labels: ('a' | 'b' | null)[] = []
  drafts.forEach((draft, i) => {
    const parentNo = draft.from ?? (i === 0 ? null : i)
    const parentOk = parentNo !== null && parentNo >= 1 && parentNo <= i
    const inherited = parentOk ? (labels[parentNo - 1] ?? null) : null
    const via = parentOk && (draft.via === 'a' || draft.via === 'b') ? draft.via : null
    labels.push(via ?? inherited)
  })
  return labels
}

/**
 * 从根走到叶的那些路各有多长（页）。去重升序——共读版有两条路，两支深度差 ≤ 1
 * （`buildTree` 钉着），所以这里最多两个数、而且相邻。
 *
 * 它回答的是孩子读到的长度（"这条路读下来 8 页"），不是表里有多少节点。两者在独读版上
 * 相等，共读版上差着走不到的那一支——而那一支也是要画的，所以界面上那两个数必须分开说
 * （工单 05 §二）。用 `pathFromRoot.length` 而不是自己从 `next` 往下走：路径只有一处算法
 * （`computePaths`），这里再走一遍就是第二个真相。
 */
export function pathLengthsOf(tree: StoryTree): number[] {
  const ends = tree.nodes.filter((node) => node.next.length === 0)
  if (ends.length === 0) return []
  return [...new Set(ends.map((node) => node.pathFromRoot.length))].sort(
    (left, right) => left - right,
  )
}

/** 从根走到某个节点要经过哪些页 —— "走过的路"与"上次你走的是这条路"的数据源 */
export function pathOf(tree: StoryTree, nodeId: string): StoryNode[] {
  const byId = new Map(tree.nodes.map((node) => [node.nodeId, node]))
  const node = byId.get(nodeId)
  if (!node) return []
  return node.pathFromRoot
    .map((id) => byId.get(id))
    .filter((entry): entry is StoryNode => Boolean(entry))
}

/** 独读版的线性读法：按 pageNo 排。共读版按路径读，两者共用这一份数据 */
export function linearOrder(tree: StoryTree): StoryNode[] {
  return [...tree.nodes].sort((a, b) => a.pageNo - b.pageNo)
}
