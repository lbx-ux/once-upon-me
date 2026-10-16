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
 * ★ **不收照片**，但理由换了（原来那句是错的，见下）。
 *   旧理由是"图像接口不支持参考图（实测 7 个候选字段名全被 400 挡回）"——
 *   那句话只在 `/images/generations` 这条路上成立。同一家另有一条 `/images/edits`
 *   是**通的**（2026-10-14 实测，见工单 02 §一）。
 *   现在不收照片的理由是**照片还没有消费方**：卡上的参考图既要用来逐页画
 *   （`edit`），又要用来比对（`vision.compare`）。拿照片当参考图，第二件事是
 *   拿**照片**比**插画**——与 ADR-0007 验过的那次（插画比插画）不是同一个任务，
 *   **没量过**。没有消费方的输入框就是假装，所以这一格继续空着，
 *   等工单 03 把"照片 → 卡"这条链连同比对一起量出来再开。
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
  promptFragmentOf,
  validateCard,
  type AnchorSlot,
  type CharacterAnchor,
} from '@/lib/engine/index.ts'
import { imageProviderOf } from '@/lib/engine/providers/registry.ts'
import {
  ageLabelOf,
  CHARACTER_SHEET_VERSION,
  characterSheetPrompt,
  DEFAULT_CARD_STYLE,
} from '@/lib/prompts/character-sheet.ts'
import { whitened } from '@/lib/whiten-backdrop.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { assetUrlOf } from '@/lib/asset-url.ts'
import { EngineError } from '@/lib/engine/errors.ts'
import { checkAnchors } from '@/lib/engine/character-card/card.ts'
import { listCardItems } from '@/lib/cards-list.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 失败一律走这里：文案、可重试性、状态码三件一起算（`userFailureOf` 是唯一那处判据） */
function failureResponse(err: unknown): Response {
  const failure = userFailureOf(err)
  return Response.json(
    { code: failure.code, message: failure.message, retryable: failure.retryable },
    { status: failure.status },
  )
}

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

  // ★ 锚点先校验一次，**必须在出图之前**。
  //   `cardStore.create` 里（`buildCard`）也会校验，但它跑在出图**之后**——
  //   于是"锚点不合格"的真实代价是：先花掉一次出图的钱，再收到一句"角色卡不合格"，
  //   而卡没建成。这不是假想的：`DEFAULT_ANCHORS` 的 mark 那一格曾经带「笑」
  //   （页级词），家长不动那一格直接点生成，**每一次都白花一次钱**（2026-10-15 实测，
  //   见 `lib/creation/default-anchors.test.ts`）。一句话的检查换掉一次白花的调用。
  // ★ 码用 `card-invalid` 而不是 `invalid-request`：它翻出来的那句是
  //   "回到第 3 步改那几条被标出来的锚点"，而这正是这里该说的事
  const anchorProblems = checkAnchors(body.anchors)
  if (anchorProblems.length > 0) {
    return failureResponse(
      new EngineError('card-invalid', `角色卡锚点不完整：${anchorProblems.join('；')}`),
    )
  }

  // ★ 直接取**图像**那一个，不用 `createProviders`（2026-10-15 修，与 `/api/cards/revise`、
  //   `/api/cards/photo` 对齐）。
  //
  //   原来这里是 `createProviders({...})`——那是全都要：文本、图像、视觉、语音缺一项就抛。
  //   于是**这一条路只用到图像接口，却会因为"没填文本模型"整条跑不起来**，
  //   而家长拿到的是一句"模型与密钥没配全，这一轮跑不起来"。
  //   实测到的现场：只配了 IMAGE_* 去跑 `/api/cards`，回 502 +
  //   `LLM_API_KEY 未配置`——一件与出形象毫无关系的事。
  //   按组构造的工厂就该按组用（同一个用法在 `/api/settings/probe` 里）。
  let image
  try {
    image = imageProviderOf(body.env)
  } catch (err) {
    return failureResponse(err)
  }

  const prompt = characterSheetPrompt({
    name: body.name,
    childWord: body.childWord ?? '孩子',
    ageLabel: ageLabelOf(body.ageBand),
    anchors: body.anchors,
  })

  let generated
  try {
    // ★ 出图之后把底刷成纯白（2026-10-16 第 23 刀）：模型逼不到 #FFFFFF，
    //   而卡片墙上一排三张必须同一种底，理由与量法写在 `whiten-backdrop.ts` 文件头
    generated = await whitened(await image.generate({ prompt, size: SHEET_SIZE }))
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
      // ★ 这一份画风从 `character-sheet.ts` 来，不在这里就地写字面量：
      //   建卡的路有两条了（工单 03 加了"用他的照片"那条），两份字面量会安静地漂
      style: DEFAULT_CARD_STYLE,
      referenceBytes: generated.bytes,
      referenceMime: generated.mime,
      modelId: generated.modelId,
      // ★ 版本号也从那个文件取（2026-10-16 第 21 刀）。这一行原来是**写死的字面量**
      //   `'character-sheet@v1'`——上面那句"不在这里就地写字面量"当时只管着 `style`，
      //   而版本号正是同一类东西：提示词改到 `@v2`（背景改白底）的那一次，
      //   卡上照旧会被盖上 `@v1`，于是"这张图是哪份提示词出的"答出来是错的。
      promptVersion: CHARACTER_SHEET_VERSION,
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
      // ★ 锚点跟着回（工单 03 第 4 刀）。回的是**卡里那份**而不是请求里那份：
      //   建卡时归一化过（去空、按槽位排序），而且"换一版"那条路上生效的也确实是卡里这份。
      //   客户端拿请求值顶上，界面就会显示一份"服务端其实没用"的锚点
      anchors: card.anchors,
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
