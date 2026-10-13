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
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  /**
   * 关掉左下角那个 Next 开发者工具的小圆钮。
   *
   * 它只在 dev 下出现、生产构建里没有，但截图会被它压住一角，
   * 而参赛材料是截图 —— 所以关掉。
   */
  devIndicators: false,
}

export default nextConfig
