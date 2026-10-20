'use client'

/**
 * Fold —— 管理页上「模型配置」那一块的折叠头（2026-10-17）
 *
 * 站长的原话：「这两个做一个下拉框的样式」。★ 后来他自己收了回来：
 * 只有模型配置这一块折（「算了吧，这个不这了，就模型那折就行」）——
 * 权限申请那块当时折出来只有一行"读不到申请列表"，而下面那张没有标题的用户表
 * 看起来才像它的内容。（★ 2026-10-18：权限申请那一块整个拆了，那句话的对象
 * 已经不在了；留下的仍然是这条判断本身——折的是"一整块有自己上下文的配置"，
 * 而不是"一列淡淡的字"。）所以这里现在是 `ModelConfig` 一个消费者，
 * 但组件仍然是独立的一层：那一块的头、箭头、展开态与 localStorage
 * 都不该长在 `ModelConfig.tsx` 里（那个文件已经有四张卡与五条保存路径了）。
 * 那一次讨论留在 [`.scratch/backend-auth/issues/10-admin-fold-and-model-list.md`]。
 *
 * 四条判断：
 *
 * 1. 默认展开。 收起是"我要看下面的"，不是"我看不见这些东西"。
 *    默认收起会把本来一直在的东西藏起来，而第二天进来的人不知道去哪儿找它。
 * 2. 收起的选择记在本机（`localStorage`）。与 `AppShell` 那条侧栏折叠
 *    同一条做法，连"挂载之后才读"这个细节也一样：直接拿它当初值，
 *    服务端与客户端会渲染出两个样子（hydration 不一致）。
 * 3. `<h2>` 里是一颗真按钮（`aria-expanded` + `aria-controls`），内容用
 *    `hidden` 收起来——★ 不是从 DOM 里拿掉。
 *    ★ 这一条我先写反了，值得留在注释里（它的代价不是推出来的，是想清楚才看见的）：
 *      我原来的理由是"那一块挂载时会去拉数据，藏着的 DOM 照旧在发请求"——
 *      那是错的：申请列表是服务端当 prop 递进来的，孩子里没有谁自己拉。
 *      而真按"从 DOM 里拿掉"写，代价立刻出现：`ModelConfig` 那四张卡是孩子，
 *      收起来就卸载——**改到一半的模型名/地址跟着没了**，而且每展开一次就重新拉
 *      四遍模型候选。`hidden` 一条都没有：孩子照旧挂着，值也照旧在。
 *      （实测过：往「模型名」里打一半的字 → 收起 → 展开，那个值还在。）
 *    `hidden` 在这里是硬的：Tailwind preflight 那条
 *      `[hidden]:where(…)` 带 `!important`（`node_modules/tailwindcss/preflight.css`），
 *      所以就算以后有人在 `.adm__fold-body` 上写了 `display`，也盖不过它。
 * 4. 箭头是内联 SVG，不是文字字符（与 `CreateLanding` 那颗同一个理由：
 *    `⌄` 这类字符的形状、字重、基线全跟着系统字体走）。
 *
 * 这一层不管版式：`className` 原样传给外层 `<section>`，
 *   `.adm__models` 那条 margin 与里面的排布一个字没动。
 */

import { useEffect, useState, type ReactNode } from 'react'

export type FoldProps = {
  /** `h2` 与内容区的 id 前缀（`adm-queue` → `adm-queue-title` / `adm-queue-body`） */
  id: string
  /** 标题左边那个名字 */
  title: string
  /** localStorage 里的键。★ 一块一个，改名会让老的选择失效（可以接受） */
  storageKey: string
  /** 标题右边那一两个小东西（待处理计数 / "改完立刻生效"那句话） */
  extra?: ReactNode
  /** 这一块自己的版式类名 */
  className?: string
  children: ReactNode
}

export default function Fold({ id, title, storageKey, extra, className, children }: FoldProps) {
  const [open, setOpen] = useState(true)

  // 挂载后才应用存下来的状态（判断 2：否则首屏会闪，而且 hydration 会不一致）
  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === '0') setOpen(false)
    } catch {
      /* 读不到就用默认值（展开） */
    }
  }, [storageKey])

  const toggle = (): void => {
    setOpen((current) => {
      const next = !current
      try {
        window.localStorage.setItem(storageKey, next ? '1' : '0')
      } catch {
        /* 存不下就算了，这一次会话里照样能收能展 */
      }
      return next
    })
  }

  const titleId = `${id}-title`
  const bodyId = `${id}-body`

  return (
    <section
      className={className ? `adm__fold ${className}` : 'adm__fold'}
      aria-labelledby={titleId}
      // ★ 展开态也给 CSS 一份：收起时头那一行的下边距要收掉（否则两块之间会多出
      //   一段空档，看着像"这里还有东西没展开"）
      data-open={open}
    >
      <h2 className="adm__fold-head" id={titleId}>
        <button
          type="button"
          className="adm__fold-btn"
          aria-expanded={open}
          aria-controls={bodyId}
          // 展开/收起这一个动作要有话说：光靠箭头，读屏与悬停都读不出"点了会怎样"
          title={open ? `收起${title}` : `展开${title}`}
          onClick={toggle}
        >
          <svg className="adm__fold-caret" data-open={open} viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="m4 6.5 4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="adm__fold-name">{title}</span>
          {extra}
        </button>
      </h2>

      {/* ★ 一直挂在 DOM 里，只换 `hidden`（判断 3）：孩子一卸载，
          改到一半的那几格与拉回来的候选就一起没了 */}
      <div className="adm__fold-body" id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  )
}
