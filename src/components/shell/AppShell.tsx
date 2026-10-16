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
import StudioBackdrop from '@/components/shell/StudioBackdrop.tsx'
import { useSettings } from '@/components/settings/SettingsProvider.tsx'
import { maskPhone } from '@/lib/auth/state.ts'
import { staggerFor } from '@/lib/useEnterTimeline.ts'

const COLLAPSE_KEY = 'xiaozhujue.shell.collapsed'

type NavItem = { href: string; label: string; icon: string }

/**
 * ★ 侧栏底部那一格的两个图标（2026-10-16，用户要求底部那格从"空着"变成
 *   「请登录」，登录之后变成「个人主页」）。
 *
 * ★ **未登录那只刻意不是人形**。人形已经是「角色卡」那一格的图标，
 *   同一条侧栏上摆两个"人"，必然有人读错——这个仓库为"两个小主角指两件事"
 *   付过一次学费（见文件头那段）。箭头进门框是另一个形状，收起侧栏只剩图标时也分得开。
 *
 * ★ **已登录那只是一个人加一圈**。它表达的是"**有头像的那个位置**"——
 *   现在还没有真头像（`AuthUser` 里就没有这个字段，后端落地才会有），
 *   所以它此刻的含义正是"头像空着"，这也是这个项目要的那种兜底：
 *   语义上诚实，不是一个碎图标，也不是一块空白。
 *   ★ 接后端拿到头像 URL 那天，这里要长出一个 `img` 分支（`NavContent` 现在只认 path），
 *     那一次改动只会落在这两处：这个常量与 `NavContent`。
 */
const SIGN_IN_ICON = 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 8l4 4-4 4M14 12H3'
const AVATAR_ICON =
  'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5.4a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5ZM6.9 18.2a6.25 6.25 0 0 1 10.2 0'

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
function NavContent({ item }: { item: NavItem }) {
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
  const { openSettings } = useSettings()
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
    icon: AVATAR_ICON,
  }

  return (
    <div className="shell" data-collapsed={collapsed}>
      {/* 背景：与首页第一幕同一片天。放在 DOM 最前面、`position: fixed`，
          所以侧栏与内容区自然压在它上面（层序与首页 `.scene-backdrop` 同一个处理） */}
      <StudioBackdrop />
      <nav className="shell__side" aria-label="工作台" ref={sideRef}>
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
          {NAV.map((item) => {
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
            <NavContent item={user ? accountItem : signInItem} />
          </Link>

          {/* ★ 设置放在侧栏底部而不是右上角：有了常驻侧栏之后，"全局的、不常改的东西"
              有一个明确的家。上一版把它挂在主页右上角，是因为那时没有侧栏 */}
          <button
            type="button"
            className="shell__link shell__link--btn"
            onClick={openSettings}
            title="模型与密钥"
          >
            <svg className="shell__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2-1.2L14.6 2h-4l-.4 2.5a7.6 7.6 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.5h4l.4-2.5c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="shell__link-label">模型与密钥</span>
          </button>
          <button
            type="button"
            className="shell__collapse"
            onClick={toggle}
            aria-expanded={!collapsed}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            <span className="shell__collapse-arrow" aria-hidden="true">
              {/* 一个向左的尖角，折叠时 CSS 把它转 180°。
                  ★ 原来这里是 `«` / `»` 两个文字字符——形状、字重、基线全跟着系统字体走 */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M14.5 5.5 8 12l6.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="shell__link-label">{collapsed ? '展开' : '收起侧栏'}</span>
          </button>
        </div>
      </nav>

      <div className="shell__main">{children}</div>
    </div>
  )
}
