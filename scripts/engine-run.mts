/**
 * engine-run.mts —— ★ 引擎的验收脚本：不启动浏览器，跑完一本绘本
 *
 * 用法（仓库根，Node ≥ 22.18：需要原生 TypeScript 类型剥离）：
 *
 * ```bash
 * node scripts/engine-run.mts --mode=stub --form=shared --out=.out/engine-run
 * node scripts/engine-run.mts --mode=live --form=solo --pages=5 --out=.out/live
 * # 回放：--out 可以换，但资产根必须指回录制那次（manifest 里是相对路径）
 * node scripts/engine-run.mts --mode=offline --form=solo --pages=5 \
 *   --manifest=.out/live/manifest.json --assets=.out/live --out=.out/replay
 * ```
 *
 * ★ 三种模式之间有一条**参数必须对齐**的纪律：`--form` / `--pages` 变了，
 *   规划请求的指纹就变了，回放会当场 miss 并报错（这是对的，见 replay.ts 第 1 条）。
 *   所以回放要照抄录制时的 `--form` 与 `--pages`，不能只给 `--manifest`。
 *
 * 三种模式：
 *
 * | 模式 | 供应商 | 花不花钱 | 干什么用 |
 * | --- | --- | --- | --- |
 * | `stub` | 脚本内的固定替身（规划表 = fixtures/demo-plan.json，图 = public/book 现成成图） | 不花 | **架构验收**：证明 `lib/engine` 能被 node 直接跑完，不碰 React、不碰网络 |
 * | `live` | `.env.local` 里配的模型 | 图像 0.20 元/张 | 真跑测与横评 |
 * | `offline` | 录好的 manifest | 不花 | ADR-0003 的演示路径：断网也能出一本完整的书 |
 *
 * 这条命令本身就是 checklist #11 的交付物，所以它把每一步的事件原样打出来：
 * "平台而非聚合"的技术证据不是文档里的一句话，是可复现的一次运行。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { promptFragmentOf } from '../src/lib/engine/character-card/card.ts'
import { createCardStore } from '../src/lib/engine/character-card/store.ts'
import { digest } from '../src/lib/engine/digest.ts'
import { describeEvent } from '../src/lib/engine/events.ts'
import { runBook } from '../src/lib/engine/index.ts'
import { createProviders } from '../src/lib/engine/providers/registry.ts'
import { createFsStore } from '../src/lib/engine/providers/stores.ts'
import { emptyManifest, recordImage, recordText } from '../src/lib/engine/providers/replay.ts'
import type { BookForm } from '../src/lib/engine/domain.ts'
import type {
  ImageGenerator,
  ProviderBundle,
  TextGenerator,
} from '../src/lib/engine/providers/types.ts'

type Args = Record<string, string>

function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (const item of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(item)
    if (!match) continue
    out[match[1] as string] = match[2] ?? '1'
  }
  return out
}

/** 读 .env.local。node 24 有 process.loadEnvFile，但只影响 process.env，我们要么显式传表 */
async function loadEnv(): Promise<Record<string, string | undefined>> {
  try {
    const text = await readFile('.env.local', 'utf8')
    const env: Record<string, string | undefined> = { ...process.env }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      env[match[1] as string] = (match[2] as string).replace(/^["']|["']$/g, '')
    }
    return env
  } catch {
    return { ...process.env }
  }
}

const DEMO_IMAGES = [
  'public/book/spread-1.webp',
  'public/book/spread-2.webp',
  'public/book/spread-3.webp',
  'public/book/spread-4a.webp',
  'public/book/spread-4b.webp',
]

/** 固定替身：按顺序发成图、按顺序发表。它**不**是引擎的一部分，只活在这个脚本里 */
function stubProviders(planJson: string): { text: TextGenerator; image: ImageGenerator } {
  let imageCursor = 0
  return {
    text: {
      id: 'stub-text',
      modelId: 'stub-plan@v1',
      async complete() {
        return { text: planJson, modelId: 'stub-plan@v1' }
      },
    },
    image: {
      id: 'stub-image',
      modelId: 'pregenerated-demo-art',
      supportedRatios: ['1:1'],
      supportsReference: false,
      async generate() {
        const path = DEMO_IMAGES[imageCursor % DEMO_IMAGES.length] as string
        imageCursor += 1
        return {
          bytes: new Uint8Array(await readFile(path)),
          mime: 'image/webp',
          modelId: 'pregenerated-demo-art',
          costCny: 0,
        }
      },
    },
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const mode = args['mode'] ?? 'stub'
  const form = (args['form'] ?? 'shared') as BookForm
  const outDir = resolve(args['out'] ?? '.out/engine-run')
  const childId = args['child'] ?? 'xiaolu'
  const theme = args['theme'] ?? '第一次离开家也不怕'
  const pages = args['pages'] ? Number(args['pages']) : undefined

  process.stdout.write(`引擎验收 · mode=${mode} form=${form} out=${outDir}\n\n`)

  const store = await createFsStore(outDir)
  const cardStore = createCardStore(store)

  // 角色卡：参考图用演示绘本封面（小宇），锚点取自 docs/demo-book-art-prompts.md 的既定描述
  const referenceBytes = new Uint8Array(await readFile('public/book/cover.webp'))
  const referenceDigest = digest(referenceBytes)
  const built = await cardStore.create({
    cardId: 'xiaolu-r1',
    childId,
    anchors: [
      { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
      { slot: 'eyes', value: '深棕圆眼、眼距略宽、睫毛短' },
      { slot: 'hair', value: '黑发偏软，左上方永远翘着一撮' },
      { slot: 'build', value: '头身比约 1:4，四肢圆润' },
      { slot: 'skin', value: '暖黄偏深的肤色，膝盖总有晒黑的印' },
      { slot: 'wardrobe', value: '芥黄短袖 + 深蓝短裤 + 一双红雨鞋' },
    ],
    style: {
      key: 'warm-handdrawn',
      promptFragment: '温暖手绘水彩绘本插画，柔和侧向暖光，纸张纹理可见',
      ratio: '3:2',
    },
    referenceBytes,
    referenceMime: 'image/webp',
    modelId:
      mode === 'live'
        ? ((await loadEnv())['IMAGE_MODEL'] ?? 'unconfigured')
        : 'character-card@stub',
    promptVersion: 'character-card@v1',
    now: 1_760_000_000_000,
  })
  const card = built.card
  process.stdout.write(
    `角色卡 ${card.cardId} r${card.revision} 参考图指纹=${referenceDigest} 锚点 ${card.anchors.length} 条\n` +
      `  派生的角色段（每一页 prompt 的开头，由卡唯一决定）：\n    ${promptFragmentOf(card)}\n\n`,
  )

  let voiceId: string | undefined
  let providers: ProviderBundle
  if (mode === 'stub') {
    if (form !== 'shared') {
      throw new Error(
        'stub 模式的固定剧本是首页第二屏那本《小宇的云》（共读版），要跑独读版请用 --mode=live',
      )
    }
    const planJson = await readFile('scripts/fixtures/demo-plan.json', 'utf8')
    const stub = stubProviders(planJson)
    providers = {
      mode: 'offline',
      text: stub.text,
      image: stub.image,
      vision: null,
      voice: null,
      store,
    }
  } else if (mode === 'offline') {
    const manifestPath = args['manifest']
    if (!manifestPath) throw new Error('--mode=offline 需要 --manifest=PATH')
    const { createReplayImage, createReplayText } =
      await import('../src/lib/engine/providers/replay.ts')
    const fs = await import('node:fs/promises')
    const manifest = JSON.parse(await fs.readFile(resolve(manifestPath), 'utf8'))
    // ★ 回放要从**录制时那个资产根**读，不是从本次的输出目录读。
    //   manifest 里记的是相对路径（`assets/<指纹>.img`），换一个根就一份都找不到——
    //   实测第一次回放时 5 页全报"manifest 指向的资产不存在"，就是因为用了 --out。
    //   所以 --assets 缺省是"输出目录"（同目录重放时正好对），跨目录演示时必须显式给。
    const assetRoot = resolve(args['assets'] ?? outDir)
    const assetStore = assetRoot === outDir ? store : await createFsStore(assetRoot)
    providers = {
      mode: 'offline',
      text: createReplayText(assetStore, manifest),
      image: createReplayImage(assetStore, manifest),
      vision: null,
      voice: null,
      store,
    }
    process.stdout.write(`离线回放：manifest=${resolve(manifestPath)} · 资产根=${assetRoot}\n\n`)
  } else if (mode === 'live') {
    const env = await loadEnv()
    const base = await createProviders({ env, mode: 'live', store })
    // live 模式顺手录制：一次真跑同时产出离线演示要用的资产（ADR-0003）
    const manifest = emptyManifest()
    const manifestPath = join(outDir, 'manifest.json')
    const persist = async (): Promise<void> => {
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    }
    providers = {
      ...base,
      text: recordText(base.text, persist, manifest),
      // ★ 录进**磁盘 store**，不是 createMemoryStore()。原来写的是内存，
      //   于是 manifest 里记着 `assets/<指纹>.img`，那批字节却从没落到盘上——
      //   进程一退就没了，回放必然报"资产不存在"。也就是说
      //   ADR-0003 的"断网也能出一本完整的书"在这之前**根本跑不通**，
      //   而 manifest 看上去是好的（它自己确实写出来了）。
      //   代价：同一张图多存一份（引擎自己在 books/<id>/ 下已经有）——
      //   用可演示性换一点磁盘，.out/ 本来也不入库。
      image: recordImage(base.image, store, persist, manifest),
    }
    // ★ 音色由调用方给（引擎不读环境变量）：--voice= 优先，其次 .env.local 的 TTS_VOICE。
    //   都不给就是「没有朗读」，并有一条非致命事件说清原因（见 runBook 的三分支）
    voiceId = (args['voice'] ?? env['TTS_VOICE'] ?? '').trim() || undefined
    process.stdout.write(`live：本次运行会同时录制到 ${manifestPath}
`)
    process.stdout.write(`live：音色 ${voiceId ?? '（未指定，这本书不会有朗读）'}

`)
  } else {
    throw new Error(`未知 mode=${mode}（可用：stub / live / offline）`)
  }

  const events: string[] = []
  const book = await runBook(
    {
      child: {
        childId,
        name: '小宇',
        nameReading: 'yǔ',
        ageBand: '4-6',
        lookTags: ['圆脸', '短发'],
        interestTags: ['云', '恐龙', '船'],
      },
      card,
      theme,
      form,
      pages,
      ...(voiceId ? { voiceId } : {}),
    },
    {
      providers,
      onEvent: (event) => {
        const line = `[${String(event.seq).padStart(2, '0')}] ${describeEvent(event)}`
        events.push(line)
        process.stdout.write(line + '\n')
      },
    },
  )

  await mkdir(dirname(join(outDir, 'summary.json')), { recursive: true })
  await writeFile(
    join(outDir, 'summary.json'),
    JSON.stringify({ mode, form, stats: book.stats, events, bookId: book.bookId }, null, 2),
    'utf8',
  )

  // ★ 汇总行**必须把三件事分开报**：有图 / 核对通过 / 核对不通过 / 未核对。
  //   原来那一行写的是"N/5 页有图"，而 N 数的是**核对通过的页**——
  //   实测跑 5 页时磁盘上 8 张 PNG 都在，那一行却写着"2/5 页有图"。
  //   （原来那个三元表达式两个分支还一模一样，等于没写。）
  //   这一类错在这个项目里出现过三次，这是最贵的一次：它把已经付过钱的图说成不存在。
  //
  //   ★ 三档加起来必须等于"有图"。少写一档就会漏数：
  //     3 页的书跑成"通过 1 · 未核对 1"，第三页（核对过、判了不通过）在行里消失了，
  //     读的人只能猜。所以这里既分开数，也当场核对总数。
  //
  //   也不再打印成本：机器读数常年是 0，打出来是**假数**；
  //   而且口径本来就是不记账（见 scripts/env.mts 文件头）。
  const passed = book.illustrations.filter((item) => item.consistency?.verdict === 'pass')
  const rejected = book.illustrations.filter((item) => item.consistency?.verdict === 'fail')
  const unchecked = book.illustrations.filter(
    (item) => !item.consistency || item.consistency.verdict === 'unavailable',
  )
  const accounted = passed.length + rejected.length + unchecked.length
  process.stdout.write(
    `\n完成：有图 ${book.illustrations.length}/${book.stats.nodesPlanned} 页 · ` +
      `核对通过 ${passed.length} · 核对不通过 ${rejected.length} · 未核对 ${unchecked.length}${
        unchecked.length > 0
          ? `（比对没跑成或没配，这几页**不等于没画**——见 ${join(outDir, 'books', book.bookId, 'book.json')} 里各自的 consistency.reason）`
          : ''
      }\n` +
      (accounted === book.illustrations.length
        ? ''
        : `　　　⚠ 三档加起来 ${accounted} ≠ 有图 ${book.illustrations.length}，` +
          '这一行的分类漏了一档，别拿它做判断\n') +
      `　　　重画 ${book.stats.redrawCount} · 图像调用 ${book.stats.imageCalls} 次 · ` +
      `页级失败 ${book.errors.length} · 耗时 ${(book.stats.elapsedMs / 1000).toFixed(2)}s\n` +
      `清单：${join(outDir, 'books', book.bookId, 'book.json')}\n`,
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`\n失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
