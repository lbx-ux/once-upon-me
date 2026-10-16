'use client'

/**
 * ShelfDashboard —— 书架
 *
 * ---------------------------------------------------------------------------
 * 2026-10-16：这一屏从"仪表盘"改成一排**真的书架**
 *
 * 用户给的是一句要求和一张参考图：「书架就应该像一个真正的书架一样」——
 * 参考图里是一格木头书架，书立着、封面朝外，书名写在每本下面。
 * 同时**划线圈掉了旧版顶部那一整块**（问候语 + 四格统计 + 「只记在这台设备上」
 * 那句 + 「继续上次创作」卡 + 最近/主题模板两个 tab），并说明了"圈里的字都不要了"。
 *
 * 于是这一屏现在的形状只剩两样东西：**一排立着的书** + **一本虚线的新书**。
 *
 * ★ **第二轮（同日）**：第一版把书与板圈在一块 `--card-paper` 的暖纸里（`.shelf__case`，
 *   当书架的背板用，参考图里那格木头书架就是这么个形状）。用户看着那一版圈出右半边说
 *   「和背景有点突兀」——**暖色硬边压在天空背景上太硬**。所以圈撤了，书与板现在直接
 *   落在天光上。这一轮只动"色"，没动"空"（板仍然通长，没缩到书下面）。
 *   记录见 `.scratch/shelf-on-sky/`；`shelf-bookcase/` 那一册已经冻结，不回头改。
 *
 * ★ **第三轮（同日）**：加一个可见的标题 + 右上角那颗「编辑」。
 *   用户的第二句话是「左上角写上"书架"这两个字，和其他保持一致，然后右上角有一个编辑
 *   功能，可以移动多个书籍之间的顺序和删除书籍的功能」。两件事都按选项确认过：
 *   **拖拽换位**（不是左右箭头）、**真删磁盘**（删完"书架底下什么也不要留"）。
 *
 *   | 谁        | 在哪                                                          |
 *   | --------- | ------------------------------------------------------------- |
 *   | 次序      | `shelf/order.json`（`lib/shelf-order.ts`），**服务端**读写     |
 *   | 删除      | `books/<id>/` + 五个档位的缩略图（`lib/book-deletion.ts`）     |
 *   | 标题/编辑 | `header.shelf__head`，与 `/character` 的 `.cw__head` 同版式   |
 *
 *   ★ 这一屏从纯服务端组件变回**客户端组件**了，但"首屏就有内容"这条没退：
 *     App Router 里客户端组件**在服务端也会渲染出 HTML**，而这里的状态是从 props
 *     接过来的（次序由 `shelf/page.tsx` 排好）——没有 `useEffect` 取数、
 *     没有"挂载前后两副面孔"。上次撤掉 `'use client'` 撤的是那两样，不是这三行指令。
 *
 * ★ 删掉的那几块不是"没做出来"，是**做过、量过、然后判断它不该在这一屏**——
 *   免得下一个看到 diff 的人以为丢了一段功能：
 *
 *   | 删掉的              | 它现在在哪                                                       |
 *   | ------------------- | ---------------------------------------------------------------- |
 *   | 四格统计            | 没了。三个数的台账仍在本机（`reading-log.ts`），只是不再摆出来   |
 *   | 「只记在这台设备上」 | 跟着统计一起删——那句话是**为那几个数**写的，数没了它就没有主语   |
 *   | 继续上次创作        | 用户明确选了"彻底不要"（不是搬走、不是改成书签）                 |
 *   | 最近 / 主题模板 tab | 没了。「主题模板」本来是从 tab「推荐」换过来的（工单 05 §一），   |
 *   |                     | 现在按主题进去做书那条路走 `/booklist` —— 那边 12 个主题各一本   |
 *   |                     | 样书，比 12 个只有 emoji 的格子更能说明"点进去会得到什么"        |
 *   | 问候语              | 没了（工单 05 §三讨论过"不写'小宇妈妈'"；这一轮连问候一起去掉） |
 *   | 「我的故事」小标题  | 没了。侧栏那一格就写着「书架」——但现在页头有了可见的「书架」，   |
 *   |                     | 那条"一屏只有一样东西时不必再说一遍"的理由就不再适用了（第三轮）  |
 *
 * ---------------------------------------------------------------------------
 * 书架是怎么摆出来的
 *
 * 用一个 CSS grid（列宽 `--book-w`、行高 `--row-h`，都在 `shelf.css` 里由同一个数
 * 推出来），**搁板本身是容器上的一张平铺背景**——每 `--row-h` 一格，
 * 底部画一条板。这样不论一行摆几本、末行是不是满的，板都是通长的：
 * 一格一格的板各自画，末行就会缩到最后一本书下面，看着像半截货架。
 *
 * ---------------------------------------------------------------------------
 * 编辑模式（第三轮）
 *
 * 两件事：**挪次序**与**删一本**。三条实现上的讲究：
 *
 * 1. **指针捕获挂在 `<ul>` 上，不挂在被拖的那一本上。** 被拖的那一本要拿
 *    `pointer-events: none` —— 否则 `elementFromPoint` 只会永远返回它自己，
 *    "指针现在压在哪一本上面"就永远问不出答案。捕获挂在不会动的容器上，
 *    这条路才走得通。（同一个理由决定了它必须 `position: fixed`：留在流里的话，
 *    次序一变它自己在格子里的位置就跟着变，"跟手"这件事会变成抖。）
 * 2. **触摸上"按封面拖 = 翻页"，"按抓手拖 = 换位"。** `touch-action: none` 只给
 *    抓手那颗按钮：整本书都给的话，手机上编辑模式就再也滚不动了（书多了要往下翻）。
 *    手指按在封面上拖时浏览器会发 `pointercancel`，这一层照单全收——**撤销**，不写盘。
 * 3. **写盘失败要回滚。** 拖完立刻 PUT，失败就把次序退回上一次服务端确认过的那一份，
 *    并在页头底下说一句。让界面留着一个没存上的次序，比当场退回去糟得多：
 *    用户以为存上了，下次打开发现书跳回原位，而中间什么都没提示。
 *
 * ★ 删完之后**页面上什么也不留**（用户的原话："书架底下什么也不要留"）。
 *   那一次删除的"凭据"只活在确认框里，成功了就随着确认框一起消失——
 *   这里不做"最近删除"、不做回执行。（删到一半失败是例外：那不是"留下的记录"，
 *   是必须说的话，见 `shelf__confirm` 那个分支。）
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

import type { BookSummary } from '@/lib/library.ts'
import { moveTo } from '@/lib/shelf-order.ts'

export type ShelfDashboardProps = {
  books: BookSummary[]
}

/** 空态那条线出去的成品书。与首页那颗「看一本成品」是同一本（ADR-0003 的演示书） */
const DEMO_BOOK_ID = 'xiaoyu-r1-4fe055c5723b'

/**
 * 删除凭据的一行（`lib/book-deletion.ts` 的 `DeletionPlace` 的界面版）。
 * ★ 只声明**用得到的**那几个字段：界面不该因为服务端那边多一个字段就要跟着改
 *   （与 `ChildDetail.tsx` 里那个同名的界面版同一条）。
 */
type DeletionPlaceView = {
  place: string
  at: string
  deleted: number
  note?: string
  failed?: string
}

type DeletionReceiptView = {
  bookId: string
  title: string
  places: DeletionPlaceView[]
  totalFiles: number
  stage: 'plan' | 'done'
  complete: boolean
}

/** 拖动的暂态。★ 存在 ref 里而不是 state 里：每 move 一次都重渲染一次就够慢了，
 *  再把"这次拖到哪儿"也塞进渲染循环，等于让 React 替一个手势记账 */
type DragState = {
  pointerId: number
  bookId: string
  /** 按下那一刻的指针位置（视口坐标）与页面滚动量 */
  fromX: number
  fromY: number
  scrollY: number
  /** 按下那一刻那一本的矩形（视口坐标）。之后它就不再参与布局了 */
  rect: { left: number; top: number; width: number; height: number }
}

export default function ShelfDashboard({ books }: ShelfDashboardProps) {
  const router = useRouter()
  const rackRef = useRef<HTMLUListElement | null>(null)
  const confirmRef = useRef<HTMLElement | null>(null)

  /**
   * 书架上现在的次序。**初值就是服务端排好的那一份**（`shelf/page.tsx` 已经按
   * `shelf/order.json` 排过），所以第一帧画出来的就是对的。
   */
  const [order, setOrder] = useState<string[]>(() => books.map((book) => book.bookId))
  const [editing, setEditing] = useState(false)
  /** 正在被拖的那一本 + 它的位移（含拖动期间页面滚动的那一部分）。`null` = 没在拖 */
  const [drag, setDrag] = useState<{ bookId: string; dx: number; dy: number } | null>(null)
  const [confirming, setConfirming] = useState<DeletionReceiptView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 读屏播报（挪了一格之后要能听见自己挪到第几位了） */
  const [announce, setAnnounce] = useState('')

  const dragRef = useRef<DragState | null>(null)
  /** 服务端确认过的次序。写盘失败就退回它，见文件头第 3 条 */
  const savedRef = useRef<string[]>(order)
  const orderRef = useRef(order)
  orderRef.current = order

  /**
   * 服务端给了新的一份（`router.refresh()` 之后、或者另一处删了一本）就跟着走。
   * 依赖用**拼出来的字符串**而不是那个数组：数组每次渲染都是新身份，
   * 用它当依赖会让这一段每渲染一次就跑一次（而那正是"两副面孔"的写法）。
   */
  const serverKey = books.map((book) => book.bookId).join('\u0000')
  useEffect(() => {
    const next = serverKey === '' ? [] : serverKey.split('\u0000')
    setOrder(next)
    savedRef.current = next
  }, [serverKey])

  /**
   * 确认框出来的时候**把它带进视口**。
   *
   * ★ 这是实测出来的一条：书多了以后（探针夹子里九本，两排）确认框挂在整排书的
   *   **下面**，而点 ✕ 的那本书多半在屏幕中间——面板就落在屏幕外面一点。
   *   那时的症状是"点了 ✕ 什么都没发生"，人只会再点一次。
   *   `block: 'nearest'` 是"能看见就够"：它不会为了居中把已经看得到的整屏推走。
   */
  useEffect(() => {
    if (confirming) confirmRef.current?.scrollIntoView({ block: 'nearest' })
  }, [confirming])

  const byId = useMemo(() => new Map(books.map((book) => [book.bookId, book])), [books])
  /**
   * 摆出来的那一列。★ 末尾那一段不是多余的防御：`router.refresh()` 之后`books` 先变、
   * 上面那个 effect 后跑（effect 在绘制**之后**），中间那一帧 `order` 还是旧的那一份——
   * 只认 `order` 的话，新做的那一本会先闪一下不见。补上"order 里没提到的"就没有这一帧。
   */
  const shown = useMemo(() => {
    const listed = order.map((id) => byId.get(id)).filter((book): book is BookSummary => !!book)
    const seen = new Set(listed.map((book) => book.bookId))
    return [...listed, ...books.filter((book) => !seen.has(book.bookId))]
  }, [order, byId, books])

  async function putOrder(next: string[]): Promise<void> {
    const before = savedRef.current
    setOrder(next)
    try {
      const response = await fetch('/api/books', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next }),
      })
      const payload = (await response.json().catch(() => null)) as {
        order?: string[]
        message?: string
      } | null
      if (!response.ok || !Array.isArray(payload?.order)) {
        setOrder(before)
        setError(payload?.message ?? `服务端回了 HTTP ${response.status}，次序没存上。`)
        return
      }
      // ★ 以服务端回的那一份为准（它剪掉了盘上已经没有的书号），别拿本地这份覆盖它
      savedRef.current = payload.order
      setOrder(payload.order)
      setError(null)
    } catch {
      setOrder(before)
      setError('连不上服务端，次序没存上——书架还是原来的排法。')
    }
  }

  /* ── 拖 ─────────────────────────────────────────────────────────────── */

  function onPointerDown(event: ReactPointerEvent<HTMLUListElement>): void {
    if (!editing || dragRef.current || event.button !== 0) return
    const target = event.target as Element
    // 移除那颗按钮不吃这一手（它是"点一下"的动作，不是"拖"的起点）
    if (target.closest('[data-nodrag]')) return
    const li = target.closest('li[data-book-id]')
    const bookId = li?.getAttribute('data-book-id')
    if (!li || !bookId) return
    const rect = li.getBoundingClientRect()
    rackRef.current?.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      bookId,
      fromX: event.clientX,
      fromY: event.clientY,
      scrollY: window.scrollY,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    }
    setDrag({ bookId, dx: 0, dy: 0 })
  }

  function onPointerMove(event: ReactPointerEvent<HTMLUListElement>): void {
    const state = dragRef.current
    if (!state || event.pointerId !== state.pointerId) return
    const dx = event.clientX - state.fromX
    // ★ 滚动量在这一层就算进位移里，渲染那边就不必去读 `window`
    //   （那个渲染在服务端也会跑一遍，`window` 在那儿不存在）
    const dy = event.clientY - state.fromY - (window.scrollY - state.scrollY)
    setDrag({ bookId: state.bookId, dx, dy })

    // 指针底下现在是哪一本？被拖的那一本已经 pointer-events: none，所以问得到别人
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('li[data-book-id]')
    const hitId = hit?.getAttribute('data-book-id') ?? null
    if (hitId && hitId === state.bookId) return

    let target = hitId
    if (!target) {
      // 落在一行的右边空处或两行之间：退到"离指针最近的那一本"。
      // ★ 只按 x 比会在多行时把上面一行的那本抢过来，所以比的是中心距
      let best = Number.POSITIVE_INFINITY
      for (const one of rackRef.current?.querySelectorAll('li[data-book-id]') ?? []) {
        const id = one.getAttribute('data-book-id')
        if (!id || id === state.bookId) continue
        const box = one.getBoundingClientRect()
        const distance =
          (event.clientX - (box.left + box.width / 2)) ** 2 +
          (event.clientY - (box.top + box.height / 2)) ** 2
        if (distance < best) {
          best = distance
          target = id
        }
      }
    }
    if (!target || target === state.bookId) return

    // 插到它前面还是后面：看指针在这一本水平中心的哪一侧（书架是一列一列排的）
    const box = (
      rackRef.current?.querySelector(`li[data-book-id="${target}"]`) as HTMLElement
    )?.getBoundingClientRect()
    const after = box ? event.clientX > box.left + box.width / 2 : true
    setOrder((current) => {
      // ★ 目标位置是"在**去掉被拖的那一本**之后的那一列里"数出来的：
      //   这正是 `moveTo` 的签名（`shelf-order.ts` 里那段注释）
      const rest = current.filter((id) => id !== state.bookId)
      const at = rest.indexOf(target as string) + (after ? 1 : 0)
      const next = moveTo(current, state.bookId, at)
      return next.join('\u0000') === current.join('\u0000') ? current : next
    })
  }

  function onPointerUp(event: ReactPointerEvent<HTMLUListElement>): void {
    const state = dragRef.current
    if (!state || event.pointerId !== state.pointerId) return
    rackRef.current?.releasePointerCapture(event.pointerId)
    dragRef.current = null
    setDrag(null)
    const next = orderRef.current
    // 位置没变就不写盘（点一下也会走到这儿）
    if (next.join('\u0000') !== savedRef.current.join('\u0000')) void putOrder(next)
  }

  /** 浏览器把手势收走了（手机上多半是"判定成翻页"）。★ 撤销，不写盘 */
  function onPointerCancel(event: ReactPointerEvent<HTMLUListElement>): void {
    const state = dragRef.current
    if (!state || event.pointerId !== state.pointerId) return
    dragRef.current = null
    setDrag(null)
    setOrder(savedRef.current)
  }

  /* ── 键盘：正片（拖）之外的等价路径 ─────────────────────────────────── */

  function moveByKey(event: ReactKeyboardEvent, bookId: string, title: string): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const at = orderRef.current.indexOf(bookId)
    if (at < 0) return
    const next = moveTo(orderRef.current, bookId, at + (event.key === 'ArrowLeft' ? -1 : 1))
    if (next.join('\u0000') === orderRef.current.join('\u0000')) return
    setAnnounce(`《${title}》移到了第 ${next.indexOf(bookId) + 1} 位，共 ${next.length} 本`)
    void putOrder(next)
  }

  /* ── 删 ─────────────────────────────────────────────────────────────── */

  /**
   * 第一步：去问"删掉这本书会失去什么"。★ 这一步**一个字节都不动**。
   * 确认框里那句"要失去什么"是取回来的，不是我们写死的——数在服务端
   * （同 `ChildDetail.tsx` 的 `askDeletion`）。
   */
  async function askDeletion(bookId: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}`)
      const payload = (await response.json().catch(() => null)) as {
        receipt?: DeletionReceiptView
        message?: string
      } | null
      if (!response.ok || !payload?.receipt) {
        setError(payload?.message ?? '数不出要删什么。')
        return
      }
      setConfirming(payload.receipt)
    } catch {
      setError('连不上服务端，没能问出要删什么。')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 第二步：真删。
   *
   * ★ 成功之后**页面不留任何回执**（用户的"书架底下什么也不要留"），只把书从架上
   *   拿掉——`router.refresh()` 让服务端那份清单重新读一次。删到一半失败是例外：
   *   那时确认框**留着**，把 `failed` 的位置标出来。那不是"留下的记录"，是必须说的话。
   */
  async function confirmDeletion(bookId: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}`, { method: 'DELETE' })
      const payload = (await response.json().catch(() => null)) as {
        receipt?: DeletionReceiptView
        message?: string
      } | null
      if (payload?.receipt) {
        setConfirming(payload.receipt.complete ? null : payload.receipt)
        if (payload.receipt.complete) router.refresh()
        else setError(payload.message ?? '有些位置没删干净，凭据里标出来了。')
        return
      }
      setError(payload?.message ?? '没删掉。')
    } catch {
      setError('网络断了。删除可能已经发生，也可能没有——刷新这一页看还在不在。')
    } finally {
      setBusy(false)
    }
  }

  /* ── 渲染 ───────────────────────────────────────────────────────────── */

  return (
    <main className="shelf">
      {/* 页头与 `/character` 的 `.cw__head` 同版式：左标题、右动作。
          这一屏的 h1 现在是**可见的**（上一版是 `sr-only` 的「我的书架」——
          那是"一屏只有一样东西时不必再说一遍"的产物，现在页头有了别的东西，
          那条理由就不成立了） */}
      <header className="shelf__head">
        <h1 className="shelf__title">书架</h1>
        <button
          type="button"
          className="shelf__edit"
          data-editing={editing ? 'true' : 'false'}
          aria-pressed={editing}
          onClick={() => {
            setEditing((on) => !on)
            setConfirming(null)
            setError(null)
          }}
        >
          {editing ? '完成' : '编辑'}
        </button>
      </header>

      {error && <p className="shelf__notice">{error}</p>}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <ul
        className="shelf__rack"
        ref={rackRef}
        data-editing={editing ? 'true' : 'false'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {shown.map((book, index) => {
          const dragging = drag?.bookId === book.bookId
          /** 被拖的那一本脱离布局跟着指针走。位置与尺寸都取自按下那一刻 */
          const style =
            dragging && dragRef.current
              ? {
                  position: 'fixed' as const,
                  left: dragRef.current.rect.left,
                  top: dragRef.current.rect.top,
                  width: dragRef.current.rect.width,
                  height: dragRef.current.rect.height,
                  margin: 0,
                  // ★ 见文件头第 1 条：没有这一行，`elementFromPoint` 永远返回它自己
                  pointerEvents: 'none' as const,
                  transform: `translate(${drag.dx}px, ${drag.dy}px)`,
                  zIndex: 3,
                }
              : undefined

          const cover = (
            <>
              <span
                className="shelf__cover"
                style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})` } : undefined}
                data-ready={book.coverUrl ? 'true' : undefined}
              >
                {/* 封面还没到位：一张相纸 + 一枚通用书图标。不留空框、不留裂图 */}
                {!book.coverUrl && (
                  <span className="shelf__glyph" aria-hidden="true">
                    📖
                  </span>
                )}
              </span>
              <span className="shelf__label">
                <span className="shelf__name">{book.title}</span>
                <span className="shelf__meta">
                  {book.pageCount} 页
                  {/* ★ 只有真的有朗读才写这一句。没有的不写"无朗读"——
                      一本没有朗读的书不需要一直在书名旁边道歉（旧版同一条） */}
                  {book.hasNarration && <span className="shelf__audio">有朗读</span>}
                </span>
              </span>
            </>
          )

          return (
            <li
              key={book.bookId}
              data-book-id={book.bookId}
              className="shelf__slot"
              style={style}
              data-dragging={dragging ? 'true' : undefined}
            >
              {editing ? (
                /* 编辑模式下不是链接：点一本书**不许**跳走，整本就是一个可拖的物件。
                   ★ 它是一个 `tabIndex=0` 的普通元素，**不是 `role="button"`**——
                     它按下去没有"动作"，给个按钮的语义会让读屏念一个按了没反应的按钮；
                     左右方向键挪一格这件事由 `aria-label` 说清楚。
                   ★ 抓手那一枚只是**视觉**（`aria-hidden`）：鼠标上整本都能拖，
                     触摸上它靠 `touch-action: none` 把这一小片变成"拖的起点"，
                     这一件事对读屏没有意义，所以它不占一个可聚焦的位置。 */
                <div
                  className="shelf__book"
                  data-draggable="true"
                  tabIndex={0}
                  aria-label={`《${book.title}》，第 ${index + 1} 本，共 ${shown.length} 本：左右方向键挪动`}
                  onKeyDown={(event) => moveByKey(event, book.bookId, book.title)}
                >
                  <span className="shelf__grab" aria-hidden="true">
                    ⠿
                  </span>
                  {cover}
                </div>
              ) : (
                <Link className="shelf__book" href={`/reader/${book.bookId}`}>
                  {cover}
                </Link>
              )}

              {editing && (
                /* 移除那一颗是**真的按钮**（`data-nodrag` 让拖动的 pointerdown 放过它）：
                   它点下去有动作，所以它该有按钮的语义与名字 */
                <button
                  type="button"
                  className="shelf__remove"
                  data-nodrag=""
                  aria-label={`移除《${book.title}》`}
                  onClick={() => void askDeletion(book.bookId)}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              )}
            </li>
          )
        })}

        {/* 末位那本"虚线书"就是这一屏唯一的入口。★ 它是**一本空书**而不是一颗按钮：
            摆在同一排里，它自己说明"这里还差一本"。
            ★ 编辑模式下**不渲染**：它是入口，不是书架上的一本书——
            摆在那儿会让人试着拖它，而它没有位置可言 */}
        {!editing && (
          <li className="shelf__slot">
            <Link className="shelf__book shelf__book--new" href="/create">
              <span className="shelf__cover shelf__cover--new">
                <span className="shelf__plus" aria-hidden="true">
                  ＋
                </span>
              </span>
              <span className="shelf__label">
                <span className="shelf__name">新建故事</span>
              </span>
            </Link>
          </li>
        )}
      </ul>

      {/* 确认框：**先列出要失去什么，再问**（不是"确定吗"）。数字来自服务端那一次预演 */}
      {confirming && (
        <section className="shelf__confirm" aria-label="确认删除" ref={confirmRef}>
          <p className="shelf__confirm-lead">删掉《{confirming.title}》会失去：</p>
          <ul className="shelf__places">
            {confirming.places.map((one) => (
              <li key={one.place} data-failed={one.failed ? 'true' : 'false'}>
                <strong>{one.place}</strong>
                <span className="shelf__place-no">
                  {one.failed ? '没删干净' : one.deleted > 0 ? `${one.deleted} 条` : '没有'}
                </span>
                {one.note ? <span className="shelf__place-note">{one.note}</span> : null}
                {one.failed ? <span className="shelf__place-note">（{one.failed}）</span> : null}
              </li>
            ))}
          </ul>
          <p className="shelf__confirm-warn">删了就找不回来了。</p>
          <div className="shelf__confirm-actions">
            <button
              type="button"
              className="shelf__cancel"
              onClick={() => setConfirming(null)}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              className="shelf__danger"
              onClick={() => void confirmDeletion(confirming.bookId)}
              disabled={busy}
            >
              {busy ? '正在删…' : '确认删掉'}
            </button>
          </div>
        </section>
      )}

      {/* 一本都没有时给一句人话 + 一条能走的路。★ 不放"书架还空着"这种感慨：
          空态要回答的是"那我现在能干什么"，而那本虚线的新书已经是答案的一半 */}
      {books.length === 0 && (
        <p className="shelf__empty">
          还一本都没有。想先看看成品长什么样，可以
          <Link href={`/reader/${DEMO_BOOK_ID}`}>先读一本成品</Link>。
        </p>
      )}
    </main>
  )
}
