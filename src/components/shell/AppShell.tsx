'use client'

/**
 * AppShell —— 工作台的外壳：左边一条常驻侧栏，右边是干活的地方
 *
 * ★ 这一版改的是**上一版的判断**。上一版把主页做成了"仪表盘"（统计卡 + 列表），
 *   用户看了原型之后说得很直接：功能都放在左侧的侧边栏。所以：
 *
 *   - 侧栏是**导航**，五个入口对应五件事：创作 / 灵感书单 / 书架 / 角色卡 / 声音；
 *     ★ 「灵感书单」是 2026-10-15 用户新加的一格，插在「创作」与「书架」之间。
 *     它是那 12 个主题**已经做好的样书**（只读），理由写在那个入口的注释里。
 *     ★ 第三项原来叫「小主角」。改名是用户 2026-10-15 提的：这一屏列的是**卡**
 *     （一个孩子的档案 + 他这一版形象），而"小主角"是**产品名**（左上角那颗品牌字），
 *     两个"小主角"指两件事，摆在同一屏里必然有人读错。
 *     但"还没有小主角""先去建一个小主角"这类**指代孩子本人**的句子不改——
 *     首页那条主张就是"你的孩子是主角"，抹掉它才是损失。
 *   - 原来那堆统计卡与书列表搬去「书架」——它们本来就是"我做过什么"，
 *     不是"我要做什么"；
 *   - 「创作」落地页是一句话输入框（原型里那句"我们要做什么？"），
 *     它把话递给 `/create?wish=`，不自己造第二套表单。
 *
 * ★ 四条实现上的讲究：
 *
 * 1. **折叠状态存本地**。侧栏收起/展开是一个偏好，不是秘密，也不是会话数据；
 *    但它**不能进 SSR 的首屏 HTML**（否则服务端渲染出"展开"、客户端立刻变"收起"，
 *    会闪一下并且 hydration 不一致）。所以初值一律"展开"，挂载后再应用存的状态。
 * 2. **图标是内联 SVG，不引图标库**。这个仓库现在只有 gsap 一个前端依赖；
 *    四个图标不值得为它加一个包（README §二 的依赖清单是要守的）。
 * 3. **键盘可达**：侧栏是 `<nav>`，当前项带 `aria-current="page"`；
 *    折叠按钮带 `aria-expanded`，收起后 `title` 仍然给出名字（只剩图标时必须有个地方能读到）。
 * 4. **点下去要立刻有反应**（2026-10-15 加，用户报的是"切换好不流畅，点四五次才跳过去"）。
 *    先把成因量清楚，因为结论是反直觉的——**不是点击丢事件**：
 *    · 在浏览器里对五格逐一做命中测试（`elementsFromPoint`），五个格子的最上层都是
 *      自己的 `<a>`，没有东西压在上面；
 *    · 真发一次鼠标事件，路径确实变了，只是要等 **0.5–2.6s**。
 *    这 0.5–2.6s 是**每一次都要付的服务端渲染**：工作台五屏都是 `force-dynamic`，
 *    而 Next 把 dev 下的预取整条路关掉了（`app-router` 里写着
 *    "Don't prefetch during development"，`<Link>` 的 onMouseEnter 也直接 `return`），
 *    dynamic 页在客户端路由缓存里的 `staleTimes` 默认又是 0——所以来回切换时
 *    每一格都是一次冷启动（实测来回四次切了四趟，四趟都发了 `?_rsc=` 请求）。
 *    ← 这一条是本条注释写完之后才补上的：`staleTimes` 现在给到 30 秒，
 *    见下面「分两半解决」与 next.config.ts。
 *    ★ 而在这 0.5–2.6s 里，界面上**一个像素都没变**：`aria-current` 还在旧那格上。
 *    于是人的下一步必然是再点一次——**而那一下不是催它，是把上一次导航掐掉重来**。
 *    "点四五次才跳过去"就是这么来的，是自己把自己拖慢的。
 *
 *    ★ 上面这几个读数的出处，按本仓库那条「数字要能复现」写清楚：
 *      0.5–2.6s 是同一台机器上对 `/home` `/booklist` `/shelf` `/character` `/voice`
 *      各跑若干次 `curl` 到首字节的时间跨度（`voice` 服务端一件取数都没有，也在
 *      0.13–1.08s 之间抖——所以这段是 dev 的固定开销，不是我们哪一屏的取数慢：
 *      `listCardItems` 56–89ms、`listWallItems` 68–87ms、`listBooklist` 1–2ms）。
 *      721ms / 1104ms 是 headless Chromium（1414×744、dpr 1）里真发 `Input.dispatchMouseEvent`
 *      量到的：单击一次与同一格间隔 200ms 连点四次，路径变更的墙钟。测量用的是一组
 *      一次性 CDP 探针（在 `.out/nav-probe/`、**未进仓库**），所以这两个数**不是维护中的常数**，
 *      换机器会变；被它们支撑的那个判断（dev 下没有预取、每次点击都要等一次完整渲染）
 *      才是这条注释要留下的东西，而它是可以在仓库里直接查证的：
 *      `next/dist/client/components/app-router.js` 里 `prefetch` 开头那句
 *      "Don't prefetch during development"，以及 `next/dist/client/app-dir/link.js`
 *      里 `onMouseEnter` 那句 `process.env.NODE_ENV === 'development'` 直接 return。
 *
 *    ★ 然后分两半解决，因为这两半的答案不一样：
 *
 *    **①「回头路」—— 已经不用等了。** 也就是"模块之间来回切"的主体那一种。
 *      客户端路由缓存给到 30 秒窗口之后，回访刚看过的那一屏是 **45–62ms**，
 *      而且一个请求都不发。开关与代价写在 next.config.ts 的
 *      `experimental.staleTimes`，连同同一组读数与怎么调。
 *    **②「第一次去某一屏」—— dev 下减不掉，只能让它被看见。** 那 300–500ms 里约七成是
 *      React 在 dev 下给**每一条 RSC 记录**附的源码位置：`/home` 的载荷里这种记录
 *      **3494 条**，而指向的模块只有 **6 个**（同六条路径被重复三千多次），共 349KB。
 *      生产构建里一条都没有——所以这是 dev 的开销，不是这一屏的代码慢
 *      （服务端取数实测 `listCardItems` 56–89ms、`listWallItems` 68–87ms）。
 *      于是这一半只做一件事：**点下去有反应**。`useLinkStatus()` 的 `pending` 一为真，
 *      图标就让位给一个转圈、标签转成强调色；而报信本身还有 120ms 门槛
 *      （`PENDING_SHOW_AFTER_MS`，理由写在那儿：快的导航报了反而是闪烁）。
 *
 *    ★ 同一件事上**查过并否掉**的两条，写下来免得下一个人再试：
 *      · **Turbopack**（`next dev --turbopack`）：平的。`/home` 0.33s vs 0.40s，
 *        `/shelf` 0.43s vs 0.24s 反而更慢，`/voice` 0.12s vs 0.05s 更慢——
 *        它换的是打包器，而开销在 React 的 dev 追踪上，与打包器无关。
 *      · **给 `<Link>` 加 `prefetch`**：dev 下根本没有那条路（上面两句源码为证），
 *        只有生产下才谈得上，而生产此刻 `pnpm build` 是红的（另一张单子的既有问题）。
 */

import Link, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import gsap from 'gsap'

import { useAuth } from '@/components/auth/AuthProvider.tsx'
import ProfileBackdrop from '@/components/account/ProfileBackdrop.tsx'
import StudioBackdrop from '@/components/shell/StudioBackdrop.tsx'
import SettingsDialog from '@/components/shell/SettingsDialog.tsx'
import { DEFAULT_AVATAR } from '@/lib/avatars.ts'
import { maskPhone } from '@/lib/auth/state.ts'
import { staggerFor } from '@/lib/useEnterTimeline.ts'

const COLLAPSE_KEY = 'xiaozhujue.shell.collapsed'

/**
 * ★ `icon` 是**可选**的，只有「个人主页」那一格没有它（2026-10-17）。
 *   原来那一格的图标是"人加一圈"（`AVATAR_ICON`），意思是"**有头像的那个位置**"——
 *   一个空位的记号。现在那一格**永远**画着站点那唯一一张头像
 *   （`lib/avatars.ts`，用户要求"只提供一个默认头像、不可以切换"），
 *   于是那个空位记号成了一段**到不了**的代码：`NavContent` 里
 *   `avatar ? <img> : <svg item.icon>` 的 else 分支，对「个人主页」这一格永远不会走。
 *   留着它比删掉更坏——它会让人以为"这里某天还会是一颗人形图标"。
 */
type NavItem = { href: string; label: string; icon?: string }

/**
 * ★ 侧栏底部那一格**未登录**时的图标（2026-10-16，用户要求底部那格从"空着"变成
 *   「请登录」，登录之后变成「个人主页」）。
 *
 * ★ **未登录那只刻意不是人形**。人形已经是「角色卡」那一格的图标，
 *   同一条侧栏上摆两个"人"，必然有人读错——这个仓库为"两个小主角指两件事"
 *   付过一次学费（见文件头那段）。箭头进门框是另一个形状，收起侧栏只剩图标时也分得开。
 *   ★ 2026-10-17：它是这一组里**唯一**剩下的一个了。已登录那一格原来那个
 *     "人加一圈"的空位记号随"只提供一个默认头像"一起删掉（理由见 `NavItem`）。
 */
const SIGN_IN_ICON = 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 8l4 4-4 4M14 12H3'

/** `icon` 是 SVG 的 path 数据（24×24 视口，描边用 currentColor） */
const NAV: NavItem[] = [
  {
    href: '/home',
    label: '创作',
    icon: 'M4 16.5 14.8 5.7a1.9 1.9 0 0 1 2.7 2.7L6.7 19.2 3 20l1-3.5Z',
  },
  {
    // ★ 「灵感书单」夹在「创作」与「书架」之间（用户 2026-10-15 提的）：
    //   左边是"去做一本"，右边是"我做过的"，中间这一格是"**别人做好的长什么样**"。
    //   这个次序本身就是那句话：先看见成品，再动手，做完回到书架。
    href: '/booklist',
    label: '灵感书单',
    // 图标是一枚**书签缎带**：与「创作」那支笔、「书架」那排竖线都不是一个形状，
    // 收起侧栏只剩图标时也认得出（四个图标里只有它是"一条带子折了个角"）
    icon: 'M7 3.5h10v17l-5-4-5 4z',
  },
  { href: '/shelf', label: '书架', icon: 'M5 4h5v16H5zM12 4h3v16h-3zM17.5 4l2.5 16' },
  {
    href: '/character',
    label: '角色卡',
    // 图标仍是人形：这一屏是"**他的**卡"，不是一张抽象的卡片
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  },
  { href: '/voice', label: '声音', icon: 'M12 4v16m0-16a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z' },
]

/**
 * 管理员才有的那一格（工单 09）。
 *
 * ★ 它**不放进 `NAV`**：那一份是常量，而这一格要按角色算。混进去的话，
 *   `NAV.map` 那一段就得开始判断"这一项要不要显示"，而 `NAV` 也在别处被读
 *   （进场动画的错峰 `staggerFor(NAV.length)` 就是一处）——
 *   一个"有时多一项"的常量会让那些读者全部失去依据。
 *
 * ★ 图标是一枚**钥匙**：与「创作」那支笔、「角色卡」那个人形、「声音」那道波
 *   都不是一个形状，收起侧栏只剩图标时也认得出——而这一格恰恰最需要被认出来，
 *   因为其它六格人人都有，只有它只对一个人显示。
 */
const ADMIN_ITEM: NavItem = {
  href: '/admin',
  label: '管理',
  icon: 'M14.5 6.5a4 4 0 1 0-3.3 6.2L4 20v-3h2v-2h2v-2l1.2-1.2A4 4 0 0 1 14.5 6.5Z',
}

/**
 * 慢到这个数才值得报信。
 *
 * ★ 为什么需要一个门槛，而不是"点了就报"：开了 `staleTimes` 之后（见 next.config.ts），
 *   回访刚看过的那一屏**只要 47–62ms**——逐帧量过，这个时长里那个转圈会亮 **2–4 帧**
 *   再灭掉，读起来是一次闪烁，比什么都不显示更难看。
 *   而 120ms 以下人是感觉不到"没反应"的，所以慢的那些照样来得及报。
 *   实测（同一台机器，`/home`→`/shelf`）：冷 502ms / 热 47ms；1300ms 那一档也报得及时。
 *   ★ 这个数是"人多久开始怀疑没点上"的量，不是性能指标，改它只影响观感。
 */
const PENDING_SHOW_AFTER_MS = 120

/**
 * 一格导航里的东西。★ 单独拆成一个组件只有一个理由：`useLinkStatus()` 读的是
 * **最近的 `<Link>`** 通过 context 发下来的那份状态，所以这一句必须在 `<Link>`
 * **里面**调——写在 AppShell 的主体里是在 `<Link>` 外面，拿到的永远是"不 pending"。
 *
 * ★ 图标与转圈**共用同一个 20px 的格子**（`.shell__glyph`，转圈绝对定位压在图标上）：
 * 换形状的时候这一格不跳，收起侧栏只剩图标时位置也纹丝不动。
 *
 * ★ `pending` 也**说给读屏**（`sr-only` 那一段）。理由与 `.cl__optimize` 那颗一样：
 * 状态变了要有话说，不能只靠一个只有眼睛看得见的转圈。
 */
function NavContent({ item, avatar }: { item: NavItem; avatar?: string | null }) {
  const { pending } = useLinkStatus()
  // 亮着的转圈。★ 比 pending 晚 `PENDING_SHOW_AFTER_MS` 一拍，快导航因此**一格都不亮**
  const [showPending, setShowPending] = useState(false)

  useEffect(() => {
    if (!pending) {
      setShowPending(false)
      return
    }
    const timer = window.setTimeout(() => setShowPending(true), PENDING_SHOW_AFTER_MS)
    // 导航比门槛快时走这条：定时器没来得及响就被清掉，界面自始至终没变过
    return () => window.clearTimeout(timer)
  }, [pending])

  return (
    <>
      <span className="shell__glyph" data-pending={showPending ? 'true' : undefined}>
        {avatar ? (
          /* ★ 是 `<img>` 不是 `next/image`：一张 22px 的本地位图，没有 LCP 意义，
             与 `shell__brand-mark` 那条同一个处理。
             ★ `alt=""`：**这一格的文字就在它旁边**（昵称/打码手机号），
               再念一遍"云的图标"是噪音。 */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="shell__avatar" src={avatar} alt="" width={22} height={22} />
        ) : item.icon ? (
          <svg className="shell__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d={item.icon}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        <span className="shell__spin" aria-hidden="true" />
      </span>
      <span className="shell__link-label">{item.label}</span>
      {showPending && <span className="sr-only">正在打开</span>}
    </>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  /** 「设置」那个弹窗开着没有。同上，不持久化——里面那些偏好自己会落盘 */
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { user } = useAuth()
  const sideRef = useRef<HTMLElement>(null)

  /* ── 进工作台时侧栏从左边让进来（2026-10-16）────────────────────────────────
   * 起因是首页 → `/home` 那一次跳转：主题墙上那 12 张现在是**从环上接力飞过来**的
   * （见 `lib/theme-handoff.ts`），可整条侧栏是"啪"地出现的——一次接力配一次硬切，
   * 观感上还是两个网站。侧栏因此补上它自己那一下。
   *
   * ★ 它只挂在**挂上**这一次：AppShell 在 `(studio)` 路由组的布局里，
   *   工作台内部几屏之间来回切它**不重挂**，所以反复点侧栏那几格不会每次都演一遍。
   *   这一条是"什么时候播"的全部规则——判据是**组件挂载**，不是"从首页来的"。
   * ★ CSS 持终态、GSAP 只 `from()`：默认态就是画完的样子（侧栏在原位、不透明），
   *   禁 JS / hydration 之前 / `prefers-reduced-motion` 三种情形下，看到的都是一整条侧栏。
   *   与 `lib/useEnterTimeline.ts` 同一条契约，那段注释里有首屏付过的学费。
   * ★ 不进 `lib/`：只有这一个读者。为一个读者抽一层出去是给假想的将来搭架子。
   * ★ 只动 `x` 与 `opacity`，不做位移动画之外的任何事：这一层背后是满屏固定的大图，
   *   任何 scale / filter 都是每帧重采样一整屏（README §五 那条账）。 */
  useEffect(() => {
    const side = sideRef.current
    if (!side) return
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () =>
      gsap.context(() => {
        gsap.from(side, { x: -18, opacity: 0, duration: 0.26, ease: 'power2.out' })
        // 导航项比侧栏晚半拍、彼此错峰：`staggerFor` 是那一套已经在测的交错规则
        gsap.from('.shell__nav li', {
          x: -8,
          opacity: 0,
          duration: 0.22,
          delay: 0.06,
          stagger: staggerFor(NAV.length),
          ease: 'power2.out',
        })
      }, side),
    )
    return () => mm.revert()
  }, [])

  // 挂载后才应用存的折叠状态（见文件头第 1 条：否则首屏会闪并且 hydration 不一致）
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1')
    } catch {
      /* 读不到就用默认值（展开） */
    }
  }, [])

  const toggle = (): void => {
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* 存不下就算了，本次会话里照样能折叠 */
      }
      return next
    })
  }

  /**
   * 底部那一格的两副面孔（见上面两个图标常量）。
   *
   * ★ 已登录那一格的文字取**昵称**，取不到就退回**打码手机号**。
   *   昵称是空串是合法值（"还没起过"），所以这不是"兜底一个默认名"，
   *   是"换一件真的能读的东西显示"——空着才是错的。
   * ★ `next` 带的是**此刻这一页**，登录完回到这儿（判据在 `lib/auth/state.ts`
   *   的 `safeNext()`，这一层不自己判）。`encodeURIComponent` 是必须的：
   *   路径里可能有查询串，不编码就会把它接到 `?next=` 自己的参数里去。
   */
  const signInItem: NavItem = {
    href: `/login?next=${encodeURIComponent(pathname)}`,
    label: '请登录',
    icon: SIGN_IN_ICON,
  }
  const accountItem: NavItem = {
    href: '/account',
    label: user ? user.nickname.trim() || maskPhone(user.phone) : '',
    // ★ 没有 `icon`：这一格永远画站点那唯一一张头像（见 `NavItem`）
  }
  /**
   * ★ 登录之后就是**站点那唯一一张头像**，与"这个人是谁"无关
   *   （2026-10-17 用户要求"只提供一个默认头像、用户不可以切换"）。
   *   `null` 只在**还没登录**时出现，而那时这一格画的是 `SIGN_IN_ICON`。
   */
  const avatar = user ? DEFAULT_AVATAR : null

  /**
   * 侧栏那几格 = 常量那一排，管理员多一格「管理」。
   * ★ 位置在**最后**：它不是"去做事"的第六件事，而是"你比一般人多看得到一屏"。
   *   ★ `user` 还是 `null`（首屏那一次 `/api/auth/me` 没回来）时**不加**：
   *     猜错方向的代价是侧栏在首屏抖一下，比晚半拍出现坏。
   */
  const navItems = user?.role === 'ADMIN' ? [...NAV, ADMIN_ITEM] : NAV

  /**
   * 这一屏的背景用哪一层。
   *
   * ★ 两副面孔指的是**同一格**（`.shell` 的第一个孩子、`position: *; inset: 0`），
   *   所以这里是二选一，不是两个都挂——两层一起铺会互相盖，而它们谁该在上面
   *   没有答案。理由分别写在两个组件自己的文件头里。
   * ★ 判据是**路径**（`usePathname`，与上面那几格导航同一个来源）而不是"现在有没有
   *   登录"：`/account` 未登录时也长这样（那一屏自己会画一句"还没有人登录过"），
   *   而"登不登录"这件事此刻还不知道（`user` 首屏是 null，要等一次 `/api/auth/me`）——
   *   拿它当判据会让背景在首屏抖一次。
   */
  const onProfileScreen = pathname === '/account'

  return (
    <div className="shell" data-collapsed={collapsed}>
      {/* 背景：`/account` 是那片蓝底（`ProfileBackdrop`），其余几屏是与首页
          第一幕同一片天。放在 DOM 最前面、两层的 `inset` 都是 0，
          所以侧栏与内容区自然压在它上面（层序与首页 `.scene-backdrop` 同一个处理） */}
      {onProfileScreen ? <ProfileBackdrop /> : <StudioBackdrop />}
      <nav className="shell__side" aria-label="工作台" ref={sideRef}>
        {/* ★ 牌子是侧栏的第一行，直接挂在 `<nav>` 上，**没有包一层**。
            ★ 2026-10-17 的来回，写在这里免得下一个人再走一遍：
              用户先要「把收起侧栏放到侧边框的右上角，显示一个"<"的箭头就行」，
              于是它被挪进了这一行（一个 `.shell__top` 把牌子与箭头并排装起来）；
              同一天用户又改口——「算了吧，这个侧边栏的收缩还是改回一开始的那样吧，
              放在左下角」。所以它回到了底部那一格（`.shell__foot`），
              那一行也**整个撤掉**：留着它只会是一个空壳。
            ★ 撤掉 `.shell__top` 还顺手修掉一个实测的宽度 bug：并排时那一行的
              min-content 是 34(牌子图标) + 26(箭头) = 60px，而收起态只有
              72 − 28(padding) = 44px 可用，flex 项收缩不到内容以下，
              于是整条侧栏被顶到 **88px**（写着的是 72）。牌子一个人待着只有 34px，
              72px 这条就自己成立了——不需要再为它写一条规则。 */}
        <Link className="shell__brand" href="/" aria-label="回首页">
          <span className="shell__brand-mark" aria-hidden="true">
            {/* 28px 的装饰性标记，`alt=""`。next/image 在这件事上没有收益
                （一张本地小图、没有 LCP 意义），而它是 README §五 里
                「刻意未做」那一条——与首页几处同一个处理 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark.webp" alt="" width={28} height={28} />
          </span>
          <span className="shell__brand-text">
            <span className="shell__brand-cn">小主角</span>
            <span className="shell__brand-en">Once Upon Me</span>
          </span>
        </Link>

        <p className="shell__group-label">工作台</p>
        <ul className="shell__nav">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <li key={item.href}>
                <Link
                  className="shell__link"
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  title={item.label}
                >
                  <NavContent item={item} />
                </Link>
              </li>
            )
          })}
        </ul>

        <div className="shell__foot">
          {/* ★ 这一格两副面孔（2026-10-16，用户要求）：
              未登录 → 「请登录」，去 `/login` 并带上此刻这一页；
              已登录 → 「个人主页」，去 `/account`。
              ★ 它排在「模型与密钥」**上面**：先是谁在用，再是这个人在用什么。
              ★ 它**不进 `NAV`**（上面那五格）：那五格是"去做事"，这一格是"我是谁"，
                混在一排里会把导航读成六件并列的事。 */}
          <Link
            className="shell__link"
            href={user ? accountItem.href : signInItem.href}
            title={user ? '个人主页' : signInItem.label}
          >
            <NavContent item={user ? accountItem : signInItem} avatar={avatar} />
          </Link>

          {/*
           * ★ 「设置」在「帮助」**上面**（2026-10-17 加）。这一列的次序是一句话：
           *   先是谁在用（个人主页），再是这个人在哪儿调（设置），
           *   然后是"还有问题去哪问"（帮助），最后是一个开关（收起侧栏）。
           *   管理与帮助都不是"去做事"，与上面那五格不同类，所以它们留在底部。
           *
           * ★ 图标是**两根推子**（三条横线 + 三个错开的圆点），不引图标库：
           *   这个仓库至今只有 gsap 一个前端依赖（README §二 那张清单是要守的），
           *   而一个图形不值得为它加一个包。选推子而不是齿轮，是因为侧栏里
           *   另外九个形状（笔 / 书签带 / 书架 / 人形 / 声波 / 钥匙 / 门框 / 头像 /
           *   问号圈）里一个"平行线 + 点"都没有，收起侧栏只剩图标时也认得出来。
           *
           * ★ 它与「帮助」同一副骨架（`.shell__link`），因为它确实是
           *   "点一下会打开一个东西"的那类动作，与最底下那个开关（`.shell__collapse`，
           *   更紧一档、带一圈边）不是一类。 */}
          <button
            type="button"
            className="shell__link"
            onClick={() => setSettingsOpen(true)}
            title="设置"
          >
            <svg className="shell__icon" viewBox="0 0 24 24" aria-hidden="true">
              {/* 三条轨 */}
              <path
                d="M4 6.5h16M4 12h16M4 17.5h16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              {/* 三个钮，一条一个位置，彼此错开（错开才读得出是"可调"） */}
              <circle cx="9" cy="6.5" r="2.1" fill="currentColor" />
              <circle cx="15.5" cy="12" r="2.1" fill="currentColor" />
              <circle cx="7.5" cy="17.5" r="2.1" fill="currentColor" />
            </svg>
            <span className="shell__link-label">设置</span>
          </button>

          {/*
           * ★ 这里原来是一格「帮助」（点开一个弹窗：密钥谁配的 / 没有权限怎么办
           *   → **就在那里提申请** / 为什么看不到别人的书 / 数据存在哪）。
           *   2026-10-18 用户要求整条拆掉，理由是那个模块的主要用途（申请权限）
           *   没有了：权限改成**注册即全开**，没有人需要申请。
           *
           * ★ 为什么是**删掉**而不是"留着一个只剩三条说明的弹窗"：
           *   那三条里两条是"说明这个站的规则"（按账号分开存、数据在服务器上），
           *   而它们从来不是用户会主动去点开找的东西——常驻的三行说明被读成背景噪音，
           *   收进一个要点一下的地方更没人点。用户要的就是这一格不在。
           *
           * ★ 留下的次序仍然是那句话：先是谁在用（个人主页），再是这个人在哪儿调
           *   （设置），最后是一个开关（收起侧栏）。「帮助」走了之后，
           *   侧栏底部不再有"还有问题去哪问"那一格。
           *   ★ 那条路上的邮箱（`CONTACT_EMAIL`）没有跟着消失：它仍然是
           *     「声音」那一屏与朗读那几句话里"找谁"的答案。 */}

          {/*
           * ★ 「收起侧栏」在这里，**底部那一格的最下面**。
           *
           * ★ 2026-10-17 走了一圈又回来了，那段来回值得留着：它原来就在这里；
           *   用户那天要先把它挪到「侧边框的右上角，显示一个"<"的箭头就行」，
           *   于是它变成了顶上一颗只有箭头的方钮（还配了一个悬停才出现的名字标签）；
           *   同一天用户又改口：「算了吧，这个侧边栏的收缩还是改回一开始的那样吧，
           *   放在左下角」。现在这一份就是**一开始那一份**：一整行、带箭头与文字。
           *
           * ★ 为什么带文字而不再是一个只有箭头的方钮：它现在与上面两格同一副骨架
           *   （`.shell__link` 那个 `--shell-foot-*` 的尺寸与内边距），
           *   而**同一列里的三格必须长得像一家人**。只有箭头的版本之所以成立，
           *   是因为它当时孤零零待在顶部、身边只有牌子；搬回这一列之后，
           *   一个比别人矮一截、又没有字的方钮会读成"这里放了个图标"。
           *
           * ★ 于是那颗悬停标签（`.shell__tip`）也一起撤了：它的存在理由是
           *   "那颗图标上写不下字"，而现在字就在旁边——留着会变成第二个 tooltip。
           * ★ `title` 留着，与一开始那份一样，而且它**不是**多余的一遍：
           *   收起那个方向压成两个字（「展开」），"侧栏"两个字只有 `title` 里有。
           */}
          <button
            type="button"
            className="shell__collapse"
            onClick={toggle}
            aria-expanded={!collapsed}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            <span className="shell__collapse-arrow" aria-hidden="true">
              {/* 一个向左的尖角，收起后 CSS 把它转 180°（指回右边 = "展开"）。
                  ★ 原来这里是 `«` / `»` 两个文字字符——形状、字重、基线全跟着系统字体走，
                    换一台机器就换一笔。`<` 是**几何图形**不是文字，所以它不写字面的 "<"。 */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M14.5 5.5 8 12l6.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="shell__link-label">{collapsed ? '展开' : '收起侧栏'}</span>
          </button>
        </div>
      </nav>

      <div className="shell__main">{children}</div>

      {/* ★ 弹窗挂在**壳上**（不是某一页里）：侧栏在哪一屏都在，所以「设置」
          也在哪一屏都点得开——挂进某一页的话，只有那一页能用 */}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
