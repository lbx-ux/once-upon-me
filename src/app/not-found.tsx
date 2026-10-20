/**
 * app/not-found.tsx —— 404
 *
 * 两条路都走到这里：
 *   · URL 根本没对上任何路由（Next 自己抛的）；
 *   · 哪一屏里调了 `notFound()` —— 眼下只有 `(studio)/character/[childId]`：
 *     拿一个不存在的孩子进来时，它抛的是 404 而不是画一张"空档案"。
 *
 * 状态码是真的 404（不是 200 带一句"没有这一页"）：那是这一屏唯一
 * 对爬虫与链接检查器说得出口的话。
 *
 * 文案与按钮的理由写在 `components/system/SystemNotice.tsx` 的文件头。
 */

import SystemNotice from '@/components/system/SystemNotice.tsx'

export const metadata = { title: '没有这一页 · 小主角' }

export default function NotFound() {
  return <SystemNotice kind="missing" />
}
