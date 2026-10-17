/**
 * phase.ts —— 「从书架点进来的这一本，该落在哪一屏」（纯函数，无 React）
 *
 * ★ 为什么要把它从组件里拔出来：**这一处连着出过两次 bug**，两次都只在真跑时看得见。
 *
 *   1. 2026-10-17 上半场：点「就按这个画」之后阶段轨退回「编故事 还没轮到 ｜ 逐页画 0 / 1」
 *      ——那一支没重放日志，`deskOf` 手上只有一条事件。
 *   2. 2026-10-17 下半场（用户实测）：点完画、从运行视图「退出」、再从书架点回来，
 *      因为这一本还没有 `book.json`，被送回**闸门**：闸门上既看不到进度，
 *      点画又只收到 409「这一本正在画」。他的原话是"他告诉我正在生成中，
 *      我看不到画的什么"。
 *
 *   两回的根都是同一件事：**"该进哪一屏"是从两三样东西推出来的**，而它当时散在
 *   一个 `useEffect` 的分支里。拔成纯函数之后，这几条判据能在 node 里钉住
 *   （`phase.test.ts`），而组件那边只剩"照它说的切"。
 *
 * 判据只有两样：**手上有没有故事草稿**（`story.json`）与**服务端那一刻的状态**
 * （`GET /events` 的 status 帧：`running` 按人算的租约、`bookReady` 看清单在不在）。
 */

/** 这一屏停在哪一段。与 `GenerationRun` 的 `Phase` 同集，但不含 `'planning'`（那是开新书那条路） */
export type EntryPhase = 'story' | 'replaying' | 'ready' | 'failed'

export type EntryStatus = { running: boolean; bookReady: boolean }

export function entryPhaseOf(args: {
  /** 这一本盘上有 `story.json`（= 故事写好了、`book.json` 还没落盘） */
  hasStory: boolean
  /** 读不回日志时是 `undefined`：那时候只能照"手上有什么"判断 */
  status: EntryStatus | undefined
}): EntryPhase {
  // ★ 顺序有讲究，不是随手排的：
  //   1. **书在盘上**（`bookReady`）就进成品那一屏——哪怕同时还有一份故事草稿
  //      （`story.json` 在装订之后**不删**，那一份只是这一本曾经的样子）。
  //   2. 故事在手、服务端**正在跑** → 运行视图。这正是用户那个 bug 那一格：
  //      闸门只留给"真的还没开始画"的那一本。
  //   3. 故事在手、没在跑 → 闸门。
  //   4. 没故事、没跑完、也没在跑 → 这一轮没成（那一屏会说清是为什么）。
  if (args.status?.bookReady) return 'ready'
  if (args.hasStory) return args.status?.running ? 'replaying' : 'story'
  if (args.status?.running) return 'replaying'
  return 'failed'
}
