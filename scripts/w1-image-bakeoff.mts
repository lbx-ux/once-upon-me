/**
 * w1-image-bakeoff.mts —— 图像候选横评（tech-selection §12.2 产出物 1）
 *
 * 跑法（先填 .env.local，再）：
 *
 * ```bash
 * node scripts/w1-image-bakeoff.mts --models=qwen-image-3.0,qwen-image-3.0-pro --out=.out/bakeoff-image
 * # 只重出报告（排版改了不必重跑，一张图都不出）：
 * node scripts/w1-image-bakeoff.mts --out=.out/bakeoff-image --reportOnly=1
 * ```
 *
 * ★ 三条纪律，都是这一层的事：
 *
 * 1. **同一套提示词**。角色段由 `promptFragmentOf(card)` 派生、页级段来自
 *    `scripts/fixtures/demo-plan.json`，两个候选拿到的是**逐字节相同**的 prompt
 *    （ADR-0002 立适配层的第二个理由就是为了这一刻）。
 * 2. **固定输入是一张真卡，不是一段抄来的描述**。参考图与锚点从
 *    `.out/cards/cards/<cardId>/` 读（`scripts/make-demo-cards.mts` 的产物）。
 *    在脚本里重打一遍锚点看着更省事，但那份副本改了卡也不会报错——
 *    横评就变成"跟一个没人维护的影子比"，测的不是同一个东西。
 * 3. **判据 1 要人看图**。5 页里几张像同一个孩子，是 ≥3 个人眼判出来的，
 *    不是模型打分打出来的。所以脚本除了 JSON 还产出一个**盲评包**：
 *    目录名与文件名都不含候选名（`blind/set-1/…`），对照表只写在
 *    `image-bakeoff.json` 里 —— 目录叫 `blind/<某个候选名>/` 的那种"盲评"
 *    是自欺（人打开文件夹就已经知道答案了）。
 *    模型给的相似度分只作为对照记录在案（GLOSSARY：它是判据不是事实）。
 *
 * 花费不记账也不打印（用户 10/13 定的口径）。`ImageResponse.costCny` 这个字段
 * 仍然由适配层如实返回，只是这一层不再拿它做任何判断与输出。
 *
 * 未跑通之前，本脚本产出的报告里所有格子都是空的 —— 那是诚实的状态，
 * 不要手工填数。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { promptFragmentOf, checklistOf } from '../src/lib/engine/character-card/card.ts'
import { createCardStore } from '../src/lib/engine/character-card/store.ts'
import { pagePrompt, DEFAULT_IMAGE_SIZE } from '../src/lib/prompts/image.ts'
import { createQwenImage } from '../src/lib/engine/providers/qwen-image.ts'
import { createOpenAiVision } from '../src/lib/engine/providers/openai-vision.ts'
import { createFsStore, extensionOf } from '../src/lib/engine/providers/stores.ts'
import { digest } from '../src/lib/engine/digest.ts'
import { toDataUrl } from '../src/lib/engine/providers/http.ts'
import { arg, readEnv } from './env.mts'

const PAGES = 5

/** 把候选顺序打散成不透明标签，让"谁是谁"只存在于 json 里 */
function blindLabels(count: number, seed: number): string[] {
  const order = Array.from({ length: count }, (_, i) => i)
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1))
    const a = order[i] as number
    const b = order[j] as number
    order[i] = b
    order[j] = a
  }
  // order[k] 是第 k 个盲评标签对应的候选下标
  return order.map((index) => `set-${index + 1}`)
}

type PageRecord = {
  pageNo: number
  promptDigest: string
  /** 图有没有画出来。**与"核对了没有"是两件事**，见下面那段注释 */
  generated: boolean
  imageSeconds?: number
  assetPath?: string
  imageError?: string
  imageTraceId?: string
  /** 视觉模型有没有把这一页跟参考图比完 */
  checked: boolean
  checkError?: string
  machineScore?: number | null
  missed?: readonly string[]
}

type CandidateRecord = {
  model: string
  /** 盲评包里的目录名。人只看这个，映射在 json 顶层 */
  blindLabel: string
  referenceApplied: boolean
  pages: PageRecord[]
  note?: string
}

async function main(): Promise<void> {
  const env = await readEnv()
  const out = resolve(arg('out', '.out/bakeoff-image'))

  // ★ 只重出报告，不重跑（同 w1-text-bakeoff.mts 的理由：排版错一次不该重花一遍出图）。
  //   这一段在**读 key 之前**：重放只碰 json，不该要求有 Key、也不该读 demo-plan。
  //   机器分那一列在不在，优先读 json 里记的 `visionConfigured`；
  //   早期版本的 json 没有这个字段，那就退回"有没有任何一页带 machineScore"来推断——
  //   推断可能不准，所以允许 `--withMachineScore=1|0` 显式压过去。
  if (arg('reportOnly', '') === '1') {
    const saved = JSON.parse(await readFile(join(out, 'image-bakeoff.json'), 'utf8')) as {
      visionConfigured?: boolean
      results: CandidateRecord[]
    }
    const inferred = saved.results.some((r) => r.pages.some((p) => 'machineScore' in p))
    const withScore = arg(
      'withMachineScore',
      saved.visionConfigured === undefined
        ? inferred
          ? '1'
          : '0'
        : saved.visionConfigured
          ? '1'
          : '0',
    )
    await writeFile(
      join(out, 'image-bakeoff.md'),
      renderReport(saved.results, withScore === '1'),
      'utf8',
    )
    process.stdout.write(
      `从 ${join(out, 'image-bakeoff.json')} 重出报告（未出任何图，机器分列=${withScore === '1' ? '有' : '无'}）：\n` +
        `${join(out, 'image-bakeoff.md')}\n`,
    )
    return
  }

  // 候选模型名默认取 env 里那一个；★ 不再回落到某个厂商名——
  //   回落到 `wan2.7-image` 的表现是"没配也能跑"，然后跑出来的表跟正在用的模型无关
  const models = arg('models', env['IMAGE_MODEL'] ?? '')
  if (!models.trim())
    throw new Error('没给候选模型：--models=<逗号分隔> 或先配 IMAGE_MODEL')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)
  const apiKey = env['IMAGE_API_KEY'] ?? ''
  const baseUrl = env['IMAGE_BASE_URL'] ?? ''
  if (!baseUrl) throw new Error('IMAGE_BASE_URL 未配置')
  if (!apiKey) throw new Error('IMAGE_API_KEY 未配置。横评必须真跑，不接受手工填数')
  const seed = Number(arg('seed', String(Date.now())))

  const plan = JSON.parse(await readFile('scripts/fixtures/demo-plan.json', 'utf8')) as {
    nodes: { scene: string; imagePrompt: string; mood: string }[]
  }
  const pages = plan.nodes.slice(0, PAGES)

  // §12.1 的固定输入 = **一张角色卡**（参考图 + 锚点描述），从卡存储读。
  const cardDir = resolve(arg('cardDir', '.out/cards'))
  const cardStore = createCardStore(await createFsStore(cardDir))
  const cardId = arg('card', 'xiaoyu-r1')
  const card = await cardStore.latest(cardId)
  if (!card) {
    throw new Error(
      `找不到角色卡 ${cardId}（在 ${cardDir}）。先跑 node scripts/make-demo-cards.mts 生成两张"不存在的小孩"卡`,
    )
  }
  const referenceBytes = await (await createFsStore(cardDir)).read(card.reference.path)
  if (!referenceBytes) throw new Error(`角色卡 ${cardId} 的参考图读不到：${card.reference.path}`)
  const referenceDataUrl = toDataUrl(referenceBytes, card.reference.mime)

  const labels = blindLabels(models.length, seed)
  const blindKey: Record<string, string> = {}
  models.forEach((model, index) => {
    blindKey[labels[index] as string] = model
  })

  process.stdout.write(
    `固定输入：角色卡 ${card.cardId} r${card.revision} · ${card.anchors.length} 条锚点 · ` +
      `参考图 ${card.reference.path}（指纹 ${card.reference.digest}，${referenceBytes.byteLength} 字节）\n` +
      `横评：${models.length} 个候选 × ${pages.length} 页 = ${models.length * pages.length} 张\n` +
      `角色段（所有候选共用，逐字节相同）：\n  ${promptFragmentOf(card)}\n\n`,
  )

  await mkdir(out, { recursive: true })
  const store = await createFsStore(out)
  const vision =
    env['VISION_MODEL'] && (env['VISION_API_KEY'] ?? apiKey)
      ? createOpenAiVision(
          {
            baseUrl: env['VISION_BASE_URL'] ?? baseUrl,
            apiKey: env['VISION_API_KEY'] ?? apiKey,
            // ★ 300s 不是随手写的：这个调用一次要送**两张 1440×1440 的 data URL**
            //   （约 7 MB base64）。60s 的默认值实测会超时，而超时在这里的代价是
            //   "这一页没有机器分"，机器分又只是对照不是判据——所以宁等勿弃。
            //   真正想快，得先把图缩到 768 再送，那要先有图像处理库（见 §7 待办）。
            timeoutMs: 300_000,
          },
          env['VISION_MODEL'],
        )
      : null
  if (!vision) process.stdout.write('未配置 VISION_MODEL：机器相似度一列会是空的（不假装通过）\n\n')

  const results: CandidateRecord[] = []
  for (const [modelIndex, model] of models.entries()) {
    const label = labels[modelIndex] as string
    // ★ 横评必须**自己造候选适配器**（它测的就是"哪个模型"，那些名字不在 env 里），
    //   所以这里不走 registry。代价是候选的尺寸白名单得先量过——
    //   没量过的模型会在发请求前被拒（一次 200 就是一张图的钱）。
    const image = createQwenImage({ baseUrl, apiKey, timeoutMs: 300_000 }, model)
    const record: CandidateRecord = {
      model,
      blindLabel: label,
      // ★ 能力从适配器问出来，不再读 IMAGE_SUPPORTS_REFERENCE（那个化石已随工单 02 删掉）
      referenceApplied: image.supportsReference,
      pages: [],
    }
    process.stdout.write(`── ${label}（对照表见报告 json）──\n`)

    for (const [index, page] of pages.entries()) {
      const prompt = pagePrompt({
        card,
        page: page.imagePrompt,
        scene: page.scene,
        mood: page.mood,
      })
      const started = Date.now()
      let response: Awaited<ReturnType<typeof image.generate>>
      let asset: { path: string }
      try {
        response = await image.generate({
          prompt,
          size: DEFAULT_IMAGE_SIZE,
          referenceDataUrl: image.supportsReference ? referenceDataUrl : undefined,
          modelTag: model,
        })
        asset = await store.put({
          path: `blind/${label}/page-${index + 1}${extensionOf(response.mime)}`,
          bytes: response.bytes,
          mime: response.mime,
        })
      } catch (err) {
        record.pages.push({
          pageNo: index + 1,
          promptDigest: digest(prompt),
          generated: false,
          imageSeconds: Math.round((Date.now() - started) / 100) / 10,
          checked: false,
          imageError: err instanceof Error ? err.message : String(err),
          imageTraceId:
            err instanceof Error && 'traceId' in err
              ? String((err as { traceId: string }).traceId)
              : undefined,
        })
        process.stdout.write(
          `  第 ${index + 1} 页 **出图失败**：${err instanceof Error ? err.message : String(err)}\n`,
        )
        continue
      }

      const entry: PageRecord = {
        pageNo: index + 1,
        promptDigest: digest(prompt),
        generated: true,
        imageSeconds: Math.round((Date.now() - started) / 100) / 10,
        assetPath: asset.path,
        checked: false,
      }
      // ★ 出图与核对分成两段 try。合在一起写过一版，代价是 wan2.7-image 那张表
      //   上写着"成功页 2/5"，而磁盘上 5 张 PNG 都在——三个失败全是**视觉比对**
      //   超时（发送两张 1440×1440 的 data URL，约 7 MB）。把核对失败记成出图失败，
      //   等于用"裁判没到场"去判"选手没跑"，这张表是 go/no-go 证据，错不起。
      if (vision) {
        try {
          const compared = await vision.compare({
            referenceDataUrl,
            pageDataUrl: toDataUrl(response.bytes, response.mime),
            checklist: checklistOf(card),
          })
          entry.checked = true
          entry.machineScore = compared.score
          entry.missed = compared.missed
        } catch (err) {
          entry.checkError = err instanceof Error ? err.message : String(err)
        }
      }
      record.pages.push(entry)
      process.stdout.write(
        `  第 ${index + 1} 页 出图 ${entry.imageSeconds?.toFixed(1)}s` +
          `${entry.checked ? (typeof entry.machineScore === 'number' ? ` 机器分 ${entry.machineScore.toFixed(2)}` : ' 机器分 n/a') : vision ? ' 核对未完成' : ''}` +
          `${entry.missed && entry.missed.length > 0 ? ` 缺：${entry.missed.join('/')}` : ''}\n`,
      )
    }
    results.push(record)
  }

  await writeFile(
    join(out, 'image-bakeoff.json'),
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        seed,
        // 报告里"机器分"那一列在不在，记在数据里而不是靠重放时猜——
        // 猜错一次，重出的报告就和当初发布的不是同一份
        visionConfigured: vision !== null,
        card: {
          cardId: card.cardId,
          revision: card.revision,
          referencePath: card.reference.path,
          referenceDigest: card.reference.digest,
          anchors: card.anchors,
          style: card.style,
        },
        blindKey,
        results,
      },
      null,
      2,
    ),
    'utf8',
  )
  await writeFile(join(out, 'image-bakeoff.md'), renderReport(results, vision !== null), 'utf8')
  process.stdout.write(
    `\n报告：${join(out, 'image-bakeoff.md')}\n` +
      `盲评包：${join(out, 'blind')}（目录与文件名都不含候选名；只把这个目录发给 ≥3 人独立判读）\n` +
      `对照表：${join(out, 'image-bakeoff.json')}（seed=${seed}，判读完成前不要给人看）\n`,
  )
}

/** 判据 1 那一列**留空**给人填。机器分另起一列，两者不许互相顶替 */
function renderReport(results: readonly CandidateRecord[], withMachineScore: boolean): string {
  const header = [
    '| 盲评标签 | 候选（判读后揭盲） | 出图 | 机器核对 | 参考图是否生效 | 判据 1：≥3 人判"同一个孩子"（人填） |' +
      (withMachineScore ? ' 机器相似度（对照，不作判据） |' : ''),
    '|' + '---|'.repeat(withMachineScore ? 8 : 7),
  ]
  const rows = results.map((record) => {
    const drawn = record.pages.filter((page) => page.generated)
    const checkedPages = record.pages.filter((page) => page.checked)
    const scores = checkedPages
      .map((page) => page.machineScore)
      .filter((score): score is number => typeof score === 'number')
    const mean =
      scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : '—'
    return (
      `| ${record.blindLabel} | ${record.model} | ${drawn.length}/${record.pages.length} | ` +
      `${checkedPages.length}/${record.pages.length} | ` +
      `${record.referenceApplied ? '已开（待确认是否真生效）' : '未开'} | _待人工判读_ |` +
      (withMachineScore ? ` ${mean} |` : '')
    )
  })
  const drawFailures = results.flatMap((record) =>
    record.pages
      .filter((page) => !page.generated)
      .map(
        (page) =>
          `- ${record.blindLabel} / ${record.model} 第 ${page.pageNo} 页：${page.imageError}` +
          `${page.imageTraceId ? `（traceId=${page.imageTraceId}）` : ''}`,
      ),
  )
  const checkFailures = results.flatMap((record) =>
    record.pages
      .filter((page) => page.generated && !page.checked)
      .map(
        (page) =>
          `- ${record.blindLabel} / ${record.model} 第 ${page.pageNo} 页：${page.checkError}`,
      ),
  )
  return [
    '# 图像横评表（tech-selection §12.2 产出物 1）',
    '',
    '> 判据 1 是**一票否决**，且它的量法写明是"≥3 人独立判是不是同一个孩子"。',
    '> 表里的候选名只在判读**之后**才允许对照；在此之前只发 `blind/` 目录。',
    '> 机器分只作对照：GLOSSARY「一致性分」——它是判据不是事实，阈值靠人工判读校准。',
    '',
    ...header,
    ...rows,
    '',
    drawFailures.length > 0 || checkFailures.length > 0
      ? [
          '## 失败明细（4xx 不扣费，逐条留 traceId 便于找平台）',
          '',
          ...(drawFailures.length > 0
            ? ['### 出图失败（这几页没有图）', '', ...drawFailures, '']
            : []),
          ...(checkFailures.length > 0
            ? [
                '### 视觉核对未完成（图在，只是没比成——**不是出图失败**）',
                '',
                ...checkFailures,
                '',
                '机器分本来就是"对照不是判据"，这几页的判据 1 仍然由人看图得出。',
              ]
            : []),
        ].join('\n')
      : '',
    '',
    '## 还缺的判据（要查官方文档 / 控制台，不是跑脚本能得到的）',
    '',
    '- 判据 3 比例覆盖：能不能直出 3:2 与 3:4（当前实测白名单见 qwen-image.ts 的 SIZES_BY_MODEL——它是量出来的，不是文档抄的）',
    '- 判据 5 儿童内容审核政策：拿"孩子当主角 + 冒险情节"试投',
    '- 判据 6 并发与配额：20 页能否并发拉',
    '- 判据 7 可达性：国内直连是否需要代理',
  ].join('\n')
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
