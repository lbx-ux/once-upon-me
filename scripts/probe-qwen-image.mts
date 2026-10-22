/**
 * probe-qwen-image.mts —— 把 qwen-image-3.0 的尺寸白名单**量出来**（2026-10-21）
 *
 * ```bash
 * node scripts/probe-qwen-image.mts                       # 四个尺寸 × 纯文字 + 一次带参考图
 * node scripts/probe-qwen-image.mts --sizes=1536x1024     # 只补量一个
 * node scripts/probe-qwen-image.mts --skipI2I=1           # 只量文生图那一半
 * ```
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────
 *
 * `qwen-image.ts` 的 `SIZES_BY_MODEL` 是**空的**，而那个表在发请求之前会把不在表里的尺寸
 * 挡回去（一次 200 就是一张图的钱，不许拿正式跑测当探测）。于是有一个死结：
 * 表要靠量出来，而量它需要先发得出去请求。解开它的办法就是这一支——它**绕开适配器**
 * 直接打接口（与上一家那次 `probe-image-reference.mts` 同一个手法）。
 *
 * ── 判据：读 PNG 的 IHDR，核宽高与请求**分毫不差** ─────────────────────────
 *
 * 只看 HTTP 200 不算过。上一家那次就是这条纪律救的：文档说收的尺寸，模型级白名单未必收
 * （`wan2.7-image` 拒过 `512x512`）；反过来，"回 200 了"也可能是它按自己的意思换了尺寸
 * （`/images/edits` 那条路请求 1440² 回的是 1024²）。所以判据是**读数与请求逐位相等**。
 *
 * ── I2I 那一次为什么单列 ────────────────────────────────────────────────────
 *
 * 产品这一版**逐页与封面都带参考图**（`referenceForPages` 缺省开），而这三个问题只有
 * 真发一次带 `image` 字段的请求才答得上：
 *
 * | 问 | 为什么要问 |
 * | --- | --- |
 * | `size` 在带参考图那条路上还生效吗 | 上一家那条路**没有** `size` 字段（产物由模型定）。这一条不成立，页图就不是 3:2 |
 * | 参考图到底进没进请求 | 看 `usage.input_image_count`；它是 `referenceApplied` 的**唯一**凭据 |
 * | 慢多少 | 带图那条路要处理一张 1440 级的 data URL，耗时是要进 `IMAGE_TIMEOUT_MS` 的 |
 *
 * ★ 这一支**要花钱**：每个尺寸一张图（四个尺寸 + 一次带参考图 = 5 张）。
 *   产物字节落盘留着看图（`--keep` 不给也会落盘，这一支的价值一半在图本身）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import sharp from 'sharp'

import { fetchBytes, findFirst, requestJson } from '../src/lib/engine/providers/http.ts'
import { createCardStore } from '../src/lib/engine/character-card/store.ts'
import { createFsStore } from '../src/lib/engine/providers/stores.ts'
import { normalizeReference, referenceDataUrlOf } from '../src/lib/engine/image/normalize.ts'
import { DEFAULT_IMAGE_SIZE, pagePrompt } from '../src/lib/prompts/image.ts'
import { arg, readEnv } from './env.mts'

/** 产品要用的尺寸。1024x1024 是 `make-default-avatar.mts` 要的，所以一并量掉 */
const SIZES = ['1536x1024', '1152x1536', '1440x1440', '1024x1024']

/** 原生同步那条路（不是 `/images/generations`：那个地址在共享域名上是 404，实测过） */
const NATIVE_PATH = '/services/aigc/multimodal-generation/generation'

type Row = [label: string, value: string]

function table(rows: readonly Row[]): string {
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, value]) => `${label.padEnd(width)} : ${value}`).join('\n')
}

/** PNG 的真实宽高（读 IHDR，不是看请求里写了什么） */
async function dimsOf(bytes: Uint8Array): Promise<string> {
  const meta = await sharp(Buffer.from(bytes)).metadata()
  return `${meta.width}×${meta.height} · ${meta.format} · ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB`
}

type Attempt = {
  label: string
  requested: string
  status: string
  produced: string
  exact: boolean
  seconds: number
  inputImages: string
  requestId: string
  rewrite: string
  artifact: string | null
}

async function main(): Promise<void> {
  const env = await readEnv()
  const apiKey = env['IMAGE_API_KEY'] ?? ''
  if (!apiKey) throw new Error('IMAGE_API_KEY 未配置（这一支要真发请求）')
  const baseUrl = env['IMAGE_BASE_URL'] ?? ''
  if (!baseUrl) throw new Error('IMAGE_BASE_URL 未配置')
  const model = arg('model', env['IMAGE_MODEL'] ?? '')
  if (!model) throw new Error('IMAGE_MODEL 未配置（或 --model=<名字>）')
  const sizes = arg('sizes', SIZES.join(','))
    .split(',')
    .map((one) => one.trim())
  const skipT2I = arg('skipT2I', '') === '1'
  const out = resolve(arg('out', '.out/qwen-image-probe'))
  await mkdir(out, { recursive: true })

  const prompt =
    arg('prompt', '') ||
    '温暖手绘水彩绘本插画：一个小女孩蹲在草地上看一只瓢虫，背景是春天的花园，' +
      '主体偏右，左下方留出可以叠字的浅色区域'

  const attempts: Attempt[] = []

  /** 发一次真请求，产物落盘，核尺寸。`image` 给了就是图生图 */
  async function one(label: string, size: string, image?: string): Promise<void> {
    const started = Date.now()
    const body = await requestJson(
      { baseUrl, apiKey, timeoutMs: 600_000 },
      {
        method: 'POST',
        // ★ 原生同步那条路（不是 /images/generations：那个地址在共享域名上是 404，实测过）
        path: NATIVE_PATH,
        // ★ 一个字段都不多送：只有产品真会送的那几个（厂商默认的改写我们也在产品里显式关掉）
        body: {
          model,
          input: {
            messages: [
              {
                role: 'user',
                content: [...(image ? [{ image }] : []), { text: prompt }],
              },
            ],
          },
          parameters: {
            // 原生协议是 `宽*高`（星号），与全仓库统一的 `宽x高` 不同——转换在这儿做一次
            size: size.replace('x', '*'),
            n: 1,
            prompt_extend: false,
          },
        },
        timeoutMs: 600_000,
      },
    )
    const seconds = (Date.now() - started) / 1000
    const output = (body as { output?: unknown }).output ?? body
    const url = findFirst(output, ['image', 'url', 'image_url'])
    const requestId = String(findFirst(body, ['request_id']) ?? '（没回）')
    const rewrite = String(findFirst(body, ['rewrite_status']) ?? '（没回）')
    if (typeof url !== 'string') {
      attempts.push({
        label,
        requested: size,
        status: '**没有地址**',
        produced: JSON.stringify(body).slice(0, 200),
        exact: false,
        seconds,
        inputImages: '—',
        requestId,
        rewrite,
        artifact: null,
      })
      return
    }
    const { bytes, mime } = await fetchBytes(url, { timeoutMs: 180_000 })
    const artifact = join(out, `${label}-${size}.png`)
    await writeFile(artifact, bytes)
    const produced = await dimsOf(bytes)
    const [wantW, wantH] = size.split('x')
    const got = await sharp(Buffer.from(bytes)).metadata()
    const count = findFirst(body, ['input_image_count'])
    attempts.push({
      label,
      requested: size,
      status: `200 · ${mime}`,
      produced,
      // 判据是**逐位相等**，不是"200 了"也不是"差不多"
      exact: got.width === Number(wantW) && got.height === Number(wantH),
      seconds,
      inputImages: count === null ? '（响应里没有 usage）' : String(count),
      requestId,
      rewrite,
      artifact,
    })
    process.stdout.write(
      `  ${label.padEnd(22)} ${produced}  ${seconds.toFixed(1)}s  rewrite=${rewrite}\n`,
    )
  }

  process.stdout.write(
    `探针：${model} @ ${baseUrl}\n` +
      `路径：POST ${NATIVE_PATH}（原生同步那条；兼容模式那个地址在共享域名上是 404，实测过）\n` +
      `判据：产物宽高与请求**逐位相等**才算过（回 200 不算）\n\n`,
  )
  if (!skipT2I) {
    process.stdout.write('文生图\n')
    for (const size of sizes) {
      await one('t2i', size)
    }
  }

  /** 图生图那一次要一张**真卡的参考图**，且要过归一化（产品路径就是这么送的） */
  let i2iNote: string = '**没量到**'
  if (arg('skipI2I', '') !== '1') {
    const cardDir = resolve(arg('cardDir', '.out/cards'))
    const cardId = arg('card', 'xiaoyu-r1')
    const card = await createCardStore(await createFsStore(cardDir)).latest(cardId)
    process.stdout.write('\n图生图（带参考图）\n')
    if (!card) {
      i2iNote =
        `**没量到**：找不到角色卡 ${cardId}（在 ${cardDir}）。` +
        `★ --cardDir 要给**资产根目录**（卡在 <根>/cards/<cardId>/ 下面，例如 .out/engine-run），` +
        `不是 cards 那一层；也可以先跑 node scripts/make-demo-cards.mts`
      process.stdout.write(`  ${i2iNote}\n`)
    } else {
      const raw = await (await createFsStore(cardDir)).read(card.reference.path)
      if (!raw) throw new Error(`角色卡参考图读不到：${card.reference.path}`)
      const normalized = await normalizeReference(raw)
      process.stdout.write(
        `  参考图：${card.reference.path} → 归一后 ${normalized.width}×${normalized.height}` +
          `（${normalized.notes.join('；')}）\n`,
      )
      const plan = JSON.parse(await readFile('scripts/fixtures/demo-plan.json', 'utf8')) as {
        nodes: { scene: string; imagePrompt: string; mood: string }[]
      }
      const first = plan.nodes[0]
      if (!first) throw new Error('demo-plan.json 里没有节点')
      // 提示词走生产那一条，不自编：自编的话"画成什么样"这件事归因不到通路
      await one('i2i', DEFAULT_IMAGE_SIZE, referenceDataUrlOf(normalized))
      // 上面那次用的是通用 prompt，这里再补一次带生产提示词的读数？
      // ★ 不补：一次请求就是一张图的钱，而"size 守不守 / 参考图进没进"这两问
      //   与提示词写的是什么无关。要看生产提示词的产物，跑 e2e-image-reference.mts
      const last = attempts[attempts.length - 1]
      i2iNote =
        last && last.exact
          ? `**size 在带参考图那条路上被遵守了**（${last.produced}）· input_image_count=${last.inputImages}`
          : `**没守住或没量到**：${last ? last.produced : '(无)'}`
      process.stdout.write(`  ${i2iNote}\n  （生产提示词那一次留给 e2e-image-reference.mts）\n`)
      // 生产提示词那一段在这里只做**长度核对**，不发请求：产品 prompt 与探针 prompt 的差别
      //   不在尺寸上，而多发一次就是多花一张的钱
      process.stdout.write(
        `  生产页图提示词长度参照：${
          pagePrompt({
            card,
            page: first.imagePrompt,
            scene: first.scene,
            mood: first.mood,
          }).length
        } 字\n`,
      )
    }
  }

  const passed = attempts.filter((one) => one.exact)
  const markdown = [
    '# qwen-image-3.0 · 尺寸与参考图实测',
    '',
    `跑于 ${new Date().toISOString()}（\`scripts/probe-qwen-image.mts\`）`,
    '',
    '> 判据是**产物宽高与请求逐位相等**，不是"回 200 了"。回 200 而换了尺寸的那种，',
    '> 上一家在 `/images/edits` 上真发生过（请求 1440²、回来 1024²）。',
    '',
    '```',
    table(
      attempts.map((one) => [
        `${one.label} ${one.requested}`,
        `${one.status} · 产物 ${one.produced} · ${one.exact ? '逐位相等 ✓' : '**不等 ✗**'}`,
      ]),
    ),
    '```',
    '',
    '## 耗时与回执',
    '',
    '```',
    table(
      attempts.flatMap((one) => [
        [`${one.label} ${one.requested} 耗时`, `${one.seconds.toFixed(1)}s`],
        [`${one.label} ${one.requested} request_id`, one.requestId],
        // `not_use` = 我们显式关掉的提示词改写确实没被用上（这是那一条决策的唯一凭据）
        [`${one.label} ${one.requested} rewrite_status`, one.rewrite],
      ]),
    ),
    '```',
    '',
    '## 图生图那一问',
    '',
    i2iNote,
    '',
    '## 产物',
    '',
    ...attempts.map((one) => `- ${one.label} ${one.requested}：${one.artifact ?? '（没有）'}`),
    '',
    '## 回填白名单（跑完之后把上表里 ✓ 的那几个写进 qwen-image.ts）',
    '',
    '```ts',
    `'${model}': [`,
    ...passed.map((one) => `  '${one.requested}',`),
    '],',
    '```',
    '',
    '> 顺带把这一行也核一遍：`usage.output_image_type` 是 `qima_output_1k` 还是 `2k`',
    '> （它决定记账档位；产品用的尺寸都该落在 1k 档）。这次没打印它，因为适配器只读',
    '> `input_image_count`——要看看的话在 `fetchBytes` 之前打一行 `console.log(body)`。',
    '',
  ].join('\n')
  await writeFile(join(out, 'report.md'), markdown, 'utf8')

  process.stdout.write(
    `\n通过 ${passed.length}/${attempts.length} 个尺寸\n报告：${join(out, 'report.md')}\n`,
  )
  if (passed.length !== attempts.length) {
    process.stdout.write('★ 有没过的：**别把没过的也写进白名单**，那一格会变成一个当场 400\n')
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n探针失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
