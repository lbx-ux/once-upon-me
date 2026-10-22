'use client'

/**
 * RunComposer —— 运行视图底部那一条：只读产出 + 按状态变的那一颗（2026-10-21，工单 D-34 拆出）
 *
 * 它原来长在 `GenerationRun.tsx` 的 JSX 末尾（那一个 default export 当时 773 行）。
 * 拔出来的理由是那一条上**每一个元素都在按四五样状态各自变**，而这些判断
 * 与"这一轮跑到哪儿了"没有关系 —— 它们只读已经算好的事实。
 *
 * ★ 样式沿用 `generation-run.css` 里那一块 `gr__*`，**不新开一个同名 css**：
 *   它是**同一屏的一个片段**，不是另一个组件 —— 与同目录的 `ResumeLastRun.tsx`
 *   同一个做法（那一个用的是同一块里的 `.gr` / `.gr__sub`）。一个 BEM 块拆到
 *   两个样式表里，下一次改版式就得记住"这两处是一块"。
 *
 * 三处文案的判断都在纯模块里（`run-composer-lines.ts`，有测试）：这一格说什么、
 * 那行小字说不说、「退出」那颗按钮悬停时说哪一句。这里只负责把它们摆上去。
 */

import Link from 'next/link'

import { exitTitleOf, saveLineOf, storyLineOf } from './run-composer-lines.ts'
import type { Phase } from './phase.ts'
import type { SaveState } from './use-story-autosave.ts'

export type RunComposerProps = {
  /** 家长当初写的那一句话（愿望优先）。`null` = 这一条路没有它 */
  written: string | null
  atGate: boolean
  published: boolean
  phase: Phase
  saveState: SaveState
  /** `working === 'illustrating'`：正在出图 */
  illustrating: boolean
  /** 「就按这个画」亮不亮（判据来自 `problems`，与服务端那一关同一个函数） */
  canDraw: boolean
  /** 按不动的原因（`storyProblemText(problems)`）。`null` = 没问题，按得动 */
  problemText: string | null
  /** 整本画完了、可以装订 */
  ready: boolean
  /**
   * 画面审核判了 `flag` 的页码（升序）。非空时「确定生成」按不动。
   *
   * ★ 2026-10-21 晚：用户问「预警中的词汇都出现了，为什么还有生成出来」——
   *   引擎那边的策略是**保留那一页 + 标 `needsHumanReview`**（删掉一页会让书破一个洞，
   *   而这一档审核只是兜底，不是判据，见 `.scratch/safety` 工单 01 §三）。
   *   但"标了"这件事此前只在运行时的事件流里出现过，刷新就没了，生成也照旧可点。
   *   所以这里把它做成一颗**按不动的按钮**：先重画那几页，再生成。
   */
  flaggedPages?: readonly number[]
  /** 单页重做正忙（那一颗要跟着禁用） */
  busy: boolean
  onIllustrate: () => void
  onConfirm: () => void
}

export default function RunComposer({
  written,
  atGate,
  published,
  phase,
  saveState,
  illustrating,
  canDraw,
  problemText,
  ready,
  busy,
  flaggedPages = [],
  onIllustrate,
  onConfirm,
}: RunComposerProps) {
  const saveLine = saveLineOf(saveState)

  return (
    <footer className="gr__composer">
      <div className="gr__composer-inner">
        {/* ★ **始终只读**，而且这里没有"改一句"的入口：那句话进了书号指纹
            （`bookIdOf` 用的是 card + form + theme），改了就是另一本书。
            要改走右边那条出口，它明说"这会丢掉这一本"。 */}
        <p className="gr__story">
          {storyLineOf({ written, atGate, published })}
          {/* 自动保存那行小字。★ 只在闸门那一屏说，且只在有话说时说
              （`idle` 那一档它回 `null`） */}
          {atGate && saveLine && (
            <span className="gr__save" data-state={saveState} role="status">
              {saveLine}
            </span>
          )}
        </p>
        <div className="gr__composer-acts">
          {/* ★ 这一颗说的是它真正做的事：**离开这一屏**（不是"重做一本"——
              那句话本身在骗人，来历见 `run-composer-lines.ts` 的 `exitTitleOf`）。
              ★ 去 `/shelf` 而不是 `/home`：用户接下来要处理的是**这一本** */}
          <Link className="gr__exit" href="/shelf" title={exitTitleOf({ phase, atGate })}>
            退出
          </Link>
          {/* ★ 闸门那一屏上这一颗是**另一个动作**（就按这个画），所以它不是
              「确定生成」的禁用态：那两件事之间隔着"要不要花这笔钱"。
              ★ 按不动时把原因写在 `title` 上：屏幕上那句"还有 N 处要改一改"
                说的是同一件事，两处都不是哑的 */}
          {atGate ? (
            <button
              type="button"
              className="gr__primary"
              data-tone="go"
              disabled={!canDraw}
              title={problemText ?? '按这一版故事开始画'}
              onClick={onIllustrate}
            >
              {illustrating ? '开始画了…' : '就按这个画'}
            </button>
          ) : (
            <button
              type="button"
              className="gr__primary"
              data-tone={published ? 'done' : ready && flaggedPages.length === 0 ? 'go' : 'busy'}
              disabled={!ready || busy || published || flaggedPages.length > 0}
              title={
                flaggedPages.length > 0
                  ? `第 ${flaggedPages.join('、')} 页有内容审核的提醒，先重画它们再生成`
                  : undefined
              }
              onClick={onConfirm}
            >
              {published
                ? '已装订'
                : flaggedPages.length > 0
                  ? '先重画再生成'
                  : ready
                    ? '确定生成'
                    : '创作中'}
            </button>
          )}
        </div>
      </div>
    </footer>
  )
}
