/**
 * build-rag-index.mts —— 把 ① 种子语料（12 本样书）切成 chunks、写出 `src/lib/rag/index.seed.json`
 *
 * 这是**生成物脚本**，先例是 `scripts/sample-tints.py`（改了图要重跑）与
 * `scripts/export-demo-book.mts`。产出随仓库提交，因为：
 *
 *   1. 检索要在**不联网、不跑构建**的地方也能用（判据 1：`engine-run --mode=stub` 跑完一本书）；
 *   2. 它是**资产**不是缓存——语料变了指纹就变，而"这本书是哪一版语料检索出来的"
 *      要能答（进 provenance）。
 *
 * ---------------------------------------------------------------------------
 * ★ 一个不显眼的依赖，先写在这里免得下一个人踩：
 *
 *   这个脚本 import 了 `src/components/booklist/booklist.ts`（内容根），而它内部有
 *   `import type { ThemeKey } from '@/lib/themes.ts'` —— **一个别名导入**。
 *   node 直跑 .mts 时**不认 `@/` 这个 tsconfig 路径别名**，它今天能跑通只因为
 *   那一条是 `import type`：类型导入会被 Node 的类型剥离擦掉，运行时根本不加载它。
 *
 *   所以：**这条链上只许有 `import type` 的别名导入**。谁哪天在这里加一条
 *   运行期的 `@/…` 导入（哪怕只是取一个常量），这个脚本会以
 *   `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib/…'` 挂掉——
 *   那时候把那条改成相对路径，**别去给 node 加别名解析**（那要引一个 loader，
 *   而 scripts/ 现在是一个 `node xxx.mts` 就能跑的世界）。
 *
 * ---------------------------------------------------------------------------
 * 什么时候写、什么时候不写
 *
 *   ★ **语料没变就不动文件。** `builtAt` 的含义因此是"**这一版内容的定稿时间**"，
 *     而不是"我最后一次手贱跑脚本的时间"。不这么做，每次重跑都会让这个 JSON
 *     产生一行 diff（时间戳），而那行 diff 没有信息、只有噪音。
 *     要强制重写：`--force`。
 *
 * ```bash
 * node scripts/build-rag-index.mts
 * node scripts/build-rag-index.mts --force
 * ```
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { BOOKLIST } from '../src/components/booklist/booklist.ts'
import {
  buildRagIndex,
  chunksFromBooklist,
  parseRagIndex,
  RAG_OWNER_LIBRARY,
  type RagIndex,
} from '../src/lib/rag/corpus.ts'
import { flag } from './env.mts'

const OUT = fileURLToPath(new URL('../src/lib/rag/index.seed.json', import.meta.url))

async function readExisting(): Promise<RagIndex | null> {
  try {
    return parseRagIndex(JSON.parse(await readFile(OUT, 'utf8')))
  } catch {
    // 读不出来（首次生成、或上一版形状已经过时）都当"没有"处理——
    // 反正这一趟就是来重写它的。**但只在写这一侧宽容**：
    // 运行时那份由工单 04 的 loader 读，它坏了就必须报错（parseRagIndex 的纪律）
    return null
  }
}

async function main(): Promise<void> {
  const chunks = chunksFromBooklist(BOOKLIST)

  // ★ 种子索引里出现 `u/` 开头的 owner 就是隐私事故（spec §三）。
  //   今天不可能发生（这里唯一的来源是样书），所以这是一道**将来会被改坏的护栏**
  const foreign = chunks.filter((chunk) => chunk.owner !== RAG_OWNER_LIBRARY)
  if (foreign.length > 0) {
    throw new Error(
      `种子语料里混进了 ${foreign.length} 条非 library 的 chunk（第一条：${foreign[0]?.id}）——` +
        '`u/<userId>` 是某个家庭的私有物，一个字节都不许进仓库',
    )
  }

  const existing = await readExisting()
  const next = buildRagIndex(chunks, Date.now())

  const themes = new Map<string, number>()
  for (const chunk of chunks) themes.set(chunk.theme, (themes.get(chunk.theme) ?? 0) + 1)

  process.stdout.write(`语料：${BOOKLIST.length} 本样书 → ${chunks.length} 条 chunk\n`)
  process.stdout.write(
    `主题：${[...themes].map(([theme, count]) => `${theme}×${count}`).join(' ')}\n`,
  )
  process.stdout.write(`指纹：${next.corpusVersion}\n`)

  if (existing && existing.corpusVersion === next.corpusVersion && !flag('force')) {
    process.stdout.write(`\n语料没变（与盘上那份指纹相同），**文件没动**。要强制重写加 --force。\n`)
    return
  }

  const body = `${JSON.stringify(next, null, 2)}\n`
  await writeFile(OUT, body, 'utf8')

  // 写完**读回来解析一遍**：形状漂了当场知道，别等运行时那个 loader 报错
  const back = parseRagIndex(JSON.parse(await readFile(OUT, 'utf8')))
  if (back.chunks.length !== chunks.length || back.corpusVersion !== next.corpusVersion) {
    throw new Error('写出去再读回来对不上——索引文件的形状漂了，别用这一份')
  }

  const bytes = Buffer.byteLength(body, 'utf8')
  process.stdout.write(
    `\n写下 ${OUT}\n` +
      `  ${back.chunks.length} 条 · ${(bytes / 1024).toFixed(1)} kB · 指纹 ${back.corpusVersion}\n` +
      `${existing ? `  （上一版指纹 ${existing.corpusVersion}）` : '  （首次生成）'}\n`,
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`\n生成索引失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
