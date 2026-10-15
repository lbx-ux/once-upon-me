/**
 * e2e-revise.mts —— 「再画一版」这条**路由**真跑一次，把状态码与耗时量出来
 *
 * ```bash
 * node scripts/e2e-revise.mts --keep=1                    # 跑完把探针留着，好在浏览器里看
 * node scripts/e2e-revise.mts                             # 跑完删干净
 * node scripts/e2e-revise.mts --from=xiaoyu --suggestion="眼睛再大一点"
 * ```
 *
 * 为什么要有这支脚本（工单 03 §四 那条验收）
 * ---------------------------------------------------------------------------
 * 「上传照片 → 出形象 → 提建议 → 出 v2，四步真跑一次，四次请求的状态码与耗时记进本单」
 * ——这一条最容易被糊过去的方式，就是拿引擎的 `store.create` 直接造出两个版本，
 * 然后说"提建议这条路跑通了"。**那两件事不是一回事**：`store.create` 只证明
 * 存储层能放下第二版，它一步都不经过 prompt 拼装、`normalizeReference`、
 * `edits` 调用、`referenceApplied` 那条闸门，也不经过路由的入参校验与错误映射。
 * （本单的第一版就是这么糊过去的——见 03 的 §四 勾选说明里那句"没测成，别当成测过了"。）
 *
 * ★ 它打的是**跑着的 dev server**，不是进程内直接调 provider
 * ---------------------------------------------------------------------------
 * 因为界面上真的按下去时走的就是这条 HTTP 路：`ChildDetail.revise()` 发 JSON、
 * 路由解析、路由回状态码、界面按 `response.ok` 决定说什么。进程内调用量不到
 * "路由收不收得下这个 body""错在谁映射成几"这些——而那些恰好是最容易出错的地方。
 * 姊妹脚本 `e2e-image-reference.mts` 量的是**能力本身**（这家 API 收不收参考图），
 * 所以那一支在进程内跑；这两支盯的不是一件事。
 *
 * ★ 探针孩子，绝不碰示例孩子
 * ---------------------------------------------------------------------------
 * 它借 `--from`（默认 `xiaoyu`）**现在这一版**的形象当"上一版"，
 * 把卡**复制**到 `--probe` 名下（新 cardId、新 childId，参考图是同一批字节），
 * 然后只对探针那个孩子提建议、出 v2。
 * 示例孩子因此一个字节都不变——它的版本历史在验收里是要给评委看的，
 * 不能带着一次实验留下的第 2 版。
 *
 * ★ key 不进任何输出
 * ---------------------------------------------------------------------------
 * 从 `.env.local` 读（`env.mts`），只出现在**请求体**里，一个字符都不打印。
 * 这份报告是给人看、还可能被贴进单子里的，密钥进了这里就等于进了仓库。
 *
 * ★ 只送 IMAGE_* 三件，不送另外三组
 * ---------------------------------------------------------------------------
 * 这不是图省事，是**顺手把路由文件头那条claim验掉**：它写着"直接取图像那一个，
 * 不用 `createProviders`——那会把文本/视觉/语音一起建起来，于是'没填文本模型'
 * 会让'再画一版'报一句'还差：文本模型名'"。所以这里只给 IMAGE_*：
 * 要是路由哪天被人改回 `createProviders`，这一跑就会当场红。
 */

import { performance } from 'node:perf_hooks'

import { createProfileStore } from '../src/lib/engine/character-card/profile-store.ts'
import { createCardStore } from '../src/lib/engine/character-card/store.ts'
import { createFsStore } from '../src/lib/engine/providers/stores.ts'
import { arg, readEnv } from './env.mts'

type Row = [what: string, value: string]

const BASE = arg('base', 'http://localhost:3000')
const FROM = arg('from', 'xiaoyu')
const PROBE = arg('probe', 'kid-revise-probe')
const SUGGESTION = arg('suggestion', '眼睛再大一点，头发短一些')
const KEEP = arg('keep', '') === '1'
const ROOT = arg('out', '.out/web')

function table(rows: readonly Row[]): string {
  const width = Math.max(...rows.map(([what]) => [...what].length))
  return rows
    .map(([what, value]) => `  ${what}${' '.repeat(width - [...what].length)}  ${value}`)
    .join('\n')
}

/** 只取这一组：见文件头最后一条 */
function imageEnvOnly(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ['IMAGE_BASE_URL', 'IMAGE_API_KEY', 'IMAGE_MODEL']) {
    const value = env[key]
    if (value) out[key] = value
  }
  return out
}

type Post = { status: number; ms: number; body: Record<string, unknown> }

async function post(path: string, payload: unknown): Promise<Post> {
  const started = performance.now()
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const ms = performance.now() - started
  let body: Record<string, unknown> = {}
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    body = { message: '（响应不是 JSON）' }
  }
  return { status: response.status, ms, body }
}

function mimeOf(path: string): string {
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.jpg')) return 'image/jpeg'
  return 'application/octet-stream'
}

async function main(): Promise<void> {
  const env = await readEnv()
  const imageEnv = imageEnvOnly(env)
  const rows: Row[] = []
  rows.push(['打的是', BASE])
  rows.push(['借谁的形象', FROM])
  rows.push(['探针孩子', PROBE])
  rows.push(['送了几组 env', `${Object.keys(imageEnv).length} 个键（只有 IMAGE_*）`])

  if (!imageEnv['IMAGE_API_KEY']) {
    console.log('\nIMAGE_API_KEY 未配置，一个请求都没发。\n')
    process.exitCode = 1
    return
  }

  const store = await createFsStore(ROOT)
  const cards = createCardStore(store)
  const profiles = createProfileStore(store)

  const source = await cards.latestForChild(FROM)
  if (!source) {
    console.log(`\n${FROM} 没有形象，借不到"上一版"。先在界面上给它出一张。\n`)
    process.exitCode = 1
    return
  }

  // ── 探针：把源卡复制到探针名下（参考图是同一批字节，指纹因此相同） ──────────
  const sourceBytes = await store.read(source.reference.path)
  if (!sourceBytes) {
    console.log(`\n源卡的文件不在：${source.reference.path}\n`)
    process.exitCode = 1
    return
  }
  await profiles.save({
    childId: PROBE,
    name: '探针',
    nameReading: 'tàn zhēn',
    ageBand: '4-6',
    lookTags: [],
    interestTags: [],
    createdAt: Date.now(),
  })
  const seeded = await cards.create({
    cardId: `${PROBE}-sheet`,
    childId: PROBE,
    anchors: source.anchors,
    style: source.style,
    referenceBytes: sourceBytes,
    referenceMime: mimeOf(source.reference.path),
    modelId: source.provenance.modelId,
    promptVersion: 'probe-seed@v1',
    now: Date.now(),
  })
  rows.push([
    '探针第 1 版',
    `revision ${seeded.card.revision}，参考图 ${seeded.card.reference.path.split('/').pop()}`,
  ])

  // ── 先热身：空建议那一路（400，不花钱，只为了让路由先编译好） ────────────────
  // ★ dev server 第一次打这条路由要现场编译，把编译时间记成"请求耗时"是量错了东西
  const warm = await post('/api/cards/revise', { childId: PROBE, suggestion: '', env: imageEnv })
  rows.push([
    '热身（空建议）',
    `${warm.status} · ${warm.ms.toFixed(0)} ms · ${String(warm.body['message'] ?? '')}`,
  ])

  // ── 真跑：一次 edits ────────────────────────────────────────────────────────
  const run = await post('/api/cards/revise', {
    childId: PROBE,
    name: '探针',
    ageBand: '4-6',
    suggestion: SUGGESTION,
    env: imageEnv,
  })
  rows.push([
    '★ 真跑「再画一版」',
    `${run.status} · ${run.ms.toFixed(0)} ms · revision ${String(run.body['revision'] ?? '-')}`,
  ])
  if (run.status !== 200) {
    rows.push(['路由说了什么', String(run.body['message'] ?? '')])
    rows.push(['code', String(run.body['code'] ?? '-')])
  }

  // ── 结果：v2 是不是真的长出来了，而且真的是**另一张图** ─────────────────────
  const versions = await cards.revisions(`${PROBE}-sheet`)
  rows.push(['探针的版本数', String(versions.length)])
  const v2 = versions.find((card) => card.revision === 2)
  if (v2) {
    rows.push(['v2 的参考图', v2.reference.path.split('/').pop() ?? '-'])
    rows.push([
      'v2 与 v1 的图是不是同一批字节',
      // ★ 这一条才是"真的调了 edits"的判据：路由把上一版**归一化之后**送出去，
      //   回来的是模型新画的一张。指纹要是相同，那说明第二版只是第 1 版的副本
      v2.reference.digest === seeded.card.reference.digest
        ? '**相同 → 这一版是副本，edits 没真的发生**'
        : '不同 ✓',
    ])
    rows.push(['v2 的 suggestion', v2.provenance.suggestion ?? '（没有，不对）'])
    rows.push([
      '锚点有没有被那句话动过',
      JSON.stringify(v2.anchors) === JSON.stringify(seeded.card.anchors)
        ? '一个字没改 ✓'
        : '**被改了 → 违反 card.ts 文件头那条不变式**',
    ])
  } else {
    rows.push(['v2', '**没有**——见上面那一行的状态码'])
  }

  console.log(`\n再画一版 · 真跑一次\n\n${table(rows)}\n`)
  console.log(
    KEEP
      ? `探针留着（--keep=1）：打开 ${BASE}/character/${PROBE} 看两版并排，看完记得删。\n`
      : '探针已经删掉。\n',
  )

  if (!KEEP) {
    const deleted = await cards.deleteChild(PROBE)
    const files = await profiles.delete(PROBE)
    console.log(
      `清理：卡片文件 ${deleted.cards} 个、参考图 ${deleted.bytes} 字节、档案 ${files} 个\n`,
    )
  }
}

await main()
