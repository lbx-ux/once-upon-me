'use client'

/**
 * AdminScreen —— 管理页那一屏（工单 09）
 *
 * 用户 2026-10-16 选的方案：**一屏最小管理页 = 列出所有人 + 四个开关当场改**。
 * 这一轮不做的东西也写在 README §五：改密码（管理员替别人重置——没有找回密码这条线，
 * 所以也不该有"管理员能改任何人的密码"）、删号、搜索分页（用户规模是几十）。
 *
 * ★ 四条判断，每条都有一个具体的后果：
 *
 * 1. **勾一下就是一次提交**（全量四个布尔），没有"保存"按钮。
 *    ★ 提交期间**只禁用那一行**，不是整页：管理员改的是"这个人"，不是整个人群。
 *    ★ 失败时**把那一行改回去**并说一句（服务端一早就会拒，不只是网络问题——
 *      403 是"你的管理员身份在这中间被撤了"，那一条更要当场看见）。
 *
 * 2. **权限改完不需要对方重新登录**（`GET /api/auth/me` 每次从库里读），
 *    所以这一屏上不需要任何"记得告诉他重登一次"的提示——那会是假的。
 *    把这件事写在页头，是因为它是这一屏唯一一件**看不见但成立**的事。
 *
 * 3. **注册开关是只读的**。★ 刻意的：一个能改"钱从哪儿出"的开关不该是网页上一个按钮。
 *    要改就动服务器上的 `/etc/xiaozhujue/api.yml`。这里显示它，是为了让人
 *    **知道现在的状态**——而不是让人从这里改。
 *
 * 4. **演示账号那一行要标出来**。它的口令是公开的、四个能力全开，
 *    所以"谁在花我的钱"这个问题的答案里，第一行就是它。登录名由后端给
 *    （`demoAccount`），不在前端写死。
 */

import { useCallback, useState } from 'react'

import { setPermissions } from '@/lib/admin/client.ts'
import { CAPABILITY_LABELS, type AdminOverview, type AdminUser } from '@/lib/admin/state.ts'
import type { Permissions } from '@/lib/auth/state.ts'

/** 时间那一栏。★ 与 `ProfileHome.formatJoined` 同一条：格式写死，不跟运行环境走 */
function shortTime(iso: string | null): string {
  if (!iso) return '没来过'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '记不清了'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function nameOf(user: AdminUser): string {
  if (user.nickname.trim() !== '') return user.nickname.trim()
  if (user.phone) return `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}`
  return user.account
}

export default function AdminScreen({ initial }: { initial: AdminOverview }) {
  const [users, setUsers] = useState<AdminUser[]>(initial.users)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ userId: string; text: string; bad: boolean } | null>(null)

  const flip = useCallback(
    async (user: AdminUser, key: keyof Permissions) => {
      if (busy) return
      const next: Permissions = { ...user.permissions, [key]: !user.permissions[key] }
      const before = user.permissions
      setBusy(user.userId)
      setNote(null)
      // ★ 先把这一行改成新值（点一下就有反应），失败再改回来——失败时说清是哪一步
      setUsers((all) =>
        all.map((item) => (item.userId === user.userId ? { ...item, permissions: next } : item)),
      )

      const result = await setPermissions(user.userId, next)
      if (result.ok) {
        // ★ 照服务端回的那一行**整行替换**，不是"反正我已经改好了"（见 `admin/state.ts`）
        setUsers((all) => all.map((item) => (item.userId === user.userId ? result.data : item)))
        setNote({
          userId: user.userId,
          text: `${nameOf(user)}：${CAPABILITY_LABELS.find((item) => item.key === key)?.label ?? key} ${
            next[key] ? '开了' : '关了'
          }`,
          bad: false,
        })
      } else {
        setUsers((all) =>
          all.map((item) =>
            item.userId === user.userId ? { ...item, permissions: before } : item,
          ),
        )
        setNote({ userId: user.userId, text: `没改成：${result.message}`, bad: true })
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
          {/* ★ 这一屏唯一一件"看不见但成立"的事：权限每次从库里读，
              所以改完不用让对方重新登录。写出来免得管理员自己去通知一遍。
              ★ 这里不许出现 Markdown 的星号：它是 JSX 里的**普通文本**，
                写 `**粗体**` 出来就是两个字面的星号（2026-10-17 实测撞上的）。
                要强调就用 `<b>`，别借 Markdown 的语法——那只在 .md 文件里成立。 */}
          <p className="adm__sub">
            关掉一个开关，那个人<b>下一次点开始创作</b>就生效，不用重新登录。
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

      {note ? (
        <p className="adm__note" data-bad={note.bad ? 'true' : undefined} role="status">
          {note.text}
        </p>
      ) : null}

      <div className="adm__tablewrap">
        <table className="adm__table">
          <thead>
            <tr>
              <th scope="col">账号</th>
              <th scope="col">昵称</th>
              <th scope="col">注册</th>
              <th scope="col">上次登录</th>
              {CAPABILITY_LABELS.map((item) => (
                <th key={item.key} scope="col" className="adm__th--cap">
                  {item.label}
                  <span className="adm__th-hint">{item.hint}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isDemo = initial.demoAccount !== null && user.account === initial.demoAccount
              return (
                <tr key={user.userId} data-demo={isDemo ? 'true' : undefined}>
                  <td>
                    <span className="adm__account">{user.account}</span>
                    <span className="adm__badges">
                      {user.role === 'ADMIN' ? <span className="adm__badge">站长</span> : null}
                      {/* ★ 演示账号那一行必须看得出来：口令公开、四个开关全开 */}
                      {isDemo ? (
                        <span
                          className="adm__badge"
                          data-demo="true"
                          title="口令是公开的，四个能力全开"
                        >
                          演示账号
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
                  <td className="adm__time">{shortTime(user.createdAt)}</td>
                  <td className="adm__time">{shortTime(user.lastLoginAt)}</td>
                  {CAPABILITY_LABELS.map((item) => {
                    const on = user.permissions[item.key]
                    return (
                      <td key={item.key} className="adm__td--cap">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${nameOf(user)} 的${item.label}权限`}
                          className="adm__switch"
                          data-on={on ? 'true' : 'false'}
                          disabled={busy === user.userId}
                          onClick={() => void flip(user, item.key)}
                        >
                          <span className="adm__knob" aria-hidden="true" />
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {users.length === 0 ? (
        // ★ 一个人都没有时说这句，而不是留一张空表：空表与"读失败"长得一样
        <p className="adm__empty">库里一个人都还没有。</p>
      ) : null}
    </section>
  )
}
