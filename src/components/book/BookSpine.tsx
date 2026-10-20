'use client'

/**
 * BookSpine —— 右侧那一列刻度
 *
 * 它回答的是"我还要滑多久"。3.4 屏的滚动里这是必须给的东西：
 * 没有它，人不知道后面还有内容，也不知道自己走到哪了。
 *
 * 顺带是可点导航之一（另两处是键盘 ← → 与选择点的两个按钮）：点了就滚到对应那一页。
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
      {/* 当前这一面的短名。填右侧那条留白，顺便回答"我读到哪儿了"——
          3.4 屏的滚动里本来就需要这句话，而光靠五根刻度说不出来。
          ★ 对辅助技术隐藏：上面那个 aria-current="step" 的刻度已经把同一句
            话念过了（「第 2 页：上去了」），再念一遍就是重复。
          ★ key 换掉是为了让元素重新挂载、入场动画重播一次 —— 名字换了而
            文字不跳一下，人不容易注意到刻度旁的说明变了。 */}
      <span className="book-spine__now" key={labels[active]} aria-hidden="true">
        {labels[active] ?? ''}
      </span>
    </nav>
  )
}
