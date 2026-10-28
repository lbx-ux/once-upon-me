/**
 * IcpNotice —— 备案号那一行（2026-10-28）
 *
 * 为什么有这一行：《互联网信息服务管理办法》要求站内**展示**备案号，并**链接**到
 * 工信部的备案系统（`beian.miit.gov.cn`）。它不是装饰，也不是"备案下来那天顺手加一行"——
 * 2026-10-28 域名与 HTTPS 上线时这一条**还没做**，工单 10 的 Comments 里单列着，
 * 就是等这一笔。
 *
 * 号码是 `晋ICP备2026016635号-1`：主体号 `晋ICP备2026016635号` 加上本站那个服务的序号 `-1`
 * （阿里云备案控制台「我的ICP备案信息 → 互联网信息服务 → 网站备案号」那一行，截图同一天核过）。
 * ★ 换服务、加站点时这一串会长出 `-2` / `-3`，那时候改的是**这里**，不是各处调用点。
 *
 * 三个落点与它们各自的形状（版面是各屏自己的 CSS 管的，这里只管文案与链接）：
 *
 *   · 首页最底（`.icp--home`）—— 那是"网站底部"。它落在第三屏（亮点）之后、
 *     满屏 fixed 的场景背景之上，所以是**一张小纸**而不是一行裸字：
 *     裸字压在夜色那幕上，对比度说不清（`check:scrim` 量的是面与墨的配对，
 *     而这一行的面随滚动在变）。
 *   · `/login` 的页脚（`.login__icp`）—— 开账号那一屏，与"读隐私页"那条附注同一栏。
 *   · `/privacy` 的纸底（`.pv__icp`）—— 说明页的落款。
 *

 * ★ 不要把它放进 `AppShell`：工作台那五屏是"应用"，底栏是导航（手机上还是一条
 * 贴底的标签栏），再塞一行备案号会把那五个 44×44 的触控目标挤掉——
 * 那是手机横屏那轮量过的数（`docs/known-tradeoffs.md`「手机横屏」）。
 * 备案审核看的是首页，这一条不靠"每一屏都挂"来成立。
 *
 * 为什么是 `<a>` 不是 `next/link`：它是站外地址，客户端路由不该接管它。
 * `rel="noopener noreferrer"`：`target="_blank"` 不给 `noopener` 的话，
 * 新开的那个页面能通过 `window.opener` 把这一页导航走。
 */
export default function IcpNotice({ className = '' }: { className?: string }) {
  return (
    <p className={className ? `icp ${className}` : 'icp'}>
      <a
        className="icp__link"
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
      >
        晋ICP备2026016635号-1
      </a>
    </p>
  )
}
