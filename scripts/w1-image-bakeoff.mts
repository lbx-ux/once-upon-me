/**
 * w1-image-bakeoff.mts —— 图像候选横评（tech-selection §12.2 产出物 1）
 *
 * 跑法（先填 .env.local，再）：
 *
 * ```bash
 * node scripts/w1-image-bakeoff.mts --models=wan2.7-image,qwen-image-2.0 --out=.out/bakeoff-image
 * ```
 *
 * ★ 三条纪律，都是这一层的事：
 *
 * 1. **同一套提示词**。角色段由 `promptFragmentOf(card)` 派生、页级段来自
 *    `scripts/fixtures/demo-plan.json`，两个候选拿到的是**逐字节相同**的 prompt
 *    （ADR-0002 立适配层的第二个理由就是为了这一刻）。
 * 2. **一次 200 = 一张图的钱**。实测一口价 0.20 元/张且与尺寸无关
 *    （`E:\compete\模型.md` §4）。所以脚本先打印总花费预算再问你要不要跑，
 *    并且**绝不做参数探测**——参数错了就 400，400 不扣钱，但猜参数要扣。
 * 3. **判据 1 要人看图**。5 页里几张像同一个孩子，是 ≥3 个人眼判出来的，
 *    不是模型打分打出来的。所以脚本除了 JSON 还产出一个**盲评包**：
 *    每候选一个目录、文件名去掉候选名，避免"看见 wan 就先入为主"。
 *    模型给的相似度分只作为对照记录在案（GLOSSARY：它是判据不是事实）。
 *
 * 未跑通之前，本脚本产出的报告里所有格子都是空的 —— 那是诚实的状态，
 * 不要手工填数。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  buildCard,
  attachReferenceDigest,
  promptFragmentOf,
} from '../src/lib/engine/character-card/card.ts'
import { pagePrompt, DEFAULT_IMAGE_SIZE } from '../src/lib/prompts/image.ts'
import { createTokenrhythmImage } from '../src/lib/engine/providers/tokenrhythm-image.ts'
import { createOpenAiVision } from '../src/lib/engine/providers/openai-vision.ts'
import { createFsStore } from '../src/lib/engine/providers/stores.ts'
import { digest } from '../src/lib/engine/digest.ts'
import { checklistOf } from '../src/lib/engine/character-card/card.ts'
import { toDataUrl } from '../src/lib/engine/providers/http.ts'
import type { CharacterAnchor } from '../src/lib/engine/domain.ts'

const UNIT_COST_CNY = 0.2
const PAGES = 5

const ANCHORS: CharacterAnchor[] = [
  { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
  { slot: 'eyes', value: '深棕圆眼、眼距略宽' },
  { slot: 'hair', value: '黑发偏软，左上方永远翘着一撮' },
  { slot: 'build', value: '头身比约 1:4，四肢圆润' },
  { slot: 'skin', value: '暖黄偏深的肤色，晒黑的膝盖' },
  { slot: 'wardrobe', value: '芥黄短袖 + 深蓝短裤 + 一双红雨鞋' },
]

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

async function loadEnv(): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = { ...process.env }
  try {
    for (const line of (await readFile('.env.local', 'utf8')).split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (match) env[match[1] as string] = (match[2] as string).replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 没有 .env.local 就用进程环境；再没有就在下面报错 */
  }
  return env
}

type PageRecord = {
  pageNo: number
  promptDigest: string
  ok: boolean
  assetPath?: string
  costCny?: number
  seconds?: number
  error?: string
  traceId?: string
  machineScore?: number | null
  missed?: readonly string[]
}

type CandidateRecord = {
  model: string
  referenceApplied: boolean
  pages: PageRecord[]
  spentCny: number
  note?: string
}

async function main(): Promise<void> {
  const env = await loadEnv()
  const models = arg('models', env['IMAGE_MODEL'] ?? 'wan2.7-image')
    .split(',')
    .map((m) => m.trim())
  const out = resolve(arg('out', '.out/bakeoff-image'))
  const apiKey = env['IMAGE_API_KEY'] ?? ''
  const baseUrl = env['IMAGE_BASE_URL'] ?? 'https://tokenrhythm.studio/v1'
  if (!apiKey) throw new Error('IMAGE_API_KEY 未配置。横评必须真跑，不接受手工填数')

  const plan = JSON.parse(await readFile('scripts/fixtures/demo-plan.json', 'utf8')) as {
    nodes: { scene: string; imagePrompt: string; mood: string }[]
  }
  const pages = plan.nodes.slice(0, PAGES)
  const referenceBytes = new Uint8Array(await readFile('public/book/cover.webp'))
  const referenceDataUrl = toDataUrl(referenceBytes, 'image/webp')

  const card = attachReferenceDigest(
    buildCard({
      cardId: 'bakeoff',
      childId: 'bakeoff',
      anchors: ANCHORS,
      style: {
        key: 'warm-handdrawn',
        promptFragment: '温暖手绘水彩绘本插画，柔和侧向暖光，纸张纹理可见',
        ratio: '3:2',
      },
      referencePath: 'ref.webp',
      referenceBytes: referenceBytes.byteLength,
      modelId: models[0] ?? 'unknown',
      promptVersion: 'image-page@v1',
      now: 0,
    }),
    digest(referenceBytes),
  )

  const budget = models.length * pages.length * UNIT_COST_CNY
  process.stdout.write(
    `横评：${models.length} 个候选 × ${pages.length} 页 = ${models.length * pages.length} 张\n` +
      `按实测一口价 ${(UNIT_COST_CNY * 100).toFixed(0)} 分/张，预算上限 ${budget.toFixed(2)} 元\n` +
      `角色段（所有候选共用，逐字节相同）：\n  ${promptFragmentOf(card)}\n\n`,
  )
  if (arg('yes', '') !== '1') {
    process.stdout.write('这是会真扣钱的操作。确认请加 --yes=1\n')
    return
  }

  await mkdir(out, { recursive: true })
  const store = await createFsStore(out)
  const vision =
    env['VISION_MODEL'] && (env['VISION_API_KEY'] ?? apiKey)
      ? createOpenAiVision(
          { baseUrl: env['VISION_BASE_URL'] ?? baseUrl, apiKey: env['VISION_API_KEY'] ?? apiKey },
          env['VISION_MODEL'],
        )
      : null

  const results: CandidateRecord[] = []
  for (const model of models) {
    const image = createTokenrhythmImage({ baseUrl, apiKey, timeoutMs: 180_000 }, model, {
      supportsReference: env['IMAGE_SUPPORTS_REFERENCE'] === '1',
      referenceField: env['IMAGE_REF_FIELD'] || undefined,
    })
    const record: CandidateRecord = {
      model,
      referenceApplied: image.supportsReference,
      pages: [],
      spentCny: 0,
    }
    process.stdout.write(`── ${model} ──\n`)

    for (const [index, page] of pages.entries()) {
      const prompt = pagePrompt({
        card,
        page: page.imagePrompt,
        scene: page.scene,
        mood: page.mood,
      })
      const started = Date.now()
      try {
        const response = await image.generate({
          prompt,
          size: DEFAULT_IMAGE_SIZE,
          referenceDataUrl: image.supportsReference ? referenceDataUrl : undefined,
          modelTag: model,
        })
        const path = `blind/${model.replace(/[^\w.-]/g, '_')}/page-${index + 1}.webp`
        const asset = await store.put({ path, bytes: response.bytes, mime: response.mime })
        record.spentCny += response.costCny ?? UNIT_COST_CNY
        const entry: PageRecord = {
          pageNo: index + 1,
          promptDigest: digest(prompt),
          ok: true,
          assetPath: asset.path,
          costCny: response.costCny,
          seconds: Math.round((Date.now() - started) / 100) / 10,
        }
        if (vision) {
          const compared = await vision.compare({
            referenceDataUrl,
            pageDataUrl: toDataUrl(response.bytes, response.mime),
            checklist: checklistOf(card),
          })
          entry.machineScore = compared.score
          entry.missed = compared.missed
        }
        record.pages.push(entry)
        process.stdout.write(
          `  第 ${index + 1} 页 ${(entry.seconds ?? 0).toFixed(1)}s` +
            `${entry.machineScore !== undefined && entry.machineScore !== null ? ` 机器分 ${entry.machineScore.toFixed(2)}` : ''}\n`,
        )
      } catch (err) {
        record.pages.push({
          pageNo: index + 1,
          promptDigest: digest(prompt),
          ok: false,
          seconds: Math.round((Date.now() - started) / 100) / 10,
          error: err instanceof Error ? err.message : String(err),
          traceId:
            err instanceof Error && 'traceId' in err
              ? String((err as { traceId: string }).traceId)
              : undefined,
        })
        process.stdout.write(
          `  第 ${index + 1} 页 失败（未扣费）：${err instanceof Error ? err.message : String(err)}\n`,
        )
      }
    }
    results.push(record)
  }

  await writeFile(
    join(out, 'image-bakeoff.json'),
    JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2),
    'utf8',
  )
  await writeFile(join(out, 'image-bakeoff.md'), renderReport(results, vision !== null), 'utf8')
  process.stdout.write(
    `\n报告：${join(out, 'image-bakeoff.md')}\n盲评包：${join(out, 'blind')}（文件名不含候选名，发给 ≥3 人独立判读）\n`,
  )
}

/** 判据 1 那一列**留空**给人填。机器分另起一列，两者不许互相顶替 */
function renderReport(results: readonly CandidateRecord[], withMachineScore: boolean): string {
  const header = [
    '| 候选 | 成功页 | 单张实付 | 合计花费 | 支持比例 | 参考图是否生效 | 判据 1：≥3 人判"同一个孩子"（人填） |' +
      (withMachineScore ? ' 机器相似度（对照，不作判据） |' : ''),
    '|' + '---|'.repeat(withMachineScore ? 8 : 7),
  ]
  const rows = results.map((record) => {
    const okPages = record.pages.filter((page) => page.ok)
    const unit = okPages.length > 0 ? (record.spentCny / okPages.length).toFixed(2) : '—'
    const scores = record.pages
      .map((page) => page.machineScore)
      .filter((score) => typeof score === 'number')
    const mean =
      scores.length > 0
        ? (scores.reduce((a, b) => a + (b ?? 0), 0) / scores.length).toFixed(2)
        : '—'
    return (
      `| ${record.model} | ${okPages.length}/${record.pages.length} | ${unit} 元 | ${record.spentCny.toFixed(2)} 元 | 见 §7.2 待填 | ` +
      `${record.referenceApplied ? '已开（待确认是否真生效）' : '未开'} | _待人工判读_ |` +
      (withMachineScore ? ` ${mean} |` : '')
    )
  })
  const failures = results.flatMap((record) =>
    record.pages
      .filter((page) => !page.ok)
      .map(
        (page) =>
          `- ${record.model} 第 ${page.pageNo} 页：${page.error}${page.traceId ? `（traceId=${page.traceId}）` : ''}`,
      ),
  )
  return [
    '# 图像横评表（tech-selection §12.2 产出物 1）',
    '',
    '> 判据 1 是**一票否决**，且它的量法写明是"≥3 人独立判是不是同一个孩子 + 相似度分"。',
    '> 机器分只作对照：GLOSSARY「一致性分」——它是判据不是事实，阈值靠人工判读校准。',
    '',
    ...header,
    ...rows,
    '',
    failures.length > 0
      ? ['## 失败明细（4xx 不扣费，逐条留 traceId 便于找平台）', '', ...failures].join('\n')
      : '',
    '',
    '## 还缺的判据（要查官方文档 / 控制台，不是跑脚本能得到的）',
    '',
    '- 判据 3 比例覆盖：能不能直出 3:2 与 3:4（当前实测白名单只有 1:1 与 16:9，见 tokenrhythm-image.ts）',
    '- 判据 5 儿童内容审核政策：拿"孩子当主角 + 冒险情节"试投',
    '- 判据 6 并发与配额：20 页能否并发拉',
    '- 判据 7 可达性：国内直连是否需要代理',
  ].join('\n')
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
