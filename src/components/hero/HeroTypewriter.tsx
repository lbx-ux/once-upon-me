'use client'

/**
 * HeroTypewriter —— 一行轮流打出两句主张
 *
 * 为什么合成一行：原来主张句与副句各占一行，竖向空间吃紧。两句正好一长一短，
 * 用打字机轮流播，视觉上只占一句的位置。排版基线沿用 .hero__tagline，
 * 本组件只补「撑宽度 + 实时文字 + 光标」三件事，见 hero-typewriter.css。
 *
 * 三个不显眼但必须对的点：
 *   1. 首帧就是「第一句完整」。服务端渲染与客户端初始 state 完全一致 ——
 *      既不会 hydration 警告，也不会先闪一下完整文字再清空重打。
 *   2. 隐形占位撑住宽度。文案是居中的，若容器跟着文字伸缩，每打一个字整句就左右
 *      抖一次；用一个 visibility:hidden 的最长句把盒子钉死。
 *   3. prefers-reduced-motion 下完全不播，停在第一句完整状态，光标也不闪。
 *
 * 无障碍：动画部分整块 aria-hidden，另给一段 .sr-only 纯文本 —— 屏读拿到的是
 * 完整两句，不会跟着逐字念、也不会每轮循环重念一遍。
 */

import { useEffect, useState } from 'react'

/** 一段连续文字；strong 表示要加粗（加粗的词就是产品的可验证机制） */
export type TextRun = { text: string; strong?: boolean }

export type TypewriterLine = {
  runs: TextRun[]
  /** 打完这句后停留多久再擦掉。默认 DEFAULT_HOLD_MS，长句可以给久一点 */
  holdMs?: number
}

type State = {
  /** 当前这句在 lines 里的下标 */
  index: number
  /** 已打出多少字 */
  count: number
  mode: 'hold' | 'delete' | 'type'
}

const TYPE_MS = 92
const DELETE_MS = 34
const GAP_MS = 360
const DEFAULT_HOLD_MS = 2600

const plainText = (line: TypewriterLine) => line.runs.map((r) => r.text).join('')

const lengthOf = (line: TypewriterLine) => plainText(line).length

/** 按「已打出的字数」切富文本，加粗片段保持加粗 */
function renderRuns(runs: TextRun[], count: number) {
  let remaining = count
  return runs.map((run, i) => {
    const take = Math.max(0, Math.min(run.text.length, remaining))
    remaining -= take
    if (take === 0) return null
    const text = run.text.slice(0, take)
    return run.strong ? <b key={i}>{text}</b> : <span key={i}>{text}</span>
  })
}

function delayOf(s: State, lines: TypewriterLine[]): number {
  if (s.mode === 'hold') return lines[s.index].holdMs ?? DEFAULT_HOLD_MS
  if (s.mode === 'delete') return DELETE_MS
  return s.count === 0 ? GAP_MS : TYPE_MS
}

/** hold → delete → type → hold，循环；纯函数，方便 React 重放 */
function advance(s: State, lines: TypewriterLine[]): State {
  if (s.mode === 'hold') return { ...s, mode: 'delete' }

  if (s.mode === 'delete') {
    if (s.count > 0) return { ...s, count: s.count - 1 }
    return { index: (s.index + 1) % lines.length, count: 0, mode: 'type' }
  }

  if (s.count < lengthOf(lines[s.index])) return { ...s, count: s.count + 1 }
  return { ...s, mode: 'hold' }
}

export function HeroTypewriter({
  lines,
  className,
}: {
  lines: TypewriterLine[]
  className?: string
}) {
  // 初始就是「第一句已打完、正在停留」：与服务端输出一致，无闪烁无 hydration 警告
  const [state, setState] = useState<State>(() => ({
    index: 0,
    count: lengthOf(lines[0]),
    mode: 'hold',
  }))

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => setState((s) => advance(s, lines)), delayOf(state, lines))
    return () => clearTimeout(t)
  }, [state, lines])

  const widest = lines.reduce((a, l) => (lengthOf(l) > lengthOf(a) ? l : a), lines[0])
  const current = lines[state.index]

  return (
    <p className={`hero__tagline hero__typing${className ? ` ${className}` : ''}`}>
      {/* 撑住宽度，永远不可见 */}
      <span className="hero__typing-ghost" aria-hidden="true">
        {renderRuns(widest.runs, lengthOf(widest))}
      </span>

      {/* 覆盖在占位之上，在那个固定宽度内居中 */}
      <span className="hero__typing-live" aria-hidden="true">
        {renderRuns(current.runs, state.count)}
        <span className="hero__typing-caret" />
      </span>

      {/* 屏读与无 JS 的退路：完整两句，不跟着闪 */}
      <span className="sr-only">{lines.map(plainText).join(' ')}</span>
    </p>
  )
}

export default HeroTypewriter
