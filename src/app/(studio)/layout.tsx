import AppShell from '@/components/shell/AppShell.tsx'

/**
 * (studio) 路由组的布局 —— 工作台那一圈侧栏
 *
 * 用路由组而不是给每个页面各写一遍外壳：`/home`、`/shelf`、`/character`、
 *   `/voice` 共享同一个侧栏，写四遍就是四份迟早会漂的真相（导航项、折叠状态、
 *   设置入口各漂一处）。路由组不影响 URL。
 *
 * 首页 `/`、`/create`、`/reader/*` 不在这一组里：
 * 首页是三屏叙事（不是工作台），阅读器要全屏（侧栏会压掉半幅书面）。
 *
 * 这里曾经多包一层 `FigureProvider`（让侧栏底部那颗换人按钮与 `/home` 的立绘
 *   读同一个值）。那颗按钮按用户要求拆了，立绘只剩 `/home` 一个读者、且纯由主题
 *   推出——于是那一层也删掉，没有 Provider 需要挂在这里。
 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="studio">{children}</div>
    </AppShell>
  )
}
