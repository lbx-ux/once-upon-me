import { redirect } from 'next/navigation'

import AdminScreen from '@/components/admin/AdminScreen.tsx'
import { readOverview } from '@/lib/admin/server.ts'

/**
 * /admin —— 管理页（工作台的一屏，追加工单 09）
 *
 * ★ **服务端取数**（`readOverview`），客户端那半只负责勾选与提交：
 *   权限是一屏"打开就要看全"的表，首屏还得先空着等一次 fetch 的话，
 *   管理员会先看到一屏空的、再看到一屏满的——而中间那一下他可能已经开始点了。
 *
 * ★ 这一页**不在侧栏上无条件出现**：`NAV` 那几格是常量，`/admin` 那一格按角色算
 *   （见 `AppShell`）。这里再兜一道：没权限的人**打得开这个地址**（地址是猜得到的），
 *   所以他看到的必须是"这一屏只有管理员能看"那句话，而不是一片空
 *   ——一片空与"还没有用户"长得一样，而这两件事对管理员的意义完全不同。
 *
 * ★ 没登录的人**重新定向到登录页**，不是给他看那句话：他既不是"没有权限"，
 *   也不该在这一屏上被告知一件与他无关的事。`next` 带的是这一页，
 *   登录完如果他有权限就直接回到这里。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '管理 · 小主角' }

export default async function AdminPage() {
  const result = await readOverview()

  if (result.kind === 'signed-out') {
    redirect(`/login?next=${encodeURIComponent('/admin')}`)
  }

  if (result.kind === 'forbidden') {
    return (
      <section className="adm">
        <h1 className="adm__title">管理</h1>
        <p className="adm__gate" role="alert">
          这一屏只有管理员能看。
        </p>
      </section>
    )
  }

  if (result.kind === 'error') {
    return (
      <section className="adm">
        <h1 className="adm__title">管理</h1>
        {/* ★ 说清是**暂时读不出来**，不是"你没有权限"。这两句话要做的下一步完全不同 */}
        <p className="adm__error" role="alert">
          读不到用户表：{result.message}
        </p>
      </section>
    )
  }

  return <AdminScreen initial={result.overview} />
}
