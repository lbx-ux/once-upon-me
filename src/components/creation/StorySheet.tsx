'use client'

/**
 * StorySheet —— 「故事闸门」上那一屏：故事写好了，先看一遍再画
 *
 * ```
 *   书名  [《小乐的绿天空》            ]
 *   读下来 8–9 页，一共要画 11 页的图（含走不到的那一支）   ← 共读版才有这一行
 *
 *   想让故事怎么变？  [ 结局改成她带着全班一起飞 ]
 *                     [ 让 AI 重写一版 ]   重写会盖掉你手改的地方
 *
 *   第 1 页   正文（念给孩子听的）  [            ]
 *             画面（画出来的）      [            ]
 *             情节（这一页发生什么）[            ]
 *   第 4 页   …
 *             选择点（这一页分成两条路）        ← 共读版这一页才有
 *               提问  [          ]
 *               选项 A  图标 [🦕][恐龙 ▾]  按钮上的字 [ ]  念出来的 [ ]
 *               选项 B  图标 [⛵][帆船 ▾]  按钮上的字 [ ]  念出来的 [ ]
 *   第 5 页   ▍A 支 · 走「池塘边」那条  选了它的孩子读这 3 页   ← 共读版才有的那条带
 *   第 8 页   ▍B 支 · 走「老槐树」那条  选了它的孩子读这 4 页
 * ```
 *
 * 它存在的理由是钱：出图是这条流水线上唯一真正花钱的一步（实测 ≈154 s/页、
 * 0.2 元/张），而它原来紧跟在编故事后面——家长在读到故事第一个字之前，整本的钱已经花了。
 * 这一屏把那一版故事摊开，让人在花钱之前能改。
 *
 * 六条判断，每条都有一个具体的坏法：
 *
 * 1. 三个字段都摊出来，一个都不藏（正文 / 画面 / 情节）。只给"正文"的话，
 *    家长把"她把天空涂成绿色"改成"她把天空涂成了蓝色"，而画面那一段还是原样——
 *    画出来是绿的，字是蓝的，而屏幕上没有任何东西提示这件事。
 *    三个框对应的是引擎真的会读的三段（`prompts/image.ts` 的
 *      `本页画面 / 情节 / 情绪`），不是我们自己造的三个人话栏目。
 *    2026-10-18（工单 05 §一）选择点那九格也摊出来，理由同一条、更狠：
 *      共读版多出来的那一样，原来是整棵树上唯一改不了的东西（只有一行红字）。
 *      判据用 `isChoicePage()`（引擎那一份），比"树建成了"宽——写了一半的那一页
 *      正是最需要能改的那一页，而树正因为那半页建不起来。
 * 2. 受控组件，state 在 `GenerationRun` 里。底部那颗「就按这个画」在这一屏之外
 *    （`.gr__composer`，与运行视图共用同一条），它要拿到家长刚改完的那一份。
 *    在这里存一份、再同步上去，就是同一个值有两个家。
 * 3. 问题就地标出来，也汇总在最上面。只标在格子上时，第 8 页的问题在屏幕外面
 *    （这一屏有 8–20 页那么长），而家长的判断是"按钮为什么按不动"。
 *    汇总那几条带锚点，点一下跳到那一页。
 *    判据不是这里算的：`lib/story-problems.ts`（与服务端「就按这个画」那一关
 *      用的是同一个函数）。
 * 4. 重写那一段的话写死在这里，且只有一句：「重写会盖掉你手改的地方」。
 *    只在手改过（`dirty`）时出现——没改过的人不需要看这句警告，
 *    而一句常驻的警告读起来像"这个功能有危险"，那不是事实。
 *    不弹确认框：与书架删除那一次同一条（用户的原话是"就一个确认是否删除，还是算了"）。
 *    重写的代价是可见的（改过的地方就在上面），所以一句话够。
 * 5. `busy` 时整屏只读（重写中 / 出图中）。改到一半被自己的请求盖回去，
 *    是这类表单最典型也最难查的一种坏法。
 * 6. ★ 两个数在这一屏上说清（工单 05 §二）：孩子读到的长度，与一共要画多少页的图。
 *    这一屏的整个理由就是"钱还没花"，而共读版多花的那一条支原来在屏幕上完全看不见——
 *    家长看到 9 个页面块，会以为要画的就是 9 页里的这一条路。
 *    只在两个数不一样时才说（独读版相等，说两遍是噪音）；数字的判据在
 *      `lib/story-shape.ts`，与 `problems` 同一个 `buildTree`。
 *    它不承诺"约多一倍"那种倍数：多出来的张数取决于选择点落在第几页、
 *      两支各多长（实跑那次 `--pages=8` 长出 14 个节点、选择点在第 6 页）。
 *      这里给的是这一版的真数。
 * 7. ★ 岔路底下那几页得说得出自己是哪一支（2026-10-18，用户："这个是共读版后面的分支，
 *    后面的内容你一点提示也没有……一点都不明显看上去和独读版一样了"）。
 *    这一屏是 8–20 张卡一路排下来，从选择点往后有一半的卡孩子永远读不到——
 *    而在那之前它们在屏幕上与独读版的页一模一样。现在每一张岔路上的卡：
 *    ① 顶上一条整幅宽的分隔带（`A 支 · 走「池塘边」那条`），两页一组、颜色与
 *       画桌上那条色带同色（A 蓝、B 橙）；
 *    ② 卡片左边那道边跟着变色，滚到哪儿都认得出"这几页是一组"；
 *    ③ 支的第一页上多说一句"选了它的孩子读这 N 页"（N 是真数，从草稿算）。
 *    归属从草稿的 `via` 算（`branchLabelsOf`），不是"选择点之后都算岔路"：
 *      那一版故事有错时树根本建不起来，而那一刻正是家长最需要看清哪几页属于哪一支的时候。
 *    两条支各说一句，不是每页都重复那一句：同一句话抄在四张卡上，
 *      读起来像四件不同的事（这一屏的长短本来就让人累）。
 * 8. ★★ 重写那 101 秒里，屏幕上要有话说（2026-10-18，用户的原话是
 *    「当我输入这个是，前端什么反馈都没有，只是文字我输入文本框的文字消失了，
 *    这样用户怎么知道有没有重新生成故事呢」）。三件事一起改，每件都对应他看见的一处：
 *    ① 那一颗按钮忙起来（`data-busy`）：实心橙 + 一圈荡出去的光 + 呼吸。
 *       原样是"按下去就变淡"，而"变淡"读起来是"这一颗不能用了"——与 `CreateLanding`
 *       那颗优化按钮踩过的是同一个坑（用户当时说"一会浅色一会原色，还以为没成功"）。
 *    ② 家长写的那一句不再一点就清（`onRewrite` 现在回一个 Promise，成了才清）：
 *       他看见的"文字消失了"正是这一句，而重写失败时它还得回来。
 *    ③ 引擎自己那句话摊在按钮旁边（`.ss__rewrite-live`）：`desk.stageLine`
 *       与"这一版没通过校验，正在重写（第 k / N 次）"早就算好了，只是原来一个
 *       读者都没有——画桌在闸门这一屏不渲染（`atGate`），于是那句话无处可去。
 *    判据不是"按钮换了个样子"，是这段等待里屏幕上有没有一句真话：
 *      `.out/probe-rewrite.mjs` 把那条 SSE 请求拦下来（真服务端一个字节都收不到），
 *      量的是按钮的 `data-busy`、按钮旁边那句话、以及框里那句还在不在。
 *      真实那一次是 **101 秒 / 3 次尝试**（`events.jsonl` 六条事件，首尾差 101.48 s），
 *      而屏幕上一个字都没多——这是量出来的，不是推出来的。
 */

import { useMemo, useRef, useState, type ReactNode } from 'react'

import { CHOICE_ICON_LABELS, CHOICE_ICONS } from '@/lib/engine/domain.ts'
import { branchLabelsOf, isChoicePage } from '@/lib/engine/tree.ts'
import { describeProblem, type StoryProblem } from '@/lib/story-problems.ts'
import { shapeLineOf, type StoryShape } from '@/lib/story-shape.ts'
import { useAutosize } from '@/lib/use-autosize.ts'
import type { ChoiceCell, StoryDoc } from '@/lib/schemas/story.ts'

/**
 * 会自己长高的那一格（正文 / 画面 / 想让故事怎么变）。
 *
 * 2026-10-18 用户原话：「这个生成的文本长了，就自己适应一下，把这个文本框拉长，
 *   这件事不要让用户去做」。在那之前每一格都是 `rows={2}` 的固定高度——
 *   模型写四句正文，家长读到的是一格带滚动条的框。
 * ★ 为什么是一个组件而不是在 `story.nodes.map()` 里直接调 hook：hook 不能写在循环里。
 *   每一格要有自己的 `ref`、自己的量高时机，所以它必须是自己的组件
 *   （与 `Desk.tsx` 的 `Figure` 同一个做法）。
 * ★ 它不带自己的样式：class 与"改坏了"那圈描边仍然由调用方给（`.ss__input` 那一套），
 *   这个组件只负责"高到装下内容"这一件事
 */
function AutoTextarea({
  id,
  value,
  disabled,
  bad,
  className = '',
  placeholder,
  onChange,
}: {
  id: string
  value: string
  disabled: boolean
  bad: boolean
  /** 额外的类（比如 `.ss__input--note` 那个最小高度） */
  className?: string
  placeholder?: string
  onChange: (next: string) => void
}): ReactNode {
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutosize(ref, value)
  return (
    <textarea
      id={id}
      ref={ref}
      className={`ss__input ${className}`.trim()}
      value={value}
      disabled={disabled}
      // `rows` 仍然留着：它是没有 JS 时的高度（服务端先渲染出来的就是这个）
      rows={2}
      {...(placeholder === undefined ? {} : { placeholder })}
      data-bad={bad ? 'true' : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export type StorySheetProps = {
  story: StoryDoc
  /** 这一版故事现在有什么问题（空数组 = 可以画）。判据在 `lib/story-problems.ts` */
  problems: readonly StoryProblem[]
  /**
   * 这一版长什么形状（工单 05 §二）：孩子读到的长度 vs 一共要画多少页。
   * 树建不起来（这一版有错）时是 `null`——那一行数字就不出现，
   *   改完自然就有（`lib/story-shape.ts` 回了 null 的判据写在那里）
   */
  shape: StoryShape | null
  /** 正在重写（闸门这一屏只会因为重写而忙：「就按这个画」一点就翻到画桌那一屏了）。
   *  整屏只读——改到一半被自己的请求盖回去，是这类表单最典型也最难查的一种坏法
   */
  busy: boolean
  /**
   * 重写中引擎自己那句话（`desk.stageLine` / "这一版没通过校验，正在重写（第 k / N 次）…"）。
   *
   * 它由 `GenerationRun` 从画桌里取（`planning ?? stageLine`），不是这里编的：
   *   同一句话要能写进日志、进 MCP 返回（`describeEvent` 的纪律），各写一份必然漂。
   * `null` = 还没有一句话可说（请求刚发出去、第一帧还没回来）。那就不渲染——
   *   按钮上"重写中…"已经在说了，旁边再补一句同义的话是噪音（见文件头第 8 条③）
   */
  busyLine: string | null
  /** 家长手改过没有（自动保存那一句要靠它决定说不说"重写会盖掉"） */
  dirty: boolean
  onChange: (next: StoryDoc) => void
  /**
   * 「让 AI 重写一版」。回一个 Promise：`true` = 真的换成了新的一版。
   *
   * 为什么要回值（文件头第 8 条②）：家长写的那一句要到成功才清。
   *   原来是一点就清（`onRewrite(note); setNote('')`），于是失败时他没得可改、
   *   只能重打一遍——而他看得见的那一处变化恰恰就是"字没了"。
   */
  onRewrite: (note: string) => Promise<boolean>
}

/** 选择点那九格里哪一侧的哪一格。★ 两个侧面各写一遍三元的前提：
 *  `tree.ts` 的 `optionOf()` 就是这么取值的（`side === 'A' ? draft.labelA : …`），
 *  这里跟着它——线格式是平铺的，`labelA` / `labelB` 是两个真的字段名。
 */
const OPTION_SIDES = ['A', 'B'] as const

export default function StorySheet({
  story,
  problems,
  shape,
  busy,
  busyLine,
  dirty,
  onChange,
  onRewrite,
}: StorySheetProps) {
  /** 「想让故事怎么变」那一格。★ 它是这一屏自己的状态：它不属于故事，
   *  重写一次之后就没有意义了（所以 `GenerationRun` 重写成功后会把它清掉）
   */
  const [note, setNote] = useState('')

  /** 逐页的问题，按页号分好。整理一次，别在每个格子里 filter 一遍 */
  const byPage = useMemo(() => {
    const map = new Map<number, StoryProblem[]>()
    for (const problem of problems) {
      const list = map.get(problem.pageNo) ?? []
      list.push(problem)
      map.set(problem.pageNo, list)
    }
    return map
  }, [problems])

  /** 整篇的问题（书名、页数）。★ 它们不属于任何一页，硬塞进第 1 页就是编一个位置 */
  const titleProblems = (byPage.get(0) ?? []).filter((one) => one.field === 'title')

  /** 那一行数字（工单 05 §二）。★ 两个数一样时它是 null——独读版就是这样 */
  const shapeLine = shape === null ? null : shapeLineOf(shape)

  /**
   * 每一页属于哪一条支（草稿那一层，见 `branchLabelsOf`）。`null` = 主干。
   *
   * 2026-10-18 用户原话：「这个是共读版后面的分支，后面的内容你一点提示也没有，
   *   用户怎么能知道哪个是什么分支吗，一点都不明显看上去和独读版一样了」。
   *   在那之前这一屏（8–20 张卡一路排下来）从第 7 页起就与独读版长得一模一样——
   *   而其中一半的卡，孩子永远不会读到。家长改的正是那些卡。
   * 不从 `buildTree` 来（那一版故事有错时树根本不存在，而那一刻正是最需要能改的时候）：
   *   平铺草稿上的 `via` 就够（判据在 `engine/tree.ts` 的 `branchLabelsOf`）。
   */
  const branches = useMemo(() => branchLabelsOf(story.nodes), [story.nodes])

  /** 分岔那一页在草稿里的下标。★ 判据与"摊不摊那九个框"是同一个（`isChoicePage`） */
  const forkIndex = story.nodes.findIndex((node) => isChoicePage(node))

  /** 这一条支叫什么（「池塘边」）——取自分岔那一页上家长改过的那两颗按钮 */
  function branchNameOf(side: 'a' | 'b'): string {
    const fork = forkIndex >= 0 ? story.nodes[forkIndex] : undefined
    if (!fork) return ''
    return ((side === 'a' ? fork.labelA : fork.labelB) ?? '').trim()
  }

  /** 这一条支上有几页（家长要看得见"选了它的孩子读多少"） */
  const branchPagesOf = (side: 'a' | 'b'): number => branches.filter((one) => one === side).length

  function setNode(index: number, patch: Partial<StoryDoc['nodes'][number]>): void {
    onChange({
      ...story,
      nodes: story.nodes.map((node, at) => (at === index ? { ...node, ...patch } : node)),
    })
  }

  return (
    <section className="ss" aria-label="这一版故事">
      {/* ── 有问题时先摊在最上面：按钮为什么按不动，答案在这一屏里 ────────── */}
      {problems.length > 0 && (
        <div className="ss__problems" role="status">
          <p className="ss__problems-head">还有 {problems.length} 处要改一改，改完就能画了：</p>
          <ul className="ss__problems-list">
            {problems.slice(0, 8).map((problem, index) => (
              <li key={`${problem.pageNo}-${problem.field}-${problem.line ?? index}`}>
                {/* 有页码的跳到那一页（这一屏有 8–20 页那么长，问题多半在屏幕外） */}
                {problem.pageNo > 0 ? (
                  <a href={`#ss-page-${problem.pageNo}`}>{describeProblem(problem)}</a>
                ) : (
                  describeProblem(problem)
                )}
              </li>
            ))}
            {problems.length > 8 && <li>（另有 {problems.length - 8} 处）</li>}
          </ul>
        </div>
      )}

      {/* ── 书名 ─────────────────────────────────────────────────────────── */}
      <div className="ss__title-row">
        <label className="ss__label" htmlFor="ss-title">
          书名
        </label>
        <input
          id="ss-title"
          className="ss__input ss__input--title"
          value={story.title}
          disabled={busy}
          maxLength={40}
          onChange={(event) => onChange({ ...story, title: event.target.value })}
        />
        {titleProblems.map((problem) => (
          <p className="ss__bad" key={problem.message}>
            {problem.message}
          </p>
        ))}
      </div>

      {/* ── 这一版是什么形状（工单 05 §二）：钱还没花，先让人看见它花在哪儿 ────
          ★ 只在**两个数不一样**时出现（共读版）：孩子读到的长度与要画的页数在
            独读版上相等，说两遍是噪音。判据在 `lib/story-shape.ts` 的 `shapeLineOf` */}
      {shapeLine && (
        <p className="ss__shape" role="status">
          {shapeLine}
        </p>
      )}

      {/* ── 重写一版 ─────────────────────────────────────────────────────── */}
      <div className="ss__rewrite">
        <label className="ss__label" htmlFor="ss-note">
          想让故事怎么变？
        </label>
        <AutoTextarea
          id="ss-note"
          value={note}
          disabled={busy}
          bad={false}
          className="ss__input--note"
          placeholder="比如：结局改成她带着全班一起飞"
          onChange={setNote}
        />
        <div className="ss__rewrite-acts">
          {/* ★ 忙态的整套长相在 `story-sheet.css` 的 `[data-busy='true']` 那一段
              （实心橙 + 荡出去的一圈光 + `cursor: progress`）。
              ★ `data-busy` 与 `disabled` **同时**在：这一颗此时确实按不动（那是真的），
                但要画成"在做事"而不是"不能用"——见文件头第 8 条① */}
          <button
            type="button"
            className="ss__rewrite-btn"
            data-busy={busy ? 'true' : 'false'}
            disabled={busy || note.trim() === ''}
            aria-busy={busy}
            title={busy ? '正在按你写的这句重写整篇' : '按你写的这句让 AI 重写整篇故事'}
            onClick={() => {
              const text = note.trim()
              // 成了才清（文件头第 8 条②）：失败时这一句还在框里，改一改再点一次就行
              void onRewrite(text).then((done) => {
                if (done) setNote('')
              })
            }}
          >
            {busy ? '重写中…' : '让 AI 重写一版'}
          </button>
          {/* ★ 只在手改过时说（见文件头第 4 条）。★ 忙的时候它让位给下面那句话：
              警告说的是"接下来会盖掉什么"，而那时候已经盖下去了 */}
          {!busy && dirty && <span className="ss__warn">重写会盖掉你手改的地方</span>}
          {/* ★ 重写中：引擎自己那句话（见文件头第 8 条③）。
              `role="status"`：读屏也要听得见这一步在做什么，它只看得见按钮上的字 */}
          {busy && busyLine !== null && (
            <span className="ss__rewrite-live" role="status">
              {busyLine}
            </span>
          )}
        </div>
      </div>

      {/* ── 每页三个框 ───────────────────────────────────────────────────── */}
      <ol className="ss__pages">
        {story.nodes.map((node, index) => {
          const pageNo = index + 1
          const pageProblems = byPage.get(pageNo) ?? []
          const problemOf = (field: StoryProblem['field']): StoryProblem | undefined =>
            pageProblems.find((one) => one.field === field)
          const bodyBad = problemOf('body')
          const artBad = problemOf('imagePrompt')
          const sceneBad = problemOf('scene')
          /* 选择点（工单 05 §一）：共读版多出来的那九格
             判据是两个已有判断的并集，不新造第三条：
               ① `isChoicePage()`（引擎那一份）：这一页真的是一个选择点，
                  或者写了一半——树正因为这半页建不起来，而那一页正是最该能改的；
               ② 这一页有 `field === 'choice'` 的问题：schema 报得出来的那几种
                  （比如 `labelA` 被改空了）也归这里——那种残留 `isChoicePage()`
                  认不出，而它是改出来的，必须能改回去。
             认得出是哪一格的失败（`problem.cell`）挂在那一格下面；
               认不出的（`tree.ts` 那句"缺 spokenA…"）挂在整组上，不硬塞进某一格 */
          const choiceHere =
            isChoicePage(node) || pageProblems.some((one) => one.field === 'choice')
          const cellBad = (cell: ChoiceCell) =>
            pageProblems.find((one) => one.field === 'choice' && one.cell === cell)
          const groupBad = pageProblems.find(
            (one) => one.field === 'choice' && one.cell === undefined,
          )
          /* 这一页在哪一条支上（2026-10-18）
             `null` = 主干（包括分岔那一页本身：两条路都要经过它）。
             "支头" = 这一条支上第一页：那一页上多说一句它叫什么名字，
               以及"选了它的孩子读几页"。其余页只有一枚短标签——一句同样的话
               抄在四张卡上，读起来像四件不同的事。 */
          const branch = branches[index] ?? null
          const branchHead = branch !== null && branches.indexOf(branch) === index
          const branchName = branch === null ? '' : branchNameOf(branch)
          return (
            <li
              className="ss__page"
              id={`ss-page-${pageNo}`}
              key={pageNo}
              data-branch={branch ?? undefined}
            >
              {/* ★ 岔路那一行（整幅宽）：它是这一列卡里的**分隔带**，也是"这一页
                  只有一半的孩子会读到"这句话唯一的位置。
                  ★ 放在最前面（`ss__no` 之前）+ `grid-column: 1 / -1`：这样它自己占
                    第一行整幅，页码与三个框照旧从第二行开始排——
                    写在别处会让三格掉进"页码那一列"下面（auto-placement 那条） */}
              {branch && (
                <p className="ss__branch" data-side={branch}>
                  {/* 色块：文字**不染色**（`--select` 蓝在纸上只有 3.87:1，
                      不够正文级那 4.5——令牌表里写着它只能做非文字元素）。
                      所以颜色由这一块与左边那条边承担，字仍然是 `--ink` */}
                  <span className="ss__swatch" aria-hidden="true" />
                  {branch === 'a' ? 'A' : 'B'} 支
                  {branchHead && branchName !== '' && ` · 走「${branchName}」那条`}
                  {branchHead && (
                    <span className="ss__branch-note">
                      选了它的孩子读这 {branchPagesOf(branch)} 页
                    </span>
                  )}
                </p>
              )}
              <span className="ss__no">第 {pageNo} 页</span>

              <div className="ss__field">
                <label className="ss__label" htmlFor={`ss-body-${pageNo}`}>
                  正文（念给孩子听的）
                </label>
                <AutoTextarea
                  id={`ss-body-${pageNo}`}
                  value={node.body.join('\n')}
                  disabled={busy}
                  bad={bodyBad !== undefined}
                  onChange={(next) => setNode(index, { body: next.split('\n') })}
                />
                {/* 一行一句：这句话是给家长看的**操作说明**，不是把换行当排版 */}
                <span className="ss__hint">一行一句</span>
                {bodyBad && <p className="ss__bad">{bodyBad.message}</p>}
              </div>

              <div className="ss__field">
                <label className="ss__label" htmlFor={`ss-art-${pageNo}`}>
                  画面（画出来的）
                </label>
                <AutoTextarea
                  id={`ss-art-${pageNo}`}
                  value={node.imagePrompt}
                  disabled={busy}
                  bad={artBad !== undefined}
                  onChange={(next) => setNode(index, { imagePrompt: next })}
                />
                {artBad && <p className="ss__bad">{artBad.message}</p>}
              </div>

              <div className="ss__field ss__field--wide">
                <label className="ss__label" htmlFor={`ss-scene-${pageNo}`}>
                  情节（这一页发生了什么）
                </label>
                <input
                  id={`ss-scene-${pageNo}`}
                  className="ss__input"
                  value={node.scene}
                  disabled={busy}
                  data-bad={sceneBad ? 'true' : undefined}
                  onChange={(event) => setNode(index, { scene: event.target.value })}
                />
                {sceneBad && <p className="ss__bad">{sceneBad.message}</p>}
              </div>

              {/* ── 选择点：这一页是两条路的分岔口 ────────────────────────
                  ★ 三样东西在这里摊开：**提问**（给家长念的那一句）、
                    以及两个选项各自的**图标 / 按钮上的字 / 念出来的**。
                    它们是孩子在这本书里唯一要做的那个决定——看不见就等于没有。
                  ★ 图标那一格是 emoji + 词表名**两个值**：
                    `iconKey` 决定"有图时画什么"，`emoji` 是**缺图时的兜底**
                    （`lib/choice-icons.ts`）。今天 `CHOICE_ICONS` 里只有
                    `dino` / `ship` 两枚有图（工单 02 出其余那批），所以多数书上
                    按钮露的就是这个 emoji——两个都摆出来，别让人以为选了名就一定有图。
                  ★ 词表之外的旧值**照实显示**（`value` 就是它，选项里标一句"不在词表里"）：
                    静默改成别的 key，等于替家长改了一个他没改过的值 */}
              {choiceHere && (
                <fieldset className="ss__choice">
                  <legend className="ss__choice-head">选择点（这一页分成两条路）</legend>

                  <div className="ss__field">
                    <label className="ss__label" htmlFor={`ss-ask-${pageNo}`}>
                      提问（念给孩子听的那一句）
                    </label>
                    <input
                      id={`ss-ask-${pageNo}`}
                      className="ss__input"
                      value={node.ask ?? ''}
                      disabled={busy}
                      data-bad={cellBad('ask') ? 'true' : undefined}
                      onChange={(event) => setNode(index, { ask: event.target.value })}
                    />
                    {cellBad('ask') && <p className="ss__bad">{cellBad('ask')?.message}</p>}
                  </div>

                  {OPTION_SIDES.map((side) => {
                    const iconCell = side === 'A' ? 'iconA' : 'iconB'
                    const emojiCell = side === 'A' ? 'emojiA' : 'emojiB'
                    const labelCell = side === 'A' ? 'labelA' : 'labelB'
                    const spokenCell = side === 'A' ? 'spokenA' : 'spokenB'
                    const icon = (side === 'A' ? node.iconA : node.iconB) ?? 'generic'
                    const emoji = (side === 'A' ? node.emojiA : node.emojiB) ?? '✨'
                    const inList = (CHOICE_ICONS as readonly string[]).includes(icon)
                    return (
                      <div className="ss__option" key={side} data-side={side.toLowerCase()}>
                        <span className="ss__option-head">选项 {side}</span>

                        <div className="ss__field">
                          <label className="ss__label" htmlFor={`ss-icon-${side}-${pageNo}`}>
                            图标
                          </label>
                          <span className="ss__icon-row">
                            {/* 缺图时按钮上露的就是这一个。`aria-hidden`：读屏念
                                "🦕"没有意义，词表名就在旁边 */}
                            <span className="ss__glyph" aria-hidden="true">
                              {emoji}
                            </span>
                            <select
                              id={`ss-icon-${side}-${pageNo}`}
                              className="ss__select"
                              value={icon}
                              disabled={busy}
                              data-bad={cellBad(iconCell) ? 'true' : undefined}
                              onChange={(event) =>
                                setNode(
                                  index,
                                  side === 'A'
                                    ? { iconA: event.target.value }
                                    : { iconB: event.target.value },
                                )
                              }
                            >
                              {!inList && <option value={icon}>{icon}（不在词表里）</option>}
                              {/* ★ 列的是**中文名**（2026-10-18 用户："这个选项都是英文，
                                  换成中文，避免一些家长不知道"）。`value` 仍然是那个 key——
                                  它才是盘上的文件名与提示词里的值；名字表在 `engine/domain.ts`
                                  的 `CHOICE_ICON_LABELS`，与词表住在一起（加一枚就少不了一个名字） */}
                              {CHOICE_ICONS.map((key) => (
                                <option key={key} value={key}>
                                  {CHOICE_ICON_LABELS[key]}
                                </option>
                              ))}
                            </select>
                          </span>
                          {cellBad(iconCell) && (
                            <p className="ss__bad">{cellBad(iconCell)?.message}</p>
                          )}
                          {cellBad(emojiCell) && (
                            <p className="ss__bad">{cellBad(emojiCell)?.message}</p>
                          )}
                        </div>

                        <div className="ss__field">
                          <label className="ss__label" htmlFor={`ss-label-${side}-${pageNo}`}>
                            按钮上的字
                          </label>
                          <input
                            id={`ss-label-${side}-${pageNo}`}
                            className="ss__input"
                            value={(side === 'A' ? node.labelA : node.labelB) ?? ''}
                            disabled={busy}
                            data-bad={cellBad(labelCell) ? 'true' : undefined}
                            onChange={(event) =>
                              setNode(
                                index,
                                side === 'A'
                                  ? { labelA: event.target.value }
                                  : { labelB: event.target.value },
                              )
                            }
                          />
                          {cellBad(labelCell) && (
                            <p className="ss__bad">{cellBad(labelCell)?.message}</p>
                          )}
                        </div>

                        <div className="ss__field">
                          <label className="ss__label" htmlFor={`ss-spoken-${side}-${pageNo}`}>
                            念出来的
                          </label>
                          <input
                            id={`ss-spoken-${side}-${pageNo}`}
                            className="ss__input"
                            value={(side === 'A' ? node.spokenA : node.spokenB) ?? ''}
                            disabled={busy}
                            data-bad={cellBad(spokenCell) ? 'true' : undefined}
                            onChange={(event) =>
                              setNode(
                                index,
                                side === 'A'
                                  ? { spokenA: event.target.value }
                                  : { spokenB: event.target.value },
                              )
                            }
                          />
                          {cellBad(spokenCell) && (
                            <p className="ss__bad">{cellBad(spokenCell)?.message}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* 认不出是哪一格的那一句（"缺 spokenA…"）挂在整组上——
                      它说的正是"这九格里少了几样"，塞进某一格是编一个位置 */}
                  {groupBad && <p className="ss__bad">{groupBad.message}</p>}
                </fieldset>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
