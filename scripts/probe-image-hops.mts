/**
 * probe-image-hops.mts —— 出图这条链**两跳分开测**
 *
 * 用法（仓库根）：
 *
 * ```bash
 * node scripts/probe-image-hops.mts              # 免费：只查 API 与 OSS 那一跳的握手
 * node scripts/probe-image-hops.mts --generate   # 花钱：真出一张图（一次调用）
 * node scripts/probe-image-hops.mts --ossHost=xxx.oss-cn-beijing.aliyuncs.com
 * ```
 *
 * ★ 为什么值得单独一个脚本（2026-10-15 深夜的实测）。那天「跑一本 20 页的书」被卡住，
 *   而卡住的地方**不是出图 API**，是**下载成品图**：
 *
 *   | 跳 | 主机 | 当时 |
 *   | --- | --- | --- |
 *   | ① 生成 | `tokenrhythm.studio` | 通（`/models` 200） |
 *   | ② 下载 | `tokenrhythm-prod-backup-oss.oss-cn-beijing.aliyuncs.com` | **0/6 全挂**，每次卡在 ~5.01s 的 TLS 握手期 `ECONNRESET` |
 *
 *   这个形状很坏：**生成成功、已计费，图却拿不到**。所以"要跑整本之前先测这两跳"
 *   是能省下真金白银的一步，而不是洁癖。
 *
 * ★ 判据是**那一秒数**：0/6 且每次都在同一秒数（实测 5.01–5.11s）说明是**确定性**的
 *   路由问题（本机在 fake-IP 代理后面，DNS 解析到 `198.18.0.0/15`），不是抖动。
 *   抖动会散在几百毫秒到十几秒之间。
 *
 * ★ **别用 `new URL(path, base)` 拼地址**：base 是 `https://host/v1` 时，
 *   `new URL('/models', …)` 会把 `/v1` 整个吃掉，请求打到人家官网首页并拿到 200——
 *   于是"主机可达、密钥可用"这个结论是**假的**。用引擎自己的 `joinUrl`。
 *
 * 密钥只从 `.env.local` 读，**不打印**；签名 URL 只取主机名，
 * **查询串里的 `x-oss-credential` / `x-oss-signature` 是临时凭据，不进输出**。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'

import { joinUrl } from '../src/lib/engine/providers/http.ts'
import { imageProviderOf, type Env } from '../src/lib/engine/providers/registry.ts'

const args: Record<string, string> = {}
for (const item of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(item)
  if (m && m[1]) args[m[1]] = m[2] ?? '1'
}

function loadEnv(): Env {
  const env: Env = {}
  if (!existsSync('.env.local')) return env
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m && m[1]) env[m[1]] = (m[2] ?? '').trim()
  }
  return env
}

const BOOKS = '.out/web/books'

/**
 * 从已有书里捡一个 OSS 主机名：签名会过期，**主机名不会**。
 * 只取主机名这件事不是洁癖——整条 URL 里带着一次性凭据。
 */
function ossHostFromExistingBooks(explicit: string | undefined): string {
  if (explicit) return explicit
  if (!existsSync(BOOKS)) return ''
  let names: string[] = []
  try {
    names = readdirSync(BOOKS)
  } catch {
    return ''
  }
  for (const name of names) {
    try {
      const raw = readFileSync(`${BOOKS}/${name}/book.json`, 'utf8')
      const m = /https:\/\/([a-z0-9.-]*oss[a-z0-9.-]*aliyuncs\.com)/i.exec(raw)
      if (m && m[1]) return m[1]
    } catch {
      // 读不了就试下一本
    }
  }
  return ''
}

function stamp(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function write(text: string): void {
  process.stdout.write(text)
}

async function probeHandshake(host: string, times: number): Promise<boolean> {
  let ok = 0
  const took: number[] = []
  for (let i = 1; i <= times; i += 1) {
    const t = Date.now()
    try {
      const r = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(12_000) })
      ok += 1
      took.push(Date.now() - t)
      write(`  第 ${i} 次 HTTP ${r.status}  ${Date.now() - t}ms\n`)
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause
      took.push(Date.now() - t)
      write(`  第 ${i} 次 失败 ${Date.now() - t}ms  ${cause?.code ?? (err as Error).message}\n`)
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  const spread = Math.max(...took) - Math.min(...took)
  write(
    `  → ${ok}/${times} 成功；耗时离散度 ${spread}ms` +
      (ok === 0 && spread < 500 ? '（★ 太齐了：确定性路由问题，不是抖动）' : '') +
      '\n',
  )
  return ok > 0
}

async function main(): Promise<void> {
  const env = loadEnv()
  const base = env['IMAGE_BASE_URL'] ?? ''
  const key = env['IMAGE_API_KEY'] ?? ''
  write(`出图两跳探针 · ${stamp()}\n\n`)

  write('【第 ① 跳】出图 API\n')
  if (!base || !key) {
    write('  IMAGE_BASE_URL / IMAGE_API_KEY 没配，跳过\n')
  } else {
    const url = joinUrl(base, '/models')
    write(`  地址 ${url}（★ 用 joinUrl，不是 new URL）\n`)
    try {
      const r = await fetch(url, { headers: { authorization: `Bearer ${key}` } })
      const snippet = (await r.text()).slice(0, 80).replace(/\s+/g, ' ')
      write(`  → HTTP ${r.status}  ${snippet}\n`)
      write(r.ok ? '  ✅ 这一跳通\n' : '  ⚠️ 这一跳没通（密钥或权限问题）\n')
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause
      write(`  → 失败 ${cause?.code ?? (err as Error).message}\n`)
    }
  }

  write('\n【第 ② 跳】下载成品图的那个 OSS 主机\n')
  const host = ossHostFromExistingBooks(args['ossHost'])
  if (!host) {
    write('  没找到主机名（`.out` 里没有书，也没给 `--ossHost=`）——加 `--generate` 跑一次就有了\n')
  } else {
    write(`  主机 ${host}\n`)
    const pass = await probeHandshake(host, 6)
    write(
      pass
        ? '  ✅ 这一跳通，可以跑整本\n'
        : '  ⛔ 这一跳不通 ⇒ **现在跑整本会一页页付钱、一张图都拿不到**\n' +
            '     处置在代理里（把该域名加成 DIRECT 或换节点），不在代码里\n',
    )
  }

  if (args['generate']) {
    write('\n【端到端】真出一张图（★ 这一条会花钱，一次调用）\n')
    try {
      const made = await imageProviderOf(env).generate({
        prompt: '一个白色的圆点，纯色背景',
        size: '1024x1024',
      })
      write(`  ✅ 生成并下载成功 ${made.bytes.length} 字节\n`)
    } catch (err) {
      const code = (err as { code?: string }).code
      write(`  ❌ 失败${code ? `（${code}）` : ''}：${(err as Error).message}\n`)
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
