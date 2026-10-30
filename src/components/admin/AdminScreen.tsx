'use client'

/**
 * AdminScreen —— 管理页那一屏（工单 09 + 2026-10-17 那四条动作）
 *
 * 用户 2026-10-16 选的方案：一屏最小管理页 = 列出所有人 + 当场改一个人的权限；
 * 2026-10-17 追加了四条对账号的动作（建号 / 停号 / 删号 / 重置别人的密码）。
 *
 * 2026-10-18：那一排四个开关收成一格（`ACCESS_COLUMN`）。用户的原话是
 *   「登录之后就可以使用各种模型了，不用站长分配……后面的选项就变为是否有权限，
 *   默认注册的用户都有权限」。所以这一屏上"权限"这件事只剩一个问题：
 *   站长有没有把这个人收回去。
 *   同一天拆掉的还有两样：那一列权限申请（默认给上之后没有人需要申请，
 *   而「帮助」里那个唯一的入口整条删了），以及演示账号那句"四个能力全开"。
 *
 * 五条判断，每条都有一个具体的后果：
 *
 * 1. 点一下就是一次提交（全量一位），没有"保存"按钮。
 *    提交期间只禁用那一行，不是整页：管理员改的是"这个人"，不是整个人群。
 *    失败时把那一格改回去并说一句（服务端一早就会拒，不只是网络问题——
 *      403 是"你的管理员身份在这中间被撤了"，那一条更要当场看见）。
 *
 * 2. 权限改完不需要对方重新登录（`GET /api/auth/me` 每次从库里读），
 *    所以这一屏上不需要任何"记得告诉他重登一次"的提示——那会是假的。
 *    把这件事写在页头，是因为它是这一屏唯一一件看不见但成立的事。
 *    而停号是例外：那一步会顺手顶掉密码代次，他手上那些票当场作废
 *      （见 `AdminService#setStatus`）。两句话都得说，因为它们是相反的。
 *
 * 3. 注册开关是只读的。★ 刻意的：一个能改"钱从哪儿出"的开关不该是网页上一个按钮。
 *    要改就动服务器上的 `/etc/xiaozhujue/api.yml`。这里显示它，是为了让人
 *    知道现在的状态——而不是让人从这里改。
 *
 * 4. 演示账号那一行要标出来。它的口令是公开的、四个能力全开，
 *    所以"谁在花我的钱"这个问题的答案里，第一行就是它。登录名由后端给
 *    （`demoAccount`），不在前端写死。★ 它的删号按钮是禁用的（不是藏起来）：
 *    `AccountSeeder` 每次启动都会把它补回来，"删掉它"是一次会自己撤销的动作。
 *    按钮禁用并把原因写在 `title` 上，比按下去弹一句错好——也解释了为什么别人能动它。
 *
 * 6. ★ 「作品」那一列的数来自磁盘，不是来自这条接口（2026-10-17 工单 16）。
 *    它由服务端算好后作为一个 prop 递进来（`usage`），不跟着这里的刷新走：
 *    改权限、停号都不会改变一个人做过几本书，所以刷新回来的那几行照旧按 userId
 *    查同一张表。把它塞进接口响应里的话，Java 就得知道磁盘——那正是这一单要拆开的东西。
 *
 * 5. 危险动作一律要二次确认（删号），而且确认框里写的是那个人的账号
 *    而不是"确定吗"：这一屏的一行与另一行长得几乎一样，而删号不可逆。
 *    ★ 停号不要确认：它是可逆的，而一个可逆的动作每次都要多点一下，
 *      会让人对确认框变得麻木——那正好会毁掉删号那一次确认的作用。
 */

import { useCallback, useState } from 'react'

import ModelConfigPanel from '@/components/admin/ModelConfig.tsx'
import CreditsPanel, { type CreditsSeed } from '@/components/admin/CreditsPanel.tsx'
import { createUser, deleteUser, resetPassword, setAllowed, setStatus } from '@/lib/admin/client.ts'
import {
  ACCESS_COLUMN,
  shortTimeOf,
  usageTextOf,
  type AdminOverview,
  type AdminUsage,
  type AdminUser,
} from '@/lib/admin/state.ts'
import type { ModelConfigView } from '@/lib/settings/model-config-state.ts'

function nameOf(user: AdminUser): string {
  if (user.nickname.trim() !== '') return user.nickname.trim()
  if (user.phone) return `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}`
  return user.account
}

export default function AdminScreen({
  initial,
  modelConfig,
  usage,
  credits,
}: {
  initial: AdminOverview
  /** 模型配置（服务端读好的，见 `admin/page.tsx`） */
  modelConfig: ModelConfigView
  /** 每个人做了多少东西，按 userId（服务端数完磁盘给的）。缺一个人就是数不出来 */
  usage: Record<string, AdminUsage>
  /**
   * 额度与兑换码那一块的总账（2026-10-30）。
   * ★ 与用户表分开取（`readAdminCredits`）：额度读不出来不该让整张用户表消失，
   *   反过来也一样——两件事的下一步不同（一个是"去查 Java"，一个是"去查权限"）。
   */
  credits: CreditsSeed
}) {
  const [users, setUsers] = useState<AdminUser[]>(initial.users)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ userId: string; text: string; bad: boolean } | null>(null)

  /**
   * 一次改动的统一收尾：照服务端回的那一行整行替换。
   *
   * 四条动作（权限开关 + 停号 + 重置密码 + 建号）都回"这个人现在的样子"，
   *   所以它们的收尾是同一步。自己把本地状态改成新的样子的话，一次失败
   *   （或者服务端顺手动了别的字段）会留下一个"我以为我改成了"的假象，
   *   而它看起来完全正常——这正是 `admin/state.ts` 里那条注释说的那件事。
   */
  const settle = useCallback((userId: string, text: string, row: AdminUser, bad = false) => {
    setUsers((all) => all.map((item) => (item.userId === userId ? row : item)))
    setNote({ userId, text, bad })
  }, [])

  const flip = useCallback(
    async (user: AdminUser) => {
      if (busy) return
      const next = !user.allowed
      const before = user.allowed
      setBusy(user.userId)
      setNote(null)
      // 先把那一格改成新位置（点一下就有反应），失败再改回来——失败时说清是哪一步
      setUsers((all) =>
        all.map((item) => (item.userId === user.userId ? { ...item, allowed: next } : item)),
      )

      const result = await setAllowed(user.userId, next)
      if (result.ok) {
        settle(user.userId, `${nameOf(user)}：${next ? '可以创作了' : '权限收回了'}`, result.data)
      } else {
        setUsers((all) =>
          all.map((item) => (item.userId === user.userId ? { ...item, allowed: before } : item)),
        )
        setNote({ userId: user.userId, text: `没改成：${result.message}`, bad: true })
      }
      setBusy(null)
    },
    [busy, settle],
  )

  /** 停号 / 复号。★ 不要二次确认（可逆），但要说清"当场生效"（见文件头第 2 条） */
  const toggleStatus = useCallback(
    async (user: AdminUser) => {
      if (busy) return
      const next = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
      setBusy(user.userId)
      setNote(null)

      const result = await setStatus(user.userId, next)
      if (result.ok) {
        settle(
          user.userId,
          next === 'DISABLED'
            ? `${nameOf(user)}：停用了，他这会儿登着的会话已经掉了`
            : `${nameOf(user)}：恢复了，他现在可以登录`,
          result.data,
        )
      } else {
        setNote({ userId: user.userId, text: `没改成：${result.message}`, bad: true })
      }
      setBusy(null)
    },
    [busy, settle],
  )

  /** 重置密码。★ 口令由站长当场输，服务端不生成也不回显（见 `admin/client.ts`） */
  const askReset = useCallback(
    async (user: AdminUser) => {
      if (busy) return
      const password = window.prompt(
        `给「${user.account}」设一个新密码（至少 6 位）。\n他心里那个旧密码会立刻失效，他手上登着的会话也会掉。`,
      )
      // 取消（null）与空串都不是"我要设一个空密码"，两种都直接不做事
      if (!password) return

      setBusy(user.userId)
      setNote(null)
      const result = await resetPassword(user.userId, password)
      if (result.ok) {
        settle(user.userId, `${nameOf(user)}：密码换了，他得用新的这个登进来`, result.data)
      } else {
        setNote({ userId: user.userId, text: `没改成：${result.message}`, bad: true })
      }
      setBusy(null)
    },
    [busy, settle],
  )

  /**
   * 删号。★ 确认框里写的是那个人的账号（文件头第 5 条）。
   *
   * 成功时没有那一行可回（响应是 204），所以这里是从列表里去掉它，
   *   而不是替换——与另外四条不同，这一条之后没有"这个人现在的样子"可以显示。
   */
  const askDelete = useCallback(
    async (user: AdminUser) => {
      if (busy) return
      if (!window.confirm(`真的要删掉「${user.account}」这个账号？删了就回不来了。`)) return

      setBusy(user.userId)
      setNote(null)
      const result = await deleteUser(user.userId)
      if (result.ok) {
        setUsers((all) => all.filter((item) => item.userId !== user.userId))
        setNote({ userId: user.userId, text: `删掉了 ${user.account}`, bad: false })
      } else {
        setNote({ userId: user.userId, text: `没删成：${result.message}`, bad: true })
      }
      setBusy(null)
    },
    [busy],
  )

  return (
    <section className="adm">
      <header className="adm__head">
        <div>
          <h1 className="adm__title">管理</h1>
          {/* ★ 这一屏唯一两件"看不见但成立"的事：权限每次从库里读，所以改完不用让对方
              重新登录；而**停号是当场把他踢下线**。两句都得说——它们是相反的。
              ★ 这里不许出现 Markdown 的星号：它是 JSX 里的**普通文本**，
                写 `**粗体**` 出来就是两个字面的星号（2026-10-17 实测撞上的）。
                要强调就用 `<b>`，别借 Markdown 的语法——那只在 .md 文件里成立。 */}
          <p className="adm__sub">
            关掉一个开关，那个人<b>下一次点开始创作</b>就生效，不用重新登录。 停用则是<b>当场</b>
            把他登着的会话踢掉。
          </p>
        </div>
        {/* ★ 短信用量 + 注册开关。★ 注册开关**只读**，理由见文件头第 3 条 */}
        <dl className="adm__stats">
          <div>
            <dt>今天发出的验证码</dt>
            <dd>
              {initial.smsToday}
              <span className="adm__cap"> / {initial.smsDailyCap}</span>
            </dd>
          </div>
          <div>
            <dt>新用户注册</dt>
            <dd>{initial.registrationOpen ? '开着' : '已关闭'}</dd>
          </div>
        </dl>
      </header>

      <NewUser
        onDone={(row) => {
          // 建完插到最前面：`overview` 是按注册时间倒序的，新号本来就该在第一行。
          //   而"重取一次"会让站长刚改好的别的东西闪一下
          setUsers((all) => [row, ...all])
          setNote({
            userId: row.userId,
            text: `建好了 ${row.account}（默认有创作权）`,
            bad: false,
          })
        }}
      />

      <ModelConfigPanel initial={modelConfig} />

      {note ? (
        <p className="adm__note" data-bad={note.bad ? 'true' : undefined} role="status">
          {note.text}
        </p>
      ) : null}

      {/* ★ 2026-10-19：这里原来有一行手机专用的提示（「← 左右滑动看全表 →」）。
          用户要求删掉，**web 与移动端都不写**。删的理由比"用户不想要"更硬：
          它是一句**替表格解释自己**的话 —— 表格右边缘切在屏幕边上、还能横着滚，
          本来就该由表格自己读出来（真滑一下就有回弹与滚动条），
          而不是在它上面再压一行小字。`admin.css` 里那两条 `.adm__scrollhint`
          一并删了，别留一段没人用的样式（理由同 `.pf__section` 那条）。 */}

      <div className="adm__tablewrap">
        <table className="adm__table">
          <thead>
            <tr>
              <th scope="col">账号</th>
              <th scope="col">昵称</th>
              <th scope="col">注册</th>
              <th scope="col">上次登录</th>
              <th scope="col">作品</th>
              {/* ★ 2026-10-18：四列（文字/图像/视觉/语音）收成一列「权限」。
                  它问的不再是"他能用哪几项"，而是"站长有没有把他的权限收回去" */}
              <th scope="col" className="adm__th--cap">
                {ACCESS_COLUMN.label}
                <span className="adm__th-hint">{ACCESS_COLUMN.hint}</span>
              </th>
              <th scope="col">账号</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isDemo = initial.demoAccount !== null && user.account === initial.demoAccount
              const off = user.status === 'DISABLED'
              return (
                <tr
                  key={user.userId}
                  data-demo={isDemo ? 'true' : undefined}
                  // 停止用的行整行灰掉：这一屏一眼要能看出"哪几个已经不在了"，
                  //   而只靠账号旁边一个小标签是看不出来的（那一行还在四个开关里）
                  data-status={off ? 'DISABLED' : undefined}
                >
                  <td>
                    <span className="adm__account">{user.account}</span>
                    <span className="adm__badges">
                      {user.role === 'ADMIN' ? <span className="adm__badge">站长</span> : null}
                      {/* ★ 演示账号那一行必须看得出来：口令公开、权限开着 */}
                      {isDemo ? (
                        <span
                          className="adm__badge"
                          data-demo="true"
                          title="口令是公开的，创作权限开着"
                        >
                          演示账号
                        </span>
                      ) : null}
                      {off ? (
                        <span className="adm__badge" data-off="true">
                          已停用
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td>
                    {user.nickname.trim() === '' ? (
                      <span className="adm__muted">没起过</span>
                    ) : (
                      user.nickname
                    )}
                  </td>
                  <td className="adm__time">{shortTimeOf(user.createdAt)}</td>
                  <td className="adm__time">{shortTimeOf(user.lastLoginAt)}</td>
                  {/* ★ 数不出来是「—」，一份都没有是「还没有」——这两件事在这里分开说
                      （见 `admin/state.ts` 的 `usageTextOf`） */}
                  <td className="adm__usage">{usageTextOf(usage[user.userId])}</td>
                  <td className="adm__td--cap">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={user.allowed}
                      aria-label={`${nameOf(user)} 的创作权限`}
                      className="adm__switch"
                      data-on={user.allowed ? 'true' : 'false'}
                      // 停用的人那一格是禁用的，不是藏的：他明天可能被恢复，
                      //   而到时候那一格本来就该是他停用前的位置。藏起来会让人
                      //   以为"停用把权限也清了"
                      disabled={busy === user.userId || off}
                      onClick={() => void flip(user)}
                    >
                      <span className="adm__knob" aria-hidden="true" />
                    </button>
                  </td>
                  <td className="adm__td--acts">
                    <button
                      type="button"
                      className="adm__act"
                      disabled={busy === user.userId}
                      onClick={() => void toggleStatus(user)}
                    >
                      {off ? '恢复' : '停用'}
                    </button>
                    <button
                      type="button"
                      className="adm__act"
                      disabled={busy === user.userId}
                      onClick={() => void askReset(user)}
                    >
                      改密码
                    </button>
                    <button
                      type="button"
                      className="adm__act"
                      data-danger="true"
                      // 演示账号删不掉：`AccountSeeder` 每次启动把它补回来，
                      //   所以那个按钮按下去会自己撤销。禁用它并把原因写在 title 上，
                      //   比按下去弹一句错好（见文件头第 4 条）
                      disabled={busy === user.userId || isDemo}
                      title={isDemo ? '演示账号删了会在下次启动时长回来' : undefined}
                      onClick={() => void askDelete(user)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {users.length === 0 ? (
        // 一个人都没有时说这句，而不是留一张空表：空表与"读失败"长得一样
        <p className="adm__empty">库里一个人都还没有。</p>
      ) : null}

      {/* ★ 额度那一块放在表下面：站长这一屏每天打开是为了改权限，
          发码是隔一阵子一次的事。放在上面会把那张表推到屏幕外。 */}
      <CreditsPanel seed={credits} users={users} />
    </section>
  )
}

/**
 * 建一个号。
 *
 * 折在一个 `<details>` 里而不是摊在页头：这一屏的日常动作是"改某个人的开关"，
 *   建号是一天一两次的事。摊开的话，两个输入框会一直占着最上面那一眼的位置。
 *
 * ★ 口令框用 `type="password"`（不是 text）：这一屏上可能有别人在看屏幕。
 * 建成之后两个框都清空，包括口令——留在框里的话它会一直挂在这台电脑的屏幕上，
 *   而这一屏往往就是站长自己的电脑。
 */
function NewUser({ onDone }: { onDone: (row: AdminUser) => void }) {
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    const result = await createUser(account.trim(), password)
    if (result.ok) {
      setAccount('')
      setPassword('')
      onDone(result.data)
    } else {
      setError(result.message)
    }
    setBusy(false)
  }

  return (
    <details className="adm__new">
      <summary>建一个新号</summary>
      <form className="adm__newform" onSubmit={(event) => void submit(event)}>
        <label className="adm__newfield">
          <span>登录名</span>
          <input
            type="text"
            value={account}
            autoComplete="off"
            placeholder="手机号，或者一个短账号"
            onChange={(event) => setAccount(event.target.value)}
          />
        </label>
        <label className="adm__newfield">
          <span>初始密码</span>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="至少 6 位"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" className="adm__newgo" disabled={busy || !account || !password}>
          {busy ? '在建…' : '建'}
        </button>
        {/* ★ 新号**默认有创作权**——那是服务端定的（见 `AdminService#createUser`），
            这里把话说在前面：要收回某个人的权限，在那一行上关 */}
        <p className="adm__newhint">新号默认就能创作；要收回某个人的权限，在那一行上关。</p>
        {error ? (
          <p className="adm__newbad" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  )
}
