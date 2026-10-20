'use client'

/**
 * Dialog —— 模态的壳：遮罩、面板、标题栏、底栏、Esc、焦点
 *
 * 抽出来的理由与 `fields.tsx` 那条一样：同一件事只写一遍。
 * 运行视图上有三个模态（"这一本要怎么做" / 重画一页 / 重配一页），
 * 各写一份 `role="dialog"` + 遮罩点击 + Esc + 首焦点 + 面板滚动，
 * 就会有三份会各自漂的"关闭规矩"——而它们必须一模一样，
 * 不然用户在同一个屏幕上会遇到两套习惯（一个 Esc 关得掉、一个关不掉）。
 *
 * 四条它替调用方摁住的事：
 *
 * 1. `role="dialog"` + `aria-modal` + `aria-labelledby`：读屏要能知道
 *    "现在在一个对话框里"，并且念得出它叫什么。少了 `aria-labelledby`，
 *    焦点进去之后读屏只会念第一颗按钮，用户不知道自己在哪个窗口上。
 * 2. 点遮罩关，判据是"点到的是遮罩本身"（`event.target === event.currentTarget`）。
 *    用"没点在面板里"去判，会在面板外边距上误关。
 * 3. Esc 关。只挂 `window`，不挂面板——焦点还没进来时 Esc 也应该关得掉。
 * 4. 打开就把焦点拿进来。否则键盘用户的第一下 Tab 会从文档开头开始走。
 *
 * 它不管"关掉之后焦点还给谁"：那件事只有调用方知道（通常是打开它的那颗按钮）。
 *   壳里猜一个 `<body>` 之类的落点，就把这件本该明确的事变成了一个默认值。
 * 它不管面板里有什么，也不给默认底栏：底栏上有几颗按钮、哪一颗是主按钮，
 *   是每个模态自己的判断（"这一本要怎么做"是取消/确认，重画是取消/重画）。
 */

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

export type DialogProps = {
  title: string
  onClose: () => void
  children: ReactNode
  /** 底栏。必填：没有动作的模态是一个死胡同 */
  footer: ReactNode
  /** 面板的宽度上限。缺省 620（与"这一本要怎么做"同一档） */
  width?: number
  /**
   * 打开时焦点落在谁身上。缺省落在面板自己身上（不是第一颗按钮）：
   * 一进来就把焦点放在"停止重画"上，读屏会先念那颗按钮，
   * 而用户还没听到这个窗口是干什么的。
   */
  initialFocus?: RefObject<HTMLElement | null>
}

export default function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 620,
  initialFocus,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    ;(initialFocus?.current ?? panelRef.current)?.focus()
  }, [initialFocus])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="dlg__backdrop"
      // 点遮罩关。★ 判据是"点到的是遮罩本身"，不是"没点进面板里"——
      //   后者会在面板的外边距上误关（那一下看起来像点到了面板的边上）
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        style={{ maxWidth: `${String(width)}px` }}
        // tabIndex 让它能被聚焦：见 `initialFocus` 那段
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="dlg__head">
          <h2 className="dlg__title" id="dlg-title">
            {title}
          </h2>
          <button type="button" className="dlg__close" onClick={onClose} aria-label="关闭">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="m5.5 5.5 9 9m0-9-9 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="dlg__body">{children}</div>

        <div className="dlg__acts">{footer}</div>
      </div>
    </div>
  )
}
