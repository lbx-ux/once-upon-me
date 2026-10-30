'use client'

/**
 * RedeemPanel —— 「兑换额度」那一屏（2026-10-30）
 *
 * 三件事按顺序：这个人还剩几本 → 输一张码 → 最近几笔流水。
 *
 * 六条判断：
 *
 * 1. **输框里显示的是分组形（`ABCD-EFGH-…`）**，而发出去的是去掉连字符的规范形。
 *    分组是为了手抄与核对，不是协议的一部分——服务端两种都收。
 * 2. **成功之后不清空上面的余额、而是把它换成服务端回来的那个数**。自己加一笔
 *    （`balance + books`）在并发下会算错，而"我兑了 5 本怎么只多了 2 本"这种
 *    疑问没有第二种解释。服务端回的是兑完之后的事实。
 * 3. **失败只有一句**（服务端给的），不区分"不存在 / 用过 / 过期"。这一层不去猜，
 *    也不补一句"您是不是输错了"——那等于在教人爆破。
 * 4. **兑换按钮在提交期间禁用**，但不禁用输入框：一个失败的人马上要改一个字再试，
 *    把框也锁上只会让他等。
 * 5. **流水那一栏只读**。它不是对账单（对账在管理页），是"刚才那几笔对不对"。
 * 6. **兑成功之后把流水重读一次**（2026-10-30 浏览器实测补的）。流水是服务端首屏
 *    递进来的，兑换本身只回余额——不重读的话，刚兑的那一条要等刷新才出现，而
 *    用户看到的正是"我兑了，可是下面什么都没多"。余额不靠重读（第 2 条已经用
 *    响应里的那个数），重读只是为了那张表。
 */

import Link from 'next/link'
import { useCallback, useState } from 'react'

import { fetchCreditView, redeemCode } from '@/lib/credits/client.ts'
import {
  deltaTextOf,
  formatCode,
  normalizeCode,
  reasonLabelOf,
  type CreditEntry,
} from '@/lib/credits/state.ts'

function timeOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function RedeemPanel({
  initialBalance,
  entries,
}: {
  /** 服务端读到的余额。`null` = 读不出来（显示「—」，不拿 0 冒充） */
  initialBalance: number | null
  entries: CreditEntry[]
}) {
  const [code, setCode] = useState('')
  const [balance, setBalance] = useState<number | null>(initialBalance)
  const [log, setLog] = useState<CreditEntry[]>(entries)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (busy) return
      const normalized = normalizeCode(code)
      if (normalized === '') {
        setNote({ text: '把兑换码填进来', bad: true })
        return
      }
      setBusy(true)
      setNote(null)
      const result = await redeemCode(normalized)
      if (result.ok) {
        setBalance(result.data.balance)
        setCode('')
        setNote({
          text: `换到了 ${result.data.books} 本，现在还剩 ${result.data.balance} 本。尾号 ${result.data.codeTail}。`,
          bad: false,
        })
        // 判断 6：那张表只重读、不本地拼——拼出来的那一条没有 id，也没有服务端记的时间
        const view = await fetchCreditView()
        if (view.ok) setLog(view.data.entries)
      } else {
        setNote({ text: result.message, bad: true })
      }
      setBusy(false)
    },
    [busy, code],
  )

  return (
    <section className="rdm">
      <header className="rdm__head">
        <h1 className="rdm__title">兑换额度</h1>
        <p className="rdm__sub">
          一张码换几本，兑换之后额度<b>不会过期</b>。画一本书消耗 1 本——
          编故事不花钱，钱花在点「就按这个画」那一刻。
        </p>
      </header>

      <div className="rdm__grid">
        <div className="rdm__card">
          <p className="rdm__balance-label">现在还剩</p>
          <p className="rdm__balance" data-unknown={balance === null ? 'true' : undefined}>
            {balance === null ? '—' : balance}
            <span className="rdm__unit">本</span>
          </p>

          <form className="rdm__form" onSubmit={(event) => void submit(event)}>
            <label className="rdm__field">
              <span>兑换码</span>
              <input
                className="rdm__input"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="ABCD-EFGH-JKLM-NPQR"
                value={code}
                onChange={(event) => {
                  // 边输边分组：粘贴一整串、或者一个字一个字敲，看到的都是同一形状
                  setCode(formatCode(event.target.value))
                }}
              />
            </label>
            <button className="rdm__go" type="submit" disabled={busy || code === ''}>
              {busy ? '在兑…' : '兑换'}
            </button>
          </form>

          {note ? (
            <p className="rdm__note" data-bad={note.bad ? 'true' : undefined} role="status">
              {note.text}
            </p>
          ) : null}

          <p className="rdm__next">
            兑换完就可以去 <Link href="/home">创作</Link> 了。
          </p>
        </div>

        <div className="rdm__card rdm__card--log">
          <h2 className="rdm__log-title">最近的额度变化</h2>
          {log.length === 0 ? (
            <p className="rdm__empty">还没有任何一笔。兑换一张码，或者等站长补发。</p>
          ) : (
            <ol className="rdm__log">
              {log.map((entry) => (
                <li key={entry.id} className="rdm__row">
                  <span className="rdm__row-what">{reasonLabelOf(entry.reason)}</span>
                  <span className="rdm__row-note">{entry.note !== '' ? entry.note : '—'}</span>
                  <span className="rdm__row-time">{timeOf(entry.createdAt)}</span>
                  <span className="rdm__row-delta" data-sign={entry.delta > 0 ? 'plus' : 'minus'}>
                    {deltaTextOf(entry.delta)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}
