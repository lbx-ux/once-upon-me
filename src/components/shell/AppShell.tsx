'use client'

/**
 * AppShell —— 工作台的外壳：左边一条常驻侧栏，右边是干活的地方
 *
 * ★ 这一版改的是**上一版的判断**。上一版把主页做成了"仪表盘"（统计卡 + 列表），
 *   用户看了原型之后说得很直接：功能都放在左侧的侧边栏。所以：
 *
 *   - 侧栏是**导航**，四个入口对应四件功能：创作 / 书架 / 小主角 / 声音；
 *   - 原来那堆统计卡与书列表搬去「书架」——它们本来就是"我做过什么"，
 *     不是"我要做什么"；
 *   - 「创作」落地页是一句话输入框（原型里那句"我们要做什么？"），
 *     它把话递给 `/create?wish=`，不自己造第二套表单。
 *
 * ★ 三条实现上的讲究：
 *
 * 1. **折叠状态存本地**。侧栏收起/展开是一个偏好，不是秘密，也不是会话数据；
 *    但它**不能进 SSR 的首屏 HTML**（否则服务端渲染出"展开"、客户端立刻变"收起"，
 *    会闪一下并且 hydration 不一致）。所以初值一律"展开"，挂载后再应用存的状态。
 * 2. **图标是内联 SVG，不引图标库**。这个仓库现在只有 gsap 一个前端依赖；
 *    四个图标不值得为它加一个包（README §二 的依赖清单是要守的）。
 * 3. **键盘可达**：侧栏是 `<nav>`，当前项带 `aria-current="page"`；
 *    折叠按钮带 `aria-expanded`，收起后 `title` 仍然给出名字（只剩图标时必须有个地方能读到）。
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { useSettings } from '@/components/settings/SettingsProvider.tsx'

const COLLAPSE_KEY = 'xiaozhujue.shell.collapsed'

type NavItem = { href: string; label: string; icon: string }

/** `icon` 是 SVG 的 path 数据（24×24 视口，描边用 currentColor） */
const NAV: NavItem[] = [
  {
    href: '/home',
    label: '创作',
    icon: 'M4 16.5 14.8 5.7a1.9 1.9 0 0 1 2.7 2.7L6.7 19.2 3 20l1-3.5Z',
  },
  { href: '/shelf', label: '书架', icon: 'M5 4h5v16H5zM12 4h3v16h-3zM17.5 4l2.5 16' },
  {
    href: '/character',
    label: '小主角',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  },
  { href: '/voice', label: '声音', icon: 'M12 4v16m0-16a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z' },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const { openSettings } = useSettings()

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

  return (
    <div className="shell" data-collapsed={collapsed}>
      <nav className="shell__side" aria-label="工作台">
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
                  <span className="shell__link-label">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>

        <div className="shell__foot">
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
              {collapsed ? '»' : '«'}
            </span>
            <span className="shell__link-label">{collapsed ? '展开' : '收起侧栏'}</span>
          </button>
        </div>
      </nav>

      <div className="shell__main">{children}</div>
    </div>
  )
}
