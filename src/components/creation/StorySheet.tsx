'use client'

/**
 * StorySheet —— 「故事闸门」上那一屏：**故事写好了，先看一遍再画**
 *
 * ```
 *   书名  [《小乐的绿天空》            ]
 *
 *   想让故事怎么变？  [ 结局改成她带着全班一起飞 ]
 *                     [ 让 AI 重写一版 ]   重写会盖掉你手改的地方
 *
 *   第 1 页   正文（念给孩子听的）  [            ]
 *             画面（画出来的）      [            ]
 *             情节（这一页发生什么）[            ]
 *   第 2 页   …
 * ```
 *
 * 它存在的理由是**钱**：出图是这条流水线上唯一真正花钱的一步（实测 ≈154 s/页、
 * 0.2 元/张），而它原来紧跟在编故事后面——家长在读到故事第一个字之前，整本的钱已经花了。
 * 这一屏把那一版故事摊开，让人**在花钱之前**能改。
 *
 * 五条判断，每条都有一个具体的坏法：
 *
 * 1. **三个字段都摊出来，一个都不藏**（正文 / 画面 / 情节）。只给"正文"的话，
 *    家长把"她把天空涂成绿色"改成"她把天空涂成了蓝色"，而画面那一段还是原样——
 *    画出来是绿的，字是蓝的，而屏幕上没有任何东西提示这件事。
 *    ★ 三个框对应的是**引擎真的会读的三段**（`prompts/image.ts` 的
 *      `本页画面 / 情节 / 情绪`），不是我们自己造的三个人话栏目。
 * 2. **受控组件，state 在 `GenerationRun` 里**。底部那颗「就按这个画」在**这一屏之外**
 *    （`.gr__composer`，与运行视图共用同一条），它要拿到家长刚改完的那一份。
 *    在这里存一份、再同步上去，就是同一个值有两个家。
 * 3. **问题就地标出来，也汇总在最上面**。只标在格子上时，第 8 页的问题在屏幕外面
 *    （这一屏有 8–20 页那么长），而家长的判断是"按钮为什么按不动"。
 *    汇总那几条带锚点，点一下跳到那一页。
 *    ★ 判据不是这里算的：`lib/story-problems.ts`（与服务端「就按这个画」那一关
 *      用的是**同一个函数**）。
 * 4. **重写那一段的话写死在这里，且只有一句**：「重写会盖掉你手改的地方」。
 *    只在**手改过**（`dirty`）时出现——没改过的人不需要看这句警告，
 *    而一句常驻的警告读起来像"这个功能有危险"，那不是事实。
 *    ★ 不弹确认框：与书架删除那一次同一条（用户的原话是"就一个确认是否删除，还是算了"）。
 *    重写的代价是**可见的**（改过的地方就在上面），所以一句话够。
 * 5. **`busy` 时整屏只读**（重写中 / 出图中）。改到一半被自己的请求盖回去，
 *    是这类表单最典型也最难查的一种坏法。
 */

import { useMemo, useState } from 'react'

import { describeProblem, type StoryProblem } from '@/lib/story-problems.ts'
import type { StoryDoc } from '@/lib/schemas/story.ts'

export type StorySheetProps = {
  story: StoryDoc
  /** 这一版故事现在有什么问题（空数组 = 可以画）。判据在 `lib/story-problems.ts` */
  problems: readonly StoryProblem[]
  /** 正在重写 / 正在出图：整屏只读 */
  busy: boolean
  /** 家长手改过没有（自动保存那一句要靠它决定说不说"重写会盖掉"） */
  dirty: boolean
  onChange: (next: StoryDoc) => void
  onRewrite: (note: string) => void
}

export default function StorySheet({
  story,
  problems,
  busy,
  dirty,
  onChange,
  onRewrite,
}: StorySheetProps) {
  /** 「想让故事怎么变」那一格。★ 它是**这一屏自己的**状态：它不属于故事，
   *  重写一次之后就没有意义了（所以 `GenerationRun` 重写成功后会把它清掉） */
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

      {/* ── 重写一版 ─────────────────────────────────────────────────────── */}
      <div className="ss__rewrite">
        <label className="ss__label" htmlFor="ss-note">
          想让故事怎么变？
        </label>
        <textarea
          id="ss-note"
          className="ss__input ss__input--note"
          value={note}
          disabled={busy}
          placeholder="比如：结局改成她带着全班一起飞"
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="ss__rewrite-acts">
          <button
            type="button"
            className="ss__rewrite-btn"
            disabled={busy || note.trim() === ''}
            onClick={() => {
              onRewrite(note.trim())
              setNote('')
            }}
          >
            让 AI 重写一版
          </button>
          {/* ★ 只在手改过时说（见文件头第 4 条） */}
          {dirty && <span className="ss__warn">重写会盖掉你手改的地方</span>}
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
          const choiceBad = problemOf('choice')
          return (
            <li className="ss__page" id={`ss-page-${pageNo}`} key={pageNo}>
              <span className="ss__no">第 {pageNo} 页</span>

              <div className="ss__field">
                <label className="ss__label" htmlFor={`ss-body-${pageNo}`}>
                  正文（念给孩子听的）
                </label>
                <textarea
                  id={`ss-body-${pageNo}`}
                  className="ss__input"
                  value={node.body.join('\n')}
                  disabled={busy}
                  rows={2}
                  data-bad={bodyBad ? 'true' : undefined}
                  onChange={(event) => setNode(index, { body: event.target.value.split('\n') })}
                />
                {/* 一行一句：这句话是给家长看的**操作说明**，不是把换行当排版 */}
                <span className="ss__hint">一行一句</span>
                {bodyBad && <p className="ss__bad">{bodyBad.message}</p>}
              </div>

              <div className="ss__field">
                <label className="ss__label" htmlFor={`ss-art-${pageNo}`}>
                  画面（画出来的）
                </label>
                <textarea
                  id={`ss-art-${pageNo}`}
                  className="ss__input"
                  value={node.imagePrompt}
                  disabled={busy}
                  rows={2}
                  data-bad={artBad ? 'true' : undefined}
                  onChange={(event) => setNode(index, { imagePrompt: event.target.value })}
                />
                {artBad && <p className="ss__bad">{artBad.message}</p>}
              </div>

              <div className="ss__field">
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

              {/* 选择点那一类问题（共读版才有）落在这一页上，但界面上没有对应的框——
                  照实说一句，别让它变成一个按不动的按钮 */}
              {choiceBad && <p className="ss__bad">{choiceBad.message}</p>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
