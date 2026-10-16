import StudioBackdrop from '@/components/shell/StudioBackdrop.tsx'

/**
 * /create 的布局 —— 让运行视图也站在**首页第一幕那片天**上
 *
 * 起因是用户的一句话：「这个背景页弄成主页的那个蓝色背景把」（他截的那一屏是灰的）。
 * 那层灰不是谁画上去的，是 `body` 的 `--bg: #f7f7f8` 露出来的——工作台那四屏
 * 从 2026-10-15 起就共用了首页那片天（`(studio)/layout.tsx` 的 `AppShell` 里那层
 * `StudioBackdrop`），而 `/create` **不在那一组**（它没有侧栏：运行视图要整幅宽），
 * 于是它一直留在旧底色上。这一层补的就是这一件事。
 *
 * ★ 为什么不是"把 /create 挪进 `(studio)` 组"：那一组的布局给的是**侧栏**
 *   （`AppShell`），而这一屏刻意要整幅宽——用户从 `/home` 走进来的那一刻，
 *   屏幕上该只剩这一本书在做。搬迁会顺手把侧栏带进来，那不是他要的。
 *   背景层与外壳是两件事，这里只接前者。
 *
 * ★ 为什么是**布局**而不是在 `page.tsx` 里塞一个 `<StudioBackdrop />`：
 *   这一屏有两条入口（开跑一本 / 接着做一份草稿），而它们分属 `page.tsx` 的
 *   两个分支，其中一条还会 `redirect`。层挂在布局上，两条路都盖得到，
 *   而且"这一屏站在什么背景上"从此只有一处说法。
 *
 * ★ 那层 `.sb-host` 不是装饰：`StudioBackdrop` 是 `position: absolute; inset: 0`，
 *   它需要**一块定位好的地**才落得下来——那一条的推导（含 `.shell__side` 那次
 *   实测踩坑）写在 `studio-backdrop.css` 里。
 */
export default function CreateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sb-host">
      <StudioBackdrop />
      {children}
    </div>
  )
}
