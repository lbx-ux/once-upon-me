/**
 * /api/cards/revise —— 「再画一版」：拿上一版形象当参考图，按家长那句话重画一张
 *
 * 这一条是 Request 3(a) 里最后那句「根据刚才生成的插画进行建议」的落地，
 * 也是工单 02 那条 `edits` 通路到目前为止唯一真正的消费方。
 *
 * 三条设计决定，每条都对应一个具体的坏法：
 *
 * 1. 参考图必须过 `normalizeReference`，不能把卡里那张直接送出去。
 *    这一条不是"以防万一"，是实测出来会撞的：上一版如果本身就是 `edits` 的产物，
 *    它是 4 通道带 alpha 的 PNG（工单 02 §四 量到的，两次都是），而接口
 *    明说不收带 alpha 的 PNG（`IMAGE_INPUT_ALPHA_UNSUPPORTED`）。
 *    所以"第一版能改、改出来的第二版改不动"是一个真实的坏法，不是假想。
 * 2. 锚点一个字都不改。 那句话进 `provenance.suggestion`，不进 `anchors`——
 *    锚点的不变式是"跨页不变"，而"眼睛再大一点"只属于这一版。
 * 3. 归档 = 新 revision，不是覆盖（ADR-0007）。旧书的那些页仍然指着旧版。
 *
 * 这一版不自动判"这条建议被采纳了吗"，理由是具体的：
 *   现有的比对器问的是"图上有没有这几条锚点"（`checklistOf`），
 *   而这次动的正是锚点管的那些部位——"眼睛再大一点"会让锚点清单里的
 *   "深棕色圆眼"判不像，于是成功会被判成失败。
 *   要自动判，需要的是"两张图 + 一句判据"这个新的比对形态，那是另一件事。
 *   所以界面上是把新旧两版并排给家长看（人判），而不是贴一句"AI 会尽力理解"。
 */

import type { NextRequest } from 'next/server'
import {
  characterSheetPrompt,
  ageLabelOf,
  CHARACTER_REVISE_VERSION,
} from '@/lib/prompts/character-sheet.ts'
import { assetRoot } from '@/lib/books-runtime.ts'
import { createCardStore, promptFragmentOf } from '@/lib/engine/index.ts'
import { reviewInput, reviewInputText } from '@/lib/engine/review.ts'
// 直接取图像那一个，不用 `createProviders`：那一个会把文本/视觉/语音一起建起来，
//   于是"没填文本模型"会让"再画一版"报一句"还差：文本模型名"——而这件活根本不用文本模型。
//   一个按组构造的适配器工厂，就该按组用（同样的用法在 /api/settings/probe 里）。
import { imageProviderOf } from '@/lib/engine/providers/registry.ts'
import { normalizeReference, referenceDataUrlOf } from '@/lib/engine/image/normalize.ts'
import { userFailureOf } from '@/lib/provider-messages.ts'
import { requireCapability } from '@/lib/auth/session.ts'
import { createUserStore } from '@/lib/asset-scope.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 与建卡同一档方形。★ 但 `edits` 那条路没有 size 字段，实际回来的是 1024²（工单 02 实测） */
const SHEET_SIZE = '1440x1440'

type Body = {
  childId: string
  /** 孩子的名字/读音只用于提示词里那句称呼，档案才是它的出处 */
  name: string
  ageBand: string
  suggestion: string
}

function parseBody(raw: unknown): { body?: Body; problems: string[] } {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { problems: ['请求体要是一个 JSON 对象'] }
  }
  const source = raw as Record<string, unknown>
  const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

  const childId = str(source['childId'])
  if (!childId) problems.push('childId 缺失（没有它就不知道该改谁的哪张卡）')
  const suggestion = str(source['suggestion'])
  // 空建议不收：那等于"再画一张一样的"，而这一版是按次计费的。要重画请说明改哪里
  if (suggestion === '') problems.push('还没写想改哪里——空着点一次就是按原样重画一张，白花钱')
  if (suggestion.length > 200) problems.push('想改的地方写短一点（200 字以内）')

  /**
   * 内容闸（2026-10-20）。这一格与单页重画那句 `fixNote`（`lib/rerun-api.ts`）
   *   是同一类：家长手输、原样进图像提示词（`prompts/character-sheet.ts` 的
   *   `revisionNote` 那一段）、而两道文字闸都不经过——它不写进故事（躲过 `reviewStory`），
   *   也不是开书时的表单（躲过 `reviewInput`）。补上之前，一句"改成脸上有血"在这条路上
   *   没有任何东西拦得住，唯一的事后拦截是那一档不可复现的画面审核。
   *   ★ 处置与另外两处同一条口径：拒发（`review.ts` 文件头那句"这是别人的话，
   *   没有'我们替你重写一版'这条路"）。用的是同一份条款库，所以家长在不同入口
   *   撞到的是同一套词表、同一句措辞。
   */
  if (suggestion !== '') {
    const review = reviewInput([{ label: '想改的地方', text: suggestion }])
    if (review.verdict !== 'pass') {
      problems.push(`${review.problems.map(reviewInputText).join('；')}。改一下再来`)
    }
  }

  if (problems.length > 0) return { problems }
  return {
    problems: [],
    body: {
      childId,
      name: str(source['name']) || '孩子',
      ageBand: str(source['ageBand']) || '4-6',
      suggestion,
    },
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  // 改一版卡也是一次图像生成，所以只要图像这一个能力——与 `/api/cards` 同一条口径
  const guard = await requireCapability(req, ['image'])
  if (!guard.ok) return guard.response

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
  const store = await createUserStore(root, guard.session.userId)
  const cardStore = createCardStore(store)

  // 改的是"这个孩子现在的形象"。没有形象就没有可改的上一版——这条要明说，
  // 不能让界面自己去猜（它会猜成"生成失败"）
  const previous = await cardStore.latestForChild(body.childId)
  if (!previous) {
    return Response.json(
      {
        code: 'card-not-found',
        message: `还没给${body.name}出过形象，没有可以改的上一版。先出一张再来提建议。`,
      },
      { status: 404 },
    )
  }

  const rawBytes = await store.read(previous.reference.path)
  if (!rawBytes) {
    return Response.json(
      {
        code: 'asset-missing',
        message: `上一版形象的文件不在了（${previous.reference.path}），这一版没法以它为底。`,
      },
      { status: 500 },
    )
  }

  let image
  try {
    image = imageProviderOf(serverEnv())
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }

  const edit = image.edit
  if (typeof edit !== 'function') {
    // 能力与策略分开（工单 02）：这家没有 edit 就没法按建议改，而不是"画一张新的顶上"
    return Response.json(
      {
        code: 'reference-invalid',
        message: '当前图像模型不能收参考图，没法在上一版基础上改。换一个模型再试。',
      },
      { status: 400 },
    )
  }

  const prompt = characterSheetPrompt({
    name: body.name,
    childWord: '孩子',
    ageLabel: ageLabelOf(body.ageBand),
    anchors: previous.anchors,
    style: previous.style,
    revisionNote: body.suggestion,
  })

  let generated
  try {
    // 见文件头第 1 条：上一版可能就是带 alpha 的 `edits` 产物，不过这一道会吃 400
    const normalized = await normalizeReference(rawBytes)
    generated = await edit.call(image, {
      prompt,
      size: SHEET_SIZE,
      referenceDataUrl: referenceDataUrlOf(normalized),
    })
  } catch (err) {
    const failure = userFailureOf(err)
    // 失败不改卡：这一版没做成，旧版仍然是旧版（ADR-0007 的"不覆盖"）
    return Response.json(
      {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
        extra: failure.code === 'reference-invalid' ? ['reference'] : undefined,
      },
      { status: failure.status },
    )
  }

  if (generated.referenceApplied !== true) {
    // 与 illustrate.ts 同一条纪律：说了要锁脸却没锁，宁可当场失败也不要静默出一张不像的
    return Response.json(
      {
        code: 'reference-invalid',
        message: '这次请求没把上一版形象带过去，改出来的会是另一个孩子。没有采纳这一版。',
      },
      { status: 502 },
    )
  }

  try {
    const { card } = await cardStore.create({
      cardId: previous.cardId,
      childId: previous.childId,
      // 锚点原样带过去，一个字不改（文件头第 2 条）
      anchors: previous.anchors,
      style: previous.style,
      referenceBytes: generated.bytes,
      referenceMime: generated.mime,
      modelId: generated.modelId,
      promptVersion: CHARACTER_REVISE_VERSION,
      now: Date.now(),
      previous,
      suggestion: body.suggestion,
    })
    return Response.json({
      cardId: card.cardId,
      revision: card.revision,
      // 两版的地址一起回：界面要把它们并排给家长看（这一版不自动判建议，见文件头）
      previousRevision: previous.revision,
      promptFragment: promptFragmentOf(card),
    })
  } catch (err) {
    const failure = userFailureOf(err)
    return Response.json(
      { code: failure.code, message: failure.message, retryable: failure.retryable },
      { status: failure.status },
    )
  }
}
