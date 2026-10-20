/**
 * picture-review-cases.mts —— 画面审核的**误报率**与**噪声底**（`.scratch/safety` 工单 01 的判据）
 *
 * ★ 这个脚本存在的理由只有一句：**画面那一路是兜底，不是判据**，
 *   所以它唯一能拿出来的东西就是一条实测读数——"在我们真正出过的那些图上，它误报了几张"。
 *   没有这个数，"我们加了画面审核"就只是一句关于代码的话，不是一句关于行为的话。
 *
 * 三组样本，**分别报，不许合并成一个百分比**：
 *
 * | 组 | 是什么 | 该有的结果 |
 * |---|---|---|
 * | 反例（真图） | `.out/web/u/<user>/books/<id>/` 下那一堆 `page-N-aM.png` 与 `cover` | 一条都不该报 |
 * | 正例 | `.out/picture-review-cases/pos-*.png` | 每条都该报出来 |
 * | 没测成 | 网关限流 / 超时 / 模型没给 JSON | **单独一栏，不并进上面两栏的分子分母** |
 *
 * ★ 正例那一栏里躺着**两种东西**，读报告时要分开看（脚本按文件名印出是哪一种）：
 *
 *   · **合成示意图**（`pos-monster` / `pos-match` / `pos-club`）——
 *     `scripts/make-picture-review-positives.py` 画的平面色块与线条。
 *     它证明的是"这六条条款能被模型**读懂并触发**"。
 *   · **一张真插画**（`pos-real-fight`）——
 *     `scripts/make-picture-review-real-positive.mts` 用**生产同一个出图 provider**
 *     画的一张"两个男孩抢玩具、一个把另一个推倒"。
 *     它才回答产品真正关心的那个问题：**真插画里的越线内容抓不抓得住**。
 *
 * ★★ `--repeat=N`：**同一个输入连打 N 次**，这一个开关是这个脚本最要紧的一格。
 *   起因是 2026-10-20 的一次实测翻边——**同一张 `pos-real-fight.png` 同一份提示词**，
 *   第一轮"没报"、第二轮**报了 R-02**（而且描述准确到"穿橙色T恤的男孩正用双手抓着
 *   坐在地上的穿蓝色连帽衫男孩的手臂和肩膀"）；`pos-club` 则反过来，
 *   第一轮报了（还报错了条款）、第二轮没报。
 *   **`temperature: 0` 不等于确定性。** 所以这一档的读数**必须**配一个噪声底：
 *   一条只跑一遍的读数，区分不了"它抓得住"和"它这次恰好抓住了"。
 *   ★ 判词因此也变严了：正例要求**满票**（N 次全报）才算抓住，
 *   反例则是**任何一次报了都算误报**（一道闸不许偶尔乱响）。
 *
 * ★ 还有一栏是 2026-10-19 第四条量法纪律（"限流会把全称否定灌水"）：
 *   连打几十次会被网关限流，而"这次没测成"与"这次测出来没问题"在汇总表上
 *   长得一模一样。所以：**只要还剩一格没测成，就不许下全称否定**，
 *   而且探针自己必须退避重试、放慢，不能把限流当成模型的结论。
 *
 * ```bash
 * node scripts/picture-review-cases.mts                    # 全部，每个跑 1 次
 * node scripts/picture-review-cases.mts --limit=20         # 先试一小批
 * node scripts/picture-review-cases.mts --only=pos         # 只跑正例
 * node scripts/picture-review-cases.mts --from=old.txt     # 只跑一张名单上的图（当反例算）
 * node scripts/picture-review-cases.mts --repeat=3         # ★ 量噪声底：每张连打 3 次
 * ```
 *
 * `--from` 的用法是**重跑上一版误报过的那一批**：那是手上最有判别力的样本
 * （第一版条款在 87 张里挑出来的那 32 张），"改成这样之后它们不误报了"
 * 比"换 87 张新图跑一遍"便宜得多，也尖得多。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

import { arg, readEnv } from './env.mts'
import { createOpenAiVision } from '../src/lib/engine/providers/openai-vision.ts'
import { toDataUrl } from '../src/lib/engine/providers/http.ts'
import { PICTURE_CLAUSES } from '../src/lib/rag/review-corpus.ts'

const env = await readEnv()
const baseUrl = env['VISION_BASE_URL'] || env['LLM_BASE_URL'] || 'https://tokenrhythm.studio/v1'
const apiKey = env['VISION_API_KEY'] || env['LLM_API_KEY'] || ''
const model = env['VISION_MODEL'] || ''
if (!apiKey || !model) {
  console.error('需要 VISION_API_KEY（或 LLM_API_KEY）与 VISION_MODEL')
  process.exit(1)
}

/** ★ 走**生产同一个工厂**：跑测的配置必须就是要上线的那个配置（`probe-vision-budget.mts` 开头那条） */
const vision = createOpenAiVision(
  {
    baseUrl,
    apiKey,
    timeoutMs: Number(env['VISION_TIMEOUT_MS'] ?? 180_000),
  },
  model,
)

const ASSET_ROOT = resolve(env['ASSET_ROOT']?.trim() || '.out/web')
const POSITIVE_DIR = resolve('.out/picture-review-cases')

const limit = Number(arg('limit', '0'))
const only = arg('only', '')
/** 限流时的退避。★ 默认比常规探针慢：这个网关对连打很敏感（量法纪律第 4 条） */
const pauseMs = Number(arg('pause', '1200'))
const ATTEMPTS = Number(arg('attempts', '4'))
/** ★ 同一张图连打几次——量噪声底（见文件头那一节） */
const REPEAT = Math.max(1, Number(arg('repeat', '1')))
/** 只跑一份名单上的图（每行一个路径），当**反例**算 */
const fromFile = arg('from', '')

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/** 一次调用的结果。`findings === null` = **没测成**（既不算误报也不算放行） */
type Run = { findings: { clauseId: string; where: string }[] | null; reason?: string }
type Outcome = { path: string; runs: Run[] }

async function collect(dir: string, match: (name: string) => boolean): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(current)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry)
      const info = await stat(full)
      if (info.isDirectory()) await walk(full)
      else if (match(entry)) out.push(full)
    }
  }
  await walk(dir)
  return out.sort()
}

const listed: string[] = fromFile
  ? (await readFile(resolve(fromFile), 'utf8'))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => (/^[A-Za-z]:/.test(line) ? line : resolve(line.replace(/^\\/, ''))))
  : []

const negs = listed.length
  ? listed
  : await collect(ASSET_ROOT, (name) =>
      /^(page-\d+-a\d+|cover(-\w+)?)\.(png|jpe?g|webp)$/.test(name),
    )
const poss = await collect(POSITIVE_DIR, (name) => name.startsWith('pos-'))

let cases: { group: 'neg' | 'pos'; path: string }[] = [
  ...negs.map((path) => ({ group: 'neg' as const, path })),
  ...poss.map((path) => ({ group: 'pos' as const, path })),
]
if (only === 'pos') cases = cases.filter((item) => item.group === 'pos')
if (only === 'neg') cases = cases.filter((item) => item.group === 'neg')
if (limit > 0) cases = cases.slice(0, limit)

console.log(`画面审核 · ${model}`)
console.log(
  `  反例（真出过的图）${negs.length} 张${listed.length ? `（名单 ${fromFile}）` : ''} · 正例 ${poss.length} 张`,
)
console.log(
  `  这一轮跑 ${cases.length} 张 × ${REPEAT} 次，pause=${pauseMs}ms attempts=${ATTEMPTS}\n`,
)

const outcomes: Outcome[] = []
let done = 0

for (const item of cases) {
  done += 1
  const bytes = await readFile(item.path)
  const dataUrl = toDataUrl(bytes, MIME[extname(item.path).toLowerCase()] ?? 'image/png')
  const runs: Run[] = []

  for (let round = 1; round <= REPEAT; round += 1) {
    let hit: Run | null = null
    for (let attempt = 1; attempt <= ATTEMPTS && !hit; attempt += 1) {
      try {
        const response = await vision.reviewPicture({
          pageDataUrl: dataUrl,
          clauses: PICTURE_CLAUSES,
        })
        if (response.findings === null) {
          // ★ 模型答歪了**也算没测成**，不算放行——见文件头那一栏
          console.log(`  [${attempt}] ${item.path} — 没测成：${response.reason ?? '没给理由'}`)
          await sleep(pauseMs * attempt * 2)
          continue
        }
        hit = { findings: [...response.findings], reason: response.reason }
      } catch (err) {
        console.log(`  [${attempt}] ${item.path} — 调用失败：${(err as Error).message}`)
        await sleep(pauseMs * attempt * 2)
      }
    }
    runs.push(hit ?? { findings: null, reason: '重试之后仍然没测成' })
    if (round < REPEAT) await sleep(pauseMs)
  }

  outcomes.push({ path: item.path, runs })
  const short = runs.map((run) =>
    run.findings === null ? '?' : run.findings.length > 0 ? '★' : '·',
  )
  const first = runs.find((run) => run.findings !== null && run.findings.length > 0)
  console.log(
    `${short.join('')} [${done}/${cases.length}] ${shortPath(item.path)}` +
      (first?.findings?.length
        ? ` — 报了 ${first.findings.map((f) => `${f.clauseId}「${f.where}」`).join('、')}`
        : runs.every((run) => run.findings !== null)
          ? ' — 一次都没报'
          : ' — 没测成'),
  )
  await sleep(pauseMs)
}

/** 太长的那一截路径掐掉，屏幕上只留能认出来的部分 */
function shortPath(path: string): string {
  const rel = path.replace(ASSET_ROOT, '').replace(POSITIVE_DIR, '')
  return rel.length > 68 ? `…${rel.slice(-68)}` : rel
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

// ── 汇总：**三栏分开**，绝不合并成一个百分比 ────────────────────────────────
const neg = outcomes.filter((item) => !item.path.startsWith(POSITIVE_DIR))
const pos = outcomes.filter((item) => item.path.startsWith(POSITIVE_DIR))

/** ★ 反例：**任何一次**报了就算这一张误报（一道闸不许偶尔乱响） */
const negHit = (item: Outcome) => item.runs.some((run) => (run.findings?.length ?? 0) > 0)
/** ★ 正例：**每一次**都报才算抓住（N 次里报了一两次叫"不稳"，不叫"抓住"） */
const posCaught = (item: Outcome) =>
  item.runs.every((run) => run.findings !== null && run.findings.length > 0)
const posMissed = (item: Outcome) => item.runs.every((run) => run.findings?.length === 0)
const runsOf = (list: Outcome[]) => list.flatMap((item) => item.runs)
const testedRuns = (list: Outcome[]) => runsOf(list).filter((run) => run.findings !== null)

const negBad = neg.filter(negHit)
const posGood = pos.filter(posCaught)
const posNone = pos.filter(posMissed)
const tested = testedRuns(outcomes).length
const totalRuns = runsOf(outcomes).length

console.log('\n── 汇总 ──────────────────────────────────────────────')
console.log(
  `反例（真出过的图）：${neg.length} 张，其中误报 ${negBad.length}` +
    (testedRuns(neg).length === neg.length * REPEAT
      ? ''
      : `（★ 有没测成的：测成 ${testedRuns(neg).length}/${neg.length * REPEAT} 次调用）`),
)
console.log(
  `  ${testedRuns(neg).length === 0 ? '误报率 —— （一次都没测成，没有结论）' : `误报率 ${((negBad.length / neg.length) * 100).toFixed(1)}%（按张）· 误报次数 ${testedRuns(neg).filter((run) => run.findings!.length > 0).length}/${testedRuns(neg).length}（按次）`}`,
)
console.log(
  `正例：抓住 ${posGood.length}/${pos.length}（要求 ${REPEAT} 次全报），一次都没报 ${posNone.length}`,
)
console.log(
  `没测成：${totalRuns - tested} 次${totalRuns - tested > 0 ? '（**不许**并进上面两栏）' : ''}`,
)

/** ★ 噪声底：同一个输入在 N 次里结论不一致的张数——这是这一档**最该盯**的一个数 */
const flipped = outcomes.filter((item) => {
  const values = item.runs
    .filter((run) => run.findings !== null)
    .map((run) => run.findings!.length > 0)
  return values.length > 1 && new Set(values).size > 1
})
console.log(
  `★ 噪声底（翻边）：${flipped.length}/${outcomes.length} 张在同一份输入上 N 次结论不一致` +
    (REPEAT === 1 ? '（**这一轮 --repeat=1，测不出来**——要量它请加 --repeat=3）' : ''),
)

for (const item of negBad) {
  const marks = item.runs.map((run) =>
    run.findings === null ? '?' : run.findings.length > 0 ? '★' : '·',
  )
  console.log(
    `  ★ 误报：${shortPath(item.path)} [${marks.join('')}] → ` +
      `${[...new Set(item.runs.flatMap((run) => run.findings?.map((f) => f.clauseId) ?? []))].join(',')}`,
  )
}
for (const item of pos) {
  const marks = item.runs.map((run) =>
    run.findings === null ? '?' : run.findings.length > 0 ? '✓' : '✗',
  )
  console.log(
    `  ${posCaught(item) ? '✓' : posNone(item) ? '✗' : '~'} 正例` +
      `${item.path.includes('pos-real-') ? '（真插画）' : '（示意图）'} ${shortPath(item.path)} [${marks.join('')}] — ` +
      (posNone(item)
        ? '**一次都没报出来**'
        : [...new Set(item.runs.flatMap((run) => run.findings?.map((f) => f.clauseId) ?? []))].join(
            ',',
          )),
  )
}

/**
 * ★ 判词只在**三件事都成立**时才给：反例全测成、正例全测成、而且**两组都不是空的**。
 *   有任何一格没测成，末行就一句总结都不下——"没测成"不是通过（量法纪律第 4 条）。
 * ★ 空集也算没通过：只跑 `--only=pos` 时反例是 0 张，那时候打印"真图一张都没误报"
 *   是一句**它根本没有资格说**的话（同一个坏法：探针在空态上全绿）。
 * ★ `--repeat=1` 时**不给通过判词**：一轮读数分不出"它抓得住"和"它这次恰好抓住了"。
 */
if (tested !== totalRuns) {
  console.log(
    '\n★ 还有没测成的：这一轮**不下全称结论**，把 pause 调大、或者只跑 --only=neg 重来一次',
  )
  process.exit(1)
}
if (neg.length === 0 || pos.length === 0) {
  console.log(
    `\n★ 这一轮只跑了半边（反例 ${neg.length} 张、正例 ${pos.length} 张）：**两半都要跑完才给判词**`,
  )
  process.exit(2)
}
if (REPEAT === 1) {
  console.log(
    '\n★ 没过（也没资格说没过）：--repeat=1 是一轮读数，**量不了噪声底**。' +
      '要判它请加 --repeat=3；上面那几行只是这一轮的样本',
  )
  process.exit(3)
}
if (negBad.length === 0 && posGood.length === pos.length) {
  console.log(`\n✓ 过了：真图 ${neg.length} 张 × ${REPEAT} 次都没误报，正例 ${pos.length} 张全满票`)
} else {
  console.log('\n★ 没过：上面 ★/~/✗ 那几行就是结论')
  process.exit(1)
}
