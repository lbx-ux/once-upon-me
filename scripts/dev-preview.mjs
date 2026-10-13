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
 */
import { spawn } from 'node:child_process'

process.env.NEXT_DIST_DIR ??= '.next-preview'
// 端口也错开，否则第二个 dev server 会去抢 3000（抢得到，但日志里看着像坏了）
process.env.PORT ??= '3100'

const child = spawn('next', ['dev'], { stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
