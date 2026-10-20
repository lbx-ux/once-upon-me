'use client'

/**
 * ProfileHome —— `/account`（个人主页）那一屏
 *
 * 用户 2026-10-16 定的形状（头像 + 昵称 + 手机号（打码）+ 我在这个站上做过什么 + 退出登录），
 * 2026-10-17 按用户给的参考稿（`E:\match\profile` 那个独立预览稿）改成了左右两栏：
 *
 *     左边 个人信息   右边 最近创作
 *
 * 为什么是两栏而不是一列：上一版把"我是谁"和"我做过什么"竖着排在一条轴上，
 *   于是这一屏有两个焦点，而竖排读下来是两个都要读的。分开之后一眼就分得清
 *   "左边是这个人、右边是他的东西"——这是参考稿里唯一真正值得抄的东西，
 *   配色没有抄（那是另一套蓝，本仓库的令牌只在 `globals.css` 的 `:root` 定义一次，
 *   CLAUDE.md 的硬约束）。抄的是信息怎么分区，不是它长什么颜色。
 *   2026-10-17 当天晚些时候改口了：用户说「复刻一下背景」，于是配色也抄了
 *   ——但抄的方式是把它变成一组 `--pf-*` 令牌 + 一层 `ProfileBackdrop`
 *   （整屏那三团蓝光晕）＋ 身份卡顶上那张水彩（`SCENE` 那里有全部理由）。
 *   上面那句"配色没有抄"因此只对了一半：抄了，但仍然是这一屏自己的令牌组，
 *   全站那颗橙一个像素都没动。两句话都留着——第二句是这句话的下文。
 * 右边没有作品时写一句「目前还没有作品，快去创作吧」（用户 2026-10-17 的原话），
 *   句子里那句"快去创作吧"配着头顶那颗「新建绘本」——不是一句干着急的话。
 *
 * 版式上最要紧的一条：身份卡里只有一个焦点区，就是顶上那一格
 *   （`.pf__stage`：水彩 + 压在左下角的头像 + 一条胶带）。原来那个位置是一颗
 *   光秃秃的 64px 头像 + 四行字，读起来像一张表单；现在这一格与右栏那些书
 *   一样，是一件被摆在纸上的东西。
 *
 * 三条判断：
 *
 * 1. 头像是站点常量，不是用户数据（2026-10-17 用户改口：「算了吧，只提供一个默认头像，
 *    然后用户不可以切换，生成一个头像，符合当前项目的」）。原来这里是一排缩略图
 *    （工单 08，六张手写 SVG，点一下即存）——整排拆掉，那一格现在与侧栏那一格
 *    画的是同一张图。随之没有了的还有"认不出的 id 画一个空圈"那条兜底：
 *    它守的是用户数据才有的问题，而这里已经没有用户数据了。
 *    图本身与它为什么是暖色，见 `lib/avatars.ts` 的文件头。
 *
 * 2. 改密码是一个按钮 + 一个弹窗（2026-10-17 用户：「更换密码弄一个按钮，
 *    然后点击更好密码就出现一个弹窗」）。原来它是这一屏最下面横跨整宽的一段
 *    （带一张自己的纸），现在是身份卡底部的两颗按钮之一。
 *    成功与失败的落点刻意不在一处：失败留在弹窗里（要在那儿改输入），
 *      成功则关掉弹窗、在那颗按钮旁边说一句——动作已经结束了，弹窗没有理由留着。
 *
 * 3. 作品数写的是「你的」（2026-10-17 工单 16 起）。在那之前这里写的是
 *    「这台设备上」：数字是真的（服务端数的），但那时它们还没跟这个人关联，
 *    换一台设备、换一个账号登进来看到的是同一批。挂到 userId 上之后才配说「你的」。
 *
 * 4. 未登录时这一屏不空着、也不假装。 侧栏那一格会变成「请登录」，
 *    但人可能直接输 `/account` 进来。那时给一张"还没登录"的纸 + 一颗去登录的按钮，
 *    而不是一个转圈、也不是一个 404。
 */

import Link from 'next/link'
import { useRef, useState } from 'react'

import { useAuth } from '@/components/auth/AuthProvider.tsx'
import Dialog from '@/components/dialog/Dialog.tsx'
import { changePassword, PASSWORD_MIN } from '@/lib/auth/client.ts'
import { maskPhone } from '@/lib/auth/state.ts'
import { DEFAULT_AVATAR } from '@/lib/avatars.ts'

/** 服务端数出来的两个数。★ 它们与"这个人"无关，见文件头第 2 条 */
export type WorkCounts = {
  cards: number
  books: number
}

/**
 * 右边那一列里的一本书。
 *
 * 它是一个收窄过的类型，不是把 `BookSummary` 直接拿过来用。
 *   那个类型住在 `lib/library.ts`，而它 import 了整个引擎（`./engine/index.ts`）——
 *   这一个组件是 `'use client'` 的，照搬那份类型会把引擎拖进浏览器包。
 *   （类型在编译期会被抹掉，但 `import type` 之外的东西不会，而这份文件里
 *   一旦有人把它写成普通 import 就再也没有东西提醒他。）
 * 服务端那一页负责把 `BookSummary` 映射成这一份，映射只有一处。
 */
export type RecentBook = {
  bookId: string
  title: string
  pageCount: number
  hasNarration: boolean
  status: 'draft' | 'published'
  createdAt: number
  /** `null` = 这本书没有封面。★ 与 `BookSummary.coverUrl` 同一条规矩：
   *  没有就照实没有，不许拿第一页冒充封面（那是"图没到位就留一个诚实的兜底"）
   */
  coverUrl: string | null
}

/**
 * 「3 天前做的」。
 *
 * 用做的那个时刻，不用"更新"：盘上 `Book` 只有一个 `createdAt`，
 *   没有 `updatedAt`——写"上周五更新"就是编一个我们根本没记的数。
 *   参考稿里写的是"更新"，而它那份数据是编的（那是个独立预览稿）。
 * 只精确到"天"：这一屏要回答的是"哪个是我刚做的"，不是"几点几分"。
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
 * `toLocaleString` 带 `zh-CN` 与固定的字段表，不用 `toLocaleDateString` 的默认值——
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
 * 那一枚状态标签说的是什么。★ 判据只有这一处，而且先说草稿：
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
 * 身份卡顶上那张水彩（2026-10-17，用户「复刻一下背景」时一起要的）。
 *
 * 用的是 `public/art/cloud.webp`——本站自己那 12 张主题插画里的一张，
 *   不是外面找来的图。理由三条，按重要性排：
 *   1. 它没有脸。 参考稿那张 `cover.jpg` 是从 `login/assets` 拿的场景图；
 *      而本站可选的横图里，几本书的内页（`public/book/spread-*`）都是有人的——
 *      裁成 1.9:1 的横幅必然把头切掉一半，那是"图没到位"而不是"风格不同"。
 *   2. 它是冷的。 这一屏整屏转蓝，而 `public/art/` 里另外两张浅底的
 *      （`balloon` 的暖橘云、`paint` 的绿池塘）摆进那张卡都是一块不在调子里的斑。
 *   3. 它经得起裁。 源图 1280×720（1.78），横幅盒约 1.9:1，
 *      纵向只多出 约 11px 的余量——几乎不裁，云团整个留着。
 *      （书里那几张是 1.50，裁到 1.9 要切掉四成高度，构图必坏。）
 *
 * 它不是 `next/image`：一张装饰性的本地 webp、`alt=""`、没有 LCP 意义——
 *   与侧栏那颗 `brand/mark.webp`、文章里几处同一个处理（docs/known-tradeoffs.md「刻意未做」）。
 *   `width`/`height` 给的是渲染尺寸的近似，只为占位不让卡片跳；
 *   真正的尺寸由 `.pf__stage` 的 `aspect-ratio` 定（见 profile-home.css）。
 */
const SCENE = '/art/cloud.webp'

/**
 * 头像是站点常量，不再是这个人挑过的那一个（见文件头第 1 条）。
 *   它压在那张水彩的左下角（`.pf__avatar` 是绝对定位），盒子 92px、4px 白描边
 *   ——那里原来在"挑过的那张"与"一个空圈"之间换着画，现在只有这一张。
 *   `alt=""`：这一栏的文字就在它下面（名字、手机号、两枚标签），
 *     再念一遍"一朵云"是噪音。
 */
const AVATAR = DEFAULT_AVATAR

export default function ProfileHome({
  counts,
  books,
}: {
  counts: WorkCounts
  /** 最近做过的几本，新的在前。★ 服务端已经排过序、也截过条数了 */
  books: RecentBook[]
}) {
  const { user, ready, signOut, rename } = useAuth()
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  /* 改密码（2026-10-16 用户要的功能；2026-10-17 改成按钮 + 弹窗）
   * 三格都要：现在的密码（证明是本人）、新密码、再输一遍（打错一个字符就再也
   *   进不来了，而这一轮没有找回密码）。
   * 状态分几处而不是一处，每一处对着一个不同的落点：
   *   `pwError` 留在弹窗里（用户要在这儿改输入）、`pwStatus` 是弹窗里的"进行中"、
   *   `pwDone` 在弹窗外那颗按钮旁边（动作已经结束，弹窗没有理由再留着）。
   *   合成一个的话，失败时那句"改好了"会先闪一下再被覆盖，
   *     而"改密码"这件事上闪一下是最不该有的东西。
   */
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwOpen, setPwOpen] = useState(false)
  const [pwStatus, setPwStatus] = useState('')
  const [pwError, setPwError] = useState('')
  /** 改完在那颗按钮旁边说的那一句。★ 与 `status`（改昵称那句）分开：两件事各说各的 */
  const [pwDone, setPwDone] = useState('')
  /**
   * 打开弹窗的那颗按钮。
   *
   * `Dialog` 刻意不管"关掉之后焦点还给谁"（它文件头最后一条：那件事只有调用方
   *   知道，壳里猜一个落点就把它变成了一个默认值）。这里调用方知道：就是这一颗。
   *   不还的话焦点会掉到 `<body>` 上，键盘用户要重新 Tab 一长串才回得来。
   */
  const pwButtonRef = useRef<HTMLButtonElement | null>(null)

  const heading = (
    <header className="pf__head">
      <h1 className="pf__title">个人主页</h1>
      {/* ★ 页头直接坐在那层蓝底上（`AppShell` 在这一屏挂的是 `ProfileBackdrop`，
          不是 `StudioBackdrop`），所以次级文字是 `--pf-ink-on-wash`
          而不是 `--ink-muted`（那张表与那条"这一层上不许用谁"的法律，
          见 `profile-backdrop.css` 文件头） */}
      <p className="pf__sub">这个站上「谁在用」就记在这儿。</p>
    </header>
  )

  /**
   * 还没读完本机那份登录态。只在 hydration 后的一瞬间出现，
   *   但不能返回 `null`——那会让整页从"只有标题"跳到"有内容"，
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

  // 昵称的草稿只在开始改之后才有值；没动过就跟着已保存的那个走
  const nickname = draft ?? user.nickname
  const dirty = nickname.trim() !== user.nickname
  /**
   * 这一屏上那个大名字。
   *
   * 顺序是昵称 → 打码手机号 → 账号本身。第三档是 2026-10-17 补的：
   *   短账号（演示账号 `123456`、站长号）没有手机号，而昵称可以一直是空的
   *   ——前两档都取不到时，这里此前会渲染出一个空的名字（实测：
   *   以站长号打开这一屏，`.pf__name` 是一个空 `<p>`）。空着比"显示一个账号"
   *   更坏：那个位置是这一栏的第一焦点。
   * 第三档用的是 `user.account`（登录名）而不是编一个"用户 5"：
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
      // 说"没改成"，不说"改好了"（`AuthProvider` 里那条同一个判断）
      setStatus(error instanceof Error ? error.message : '没保存成功')
    }
  }

  /** 有几本真的会念。★ 这一条是数出来的，不是编的（参考稿那个"38 次朗读"是假数） */
  const narrated = books.filter((book) => book.hasNarration).length

  /**
   * 正在改。
   * ★ 从 `pwStatus` 上算出来、不另存一格：两份状态会漂，而漂的那一刻的症状是
   *   "按钮已经变回可点、请求还在飞"（再点一下就是第二条请求）。
   */
  const pwBusy = pwStatus === '改密码中…'

  /**
   * 关掉改密码那个弹窗。★ 三格一律清空，不管是改成了还是点了「算了」：
   *   把刚打进去的两个新密码留在内存里、下次打开还显示着，是这一屏最不该有的一种便利。
   * 焦点还回那颗按钮（`Dialog` 刻意不管这件事，理由见上面 `pwButtonRef`）。
   */
  const closePassword = (): void => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPwStatus('')
    setPwError('')
    setPwOpen(false)
    pwButtonRef.current?.focus()
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
      // 说"没改成"并带上后端那句话（"现在的密码不对"是最常见的一种），
      //   不能只说"保存失败"。★ 这一句留在弹窗里，用户要在这儿改输入
      setPwError(result.message)
      return
    }
    // 成功：关掉弹窗，在那颗按钮旁边说一句。焦点由 `closePassword` 还回去，
    //   所以读屏念得到这一句（它就在刚拿回焦点的那颗按钮边上）
    setPwDone('密码改好了')
    closePassword()
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
          {/* ── 那张水彩 + 压在它左下角的头像（2026-10-17，参考稿的 `.id-card__stage`）──
              ★ 头像从 `.pf__identity` 里**搬进了这一格**：参考稿把它放在画面左下角，
                而"头像在名字上面"与"头像压在照片角上"是两种版式，不能各留一半。
                搬进来之后 `.pf__identity` 只剩四行字，那片竖排的左缘反而更整齐。
              ★ 画的顺序（css 里定）：水彩 → 一层往纸色收的渐变 → 头像与胶带。
                那层渐变（`.pf__stage::after`）是**承重的**：没有它，水彩的底边
                与白卡之间是一条硬边，而头像那圈白描边也就没有东西可以咬住。 */}
          <div className="pf__stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pf__scene" src={SCENE} alt="" width={664} height={352} />
            {/* ★ 所有人都画这**同一张**（站点常量，不是这个人挑过的那一个）。
                原来这里是"挑过的那张 / 认不出的空圈"二选一，那条分支随
                "只提供一个默认头像、不可以切换"一起没有了——见文件头第 1 条 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pf__avatar" src={AVATAR} alt="" width={92} height={92} />
            {/* 一条手撕胶带。★ 它说的是"这张照片是贴在这张卡上的"——
                与角色墙那块 mat、手写标签同一支笔（"物件"那一支），不是装饰花纹 */}
            <span className="pf__tape" aria-hidden="true" />
          </div>

          <div className="pf__identity">
            <p className="pf__kicker">个人主页</p>
            <p className="pf__name">{displayName}</p>
            {/* ★ 短账号没有手机号（`AuthUser.phone` 可空），那时这一行**根本不渲染**：
                一个空的 `<p>` 会在名字下面留一段说不清的空隙——
                而"这个人没有手机号"这件事由下面那张表里的「手机号」那格说
                （那里写的是账号本身，见 `maskPhone` 的兜底） */}
            {user.phone ? <p className="pf__phone">{maskPhone(user.phone)}</p> : null}
            {/* ★ 这两枚标签**都是真的数**（2026-10-17 工单 16 起：都是**这个人的**数）：
                一个是他的角色卡有几张，一个是有几本真的会念。参考稿那两枚
                （"创作中""38 次朗读"）是编的——这里不编。 */}
            <div className="pf__tags">
              <span className="pf__tag">{counts.cards} 张角色卡</span>
              <span className="pf__tag pf__tag--soft">{narrated} 本可朗读</span>
            </div>
          </div>

          <form className="pf__rename" onSubmit={(event) => void saveNickname(event)}>
            <label className="pf__field-label" htmlFor="nickname">
              昵称
            </label>
            <span className="pf__box">
              <input
                id="nickname"
                className="pf__input"
                type="text"
                name="nickname"
                // 空串是合法值（"还没起过"），所以这里没有 `required`：
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
          </dl>

          {/* ── 这一栏底部的两个动作（2026-10-17）───────────────────────────────
              ★ 「登录方式」那一行（手机号 + 验证码 / 密码）在这天被用户划掉了
                （「这个什么方式登录的就不要写了」）——那句话说的事**用户自己知道**
                （他刚刚就是这么进来的），而这一栏的位置该留给能点得动的东西。
              ★ 两颗**并排**、一静一重：左边那颗改密码是日常动作，右边那颗退出登录
                是这一栏里唯一**不可逆**的动作，所以只有它长成 danger 那一支
                （`.pf__ghost--danger`，见 css）。原来那条规则是"这张卡里所有 ghost
                都是红的"——多一颗按钮之后它就不成立了：把改密码也涂红是在说
                "这件事很危险"，而它不比改昵称危险多少。 */}
          <div className="pf__actions">
            <button
              className="pf__ghost"
              type="button"
              ref={pwButtonRef}
              onClick={() => {
                setPwDone('')
                setPwOpen(true)
              }}
            >
              修改密码
            </button>
            <button className="pf__ghost pf__ghost--danger" type="button" onClick={signOut}>
              退出登录
            </button>
          </div>
          {/* 改成了的那一句。★ 它在**弹窗外面**、紧挨着刚拿回焦点的那颗按钮：
              动作已经结束，那句回话就不该再窝在一个已经关掉的窗口里 */}
          <p className="pf__status" role="status">
            {pwDone}
          </p>
        </aside>

        {/* ── 右边：他做过的东西 ─────────────────────────────────────────── */}
        <div className="pf__work">
          <header className="pf__work-head">
            <div>
              <h2 className="pf__work-title">我的创作</h2>
              {/* ★ 2026-10-17（工单 16）：这句话原来写的是"这台服务器上做过的每一本，
                  还没有按账号分开"——那句话当时是对的，现在不对了，所以连同它上面
                  那段注释一起改掉（留着一句过期的话，比没有这句话更坏）。 */}
              <p className="pf__work-sub">你做过的每一本，新的在最上面。</p>
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
                        /* 没有封面就什么都不画（不是拿第一页冒充）
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
                {/* ★ 2026-10-17 用户划掉了原来那句里的「喜欢的物件」：「改称呼、外貌与喜欢的物件」
                    → 「改称呼与外貌」。删掉之后那两个词也一起收了（`、` 后面只剩一项读不通）。
                    ★ 记一笔**它原来也不算错**：角色卡那一屏确实还能改「他喜欢什么」
                    （`ChildDetail` 的「改基础信息」里有，那两句实话写在那儿）。
                    所以这一句现在比那一屏能做的事**少说了一样**——是"说得少"，不是"说错了"，
                    与这一站那条"没有的东西直说没有"不冲突。
                    要补回来的话，照那一屏自己的说法写（「他喜欢什么」），
                    别再造一个 `ProfileHome` 自己的词——「喜欢的物件」就是上次那么来的。 */}
                <span className="pf__quick-desc">改称呼与外貌</span>
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

      {/* ── 改密码：一个弹窗（2026-10-17 用户：「更换密码弄一个按钮，
             然后点击更好密码就出现一个弹窗」）──────────────────────────────────
          ★ 它原来横跨整宽、在两栏**下面**（一张自己的纸，顶上一颗「密码」标题）。
            改成弹窗之后那两个理由都还在，只是换了个承载方式：改密码是"不常发生、
            但很重"的事（它会把别处的会话全踢下线），摆在旁边会让它看着与改个名字
            一样轻；而一张要读三行、要打三次密码的纸，本来也不该一直占着页面。
          ★ 底栏左退右进（`dlg__ghost` / `dlg__go`），与另外五个模态同一套——
            那是 Dialog 壳替所有弹窗摁住的习惯，见它文件头。 */}
      {pwOpen && (
        <Dialog
          title="修改密码"
          onClose={closePassword}
          footer={
            <>
              <button type="button" className="dlg__ghost" onClick={closePassword}>
                算了
              </button>
              <button
                type="submit"
                form="pf-pw-form"
                className="dlg__go"
                // 三格没填齐时禁用：一颗"点了什么都不发生"的按钮，读起来是
                //   "我点了但它坏了"（同 `.pf__save` 那条）
                disabled={!currentPassword || !newPassword || !confirmPassword || pwBusy}
              >
                {pwBusy ? '改密码中' : '改密码'}
              </button>
            </>
          }
        >
          <form id="pf-pw-form" className="pf__pw" onSubmit={(event) => void savePassword(event)}>
            {/* ★ 三格的 `autoComplete` 分别是 current-password / new-password：
                浏览器据此知道"这是改密码"，而不是把新密码当成登录口令存下来 */}
            <label className="pf__pw-row" htmlFor="pw-current">
              <span className="pf__field-label">现在的密码</span>
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
              <span className="pf__field-label">新密码</span>
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
              <span className="pf__field-label">再输一遍</span>
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
            {/* ★ 失败那一句。**占着位置**（`min-height`，见 css）：不占的话
                那句红字一出现，下面那句提示与底栏整排往下跳一下。
                ★ 它是 `.dlg__hint--warn` 的同一支色（`--danger`）——弹窗里的错误
                与弹窗里的说明是同一类东西，只有颜色分它们 */}
            <p className="pf__pw-error" role="status">
              {pwError}
            </p>
            {/* ★ 这句是"改密码"的另一半，必须写在按钮旁边：改完之后**别处**的会话会失效，
                而"这一台"不会（服务端会发一张新票回来）。不写的话，
                用户不知道他刚刚把谁踢下线了——而那正是他要的结果 */}
            <p className="pf__pw-hint">
              改完之后，别的设备上登着的会话会失效，这一台不用重新登录。
            </p>
          </form>
        </Dialog>
      )}
    </section>
  )
}
