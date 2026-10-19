import type { NextConfig } from 'next'

/**
 * distDir 可以由环境变量挪走，默认仍是 `.next`（构建与 CI 的行为一字不变）。
 *
 * 为什么要有这个开关：并行的会话会各起一个 `next dev`，而它们**默认共用同一个 `.next/`**。
 * 实测过的后果不是"慢一点"，是互相踩到不可用：
 *   · 一边跑 `pnpm build`，`.next` 被换成 production 产物，
 *     另一边正在跑的 dev server 立刻 `Cannot find module './712.js'`（webpack-runtime
 *     找不到自己刚写过的 chunk）；
 *   · 两个 dev 同时写，日志里会出现 `Caching failed for pack: ENOENT ... pack.gz`。
 *
 * 并行的那一个用 `pnpm dev:preview`（它把产物放到 `.next-preview/`），两边就互不干扰。
 *
 * 起了第二个产物目录之后，有两处要跟着走，都是实测踩到的：
 *   · `eslint.config.mjs` 的 ignores 里得带上 `.next-preview`（见那个文件，写成了通配形式）
 *     ——漏了它，`eslint .` 会去 lint `.next-preview/` 里的构建产物，
 *     实测多出 1414 条问题（123 个 error），真问题的信号会被彻底淹掉。
 *   · Next 会在启动时把"产物目录下的 types 通配"写进 `tsconfig.json` 的 include，
 *     并顺手重排该文件，于是 `pnpm format:check` 会报 tsconfig.json；格式化一次即可，
 *     之后 Next 不会再动它。
 */
/**
 * 构建并发：默认**不动**（本机 24 核，串行只会白白拖慢日常构建）；
 * 服务器上由 `scripts/deploy-web.sh` 给 `NEXT_BUILD_CPUS=1`。
 *
 * ★ 为什么需要这个开关 —— 2026-10-19 实测，代价是一次整机锁死：
 *   `next build` 默认按 CPU 数开 worker（那台服务器 2 vCPU → 2 个），而它只有
 *   **1613 MB** 内存，还要跟 MySQL 与 Java 分；堆上限又给到 1 GB。三者一叠，
 *   整机进入换页死亡螺旋：`available` 594 → **157 MB**，接着 **ssh 连握手都排不上队**，
 *   nginx / Java / MySQL 一起对外超时，那次部署卡在构建上 27 分钟没动过。
 *   串行（1 个 worker）配小堆（见部署脚本里的 `--max-old-space-size`）之后能建完。
 */
const buildCpus = Number(process.env.NEXT_BUILD_CPUS ?? '')

/**
 * 服务器上那一次构建要**跳过类型检查与 ESLint**（部署脚本设 `NEXT_SKIP_GATES=1`）。
 *
 * ★ 这不是偷工减料，是同一句话的第二次应用：`server/deploy.sh` 的文件头写着
 *   「跳过测试：测试是提交前那道闸门的事，不是部署这一步的」。类型检查与 lint 同理 ——
 *   它们是**本机提交前**那道闸门（CLAUDE.md 里那三条），在同一份源码上跑第二遍
 *   换不来新的信息，而它们在 `next build` 里是**内存大户**（tsc 与 ESLint 都在同一个
 *   进程里跑），而那台机器只有 1613 MB。
 * ★ 默认**不跳**：本机 `pnpm build` 与 CI 的语义一字不变，只有服务器那次会设这个变量。
 */
const skipGatesOnServerBuild = process.env.NEXT_SKIP_GATES === '1'

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  /**
   * 关掉左下角那个 Next 开发者工具的小圆钮。
   *
   * 它只在 dev 下出现、生产构建里没有，但截图会被它压住一角，
   * 而参赛材料是截图 —— 所以关掉。
   */
  devIndicators: false,
  // ★ 见上面那段：只在服务器构建时跳（本机 / CI 的语义不变）
  typescript: { ignoreBuildErrors: skipGatesOnServerBuild },
  eslint: { ignoreDuringBuilds: skipGatesOnServerBuild },
  /**
   * ── 客户端路由缓存：同一屏在 30 秒内再进去，直接用手里那份，**不再问服务端** ──────
   *
   * ★ 这个开关是**为了"切回刚看过的那一屏"不要等**，而这件事在 dev 下没有别的办法。
   *   工作台五屏都是 `force-dynamic`（服务端每次读盘），而 Next 在 dev 下把预取
   *   整条路关掉了（`app-router.js` 里 "Don't prefetch during development"，
   *   `<Link>` 的 `onMouseEnter` 也直接 return），`staleTimes` 默认又是 `dynamic: 0`
   *   —— 三条叠起来，**连"回到刚才那一屏"都要重走一次完整渲染**。
   *
   * ★ 实测（本机，headless Chromium，`/home` ⇄ `/shelf` 来回四次）：
   *   不开：1083 / 826 / 553 / 909 ms，四趟发了四个 `?_rsc=` 请求；
   *   开 30 秒：1015 / 438 / **45 / 56** ms，回访那两趟**一个请求都没发**。
   *   逐帧看，回访期间那一格的转圈会亮 2–4 帧再灭 —— 所以 AppShell 那边给报信加了
   *   120ms 门槛（见 `PENDING_SHOW_AFTER_MS`），快的导航从此一格都不亮。
   *
   * ★ 代价，说清楚：**这个窗口内那一屏的落盘数据不会被重新读**。
   *   30 这个数是按"这几屏的数据多久会变一次"挑的：能让它们变的事——生成一本书、
   *   建一张卡、另一个会话往 `.out/web` 或 `public/booklist/` 里落文件——都是以**分钟**计的，
   *   而任何一次生成都远超 30 秒，所以"做完一件事马上回去看"仍然看到新的。
   *   真正会碰到窗口的只有"同一屏在 30 秒内来回切"，而那正是要它快的那件事。
   * ★ 要调就改这一个数：调大 = 更少等待 / 更旧的列表，**设成 0 = 回到每次重新取**。
   *   改完请重跑上面那组读数再抄回来（本仓库那条"数字要能复现"）。
   */
  experimental: {
    staleTimes: { dynamic: 30 },
    // ★ 只在服务器上给这个值（部署脚本设 NEXT_BUILD_CPUS=1）；本机不设 = 保持默认并发。
    //   取值要像样：NaN / 0 / 负数一律当没给，别把 cpus: NaN 递给 Next。
    ...(Number.isFinite(buildCpus) && buildCpus > 0 ? { cpus: buildCpus } : {}),
  },
}

export default nextConfig
