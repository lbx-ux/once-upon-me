import { redirect } from 'next/navigation'

import AdminScreen from '@/components/admin/AdminScreen.tsx'
import { readModelConfig, readOverview } from '@/lib/admin/server.ts'
import { usageByUser } from '@/lib/admin/usage.ts'
import { readAdminCredits } from '@/lib/credits/server.ts'

/**
 * /admin —— 管理页（工作台的一屏，追加工单 09）
 *
 * 服务端取数（`readOverview`），客户端那半只负责勾选与提交：
 *   权限是一屏"打开就要看全"的表，首屏还得先空着等一次 fetch 的话，
 *   管理员会先看到一屏空的、再看到一屏满的——而中间那一下他可能已经开始点了。
 *
 * 这一页不在侧栏上无条件出现：`NAV` 那几格是常量，`/admin` 那一格按角色算
 *   （见 `AppShell`）。这里再兜一道：没权限的人打得开这个地址（地址是猜得到的），
 *   所以他看到的必须是"这一屏只有管理员能看"那句话，而不是一片空
 *   ——一片空与"还没有用户"长得一样，而这两件事对管理员的意义完全不同。
 *
 * 没登录的人重新定向到登录页，不是给他看那句话：他既不是"没有权限"，
 *   也不该在这一屏上被告知一件与他无关的事。`next` 带的是这一页，
 *   登录完如果他有权限就直接回到这里。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '管理 · 小主角' }

export default async function AdminPage() {
  // 2026-10-18：原来这里是 `Promise.all([readOverview(), readRequests()])`
  //   （用户表与权限申请各一次取数）。申请那一列整个拆掉之后只剩一次，
  //   于是那个 `Promise.all` 也撤了——留着一个单元素的 `all` 只会让下一个人
  //   去找那个不存在的第二次请求。
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

  // 模型配置是在这一步之后才读的：
  //   那份数据里虽然没有 key 的值，但它仍然只该进管理员的进程。
  //   它是本地读一个文件（不发请求），所以"等确认完再读"的代价约等于零。
  //   `readOverview` 已经确认过角色了——非管理员在上面的 `forbidden` 就 return 掉了。
  //
  // 额度那一份（2026-10-30）也在这一步之后：它要带着这张票去打 Java，
  //   而这张票只有确认过是管理员之后才值得花。★ 它读失败**不拦**这一屏
  //   （`kind: 'error'` 原样递进去）：用户表还是能看的，只是额度那几格说一句读不到。
  return (
    <AdminScreen
      initial={result.overview}
      modelConfig={readModelConfig()}
      usage={await usageByUser()}
      credits={await readAdminCredits()}
    />
  )
}
