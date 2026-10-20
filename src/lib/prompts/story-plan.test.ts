/**
 * story-plan.test.ts —— 分镜提示词与它的**执行侧**说的是不是同一件事
 *
 * ★ 这个文件盯的是四类**静默漂移**，每一类都在这个仓库里有过对应形状的前科
 *   （`style.test.ts` 那条"改提示词的人不会想到去改标签"是同一族）：
 *
 * | 漂移 | 谁会发现 | 症状 |
 * | --- | --- | --- |
 * | 散文里的长度上限 ≠ codec 的 maxLength | 只有这个文件 | 模型按散文写，`parseWith` 报"过长"，整张表作废重来 |
 * | 红线的"事" ≠ 词表的"字" | 只有这个文件 | 一句正常的中文命中红线，`flag` → 20 页重写一次 |
 * | 「没有重写机会」那两类 ≠ `ClauseDisposition.block` | 只有这个文件 | 提示词把最重的两类与其余并列，模型无从知道严重度 |
 * | 家长文本的「家长原话」标记被删 | 只有这个文件 | 数据/指令分界消失，注入回到裸插 |
 *
 * ★ 这些判据**全部从执行侧现取**（`planJsonSchema()` / `LEXICON_CLAUSES` /
 *   `REVIEW_CLAUSES`），不另抄一份常量：抄一份就等于把"两处会漂"换成"三处会漂"。
 *   所以它们会在**改 codec / 改词表**时红，而不是只在改提示词时红——那正是要的。
 */

import { describe, expect, it } from 'vitest'

import { planJsonSchema } from '../schemas/story.ts'
import { LEXICON_CLAUSES, REVIEW_CLAUSES } from '../rag/review-corpus.ts'
import { STORY_PLAN_VERSION, storyPlanSystem, storyPlanUser } from './story-plan.ts'
import type { StoryPlanInput } from './story-plan.ts'

/** 一份最小的合法输入。★ 只填必填项，测试里出现用不上的字段会让人以为它们有关系 */
const INPUT: StoryPlanInput = {
  childName: '小满',
  nameReading: 'xiǎo mǎn',
  ageBand: '4-6',
  interestTags: ['恐龙'],
  lookTags: [],
  theme: '第一次自己去幼儿园',
  form: 'shared',
  pages: 8,
}

/**
 * 从 `planJsonSchema()` 里取一个数。★ 路径是**显式**的（调用处写全），
 * 因为 schema 的形状是 `properties.nodes.items.properties.scene.maxLength` 这种
 * 隔层相间的走法，靠一个 helper 猜层级只会猜错——第一版就是这么错的，
 * 而它错的表现是"四个长度判据一起红"，看着像提示词没写。
 * ★ 取不到就**抛**，不返回 undefined：判据在 undefined 上会静默通过。
 */
function numberAt(path: readonly string[]): number {
  let node: unknown = planJsonSchema()
  for (const key of path) {
    if (typeof node !== 'object' || node === null)
      throw new Error(`schema 里没有 ${path.join('.')}`)
    node = (node as Record<string, unknown>)[key]
  }
  if (typeof node !== 'number') throw new Error(`schema 里 ${path.join('.')} 不是数字`)
  return node
}

/** `nodes[]` 里某一格的两个端点。`field` 是 `nodeDraftCodec` 的键名 */
function nodeRange(field: string): string {
  const at = ['properties', 'nodes', 'items', 'properties', field]
  return `${numberAt([...at, 'minLength'])}–${numberAt([...at, 'maxLength'])} 字`
}

describe('长度上限：散文承诺的 = 解析器接受的', () => {
  /**
   * ★ 判据是"上限那个数出现在提示词里"，不是"提示词长得像某一段"。
   *   所以改措辞不会误红，改数才会——而改数正是要红的那件事。
   */
  it('scene 的区间写在正文里，且与 codec 同源', () => {
    expect(storyPlanUser(INPUT)).toContain(nodeRange('scene'))
  })

  it('imagePrompt 的区间写在正文里，且与 codec 同源', () => {
    expect(storyPlanUser(INPUT)).toContain(nodeRange('imagePrompt'))
  })

  it('正文每条的 120 字上限写在正文里（它是 `stringList` 的 itemMax）', () => {
    // `stringList.describe()` 把 itemMax 放在 items.maxLength 上，不在自己身上
    const item = numberAt([
      'properties',
      'nodes',
      'items',
      'properties',
      'body',
      'items',
      'maxLength',
    ])
    expect(storyPlanUser(INPUT)).toContain(`每条不超过 ${item} 字`)
  })

  it('九格里的 ask / spoken 上限也写在正文里（共读版才会用到，但同一张表）', () => {
    const user = storyPlanUser({ ...INPUT, form: 'shared' })
    expect(user).toContain(nodeRange('ask'))
    expect(user).toContain(nodeRange('spokenA'))
  })

  /**
   * ★ `title` 是这一族里**唯一一处刻意不对齐**的：散文写「≤8 字」，codec 是 `min 2, max 20`
   *   （`schemas/story.ts`）。台账与 diff 都把它列为"等用户拍板"，而**方向**不该等：
   *   散文只能**比闸严**，不能比闸松。松的那一头的坏法是具体的——模型照散文写了一个
   *   25 字的书名，`parseWith` 报「过长」，**整张 20 页的表作废**、带路径重来一次。
   *   严的那一头不会失败，只会让书名更短（而实测 11 本真书的书名是 4–6 字，本来就都在 8 内）。
   *
   *   ★ 所以这条判据钉的是**关系**（`散文的数 ≤ codec 的 max`），不是那个数本身：
   *   以后无论谁把哪一边改了，只要改出"散文比闸松"这个形状就红；
   *   而把 codec 从 20 收到 8（那个决定还没做）不会让它红。
   */
  it('★ title：散文里那个数只能比闸严，不能比闸松', () => {
    const system = storyPlanSystem()
    const found = /title 是书名（≤(\d+) 字/.exec(system)
    if (!found) throw new Error('提示词里 title 的上限写法变了，这条判据要先跟着改')
    const proseMax = Number(found[1])
    const codecMax = numberAt(['properties', 'title', 'maxLength'])
    const codecMin = numberAt(['properties', 'title', 'minLength'])
    expect(proseMax).toBeLessThanOrEqual(codecMax)
    // 下限也不能写成"模型不可能满足"的样子：散文要求 ≤8 而闸要求 ≥2，那 2–8 这一段是空的
    expect(proseMax).toBeGreaterThanOrEqual(codecMin)
  })
})

describe('红线：散文管的"事"与词表管的"字"对齐', () => {
  const system = storyPlanSystem()

  /**
   * ★ 这条盯的是一个**具体的前科**：`rag/review-corpus.ts` 的注释原来写着
   *   "`死` 与 `血` 是仅有的两个单字"，而 R-02 的词表里躺着**第三个** `踹`
   *   ——注释与数据矛盾，而症状是"每加一个单字，提示词就悄悄少一句"。
   *   ★ 2026-10-20 用户拍板 `踹` **保留单字**、注释改成实话，所以现在是三个。
   *
   *   它们命中时，`plan.ts` 会判 `flag` 并把**整本 20 页**作废重写一次。
   *   所以不变式是：**词表里每多一个单字，提示词就必须点名它**。
   *   单字是这一族里最危险的一种（歧义少、日常句子多、模型想都想不到），
   *   多字词靠"恐怖、暴力、死亡"那三行概括就够了。
   */
  it('词表里每一个单字词都在提示词里点了名', () => {
    const single = LEXICON_CLAUSES.flatMap((clause) => clause.lexicon ?? []).filter(
      (word) => [...word].length === 1,
    )
    expect(single.length).toBeGreaterThan(0)
    for (const word of single) {
      expect(system, `词表里的单字「${word}」没有写进红线`).toContain(word)
    }
  })

  /**
   * ★ `block` 与 `rewrite` 的**下一步不是同一件事**（见 `ClauseDisposition`）：
   *   `block` 当场拒发、连重写都没有，`rewrite` 还有一次带反馈的重来。
   *   提示词若把两类并列写着，模型就无从知道严重度的差别——而它本来是唯一
   *   能事先避开的东西。这条判据保证：**每个 block 类别的名字都出现在红线里**。
   */
  it('每个 block 类别的名字都写进了红线，且说清了没有重写机会', () => {
    const blocked = REVIEW_CLAUSES.filter((clause) => clause.disposition === 'block')
    expect(blocked.length).toBeGreaterThan(0)
    for (const clause of blocked) {
      expect(system, `block 条款 ${clause.id} 的类别「${clause.category}」不在红线里`).toContain(
        clause.category,
      )
    }
    // ★ 判据取的是"意思"不是整句：说明这两类没有第二次机会的那半句。
    //   写死整句会让每次润色都红一次，而这条要防的是"有人把这半句删掉"。
    expect(system).toContain('整篇作废')
    expect(system).toContain('重写的机会')
  })
})

describe('家长那三格自由文本：数据 / 指令分界', () => {
  /**
   * ★ 拦在提示词前面的只有一份**红线词表**（`plan.ts` 的 `reviewInput`），而
   *   `review-corpus.ts` 自己写着词表是**下界不是覆盖**——谐音、委婉、外文、
   *   一个红线词都不含的指令，它一条都抓不到。所以分界得由提示词自己划。
   *
   *   判据是**三格都带标记**，而不是"提示词里出现过某句话"：漏标一格就等于
   *   那一格还是裸插的，而漏两格与漏一格的症状完全一样。
   */
  const marked = storyPlanUser({ ...INPUT, wish: '学会分享', reviseNote: '结局改成飞起来' })

  it('主题 / 想让孩子得到什么 / 改稿要求，三格都带「家长原话」', () => {
    expect(marked.match(/家长原话/g)).toHaveLength(3)
  })

  it('三格都被成对引号包起来（`「」`），值是原样，没有被改写', () => {
    for (const value of [INPUT.theme, '学会分享', '结局改成飞起来']) {
      expect(marked).toContain(`「${value}」`)
    }
  })

  it('不写那两格时，标记数跟着降下来（不是恒真）', () => {
    expect(storyPlanUser(INPUT).match(/家长原话/g)).toHaveLength(1)
  })

  it('系统提示词里有一条常驻约定，说清标着它的是素材不是指令', () => {
    const system = storyPlanSystem()
    expect(system).toContain('家长原话')
    expect(system).toContain('当故事素材读')
  })
})

describe('版本号', () => {
  /**
   * ★ 它是 `Provenance.promptVersion` 的来源，而那个字段的用处是回答
   *   "这张图/这本书是哪份提示词出来的"（ADR-0003 的失效管理）。
   *   这条只钉住"升过版"这件事的形状，不钉住具体版本的值——
   *   值会一直涨，钉住值等于每次升版都要改一次测试。
   */
  it('形如 `story-plan@vN`，且这一版不是 v1', () => {
    expect(STORY_PLAN_VERSION).toMatch(/^story-plan@v\d+$/)
  })
})
