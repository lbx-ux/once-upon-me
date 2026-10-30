/**
 * safety-judge-real-books.mts —— 语义复核在**真书**上的误拦与噪声底（2026-10-30）
 *
 * ```bash
 * node scripts/safety-judge-real-books.mts                 # 真书 + 12 本样书，每本 3 次
 * node scripts/safety-judge-real-books.mts --only=real     # 只看真书
 * node scripts/safety-judge-real-books.mts --repeat=1      # 先试一遍
 * node scripts/safety-judge-real-books.mts --limit=2       # 先试两本
 * node scripts/safety-judge-real-books.mts --dump=1        # 只摊语料，不调用模型（人工标注用）
 * ```
 *
 * 它回答的是 `safety-judge-cases.mts` 回答不了的那个问题：
 * **手写样本之外，这个名字在真书上会不会乱响。**
 *
 * ★ 先把"这一轮能量什么"说清楚，别让读数被读成它没有的意思：
 *
 *   · 真书与 12 本样书都是**假定干净**的（它们已经发出去、在书架/书单里给人看过），
 *     所以这里能量的是**误拦**（把干净的说成越线）与**触发率**（生产上会不会多花一次调用）。
 *   · **漏拦率量不了**：没有人工标注的"这一页本来该被拦"的真值。要量它，得先有一份
 *     标好的语料——那是另一件事，别拿"真书一本都没报"当"它不漏"。
 *
 * ★ 每本跑 `--repeat` 次（缺省 3）：`temperature: 0` 不是确定性，这一档的另外两把尺子
 *   （一致性分、画面审核）都留下过同一份输入翻边的记录。只跑一次的"没报"说明不了什么。
 *
 * ★ 触发率与模型误拦率是**两个数**，分开报：
 *   · 触发率 = `suspicionOf` 命中了几本（生产上这几本才会多花一次调用）；
 *   · 模型误拦率 = 把每本直接送进 `judgeStory`（绕过触发闸）时，它报了几本。
 *   前者是成本，后者是模型的手感。把它们合成一个数，两个问题都答不清楚。
 *
 * 产物：`.out/safety-judge-real/report.md`（UTF-8，逐本逐条），控制台只印汇总。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { glob } from 'node:fs/promises'
import { join } from 'node:path'

import { arg, readEnv } from './env.mts'
import { BOOKLIST } from '../src/components/booklist/booklist.ts'
import { judgeStory } from '../src/lib/engine/review-judge.ts'
import { suspicionOf } from '../src/lib/engine/suspicion.ts'
import { textProviderOf } from '../src/lib/engine/providers/registry.ts'
import type { StoryNode, StoryTree } from '../src/lib/engine/domain.ts'

type Loaded = {
  kind: 'real' | 'booklist'
  id: string
  title: string
  form: string
  pages: number
  tree: StoryTree
  source: string
}

function nodeOf(pageNo: number, body: readonly string[], title = ''): StoryNode {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    scene: title,
    body,
    imagePrompt: '纸上的插画',
    mood: 'calm',
    next: [],
    pathFromRoot: [`n${pageNo}`],
  }
}

/** `fs.glob` 回的是异步迭代器，不是数组（Node 24）。这里收成数组，按路径排序 */
async function globAll(pattern: string): Promise<string[]> {
  const out: string[] = []
  for await (const file of glob(pattern)) out.push(file)
  return out.sort()
}

/** 真书：`.out/web/u/<用户>/books/<书号>/book.json` 与 `public/demo/books/<书号>/book.json`，按书号去重 */
async function loadReal(): Promise<Loaded[]> {
  const files = [
    ...(await globAll('.out/web/u/*/books/*/book.json')),
    ...(await globAll('public/demo/books/*/book.json')),
  ]
  const seen = new Set<string>()
  const out: Loaded[] = []
  for (const file of files) {
    const raw = JSON.parse(await readFile(file, 'utf8')) as {
      bookId?: string
      form?: string
      tree?: StoryTree
    }
    if (!raw.tree) continue
    const id = raw.bookId ?? raw.tree.title
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      kind: 'real',
      id,
      title: raw.tree.title,
      form: raw.form ?? raw.tree.form,
      pages: raw.tree.nodes.length,
      tree: raw.tree,
      source: file,
    })
  }
  return out
}

/** 12 本样书：人手写的、96 个跨页。最强的一批"正常"语料 */
function loadBooklist(): Loaded[] {
  return BOOKLIST.map((book) => {
    const nodes = book.spreads.map((spread, index) =>
      nodeOf(index + 1, [spread.caption, ...spread.text], book.title),
    )
    return {
      kind: 'booklist' as const,
      id: `booklist:${book.title}`,
      title: book.title,
      form: 'booklist',
      pages: nodes.length,
      tree: { form: 'solo' as const, title: book.title, rootId: 'n1', nodes },
      source: 'src/components/booklist/booklist.ts',
    }
  })
}

type Run = {
  verdict: string
  findings: readonly { clauseId: string; pageNo: number; word: string; context: string }[]
  dropped: number
  reason: string
}

async function main(): Promise<void> {
  const env = await readEnv()
  const text = textProviderOf(env)
  const only = arg('only', 'all')
  const repeat = Math.max(1, Number(arg('repeat', '3')) || 3)
  const limit = Number(arg('limit', '0')) || 0

  const real = only === 'booklist' ? [] : await loadReal()
  const samples = only === 'real' ? [] : loadBooklist()
  const books = [...real, ...samples].slice(0, limit || undefined)

  /* `--dump=1`：只把语料摊成一份可读的 UTF-8 文件，**一次模型都不调**。
     用途是人工标注"这一页本来该不该被拦"——漏拦率没有真值就量不了，而真值只能人读出来。
     控制台是 GBK，中文一律走文件（与仓库里其它中文报告同一条做法）。 */
  if (arg('dump', '') === '1') {
    const corpus = ['# 复核语料（只读，不调用模型）', '']
    for (const book of books) {
      corpus.push(`## ${book.title}（${book.id}）`, '')
      for (const node of book.tree.nodes) {
        corpus.push(`- 第 ${node.pageNo} 页：${node.body.join(' / ')}`)
        if (node.choice) {
          const [a, b] = node.choice.options
          corpus.push(
            `  - 选择点：${node.choice.prompt}｜A ${a?.label ?? ''} / B ${b?.label ?? ''}`,
          )
        }
      }
      corpus.push('')
    }
    await mkdir(join(process.cwd(), '.out/safety-judge-real'), { recursive: true })
    const out = join(process.cwd(), '.out/safety-judge-real/corpus.md')
    await writeFile(out, corpus.join('\n'), 'utf8')
    console.log(`语料 ${books.length} 本 → ${out}`)
    return
  }

  const lines: string[] = [
    `# 语义复核 · 真书与样书复核`,
    '',
    `模型：\`${text.modelId}\` · 每本 ${repeat} 次 · ${new Date().toISOString()}`,
    '',
    '★ 真书与样书都**假定干净**：这里量的是误拦与触发率，不是漏拦率（见脚本文件头）。',
    '',
  ]

  let calls = 0
  let unavailable = 0
  let dropped = 0
  let triggeredBooks = 0
  let flaggedBooks = 0
  let flaggedRuns = 0
  let totalRuns = 0
  const flaggedSamples: string[] = []

  for (const book of books) {
    const signals = suspicionOf({ tree: book.tree })
    if (signals.length > 0) triggeredBooks += 1
    const runs: Run[] = []
    for (let index = 0; index < repeat; index += 1) {
      const outcome = await judgeStory(book.tree, text)
      calls += 1
      totalRuns += 1
      if (outcome.verdict === 'unavailable') unavailable += 1
      dropped += outcome.dropped
      if (outcome.verdict === 'flag' || outcome.verdict === 'block') flaggedRuns += 1
      runs.push({
        verdict: outcome.verdict,
        findings: outcome.findings.map((finding) => ({
          clauseId: finding.clauseId,
          pageNo: finding.pageNo,
          word: finding.word,
          context: finding.context,
        })),
        dropped: outcome.dropped,
        reason: outcome.reason,
      })
    }
    const flagged = runs.some((run) => run.verdict === 'flag' || run.verdict === 'block')
    if (flagged) {
      flaggedBooks += 1
      flaggedSamples.push(`《${book.title}》（${book.id}）`)
    }

    lines.push(`## ${book.kind === 'real' ? '真书' : '样书'} · 《${book.title}》`)
    lines.push('')
    lines.push(`- 书号：\`${book.id}\` · ${book.form} · ${book.pages} 页 · 来源 \`${book.source}\``)
    lines.push(
      `- 触发信号：${signals.length === 0 ? '无' : signals.map((s) => `${s.code}（${s.detail}）`).join('；')}`,
    )
    lines.push(
      `- ${repeat} 次：${runs.map((run) => run.verdict).join(' / ')}` +
        ` · dropped ${runs.reduce((sum, run) => sum + run.dropped, 0)}`,
    )
    runs.forEach((run, index) => {
      if (run.findings.length === 0) return
      lines.push('')
      lines.push(`### 第 ${index + 1} 次：${run.verdict}`)
      for (const finding of run.findings) {
        const where = finding.pageNo === 0 ? '书名' : `第 ${finding.pageNo} 页`
        lines.push(`- ${where} · ${finding.clauseId} · 「${finding.word}」`)
        lines.push(`  - 模型给的理由：${finding.context}`)
      }
    })
    lines.push('')
  }

  lines.push('## 汇总')
  lines.push('')
  lines.push(
    `- 书：${books.length} 本（真书 ${real.length}、样书 ${samples.length}），每本 ${repeat} 次`,
  )
  lines.push(`- 触发信号：${triggeredBooks} / ${books.length} 本（生产上这几本才会多花一次调用）`)
  lines.push(
    `- 模型报了：${flaggedBooks} / ${books.length} 本（${flaggedRuns} / ${totalRuns} 次）` +
      (flaggedSamples.length === 0 ? '' : `：${flaggedSamples.join('、')}`),
  )
  lines.push(`- 没测成：${unavailable} 次`)
  lines.push(`- 模型报了但原文里找不到：${dropped} 条`)
  lines.push('')
  lines.push('★ 漏拦率**没有量**：这批书没有人工标注的"本该被拦"的真值。')

  await mkdir(join(process.cwd(), '.out/safety-judge-real'), { recursive: true })
  const out = join(process.cwd(), '.out/safety-judge-real/report.md')
  await writeFile(out, lines.join('\n'), 'utf8')

  console.log(`模型 ${text.modelId} · ${books.length} 本 × ${repeat} 次 · 调用 ${calls} 次`)
  console.log(
    `触发信号 ${triggeredBooks}/${books.length} 本 · 模型报了 ${flaggedBooks}/${books.length} 本（${flaggedRuns}/${totalRuns} 次）`,
  )
  console.log(`没测成 ${unavailable} 次 · dropped ${dropped} 条`)
  console.log(`报告：${out}`)
}

await main()
