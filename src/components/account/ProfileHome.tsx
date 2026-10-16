'use client'

/**
 * ProfileHome —— `/account`（个人主页）那一屏
 *
 * 用户 2026-10-16 定的形状：**头像 + 昵称 + 手机号（打码）+ 我在这个站上做过什么 + 退出登录**。
 * 侧栏底部那一格登录之后指的就是这里。
 *
 * ★ 三条判断：
 *
 * 1. **头像此刻没有，所以它是一个说得清的占位。** `AuthUser` 里根本没有这个字段——
 *    上传要后端（要存、要缩、要过审），这一轮不做。与其画一张假头像，
 *    不如画一个**明确表示"这里空着"的圈**（与侧栏那一格同一个图形），
 *    并在旁边直说「等接了后端再传」。这是 CLAUDE.md §不糊弄 里那条
 *    "图没到位就留一个语义上诚实的兜底"的同一件事。
 *
 * 2. **作品数写的是「这台设备上」，不是「你的」。** 数字是真的（服务端数的），
 *    但它们此刻**还没跟这个人关联**——换一台设备、换一个账号登进来，看到的是同一批。
 *    所以那两个字不是谦虚：等后端把书挂到 userId 上，它才配改成「你的」。
 *    在那之前写「你的」是在编一个关系。
 *
 * 3. **未登录时这一屏不空着、也不假装。** 侧栏那一格会变成「请登录」，
 *    但人可能直接输 `/account` 进来。那时给一张"还没登录"的纸 + 一颗去登录的按钮，
 *    而不是一个转圈、也不是一个 404。
 */

import Link from 'next/link'
import { useState } from 'react'

import { useAuth } from '@/components/auth/AuthProvider.tsx'
import { maskPhone } from '@/lib/auth/state.ts'

/** 服务端数出来的两个数。★ 它们与"这个人"无关，见文件头第 2 条 */
export type WorkCounts = {
  cards: number
  books: number
}

/**
 * 首次登录时间。
 *
 * ★ `toLocaleString` 带 `zh-CN` 与固定的字段表，不用 `toLocaleDateString` 的默认值——
 *   默认值跟着运行环境走（服务端与浏览器可能不是同一个），而这个组件只在客户端渲染
 *   （它读 `useAuth()`），所以这里没有 hydration 风险；但把格式写死仍然更稳，
 *   换个 node / 换个浏览器不会突然多出个 "GMT+8"。
 */
function formatJoined(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '记不清了'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 头像位置的占位。★ 与侧栏那一格**同一个图形**（AppShell 的 `AVATAR_ICON`）——
    两处指的是同一件事，长得不一样才是错的 */
function AvatarPlaceholder() {
  return (
    <span className="pf__avatar" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path
          d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5.4a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5ZM6.9 18.2a6.25 6.25 0 0 1 10.2 0"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

export default function ProfileHome({ counts }: { counts: WorkCounts }) {
  const { user, ready, signOut, rename } = useAuth()
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  const heading = (
    <header className="pf__head">
      <h1 className="pf__title">个人主页</h1>
      {/* ★ 页头压在天空带里（`(studio)` 的 layout 给了 `StudioBackdrop`），
          所以次级文字是 `--ink-on-sky` 而不是 `--ink-muted`（十带表，
          `studio-backdrop.css` 文件头） */}
      <p className="pf__sub">这个站上「谁在用」就记在这儿。</p>
    </header>
  )

  /**
   * ★ 还没读完本机那份登录态。只在 hydration 后的一瞬间出现，
   *   但**不能返回 `null`**——那会让整页从"只有标题"跳到"有内容"，
   *   高度差一次就是一次可见的抖动。所以框壳先在（与未登录那副面孔同一个框）。
   */
  if (!ready) {
    return (
      <section className="pf">
        {heading}
        <div className="pf__card pf__card--blank" aria-busy="true" />
      </section>
    )
  }

  if (!user) {
    return (
      <section className="pf">
        {heading}
        <div className="pf__card">
          <p className="pf__lede">这台设备上还没有人登录过。</p>
          <Link className="pf__primary" href="/login?next=%2Faccount">
            去登录
          </Link>
        </div>
      </section>
    )
  }

  // ★ 昵称的草稿只在开始改之后才有值；没动过就跟着已保存的那个走
  const nickname = draft ?? user.nickname
  const dirty = nickname.trim() !== user.nickname
  const displayName = user.nickname.trim() || maskPhone(user.phone)

  const saveNickname = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!dirty || status === '保存中…') return
    setStatus('保存中…')
    try {
      await rename(nickname)
      setDraft(null)
      setStatus('已保存')
    } catch (error) {
      // ★ 说"没改成"，不说"改好了"（`AuthProvider` 里那条同一个判断）
      setStatus(error instanceof Error ? error.message : '没保存成功')
    }
  }

  return (
    <section className="pf">
      {heading}

      <div className="pf__card">
        <div className="pf__identity">
          <AvatarPlaceholder />
          <div className="pf__who">
            <p className="pf__name">{displayName}</p>
            <p className="pf__phone">{maskPhone(user.phone)}</p>
          </div>
          <button className="pf__ghost" type="button" onClick={signOut}>
            退出登录
          </button>
        </div>

        <dl className="pf__meta">
          <div>
            <dt>首次登录</dt>
            <dd>{formatJoined(user.createdAt)}</dd>
          </div>
          <div>
            <dt>头像</dt>
            {/* ★ 直说没有。换后端之后这一行会跟着那颗圈一起消失 */}
            <dd>还没传过——要等接了后端才能上传。</dd>
          </div>
        </dl>

        <form className="pf__rename" onSubmit={(event) => void saveNickname(event)}>
          <label className="pf__rename-label" htmlFor="nickname">
            昵称
          </label>
          <span className="pf__box">
            <input
              id="nickname"
              className="pf__input"
              type="text"
              name="nickname"
              // ★ 空串是合法值（"还没起过"），所以这里**没有** `required`：
              //   把昵称清空是一件允许的事，清空之后侧栏那一格会退回打码手机号
              placeholder="还没起过——留空就用手机号"
              maxLength={24}
              value={nickname}
              onChange={(event) => {
                setDraft(event.target.value)
                setStatus('')
              }}
            />
          </span>
          <button className="pf__save" type="submit" disabled={!dirty || status === '保存中…'}>
            {status === '保存中…' ? '保存中' : '保存'}
          </button>
          {/* `aria-live`：改完名字这件事只有眼睛看得见的话，读屏的人不知道成了没有 */}
          <span className="pf__status" role="status">
            {status}
          </span>
        </form>
      </div>

      <h2 className="pf__section">这台设备上做过的东西</h2>
      {/* ★ 标题那两个字是**有意的**，见文件头第 2 条：这两个数是真的，
          但它们此刻还没跟这个人关联 */}
      <div className="pf__stats">
        <Link className="pf__stat" href="/character">
          <span className="pf__stat-num">{counts.cards}</span>
          <span className="pf__stat-label">张角色卡</span>
        </Link>
        <Link className="pf__stat" href="/shelf">
          <span className="pf__stat-num">{counts.books}</span>
          <span className="pf__stat-label">本书</span>
        </Link>
      </div>

      <p className="pf__foot">
        作品还只记在这台设备上——接上后端之后，它们会跟着这个账号走。
        <Link className="pf__again" href="/home">
          回创作
        </Link>
      </p>
    </section>
  )
}
