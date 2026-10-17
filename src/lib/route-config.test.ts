/**
 * route-config.test.ts —— 段配置的导出必须是**字面量**
 *
 * 为什么值得一条测试：这条规则被违反时，**三道闸门全绿，而 `pnpm build` 整包红**。
 * 2026-10-17 实测：22 个 BFF 路由写成 `export const runtime = AUTH_ROUTE_CONFIG.runtime`，
 * Next 报 `Invalid segment configuration export detected` —— 而 eslint / tsc / vitest
 * 当时一个都没说话，因为那是合法 TS。一个只有第四道闸门照得出来的错误，
 * 值得让第一道闸门也照一次。
 *
 * ★ 判据取的是「Next 读不读得懂这个导出」，所以只认**字面量**：
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

/** 会话型 BFF：这几个目录下的路由依赖 cookie 与 `node:crypto`，两行字面量一个都不能少 */
const BFF_DIRS = ['api/auth', 'api/admin', 'api/voices', 'api/permission-requests']

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
      (f) => f.endsWith('route.ts') && BFF_DIRS.some((d) => rel(f).startsWith(d + '/')),
    )
    expect(routes.length).toBeGreaterThan(20)
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
