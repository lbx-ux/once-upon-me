/**
 * /api/cards —— 角色卡的两个动作
 *
 *   GET  /api/cards        已有的卡（「用一张已有的卡」这一步的数据源）
 *   POST /api/cards        由锚点出一张参考图，固化成卡（第 3 步）
 *
 * POST 一次调用做三件事：出图 → 建卡（含内容寻址落盘）→ 回一张能直接显示的地址。
 * 合成一次而不是分两步，是因为"图出了但卡没建成"的中间态没有任何意义——
 * 家长要的是"这就是我孩子的形象"，不是一张游离的图。
 *
 * ★ **不做 3–4 张候选**（用户 10/13 定的档）：一次出一张，不满意就再点一次。
 *   重出就是按需的候选，比一次给四张更省，也比一次给四张更贴近真实的挑选过程。
 * ★ **不收照片**：图像接口不支持参考图（实测 7 个候选字段名全被 400 挡回），
 *   传上来的照片没有消费方。没有消费方的输入框就是假装。
 * ★ 密钥走 per-request `Env`（ADR-0008），与 `/api/books` 同一个约定：
 *   请求体里那张表说了算，服务端的 `process.env` 不参与。
 *
 * GET 那条兑现的是 ADR-0007 的**可复用**：上一版第 3 步只有"出一张形象"，
 * 于是每做一本书都要重新出一张脸——那正好把"可复用"做没了。
 */

import {
  cardDigest,
  checklistOf,
  createCardStore,
  createFsStore,
  createProviders,
  promptFragmentOf,
  validateCard,
  type AnchorSlot,
  type CharacterAnchor,
} from '@/lib/engine/index.ts'
import {
  ageLabelOf,
  characterSheetPrompt,
  DEFAULT_STYLE_FRAGMENT,
} from '@/lib/prompts/character-sheet.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { assetUrlOf } from '@/lib/asset-url.ts'
import { listCardItems } from '@/lib/cards-list.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 出图尺寸与页内插画同一档（方形）。标准像与页内形象同比例，家长看到的就是书里的样子 */
const SHEET_SIZE = '1440x1440'

/* ───────────────────────── GET：已有的卡 ───────────────────────── */

export async function GET(): Promise<Response> {
  // ★ 取数在 `lib/cards-list.ts`，与工作台「小主角」选择器、角色页同一份实现：
  //   "同 cardId 只留最新一版"这条是 ADR-0007 的 revision 语义，不该有三份
  return Response.json({ cards: await listCardItems() })
}

/* ───────────────────────── POST：出一张形象 ───────────────────────── */

type Body = {
  childId: string
  name: string
  ageBand: string
  childWord?: string
  anchors: CharacterAnchor[]
  env: Record<string, string | undefined>
  /** 换一版：带上已有卡号，引擎会叠一个新 revision 而不是覆盖 */
  cardId?: string
}

function parseBody(raw: unknown): { body?: Body; problems: string[] } {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { problems: ['请求体要是一个 JSON 对象'] }
  }
  const source = raw as Record<string, unknown>
  const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

  const childId = str(source['childId'])
  if (!childId) problems.push('childId 缺失（表单层要生成它）')
  const name = str(source['name'])
  if (!name) problems.push('孩子的名字没填')

  const anchorsRaw = Array.isArray(source['anchors']) ? source['anchors'] : []
  const anchors: CharacterAnchor[] = []
  for (const item of anchorsRaw) {
    if (!item || typeof item !== 'object') continue
    const slot = str((item as Record<string, unknown>)['slot'])
    const value = str((item as Record<string, unknown>)['value'])
    if (value === '') continue
    anchors.push({ slot: slot as AnchorSlot, value })
  }
  if (anchors.length === 0) problems.push('一条外貌锚点都没有——没有锚点就没有一致性可言')

  const envRaw = source['env']
  const env: Record<string, string | undefined> = {}
  if (envRaw && typeof envRaw === 'object' && !Array.isArray(envRaw)) {
    for (const [key, value] of Object.entries(envRaw as Record<string, unknown>)) {
      if (typeof value === 'string') env[key] = value
    }
  }

  if (problems.length > 0) return { problems }
  return {
    problems: [],
    body: {
      childId,
      name,
      ageBand: str(source['ageBand']) || '4-6',
      childWord: str(source['childWord']) || '孩子',
      anchors,
      env,
      ...(str(source['cardId']) === '' ? {} : { cardId: str(source['cardId']) }),
    },
  }
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ code: 'bad-json', message: '请求体不是合法的 JSON' }, { status: 400 })
  }

  const { body, problems } = parseBody(raw)
  if (!body) {
    return Response.json(
      { code: 'invalid-request', message: problems.join('；'), extra: problems },
      { status: 400 },
    )
  }

  const root = assetRoot()
  const store = await createFsStore(root)
  const cardStore = createCardStore(store)

  let providers
  try {
    providers = await createProviders({ env: body.env, mode: 'live', assetRoot: root, store })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }

  const prompt = characterSheetPrompt({
    name: body.name,
    childWord: body.childWord ?? '孩子',
    ageLabel: ageLabelOf(body.ageBand),
    anchors: body.anchors,
  })

  let generated
  try {
    generated = await providers.image.generate({ prompt, size: SHEET_SIZE })
  } catch (err) {
    const failure = userFailureOf(err)
    // 出图失败**不改卡**：这一版没做成，旧版仍然是旧版（ADR-0007 的"不覆盖"）
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }

  // 卡号：给回了卡号就在它上面叠一版，没有就用 <childId>-sheet 新建。
  // ★ 不含时间戳：同一份锚点重出必须落在同一张卡上，否则每次重出都长出一张新卡，
  //   "跨书复用同一张卡"变成了"每次都是新孩子"。
  const cardId = body.cardId ?? `${body.childId}-sheet`
  const previous = body.cardId ? await cardStore.latest(body.cardId) : null
  if (body.cardId && !previous) {
    return Response.json(
      { code: 'card-not-found', message: `找不到角色卡 ${body.cardId}，换一版要基于已有的卡` },
      { status: 404 },
    )
  }

  try {
    const { card } = await cardStore.create({
      cardId,
      childId: body.childId,
      anchors: body.anchors,
      style: {
        key: 'warm-handdrawn',
        promptFragment: DEFAULT_STYLE_FRAGMENT,
        ratio: '1:1',
      },
      referenceBytes: generated.bytes,
      referenceMime: generated.mime,
      modelId: generated.modelId,
      promptVersion: 'character-sheet@v1',
      now: Date.now(),
      // 「换一版」= 新 revision，不覆盖旧版（ADR-0007）
      ...(previous ? { previous } : {}),
    })
    const problemsAfter = validateCard(card)
    if (problemsAfter.length > 0) {
      return Response.json(
        { code: 'card-invalid', message: `角色卡不合格：${problemsAfter.join('；')}` },
        { status: 400 },
      )
    }
    return Response.json({
      cardId: card.cardId,
      revision: card.revision,
      digest: cardDigest(card),
      referenceUrl: assetUrlOf(card.reference.path),
      // 同一份锚点的两种用法，一起回给界面（ADR-0007：画的时候按 A 画、查的时候按 B 查）
      promptFragment: promptFragmentOf(card),
      checklist: checklistOf(card),
      modelId: generated.modelId,
    })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}
