'use client'

/**
 * BookSpine —— 右侧那一列刻度
 *
 * 它回答的是"我还要滑多久"。3.4 屏的滚动里这是**必须**给的东西：
 * 没有它，人不知道后面还有内容，也不知道自己走到哪了。
 *
 * 顺带是这一节唯一的可点导航（除了键盘 ← →）：点了就滚到对应那一页。
 * 静止模式（reduced-motion）下它整块隐藏，翻页交给静态视图自带的 ‹ ›。
 */

export type BookSpineProps = {
  /** 每一格的短名，第 0 格是封面 */
  labels: readonly string[]
  /** 当前在第几面 */
  active: number
  onJump: (index: number) => void
}

export default function BookSpine({ labels, active, onJump }: BookSpineProps) {
  const last = labels.length - 1
  return (
    <nav className="book-spine" aria-label="翻页进度">
      {labels.map((label, i) => (
        <button
          key={label}
          type="button"
          className="book-spine__tick"
          data-on={i === active || undefined}
          aria-label={i === 0 ? '封面' : `第 ${i} 页：${label}`}
          aria-current={i === active ? 'step' : undefined}
          onClick={() => onJump(i)}
        />
      ))}
      <span className="book-spine__count">{active === 0 ? '封面' : `${active} / ${last}`}</span>
    </nav>
  )
}
