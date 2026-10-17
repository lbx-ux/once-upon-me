'use client'

/**
 * RequestQueue —— 管理页上那一列**权限申请**（用户 2026-10-17 要的）
 *
 * ★ 它替掉的是帮助弹窗里那句「发邮件到 2953997419@qq.com」。用户的原话是
 *   「管理端就接收到申请，这也比发邮件好一点，管理端也可以清楚的看到是谁发送的请求」——
 *   所以这一列每一行的第一件事就是**显示是谁**（昵称/手机号 + 账号 + 注册时间），
 *   而不是像邮箱里那样只有一行署名要靠人去猜。
 *
 * ★ 三条判断：
 *
 * 1. **待处理的一律排在上面，已处理的**留在下面并写明结果。
 *    被拒的那条不删（服务端的规则，见 `PermissionRequestService`）：不留在列表里，
 *    申请人会反复提同一件事、站长会反复拒同一件事，而两边都以为对方忘了。
 *    已处理的那几条**不再给按钮** —— 一条已经批过的申请上再放一个"通过"，
 *    点下去只会得到一句 400，而更坏的是它会让人以为"我是不是刚才没批成功"。
 *
 * 2. **按下去之前先看清"这一条会改变什么"**：申请一律是**四项一起开通**
 *    （用户 2026-10-17：「申请的时候这些功能是一起发放的」），所以行上显示
 *    「他已有的」与「开通之后：全部四项」——前者是背景，后者是这一次按下去的结果。
 *    ★ 所以这一格**照实写成一句固定的"全部四项"**，而不是显示那条申请的几个布尔：
 *    申请里那几个值现在恒为真（服务端写的），把它当成"申请人挑的"来显示，
 *    会让站长以为这个人只想要其中几项。
 *    ★ 只显示"他要"是不够的：一个已经有文本权限的人申请图像，批完他会有两项，
 *    而只显示"他要图像"的那个界面会让人以为自己关掉了他的文本。
 *
 * 3. **批完/拒完照服务端回的那一条整行替换**，与四个开关那一屏同一条纪律：
 *    自己把本地状态改成"已批准"的话，一次失败会留下一个"我以为我批了"的假象。
 *
 * ★ 这里不许出现 Markdown 的星号：JSX 里的文字是普通文本，要强调用 `<b>`。
 */

import { useState } from 'react'

import { decideRequest } from '@/lib/requests/client.ts'
import { wantsList, type PermissionRequestRow } from '@/lib/requests/state.ts'
import { CAPABILITY_LABELS } from '@/lib/admin/state.ts'
import type { Permissions } from '@/lib/auth/state.ts'

/** 那一栏的名字。★ 与 `AdminScreen.nameOf` 同一套判据（昵称 → 打码手机号 → 账号） */
function nameOf(row: PermissionRequestRow): string {
  if (row.nickname.trim() !== '') return row.nickname.trim()
  if (row.phone) return `${row.phone.slice(0, 3)}****${row.phone.slice(-4)}`
  return row.account
}

/**
 * 时间那一栏。★ 待处理的那条显示"什么时候提的"，已处理的显示"什么时候处理的"——
 * 后者才是站长真正关心的（"我上周是不是已经拒过他一次"）。
 */
function shortTime(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const STATUS_TEXT: Record<PermissionRequestRow['status'], string> = {
  PENDING: '等着处理',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
}

export default function RequestQueue({
  initial,
  loadError,
}: {
  initial: PermissionRequestRow[]
  /** 首屏没读到时那句实话。★ 一列空的申请与"一条都没有"长得一样，必须分开 */
  loadError: string | null
}) {
  const [rows, setRows] = useState<PermissionRequestRow[]>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)

  async function decide(row: PermissionRequestRow, approve: boolean) {
    if (busy) return
    setBusy(row.requestId)
    setNote(null)

    const result = await decideRequest(row.requestId, approve)
    if (result.ok) {
      // ★ 整行替换（见文件头第 3 条）
      setRows((all) => all.map((item) => (item.requestId === row.requestId ? result.data : item)))
      setNote({
        text: `${nameOf(row)} 的那条：${approve ? '已经开了' : '已经拒了'}`,
        bad: false,
      })
    } else {
      setNote({ text: `没处理成：${result.message}`, bad: true })
    }
    setBusy(null)
  }

  // ★ 待处理的一律在前：这个列表的用处就是"看一眼有没有事要做"，
  //   而排在最上面的如果是一条三天前就批过的，那一眼就白看了
  const pending = rows.filter((row) => row.status === 'PENDING')
  const decided = rows.filter((row) => row.status !== 'PENDING')

  return (
    <section className="adm__queue" aria-labelledby="adm-queue-title">
      <h2 className="adm__queue-title" id="adm-queue-title">
        权限申请
        {loadError === null ? (
          <span className="adm__queue-count" data-zero={pending.length === 0 ? 'true' : undefined}>
            {pending.length === 0 ? '没有待处理的' : `${pending.length} 条待处理`}
          </span>
        ) : null}
      </h2>

      {/* ★ 读不到时**说清是这一半读不到**，而不是显示"没有待处理的" */}
      {loadError !== null ? (
        <p className="adm__queue-bad" role="alert">
          这一会儿读不到申请列表：{loadError}
          <span className="adm__queue-hint">下面的用户表不受影响。</span>
        </p>
      ) : null}

      {note ? (
        <p className="adm__note" data-bad={note.bad ? 'true' : undefined} role="status">
          {note.text}
        </p>
      ) : null}

      {loadError === null && rows.length === 0 ? (
        <p className="adm__queue-empty">
          还没有人申请过。用户在工作台左下角的「帮助」里点一下就能提一条， 提了会出现在这里。
        </p>
      ) : null}

      {pending.map((row) => (
        <article className="adm__req" key={row.requestId} data-status="PENDING">
          <div className="adm__req-who">
            <span className="adm__req-name">{nameOf(row)}</span>
            <span className="adm__req-account">{row.account}</span>
            <span className="adm__req-time">{shortTime(row.createdAt)} 提的</span>
          </div>

          {/* ★ 「他已有的」是背景，「开通之后」是这一次按下去的结果（文件头第 2 条）。
              右边那一格**不读 `wants`**：申请恒为四项全开，读它只是把一句常量
              写得像"这个人挑的"。 */}
          <dl className="adm__req-wants">
            <div>
              <dt>他已有的</dt>
              <dd>{describe(row.current)}</dd>
            </div>
            <div>
              <dt>开通之后</dt>
              <dd className="adm__req-asks">全部四项</dd>
            </div>
          </dl>

          {row.note ? <p className="adm__req-note">「{row.note}」</p> : null}

          <div className="adm__req-actions">
            <button
              type="button"
              className="adm__req-go"
              disabled={busy === row.requestId}
              onClick={() => void decide(row, true)}
            >
              给他开四项
            </button>
            <button
              type="button"
              className="adm__req-no"
              disabled={busy === row.requestId}
              onClick={() => void decide(row, false)}
            >
              拒绝
            </button>
          </div>
        </article>
      ))}

      {decided.length > 0 ? (
        <details className="adm__req-done">
          <summary>处理过的（{decided.length}）</summary>
          <ul className="adm__req-donelist">
            {decided.map((row) => (
              <li key={row.requestId} data-status={row.status}>
                <span className="adm__req-name">{nameOf(row)}</span>
                <span className="adm__req-account">{row.account}</span>
                <span className="adm__req-donestatus">{STATUS_TEXT[row.status]}</span>
                <span className="adm__req-time">{shortTime(row.decidedAt ?? row.createdAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

/**
 * 四个开关读成一句话（"文字、图像"）。
 *
 * ★ 一项都没开时说「四个都关着」，不是留空：留空与"读不出来"长得一样，
 *   而在这一屏上，"他手里什么都没有"是一个**要看的**事实——它决定了
 *   这次批准是从零开始，还是在已有的一半上再加一件。
 */
function describe(permissions: Permissions): string {
  const labels = wantsList(permissions, [...CAPABILITY_LABELS])
  return labels.length === 0 ? '四个都关着' : labels.join('、')
}
