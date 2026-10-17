'use client'

/**
 * ProfileHome —— `/account`（个人主页）那一屏
 *
 * 用户 2026-10-16 定的形状（**头像 + 昵称 + 手机号（打码）+ 我在这个站上做过什么 + 退出登录**），
 * 2026-10-17 按用户给的参考稿（`E:\match\profile` 那个独立预览稿）改成了**左右两栏**：
 *
 *     左边 个人信息   右边 最近创作
 *
 * ★ 为什么是两栏而不是一列：上一版把"我是谁"和"我做过什么"竖着排在一条轴上，
 *   于是这一屏有**两个焦点**，而竖排读下来是两个都要读的。分开之后一眼就分得清
 *   "左边是这个人、右边是他的东西"——这是参考稿里唯一真正值得抄的东西，
 *   **配色没有抄**（那是另一套蓝，本仓库的令牌只在 `globals.css` 的 `:root` 定义一次，
 *   CLAUDE.md 的硬约束）。抄的是**信息怎么分区**，不是它长什么颜色。
 * ★ 右边**没有作品**时写一句「目前还没有作品，快去创作吧」（用户 2026-10-17 的原话），
 *   句子里那句"快去创作吧"配着头顶那颗「新建绘本」——不是一句干着急的话。
 *
 * ★ 三条判断：
 *
 * 1. **头像是"挑一个"，不是"传一个"**（2026-10-17，用户 2026-10-16 定的：
 *    「头像上传就免了吧，系统给用户几个默认头像，用户可以在那个里面切换」）。
 *    所以这里是一排缩略图，点一下即存（`pickAvatar`）——**没有保存按钮**：
 *    挑头像这件事没有"还没决定"的中间态，看一眼就知道要不要。
 *    ★ 没挑过、或者库里那个 id 认不出来（老数据、手改过的库）时画的是那个
 *    **明确表示"这里空着"的圈**（与侧栏那一格同一个图形）。这是 CLAUDE.md §不糊弄
 *    那条"图没到位就留一个语义上诚实的兜底"：不画假头像，也不留一块空白。
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
import { changePassword, PASSWORD_MIN } from '@/lib/auth/client.ts'
import { maskPhone } from '@/lib/auth/state.ts'
import { AVATARS, avatarSrc } from '@/lib/avatars.ts'

/** 服务端数出来的两个数。★ 它们与"这个人"无关，见文件头第 2 条 */
export type WorkCounts = {
  cards: number
  books: number
}

/**
 * 右边那一列里的一本书。
 *
 * ★ 它是一个**收窄过的**类型，不是把 `BookSummary` 直接拿过来用。
 *   那个类型住在 `lib/library.ts`，而它 import 了整个引擎（`./engine/index.ts`）——
 *   这一个组件是 `'use client'` 的，照搬那份类型会把引擎拖进浏览器包。
 *   （类型在编译期会被抹掉，但 `import type` 之外的东西不会，而这份文件里
 *   一旦有人把它写成普通 import 就再也没有东西提醒他。）
 * ★ 服务端那一页负责把 `BookSummary` 映射成这一份，映射只有一处。
 */
export type RecentBook = {
  bookId: string
  title: string
  pageCount: number
  hasNarration: boolean
  status: 'draft' | 'published'
  createdAt: number
  /** `null` = 这本书没有封面。★ 与 `BookSummary.coverUrl` 同一条规矩：
   *  没有就照实没有，**不许拿第一页冒充封面**（那是"图没到位就留一个诚实的兜底"） */
  coverUrl: string | null
}

/**
 * 「3 天前做的」。
 *
 * ★ 用**做的**那个时刻，不用"更新"：盘上 `Book` 只有一个 `createdAt`，
 *   没有 `updatedAt`——写"上周五更新"就是编一个我们根本没记的数。
 *   参考稿里写的是"更新"，而它那份数据是编的（那是个独立预览稿）。
 * ★ 只精确到"天"：这一屏要回答的是"哪个是我刚做的"，不是"几点几分"。
 */
function madeAgo(at: number): string {
  if (!at) return '不知道什么时候'
  const days = Math.floor((Date.now() - at) / 86_400_000)
  if (days <= 0) return '今天做的'
  if (days === 1) return '昨天做的'
  if (days < 30) return `${days} 天前做的`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前做的`
  return `${Math.floor(months / 12)} 年前做的`
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

/**
 * 那一枚状态标签说的是什么。★ 判据只有这一处，而且**先说草稿**：
 * 一本既没做完、又配了朗读的书，该说的是"还没做完"（那才是它此刻的样子）。
 */
function tagKindOf(book: RecentBook): 'draft' | 'narrated' | 'silent' {
  if (book.status === 'draft') return 'draft'
  return book.hasNarration ? 'narrated' : 'silent'
}

function tagLabelOf(book: RecentBook): string {
  const kind = tagKindOf(book)
  if (kind === 'draft') return '草稿'
  return kind === 'narrated' ? '可朗读' : '还没有声音'
}

/**
 * 头像位置的兜底：**没有头像时**画的那个圈。
 * ★ 与侧栏那一格**同一个图形**（AppShell 的 `AVATAR_ICON`）——两处指的是同一件事，
 *   长得不一样才是错的。
 * ★ 它现在的读者变窄了：以前是"这一屏唯一的头像位"，现在只在"没挑过 / 认不出来"
 *   时才出现（有头像时上面画的是那个 SVG）。**没有删掉**，因为那两个状态是真的会发生的。
 */
function AvatarPlaceholder() {
  return (
    <span className="pf__avatar" data-empty="true" aria-hidden="true">
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

export default function ProfileHome({
  counts,
  books,
}: {
  counts: WorkCounts
  /** 最近做过的几本，新的在前。★ 服务端已经排过序、也截过条数了 */
  books: RecentBook[]
}) {
  const { user, ready, signOut, rename, pickAvatar } = useAuth()
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  /* ── 改密码那三格（2026-10-16 用户要的功能）────────────────────────────────
   * ★ 它是这一屏唯一的"危险动作"，所以三格都要：现在的密码（证明是本人）、
   *   新密码、再输一遍（打错一个字符就再也进不来了，而这一轮**没有找回密码**）。
   * ★ 状态分两处（`pwStatus` 是进行中/成功，`pwError` 是失败）而不是一处：
   *   合成一个的话，失败时那句"改好了"会先闪一下再被覆盖，
   *   而"改密码"这件事上闪一下是最不该有的东西。 */
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwStatus, setPwStatus] = useState('')
  const [pwError, setPwError] = useState('')
  /**
   * 挑头像那两格。★ 与别的 state 一起**写在最上面**，不在下面那段里：
   *   下面那个 `if (!ready || !user) return` 之后写 `useState` 会让 hook 顺序
   *   随着"登录没登录"变化（React 的规则禁止，lint 当场就报）。
   *   `avatarPending` 是**正在存的那一个 id**（不是布尔）：一次只存一个，
   *   而"哪一个是它"决定了哪一格该变淡。
   */
  const [avatarPending, setAvatarPending] = useState<string | null>(null)
  const [avatarNote, setAvatarNote] = useState('')

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
  /**
   * 这一屏上那个大名字。
   *
   * ★ 顺序是**昵称 → 打码手机号 → 账号本身**。第三档是 2026-10-17 补的：
   *   短账号（演示账号 `123456`、站长号）**没有手机号**，而昵称可以一直是空的
   *   ——前两档都取不到时，这里此前会渲染出一个**空的名字**（实测：
   *   以站长号打开这一屏，`.pf__name` 是一个空 `<p>`）。空着比"显示一个账号"
   *   更坏：那个位置是这一栏的第一焦点。
   * ★ 第三档用的是 `user.account`（登录名）而不是编一个"用户 5"：
   *   账号是这个人自己知道的那个字符串，编出来的名字他不认识。
   */
  const displayName = user.nickname.trim() || maskPhone(user.phone) || user.account

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

  /** 这一屏最上面那个头像。★ 与服务端那一份是同一个判据（`avatarSrc`），不各判一次 */
  const myAvatar = avatarSrc(user.avatar)
  /** 有几本真的会念。★ 这一条是**数出来的**，不是编的（参考稿那个"38 次朗读"是假数） */
  const narrated = books.filter((book) => book.hasNarration).length
  /**
   * 挑一个头像。★ **点一下即存**，没有保存按钮：这件事没有"还没决定"的中间态。
   * ★ 存的时候**不禁用那一排**：禁用了的话，用户连点两下会看到第一下之后整排变灰，
   *   而真正需要的是"最后点的那一下赢"。所以只把 `aria-busy` 挂上，失败时说一句。
   */
  const chooseAvatar = async (id: string): Promise<void> => {
    if (avatarPending) return
    setAvatarNote('')
    setAvatarPending(id)
    try {
      await pickAvatar(id)
      setAvatarNote('换好了')
    } catch (error) {
      // ★ 说"没换成"，不说"换好了"（与改昵称、改密码同一条判断）
      setAvatarNote(error instanceof Error ? error.message : '没换成')
    } finally {
      setAvatarPending(null)
    }
  }

  const savePassword = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (pwStatus === '改密码中…') return
    setPwError('')
    if (newPassword.length < PASSWORD_MIN) {
      setPwError(`新密码至少 ${PASSWORD_MIN} 位`)
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('两次输入的新密码不一致')
      return
    }
    setPwStatus('改密码中…')
    const result = await changePassword(currentPassword, newPassword)
    if (!result.ok) {
      setPwStatus('')
      // ★ 说"没改成"并带上后端那句话（"现在的密码不对"是最常见的一种），
      //   不能只说"保存失败"
      setPwError(result.message)
      return
    }
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPwStatus('改好了')
  }

  return (
    <section className="pf">
      {heading}

      <div className="pf__spread">
        {/* ── 左边：这个人 ──────────────────────────────────────────────────
            ★ 一栏里只有一个焦点。"我是谁"这件事下辖三块（身份 / 头像与昵称 /
            账号信息与退出），它们是同一件事的三个层次，竖着排是**对的**——
            错的是原来把它们和"我做过什么"排在同一条轴上。 */}
        <aside className="pf__card">
          <div className="pf__identity">
            {/* ★ 挑过的就画那一个；没挑过 / 认不出来才是那个空圈。
                认不出来时不报错、也不回落成某一个默认头像——见 `lib/avatars.ts` 文件头 */}
            {myAvatar ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="pf__avatar" src={myAvatar} alt="" width={72} height={72} />
            ) : (
              <AvatarPlaceholder />
            )}
            <p className="pf__kicker">个人主页</p>
            <p className="pf__name">{displayName}</p>
            {/* ★ 短账号没有手机号（`AuthUser.phone` 可空），那时这一行**根本不渲染**：
                一个空的 `<p>` 会在名字下面留一段说不清的空隙——
                而"这个人没有手机号"这件事由下面那张表里的「手机号」那格说
                （那里写的是账号本身，见 `maskPhone` 的兜底） */}
            {user.phone ? <p className="pf__phone">{maskPhone(user.phone)}</p> : null}
            {/* ★ 这两枚标签**都是真的数**：一个是这台服务器上有几张卡，
                一个是有几本真的会念。参考稿那两枚（"创作中""38 次朗读"）
                是编的——这里不编。 */}
            <div className="pf__tags">
              <span className="pf__tag">{counts.cards} 张角色卡</span>
              <span className="pf__tag pf__tag--soft">{narrated} 本可朗读</span>
            </div>
          </div>

          {/* ── 挑一个头像（工单 08；2026-10-17 用户要求把那六个手写的 SVG 换掉）──
              ★ 一排缩略图，点一下即存（`chooseAvatar`）。当前那个带描边，
              `role="radio"` + `aria-checked` 说给读屏——这**是**一组单选，
              读屏该听到"六个选一个、当前是第三个"，而不是六个独立按钮。
              ★ 缩略图 `alt=""`：名字在 `<button>` 的 `aria-label` 里，念两遍是噪音。 */}
          <div className="pf__avatars" role="radiogroup" aria-label="挑一个头像">
            {AVATARS.map((item) => {
              const chosen = user.avatar === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className="pf__avatar-pick"
                  role="radio"
                  aria-checked={chosen}
                  aria-label={item.name}
                  aria-busy={avatarPending === item.id}
                  title={item.name}
                  onClick={() => void chooseAvatar(item.id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={avatarSrc(item.id) ?? ''} alt="" width={44} height={44} />
                </button>
              )
            })}
          </div>
          <p className="pf__status" role="status">
            {avatarNote}
          </p>

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

          <dl className="pf__meta">
            <div>
              <dt>手机号</dt>
              {/* ★ 没有手机号时写的是**账号**（短账号就是这样）——
                  留一个空的 `<dd>` 会让这一格看起来像坏了 */}
              <dd>{user.phone ? maskPhone(user.phone) : `${user.account}（短账号）`}</dd>
            </div>
            <div>
              <dt>首次登录</dt>
              <dd>{formatJoined(user.createdAt)}</dd>
            </div>
            <div>
              <dt>登录方式</dt>
              {/* ★ 这句话是**如实**的：这个账号两条路都走得通（验证码与密码），
                  见 Java 的 `AuthService#login` 与 `#verifyCode` */}
              <dd>手机号 + 验证码 / 密码</dd>
            </div>
          </dl>

          <button className="pf__ghost" type="button" onClick={signOut}>
            退出登录
          </button>
        </aside>

        {/* ── 右边：他做过的东西 ─────────────────────────────────────────── */}
        <div className="pf__work">
          <header className="pf__work-head">
            <div>
              <h2 className="pf__work-title">我的创作</h2>
              {/* ★ 这句话里那个说法是**有意的**（文件头第 2 条）：这些书是真的，
                  但它们此刻还没跟这个人关联——同一台服务器上谁打开都看到这一批。 */}
              <p className="pf__work-sub">
                这台服务器上做过的每一本，新的在最上面——还没有按账号分开。
              </p>
            </div>
            <Link className="pf__new" href="/home">
              新建绘本
            </Link>
          </header>

          {books.length === 0 ? (
            <p className="pf__empty">目前还没有作品，快去创作吧</p>
          ) : (
            <ul className="pf__recent">
              {books.map((book) => (
                <li key={book.bookId}>
                  <Link className="pf__book" href={`/reader/${book.bookId}`}>
                    <span className="pf__cover">
                      {book.coverUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={book.coverUrl} alt="" width={74} height={74} />
                      ) : (
                        /* ★ 没有封面就**什么都不画**（不是拿第一页冒充）
                            ——`alt=""` 的 `<img>` 在 404 时也不会留碎图标 */
                        <span className="pf__cover-blank" aria-hidden="true" />
                      )}
                    </span>
                    <span className="pf__book-body">
                      <span className="pf__book-title">{book.title}</span>
                      <span className="pf__book-meta">
                        {book.pageCount} 页 · {madeAgo(book.createdAt)}
                      </span>
                    </span>
                    {/* ★ 这一枚说的是**这本书现在是什么**，不是"我做过什么"：
                        草稿 / 可朗读 / 还没有声音。三选一，没有一句是空话 */}
                    <span className="pf__book-tag" data-kind={tagKindOf(book)}>
                      {tagLabelOf(book)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="pf__quick">
            <Link className="pf__quick-item" href="/character">
              <span className="pf__quick-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path
                    d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span>
                <span className="pf__quick-title">管理角色</span>
                <span className="pf__quick-desc">改称呼、外貌与喜欢的物件</span>
              </span>
            </Link>
            <Link className="pf__quick-item" href="/voice">
              <span className="pf__quick-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path
                    d="M12 4v16m0-16a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span>
                <span className="pf__quick-title">声音与朗读</span>
                <span className="pf__quick-desc">选一个音色，之后每本书都用它念</span>
              </span>
            </Link>
          </div>
        </div>
      </div>

      {/* ── 密码 ──────────────────────────────────────────────────────────
          ★ 它横跨整宽、在两栏**下面**，而不是塞进左边那张身份卡：
            改密码是一件"不常发生、但很重"的事（它会把别处的会话全踢下线），
            混在昵称与挑头像中间会让它看着与改个名字一样轻。
            放右边那一栏也不对——那里是"我做过什么"。 */}
      <h2 className="pf__section">密码</h2>
      <form className="pf__pw" onSubmit={(event) => void savePassword(event)}>
        {/* ★ 三格的 `autoComplete` 分别是 current-password / new-password：
            浏览器据此知道"这是改密码"，而不是把新密码当成登录口令存下来 */}
        <label className="pf__pw-row" htmlFor="pw-current">
          <span className="pf__rename-label">现在的密码</span>
          <span className="pf__box">
            <input
              id="pw-current"
              className="pf__input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value)
                setPwError('')
              }}
            />
          </span>
        </label>
        <label className="pf__pw-row" htmlFor="pw-new">
          <span className="pf__rename-label">新密码</span>
          <span className="pf__box">
            <input
              id="pw-new"
              className="pf__input"
              type="password"
              placeholder={`至少 ${PASSWORD_MIN} 位`}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value)
                setPwError('')
              }}
            />
          </span>
        </label>
        <label className="pf__pw-row" htmlFor="pw-confirm">
          <span className="pf__rename-label">再输一遍</span>
          <span className="pf__box">
            <input
              id="pw-confirm"
              className="pf__input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value)
                setPwError('')
              }}
            />
          </span>
        </label>
        <div className="pf__pw-actions">
          <button
            className="pf__save"
            type="submit"
            disabled={!currentPassword || !newPassword || pwStatus === '改密码中…'}
          >
            {pwStatus === '改密码中…' ? '改密码中' : '改密码'}
          </button>
          <span className="pf__status" role="status">
            {pwError || pwStatus}
          </span>
        </div>
        {/* ★ 这句是"改密码"的另一半，必须写在按钮旁边：改完之后**别处**的会话会失效，
            而"这一台"不会（服务端会发一张新票回来）。不写的话，
            用户不知道他刚刚把谁踢下线了——而那正是他要的结果 */}
        <p className="pf__hint">改完之后，别的设备上登着的会话会失效，这一台不用重新登录。</p>
      </form>
    </section>
  )
}
