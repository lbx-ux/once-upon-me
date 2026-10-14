/**
 * card.ts —— 角色卡的派生规则（纯函数，不碰文件、不碰网络、不碰 React）
 *
 * ## "角色卡资产化"到底在说什么
 *
 * 一句话：**把"这孩子长什么样"从一段散落在请求里的中文，变成一份有 ID、有版本、
 * 有出处、能被引用的资产。** 这个文件就是那三件事的实现处，逐条对应：
 *
 * | 资产化的要求 | 这里的实现 | 没有它会怎样 |
 * | --- | --- | --- |
 * | 可引用 | `promptFragmentOf(card)` 派生出**唯一**的角色段，每一页的画面 prompt 拼它，**不复制锚点文本** | 20 页 20 段描述，改一次要重画 20 次，"跨书复用"是空话 |
 * | 可核对 | `checklistOf(card)` 把硬锚点变成给视觉模型逐条打勾的清单 | 一致性判定退化成"像不像"三个字，阈值无从校准 |
 * | 可失效 | `cardDigest(card)` 是**语义**指纹：改一个锚点就换指纹 | 旧图与新卡混在一本书里，页面上完全看不出来 |
 * | 可追溯 | `Provenance.cardRevision` 记每页出自第几版卡 | 模型换代后无法说明哪张图是哪版画的（ADR-0003 的失效管理） |
 *
 * ## 一条不变式，比下面所有函数都重要
 *
 * **卡里出现的每一项都必须跨页不变。**
 * 姿势、表情、场景、光线、天气属于页级 prompt，永远不进卡。
 * 一旦有人图省事把"笑得开心"写进锚点，下一页哭的那一页就会被一致性判不合格——
 * 这类 bug 的症状是"模型好像不太行"，根因在卡的字段选择上。`validateCard` 里
 * 有一条针对常见越界词的软提醒，但它只是兜底，真正的约束是写代码的人记住这句话。
 */

import { canonicalDigest } from '../digest.ts'
import {
  ANCHOR_LABELS,
  ANCHOR_SLOTS,
  ANCHOR_STRENGTH,
  type AnchorSlot,
  type CharacterAnchor,
  type CharacterCard,
  type StyleLock,
} from '../domain.ts'
import { EngineError } from '../errors.ts'

/** 出卡前必须齐的硬锚点。§12.1 的固定输入就是这四个：骨相 / 瞳色 / 头身比 / 那撮翘发 */
export const REQUIRED_SLOTS: readonly AnchorSlot[] = ANCHOR_SLOTS.filter(
  (slot) => ANCHOR_STRENGTH[slot] === 'hard',
)

/** 页级 prompt 里常见的"不该进卡"的词 —— 命中只警告，不阻断（见文件头的不变式） */
const PER_PAGE_WORDS = [
  '笑',
  '哭',
  '跑',
  '跳',
  '站',
  '坐',
  '飞',
  '夜晚',
  '白天',
  '下雨',
  '开心',
  '难过',
]

export type BuildCardInput = {
  cardId: string
  childId: string
  anchors: readonly CharacterAnchor[]
  style: StyleLock
  referencePath: string
  referenceBytes: number
  /** 参考图的真实 mime。★ 不许在这里写死一个（见下面 reference 处的实测教训） */
  referenceMime: string
  modelId: string
  promptVersion: string
  now: number
  sourcePhoto?: { usedAt: number; deletedAt: number }
}

/**
 * 造一张卡。**同一输入必然得到同一张卡**（`now` 由调用方给，不读系统时钟）——
 * 这是它能被测试、能被复现、能被写进文档当证据的前提。
 *
 * 参考图的 digest 不在这里算：那是字节哈希，属于 store 的活（store 才读得到文件）。
 * 这里只填一个 `pending` 占位，`attachReferenceDigest` 补上，缺了会在校验里报错——
 * 与其让一个假指纹流进资产系统，不如让它当场不合法。
 */
export function buildCard(input: BuildCardInput): CharacterCard {
  const anchors = normalizeAnchors(input.anchors)
  const problems = checkAnchors(anchors)
  if (problems.length > 0) {
    throw new EngineError('card-invalid', `角色卡锚点不完整：${problems.join('；')}`)
  }
  const reference = {
    path: input.referencePath,
    digest: 'pending',
    bytes: input.referenceBytes,
    // ★ 必须来自调用方。这里原先**写死 `image/webp`**，而实测出图回来的是 PNG
    //   （`wan2.7-image` 与 `qwen-image-2.0` 都是），于是卡的 `reference.mime`
    //   与字节、与文件名扩展名三方不一致，一路传到
    //   `runBook` 里的 `toDataUrl(bytes, card.reference.mime)` ——
    //   视觉比对收到一个"声明 webp、内容 png"的 data URL。
    //   症状是"这家的比对时灵时不灵"，而排障会怀疑到平台头上。
    mime: input.referenceMime,
  }
  const card: CharacterCard = {
    schemaVersion: 1,
    cardId: input.cardId,
    childId: input.childId,
    revision: 1,
    anchors,
    style: input.style,
    reference,
    provenance: {
      modelId: input.modelId,
      promptVersion: input.promptVersion,
      cardRevision: 1,
      generatedAt: input.now,
    },
    createdAt: input.now,
    sourcePhoto: input.sourcePhoto,
  }
  return card
}

/** 补上参考图的内容指纹（store 读到字节之后调用） */
export function attachReferenceDigest(card: CharacterCard, referenceDigest: string): CharacterCard {
  return { ...card, reference: { ...card.reference, digest: referenceDigest } }
}

/**
 * 微调一次 = 一个新 revision，**不是覆盖**。
 *
 * 为什么留旧版：Step 3 的"头发再短一点"是家长动作，家长可能说"还是刚才那版好"。
 * 更要紧的是旧版卡对应的旧图仍然合法（ADR-0003）——覆盖 revision 等于把
 * 那 20 张图的出处抹掉，答辩时"这张图是哪版生成的"就答不上来。
 */
export function reviseCard(
  card: CharacterCard,
  nextAnchors: readonly CharacterAnchor[],
): CharacterCard {
  const anchors = normalizeAnchors(nextAnchors.length > 0 ? nextAnchors : card.anchors)
  const revision = card.revision + 1
  return {
    ...card,
    anchors,
    revision,
    provenance: { ...card.provenance, cardRevision: revision },
  }
}

/** 同槽位覆盖、按 ANCHOR_SLOTS 声明序排列、空值丢弃。排序是指纹稳定的前提 */
export function normalizeAnchors(anchors: readonly CharacterAnchor[]): readonly CharacterAnchor[] {
  const bySlot = new Map<AnchorSlot, string>()
  for (const anchor of anchors) {
    const value = anchor.value.trim()
    if (!value) continue
    // 同槽位重复出现时取**最后一次**：微调语义就是"后说的算"
    bySlot.set(anchor.slot, value)
  }
  return ANCHOR_SLOTS.filter((slot) => bySlot.has(slot)).map((slot) => ({
    slot,
    // 折行空白压成单空格：锚点是一句话，不该带排版字符进 prompt
    value: (bySlot.get(slot) ?? '').replace(/\s+/g, ' '),
  }))
}

/** 返回人话的问题清单（空数组 = 合法）。给校验、给 UI、给测试共用 */
export function checkAnchors(anchors: readonly CharacterAnchor[]): string[] {
  const present = new Set(anchors.map((a) => a.slot))
  const problems: string[] = []
  for (const slot of REQUIRED_SLOTS) {
    if (!present.has(slot)) problems.push(`缺${ANCHOR_LABELS[slot]}`)
  }
  for (const anchor of anchors) {
    if (anchor.value.length > 80) problems.push(`${ANCHOR_LABELS[anchor.slot]}描述过长（>80 字）`)
    const hit = PER_PAGE_WORDS.find((word) => anchor.value.includes(word))
    if (hit) problems.push(`${ANCHOR_LABELS[anchor.slot]}含页级概念「${hit}」，应留在页级 prompt`)
  }
  return problems
}

/** 整卡校验：锚点 + 参考图指纹 + 出处，三样缺一个就不配当资产 */
export function validateCard(card: CharacterCard): string[] {
  return [
    ...checkAnchors(card.anchors),
    ...(card.reference.digest === 'pending' ? ['参考图内容指纹未计算'] : []),
    ...(card.reference.digest === '' ? ['参考图内容指纹为空'] : []),
    ...(card.cardId.trim() === '' ? ['cardId 为空'] : []),
    ...(card.provenance.modelId.trim() === '' ? ['缺模型出处（provenance.modelId）'] : []),
    ...(card.revision < 1 ? ['revision 必须从 1 起'] : []),
  ]
}

export function isHardAnchor(slot: AnchorSlot): boolean {
  return ANCHOR_STRENGTH[slot] === 'hard'
}

/**
 * 角色段 —— 每一页画面 prompt 里代表"这就是我家孩子"的那一段。
 *
 * 拼接顺序**写死**：画风 → 硬锚点 → 软锚点，槽位按 ANCHOR_SLOTS 声明序。
 * 固定顺序不是为了好看：横评要求"同一套提示词在候选之间比较"
 * （ADR-0002 的第二个理由），顺序随 Map 插入走就会让两次跑测的 prompt 不同，
 * 差异还被"看起来一模一样"掩盖。
 */
export function promptFragmentOf(card: CharacterCard): string {
  const hard = card.anchors.filter((a) => isHardAnchor(a.slot))
  const soft = card.anchors.filter((a) => !isHardAnchor(a.slot))
  return [card.style.promptFragment, ...hard.map(anchorText), ...soft.map(anchorText)]
    .filter(Boolean)
    .join('，')
}

function anchorText(anchor: CharacterAnchor): string {
  return `${ANCHOR_LABELS[anchor.slot]}：${anchor.value}`
}

/**
 * 一致性核对清单 —— 给视觉模型的逐条判据。
 *
 * 这是"一致性分"从玄学变成可校准东西的关键：**判据与生成用的是同一份锚点**。
 * 生成时写了"圆脸、左眼下方一颗小痣"，核对时就问这两条在不在——
 * 而不是问模型"像不像"（它会给你一个随温度漂移的形容词）。
 * 只列硬锚点：软锚点（常服/记号）出现合理变化是**应该**的，拿它扣分就是误杀。
 */
export function checklistOf(card: CharacterCard): readonly string[] {
  return card.anchors
    .filter((a) => isHardAnchor(a.slot))
    .map((a) => `${ANCHOR_LABELS[a.slot]}是否一致：${a.value}`)
}

/**
 * 卡的语义指纹。
 *
 * 排除 `provenance.generatedAt` 与 `reference` 的时间字段：那些是"什么时候做的"，
 * 不是"做的是哪个形象"。包含 revision：家长微调之后，旧页必须能被认出来是旧卡画的。
 */
export function cardDigest(card: CharacterCard): string {
  return canonicalDigest({
    schemaVersion: card.schemaVersion,
    cardId: card.cardId,
    revision: card.revision,
    anchors: card.anchors,
    style: card.style,
  })
}
