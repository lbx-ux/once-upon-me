/**
 * check-secrets.mts —— ★ 密钥"三不进"的**可重复跑的**自查（工单 03 §二）
 *
 * ```bash
 * node scripts/check-secrets.mts                                  # 查缺省范围
 * node scripts/check-secrets.mts --root=.out/web --root=public/demo
 * ```
 *
 * 为什么它必须是一个命令，而不是"我检查过了"：
 * ADR-0008 承诺用户的 key **不落盘、不进日志、不进录制文件**。
 * 一个靠人去看的承诺，在第一次赶工时就会失效——而它失效的样子是**没有任何症状**。
 * `auditManifest` 是同一个形状：能复现的自查才算自查。
 *
 * ★ 搜两样东西：key 的完整值，以及**它的前 8 个字符**。
 *   只搜完整串等于只防最蠢的那种泄法；真要泄，泄的是
 *   `Authorization: Bearer sk-abc123…` 被截断打印的那一段。
 *
 * ★ 本脚本**不打印密钥**：命中时只报"哪个文件、哪一行、位置在多少字节处"。
 *   一个为了查泄漏而把密钥打到屏幕上的工具，是这次泄漏的同谋。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { readEnv } from './env.mts'

/** 只看文本；二进制媒体里"碰巧出现 key"是不可能事件，扫它只是白烧时间 */
const TEXT_EXT = new Set(['.json', '.jsonl', '.txt', '.md', '.log', '.sse', '.html', '.css', '.js'])

/** 我们自己的开发 key：只写 .env.local（README 已定）。它们同样不许出现在产物里 */
const SECRET_KEYS = ['LLM_API_KEY', 'IMAGE_API_KEY', 'VISION_API_KEY', 'TTS_API_KEY']

const DEFAULT_ROOTS = ['.out/web', 'public/demo']

type Hit = { file: string; needle: string; at: number }

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: { name: string; isDirectory(): boolean }[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // 目录不存在 = 这一项没有产物，不是错误
  }
  for (const entry of entries) {
    const child = join(dir, entry.name)
    if (entry.isDirectory()) await walk(child, out)
    else if (TEXT_EXT.has(extname(entry.name).toLowerCase())) out.push(child)
  }
}

async function main(): Promise<void> {
  const roots = process.argv
    .filter((item) => item.startsWith('--root='))
    .map((item) => item.slice('--root='.length))
  const targets = roots.length > 0 ? roots : DEFAULT_ROOTS

  const env = await readEnv()
  const needles: { label: string; value: string }[] = []
  for (const key of SECRET_KEYS) {
    const value = env[key]?.trim()
    if (!value || value.length < 6) continue
    needles.push({ label: `${key}（完整值）`, value })
    // 前 8 个字符：防"被截断后进日志"——那正是最可能真实发生的泄法
    needles.push({ label: `${key}（前 8 字符）`, value: value.slice(0, 8) })
  }
  if (needles.length === 0) {
    // 没有 key 就没有可查的对象。**如实说**，不是"全部通过"
    process.stdout.write('没有可查的密钥（.env.local 里这几个变量都是空的）——这一轮什么都没验\n')
    return
  }

  const files: string[] = []
  for (const root of targets) await walk(resolve(root), files)

  const hits: Hit[] = []
  for (const file of files) {
    // 大文件跳过：产物里没有这么大的文本，多半是误扫进了一个二进制
    const info = await stat(file)
    if (info.size > 8 * 1024 * 1024) continue
    const text = await readFile(file, 'utf8')
    for (const needle of needles) {
      const at = text.indexOf(needle.value)
      if (at >= 0) hits.push({ file: relative(process.cwd(), file), needle: needle.label, at })
    }
  }

  process.stdout.write(
    `密钥自查 · 范围 ${targets.join(' / ')} · 扫了 ${files.length} 个文本文件 · ` +
      `${needles.length} 条模式（每把 key 查完整值与前 8 字符）\n`,
  )
  if (hits.length === 0) {
    process.stdout.write('命中 0 次 ✓\n')
    return
  }
  process.stdout.write(`★ 命中 ${hits.length} 次——下面是位置，**不打印密钥本身**：\n`)
  for (const hit of hits.slice(0, 20)) {
    process.stdout.write(`  ${hit.file} · ${hit.needle} · 第 ${hit.at} 字节处\n`)
  }
  process.exitCode = 1
}

main().catch((err: unknown) => {
  process.stderr.write(`失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
