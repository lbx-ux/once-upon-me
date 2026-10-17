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

/**
 * 有没有这个**开关**。
 *
 * ★ 加这一条是因为 `arg()` 当场咬了一次，而且咬得很安静：
 *   `arg('sheet')` 没传时返回的是 `''`（缺省值），**不是 `undefined`**，
 *   于是 `if (arg('sheet') !== undefined)` 永远成立——那条分支一旦加上去，
 *   它前面的 `--apply=` 与出图两条路就再也走不到了（`--apply=chuan` 跑完什么都没落，
 *   只是又拼了一张对照表）。要值就用 `arg('--only=chuan')`，要"出现过没有"就用它。
 *   两种写法都收：`--sheet`（文件头里就是这么写的）与 `--sheet=1`。
 */
export function flag(name: string): boolean {
  return process.argv.some((item) => item === `--${name}` || item.startsWith(`--${name}=`))
}
