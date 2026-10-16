'use client'

/**
 * ResumeLastRun —— 裸着访问 `/create` 时，把人送回"刚才那一本"（工单 05 §六）
 *
 * 为什么它是一个客户端组件而不是页面层的一句 `redirect('/home')`：
 * **书号存在 `sessionStorage` 里**，服务端读不到。而"刷新之后要能接着看"这件事
 * 只有在这一层能做（`lib/creation/last-run.ts` 的 `readLastRun`）。
 *
 * ★ 找不到就回 `/home`，而**不是**在这一屏摆一个"还没开始"的空态：
 *   这一屏没有"这一轮"就无事可做，而"写一句话"只有一个地方能写
 *   （`/home` 那张纸）。摆一个空表单在这里，就是从第二天起开始漂的第二条路径。
 * ★ 用 `router.replace` 不是 `push`：中间那一跳不该进历史，
 *   否则用户按一次"后退"会回到这个什么都不做的中转页，再按一次才到上一屏。
 */

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { readLastRun } from '@/lib/creation/last-run.ts'

export default function ResumeLastRun() {
  const router = useRouter()

  useEffect(() => {
    const bookId = readLastRun()
    router.replace(bookId ? `/create?book=${encodeURIComponent(bookId)}` : '/home')
  }, [router])

  // 跳转发生在一帧之内，所以这句话几乎看不见。★ 但它**不能空着**：
  // 一个什么都不画的中转页在慢网络下就是一片白，而"白屏"与"坏了"分不出来
  return (
    <section className="gr">
      <p className="gr__sub" role="status">
        正在找回刚才那一本…
      </p>
    </section>
  )
}
