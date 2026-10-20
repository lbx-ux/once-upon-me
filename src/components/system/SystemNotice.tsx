/**
 * SystemNotice —— 三个 App Router 特殊文件共用的那一张纸
 *
 * `app/error.tsx` / `app/loading.tsx` / `app/not-found.tsx` 各是一份**不到十行**的文件，
 * 三份都只是把这一层摆出去、选一档 `kind`。合成一个组件的理由不是省几行：
 * 这三屏回答的是同一类问题（"这一屏现在没有内容，为什么，下一步去哪"），
 * 分成三份就等于把同一张纸的留白、字号、按钮画三遍，而它们一定会漂。
 *
 * ---------------------------------------------------------------------------
 * 一档 `kind` 管三件事
 *
 *   loading  正在打开 —— 没有动作可做，**故意不给按钮**：这一屏马上就会被换掉，
 *            给一颗"重试"只会让人以为它卡住了。配 120ms 的延迟显形，见下面。
 *   error    React 抛了 —— 给「重试」（`reset()`）。这是这一档唯一**真的有用**
 *            的动作，因为它是重挂一次那棵子树，而不是刷新整页。
 *   missing  没有这一页 —— 给两条**存在的**出口：回首页、翻灵感书单。
 *
 * ---------------------------------------------------------------------------
 * 文案的三条规矩（与"不糊弄"那一条同源）
 *
 * 1. **不猜原因。** 错误页不写"可能是网络问题""请检查磁盘空间"这类话 ——
 *    这个仓库为一句猜出来的下一步付过学费（`asset-write-failed` 那件事：
 *    「一句具体、可执行、且与故障无关的下一步，比没有这句话更坏」）。
 *    这里只说事实（"渲染的时候抛了一个错"）＋ 真实存在的动作（重试 / 回工作台）。
 * 2. **不承诺没验过的事。** 不写"你的数据没有丢"——那要另一条判据才敢说。
 * 3. **错误编号照原样给出来。** `error.digest` 是 Next 给这次失败的摘要，
 *    生产环境一个 `console.error` 里就挂着同一个串：把编号显示出来，
 *    用户截图就能让开发者直接定位，而不是靠"刚才那一下"。
 *
 * ---------------------------------------------------------------------------
 * ★ "正在打开"这一档要晚 120ms 才显形（与 AppShell 的 `PENDING_SHOW_AFTER_MS` 同一条）
 *
 * 工作台来回切的实测是 **45–62ms**（`next.config.ts` 的 `staleTimes` 那一段）。
 * 一个立刻显形的加载态在这条路上只会闪一下 —— 那正是 app-shell.css 给转圈
 * 加 120ms 门槛要躲的那件事，两条必须同一条规矩，否则"点一下导航"会同时
 * 得到一个安静的小转圈和一个闪过去的整屏纸。
 * 延迟写死在 CSS 的 `animation-delay` 里（不是 setTimeout）：
 * 导航比门槛快时这个组件会被整个卸载，定时器那套还得自己收尸。
 *
 * ★ 但它**不是**一个 live region（`role="status"` 只在 `scope="page"` 上给）：
 *   工作台那一档的"正在打开"由 AppShell 的 `sr-only` 说（它挂在被点的那一格上，
 *   说得出"正在打开哪一格"），这里再说一遍就是同一件事念两遍。
 *
 * ---------------------------------------------------------------------------
 * 两种 scope：`page` 铺满视口（`app/loading.tsx`、404、错误页），
 * `shell` 落在工作台的内容区里（`app/(studio)/loading.tsx`）——
 * 那一档**不能**铺满视口：壳（侧栏、顶栏）还在，整屏一张纸会把壳也盖住，
 * 读起来像"整个应用重启了"。
 */

import Link from 'next/link'

export type NoticeKind = 'loading' | 'error' | 'missing'

export default function SystemNotice({
  kind,
  scope = 'page',
  /** 只有 `error` 用得上：Next 给这次失败的摘要（生产环境才有） */
  digest,
  /** 只有 `error` 用得上：`error.tsx` 的 `reset` —— 重挂那棵子树，不刷新整页 */
  reset,
}: {
  kind: NoticeKind
  scope?: 'page' | 'shell'
  digest?: string
  reset?: () => void
}) {
  const inShell = scope === 'shell'

  return (
    <section className="notice" data-kind={kind} data-scope={scope}>
      <div
        className="notice__paper"
        /* 「正在打开」这一档在页面这一级自己说一句：那一档没有别人替它播报
           （工作台那一档有 AppShell 的 `sr-only`，见文件头）。其余两档也不用播报 ——
           它们是这一屏的内容本身，读屏读到时自然就念出来了。 */
        role={kind === 'loading' && !inShell ? 'status' : undefined}
      >
        {/* 品牌记号，与首屏 `<h1>` 里那一枚同一个文件（560×560、24 KB，
            工作台那一档的侧栏也在用它，所以基本总是已经在缓存里）。
            `alt=""`：旁边的标题已经把这件事说清楚了，念第二遍是噪音。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="notice__mark" src="/brand/mark.webp" alt="" width={560} height={560} />

        {kind === 'loading' ? (
          <p className="notice__title">{inShell ? '正在打开这一屏…' : '正在打开…'}</p>
        ) : kind === 'error' ? (
          <h1 className="notice__title">这一页没能打开</h1>
        ) : (
          <h1 className="notice__title">没有这一页</h1>
        )}

        {kind === 'loading' ? (
          <p className="notice__lead">
            {inShell
              ? '工作台这几屏都是每次现读一遍的，慢的时候要等上一两秒。'
              : '第一次打开这一页要从服务器把它取回来。'}
          </p>
        ) : kind === 'error' ? (
          <p className="notice__lead">
            页面在渲染的时候抛了一个错，所以没有画出来。可以先重试一次；
            还不行的话回工作台，从那一屏再进来一遍。
          </p>
        ) : (
          <p className="notice__lead">地址可能输错了，或者这一页已经不在了。</p>
        )}

        {digest ? (
          <p className="notice__meta">
            错误编号 <code>{digest}</code>
            <span className="notice__meta-hint">把它截图给开发者，能直接定位到这次失败</span>
          </p>
        ) : null}

        {kind === 'error' ? (
          <div className="notice__actions">
            <button type="button" className="notice__btn" onClick={reset}>
              重试
            </button>
            <Link className="notice__btn notice__btn--ghost" href="/home">
              回到工作台
            </Link>
          </div>
        ) : kind === 'missing' ? (
          <div className="notice__actions">
            <Link className="notice__btn" href="/">
              回到首页
            </Link>
            {/* ★ 落点是 `/booklist`（12 本已经做好的样书），与首页那颗「看一本成品」
                同一处：404 的人多半是想看点东西，而这一页**真的存在**。
                不写"返回上一页"那种按钮：这一屏可能就是从书签直接打开的，
                没有上一页可回（`history.back()` 掉出去比不指更难看）。 */}
            <Link className="notice__btn notice__btn--ghost" href="/booklist">
              翻一本成品
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  )
}
