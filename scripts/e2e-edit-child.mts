/**
 * e2e-edit-child.mts —— 「改一个孩子的档案」整条路真跑一次（工单 05）
 *
 * ```bash
 * node scripts/e2e-edit-child.mts
 * node scripts/e2e-edit-child.mts --base=http://localhost:3100
 * node scripts/e2e-edit-child.mts --seed-only=1   # 只建一个孩子就停（在浏览器里改那几格）
 * ```
 *
 * ★ 它验的是**磁盘上那一条真的变成了新的**，不是"接口回了 200"。
 *   所以每一步都读回 `.out/web/children/<id>.json` 自己比对字段，
 *   而不是相信响应体（响应体可以是引擎回的那条记录，也可以是一份缓存）。
 *
 * ★ 这一支里**有两个只有真做才会不同的判据**，它们是这支脚本存在的理由：
 *
 *   1. **`createdAt` 必须一个字节都不变，`updatedAt` 必须往前走。**
 *      `POST` 与 `PATCH` 复用的是同一个 `profiles.save`，而 `PATCH` 那一侧的
 *      `createdAt: Date.now()` 是**故意**传的（它正好走在
 *      "已有档案的 createdAt 不可被改写"那条守卫上）。
 *      写这支脚本之前我没传 `updatedAt`，于是改完名读回来
 *      `updatedAt === createdAt`——这条档案看起来"从来没动过"。
 *      两个时间戳一起看才能抓住这件事：只看"名字变了没有"，两种写法都过。
 *   2. **400 那一次不能改动磁盘上一个字节。** 校验失败最常见的坏法不是回错码，
 *      是**先写一半再报错**：名字已经落盘、年龄档没落，档案半新半旧。
 *      判据用整份文件的字节比对（不是字段比对）——字段比对漏得掉"多写了一个字段"。
 *
 * ★ 中文请求体**必须从这个脚本里发**，不能用 curl 从 Git Bash 发：
 *   Git Bash 那条路上的中文会以 GBK 出去，存下来的是乱码，而接口会**照收**
 *   （它就是一段合法 UTF-8 字符串）。这个坑我踩过一次，症状是
 *   "浏览器里看到的每个字都变了"——看着像编码坏了，其实是发出去的时候就坏了。
 */

import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { arg } from './env.mts'

type Row = [what: string, value: string]

const BASE = arg('base', 'http://localhost:3000')
const ROOT = resolve(arg('out', '.out/web'))
/**
 * 只建孩子就停。改档案那几下要**在浏览器里改**一遍：
 * 脚本能验磁盘，验不了"那一格在不在页面上、保存之后标题跟不跟着变"。
 */
const SEED_ONLY = arg('seed-only', '') === '1'
const PROFILE_DIR = join(ROOT, 'children')

function table(rows: readonly Row[]): string {
  const width = Math.max(...rows.map(([what]) => [...what].length))
  return rows
    .map(([what, value]) => `  ${what}${' '.repeat(width - [...what].length)}  ${value}`)
    .join('\n')
}

/** 磁盘上那条档案的**原始字节**。★ 比对用它，不用解析出来的对象 */
async function rawProfile(childId: string): Promise<string | null> {
  const path = join(PROFILE_DIR, `${childId}.json`)
  if (!existsSync(path)) return null
  return await readFile(path, 'utf8')
}

type Body = {
  name?: string
  nameReading?: string
  ageBand?: string
  lookTags?: string[]
  interestTags?: string[]
}

async function send(
  path: string,
  method: string,
  body: Body,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, text: await response.text() }
}

function pick(text: string, keys: readonly string[]): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const record = (parsed['profile'] ?? parsed) as Record<string, unknown>
    return keys.map((k) => `${k}=${JSON.stringify(record[k])}`).join(' ')
  } catch {
    return text.slice(0, 80)
  }
}

async function main(): Promise<void> {
  const rows: Row[] = []

  // ── ① 用一个真的孩子开始。**从真路由建**，不从磁盘塞：
  //    这一支要验的是"改"，而被改的那条要是**建档那条路**产出的形状
  const made = await send('/api/children', 'POST', {
    name: '小禾',
    nameReading: 'hé',
    ageBand: '4-6',
    lookTags: ['短发', '爱笑'],
    interestTags: ['小猫'],
  })
  const childId = (JSON.parse(made.text) as { childId: string }).childId
  const before = await rawProfile(childId)
  if (!before) {
    console.log(`\n建档没落盘（${made.status}）。dev server 起来了吗？${BASE}\n`)
    process.exitCode = 1
    return
  }
  rows.push(['① 建一个探针孩子', `${childId} · ${made.status}`])
  rows.push([
    '  建好之后磁盘上的样子',
    pick(before, ['name', 'nameReading', 'ageBand', 'lookTags']),
  ])

  if (SEED_ONLY) {
    console.log(`\n只建孩子（--seed-only=1）\n\n${table(rows)}\n`)
    console.log(`去这一页改：${BASE}/character/${childId}\n`)
    console.log(`（改完删掉它：DELETE ${BASE}/api/children/${childId}）\n`)
    return
  }

  // ── ② 真改一次：名字、读音、年龄档、两组标签全动 ────────────────────────────
  //    ★ 年龄档取 `'8+'`（`AGE_BANDS` 四档：`'4-'` / `'4-6'` / `'6-8'` / `'8+'`）。
  //      第一版这里写的是 `'7+'`——那**不是**表里的一档，于是这一步 400，
  //      而下面"updatedAt 没往前走"那一行就报红了。是脚本自己抓出来的：
  //      它报的是"档案没变"，而档案确实没变（因为引擎拒了）——**判据在磁盘上，不在响应码上**，
  //      所以它没有把"我发错了"读成"功能坏了"。
  const patched = await send(`/api/children/${childId}`, 'PATCH', {
    name: '小禾苗',
    nameReading: 'hé miáo',
    ageBand: '8+',
    lookTags: ['马尾'],
    interestTags: ['太空', '船'],
  })
  const after = await rawProfile(childId)
  rows.push(['② 改一次 PATCH', `${patched.status}`])
  rows.push([
    '  改完磁盘上的样子',
    after ? pick(after, ['name', 'nameReading', 'ageBand', 'lookTags']) : '**没有文件**',
  ])

  // ── ③ 两个时间戳 ★ 这一条是这支脚本的主要判据 ─────────────────────────────
  const was = JSON.parse(before) as { createdAt: number; updatedAt?: number }
  const now = JSON.parse(after ?? '{}') as { createdAt: number; updatedAt?: number }
  rows.push([
    '★ createdAt 没被改写',
    `${was.createdAt} → ${now.createdAt} ${was.createdAt === now.createdAt ? '✓' : '**被刷掉了！**'}`,
  ])
  rows.push([
    '★ updatedAt 往前走了',
    `${was.updatedAt} → ${now.updatedAt} ${
      (now.updatedAt ?? 0) > (was.updatedAt ?? 0) ? '✓' : '**没动（等于"没改过"）**'
    }`,
  ])

  // ── ④ 校验失败**不许碰磁盘**：整份文件逐字节比 ─────────────────────────────
  const bad = await send(`/api/children/${childId}`, 'PATCH', {
    name: '',
    nameReading: 'hé miáo',
    ageBand: '8+',
  })
  const afterBad = await rawProfile(childId)
  rows.push(['④ 名字空着 PATCH', `${bad.status} · ${bad.text.slice(0, 60)}`])
  rows.push(['★ 那一次之后磁盘', afterBad === after ? '一个字节都没变 ✓' : '**被改过了！**'])

  // ── ⑤ 年龄档不合法：判据在**引擎**里，这一层不重写一遍 ──────────────────────
  const oddBand = await send(`/api/children/${childId}`, 'PATCH', {
    name: '小禾苗',
    nameReading: 'hé miáo',
    ageBand: '7+岁',
    lookTags: [],
    interestTags: [],
  })
  rows.push(['⑤ 年龄档填个表里没有的', `${oddBand.status} · ${oddBand.text.slice(0, 90)}`])
  rows.push([
    '  引擎那句话在不在响应里',
    oddBand.text.includes('年龄档要是') ? '✓（没有在这层重写判据）' : '**没看到引擎的措辞**',
  ])

  // ── ⑥ 示例孩子改不了：与删不掉是同一条规矩 ─────────────────────────────────
  const demoBefore = await rawProfile('xiaoyu')
  const demo = await send('/api/children/xiaoyu', 'PATCH', {
    name: '改一下试试',
    nameReading: 'shì shì',
    ageBand: '4-6',
  })
  const demoAfter = await rawProfile('xiaoyu')
  rows.push(['⑥ 改示例孩子', `${demo.status} · ${demo.text.slice(0, 70)}`])
  rows.push(['  examples 那一条有没有被改动', demoBefore === demoAfter ? '没动 ✓' : '**被改了！**'])

  // ── ⑦ 不存在的孩子 ────────────────────────────────────────────────────────
  const missing = await send('/api/children/meiyou-zhe-ge', 'PATCH', {
    name: '谁',
    nameReading: 'shuí',
    ageBand: '4-6',
  })
  rows.push(['⑦ 改一个不存在的孩子', `${missing.status} · ${missing.text.slice(0, 60)}`])

  // ── ⑧ 收尾：把这个探针孩子删掉，磁盘回到原样 ────────────────────────────────
  const gone = await fetch(`${BASE}/api/children/${childId}`, { method: 'DELETE' })
  await rm(join(PROFILE_DIR, `${childId}.json`), { force: true })
  rows.push([
    '⑧ 收尾',
    `DELETE ${gone.status} · 磁盘上${existsSync(join(PROFILE_DIR, `${childId}.json`)) ? '**还在**' : '已经干净 ✓'}`,
  ])

  console.log(`\n改一个孩子的档案 · 真跑一次\n\n${table(rows)}\n`)

  const bad2 = rows.filter(([, v]) => v.includes('**'))
  if (bad2.length > 0) {
    console.log(`★ 上面 ${bad2.length} 处标了 ** —— 那是真的不对，不是格式。\n`)
    process.exitCode = 1
  }
}

await main()
