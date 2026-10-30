/**
 * check-family-data.mts —— ★「小孩的照片与原声一个字节都不在盘上」的**可重复跑的**自查
 * （2026-10-21，工单 D-28 判据③）
 *
 * ```bash
 * node scripts/check-family-data.mts          # 也挂在 `pnpm verify` 里（第七条）
 * ```
 *
 * 为什么它必须是一个命令，而不是"读过代码，确实没写"
 *
 * `photo-card.ts` 的文件头与 `voice/clone/route.ts` 的文件头都写着同一句承诺：
 *   照片原图与录音样本只在那一次请求的内存里活一遍，不落盘、不进日志。
 *   这句承诺在仓库里有两条单测撑着（`photo-card.test.ts` 的记账假 store），
 *   但它们只看得见**被喂进去的那一个 store**。而"没落盘"这件事的失效方式，
 *   恰恰是**在别处写了一下**——另一个 store、一个临时文件、一行日志。
 *   所以这里换一个问法，问的是盘本身：
 *
 * ```
 * 真跑一遍  →  满盘搜这几个字节  →  找不到才算数
 * ```
 *
 * ★ 三件让它不变成"同义反复"的讲究
 *
 * 1. **针是真的送进去了**。照片与水印样本里各埋了一串只在本次运行里存在的标记，
 *    跑之前先断言"这串标记真的在那份字节里"——针没扎进去的探针，找到 0 次也是 0 次。
 * 2. **两个对照，两条不同的路**。找不到"照片"这件事本身是没有判别力的：
 *    一个什么都没跑的探针也找不到它。所以同一次搜索里必须同时命中另外两样
 *    ——假厂商画出来的那张形象（它带着自己的标记），以及发往厂商的请求体里
 *    那段样本（由假 fetch 攥在手里）。**它们命中、照片 0 命中**，这一对读数才有意义。
 * 3. **针在源码里写着，但源码里搜不到**。标记串在运行时拼起来（见 `needlesOf` 那一行）：
 *    直接写成字面量的话，本文件自己会成为唯一的命中项，而那是自己咬自己。
 *
 * 搜的范围：**整个工作区**（除 `node_modules` / `.git` / `.next*` / 无头浏览器用户档）
 *   ＋ 这一轮真跑出来的那个临时资产根。搜的是字节，不是"文本文件"——
 *   照片要是被写进一份 JSON、一个 zip、一个 `.log`，三种都得抓得到。
 *
 * ★ 它**证不到**的那一格，照实写在最后一段输出里：这条路走的是
 *   `cardFromPhoto` 与适配器的 `clone`，不是 HTTP 那一层
 *   （路由的 `await req.formData()` 与 `requireCapability` 不在这里）。
 *   那两段能不能把字节带到别处去，由 `photo-card.test.ts` 与路由那几条用例管。
 */

import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'

import sharp from 'sharp'

import { DEFAULT_ANCHORS } from '../src/lib/creation/default-anchors.ts'
import { createCardStore } from '../src/lib/engine/index.ts'
import { normalizeReference } from '../src/lib/engine/image/normalize.ts'
import { createQwenSpeech } from '../src/lib/engine/providers/qwen-speech.ts'
import type { AssetStore, ImageGenerator } from '../src/lib/engine/providers/types.ts'
import { cardFromPhoto } from '../src/lib/photo-card.ts'
import { parseCloneRequest } from '../src/lib/voices/request.ts'
import { createUserStore } from '../src/lib/asset-scope.ts'

const ROOT = resolve(import.meta.dirname, '..')

/* ── 标记：运行时拼，免得本文件成为唯一的命中项 ────────────────────────── */

const MARK = (...parts: string[]): string => parts.join('-')
const PHOTO_MARK = MARK('XZJ', 'PHOTO', 'ORIGINAL', 'NEVER', 'ON', 'DISK', 'a91f3c')
const DRAW_MARK = MARK('XZJ', 'GENERATED', 'SHEET', 'EXPECTED', 'ON', 'DISK', '4c07e2')
const VOICE_MARK = MARK('XZJ', 'VOICE', 'SAMPLE', 'NEVER', 'ON', 'DISK', '77b1de')

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

/* ── 搜索范围 ─────────────────────────────────────────────────────────── */

/** 不进搜索的目录。★ 每一条都要能说出理由，不然"没找到"就只是"没找" */
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.next-session', '.next-eval', 'dist'])
/**
 * 无头浏览器用户档（`.out/chrome-*`）：那是本机调试残留，不是产品存东西的地方。
 * ★ 跳它要在输出里说出来——一份静悄悄跳过的搜索，读起来与"全搜过了"一样。
 */
const SKIP_PREFIX = ['chrome-']

type Needle = {
  label: string
  kind: 'sha' | 'text'
  value: string
  /** 这一条命中意味着什么 */
  why: string
  /**
   * 命中了是**好事**（对照针），还是**坏事**（判据针）。
   * ★ 两类针放在同一次搜索里，是为了让"什么都没命中"这件事不再可能被当成通过。
   */
  want: 'absent' | 'present'
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: { name: string; isDirectory(): boolean }[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || SKIP_PREFIX.some((p) => entry.name.startsWith(p))) continue
      await walk(join(dir, entry.name), out)
    } else {
      out.push(join(dir, entry.name))
    }
  }
}

/** 超过这个大小的文件不读（页图最大 1.5MB；再大的多半是浏览器残留或视频） */
const MAX_BYTES = 32 * 1024 * 1024

type Hit = { file: string; needle: Needle; at: number }
type SweepReport = {
  files: number
  skippedBig: number
  hits: Hit[]
}

async function sweep(roots: string[], needles: Needle[]): Promise<SweepReport> {
  const files: string[] = []
  for (const root of roots) await walk(root, files)

  const hits: Hit[] = []
  let skippedBig = 0
  for (const file of files) {
    const info = await stat(file)
    if (info.size > MAX_BYTES) {
      skippedBig += 1
      continue
    }
    const bytes = await readFile(file)
    for (const needle of needles) {
      if (needle.kind === 'sha') {
        if (sha256(bytes) === needle.value) hits.push({ file, needle, at: 0 })
        continue
      }
      const at = bytes.indexOf(Buffer.from(needle.value, 'utf8'))
      if (at >= 0) hits.push({ file, needle, at })
    }
  }
  return { files: files.length, skippedBig, hits }
}

/* ── 段 1 · 照片那条路真跑一遍 ───────────────────────────────────────────── */

/**
 * 一张**真**照片：`normalizeReference` 会真的用 sharp 解它，所以它必须能解开。
 * 里面埋 `PHOTO_MARK`（EXIF 的 `ImageDescription`）——因为 byte 级搜索要靠它。
 */
async function makePhoto(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width: 720, height: 720, channels: 3, background: { r: 186, g: 142, b: 118 } },
    })
      .png()
      .withMetadata({ exif: { IFD0: { ImageDescription: PHOTO_MARK } } })
      .toBuffer(),
  )
}

/**
 * 假厂商画出来的那张形象。★ 它必须是 **JPEG**：`whitenBackdrop` 只认 PNG，
 *   非 PNG 原样放回，于是埋进去的 `DRAW_MARK` 会真的落进 store——
 *   这就是本次搜索里那个"应该命中"的对照针。
 *   （用真 PNG 的话刷底会重编码一遍，标记会被洗掉，对照就永远命不中了。）
 */
async function makeDrawing(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width: 1440, height: 1440, channels: 3, background: { r: 246, g: 240, b: 228 } },
    })
      .jpeg({ quality: 60 })
      .withMetadata({ exif: { IFD0: { ImageDescription: DRAW_MARK } } })
      .toBuffer(),
  )
}

type PhotoRun = {
  /** 盘上那个临时资产根的根目录 */
  root: string
  photo: Uint8Array
  normalized: Uint8Array
  /** 真写进 store 的那张形象（＝假厂商回的那一份） */
  drawing: Uint8Array
  cardReferencePath: string
  /** 送出去的那段 data URL（对照用：它确实带着归一化之后的照片） */
  sentReferenceDataUrl: string
  notes: readonly string[]
}

async function runPhotoPath(): Promise<PhotoRun> {
  const root = await mkdtemp(join(tmpdir(), 'xzj-family-check-'))
  // ★ 与生产同一口径：用户那一片（`u/<id>/`），不是裸根
  const store: AssetStore = await createUserStore(root, '1')
  const photo = await makePhoto()
  const drawing = await makeDrawing()
  let sentReferenceDataUrl = ''

  const image: ImageGenerator = {
    id: 'fake-image-for-family-check',
    modelId: 'fake-image-for-family-check',
    supportedRatios: ['1:1'],
    supportsReference: true,
    generate() {
      throw new Error('这条路只该走 edit（照片当参考图那一支）')
    },
    async edit(req) {
      if (!req.referenceDataUrl) throw new Error('没收到参考图——那这一轮就证明不了什么')
      sentReferenceDataUrl = req.referenceDataUrl
      return {
        bytes: drawing,
        mime: 'image/jpeg',
        modelId: 'fake-image-for-family-check',
        referenceApplied: true,
        costCny: 0,
      }
    },
  }

  const result = await cardFromPhoto(
    {
      childId: 'kid-family-check',
      name: '小钉',
      ageBand: '4-6',
      childWord: '小女孩',
      anchors: DEFAULT_ANCHORS,
      photo,
      consent: true,
    },
    { store, cardStore: createCardStore(store), image, now: 1_760_000_000_000 },
  )

  // ★ 归一化那一份也要一根针：它是**被送出去**的那一份，最可能被谁顺手写下来
  const normalized = (await normalizeReference(photo)).bytes

  return {
    root,
    photo,
    normalized,
    drawing,
    cardReferencePath: result.card.reference.path,
    sentReferenceDataUrl,
    notes: result.notes,
  }
}

/* ── 段 2 · 声音那条路真跑一遍 ───────────────────────────────────────────── */

type VoiceRun = {
  /** 假厂商拿到的那份请求体（对照针：样本确实发出去了） */
  vendorBody: string
  voiceId: string
  sample: Uint8Array
  /** 没带授权凭据号时那一次解析的结果（对照针：那道闸门真在） */
  withoutConsent: string
}

/** 一段"像是录下来的"样本：WAV 头 + 标记 + 一段噪声。适配器只查 mime 与长度 */
function makeSample(): Uint8Array {
  const noise = Buffer.alloc(64 * 1024)
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 37) % 251
  return new Uint8Array(
    Buffer.concat([Buffer.from('RIFF'), Buffer.from(VOICE_MARK), Buffer.from('WAVEfmt '), noise]),
  )
}

async function runVoicePath(): Promise<VoiceRun> {
  const sample = makeSample()
  // 走路由那一层自己的解析（`/api/voice/clone` 收到请求体之后调的就是它）
  const body = {
    sampleBase64: b64(sample),
    mime: 'audio/wav',
    consentRef: 'local:family-check-0001',
    name: '我的声音',
  }
  const parsed = parseCloneRequest(body)
  if (!parsed.ok) throw new Error(`路由的解析没收下这份样本：${parsed.message}`)

  const withoutConsent = parseCloneRequest({ ...body, consentRef: '' })
  if (withoutConsent.ok) throw new Error('没带授权凭据号也收下了——那一道闸门没有了')

  let vendorBody = ''
  const voice = createQwenSpeech(
    {
      baseUrl: 'http://127.0.0.1:9',
      apiKey: 'family-check-key',
      // ★ 假 fetch：真的把请求体截下来。不注入它，"样本发出去过"这件事就验不了，
      //   而那正是"找不到样本"这句话的对照（`HttpDeps.fetchImpl` 就是为这个留的）
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        vendorBody = typeof init?.body === 'string' ? init.body : String(init?.body ?? '')
        return new Response(JSON.stringify({ output: { voice_id: 'fake-voice-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as unknown as typeof fetch,
    },
    'fake-tts-model',
  )

  const { voiceId } = await voice.clone(parsed.value.request)
  return { vendorBody, voiceId, sample, withoutConsent: withoutConsent.message }
}

/* ── 段 3 · 资产根里每一个媒体文件都要能被认领 ─────────────────────────── */

const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.mp3', '.wav', '.m4a', '.mp4'])

/**
 * 运行期资产根（`.out/web`）里允许出现的形状。
 *
 * 这份白名单不是"我认为会有什么"，是**从生产代码里写下的那几个前缀**抄来的：
 *   `cards/<cardId>/ref.<digest>.<ext>`（`character-card/store.ts` 的 `refPath`）、
 *   `books/<bookId>/{cover,cover-aM,page-N-aM}.<ext>`（`illustrate.ts` 的 `pagePath`）、
 *   `thumbs/<档>/<原图路径>`（`thumbs.ts`）。
 * ★ 一条照片泄进来最可能的落点（`children/`、裸根、某个临时名）都落不进这些形状里，
 *   于是它会以"认领不了"的形式当场红掉。而"按位置认领"证不到的是
 *   "这个位置里那张图真的不是照片"——那一半由段 1 的字节搜索管，两段互补。
 */
const CLAIMED: { what: string; test: RegExp }[] = [
  {
    what: '角色卡的参考图（内容寻址，`ref.<指纹>.<后缀>`）',
    test: /^cards\/[^/]+\/ref\.[0-9a-f]+\.[a-z]+$/,
  },
  {
    what: '角色卡的版本记录（json，列在这里只为不漏掉路径）',
    test: /^cards\/[^/]+\/r\d+\.[0-9a-f]+\.json$/,
  },
  // ★ 封面也带 attempt（`illustrate.ts` 的 `cover-a${attempt}`，2026-10-20 起）：
  //   被替掉的那几版留着，"上一版为什么不行"要看得见。规则原来只认 `cover.<ext>`，
  //   于是引擎正常写出的 `cover-a1.png` 被当成"没人认领"——2026-10-22 实测 4 张。
  {
    what: '书的封面（第 N 版；引擎保留被替掉的那几张）',
    test: /^books\/[^/]+\/cover(?:-a\d+)?\.[a-z]+$/,
  },
  { what: '书的某一页 / 那一页的配音', test: /^books\/[^/]+\/page-\d+-a\d+\.[a-z0-9]+$/ },
  // ★ 下面三条不是推理出来的，是上面那一次实跑"认领不了"点出来的真名字
  {
    what: '共读版两支各自的朗读（`-opt-a` / `-opt-b`）',
    test: /^books\/[^/]+\/page-\d+-opt-[ab]-a\d+\.mp3$/,
  },
  { what: '那一页的口播提问（`-prompt-`）', test: /^books\/[^/]+\/page-\d+-prompt-a\d+\.mp3$/ },
  { what: '缩略图缓存（派生资产，`thumbs/<宽度>/<原图路径>.webp`）', test: /^thumbs\/\d+\/.+$/ },
  // ★ 2026-10-30：打印页那个探针跑完之后，这里当场红了 6 张——上面那条只认宽度那一档，
  //   而打印档的缓存键是 `printKeyOf` 写的 `thumbs/print/native/<原图路径>.jpg`
  //   （`.<ext>.jpg` 两个后缀是有意的：原图名整个留在里面，`native` 表示没缩）。
  //   规则照 `printKeyOf` 抄，`native` 与数字宽度两种都收。
  {
    what: '打印那一档的 JPEG 缓存（派生资产，`thumbs/print/<宽度|native>/<原图路径>.jpg`）',
    test: /^thumbs\/print\/(?:\d+|native)\/.+\.jpg$/,
  },
]

type Claimed = { file: string; what: string }
type Unclaimed = { file: string; size: number }

async function claimAssetRoot(
  root: string,
  /** 资产根之下那一层是不是还有 `u/<id>/`（临时根是生产口径，也是） */
  withUserLayer: boolean,
): Promise<{ ok: Claimed[]; bad: Unclaimed[]; media: number }> {
  const files: string[] = []
  await walk(root, files)
  const ok: Claimed[] = []
  const bad: Unclaimed[] = []
  let media = 0

  for (const file of files) {
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
    if (!MEDIA_EXT.has(ext)) continue
    media += 1
    let rel = relative(root, file).split(sep).join('/')
    if (withUserLayer) rel = rel.replace(/^u\/[^/]+\//, '')
    const rule = CLAIMED.find((one) => one.test.test(rel))
    if (rule) ok.push({ file: relative(ROOT, file), what: rule.what })
    else bad.push({ file: relative(ROOT, file), size: (await stat(file)).size })
  }
  return { ok, bad, media }
}

/* ── 跑 ───────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const line = (text = ''): void => void process.stdout.write(text + '\n')
  line('家庭数据自查 · 照片与录音样本在不在盘上（工单 D-28 判据③）')
  line('='.repeat(72))

  /* 段 1 */
  const run = await runPhotoPath()
  const photoHitSelf = Buffer.from(run.photo).includes(Buffer.from(PHOTO_MARK))
  const drawHitSelf = Buffer.from(run.drawing).includes(Buffer.from(DRAW_MARK))
  line('')
  line('段 1 · 照片 → 角色卡（真跑了一遍，走的是 `cardFromPhoto`）')
  line(
    `  原图 ${run.photo.length} 字节 · 埋的标记在里面：${photoHitSelf ? '是' : '★ 不在（这一轮白跑）'}`,
  )
  line(`  假厂商画的那张 ${run.drawing.length} 字节 · 标记在里面：${drawHitSelf ? '是' : '★ 不在'}`)
  line(`  写进卡里的参考图：${run.cardReferencePath}`)
  line(
    `  送出去的参考图是 data URL：${run.sentReferenceDataUrl.slice(0, 32)}…（${run.sentReferenceDataUrl.length} 字节）`,
  )
  line(`  归一化说了什么：${run.notes.join('；')}`)

  /* 段 2 */
  const voice = await runVoicePath()
  const sampleHitSelf = Buffer.from(voice.sample).includes(Buffer.from(VOICE_MARK))
  const vendorGotSample = voice.vendorBody.includes(b64(voice.sample))
  line('')
  line('段 2 · 录音样本 → 创建音色（真跑了一遍，走的是 `parseCloneRequest` + 适配器的 `clone`）')
  line(
    `  样本 ${voice.sample.length} 字节 · 标记在里面：${sampleHitSelf ? '是' : '★ 不在（这一轮白跑）'}`,
  )
  line(
    `  假厂商收到的请求体里带着整段样本：${vendorGotSample ? '是' : '★ 没有——那"找不到"就说明不了什么'}`,
  )
  line(`  厂商回的 voiceId：${voice.voiceId}`)
  line(`  对照：不带授权凭据号时它被拦下了（「${voice.withoutConsent}」）`)

  /* 搜索 */
  const needles: Needle[] = [
    {
      label: '照片原图（逐字节 sha256）',
      kind: 'sha',
      value: sha256(run.photo),
      why: '照片被原样写下来了',
      want: 'absent',
    },
    {
      label: '照片原图（里面那串标记）',
      kind: 'text',
      value: PHOTO_MARK,
      why: '照片被写进某个容器里了（json、日志、打包文件都算）',
      want: 'absent',
    },
    {
      label: '归一化之后那一份（逐字节 sha256）',
      kind: 'sha',
      value: sha256(run.normalized),
      why: '送出去的那一份被顺手存下来了',
      want: 'absent',
    },
    {
      label: '归一化之后那一份（base64 头一段）',
      kind: 'text',
      value: b64(run.normalized).slice(0, 64),
      why: '请求体（data URL）被记进过某个文件',
      want: 'absent',
    },
    {
      label: '录音样本（里面那串标记）',
      kind: 'text',
      value: VOICE_MARK,
      why: '样本被写下来了',
      want: 'absent',
    },
    {
      label: '录音样本（base64 头一段）',
      kind: 'text',
      value: b64(voice.sample).slice(0, 64),
      why: '发往厂商的那段 base64 被记进过某个文件',
      want: 'absent',
    },
    {
      label: '假厂商画的那张形象（标记）',
      kind: 'text',
      value: DRAW_MARK,
      why: '★ 这一条是**对照**：它必须命中，否则说明这次搜索本身没生效',
      want: 'present',
    },
  ]

  const report = await sweep([ROOT, run.root], needles)
  line('')
  line(`搜索 · 范围 工作区 ${ROOT} ＋ 临时资产根 ${run.root}`)
  line(
    `       扫了 ${report.files} 个文件${report.skippedBig > 0 ? `（另有 ${report.skippedBig} 个超过 32MB 的没读）` : ''}`,
  )
  line(
    `       跳过：${[...SKIP_DIRS].join(' / ')} 与 .out/chrome-*（无头浏览器用户档，不是产品存东西的地方）`,
  )

  const misses: string[] = []
  const leaks: Hit[] = []
  for (const needle of needles) {
    const hits = report.hits.filter((hit) => hit.needle.label === needle.label)
    const verdict =
      needle.want === 'present' ? (hits.length > 0 ? '✓' : '★') : hits.length === 0 ? '✓' : '★'
    line(`  ${verdict} ${needle.label}：命中 ${hits.length} 次`)
    if (needle.want === 'present' && hits.length === 0) {
      misses.push(needle.label)
      line('      —— 对照针没中：**这一次搜索没有判别力**，下面的"0 次"不算数')
    }
    if (needle.want === 'absent' && hits.length > 0) leaks.push(...hits)
  }
  for (const hit of leaks.slice(0, 20)) {
    line(`      ★ ${hit.file} · 第 ${hit.at} 字节处（${hit.needle.why}）`)
  }
  if (leaks.length > 20) line(`      …… 另有 ${leaks.length - 20} 处`)

  /* 段 3 · 认领 */
  const assetRoot = process.env['ASSET_ROOT']?.trim() || join(ROOT, '.out', 'web')
  line('')
  line(`段 3 · 资产根里每一个媒体文件都要能被认领：${assetRoot}`)
  const assetClaim = await claimAssetRoot(assetRoot, true)
  const tempClaim = await claimAssetRoot(run.root, true)
  for (const [name, claim] of [
    ['运行期资产根', assetClaim],
    ['这一轮的临时根', tempClaim],
  ] as const) {
    line(
      `  ${claim.bad.length === 0 ? '✓' : '★'} ${name}：媒体文件 ${claim.media} 个，认领不了 ${claim.bad.length} 个`,
    )
    const byRule = new Map<string, number>()
    for (const one of claim.ok) byRule.set(one.what, (byRule.get(one.what) ?? 0) + 1)
    for (const [what, count] of [...byRule].sort((a, b) => b[1] - a[1])) {
      line(`      · ${what}：${count} 个`)
    }
    for (const one of claim.bad.slice(0, 20)) {
      line(`      ★ ${one.file}（${one.size} 字节）—— 没有任何一条规则认领它`)
    }
  }

  /**
   * `public/` 那一半用另一条判据：那里的媒体必须是**入库的源资产**。
   * 它比"路径像不像"强，因为入库这件事本身就是一次人做的决定，
   *   而运行期产物（用户的东西）永远不该出现在那里。
   */
  line('')
  line('段 3b · `public/` 里的媒体必须是入库的源资产（不是任何一次运行写出来的）')
  const tracked = new Set(
    execFileSync('git', ['ls-files', 'public'], { cwd: ROOT, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter((one) => one !== ''),
  )
  const publicFiles: string[] = []
  await walk(join(ROOT, 'public'), publicFiles)
  const untracked = publicFiles
    .filter((file) => MEDIA_EXT.has(file.slice(file.lastIndexOf('.')).toLowerCase()))
    .map((file) => relative(ROOT, file).split(sep).join('/'))
    .filter((file) => !tracked.has(file))
  line(
    `  ${untracked.length === 0 ? '✓' : '★'} public 下媒体 ${publicFiles.length} 个文件，没入库的 ${untracked.length} 个`,
  )
  for (const one of untracked.slice(0, 20)) line(`      ★ ${one}`)

  /* 汇总 */
  const red =
    !photoHitSelf ||
    !drawHitSelf ||
    !sampleHitSelf ||
    !vendorGotSample ||
    leaks.length > 0 ||
    misses.length > 0 ||
    assetClaim.bad.length > 0 ||
    tempClaim.bad.length > 0 ||
    untracked.length > 0

  line('')
  line('='.repeat(72))
  if (red) {
    line('★ 有红的。上面每一条前面带 ★ 的都点名了指什么。')
    process.exitCode = 1
    return
  }
  line('全部通过：照片原图与录音样本在盘上一次都没出现，而两条对照针都命中了。')
  /**
   * ★ 这句话是这份自查的边界，写在通过之后，不是写在注释里就完事：
   *   它证的是"这一段代码跑过之后盘上没有"，不是"整条 HTTP 路都干净"。
   */
  line('它证不到的：这一段走的是 `cardFromPhoto` 与适配器的 `clone`，不含路由那一层')
  line('（`await req.formData()` / `requireCapability`）——那两段由单测与路由用例管。')
}

try {
  await main()
} finally {
  // 临时根逐个删（`main` 里那个根在 `run` 里创建，退出前不留）
  const leftovers = await readdir(tmpdir()).catch(() => [] as string[])
  for (const name of leftovers) {
    if (name.startsWith('xzj-family-check-')) {
      await rm(join(tmpdir(), name), { recursive: true, force: true }).catch(() => {})
    }
  }
}
