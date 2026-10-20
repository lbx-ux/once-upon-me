/**
 * route-config.test.ts —— 段配置的导出必须是字面量
 *
 * 为什么值得一条测试：这条规则被违反时，三道闸门全绿，而 `pnpm build` 整包红。
 * 2026-10-17 实测：22 个 BFF 路由写成 `export const runtime = AUTH_ROUTE_CONFIG.runtime`，
 * Next 报 `Invalid segment configuration export detected` —— 而 eslint / tsc / vitest
 * 当时一个都没说话，因为那是合法 TS。一个只有第四道闸门照得出来的错误，
 * 值得让第一道闸门也照一次。
 *
 * 判据取的是「Next 读不读得懂这个导出」，所以只认字面量：
 *   段配置全是字符串或数字字面量，成员表达式与标识符一律不算。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP = fileURLToPath(new URL('../app', import.meta.url))

/** Next 会读的那些段配置 */
const SEGMENT_CONFIGS = [
  'runtime',
  'dynamic',
  'revalidate',
  'fetchCache',
  'preferredRegion',
  'maxDuration',
  'config',
] as const

/**
 * 会话型 BFF 的判据：它自己问那道闸，而不是一份目录名单。
 *
 * ★ 2026-10-17 改过一次，原因是名单漏了。原来这里写死四个目录
 *   （`api/auth` / `api/admin` / `api/voices` / `api/permission-requests`；
 *   最后那个 2026-10-18 随权限申请一起拆了，而这正说明了名单的坏处——
 *   它会过期，而扫标记不会），
 *   而当天实测：11 个目录、35 条路由都在读 cookie（`api/books`、`api/cards`、
 *   `api/children`、`api/voice`、`api/optimize`、`api/assets` … 全都不在名单里）。
 *   现状当时是干净的（43 条路由一个不漏），但那份干净靠的是巧合：
 *   手写名单的错法很安静——新增一个会话路由目录时这一条不会红，
 *   而它保护的恰好是"忘了写 `force-dynamic` 就会跨用户串数据"这种错。
 *
 * 扫多了是安全的（多要求两行字面量），扫少了才是事故，所以判据取"源码里出现过
 *   这些标记中的任何一个"。注释里出现这些词也会被算进来——那只是多要求两行，
 *   可接受；反过来漏掉一条路就没得救了。
 */
const SESSION_MARKERS = ['requireCapability(', 'cookies()', 'sessionOf(', 'currentUserId('] as const

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/^(route\.ts|page\.tsx|layout\.tsx)$/.test(name)) yield full
  }
}

const ALL_FILES = [...walk(APP)]
const rel = (file: string) => relative(APP, file).split('\\').join('/')

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/** 抓 `export const runtime = …` 的右半边 */
function violations(file: string): string[] {
  const source = read(file)
  const bad: string[] = []
  const re = new RegExp(`^export const (${SEGMENT_CONFIGS.join('|')})\\s*=\\s*(.+?)\\s*$`, 'gm')
  for (const [, key, raw] of source.matchAll(re)) {
    const value = raw.trim()
    if (!/^'[^']*'$/.test(value) && !/^\d+$/.test(value)) bad.push(`${key} = ${value}`)
  }
  return bad
}

describe('src/app 下的段配置导出', () => {
  it('扫到的文件不是个位数 —— 否则下面几条是空循环，空循环永远绿', () => {
    expect(ALL_FILES.length).toBeGreaterThan(30)
  })

  it('每一处的值都是**字面量**（成员表达式会让 `pnpm build` 整包红）', () => {
    const offenders = ALL_FILES.flatMap((file) =>
      violations(file).map((v) => `${rel(file)} → ${v}`),
    )
    expect(offenders).toEqual([])
  })

  it('会话型 BFF 的每个路由都自己写了那两行', () => {
    const routes = ALL_FILES.filter(
      (file) =>
        file.endsWith('route.ts') && SESSION_MARKERS.some((marker) => read(file).includes(marker)),
    )
    // 下限而不是等号：判据是"扫法本身没坏"。今天实测 35 条；
    //   哪天这些标记换了写法、或者文件改了名，这一条先红，
    //   而不是安静地退化成"一条都没扫到，所以全绿"
    expect(routes.length).toBeGreaterThan(30)
    const missing = routes.filter((file) => {
      const source = read(file)
      return (
        !source.includes("export const runtime = 'nodejs'") ||
        !source.includes("export const dynamic = 'force-dynamic'")
      )
    })
    expect(missing.map(rel)).toEqual([])
  })
})
