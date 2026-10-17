/**
 * adopt-legacy-assets.mts —— 把**平铺的老数据**搬进某个账号那一片（工单 16，一次性）
 *
 * ```bash
 * node scripts/adopt-legacy-assets.mts --user=13800000000            # 只看计划（dry-run）
 * node scripts/adopt-legacy-assets.mts --user=13800000000 --apply    # 真搬
 * node scripts/adopt-legacy-assets.mts --userId=3 --apply            # 已知用户号时跳过查号
 * ```
 *
 * ★ 为什么需要它：工单 16 之前，资产根是**平铺**的（`books/` `cards/` `children/`
 *   `kids.json` `thumbs/`），没有一处记着 userId。加了归属之后，读的人拼的是
 *   `u/<userId>/…`，于是那批老数据**谁都看不见了**——演示账号打开书会是空的。
 *
 * ★ 为什么是一次性脚本、不是一套迁移框架：服务器上还没有作品（工单 03/10 未做），
 *   所以这件事真正要跑的地方只有一台开发机。写成"每次启动自动搬"那种东西，
 *   会在别人的机器上做出一次没人要求的移动——而**移动是不可逆的**。
 *   所以它的默认行为是**只打印计划**，要动手得自己加 `--apply`。
 *
 * ★ 搬的是一整个**目录**（`rename`），不是逐个文件复制：同一台机器上，
 *   一次 rename 要么成、要么不成，中间没有"搬了一半"的状态。
 *   而复制会在中途失败时留下一份半截的数据，那时候"哪些搬过、哪些没搬"要靠人去数。
 *
 * ★ 只搬列出来的那几样。`demo/` 之类公共目录**不在列**：它们不属于任何人，
 *   而"顺手一起搬"会让随仓库发布的演示书从所有人都看不见变成只有一个人看得见。
 */

import { existsSync } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { readEnv, arg } from './env.mts'

/** 平铺时代的顶层条目。★ 顺序就是打印的顺序 */
const LEGACY = ['books', 'cards', 'children', 'kids.json', 'thumbs'] as const

/**
 * `--apply` 认两种写法：光秃秃的 `--apply`，与 `--apply=1`。
 *
 * ★ 第一版只认后者，而**文档、工单、代码注释里写的都是前者**——
 *   于是 `--apply` 会被静默当成"没给"，脚本打印一遍计划就退出，
 *   而人看到的是一屏很像成功的输出（它列出了每一项要怎么搬）。
 *   这个坑是 2026-10-17 真跑的时候踩到的：我照着自己写的用法敲了一遍，
 *   然后去盘上看，什么都没搬。
 *   ★ 修法不是"把文档改成 `=1`"：那种写法在命令行上不自然，
 *   而不自然的用法迟早会被敲成自然的那一种。
 */
function applyWanted(): boolean {
  if (process.argv.includes('--apply')) return true
  const value = arg('apply', '')
  return value === '1' || value === 'true' || value === 'yes'
}

const APPLY = applyWanted()
const ROOT = resolve(process.env['ASSET_ROOT']?.trim() || arg('root', '.out/web'))
const USER_ID = arg('userId', '')
const ACCOUNT = arg('user', '')

/** 后端地址：查号那一步要走它。★ 默认就是本地那一个，别指到别人的机器上 */
const BACKEND = arg('backend', 'http://127.0.0.1:8080')

async function sizeOf(path: string): Promise<number> {
  const info = await stat(path)
  if (!info.isDirectory()) return info.size
  const { readdir } = await import('node:fs/promises')
  let total = info.size
  for (const item of await readdir(path, { withFileTypes: true })) {
    total += await sizeOf(join(path, item.name))
  }
  return total
}

const human = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * 用管理员那张票去查"这个登录名是几号"。
 *
 * ★ 为什么走接口而不是直接读库：脚本不该知道库在哪儿、表叫什么——
 *   那是后端的实现，而这条路径（`/api/admin/users`）本来就是"谁是谁"的正式答案。
 * ★ 口令**只从环境来**（`ADMIN_PASSWORD`），不写在这里：仓库是公开的。
 */
async function resolveUserId(account: string): Promise<string> {
  const env = await readEnv()
  const password = arg('password', env['ADMIN_PASSWORD'] ?? '')
  const adminAccount = env['ADMIN_ACCOUNT'] ?? '100000'
  if (password === '') {
    throw new Error(
      '要给口令才能查号：ADMIN_PASSWORD=... node scripts/adopt-legacy-assets.mts --user=...\n' +
        '（或者已经知道用户号时用 --userId=3，那条路不查后端）',
    )
  }

  const login = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: adminAccount, password }),
  })
  if (!login.ok) throw new Error(`管理员登录失败：HTTP ${login.status}`)
  const session = (await login.json()) as { token?: string }
  if (!session.token) throw new Error('管理员登录没有回 token')

  const listed = await fetch(`${BACKEND}/api/admin/users`, {
    headers: { authorization: `Bearer ${session.token}` },
  })
  if (!listed.ok) throw new Error(`读用户表失败：HTTP ${listed.status}`)
  const body = (await listed.json()) as { users?: { userId?: string; account?: string }[] }
  const hit = (body.users ?? []).find((row) => row.account === account)
  if (!hit?.userId) throw new Error(`用户表里没有这个登录名：${account}`)
  return hit.userId
}

async function main(): Promise<void> {
  if (USER_ID === '' && ACCOUNT === '') {
    console.log('要给一个主人：--user=<登录名>（走接口查号）或者 --userId=<号>')
    process.exitCode = 1
    return
  }

  const userId = USER_ID !== '' ? USER_ID : await resolveUserId(ACCOUNT)
  const slice = join(ROOT, 'u', userId)

  console.log(`资产根  ${ROOT}`)
  console.log(`这一片  ${slice}${USER_ID !== '' ? '（用户号是你给的，没有核对）' : ''}`)
  console.log(APPLY ? '模式    真的搬\n' : '模式    只看计划（加 --apply 才动手）\n')

  const moves: { from: string; to: string; bytes: number }[] = []
  for (const name of LEGACY) {
    const from = join(ROOT, name)
    if (!existsSync(from)) continue
    moves.push({ from, to: join(slice, name), bytes: await sizeOf(from) })
  }

  if (moves.length === 0) {
    console.log('根上是空的：没有要搬的东西（已经搬过？）——退出，不动任何文件')
    return
  }

  for (const move of moves) {
    const conflict = existsSync(move.to)
    console.log(
      `  ${name(move.from)}  →  u/${userId}/${name(move.from)}   ${human(move.bytes)}` +
        (conflict ? '   ★ 目标已存在，这次跳过' : ''),
    )
  }

  if (!APPLY) {
    console.log('\n（没有动任何文件。确认这份计划之后加 --apply 再跑一次）')
    return
  }

  await mkdir(slice, { recursive: true })
  let done = 0
  for (const move of moves) {
    if (existsSync(move.to)) continue
    await rename(move.from, move.to)
    done += 1
  }
  console.log(`\n搬完 ${done} 项。根上剩下的公共目录（demo 等）一个都没动。`)
}

const name = (path: string): string => path.split(/[\\/]/).pop() ?? path

await main()
