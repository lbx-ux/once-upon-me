import type { Metadata } from 'next'
import Link from 'next/link'
import CreateFlow from '@/components/creation/CreateFlow'

export const metadata: Metadata = {
  title: '做一本自己的绘本 · 小主角',
  description: '说出孩子的名字和爱好，得到一本以他为主角、用你的声音朗读的定制绘本。',
}

/**
 * /create —— 创作流（W2 的"独读版全链路"前半段）
 *
 * 这一层只做组装，与首页同一条分层约定（README §二）：
 * 页面层负责页面级规则，交互全在组件里。
 *
 * ★ 与首页的关系是**两条独立的页面规则**：首页那条 `min-width: 1280px` 的桌面兜底
 *   写在 `.home-hero` 上（刻意不写 body），所以它不会锁住这一页——
 *   这一页是家长在手机上填的，不需要横向滚动。
 */
export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  // ★ 主页的"主题模板"点进来时带着 `?theme=dino`。在**页面这一层**读它（服务端拿得到，
  //   而且不用为 `useSearchParams` 套 Suspense），再作为**初值**交给创作流——
  //   这样"预填"是一次性的，用户改过之后不会被参数反复覆盖。
  const themeKey = typeof params['theme'] === 'string' ? params['theme'] : undefined
  // ★ 「创作」那一屏的一句话走这个参数进来：它填的是第 2 步的 `wish`，
  //   **不是**另开一条生成路径——两条路径迟早会漂
  const wish = typeof params['wish'] === 'string' ? params['wish'] : undefined
  // ★ 工作台「小主角」那一格挑的卡走这个参数：它预置第 3 步"用一张已有的卡"，
  //   不是新建一条建卡的路。卡号认不出来时创作流会照直走到第 3 步让人现出图，
  //   不会停在一个空白上（见 CreateFlow 里那条 effect）
  const cardId = typeof params['card'] === 'string' ? params['card'] : undefined
  // ★ `?child=`（工单 03 第 4 刀）：第 1 步直接选中一个已有的小主角。
  //   两个参数都由"选中谁"这一件事消化掉——卡上带着 childId，所以它们是同一个人的两种指法
  const childId = typeof params['child'] === 'string' ? params['child'] : undefined
  return (
    <main className="create-page">
      <nav className="create-page__back">
        <Link href="/">← 回首页</Link>
      </nav>
      <CreateFlow
        initialThemeKey={themeKey}
        initialWish={wish}
        initialCardId={cardId}
        initialChildId={childId}
      />
    </main>
  )
}
