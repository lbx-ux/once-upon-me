import type { Metadata } from 'next'
import Link from 'next/link'
import ReaderBook from '@/components/reader/ReaderBook'
import RotateHint from '@/components/reader/RotateHint'
import { createUserStore } from '@/lib/asset-scope'
import { currentUserId } from '@/lib/auth/session'
import { resolveBook } from '@/lib/book-source'
import { assetRoot } from '@/lib/books-runtime'
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bookId: string }>
}): Promise<Metadata> {
  const { bookId } = await params
  const resolved = await resolveBook(bookId, await readerSlice())
  return {
    title: resolved ? `${resolved.book.tree.title} · 小主角` : '找不到这本书 · 小主角',
  }
}

export default async function ReaderPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params
  const resolved = await resolveBook(bookId, await readerSlice())

  if (!resolved) {
    // 空态要说人话，并给出下一步（工单 04 §四 那张表里的"阅读器没有这本书"那一行）
    return (
      <main className="reader-page">
        <div className="reader-page__empty">
          <h1>找不到这本书</h1>
          <p>
            没有书号 <code>{bookId}</code> 对应的成品。可能是还没生成完，
            或者这一轮被中断了（刷新会打断那条连接）。
          </p>
          {/* ★ 2026-10-17：每本书只属于做它的那个账号（工单 16），所以
              "找不到"多了一个真实成因：**现在登录的不是做它的那个人**。
              上一段列的都是"这本书自己的问题"，这一句说的是"看的人不对"——
              两件事不合并，因为下一步该做的事不一样（等它画完 vs 换回自己的号）。 */}
          <p>如果这一本是你自己做出来的，登录做它的那个账号再看一次。</p>
          <p className="reader-page__actions">
            <Link href="/home">回「创作」做一本</Link>
            <Link href="/">回首页</Link>
          </p>
        </div>
      </main>
    )
  }

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
