import AppShell from '@/components/shell/AppShell.tsx'

/**
 * (studio) 路由组的布局 —— 工作台那一圈侧栏
 *
 * ★ 用**路由组**而不是给每个页面各写一遍外壳：`/home`、`/shelf`、`/character`、
 *   `/voice` 共享同一个侧栏，写四遍就是四份迟早会漂的真相（导航项、折叠状态、
 *   设置入口各漂一处）。路由组不影响 URL。
 *
 * 首页 `/`、`/create`、`/reader/*` **不在这一组里**：
 * 首页是三屏叙事（不是工作台），阅读器要全屏（侧栏会压掉半幅书面）。
 */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="studio">{children}</div>
    </AppShell>
  )
}
