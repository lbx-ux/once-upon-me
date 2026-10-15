/**
 * e2e-new-child.mts —— 「新建一个小主角」那两条路，各真跑一次（工单 03 第二刀）
 *
 * ```bash
 * node scripts/e2e-new-child.mts --mode=photo --keep=1
 * node scripts/e2e-new-child.mts --mode=describe      # 从零描述那条
 * node scripts/e2e-new-child.mts                      # 默认 photo，跑完连档案一起删
 * ```
 *
 * 两条路都走**跑着的 dev server**：先 `POST /api/children` 建档案，再出形象——
 * 照片那条走 `POST /api/cards/photo`（multipart），从零描述那条走 `POST /api/cards`（JSON）。
 * 界面按下去走的就是这两组 HTTP 路，所以"路由收不收得下 multipart""同意怎么传"
 * "错误映射成几"这几件事都在量程之内。
 *
 * ★ 从零描述那条还顺手量了**一次不花钱的拒绝**：锚点里带页级词（「笑」）时，
 *   它必须在**调模型之前**就被挡下来。判据是耗时——400 若在几百毫秒内回来，
 *   说明一次图像调用都没发生（真调一次是十秒级）。这条是 2026-10-15 修的一个真 bug：
 *   `DEFAULT_ANCHORS` 的 mark 那一格曾经带着「笑」，家长不动它直接点生成，
 *   每一次都白花一次出图钱（见 `src/lib/creation/default-anchors.test.ts`）。
 *
 * ## ★ 照片那条送的不是真照片，而且这一点必须写在结论里
 *
 * 送进去的是一张**合成图**（`--photo=<路径>` 可以换掉它，但那要你自己放一张；
 * 我不会往这台机器上放任何未成年人的照片，也不会从网上拉一张）。
 * 所以这一跑能证明的是：**通路**是通的（尺寸、EXIF 方向、alpha、上限、落盘、清理），
 * 不能证明的是：**画出来的像不像那个孩子**——那要一张真照片，而"像不像"只能人看。
 * 这两件事在报告里必须分开写，混起来的症状是把"路是通的"读成"效果是好的"。
 *
 * ## 它顺手做的两件审计（这两条是这一刀的重点）
 *
 * 1. **跑完扫一遍整个资产根，找照片里那段标记**。找不到才叫"原图不落盘"——
 *    单元测试盯的是"store 收到了什么"，这里盯的是**磁盘上真的有没有**。
 * 2. **卡上的参考图是模型画的那张**（尺寸是模型的出图尺寸），且 `sourcePhoto` 只留两个时间戳。
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import sharp from 'sharp'

import { DEFAULT_ANCHORS } from '../src/lib/creation/default-anchors.ts'
import { arg, readEnv } from './env.mts'

type Row = [what: string, value: string]

const BASE = arg('base', 'http://localhost:3000')
const ROOT = resolve(arg('out', '.out/web'))
const MODE = arg('mode', 'photo') === 'describe' ? 'describe' : 'photo'
const KEEP = arg('keep', '') === '1'
const GIVEN_PHOTO = arg('photo', '')
const MARKER = 'PHOTO-MARKER-e2e-DO-NOT-STORE'
const TMP = resolve('.out/e2e-photo')

function table(rows: readonly Row[]): string {
  const width = Math.max(...rows.map(([what]) => [...what].length))
  return rows
    .map(([what, value]) => `  ${what}${' '.repeat(width - [...what].length)}  ${value}`)
    .join('\n')
}

/** 造一张"手机照片"：大、横着存、带 EXIF 方向 6（即"要转 90° 看才对"） */
async function makePhoto(): Promise<{ bytes: Uint8Array; note: string }> {
  if (GIVEN_PHOTO !== '') {
    return {
      bytes: new Uint8Array(await readFile(resolve(GIVEN_PHOTO))),
      note: `你给的：${GIVEN_PHOTO}`,
    }
  }
  const base = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: { r: 214, g: 176, b: 148 } },
  })
    .composite([
      // 两个色块：不是为了"像个人"，是为了让这张图和它归一化之后的版本
      // 在肉眼上就能分辨（万一哪一处把它写下去了，扫一眼就看得出来）
      {
        input: { create: { width: 900, height: 700, channels: 3, background: '#8a2b2b' } },
        top: 200,
        left: 300,
      },
      {
        input: { create: { width: 700, height: 900, channels: 3, background: '#23406b' } },
        top: 800,
        left: 1700,
      },
    ])
    .jpeg({ quality: 92 })
    .withMetadata({ orientation: 6 })
    .toBuffer()
  return {
    bytes: new Uint8Array(Buffer.concat([base, Buffer.from(MARKER, 'utf8')])),
    note: '合成的一张 3000×2000 JPEG，带 EXIF 方向 6（横着存、要转 90° 才正）',
  }
}

/** 资产根下每个文件的字节全扫一遍，找那段标记。这就是"原图不落盘"的现场判据 */
async function scanForMarker(
  dir: string,
): Promise<{ hits: string[]; files: number; bytes: number }> {
  const hits: string[] = []
  let files = 0
  let bytes = 0
  const needle = Buffer.from(MARKER, 'utf8')
  async function walk(current: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(current)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(current, name)
      const info = await stat(full)
      if (info.isDirectory()) {
        await walk(full)
        continue
      }
      files += 1
      bytes += info.size
      // 大文件只读前 512 KB：标记贴在文件末尾，而这些文件都是几 MB 的图；
      // 读尾巴而不是读头，见下面那一行
      const data = await readFile(full)
      if (data.includes(needle)) hits.push(full)
    }
  }
  await walk(dir)
  return { hits, files, bytes }
}

async function main(): Promise<void> {
  const env = await readEnv()
  const rows: Row[] = []
  const imageEnv: Record<string, string> = {}
  for (const key of ['IMAGE_BASE_URL', 'IMAGE_API_KEY', 'IMAGE_MODEL']) {
    const value = env[key]
    if (value) imageEnv[key] = value
  }
  if (!imageEnv['IMAGE_API_KEY']) {
    console.log('\nIMAGE_API_KEY 未配置，一个请求都没发。\n')
    process.exitCode = 1
    return
  }

  const photo = await makePhoto()
  rows.push(['跑的是哪条路', MODE === 'photo' ? '用他的照片' : '从零描述'])
  if (MODE === 'photo') {
    rows.push([
      '送进去的"照片"',
      `${photo.note}（${(photo.bytes.length / 1024 / 1024).toFixed(2)} MB）`,
    ])
  }
  rows.push(['送了几组 env', `${Object.keys(imageEnv).length} 个键（只有 IMAGE_*）`])

  // ── ① 建档案 ───────────────────────────────────────────────────────────────
  const profileStart = performance.now()
  const profileResponse = await fetch(`${BASE}/api/children`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: '探针',
      nameReading: 'tàn zhēn',
      ageBand: '4-6',
      lookTags: ['圆脸', '小酒窝'],
      interestTags: ['小猫'],
    }),
  })
  const profileMs = performance.now() - profileStart
  const profile = (await profileResponse.json()) as { childId?: string; message?: string }
  rows.push([
    '① POST /api/children',
    `${profileResponse.status} · ${profileMs.toFixed(0)} ms · childId=${profile.childId ?? '-'}`,
  ])
  if (!profileResponse.ok || !profile.childId) {
    rows.push(['它说了什么', profile.message ?? '（没有 message）'])
    console.log(`\n建档案就失败了，后面的没跑。\n\n${table(rows)}\n`)
    process.exitCode = 1
    return
  }
  const childId = profile.childId

  // ── ①之半：一次**不该花钱**的拒绝（只跑从零描述那条） ────────────────────────
  // 锚点里带页级词（「笑」）必须在调模型之前被挡下来。判据是**耗时**：
  // 真调一次图像接口是十秒级，而这里若在几百毫秒内回来，说明一次都没发生
  if (MODE === 'describe') {
    const bad = DEFAULT_ANCHORS.map((anchor) =>
      anchor.slot === 'mark' ? { ...anchor, value: '笑起来右脸颊有一个小酒窝' } : anchor,
    )
    const t0 = performance.now()
    const rejected = await fetch(`${BASE}/api/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        childId,
        name: '探针',
        ageBand: '4-6',
        anchors: bad,
        env: imageEnv,
      }),
    })
    const rejectMs = performance.now() - t0
    const body = (await rejected.json()) as { message?: string }
    rows.push([
      '★ 页级词锚点（不花钱的那次拒绝）',
      `${rejected.status} · ${rejectMs.toFixed(0)} ms · ${String(body.message ?? '').split('\n')[0]}`,
    ])
  }

  // ── ② 出形象 ───────────────────────────────────────────────────────────────
  // ★ 用的是仓库里那份**预填锚点**（`DEFAULT_ANCHORS`）：它是家长不填时的真实输入，
  //   所以"预填能不能过校验"这件事应该在真跑里被验一遍，而不是只靠单元测试
  const anchors = [...DEFAULT_ANCHORS]
  const started = performance.now()
  const response =
    MODE === 'photo'
      ? await postPhoto(childId, anchors, imageEnv, photo.bytes)
      : await postDescribe(childId, anchors, imageEnv)
  const ms = performance.now() - started
  const payload = (await response.json()) as {
    cardId?: string
    revision?: number
    referenceUrl?: string
    processed?: { notes?: string[]; width?: number; height?: number }
    message?: string
  }
  rows.push([
    `★ ② POST ${MODE === 'photo' ? '/api/cards/photo' : '/api/cards'}`,
    `${response.status} · ${ms.toFixed(0)} ms`,
  ])
  if (!response.ok) {
    rows.push(['它说了什么', payload.message ?? '（没有 message）'])
  } else {
    if (MODE === 'photo') {
      rows.push([
        '归一化做了什么',
        (payload.processed?.notes ?? []).join(' / ') || '（一条都没有）',
      ])
      rows.push([
        '归一化之后多大',
        `${payload.processed?.width ?? '?'}×${payload.processed?.height ?? '?'}`,
      ])
    }
    rows.push(['图的地址回来了', payload.referenceUrl ?? '**没有**'])
  }

  // ── ③ 审计：磁盘上到底有没有那张照片 ────────────────────────────────────────
  const scan = await scanForMarker(ROOT)
  rows.push([
    '★ 扫整个资产根找照片标记',
    scan.hits.length === 0
      ? `没有 ✓（扫了 ${scan.files} 个文件、${(scan.bytes / 1024 / 1024).toFixed(1)} MB）`
      : `**找到了 ${scan.hits.length} 处：${scan.hits.join('、')}**`,
  ])

  // ── ④ 审计：存进卡里的是模型画的那张，不是照片 ──────────────────────────────
  const cardDir = join(ROOT, 'cards', `${childId}-sheet`)
  try {
    const names = await readdir(cardDir)
    const refs = names.filter((name) => name.startsWith('ref.'))
    for (const name of refs) {
      const info = await stat(join(cardDir, name))
      const meta = await sharp(join(cardDir, name)).metadata()
      rows.push([
        `参考图 ${name}`,
        `${meta.width}×${meta.height} · ${meta.channels} 通道 · ${(info.size / 1024).toFixed(0)} KB`,
      ])
    }
    const cardName = names.find((name) => name.endsWith('.json'))
    if (cardName) {
      const card = JSON.parse(await readFile(join(cardDir, cardName), 'utf8')) as {
        sourcePhoto?: { usedAt?: number; deletedAt?: number }
        provenance?: { promptVersion?: string }
      }
      rows.push([
        '卡上的 sourcePhoto',
        // ★ 只有照片那条路该有它。从零描述那条**不该有**——有的话就是给"这张卡
        //   来自一张照片"背书，而那张照片从来不存在
        MODE === 'photo'
          ? card.sourcePhoto
            ? `usedAt/deletedAt 都在 ✓（${new Date(card.sourcePhoto.usedAt ?? 0).toISOString()}）`
            : '**没有！这一版应该记下"照片存在过"**'
          : card.sourcePhoto
            ? '**有！但这条路没有用过任何照片**'
            : '没有 ✓（这条路没用过照片）',
      ])
      rows.push(['provenance.promptVersion', card.provenance?.promptVersion ?? '-'])
    }
  } catch {
    rows.push(['卡的目录', `读不到：${cardDir}`])
  }

  // 那张合成照片留一份在 .out 里方便比对，跑完删（--keep=1 时不删）
  if (MODE === 'photo') {
    await mkdir(TMP, { recursive: true })
    await writeFile(join(TMP, 'input.jpg'), photo.bytes)
  }

  console.log(
    `\n新建一个小主角 · 真跑一次（${MODE === 'photo' ? '用他的照片' : '从零描述'}）\n\n${table(rows)}\n`,
  )
  console.log(
    KEEP
      ? `探针留着（--keep=1）：打开 ${BASE}/character/${childId} 看形象。\n`
      : '探针与临时文件已经删掉。\n',
  )

  if (!KEEP) {
    await rm(cardDir, { recursive: true, force: true })
    await rm(join(ROOT, 'children', `${childId}.json`), { force: true })
    await rm(TMP, { recursive: true, force: true })
  }
}

/** 从零描述那条：JSON + anchor 表 */
async function postDescribe(
  childId: string,
  anchors: unknown,
  env: Record<string, string>,
): Promise<Response> {
  return fetch(`${BASE}/api/cards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      childId,
      name: '探针',
      ageBand: '4-6',
      childWord: '孩子',
      anchors,
      env,
    }),
  })
}

/** 用他的照片那条：multipart */
async function postPhoto(
  childId: string,
  anchors: unknown,
  env: Record<string, string>,
  bytes: Uint8Array,
): Promise<Response> {
  const form = new FormData()
  form.set('childId', childId)
  form.set('name', '探针')
  form.set('ageBand', '4-6')
  form.set('childWord', '孩子')
  form.set('anchors', JSON.stringify(anchors))
  form.set('consent', 'true')
  form.set('env', JSON.stringify(env))
  form.set('photo', new Blob([bytes], { type: 'image/jpeg' }), 'probe.jpg')
  return fetch(`${BASE}/api/cards/photo`, { method: 'POST', body: form })
}

await main()
