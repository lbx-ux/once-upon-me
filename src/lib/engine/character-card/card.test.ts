import { describe, expect, it } from 'vitest'
import {
  attachReferenceDigest,
  buildCard,
  cardDigest,
  checkAnchors,
  checklistOf,
  normalizeAnchors,
  promptFragmentOf,
  reviseCard,
  validateCard,
  type BuildCardInput,
} from './card.ts'
import {
  ANCHOR_SLOTS,
  type CharacterAnchor,
  type CharacterCard,
  type StyleLock,
} from '../domain.ts'

const STYLE: StyleLock = {
  key: 'warm-handdrawn',
  promptFragment: '温暖手绘水彩，柔和侧光',
  ratio: '3:2',
}

const REF_DIGEST = 'f3a1c9d0e1b2'

/** 五条硬锚点，取自 §12.1 固定输入的那一段外貌描述 */
const HARD: CharacterAnchor[] = [
  { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
  { slot: 'eyes', value: '深棕圆眼、眼距略宽' },
  { slot: 'hair', value: '黑发偏软，左上方永远翘着一撮' },
  { slot: 'build', value: '头身比约 1:4，四肢圆润' },
  { slot: 'skin', value: '暖黄偏深的肤色，晒黑的膝盖' },
]

function raw(anchors: readonly CharacterAnchor[] = HARD): CharacterCard {
  return buildCardLike('image/webp', anchors)
}

/** 只改参考图 mime 的同一条构造路径（回归用） */
function buildCardLike(
  referenceMime: string,
  anchors: readonly CharacterAnchor[] = HARD,
): CharacterCard {
  const input: BuildCardInput = {
    cardId: 'xiaolu-r1',
    childId: 'xiaolu',
    anchors,
    style: STYLE,
    referencePath: 'cards/xiaolu-r1/ref.abc.webp',
    referenceBytes: 12_345,
    referenceMime,
    modelId: 'wan2.7-image',
    promptVersion: 'character-card@v1',
    now: 1_700_000_000_000,
  }
  return buildCard(input)
}

/** 多数测试关心的是"补好指纹之后"的行为 */
function makeCard(anchors: readonly CharacterAnchor[] = HARD): CharacterCard {
  return attachReferenceDigest(raw(anchors), REF_DIGEST)
}

function replaceAnchor(card: CharacterCard, slot: string, value: string): CharacterCard {
  return { ...card, anchors: card.anchors.map((a) => (a.slot === slot ? { ...a, value } : a)) }
}

describe('buildCard', () => {
  it('缺硬锚点直接拒绝出卡，并说清缺哪一条', () => {
    expect(() => raw(HARD.filter((anchor) => anchor.slot !== 'eyes'))).toThrowError(/缺眼睛/)
  })

  it('新建的卡一律 revision 1，且参考图指纹是待算状态（所以它当场不合法）', () => {
    const card = raw()
    expect(card.revision).toBe(1)
    expect(card.reference.digest).toBe('pending')
    expect(validateCard(card)).toContain('参考图内容指纹未计算')
  })

  it('补上指纹之后就合法', () => {
    expect(validateCard(makeCard())).toEqual([])
  })

  it('cardId 为空的卡不合法（没有 ID 的东西不能被引用，也就不是资产）', () => {
    expect(validateCard({ ...makeCard(), cardId: '  ' }).join('')).toContain('cardId')
  })

  it('缺模型出处的卡不合法（ADR-0003：说不出哪版模型画的，就不能当交付物）', () => {
    const card = { ...makeCard(), provenance: { ...makeCard().provenance, modelId: '' } }
    expect(validateCard(card).join('')).toContain('模型出处')
  })

  it('参考图的 mime 来自调用方，**不是写死的**', () => {
    // 回归：这一句原先是 `mime: 'image/webp'` 硬编码，而实测出图回来是 PNG
    // （wan2.7-image / qwen-image-2.0 都是）。三方不一致会一路传到
    // `toDataUrl(bytes, card.reference.mime)`，视觉比对就收到一个
    // "声明 webp、内容 png"的 data URL ——症状是"比对时灵时不灵"，怀疑对象还错。
    const png = buildCardLike('image/png')
    expect(png.reference.mime).toBe('image/png')
    expect(makeCard().reference.mime).toBe('image/webp')
  })
})

describe('normalizeAnchors', () => {
  it('同槽位后写的算 —— 微调语义', () => {
    const merged = normalizeAnchors([
      { slot: 'hair', value: '短发' },
      { slot: 'hair', value: '头发再短一点' },
    ])
    expect(merged).toEqual([{ slot: 'hair', value: '头发再短一点' }])
  })

  it('输出顺序永远是 ANCHOR_SLOTS 的声明序，与输入顺序无关', () => {
    const slots = normalizeAnchors([...HARD].reverse()).map((anchor) => anchor.slot)
    expect(slots).toEqual(ANCHOR_SLOTS.filter((slot) => slots.includes(slot)))
    expect(slots[0]).toBe('bone')
  })

  it('空串与纯空白被丢掉', () => {
    expect(normalizeAnchors([{ slot: 'mark', value: '   ' }])).toEqual([])
  })
})

describe('checkAnchors', () => {
  /**
   * ★ 这一条守的是一个**会花钱**的缝（2026-10-15 补的）：
   *   `normalizeAnchors` 丢空值，而 `checkAnchors` 原来只看"槽位在不在"。
   *   两者不同向时，界面会说"可以提交"，服务端**先出图**再拒——
   *   家长付了一张图的钱，换来一句"角色卡不合格"。
   */
  it('★ 空值算问题 —— 判据要与 normalizeAnchors 同向（那边丢、这边就得报）', () => {
    const withEmpty = ANCHOR_SLOTS.map((slot) => ({
      slot,
      value: slot === 'bone' ? '   ' : '圆脸、颊部饱满',
    }))
    expect(checkAnchors(withEmpty)).toEqual(['骨相是空的'])
  })

  it('槽位整格缺失仍然报"缺"（与"空了"分开，两句话对应两个动作）', () => {
    const missing = ANCHOR_SLOTS.filter((slot) => slot !== 'eyes').map((slot) => ({
      slot,
      value: '圆脸、颊部饱满',
    }))
    expect(checkAnchors(missing)).toEqual(['缺眼睛'])
  })

  /**
   * ★ 这一条守的是上面那条修正的**另一半**：空值只在硬锚点上算错。
   *
   * 它会红的那个场景是实测出来的（2026-10-15，`/api/cards/analyze-photo`）：
   * 读完一张照片之后，模型**看不见的槽位被刻意清空**（不清空就留着小宇的示例值，
   * 那张卡会变成"照片里的脸 + 示例里那个孩子的雨鞋"），而"看不见记号/常服"
   * 是照片这条路上的常事。把软锚点的空值也报成错，家长就会看到一句
   * 「记号是空的」而按钮点不动——那张卡本来完全合法。
   */
  it('★ 软锚点空着不算问题 —— 照片里读不出来的格子会被清空', () => {
    const read = ANCHOR_SLOTS.map((slot) => ({
      slot,
      value: slot === 'mark' || slot === 'wardrobe' ? '' : '圆脸、颊部饱满',
    }))
    expect(checkAnchors(read)).toEqual([])
  })

  it('★ 硬锚点空着**仍然**算问题 —— 上面那条不许把花钱那一道缝一起放开', () => {
    const read = ANCHOR_SLOTS.map((slot) => ({
      slot,
      value: slot === 'build' ? '   ' : '圆脸、颊部饱满',
    }))
    expect(checkAnchors(read)).toEqual(['头身比是空的'])
  })

  it('齐全且非空就是合法（预填那八条是这条的实例，见 default-anchors.test.ts）', () => {
    const full = ANCHOR_SLOTS.map((slot) => ({ slot, value: '圆脸、颊部饱满、下颌线软' }))
    expect(checkAnchors(full)).toEqual([])
  })
})

describe('promptFragmentOf / checklistOf', () => {
  it('角色段：画风在最前，硬锚点在软锚点之前', () => {
    const fragment = promptFragmentOf(makeCard([...HARD, { slot: 'wardrobe', value: '黄色雨衣' }]))
    expect(fragment.startsWith(STYLE.promptFragment)).toBe(true)
    expect(fragment.indexOf('骨相')).toBeLessThan(fragment.indexOf('常服'))
  })

  it('同一张卡两次派生得到完全相同的字符串（横评可比性的前提）', () => {
    const card = makeCard()
    expect(promptFragmentOf(card)).toBe(promptFragmentOf(card))
  })

  it('核对清单只列硬锚点 —— 换衣服不该被判不像', () => {
    const card = makeCard([
      ...HARD,
      { slot: 'wardrobe', value: '黄色雨衣' },
      { slot: 'mark', value: '左颊一颗小痣' },
    ])
    const checklist = checklistOf(card)
    expect(checklist).toHaveLength(HARD.length)
    expect(checklist.join('')).not.toContain('黄色雨衣')
  })

  it('清单与 prompt 同源：改了锚点，两边同时变', () => {
    const base = makeCard()
    expect(checklistOf(replaceAnchor(base, 'bone', '方脸'))).not.toEqual(checklistOf(base))
  })
})

describe('不变式：卡里不许出现页级概念', () => {
  it('"总是笑"这种会随页变化的描述被拦下', () => {
    const card = replaceAnchor(makeCard(), 'bone', '圆脸，总是笑')
    expect(validateCard(card).join('')).toContain('含页级概念')
  })
})

describe('cardDigest', () => {
  it('改一个锚点 → 换指纹', () => {
    const base = makeCard()
    expect(cardDigest(replaceAnchor(base, 'bone', '瓜子脸'))).not.toBe(cardDigest(base))
  })

  it('改 revision → 换指纹（旧页必须能被认出是旧卡画的）', () => {
    const base = makeCard()
    expect(cardDigest(reviseCard(base, base.anchors))).not.toBe(cardDigest(base))
  })

  it('改时间戳 → 不换指纹（时间不是长相）', () => {
    const base = makeCard()
    expect(cardDigest({ ...base, createdAt: base.createdAt + 10_000 })).toBe(cardDigest(base))
  })
})

describe('reviseCard', () => {
  it('revision 与 provenance.cardRevision 同步递增', () => {
    const card = makeCard()
    const next = reviseCard(card, card.anchors)
    expect(next.revision).toBe(2)
    expect(next.provenance.cardRevision).toBe(2)
    expect(card.revision).toBe(1)
  })

  it('传空锚点时保留原锚点（"只改衣服"不该把骨相清空）', () => {
    const card = makeCard()
    expect(reviseCard(card, []).anchors).toHaveLength(card.anchors.length)
  })
})
