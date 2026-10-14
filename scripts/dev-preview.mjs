/**
 * dev:preview —— 给"第二条会话/第二个浏览器预览"用的 dev server
 *
 * 只做一件事：把 NEXT_DIST_DIR 设成 `.next-preview` 再起 `next dev`。
 * 这样它和默认那个 dev server 各写各的产物目录，不会互相把对方的 chunk 踩掉
 * （后果与理由写在 next.config.ts 的注释里）。
 *
 * 为什么用 node 脚本而不是 package.json 里写 `NEXT_DIST_DIR=... next dev`：
 * 前者在 POSIX shell 里能跑，在 Windows 的 cmd 里不认；反过来 `set X=&& ...`
 * 又在 bash 里不认。这条仓库在 Windows 上开发、CI 在 Linux，所以走 node。
 *
 * ★ `--dist=` 与 `--port=` 是为了**第三条**会话：同一条纪律不是因为两条会话才成立，
 *   而是因为"两台 dev server 共用一个产物目录"这件事本身会互相踩。
 *   没有这两个参数时，第三条会话就只能二选一：抢 3100，或者跟第二条共用
 *   `.next-preview` —— 后者正是这个脚本要防的那件事，所以补上出口而不是再抄一份脚本。
 *
 *   ```bash
 *   node scripts/dev-preview.mjs --dist=.next-w2 --port=1950
 *   ```
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const argv = process.argv.slice(2)
const optOf = (name, fallback) => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

// 显式参数 > 已有环境变量 > 缺省。`??=` 的语义保持不变：命令行不带参数时，
// 外面已经设好的 NEXT_DIST_DIR / PORT 仍然优先
process.env.NEXT_DIST_DIR = optOf('dist', process.env.NEXT_DIST_DIR ?? '.next-preview')
process.env.PORT = optOf('port', process.env.PORT ?? '3100')

// ★ 不走 `spawn('next', ...)` + `shell: true`：那条路依赖 `node_modules/.bin` 在 PATH 里，
//   而"PATH 里有 .bin"是 **pnpm 脚本**给的环境。这个脚本既被 `pnpm dev:preview` 调，
//   也被启动器直接 `node scripts/dev-preview.mjs` 调——后者实测报
//   `'next' 不是内部或外部命令`。直接把 next 的入口交给同一个 node 进程，
//   两种调用方式走同一条路，也不再需要 shell（顺带消掉 spawn+shell 的注入告警）。
const require = createRequire(import.meta.url)
const nextBin = require.resolve('next/dist/bin/next')

const child = spawn(process.execPath, [nextBin, 'dev'], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
