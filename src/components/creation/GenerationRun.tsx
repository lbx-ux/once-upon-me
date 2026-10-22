'use client'

/**
 * GenerationRun —— 运行视图：一句话进去，一页一页出来（工单 05）。
 *
 * 四个阶段串起来是这样：①编故事 —— ②逐页画 —— ③配音 —— ④装订（阶段轨从事件推，4 格）；
 * 书名与「k / N 页画好了」在上面那一行。2026-10-17 起，故事先摊出来给家长过一遍（闸门那一屏：
 * 书名可改、「想让故事怎么变？」输入框、「让 AI 重写一版」、每页的正文/画面/情节三格），
 * 点「就按这个画」之后才换成画桌（`Desk.tsx`，一格一张图），底部那条是只读产出加一颗
 * 「确定生成」。
 *
 * ★ 2026-10-21（工单 D-34）：这个文件原来是 945 行的**一个** default export
 *   （一个函数 773 行，SSE 消费 + 自动保存状态机 + 六档 phase 渲染 + 轮询 + 五个动作
 *   全在里面，边界全是局部闭包）。现在它只做两件事：**把六块拼起来**、**渲染**。
 *   六块各自的去处与它们守的东西：
 *
 * | 原来在这里的东西                      | 现在在哪                            |
 * | ------------------------------------- | ----------------------------------- |
 * | SSE 消费、画桌折叠、书号、那句硬失败   | `use-run-stream.ts`                 |
 * | 会花钱的五个出口（重写 / 开画 / 装订 / 重做一页 / 开弹窗） | `use-run-actions.ts` |
 * | 自动保存那台状态机（`SaveState`）      | `use-story-autosave.ts`             |
 * | 阶流不在时的轮询                      | `use-run-poll.ts`                   |
 * | 六档 phase 那一句主句                 | `run-phase-lines.ts`（纯函数）       |
 * | 底部那三句话                          | `run-composer-lines.ts`（纯函数）    |
 *
 *   ★ 拆的判据不是"行数好看"：`use-run-stream.ts` 的文件头记着那个 `sink`
 *     —— "一串事件 → 画桌"原来在四处各抄一遍，而这一屏出过的两个 bug 都长在
 *     "有一处漏了重算"上。文件行数只是那件事的化验单。
 *   ★ 这一屏剩下的 state 有一个共同点：**它们是"这一屏这一次会话"的东西**
 *     （家长手上那份故事、改过没有、正在重写/正在画、装订了没有）。
 *     凡是从事件流推得出来的，都不在这里（那是 `deskOf` 的事）。
 *
 * 六条判断（拆之前就写在这里的，一条都没有变），每条都有一个具体的坏法：
 *
 * 1. 阶段轨是 4 格，不是原型里那 5 个节点。引擎的核对是每页画完立刻比的，做成节点会 20 页
 *    闪 40 次——而那个闪烁只说明我们在数事件。核对是某一页的事，它留在那一格的 `note` 上。
 *    推导在 `frames.ts` 的 `railOf`，不在这个组件里：那是会错的那一半，它必须能在 node 里
 *    被钉住（`frames.test.ts` 钉着它）。
 * 2. 2026-10-17 改了：故事正文现在可以改，而且改的位置有讲究——在闸门那一屏
 *    （`StorySheet`）改，改完点「就按这个画」，②才开跑。这一屏之前写的是"故事正文永远只读，
 *    它进了书号指纹，改了就是另一本书"，那句话说错了一半：`bookIdOf` 拼的是
 *    `card|revision|form|theme`，正文从来不在里面（改了正文，书号不变——这正是这道闸门能
 *    成立的前提）。真正成立的那一半是：主题在指纹里，所以"改一个字的主题 = 另一本书"。
 *    ★ 而"运行期间不许改"这一条没有变：②开跑之后（`illustrating` 起），故事仍然是只读的
 *      ——那时候每一页都在花钱，一个能改的入口会让人以为"改了就不用重跑"。所以闸门是一道门，
 *      不是一个随时能开的抽屉。
 * 3. 单页重做只在整本做完之后解锁。用户的原话是"在此期间用户不能修改"，理由同上一条。
 * 4. 每一帧重新派一次整张画桌（`deskOf(events)`）。看着像浪费，但它是幂等的：只扫一遍事件、
 *    同一页覆盖同一格，所以第 k 帧的结果只取决于前 k 条事件。增量维护省下的是几十次循环，
 *    换来的是"同一页重画算一格还是两格"这种判断散进 setState 里——而那正是
 *    `frames.test.ts` 现在钉住的东西。（★ 2026-10-21：这句话现在只在 `use-run-stream.ts`
 *    里成立一次，见那个文件头的 `sink`。）
 * 5. 刷新之后要能接着看。这一轮的指针存进 `sessionStorage`（只有书号，任何凭据都不进那里），
 *    刷新后回来重放。★ 但它不再是唯一一条路：草稿在书架上有位置（工单 03），那才是被放弃
 *    之后还找得回来的那一条。记这一笔的时机在编完故事那一刻（原来是 `book-ready`）——
 *    闸门那一屏可能停很久，而它刷新之后必须回得来。
 *    而"停在闸门上"这一支也要读一遍日志：闸门那一屏的正文确实来自 `story.json`，但阶段轨
 *    前两格读的是 `desk`（书名与格数都由①的 `plan-ready` 说了算，而那条事件只在日志里）。
 *    不读的话，点「就按这个画」之后第一帧一到，桌子就被折成"编故事 还没轮到 ｜ 逐页画
 *    0 / 1"——这是实测抓出来的。
 *    同理，书名以 `story` 为准（`withStoryTitle`）：家长在闸门上改了书名，而②的事件里没有
 *    新书名，所以折出来的桌子会一直顶着①那一版旧的。
 * 6. 改了的故事自动存（`use-story-autosave.ts`）。理由与那一段静默期的来处都在那边。
 */

import { useMemo, useState } from 'react'
import { storyProblemsOf, storyProblemText } from '@/lib/story-problems.ts'
import { storyShapeOf } from '@/lib/story-shape.ts'
import type { StoryDoc } from '@/lib/schemas/story.ts'

import Desk from './Desk.tsx'
import RunComposer from './RunComposer.tsx'
import RedrawDialog from './RedrawDialog.tsx'
import RevoiceDialog from './RevoiceDialog.tsx'
import StorySheet from './StorySheet.tsx'
import { railOf, storyDeskOf, withStoryTitle, type RailNode } from './frames.ts'
import { phaseLineOf } from './run-phase-lines.ts'
import { useRunActions } from './use-run-actions.ts'
import { useRunPoll } from './use-run-poll.ts'
import { useRunStream, type RunPlan, type RunResume } from './use-run-stream.ts'
import { useStoryAutosave } from './use-story-autosave.ts'

export type { RunPlan, RunResume }

export type GenerationRunProps = {
  /** 新做一本：进来就开始跑（只跑①编故事，见 `createBook`） */
  plan?: RunPlan
  /** 接着做一份已经在盘上的：进哪一条路由 `story` 决定 */
  resume?: RunResume
}

export default function GenerationRun({ plan, resume }: GenerationRunProps) {
  /* ── 六块 ─────────────────────────────────────────────────────────────
     依赖方向：流在下（它最早知道自己成了没有），动作与草稿在它上面。 */

  /** 这一份故事是**家长手上**的那一份（闸门那三个框改的就是它），不属于"这一轮跑到哪儿了" */
  const [story, setStory] = useState<StoryDoc | null>(resume?.story ?? null)
  /** 家长手改过没有。★ 它决定重写那颗按钮旁边说不说"会盖掉你手改的地方" */
  const [dirty, setDirty] = useState(false)
  /** 正在重写一版 / 正在逐页画。★ 与单页重做那个 `busy` 分开：粒度不一样 */
  const [working, setWorking] = useState<'rewriting' | 'illustrating' | null>(null)
  const [published, setPublished] = useState(resume?.published ?? false)

  const stream = useRunStream({
    plan,
    resume,
    onStory: setStory,
    // 2026-10-21 晚：进度那一行不再报页数（"已写 k / N 页"整个换成了"正在思考中"），
    //   所以这里也不再递分母——理由见 `plan-lines.ts` 的 `writingLineOf`
  })
  const {
    desk,
    setDesk,
    phase,
    setPhase,
    fatal,
    note,
    serverRunning,
    setServerRunning,
    bookId,
    sink,
    writing,
    loadRunPages,
    runPages,
  } = stream

  /**
   * 画面审核说"有不该出现的东西"的那几页（2026-10-21 晚）。
   *
   * ★ 只认 `flag`：`unavailable` 是"没审成"（视觉那一格没配、或调用失败），
   *   拿它拦生成等于"没配视觉模型的书永远发不出去"——那是另一件事。
   * 这份数据来自 `book.json`（`runPagesOf`），所以**刷新之后还在**；
   *   在那之前这句话只活在运行时的事件流里，一刷新就没了。
   */
  const flaggedPages = runPages
    .filter((page) => page.review?.verdict === 'flag')
    .map((page) => page.pageNo)
    .sort((a, b) => a - b)

  const { saveState, setSaveState } = useStoryAutosave({
    bookId,
    story,
    dirty,
    // 重写一开始这个 effect 的 cleanup 就把计时器清掉（见 `use-story-autosave.ts` 文件头）
    enabled: phase === 'story' && working === null,
  })

  useRunPoll({ bookId, serverRunning, phase, sink, setServerRunning, setPhase, loadRunPages })

  const actions = useRunActions({
    plan,
    resume,
    stream,
    story,
    setStory,
    setDirty,
    working,
    setWorking,
    setPublished,
    setSaveState,
  })
  const { busy, editor, editingPage, rewrite, illustrate, confirm, rerun, openEditor } = actions

  /* ── 这一屏的推导 ─────────────────────────────────────────────────── */

  /** 配音开没开。★ 它不是从 `narrations` 推的——为空有两种成因（不做 / 没做成），
   *  混淆它们会把一次失败说成一个选择（见 `Book.voiceId`）。
   *  它是一条推导，不是 state：这一屏中途不会换音色（换要回 `/home` 重做一本），
   *    给它一个 setter 就是给一个不存在的变化留一个门 */
  const voiceOn = resume ? resume.voiceOn : plan?.voiceId !== undefined
  /** 形态：新做一本由调用方给，接着做从盘上那一份读 */
  const bookForm = resume?.bookForm ?? plan?.bookForm ?? 'solo'

  /**
   * 闸门那一屏的问题（书名 / 每页三个框）。
   * 判据不是这里算的：`lib/story-problems.ts` 与「就按这个画」那一关
   *   用的是同一个函数（那边在 `illustrate/route.ts` 里再跑一遍）。
   *   所以按钮亮不亮与服务端收不收永远是一致的——这正是把它做成纯函数的目的。
   */
  const problems = useMemo(() => (story ? storyProblemsOf(bookForm, story) : []), [story, bookForm])

  /**
   * 这一版故事长什么形状（工单 05 §二）：孩子读到的长度 vs 一共要画多少页。
   * ★ 与上面那条同一个 `buildTree`（各算一份的症状是"闸门说 8 页、书里 9 页"）。
   *   树建不起来时它是 `null`——那一行数字就不出现，改完自然就有。
   */
  const shape = useMemo(() => (story ? storyShapeOf(bookForm, story) : null), [story, bookForm])

  /**
   * 屏幕上那一张桌子。与 `desk` 只差一件事：书名以 `story` 为准（见
   * `frames.ts` 的 `withStoryTitle`）。
   *
   * 家长在闸门那一屏改了书名、点「就按这个画」之后，②每回一帧都把 `desk` 折回
   *   ①那一版书名（事件里没有新书名）。上面那个大标题与阶段轨都读它，
   *   所以这两个地方必须一起看这一份，不能一个读 `desk` 一个读 `shownDesk`。
   * `story` 为 null 时它是 `desk` 本人（同一个对象），已经画完的那一本从书架
   *   进来走的正是这一条——那一刻日志就是唯一事实。
   */
  const shownDesk = useMemo(() => withStoryTitle(desk, story), [desk, story])

  /**
   * 阶段轨。★ 重写那一段要手改一格（2026-10-18，与用户那句"前端什么反馈都没有"
   * 是同一件事的一半：屏幕上在做的事，轨道说已经做完了）。
   *
   * `railOf` 只认 desk 里已经成立的事实，而「编故事」那一格的判据是书名在不在
   * （`plan-ready` 说的）。重写时书名有两个来源、都指向上一次：
   * ① desk 里那条旧的 `plan-ready`——`rewrite` 已经把它截掉了；
   * ② 手上这一份 `story`——`withStoryTitle` 会把书名从它那儿取回来
   *    （那一条本是为"家长改了书名再点画"写的，这里正好被它盖住）。
   * 于是那一格会一直写着「已完成」，而屏幕上正在做的恰恰是它。
   *
   * 所以这里按 `working` 说，而不是再从 desk 里推：重写在请求发出去的那一刻
   *   就是确定的事实（按钮的忙态、那一行主句都按它说），与 `illustrate` 点下去先
   *   `setPhase('running')` 是同一条——"点下去就是在做这件事了"，不是推断。
   * 只动这一格：其余三格（逐页画 / 配音 / 装订）在重写期间本来就该是"还没轮到"。
   */
  const rail = useMemo(() => {
    const nodes = railOf(shownDesk, voiceOn)
    if (working !== 'rewriting') return nodes
    return nodes.map((node): RailNode =>
      node.key === 'planning' ? { ...node, state: 'now' } : node,
    )
  }, [shownDesk, voiceOn, working])

  /**
   * 服务端这一轮还在跑。★ 它是 `Desk` 那条进度条上要不要扫过一道光的唯一依据，
   * 而这件事只有拿着连接的这一方知道：画桌上的事件只说明"走到哪儿了"，
   * 一轮跑完与一轮卡住，在事件流里长得一模一样。
   *
   * 判据是 `serverRunning`（`/api/books/<id>/events` 的 `status` 帧说的"这个书号
   *   此刻在不在跑"），不是 `phase === 'replaying'`。这一条是探针抓出来的：
   *   拿 phase 当判据时，重跑一本已经存在的书（同一个书号、清单还在盘上）会让
   *   `bookReady` 为真 → phase 判成 `'ready'` → 光不扫。而那一刻屏幕上明明有一格在画、
   *   进度条也在长——"清单在盘上"与"这一轮跑完了"是两件事，phase 把它们合成了一件。
   * `phase === 'running'` 那一半仍然要留着：那一轮是我们自己发起的，还没有 status 帧。
   */
  const live = phase === 'running' || serverRunning
  const ready = phase === 'ready'
  /** 闸门那一屏开着吗。★ 到时候画桌不渲染：那一屏的正文是 `StorySheet` */
  const atGate = phase === 'story' && story !== null
  /** 闸门那一屏整屏只读（重写中 / 出图中） */
  const gateBusy = working !== null
  /** 「就按这个画」亮不亮。★ 判据来自 `problems`（与服务端那一关同一个函数） */
  const canDraw = atGate && !gateBusy && problems.length === 0

  /** 这一屏上最大的一行字（六档各一句，优先级见 `run-phase-lines.ts`） */
  const phaseLine = phaseLineOf({
    phase,
    atGate,
    rewriting: working === 'rewriting',
    published,
    serverRunning,
  })

  /**
   * 重写中那颗按钮旁边要说的一句话：引擎自己的话（`deskOf` 折出来的，见 `frames.ts`）。
   *
   * 两个来源，优先级是有讲究的：
   *   ① `desk.planning` —— "这一版故事没通过校验，正在重写（第 k / N 次）：…"。
   *      它是最该看见的那一句：重写一次里模型常要试 2–3 遍（实测那一次 3 遍、
   *      101 秒），家长等的这段时间里屏幕上只有它说得出"还在动，动到第几遍了"；
   *   ② `desk.stageLine` —— "正在编故事…"，第一帧到、还没有重试之前的那一句。
   * `null` = 一句话都还没有（请求刚发出去）：那一格就不渲染，
   *   按钮上"重写中…"已经在说这件事了。
   */
  const rewriteLine = working === 'rewriting' ? (shownDesk.planning ?? shownDesk.stageLine) : null

  /** 底部那一格：家长当初写的那句话（`null` = 这一条路没有它，见那个纯函数） */
  const written = plan ? plan.form.theme.wish.trim() || plan.form.theme.theme.trim() : null

  return (
    <section className="gr">
      {/* ── 阶段轨 ─────────────────────────────────────────────────────── */}
      <ol className="gr__rail" aria-label="创作进度">
        {rail.map((node) => (
          <li key={node.key} className="gr__node" data-state={node.state}>
            <span className="gr__dot" aria-hidden="true">
              {node.state === 'done' ? '✓' : ''}
            </span>
            <span className="gr__name">{node.label}</span>
            {/* ★ `k / N` 是真数（`drawnCount` / `desk.total`），不是另编的百分比条 */}
            {node.note && <span className="gr__note">{node.note}</span>}
            {/* 读屏要能听见每一格是什么状态——颜色与圆点它看不见 */}
            <span className="gr__sr">{RAIL_SR[node.state]}</span>
          </li>
        ))}
      </ol>

      <h1 className="gr__title">
        {shownDesk.title
          ? `《${shownDesk.title}》`
          : phase === 'failed'
            ? '这一本没做出来'
            : '开始创作中'}
      </h1>
      {/* 这一屏上最大的一行字。★ 六档各一句、以及每一句的来历都在
          `run-phase-lines.ts`（纯函数、有测试：优先级与"不许出现数字"都钉着） */}
      <p className="gr__sub" role="status">
        {phaseLine}
      </p>

      {(fatal ?? shownDesk.fatal) && (
        <p className="gr__error" role="alert">
          {fatal ?? shownDesk.fatal}
        </p>
      )}
      {note && (
        <p className="gr__error" role="alert">
          {note}
        </p>
      )}

      {/* ── 闸门那一屏：故事摊开给家长改（工单 12） ───────────────────────── */}
      {atGate && story && (
        <StorySheet
          story={story}
          problems={problems}
          shape={shape}
          busy={gateBusy}
          busyLine={rewriteLine}
          dirty={dirty}
          onChange={(next) => {
            setStory(next)
            setDirty(true)
            // 之后的存盘由 `use-story-autosave` 排（它看 `dirty` 与 `story`）
            setSaveState('idle')
            // 书名改了，上面那个大标题与阶段轨要跟着走（那是同一份数据的两种显示）
            setDesk(storyDeskOf(next))
          }}
          onRewrite={(rewriteNote) => rewrite(rewriteNote)}
        />
      )}

      {/* ── 画桌：出了闸门才出现 ─────────────────────────────────────────── */}
      {!atGate && (
        <Desk
          desk={shownDesk}
          published={published}
          live={live}
          writing={writing}
          // 判了失败就不再摆"正在…"（失败那一屏上出现过"没做出来"与"正在重写"并存）
          failed={phase === 'failed'}
          {...(bookId
            ? {
                actions: {
                  ready: ready && !busy,
                  voiceOn,
                  busy,
                  // 点下去先开弹窗（工单 08），不直接发请求——见 `openEditor`
                  onRerun: openEditor,
                },
              }
            : {})}
        />
      )}

      {/* ── 底部那条：这一轮那句话（只读）+ 按状态变的那一颗 ───────────────
          整块在 `RunComposer.tsx`：那上面每一个元素都在按四五样状态各自变，
          而那些判断与"这一轮跑到哪儿了"没有关系 */}
      <RunComposer
        written={written}
        atGate={atGate}
        published={published}
        phase={phase}
        saveState={saveState}
        illustrating={working === 'illustrating'}
        canDraw={canDraw}
        problemText={storyProblemText(problems)}
        ready={ready}
        busy={busy !== null}
        flaggedPages={flaggedPages}
        onIllustrate={() => void illustrate()}
        onConfirm={() => void confirm()}
      />

      {/* 两个弹窗（工单 08）。★ 挂在最后、与 `/home` 那个"这一本要怎么做"同一处规矩：
          它们是**整屏**的模态，不属于任何一块内容 */}
      {editor?.kind === 'image' && editingPage && (
        <RedrawDialog
          page={editingPage}
          busy={busy !== null}
          onCancel={() => actions.setEditor(null)}
          onConfirm={(fixNote) => void rerun(editingPage.pageNo, 'image', { fixNote })}
        />
      )}
      {editor?.kind === 'audio' && editingPage && (
        <RevoiceDialog
          page={editingPage}
          busy={busy !== null}
          onCancel={() => actions.setEditor(null)}
          onConfirm={(body) => void rerun(editingPage.pageNo, 'audio', { body })}
        />
      )}
    </section>
  )
}

/** 每一格的读屏说法。★ 颜色与圆点读屏看不见，所以状态要有一句话 */
const RAIL_SR: Record<string, string> = {
  todo: '还没轮到',
  now: '正在做',
  done: '已完成',
  skipped: '这一本不做',
  partial: '没做全',
}
