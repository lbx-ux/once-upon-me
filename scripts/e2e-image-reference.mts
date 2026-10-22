/**
 * e2e-image-reference.mts —— 工单 02 §三 那条"端到端"验收的可复现脚本
 *
 * 跑法（仓库根）：
 *
 * ```bash
 * # 半程：只跑归一化 + 失败路径，一个网络请求都不发、一分钱不花
 * node scripts/e2e-image-reference.mts --dry=1
 * # 全程：再走一次真实的"带参考图出图"那条路（会出一张图、会花钱）
 * node scripts/e2e-image-reference.mts
 * # 真照片那一条（验收里写着"需要用户提供的照片"）：不给就照实记「没量到」
 * node scripts/e2e-image-reference.mts --photo=/path/to/照片.jpg
 * ```
 *
 * ★ 为什么要有这个脚本，而不是"当时手敲 curl 通了就算"：
 *   验收原文是"**端到端：插画参考 → 200，产物落盘并看图核对（与 §一 那次一致）**"。
 *   "与 §一 那次一致"这几个字要求它**可重跑**：§一 那次是手搓 fetch，
 *   谁也没法在两周后说清当时送的是什么形状的图。这里走的是**引擎自己的适配器**
 *   （`createTokenrhythmImage().edit`），所以它同时证明了另一件更要紧的事——
 *   `edit()` 不是纸上的一个方法名，它真的能出图。
 *
 * ✅ 2026-10-21 更新（换到 qwen-image-3.0）：这条脚本原来硬编码 `createTokenrhythmImage`，
 *   于是它证明的是"那一家那一次能出图"，而不是"**配置里那一家**能出图"。
 *   现在它走 registry 的 `imageProviderOf(env)`——与生产同一个构造点，
 *   换模型不需要再动这个文件（同一条理由见 `textOptionsOf` 的注释）。
 *   随之翻掉的一行：`size` 在这家**是会进请求体的**，所以下面核的那个尺寸是量出来的、
 *   也是我们真要的那个（页图 3:2）。
 *
 * ★ 三件**不许糊弄**的事，各自对应一次教训：
 *
 * 1. **归一化必须在路径上**，不能被绕过。所以这里不是"读一张已经压平好的图直接送"，
 *    而是把角色卡的 PNG **原样喂给 `normalizeReference`**，再拿它的产物去送。
 *    绕过的写法更容易过，但那证明的不是这条通路。
 * 2. **失败路径要自己走一遍**。一张 200×200 的图必须在这里被拒，而且拒它的是
 *    `reference-invalid` 这条码——界面按码分流，`userFailureOf` 出来的那句话
 *    得是"这张照片不能用作参考图"，不能是"生成失败"。
 *    这条测试的是**文案分流**，不是文案本身，所以两种码都打印出来对照。
 * 3. **真照片那条量不到就写没量到**。`--photo` 没给的时候，输出里那一行是
 *    「没量到」，**不是**拿插画那次的结果顶上（工单 02 §三 明写）。
 *
 * 产物：`<out>/report.md`（可直接贴进工单）、`<out>/page.png`、
 * `<out>/normalized-reference.png`（归一后那张，出问题时要看的是它）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import sharp from 'sharp'

import { normalizeReference, referenceDataUrlOf } from '../src/lib/engine/image/normalize.ts'
import { EngineError } from '../src/lib/engine/errors.ts'
import { checklistOf } from '../src/lib/engine/character-card/card.ts'
import { DEFAULT_IMAGE_SIZE, pagePrompt } from '../src/lib/prompts/image.ts'
import { createCardStore } from '../src/lib/engine/character-card/store.ts'
import { imageProviderOf } from '../src/lib/engine/providers/registry.ts'
import { createFsStore } from '../src/lib/engine/providers/stores.ts'
import { userFailureOf } from '../src/lib/provider-messages.ts'
import { arg, readEnv } from './env.mts'

/** 形状：报告里要按行打印的东西 */
type Row = [label: string, value: string]

function table(rows: readonly Row[]): string {
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, value]) => `${label.padEnd(width)} : ${value}`).join('\n')
}

/** 一张图在被送出去之前的形状。出问题时要看的就是这几个数 */
async function shapeOf(bytes: Uint8Array): Promise<string> {
  const meta = await sharp(Buffer.from(bytes)).metadata()
  return (
    `${meta.width}×${meta.height} · ${meta.format} · ` +
    `${meta.channels} 通道 · alpha=${String(meta.hasAlpha ?? false)} · ` +
    `${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB`
  )
}

/**
 * 2.3 那条"失败要分得开"的验收：同样一条 `reference-invalid`，
 * 走 `userFailureOf` 之后必须给"照片"那句，而不是"生成失败"。
 * ★ 对照着打印 `card-invalid`，因为这两条**以前是同一个码**——
 *   只看"照片那句出现了"证明不了分流，得看到两句**不一样**才算。
 */
async function failurePath(root: string): Promise<{ rows: Row[]; markdown: string }> {
  const small = await sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 120, g: 120, b: 120 } },
  })
    .png()
    .toBuffer()

  const rows: Row[] = [['送的什么', '200×200 的 PNG（短边低于服务端要求的下限 240）']]

  let thrown: unknown = null
  try {
    await normalizeReference(new Uint8Array(small))
  } catch (err) {
    thrown = err
  }
  if (thrown === null) {
    // 这条路径**必须**失败。没失败就是归一化的下限判断坏了，脚本要吵
    throw new Error('200×200 的图居然通过了归一化——下限判断坏了，这条验收没有意义')
  }

  const failure = userFailureOf(thrown)
  rows.push(['引擎抛的码', failure.code])
  rows.push(['界面回的状态码', String(failure.status)])
  rows.push(['能不能重试', failure.retryable ? '能' : '不能（重试一百次也一样）'])
  rows.push(['界面上第一句', failure.message.split('\n')[0] as string])
  rows.push(['界面上的原文', (failure.message.split('\n')[1] ?? '').replace(/^（|）$/g, '')])

  // 对照：同一个函数、另一条码。两句不一样才说明"按码分流"是活的
  const cardLike = userFailureOf(new EngineError('card-invalid', '锚点不合格'))
  rows.push(['对照 card-invalid 的第一句', cardLike.message.split('\n')[0] as string])
  const differs = cardLike.message.split('\n')[0] !== failure.message.split('\n')[0]
  rows.push(['两句是否不同（分流是否活着）', differs ? '不同 ✓' : '**一样——分流坏了**'])
  if (!differs) throw new Error('reference-invalid 与 card-invalid 给了同一句话，按码分流没生效')

  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'rejected-200x200.png'), small)

  return {
    rows,
    markdown: [
      '## 失败路径（验收：界面上出现的是「照片太小」而不是「生成失败」）',
      '',
      '```',
      table(rows),
      '```',
      '',
    ].join('\n'),
  }
}

async function main(): Promise<void> {
  const env = await readEnv()
  const out = resolve(arg('out', '.out/e2e-image-reference'))
  await mkdir(out, { recursive: true })

  /* ── 1. 失败路径：不发请求，先跑 ─────────────────────────────── */
  const failed = await failurePath(out)
  process.stdout.write(`\n${failed.rows.map(([a, b]) => `${a}: ${b}`).join('\n')}\n\n`)

  /* ── 2. 归一化：角色卡那张插画原样进去 ─────────────────────── */
  const cardDir = resolve(arg('cardDir', '.out/cards'))
  const cardId = arg('card', 'xiaoyu-r1')
  const cardStore = createCardStore(await createFsStore(cardDir))
  const card = await cardStore.latest(cardId)
  if (!card) {
    throw new Error(
      `找不到角色卡 ${cardId}（在 ${cardDir}）。先跑 node scripts/make-demo-cards.mts`,
    )
  }
  const raw = await (await createFsStore(cardDir)).read(card.reference.path)
  if (!raw) throw new Error(`角色卡参考图读不到：${card.reference.path}`)

  const before = await shapeOf(raw)
  const normalized = await normalizeReference(raw, {
    maxSide: Number(arg('maxSide', '1440')),
  })
  const after = await shapeOf(normalized.bytes)
  await writeFile(join(out, 'normalized-reference.png'), normalized.bytes)

  process.stdout.write(
    `归一化（卡片①${cardId} r${card.revision}，${card.reference.path}）\n` +
      `  进去 ${before}\n  出来 ${after}\n` +
      `  notes：${normalized.notes.join('；')}\n\n`,
  )

  /* ── 3. 真照片那一条：没给就照实记「没量到」 ───────────────── */
  const photoPath = arg('photo', '')
  let photoRows: Row[]
  if (photoPath === '') {
    photoRows = [
      ['状态', '**没量到**——没有提供真实照片（--photo=<路径>）'],
      ['不许做的事', '拿上一节的插画结果代表照片那一次（验收里明写禁止）'],
    ]
  } else {
    const photo = new Uint8Array(await readFile(resolve(photoPath)))
    const photoBefore = await shapeOf(photo)
    const photoOut = await normalizeReference(photo)
    photoRows = [
      ['文件', basename(photoPath)],
      ['进去', photoBefore],
      ['出来', await shapeOf(photoOut.bytes)],
      ['notes', photoOut.notes.join('；')],
      [
        '**但**',
        '这一步只证明「照片能过归一化」，不证明「照片当参考图画得像」——后者是本单 §三 未决 1',
      ],
    ]
    await writeFile(join(out, 'normalized-photo.png'), photoOut.bytes)
  }
  process.stdout.write(`真实照片\n${table(photoRows)}\n\n`)

  /* ── 4. 端到端：走引擎自己的适配器（与生产同一个构造点） ───── */
  const model = env['IMAGE_MODEL'] ?? ''

  // ★ 提示词**默认走生产那一条**（`pagePrompt`），不自编一段。
  //   自编的代价实测过一次：第一版这里写的是"黄昏的河面，暖色调……"，
  //   画出来上衣是红的而锚点写的是"芥黄短袖"——于是"上衣配色漂了"这个观察
  //   没法归因给通路，因为提示词里的"暖色调"本身就是红的推手。
  //   用生产提示词，画成什么样就是这条路真实产出的样子。
  const page = arg('prompt', '')
  let prompt: string
  if (page !== '') {
    prompt = page
  } else {
    const plan = JSON.parse(await readFile('scripts/fixtures/demo-plan.json', 'utf8')) as {
      nodes: { pageNo: number; scene: string; imagePrompt: string; mood: string }[]
    }
    const first = plan.nodes[0]
    if (!first) throw new Error('scripts/fixtures/demo-plan.json 里没有节点')
    prompt = pagePrompt({ card, page: first.imagePrompt, scene: first.scene, mood: first.mood })
  }

  let e2eRows: Row[]
  // 报告里要指向的产物。跑没跑是事实，所以这里为空时报告就说"这一次没有产物"，
  // 不指一个不存在的路径（--dry=1 时 page.png 根本不会被写出来）
  let pageArtifact: string | null = null
  if (arg('dry', '') === '1') {
    e2eRows = [['状态', '**跳过了**（--dry=1）：上面那两节一个请求都没发，也没花钱']]
    process.stdout.write(`端到端\n${table(e2eRows)}\n\n`)
  } else {
    // 构造点只有一个：registry。key 缺了它会自己抛（不在这里再判一遍，
    //   否则"哪一层负责报错"就有两份答案）。要跑不发请求的那两节，用 --dry=1
    const image = imageProviderOf(env)
    const edit = image.edit
    if (typeof edit !== 'function') {
      throw new Error(`${model} 的适配器没有 edit()——这条通路在这家平台上不存在`)
    }
    const started = Date.now()
    const response = await edit.call(image, {
      prompt,
      // ★ 用**产品自己那个尺寸**（页图 3:2），不是随手挑一个。
      //   上一家这条路上没有 `size` 字段，产物尺寸由模型定；这一家认它——
      //   所以下面核出来的尺寸既是"我们真会要的那个"，也是"它到底守不守"的判据
      size: DEFAULT_IMAGE_SIZE,
      referenceDataUrl: referenceDataUrlOf(normalized),
    })
    const seconds = (Date.now() - started) / 1000

    const pagePath = join(out, 'page.png')
    await writeFile(pagePath, response.bytes)
    pageArtifact = pagePath

    const produced = await shapeOf(response.bytes)
    e2eRows = [
      ['模型', model],
      [
        '路由',
        'POST /api/v1/services/aigc/multimodal-generation/generation，content 里多一段 {image}' +
          '（经 registry 的 imageProviderOf().edit，不是手搓 fetch）',
      ],
      ['请求的尺寸', `${DEFAULT_IMAGE_SIZE}（产品页图那一个）`],
      [
        '提示词来源',
        page === ''
          ? '生产那一条（prompts/image.ts 的 pagePrompt + demo-plan 第 1 页）'
          : '命令行给的（--prompt）',
      ],
      [
        '参考图是否进请求',
        response.referenceApplied === true
          ? '是 ✓（读的是响应里的 usage.input_image_count）'
          : '**否——这条通路没生效**',
      ],
      ['耗时', `${seconds.toFixed(1)}s`],
      ['产物', produced],
      ['产物落盘', pagePath],
      // 这条路上 `request_id` **在响应体里**（原生协议），适配器读进 `traceId`——
      //   报障时报得出号。上一版这里写的是"未回传"，那是照着兼容模式那条路写的
      ['requestId', response.traceId ?? '（这一次没回）'],
      [
        '仍然没量到的',
        '这一张扣了多少钱：响应里没有费用字段（适配器按 unitCostCny 兜底记账，那是兜底不是实测）',
      ],
    ]
    if (response.referenceApplied !== true) {
      throw new Error('edit() 回来了但没有 referenceApplied —— 这张图不能算"锁了脸"')
    }
    process.stdout.write(`端到端\n${table(e2eRows)}\n\n`)

    // ★ 判据 1 是**人看图**，脚本只能把该看的清单摆出来。
    //   这份清单与比对器用的是同一份（`checklistOf`），所以"画的时候按 A 画、
    //   查的时候按 B 查"那两条在人工核对这一步也是同源的。
    process.stdout.write(
      `看图核对（把这两张并排看，逐条对）：\n` +
        `  参考图 ${join(cardDir, card.reference.path)}\n` +
        `  本页图 ${pagePath}\n` +
        checklistOf(card)
          .map((line) => `  · ${line}`)
          .join('\n') +
        '\n  换个角度看不出结论时可以再比一遍：不在锚点里、只可能来自参考图的细节\n' +
        '  （比如衣服上那道白色纹样）有没有跟着过来——文字提示词没写它，它出现在产物里就只可能是参考图的功劳。\n\n',
    )
  }

  /* ── 5. 报告 ────────────────────────────────────────────────── */
  const report = [
    '# 工单 02 · 参考图通路 · 端到端实测',
    '',
    `跑于 ${new Date().toISOString()}（\`scripts/e2e-image-reference.mts\`）`,
    '',
    '> 这一份是**跑出来的**，不是抄 §一 那张表。§一 那次是手搓 fetch，',
    '> 这里走的是引擎自己的适配器，所以它多证明一件事：`edit()` 真的能出图。',
    '',
    failed.markdown,
    '## 归一化（卡片插画原样喂进去，不让它绕过这一层）',
    '',
    '```',
    table([
      ['卡', `${cardId} r${card.revision}`],
      ['原图', card.reference.path],
      ['进去', before],
      ['出来', after],
      ['notes', normalized.notes.join('；')],
      ['落盘', join(out, 'normalized-reference.png')],
    ]),
    '```',
    '',
    '## 看图核对要逐条对的清单',
    '',
    '> 这份清单与比对器（`vision.compare` 的 `checklist` 参数）用的是**同一个函数**',
    '> `checklistOf`。人工核对和自动核对问同一组问题——否则就成了"画的时候按 A 画、',
    '> 查的时候按 B 查"，两边都对不上还不知道是谁错了。',
    '',
    '```',
    table(checklistOf(card).map((line, index) => [`第 ${index + 1} 条`, line])),
    '```',
    '',
    // 判据 1 的那两张图。--dry=1 时右边那张不存在，报告就照实说，不指空路径
    '参考图：`' + join(cardDir, card.reference.path) + '`',
    pageArtifact === null
      ? '本页产物：**这一次没有**（`--dry=1` 没发请求），上面这份清单留着下次跑完再对'
      : '本页产物：`' + pageArtifact + '`',
    '',
    '## 真实照片',
    '',
    '```',
    table(photoRows),
    '```',
    '',
    '## 端到端（`edit`）',
    '',
    '```',
    table(e2eRows),
    '```',
    '',
    '### 这次送出去的提示词（逐字节，跑测可比性的前提）',
    '',
    '```text',
    prompt,
    '```',
    '',
    '## 还欠着的（不许用上面任何一行顶替）',
    '',
    '- **一张图扣多少钱**：没量到。响应里没有费用字段，适配器的 `unitCostCny` 是兜底记账',
    '- **照片**当参考图画出来的像不像：没量到（要用户提供照片，且比对器那一环同样未量）',
    '- **带上参考图之后一致性到底提升多少**：没量到。这条脚本证明的是"参考图真的进了请求"',
    '  （`usage.input_image_count`），**不是"画得更像了"**——那要专门做一次开/关对照',
    '- `size` 在 I2I 上守不守：**这一条由这份报告量掉**（上面"请求的尺寸"与"产物"两行对着看）',
    '',
  ].join('\n')
  await writeFile(join(out, 'report.md'), report, 'utf8')
  process.stdout.write(`报告：${join(out, 'report.md')}\n`)
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
