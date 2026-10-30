'use client'

/**
 * CreditsPanel —— 管理页上的「额度与兑换码」（2026-10-30）
 *
 * 这一块回答站长的三个问题，按从上到下的顺序：
 *   1. 全站现在欠着多少本、发出去的码兑了多少（那几个数）；
 *   2. 我要发一批码 / 给某个人补几本（两个表单）；
 *   3. 最近发过哪些批次（一张表）。
 *
 * 七条判断：
 *
 * 1. ★ **明文码只出现这一次。** 库里只有 HMAC 与后四位（见 `CodeFactory`），
 *    所以服务端那条响应就是这些码唯一的一次露面。界面因此必须当场给出 CSV 下载，
 *    而且要写清楚"关掉就查不回来"——一句"记得保存"是不够的，得说清为什么。
 *    没有"复制全部"这种按钮：一个能粘到剪贴板的按钮，也会在那台电脑的剪贴板里
 *    留到下一次复制为止；CSV 是能落盘、能发出去、能存档的那一种。
 *
 * 2. ★ **生成完立刻重取一次总账。** 那一批码的"共几张"在本地算得出来，
 *    但"已兑 0 / 共 12"里另一半、以及在手总额，只有服务端知道。自己拼一个
 *    半真的数，下次刷新就会跳一下。
 *
 * 3. ★ **不做「对公订单」（2026-10-30 拿掉的）。** 原来发码时可以顺手记一张
 *    "对公转账已到账"的订单，用来给机构采购做凭证。这一版决定不要订单台账：
 *    额度只从兑换码与补发进来，站外那笔钱不在系统里留痕。所以这里既没有
 *    「到账金额」那一格，也没有订单表——不是藏起来了，是那条路不在了。
 *
 * 4. ★ **对账差不是 0 时要红着说。** 账本（`book_credits` 的 SUM）与余额表
 *    （`credit_accounts` 的 SUM）本该恒等，不相等意味着有人绕过了账本改余额。
 *    这个数平时恒为 0、也不该有人看它，所以它**只在坏掉的时候出现**——
 *    一个永远显示"0"的红绿灯会训练人忽略它。
 *
 * 5. ★ **表单只做手滑级校验**（非空、是整数、在不在一个显然不可能的范围内）。
 *    真正的上限在 Java（1–500 张、一张 1–100 本、0–3650 天），这一层再判一遍
 *    就会有两套上限，而它们迟早不一样（同 `codes/route.ts` 的那条注释）。
 *
 * 6. **补发走的是账本，不是"把余额改成某个数"**：补几本、补给谁，都会在
 *    那个人的流水里留下一条 `grant`。所以这里没有"设为 N 本"这种输入框。
 *
 * 7. 读不到总账时，整块**不假装是空的**：说一句读不到，两个表单照旧能用
 *    （它们各自会回自己的错），两张表不渲染。空表与"读失败"长得一样。
 */

import { useCallback, useEffect, useState } from 'react'

import { fetchAdminCredits, grantCredits, issueCodes } from '@/lib/credits/client.ts'
import { formatCode, type AdminCreditOverview, type CodeBatchResult } from '@/lib/credits/state.ts'
import { shortTimeOf, type AdminUser } from '@/lib/admin/state.ts'

/** 服务端递进来的那一份总账（`readAdminCredits()` 的结果，结构相同） */
export type CreditsSeed =
  { kind: 'ok'; overview: AdminCreditOverview } | { kind: 'error'; message: string }

type Flash = { text: string; bad: boolean } | null

export default function CreditsPanel({ seed, users }: { seed: CreditsSeed; users: AdminUser[] }) {
  const [overview, setOverview] = useState<AdminCreditOverview | null>(
    seed.kind === 'ok' ? seed.overview : null,
  )
  const [error, setError] = useState<string | null>(seed.kind === 'error' ? seed.message : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<Flash>(null)

  const [batchName, setBatchName] = useState('')
  const [countText, setCountText] = useState('1')
  const [booksText, setBooksText] = useState('1')
  const [daysText, setDaysText] = useState('365')
  const [noteText, setNoteText] = useState('')

  const [grantTo, setGrantTo] = useState(users[0]?.userId ?? '')
  const [grantBooksText, setGrantBooksText] = useState('1')
  const [grantNote, setGrantNote] = useState('')

  const [issued, setIssued] = useState<{ result: CodeBatchResult; csvUrl: string } | null>(null)

  // 对象 URL 是有主的：换一批码或离开这一屏时要把上一份交还，否则它到页面关掉为止都占着
  useEffect(() => {
    const url = issued?.csvUrl ?? null
    return () => {
      if (url !== null) URL.revokeObjectURL(url)
    }
  }, [issued])

  const refresh = useCallback(async (): Promise<void> => {
    setBusy('refresh')
    const result = await fetchAdminCredits()
    if (result.ok) {
      setOverview(result.data)
      setError(null)
    } else {
      // 读失败时不清掉手上那一份：它可能只是这一下没读到，而清掉会让人以为数被改了
      setError(result.message)
    }
    setBusy(null)
  }, [])

  const submitBatch = useCallback(
    async (event: React.FormEvent): Promise<void> => {
      event.preventDefault()
      if (busy) return

      const count = Number.parseInt(countText, 10)
      const books = Number.parseInt(booksText, 10)
      const days = Number.parseInt(daysText, 10)
      if (!Number.isInteger(count) || count < 1) {
        setFlash({ text: '张数要写一个正整数', bad: true })
        return
      }
      if (!Number.isInteger(books) || books < 1) {
        setFlash({ text: '每张换几本要写一个正整数', bad: true })
        return
      }
      if (!Number.isInteger(days) || days < 0) {
        setFlash({ text: '有效期要写 0（不过期）或一个天数', bad: true })
        return
      }
      setBusy('issue')
      setFlash(null)
      const result = await issueCodes({
        batch: batchName.trim(),
        count,
        booksPerCode: books,
        expiresInDays: days,
        note: noteText.trim(),
      })
      if (!result.ok) {
        setFlash({ text: `没生成：${result.message}`, bad: true })
        setBusy(null)
        return
      }
      setIssued({ result: result.data, csvUrl: csvUrlOf(result.data) })
      setFlash({
        text: `生成了 ${result.data.codes.length} 张码，明文只在上面这一块出现这一次`,
        bad: false,
      })
      setBusy(null)
      await refresh()
    },
    [batchName, booksText, busy, countText, daysText, noteText, refresh],
  )

  const submitGrant = useCallback(
    async (event: React.FormEvent): Promise<void> => {
      event.preventDefault()
      if (busy) return
      const books = Number.parseInt(grantBooksText, 10)
      if (grantTo === '') {
        setFlash({ text: '先挑一个人', bad: true })
        return
      }
      if (!Number.isInteger(books) || books < 1) {
        setFlash({ text: '补几本要写一个正整数', bad: true })
        return
      }

      setBusy('grant')
      setFlash(null)
      const result = await grantCredits(grantTo, books, grantNote.trim())
      if (!result.ok) {
        setFlash({ text: `没补上：${result.message}`, bad: true })
        setBusy(null)
        return
      }
      setFlash({ text: `补好了，那个人现在有 ${result.data.balance} 本`, bad: false })
      setGrantBooksText('1')
      setGrantNote('')
      setBusy(null)
      await refresh()
    },
    [busy, grantBooksText, grantNote, grantTo, refresh],
  )

  const drift = overview ? overview.ledgerDrift : 0

  return (
    <section className="crd">
      <header className="crd__head">
        <div>
          <h2 className="crd__title">额度与兑换码</h2>
          <p className="crd__sub">
            一本书扣 1 本额度。码在这里发，站长手上那一份明文只给一次；用户自己在
            <b> 兑换 </b>那一屏输进去。
          </p>
        </div>
        <button
          type="button"
          className="crd__refresh"
          disabled={busy !== null}
          onClick={() => void refresh()}
        >
          {busy === 'refresh' ? '在读…' : '重新读一遍'}
        </button>
      </header>

      {error ? (
        <p className="crd__error" role="alert">
          读不到总账：{error}
          {/* ★ 说清"这一下没读到"，不是"全站没有额度"——两件事的下一步完全不同 */}
          <span className="crd__error-hint">下面的表单照旧能用，读数慢一步。</span>
        </p>
      ) : null}

      {overview ? (
        <>
          <dl className="crd__stats">
            <div>
              <dt>在手的额度</dt>
              <dd>
                {overview.totalBalance}
                <span className="crd__cap"> 本</span>
              </dd>
            </div>
            <div>
              <dt>还有额度的人</dt>
              <dd>{overview.usersWithCredits}</dd>
            </div>
            <div>
              <dt>兑换码</dt>
              <dd>
                {overview.codesRedeemed}
                <span className="crd__cap"> 兑 / {overview.codesTotal} 张</span>
              </dd>
            </div>
          </dl>

          {/* 判断 4：只在坏掉的时候出现 */}
          {drift !== 0 ? (
            <p className="crd__drift" role="alert">
              账本与余额表对不上：差 {drift} 本。这两个数本该恒等，先别发码——先去查
              <code> book_credits </code>与<code> credit_accounts </code>这两张表。
            </p>
          ) : null}
        </>
      ) : null}

      <form className="crd__form" onSubmit={(event) => void submitBatch(event)}>
        <p className="crd__formtitle">发一批码</p>
        <label className="crd__field crd__field--wide">
          <span>批次名</span>
          <input
            type="text"
            value={batchName}
            autoComplete="off"
            placeholder="留空就按时间起一个"
            onChange={(event) => setBatchName(event.target.value)}
          />
        </label>
        <label className="crd__field">
          <span>张数</span>
          <input
            type="number"
            min={1}
            max={500}
            value={countText}
            onChange={(event) => setCountText(event.target.value)}
          />
        </label>
        <label className="crd__field">
          <span>每张换几本</span>
          <input
            type="number"
            min={1}
            max={100}
            value={booksText}
            onChange={(event) => setBooksText(event.target.value)}
          />
        </label>
        <label className="crd__field">
          <span>有效期（天）</span>
          <input
            type="number"
            min={0}
            max={3650}
            value={daysText}
            onChange={(event) => setDaysText(event.target.value)}
          />
        </label>
        <label className="crd__field crd__field--wide">
          <span>备注</span>
          <input
            type="text"
            value={noteText}
            autoComplete="off"
            placeholder="给谁、为什么发"
            onChange={(event) => setNoteText(event.target.value)}
          />
        </label>
        <button type="submit" className="crd__go" disabled={busy !== null}>
          {busy === 'issue' ? '在生成…' : '生成'}
        </button>
        {/* 判断 5：上限在 Java，这一层只把"写错了"说清 */}
        <p className="crd__hint">有效期写 0 就是不过期。码发出去之后只能等它过期。</p>
      </form>

      {issued ? <IssuedCodes result={issued.result} csvUrl={issued.csvUrl} /> : null}

      {flash ? (
        <p className="adm__note" data-bad={flash.bad ? 'true' : undefined} role="status">
          {flash.text}
        </p>
      ) : null}

      {overview ? (
        <>
          <p className="crd__subhead">最近的批次</p>
          {overview.batches.length === 0 ? (
            <p className="crd__empty">还没发过码。</p>
          ) : (
            <div className="adm__tablewrap">
              <table className="adm__table">
                <thead>
                  <tr>
                    <th scope="col">批次</th>
                    <th scope="col">每张</th>
                    <th scope="col">兑了</th>
                    <th scope="col">建批</th>
                    <th scope="col">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.batches.map((batch) => (
                    <tr key={batch.batch}>
                      <td>{batch.batch}</td>
                      <td>{batch.booksPerCode} 本</td>
                      {/* ★ 写成分数而不是"还剩几张"：一个批次的用处就是看"这批发出去
                          多少了"，而 3/12 与 9 在扫一眼时读的是两件事 */}
                      <td className="crd__num">
                        {batch.redeemed}
                        <span className="crd__cap"> / {batch.count}</span>
                      </td>
                      <td className="adm__time">{shortTimeOf(batch.createdAt)}</td>
                      <td className="crd__note-cell" title={batch.note}>
                        {batch.note === '' ? <span className="adm__muted">—</span> : batch.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      <form className="crd__form" onSubmit={(event) => void submitGrant(event)}>
        <p className="crd__formtitle">手动补几本</p>
        <label className="crd__field crd__field--wide">
          <span>补给谁</span>
          <select value={grantTo} onChange={(event) => setGrantTo(event.target.value)}>
            {users.map((user) => (
              <option key={user.userId} value={user.userId}>
                {user.account}
                {user.nickname.trim() === '' ? '' : ` · ${user.nickname.trim()}`}
              </option>
            ))}
          </select>
        </label>
        <label className="crd__field">
          <span>补几本</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={grantBooksText}
            onChange={(event) => setGrantBooksText(event.target.value)}
          />
        </label>
        <label className="crd__field crd__field--wide">
          <span>备注</span>
          <input
            type="text"
            value={grantNote}
            autoComplete="off"
            placeholder="这一笔为什么给"
            onChange={(event) => setGrantNote(event.target.value)}
          />
        </label>
        <button type="submit" className="crd__go" disabled={busy !== null || users.length === 0}>
          {busy === 'grant' ? '在补…' : '补发'}
        </button>
        {/* 判断 6：说清这笔补发会留下什么，以及没有"直接改余额"这件事 */}
        <p className="crd__hint">
          补发会在这个人的流水里留一条「补发」，备注一起记下。这里没有「把余额改成多少」——余额只由账本说得清。
        </p>
      </form>
    </section>
  )
}

/** 生成完那一块：明文码 + 下载 + 一句为什么只能看一次 */
function IssuedCodes({ result, csvUrl }: { result: CodeBatchResult; csvUrl: string }) {
  const fileName = `兑换码-${result.batch}.csv`
  return (
    <div className="crd__issued">
      <div className="crd__issued-head">
        <p className="crd__issued-title">
          这一批 {result.codes.length} 张，每张 {result.booksPerCode} 本
          {result.expiresAt === null ? '，不过期' : `，${shortTimeOf(result.expiresAt)} 过期`}
        </p>
        <a className="crd__dl" href={csvUrl} download={fileName}>
          下载 CSV
        </a>
      </div>
      {/* ★ 判断 1：说清"查不回来"的原因，不是一句"记得保存" */}
      <p className="crd__warn">
        关掉这一屏就查不回来了：库里只存 HMAC 与后四位，明文只在这里出现过这一次。先下载再往下走。
      </p>
      <ol className="crd__codes">
        {result.codes.map((code) => (
          <li key={code}>{formatCode(code)}</li>
        ))}
      </ol>
    </div>
  )
}

/**
 * 一批码 → 一个对象 URL。
 *
 * ★ 带 UTF-8 BOM：不带的话 Excel 在中文 Windows 上会按 GBK 打开，一整列码变成乱码。
 * ★ 每个格子都加引号：批次名与备注是站长随手写的，里面一个逗号就会让整张表错列。
 */
function csvUrlOf(batch: CodeBatchResult): string {
  const head = ['兑换码', '本数', '批次', '有效期']
  const rows = batch.codes.map((code) => [
    formatCode(code),
    String(batch.booksPerCode),
    batch.batch,
    batch.expiresAt === null ? '不过期' : batch.expiresAt,
  ])
  const text =
    // ★ 显式的转义，不是一个看不见的字符：BOM 写在源码里没人看得出来
    '\uFEFF' + [head, ...rows].map((row) => row.map(cellOf).join(',')).join('\r\n') + '\r\n'
  return URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
}

function cellOf(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}
