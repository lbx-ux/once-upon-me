/**
 * SystemNotice —— 两个 App Router 特殊文件共用的那一张纸
 *
 * `app/error.tsx` / `app/not-found.tsx` 各是一份不到十行的文件，两份都只是把这一层
 * 摆出去、选一档 `kind`。合成一个组件的理由不是省几行：
 * 这两屏回答的是同一类问题（"这一屏现在没有内容，为什么，下一步去哪"），
 * 分成两份就等于把同一张纸的留白、字号、按钮画两遍，而它们一定会漂。
 *
 * ★ 2026-10-20：「正在打开」那一档**拆掉了**（原来还有一档 `kind="loading"`，
 *   `app/loading.tsx` 与 `app/(studio)/loading.tsx` 摆它）。用户原话是
 *   「把这个效果去掉，在每页的加载过程中不要这个」——工作台来回切时那张纸会冒出来
 *   （它的文案是「正在打开这一屏… 工作台这几屏都是每次现读一遍的，慢的时候要等上一两秒」），
 *   而他不要这一下。
 *   去掉的**不是**"等待"本身，是那张纸：两个 `loading.tsx` 删掉之后，
 *   客户端导航期间**旧的那一屏原地留着**，数据到了再换（App Router 在没有
 *   `loading` 边界时就是这个行为），而"正在打开"这件事实由 `AppShell` 那颗
 *   挂在**被点的那一格**上的小转圈说（`useLinkStatus`，120ms 门槛）——
 *   它说得比一张盖住内容区的纸更准。
 *   ★ 为什么两份一起删：只删组内那份的话，根那份会接管工作台的导航 ——
 *   它的边界在**所有 layout 之外**，一显形连侧栏一起换掉（`.scratch/tech-debt/01`
 *   判据 2a 的 `shell=false` 就是这件事）。而留根那份、只删组内那份，正好是最坏的组合。
 *   代价写在 `docs/known-tradeoffs.md`：硬打开一屏 `force-dynamic` 的页面时，
 *   那几十毫秒里看到的是浏览器的白，不再是这张纸（实测云上 TTFB 55–100ms）。
 *
 * 一档 `kind` 管三件事
 *
 *   error    React 抛了 —— 给「重试」（`reset()`）。这是这一档唯一真的有用
 *            的动作，因为它是重挂一次那棵子树，而不是刷新整页。
 *   missing  没有这一页 —— 给两条存在的出口：回首页、翻灵感书单。
 *
 * 文案的两条规矩（与"不糊弄"那一条同源）
 *
 * 1. 不猜原因。 错误页不写"可能是网络问题""请检查磁盘空间"这类话 ——
 *    这个仓库为一句猜出来的下一步付过学费（`asset-write-failed` 那件事：
 *    「一句具体、可执行、且与故障无关的下一步，比没有这句话更坏」）。
 *    这里只说事实（"渲染的时候抛了一个错"）＋ 真实存在的动作（重试 / 回工作台）。
 * 2. 不承诺没验过的事。 不写"你的数据没有丢"——那要另一条判据才敢说。
 * 3. 错误编号照原样给出来。 `error.digest` 是 Next 给这次失败的摘要，
 *    生产环境一个 `console.error` 里就挂着同一个串：把编号显示出来，
 *    用户截图就能让开发者直接定位，而不是靠"刚才那一下"。
 *
 * 这一档铺满视口：错误页与 404 都是"整屏只有这一张纸"，没有壳要留在外面
 * （原来那档 `scope="shell"` 是给工作台内容区用的，它随 loading 一起拆了）。
 */

import Link from 'next/link'

export type NoticeKind = 'error' | 'missing'

export default function SystemNotice({
  kind,
  /** 只有 `error` 用得上：Next 给这次失败的摘要（生产环境才有） */
  digest,
  /** 只有 `error` 用得上：`error.tsx` 的 `reset` —— 重挂那棵子树，不刷新整页 */
  reset,
}: {
  kind: NoticeKind
  digest?: string
  reset?: () => void
}) {
  return (
    <section className="notice" data-kind={kind}>
      <div
        className="notice__paper"
        /* 两档都不用播报：它们是这一屏的内容本身，读屏读到时自然就念出来了 */
      >
        {/* 品牌记号，与首屏 `<h1>` 里那一枚同一个文件（560×560、24 KB，
            工作台那一档的侧栏也在用它，所以基本总是已经在缓存里）。
            `alt=""`：旁边的标题已经把这件事说清楚了，念第二遍是噪音。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="notice__mark" src="/brand/mark.webp" alt="" width={560} height={560} />

        {kind === 'error' ? (
          <h1 className="notice__title">这一页没能打开</h1>
        ) : (
          <h1 className="notice__title">没有这一页</h1>
        )}

        {kind === 'error' ? (
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
        ) : (
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
        )}
      </div>
    </section>
  )
}
