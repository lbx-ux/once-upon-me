/**
 * env.mts —— 脚本共用的两个小 helper：读 .env.local、读命令行参数。
 *
 * ★ 这里**故意没有**预算账本与"确认花费"的闸门。10/13 问过，答复是额度管够、
 *   不必记账也不必逐次报告。所以跑测脚本发请求前不再要求 `--yes=1`。
 *   省下来的不只是几个字：一个每次都要按的确认键，最后只会变成条件反射式地敲下去，
 *   那时候它已经不再拦任何东西了。
 */

import { readFile } from 'node:fs/promises'

export async function readEnv(): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = { ...process.env }
  try {
    for (const line of (await readFile('.env.local', 'utf8')).split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (match) env[match[1] as string] = (match[2] as string).replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 没有 .env.local 就用进程环境；缺什么下面会报 */
  }
  return env
}

export function arg(name: string, fallback = ''): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
