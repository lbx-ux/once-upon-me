/**
 * instrumentation.ts —— 进程起来那一刻跑一次的那件事（Next 的 `register()`）
 *
 * 目前只有一件：**额度对账**（`lib/credits/settle.ts`）。它补的是
 * "扣了、进程没了、书没画成、退款那行没跑到"那一种——详见那个文件的文件头。
 *
 * 四条决定：
 *
 * 1. **只在 nodejs 那一档跑。** edge 里没有 fs，也没有资产根；`register()` 两边都会进来。
 *    ★ 这一条必须是**形如 `if (process.env.NEXT_RUNTIME === 'nodejs') { … }` 的正向分支**，
 *    不能写成"不满足就 return、下面照写"。Next 在打包时把 `process.env.NEXT_RUNTIME`
 *    替换成字面量（nodejs / edge）再做死代码消除：正向分支在 edge 那一遍会被整段删掉，
 *    而"先 return"那种写法留不住——2026-10-30 实测，edge 那一遍仍会去解析
 *    `node:fs/promises`，报 `UnhandledSchemeError`，整个 dev server 起来就是一片 500。
 * 2. **不 await。** 这一轮可能要打后端（后端没通时一次 8 秒超时），而
 *    `register()` 结束之前服务还没开始接请求——对账不该把启动按住。
 * 3. **本地 dev 默认不跑**，要跑得显式开 `CREDITS_SETTLE_ON_BOOT=1`。
 *    理由不是性能：本仓 `.env.local` 的 `BACKEND_URL` 指的是**线上**那台，
 *    一个 dev server 起来不该去动线上的账本（这条坑见 `docs/known-tradeoffs.md`
 *    「本地登录打到了线上」那一段，同一形状）。
 * 4. **失败了要出声**：启动期静悄悄跳过的那一种，比报错难查得多。
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const forced = process.env.CREDITS_SETTLE_ON_BOOT === '1'
    if (process.env.NODE_ENV === 'production' || forced) {
      const { settleOrphanBooks } = await import('./lib/credits/settle.ts')
      // ★ 故意不 await（第 2 条）
      void settleOrphanBooks({ note: (line) => console.warn(`[credits] ${line}`) })
        .then((report) => {
          // 什么都没扫到就一个字都不打：一个每 30 秒重启的 dev server 会把它刷成噪音
          if (report.books === 0 && report.failed === 0) return
          console.warn(
            `[credits] 启动对账：扫了 ${report.users} 个账号、${report.books} 本可疑的书——` +
              `退回 ${report.refunded} 本，失败 ${report.failed} 本`,
          )
        })
        .catch((err: unknown) => {
          console.warn(
            `[credits] 启动对账整段没跑成：${err instanceof Error ? err.message : String(err)}`,
          )
        })
    }
  }
}
