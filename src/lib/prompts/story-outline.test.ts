/**
 * story-outline.test.ts —— 共读版两步提示词与它的执行侧是不是同一件事（2026-10-22）
 *
 * 这一组守的与 `story-plan.test.ts` 是同一族（散文承诺的 = codec 接受的、红线管的"事"
 * 与词表管的"字"对齐、家长原话的标记不能少），只是对象换成了共读版那两份提示词：
 * 提纲（每页一句话）与展开（把 K 行写成 K 页）。
 *
 * 三件**这一步独有**的不变式，每一条都对应一种会让页数又飘回去的写法：
 *
 * | 不变式 | 破坏了会怎样 |
 * | --- | --- |
 * | 提纲三段的行数是闭区间（min = max = 用户消息里那三个数） | 交 16 行也算过，页数又回到模型手里 |
 * | 散文里那三个数与 codec 同源 | 提示词说 8、闸要 7，模型怎么写都不对 |
 * | 展开的 `pages` 也是闭区间，选择点的九格只单独给一次 | 每一页都可能多九个字段 |
 *
 * 判据从执行侧现取（`outlineJsonSchema` / `expansionJsonSchema` / `choicePageOf` / 词表），
 * 不另抄常量。
 */

import { describe, expect, it } from 'vitest'

import { choicePageOf, expansionJsonSchema, outlineJsonSchema } from '../schemas/story.ts'
import { LEXICON_CLAUSES, REVIEW_CLAUSES } from '../rag/review-corpus.ts'
import {
  SHARED_PLAN_VERSION,
  sharedExpandSystem,
  sharedExpandUser,
  sharedOutlineSystem,
  sharedOutlineUser,
} from './story-outline.ts'
import type { StoryPlanInput } from './story-plan.ts'

const INPUT: StoryPlanInput = {
  childName: '小满',
  nameReading: 'xiǎo mǎn',
  ageBand: '4-6',
  interestTags: ['恐龙'],
  lookTags: [],
  theme: '第一次自己去幼儿园',
  form: 'shared',
  pages: 5,
}

const CHOICE_PAGE = choicePageOf(INPUT.pages)
const TAIL = INPUT.pages - CHOICE_PAGE

const OUTLINE = {
  title: '小满去学校',
  main: ['小满背起小书包出门', '门口出现两条路'],
  branchA: ['他拐进长满蒲公英的小路', '他在小花坛边停下', '他把一朵蒲公英带回了教室'],
  branchB: ['他沿着围墙慢慢走', '他听见有人在唱歌', '他跟着歌声走进了教室'],
}

/** 从一份 schema 里取一个数。★ 路径显式写全，取不到就抛（undefined 上判据会静默通过） */
function numberAt(schema: Record<string, unknown>, path: readonly string[]): number {
  let node: unknown = schema
  for (const key of path) {
    if (typeof node !== 'object' || node === null)
      throw new Error(`schema 里没有 ${path.join('.')}`)
    node = (node as Record<string, unknown>)[key]
  }
  if (typeof node !== 'number') throw new Error(`schema 里 ${path.join('.')} 不是数字`)
  return node
}

describe('提纲：三段的行数是我们给它的三个数，不是它数出来的', () => {
  const schema = outlineJsonSchema(INPUT.pages)

  it('★ 主干正好 choicePageOf(pages) 行（min = max）', () => {
    expect(numberAt(schema, ['properties', 'main', 'minItems'])).toBe(CHOICE_PAGE)
    expect(numberAt(schema, ['properties', 'main', 'maxItems'])).toBe(CHOICE_PAGE)
  })

  it('★ 每支正好 pages − 主干 行（min = max，两支一样长）', () => {
    for (const key of ['branchA', 'branchB']) {
      expect(numberAt(schema, ['properties', key, 'minItems'])).toBe(TAIL)
      expect(numberAt(schema, ['properties', key, 'maxItems'])).toBe(TAIL)
    }
  })

  it('★ 散文里那三个数与 schema 同源，而且选择点的位置是写死的', () => {
    const user = sharedOutlineUser(INPUT)
    expect(user).toContain(`正好 ${CHOICE_PAGE} 行`)
    expect(user).toContain(`正好 ${TAIL} 行`)
    expect(user).toContain(`选择点在**第 ${CHOICE_PAGE} 页**`)
    expect(user).toContain(`${CHOICE_PAGE} + ${TAIL} = ${INPUT.pages}`)
    // 旧提示词里那个把页数交回给模型的写法，逐字不许再出现
    expect(user).not.toContain(`约 ${INPUT.pages} 页`)
    expect(user).not.toContain('差不多')
  })

  it('选择点的位置在两种页数上都不越界（第 2 页起、倒数第 2 页止）', () => {
    for (const pages of [3, 4, 5, 8, 12, 20, 24]) {
      const at = choicePageOf(pages)
      expect(at).toBeGreaterThanOrEqual(2)
      expect(at).toBeLessThanOrEqual(pages - 1)
    }
  })

  it('系统提示词里带的是提纲的形状，不是整张故事表', () => {
    const system = sharedOutlineSystem()
    expect(system).toContain('"main"')
    expect(system).toContain('"branchA"')
    expect(system).not.toContain('"nodes"')
  })

  it('★ 提纲这一步也要说清"两支各自收尾、落在同一个落点"', () => {
    // 它是共读版的产品定义，丢了的话模型会写出两条各讲一个故事的支，
    //   而孩子换一条再读时认不出是同一本
    const user = sharedOutlineUser(INPUT)
    expect(user).toContain('各自收尾')
    expect(user).toContain('同一个落点')
  })

  /**
   * ★ 两支不许互相复述（`@v2`，2026-10-22）。
   *
   * v1 的提纲里写着"两支的下标一一对应"，真书翻出来是 B 支从第 5 页起逐句复述 A 支：
   * 同一盏小灯、同一句晚安、同一个早晨。那样选哪一支都一样，共读版就成了装饰。
   * 现在两句成对：**从分岔起各走各的** + **只有最后 1–2 行回环**，展开那一步也明说。
   */
  it('★ 两支从分岔起各走各的，只有最后 1–2 行回环（不是把另一支重写一遍）', () => {
    const user = sharedOutlineUser(INPUT)
    expect(user).toContain('两件不同的事')
    expect(user).toContain('不是把另一支重写一遍')
    expect(user).toContain('最后 1–2 行')
    // 展开那一步也要知道"别的段不是你要写的"
    expect(sharedExpandSystem(3, false)).toContain('不要复述')
  })
})

describe('展开：K 是闭区间，不是"约摸 K"', () => {
  it('★ `pages` 的 minItems 与 maxItems 都是 K（交多交少都进不来）', () => {
    for (const count of [1, 3, 8]) {
      const schema = expansionJsonSchema(count, true)
      expect(numberAt(schema, ['properties', 'pages', 'minItems'])).toBe(count)
      expect(numberAt(schema, ['properties', 'pages', 'maxItems'])).toBe(count)
    }
  })

  it('只有主干那一次才要 choice；其它段连这一格都不出现', () => {
    const withChoice = expansionJsonSchema(3, true) as { properties: Record<string, unknown> }
    const without = expansionJsonSchema(3, false) as { properties: Record<string, unknown> }
    expect(Object.keys(withChoice.properties)).toContain('choice')
    expect(Object.keys(without.properties)).not.toContain('choice')
  })

  it('系统提示词里的页数与 schema 同源（散文说的就是闸接受的）', () => {
    const system = sharedExpandSystem(5, false)
    expect(system).toContain('正好 5 个对象')
    expect(system).toContain('"minItems":5')
  })
})

describe('展开的 user：段落、衔接、选择点', () => {
  const base = { input: INPUT, outline: OUTLINE }

  it('★ 整本提纲全文都给（两条支要认得主干在哪里收尾）', () => {
    const user = sharedExpandUser({ ...base, section: 'b' })
    for (const line of [...OUTLINE.main, ...OUTLINE.branchA, ...OUTLINE.branchB]) {
      expect(user).toContain(line)
    }
  })

  it('主干那一段没有"上一页"，两支都有，而且指的都是选择点那一页', () => {
    expect(sharedExpandUser({ ...base, section: 'main' })).not.toContain('【衔接】')
    const choicePage = {
      pageNo: OUTLINE.main.length,
      body: ['门口出现两条路。'],
      imagePrompt: '两条路在门口分开',
    }
    for (const section of ['a', 'b'] as const) {
      const user = sharedExpandUser({ ...base, section, previous: choicePage })
      expect(user).toContain(`第 ${choicePage.pageNo} 页`)
      expect(user).toContain('门口出现两条路。')
    }
  })

  it('★ 九格只写在主干那一次，而且两颗按钮分别对应两支的第一行', () => {
    const main = sharedExpandUser({ ...base, section: 'main' })
    expect(main).toContain('是选择点')
    expect(main).toContain(OUTLINE.branchA[0] ?? '')
    expect(main).toContain(OUTLINE.branchB[0] ?? '')
    expect(sharedExpandUser({ ...base, section: 'a' })).not.toContain('`choice`')
  })

  it('★ 页码连续：主干最后一行是选择点，两支从它后面接着数', () => {
    const main = sharedExpandUser({ ...base, section: 'main' })
    const a = sharedExpandUser({ ...base, section: 'a' })
    const b = sharedExpandUser({ ...base, section: 'b' })
    expect(main).toContain(`${OUTLINE.main.length}. ${OUTLINE.main[1]}`)
    expect(a).toContain(`${OUTLINE.main.length + 1}. ${OUTLINE.branchA[0]}`)
    expect(b).toContain(
      `${OUTLINE.main.length + OUTLINE.branchA.length + 1}. ${OUTLINE.branchB[0]}`,
    )
  })
})

describe('两份提示词都带着红线与家长原话的标记', () => {
  const systems = [sharedOutlineSystem(), sharedExpandSystem(3, true)]

  it('词表里每一个单字都在两份 red line 里点了名', () => {
    const single = LEXICON_CLAUSES.flatMap((clause) => clause.lexicon ?? []).filter(
      (word) => [...word].length === 1,
    )
    expect(single.length).toBeGreaterThan(0)
    for (const system of systems) {
      for (const word of single) expect(system, `单字「${word}」没写进红线`).toContain(word)
    }
  })

  it('每个 block 类别都写进了红线，且说清没有重写机会', () => {
    const blocked = REVIEW_CLAUSES.filter((clause) => clause.disposition === 'block')
    for (const system of systems) {
      for (const clause of blocked) expect(system).toContain(clause.category)
      expect(system).toContain('整篇作废')
      expect(system).toContain('重写的机会')
    }
  })

  it('★ 家长那三格照旧标着「家长原话」（提纲那一步用的是同一份开场）', () => {
    const user = sharedOutlineUser({ ...INPUT, wish: '学会分享', reviseNote: '结局改成飞起来' })
    expect(user.match(/家长原话/g)).toHaveLength(3)
  })

  it('没检索时逐字节等于"检索空结果"那一份（不在提示词里留一句声明）', () => {
    const plain = sharedOutlineUser(INPUT)
    expect(sharedOutlineUser({ ...INPUT, retrieval: { examples: [], avoids: [] } })).toBe(plain)
  })

  it('版本号形如 story-shared@vN', () => {
    expect(SHARED_PLAN_VERSION).toMatch(/^story-shared@v\d+$/)
  })

  /**
   * ★ 这条看起来像形式主义，它挡住的是一个"提示词与请求参数无关"的 400（2026-10-22 实测）。
   *
   * `LLM_JSON_MODE` 缺省 `object` → 每次调用都带 `response_format: {type:'json_object'}`；
   * 而 DeepSeek 要求 messages 里出现 "json" 这个词，否则整次调用 400。第一版展开提示词里
   * 只有 `JSON.stringify(...)` 的**结果**（那份 schema 的键是 type / properties / minItems，
   * 一个 json 都没有），于是提纲过、展开全 400：共读版一本都编不出来，
   * 而错误消息说的是"Prompt must contain the word 'json'"，与故事毫无关系。
   */
  it('★ 每一份会套 response_format 的提示词里都有 "json" 这个词', () => {
    for (const [name, text] of [
      ['提纲 system', sharedOutlineSystem()],
      ['展开 system', sharedExpandSystem(3, true)],
      ['展开 system（无选择点）', sharedExpandSystem(3, false)],
    ] as const) {
      expect(text.toLowerCase(), `${name} 里没有 json 这个词`).toContain('json')
    }
  })
})
