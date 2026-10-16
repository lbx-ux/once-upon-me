/**
 * photo-card.ts —— 「用他的照片出一张形象」这条路上**必须在服务端**的那部分（工单 03 第二刀）
 *
 * 判据（`MAX_PHOTO_BYTES` / `PHOTO_CONSENT_POINTS` / `photoProblems`）在
 * `photo-rules.ts`，因为界面也得读得到它们；这里只放两件**只能在这里做的事**：
 * 归一见（要 `sharp`）与建卡（要 store）。
 *
 * ★ 分成"这一层 + 一层薄路由"而不是全写在 `route.ts` 里，理由只有一个但是决定性的：
 * **这一层能被测试，而"照片一个字节都没落盘"这件事必须被测试。**
 * 隐私设计 §七 那一行（"原图不留"）是一句承诺，承诺要么有一条会红的用例撑着，
 * 要么它就只是注释。路由里 `await req.formData()` 那几行没法测，
 * 但"照片进了哪些 `store.put`"可以——所以那件事在这里，deps 进得来。
 *
 * ## 这条路的形状（与"从零描述"那条路的区别）
 *
 * ```
 * 从零描述：锚点 ──generations──▶ 一张插画 ──▶ 卡（参考图 = 那张插画）
 * 用他的照片：锚点 + 照片 ──edits(照片当参考图)──▶ 一张插画 ──▶ 卡（参考图 = 那张插画）
 * ```
 *
 * ★ **两条路存进卡里的都是插画，照片只是第一张插画的输入。** 这一条不是细节，
 *   它把 `/api/cards` 文件头里那个"照片还没有消费方"的死结解开了：卡上的参考图
 *   要用来逐页画、也要用来比对，而比对那条路 ADR-0007 验的是**插画比插画**；
 *   只要照片不成为卡里的参考图，"拿照片比插画"这个没量过的任务就永远不会发生。
 *   于是这一格能开，而不是"先开一个没量过的比对"。
 *
 * ## ★ 三条不许动的东西
 *
 * 1. **照片原图不落盘。** 这个文件里只有一处写字节（`cardStore.create` 的
 *    `referenceBytes: generated.bytes`），而那是**模型画出来的**那一张。
 *   照片的生命全程在内存里：`photo` 参数进 → 归一化 → 当 data URL 送出去 → 出作用域。
 *   想验证就把 `deps.store` 换成一个记账的假 store，看记下来的字节里有没有它
 *    （`photo-card.test.ts` 里就是这么做的）。
 * 2. **没勾同意就不处理。** 判据在 `photoProblems` 里，而它在**归一化之前**被调用——
 *    所以"没同意"的请求里，那些字节连 `sharp` 都没碰到。
 * 3. **照片不进事件流、不进日志。** 这条不是靠"记得别写"，是靠**没有那条路**：
 *    本文件不认识 `event-log.ts`，也不认识 `console`。事件的写入方只有书那条路
 *    （`/api/books`），而它拿到的是卡，卡里只有插画与 `sourcePhoto` 的两个时间戳。
 */

import type { CharacterCard } from './engine/domain.ts'
import { EngineError } from './engine/errors.ts'
import type { CardStore } from './engine/character-card/store.ts'
import { normalizeReference, referenceDataUrlOf } from './engine/image/normalize.ts'
import type { AssetStore, ImageGenerator } from './engine/providers/types.ts'
import {
  ageLabelOf,
  characterSheetPrompt,
  CHARACTER_PHOTO_VERSION,
  DEFAULT_CARD_STYLE,
} from './prompts/character-sheet.ts'
import { photoProblems, type PhotoCardRequest } from './photo-rules.ts'
import { whitened } from './whiten-backdrop.ts'

export type PhotoCardDeps = {
  store: AssetStore
  cardStore: CardStore
  image: ImageGenerator
  /** 测试与审计要能固定时间（同 `buildCard` 的 `now`：同一输入必然得到同一结果） */
  now?: number
}

export type PhotoCardResult = {
  card: CharacterCard
  /** 归一化对这张照片做了什么，逐条人话。界面要把它念给家长听（"我们做了什么"） */
  notes: readonly string[]
  width: number
  height: number
}

/**
 * 照片 → 卡。
 *
 * @throws EngineError(`invalid-request` 的不合格输入由**调用方**先挡，见下)
 * @throws EngineError(`reference-invalid`) 照片打不开 / 短边 < 240 / 太细长 / 这家模型不能收参考图。
 *   消息由 `normalizeReference` 给，是**给家长读**的（带实际尺寸）。
 * @throws EngineError(`card-invalid`) 锚点不齐——正常路径上不该发生（已在校验里挡过）。
 *
 * ★ 它在开头**再判一次** `photoProblems`，虽然路由刚刚判过：这一层是公开的
 *   （脚本、以后的批处理都会调它），而"没勾同意就处理照片"是这一整条路上唯一
 *   不能靠调用方自觉的一条。多一次纯函数调用的代价，换这条纪律不依赖调用顺序。
 */
export async function cardFromPhoto(
  input: PhotoCardRequest,
  deps: PhotoCardDeps,
): Promise<PhotoCardResult> {
  const problems = photoProblems(input)
  if (problems.length > 0) {
    // ★ 用 `invalid-request` 而不是 `reference-invalid`：那一个会翻成
    //   "这张照片不能用作参考图，换一张更清楚的"，而"还没有同意"要的是**一次明确的同意**
    //   （界面上是按下那颗按钮，见 `photo-rules.ts` 的 `consent`）。
    //   工单 02 §五 记过同一类事故（照片的问题给了锚点的指示），所以这里分开
    throw new EngineError('invalid-request', problems.join('；'))
  }

  const edit = deps.image.edit
  if (typeof edit !== 'function') {
    // 能力与策略分开（工单 02）：这家没有 edit，这条路就走不了，而不是"画一张新的顶上"——
    // 顶上那张与照片没有任何关系，家长会以为模型"没看懂照片"
    throw new EngineError(
      'reference-invalid',
      '当前图像模型不能收参考图，所以没法照着照片画。换一个能收参考图的模型再试。',
    )
  }

  // ① 归一化。★ 照片的字节到这里才第一次被解析，而离家门（`photoProblems`）还隔着一次检查
  const normalized = await normalizeReference(input.photo)

  const prompt = characterSheetPrompt({
    name: input.name,
    childWord: input.childWord,
    ageLabel: ageLabelOf(input.ageBand),
    anchors: input.anchors,
    fromPhoto: true,
  })

  const usedAt = deps.now ?? Date.now()
  // ★ 出图之后把底刷成纯白（2026-10-16 第 23 刀）：模型逼不到 #FFFFFF，
  //   而卡片墙上一排三张必须同一种底，理由与量法写在 `whiten-backdrop.ts` 文件头
  const generated = await whitened(
    await edit.call(deps.image, {
      prompt,
      size: '1440x1440',
      referenceDataUrl: referenceDataUrlOf(normalized),
    }),
  )

  if (generated.referenceApplied !== true) {
    // 与 illustrate.ts / revise 同一条纪律：说了要照着照片画而没照，宁可当场失败，
    // 也不要静默存下一张"另一个孩子"的卡——那种卡会安静地传进后面每一页
    throw new EngineError(
      'reference-invalid',
      '这次请求没把照片带过去，画出来的会是另一个孩子。这一张没有存进角色卡。',
    )
  }

  // ② 从这一刻起我们不再需要那张照片了。`deletedAt` 记的就是这个时刻，
  //    而它**不是**"删掉了什么文件"——我们从来没有写过它（见文件头第 1 条）。
  //    这个字段的意思是：卡能说出"它存在过、什么时候不再被需要"（隐私设计 §七）。
  const deletedAt = deps.now ?? Date.now()

  const { card } = await deps.cardStore.create({
    cardId: `${input.childId}-sheet`,
    childId: input.childId,
    anchors: input.anchors,
    style: DEFAULT_CARD_STYLE,
    // ★ 写下去的是**模型画出来的那一张**，不是照片。这个文件里唯一一处 put 的字节
    referenceBytes: generated.bytes,
    referenceMime: generated.mime,
    modelId: generated.modelId,
    promptVersion: CHARACTER_PHOTO_VERSION,
    now: usedAt,
    sourcePhoto: { usedAt, deletedAt },
  })

  return {
    card,
    notes: normalized.notes,
    width: normalized.width,
    height: normalized.height,
  }
}
