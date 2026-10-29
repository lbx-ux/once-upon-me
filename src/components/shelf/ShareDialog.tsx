'use client'

/**
 * ShareDialog —— 「发给家人」那张纸（2026-10-29）
 *
 * 五条判断
 *
 * 1. **链接只显示一次，界面上必须这么说。** 盘上只有 `sha256(token)`，没有票原文
 *    （`lib/share/token.ts` 文件头第 4 条）。所以刷新之后这个弹窗只知道
 *    "有一条活的、X 月 X 日到期"，拿不回那条 URL。与其让家长以为"关掉就找不到了"
 *    是个 bug，不如在生成那一刻就写明：丢了就重新生成，旧的那条随之作废。
 *
 * 2. **重新生成 = 旧链接立刻失效。** 服务端 `POST` 先签新的再收旧的；
 *    这个弹窗只负责把结果说清楚（"换一条新的"而不是"再发一条"）。
 *
 * 3. **收回是这颗按钮，不是关窗。** 关窗什么都不改；收回之后要给一句
 *    "对方手里那条现在打不开了"——那是这个动作唯一可见的后果。
 *
 * 4. **复制失败要说人话。** `navigator.clipboard` 在非安全上下文里是 `undefined`，
 *    而"点了复制但什么也没发生"比"复制不了，请手动选"糟得多。
 *
 * 5. **弹窗里没有第二个真相。** 有没有分享、到哪天，全部来自服务端给的
 *    `until` 与这一次生成的结果；这个组件不自己算过期。
 */

import { useEffect, useRef, useState } from 'react'

import Dialog from '@/components/dialog/Dialog.tsx'

export type ShareDialogProps = {
  bookId: string
  title: string
  /** 服务端知道的到期时间（毫秒）。null = 现在没有活链接 */
  initialUntil: number | null
  onClose: () => void
  /** 生成/收回之后把新的到期时间（或 null）交给书架那一屏 */
  onChanged: (bookId: string, until: number | null) => void
}

const DEFAULT_DAYS = 30

function dateText(until: number): string {
  return new Date(until).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function ShareDialog({
  bookId,
  title,
  initialUntil,
  onClose,
  onChanged,
}: ShareDialogProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [until, setUntil] = useState<number | null>(initialUntil)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [justRevoked, setJustRevoked] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function failureOf(response: Response): Promise<string> {
    const data = (await response.json().catch(() => null)) as { message?: unknown } | null
    return typeof data?.message === 'string' && data.message !== ''
      ? data.message
      : `没成功（${response.status}），稍后再试。`
  }

  async function generate(): Promise<void> {
    setBusy(true)
    setError(null)
    setJustRevoked(false)
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: DEFAULT_DAYS }),
      })
      if (!response.ok) {
        setError(await failureOf(response))
        return
      }
      const data = (await response.json()) as { url?: unknown; expiresAt?: unknown }
      if (typeof data.expiresAt !== 'number') {
        setError('服务端没回到到期时间，这一条不算生成成功。')
        return
      }
      // 本机 `SITE_ORIGIN` 没配时服务端回的是 `/r/...`；补成绝对地址才好复制
      const raw = typeof data.url === 'string' ? data.url : ''
      const absolute = raw.startsWith('http') ? raw : `${window.location.origin}${raw}`
      setUrl(absolute)
      setUntil(data.expiresAt)
      onChanged(bookId, data.expiresAt)
    } catch {
      setError('网络不通，没生成成功。')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/share`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        setError(await failureOf(response))
        return
      }
      setUrl(null)
      setUntil(null)
      setJustRevoked(true)
      onChanged(bookId, null)
    } catch {
      setError('网络不通，没收回成功。')
    } finally {
      setBusy(false)
    }
  }

  async function copy(): Promise<void> {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setError(null)
    } catch {
      // 选上，让人自己按 Ctrl+C——比一句"复制失败"多给一条路
      inputRef.current?.focus()
      inputRef.current?.select()
      setError('这个浏览器不让脚本写剪贴板。链接已经选中，按 Ctrl+C 复制。')
    }
  }

  /**
   * 还在生成时不许关。
   *
   * ★ 链接只出现一次（盘上只有哈希）。生成请求飞出去之后关窗，等它回来时
   *   组件已经不在了，`setUrl` 落空、`onChanged` 照样把圆点点亮——用户得到的是
   *   "已分享"和一串谁也拿不到的链接。这个坏法一旦发生**救不回来**，
   *   所以这里宁可让那零点几秒关不掉。
   */
  function requestClose(): void {
    if (busy) return
    onClose()
  }

  return (
    <Dialog
      title={`把《${title}》发给家人`}
      onClose={requestClose}
      width={520}
      footer={
        <>
          <button type="button" className="dlg__ghost" onClick={requestClose} disabled={busy}>
            {url ? '关闭' : '算了'}
          </button>
          {url ? (
            <button type="button" className="dlg__go" onClick={() => void copy()}>
              {copied ? '复制好了' : '复制链接'}
            </button>
          ) : (
            <button
              type="button"
              className="dlg__go"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? '正在生成…' : until ? '换一条新链接' : '生成链接'}
            </button>
          )}
        </>
      }
    >
      <p className="dlg__hint">
        对方不用登录，打开就能读这一本。默认 {DEFAULT_DAYS} 天后自动失效。
      </p>

      {url ? (
        <>
          <div className="share__url">
            <input
              ref={inputRef}
              className="share__field"
              value={url}
              readOnly
              aria-label="分享链接"
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
          <p className="dlg__hint dlg__hint--warn">
            链接只显示这一次，关掉之后就看不到这条链接了。
          </p>
          <button
            type="button"
            className="share__revoke"
            disabled={busy}
            onClick={() => void revoke()}
          >
            收回链接
          </button>
        </>
      ) : until ? (
        <>
          <p className="dlg__hint">
            链接有效期到：<strong>{dateText(until)}</strong>。
          </p>
          <button
            type="button"
            className="share__revoke"
            disabled={busy}
            onClick={() => void revoke()}
          >
            收回链接
          </button>
        </>
      ) : (
        <p className="dlg__hint">
          {justRevoked
            ? '已经收回：对方手里那条链接现在打不开了。'
            : '还没有分享过这一本。生成之后，链接只出现一次——先复制再关窗。'}
        </p>
      )}

      {error ? <p className="dlg__hint dlg__hint--warn">{error}</p> : null}
    </Dialog>
  )
}
