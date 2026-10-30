import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReaderBook from '@/components/reader/ReaderBook'
import RotateHint from '@/components/reader/RotateHint'
import { createUserStore } from '@/lib/asset-scope'
import { currentUserId } from '@/lib/auth/session'
import { resolveBook, type ResolvedBook } from '@/lib/book-source'
import { assetRoot } from '@/lib/books-runtime'
import { readStory } from '@/lib/story-draft'
import type { AssetStore } from '@/lib/engine/providers/types'

/**
 * /reader/<bookId> —— 独读版阅读器
 *
 * 服务端这一层只做三件事：把书读出来（运行期产物 或 预生成的演示书，
 * 见 `lib/book-source.ts`）、把资产路径算成 URL、把页表交给客户端组件。
 * 交互全在 `ReaderBook` 里。
 *
 * 这一页不做客户端取数：书是磁盘上的一份清单，服务端读完直接渲染，
 *   首屏就有内容（#12 的 LCP 与"零延迟"那条产品主张都吃这一口）。
 *
 * ★ 2026-10-17（用户实测：「纸箱火箭」在书架里看得见、点进来说找不到这本书）：
 *   这一页原来调的是 `resolveBook(bookId)`——它拼的是资产裸根，
 *   而书在 2026-10-17 按人搬进了 `u/<userId>/`（工单 16）。书架那一头读的是
 *   "这个人自己那一片"，所以两头的答案不一样：架子说有、这一页说没有。
 *   现在这一页也先拿到自己那一片再问，与 `/api/assets` 那条路由同一个口径
 *   （图那一头早就是这条口径了——所以原来那本书即使读出来，图也会 404）。
 *
 *   ★ 这里不兜底去扫别人那几片：那等于把工单 16 刚立起来的归属当场拆掉，
 *     而且判据必须只有一条（"有没有"由你自己那一片说了算）。
 *   未登录 → `null` → `resolveBook` 只走演示书那一条，与书架未登录给空架子同一条口径。
 *
 * ★★ 2026-10-21（工单 D-43，评分报告 §2.16 −5）：这一页原来**对三种"读不到"
 *   都回 200**，靠正文里那几句人话去区分它们。内容是对的，状态码是错的——
 *   搜索引擎、探针、以及任何拿状态码做判断的东西，读到的都是"这本书在"。
 *
 *   现在按"**是不是你自己的、还没画完的那一本**"分开处置（`readerStateOf`）：
 *
 * | 盘上（**这个人那一片**里）              | 处置                 | 为什么 |
 * | --------------------------------------- | -------------------- | ------ |
 * | `book.json` 在                          | 正常渲染，200        |        |
 * | 只有 `story.json`（自己的草稿/正在画）  | 200 + 空态           | 它确实在，只是还没画完；而且"刷新会打断那条连接"那句是真的 |
 * | 两样都没有（不存在 / 是别人的）         | `notFound()` → 404   | ★ 顺带**不泄露"存在但不给你看"**：别人的书与不存在的书回同一个码 |
 *
 *   ★ 那条"登录的不是做它的那个人"因此从**空态的文案**里撤掉了：它现在是 404，
 *     而 404 那一屏（`app/not-found.tsx`，那张纸）有自己的两条出口。
 *     留着一句永远不会出现的话，就是把一种处置说成另一种。
 *   ★ 两个判据仍然只有一处：`readerStateOf` 把 `resolveBook` 与"有没有草稿"
 *     合成一个状态，`generateMetadata` 与页面都读它（下一个人的那句提醒见下）。
 */
export const dynamic = 'force-dynamic'

/**
 * 这一屏要读的那一片。★ 抽出来是因为 `generateMetadata` 与页面各调一次
 * `resolveBook`（Next 的两次调用之间没有共享状态），两处必须问同一个人，
 * 否则会出现"标题是这本书、内容说找不到"这种自相矛盾的页面。
 */
async function readerSlice(): Promise<AssetStore | null> {
  const userId = await currentUserId()
  if (!userId) return null
  return createUserStore(assetRoot(), userId)
}

/**
 * 这个书号在**这个人那一片**里是什么（2026-10-21，工单 D-43）。
 *
 * 三种状态，三种处置（见文件头那张表）。合成一个函数是为了让 `generateMetadata`
 *   与页面**问同一件事**：拆成两处各判一次，早晚会出现"标签页说还没画完、
 *   正文说找不到"这种自相矛盾——那正是上面那条注释记着的旧毛病。
 *
 * ★ `'draft'` 的判据是"**我这一片**里有 `story.json` 而 `resolveBook` 读不出清单"：
 *   ①（编故事）一写完 `story.json` 就落盘，②（逐页画）期间它一直在，
 *   所以"正在做"与"做了一半被中断"都落在这里——而这两种对读者的下一步是同一件事
 *   （等，或者回书架看那一栏）。
 */
async function readerStateOf(
  bookId: string,
  slice: AssetStore | null,
): Promise<{ kind: 'book'; resolved: ResolvedBook } | { kind: 'draft' } | { kind: 'missing' }> {
  const resolved = await resolveBook(bookId, slice)
  if (resolved) return { kind: 'book', resolved }
  // 没登录（`slice` 为 null）就没有"我这一片"可言：那本书既不是我的、也不存在
  const mine = slice ? await readStory(slice, bookId) : null
  return mine ? { kind: 'draft' } : { kind: 'missing' }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bookId: string }>
}): Promise<Metadata> {
  const { bookId } = await params
  const state = await readerStateOf(bookId, await readerSlice())
  if (state.kind === 'book') return { title: `${state.resolved.book.tree.title} · 小主角` }
  // ★ 标签页上的这一句要与正文一致（见 `readerStateOf` 那段）
  return { title: state.kind === 'draft' ? '还没画完 · 小主角' : '找不到这本书 · 小主角' }
}

export default async function ReaderPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params
  const state = await readerStateOf(bookId, await readerSlice())

  /**
   * ★ 不存在的、以及别人的，都走这里（工单 D-43）。
   *   两件合成一条出口是刻意的：分开的话，"这个书号存在、只是不给你看"
   *   就成了一件能被问出来的事（同一个码是对"归属"这条纪律的兑现，与
   *   `resolveBook` 不兜底去扫别人那几片是同一条）。
   */
  if (state.kind === 'missing') notFound()

  if (state.kind === 'draft') {
    // 空态要说人话，并给出下一步（工单 04 §四 那张表里的"阅读器没有这本书"那一行）
    return (
      <main className="reader-page">
        <div className="reader-page__empty">
          <h1>这一本还没画完</h1>
          <p>
            书号 <code>{bookId}</code> 的故事已经有了，但还没有画好的成品。
            可能是还在生成，或者这一轮被中断了（刷新会打断那条连接）。
          </p>
          <p className="reader-page__actions">
            <Link href="/shelf">去书架看这一本</Link>
            <Link href="/">回首页</Link>
          </p>
        </div>
      </main>
    )
  }

  const { resolved } = state
  return (
    <main className="reader-page">
      <nav className="reader-page__back">
        {/* ★ 2026-10-19 拆成两段（`reader-page__back-arrow` + `-text`）：
            手机横屏那一档只留那颗箭头（横屏时书几乎占满高，一条带字的长药丸会压到
            书面上 —— 见 `globals.css` 的 §手机横屏）。桌面与竖屏渲染出来的仍是
            「← 再做一本」这一行，一个字都没变。
            两段的读法：箭头 `aria-hidden`（名字由后面那段给），横屏下那段进 `sr-only`
            —— 于是在辅助技术里这条链接**永远**叫「再做一本」，不会变成「左箭头」。 */}
        <Link href="/home">
          <span className="reader-page__back-arrow" aria-hidden="true">
            ←
          </span>
          <span className="reader-page__back-text">再做一本</span>
        </Link>
        {/* 导出打印那一件的入口（2026-10-29）。`?auto=1` 让那一屏到位之后自己弹一次
            打印对话框——从"想打印"这条路进来的人，下一步只可能是它。
            ★ 手机横屏那一档不出现这颗（理由见 `globals.css` 那条媒体查询）。
            ★ 它只在这一屏：分享页（`/r/<票>`）没有这条导航，所以对方手里那条链接
              不会长出"打印"这个入口——那一页给的是"读"，打印是主人自己的事。 */}
        <Link className="reader-page__print" href={`/print/${bookId}?auto=1`}>
          打印 / 存成 PDF
        </Link>
      </nav>
      {/* 竖屏手机进这一屏时那层「把手机横过来」（2026-10-19 移动端适配）。
          ★ 挂在**页面这一层**而不是 `ReaderBook` 里：它管的是"这块屏幕要不要提示"，
            与书是哪一本、是独读还是共读都无关 —— 两台阅读器共用同一层提示，
            写进组件就要写两遍，而两遍迟早会漂成两句话。 */}
      <RotateHint />
      <ReaderBook
        bookId={bookId}
        title={resolved.book.tree.title}
        coverUrl={resolved.coverUrl}
        story={resolved.story}
        source={resolved.source}
      />
    </main>
  )
}
