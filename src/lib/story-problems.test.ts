/**
 * story-problems.test.ts —— 闸门那道判据：**改了的故事还能不能画**
 *
 * 这一组盯的是一件很具体的事：家长在 `StorySheet` 上改坏了一格时，
 * 屏幕上那句人话与**服务端拒绝的那句话**必须是同一句。
 *
 * ★ 所以这里有两类用例，缺一类这道闸门就有一个洞：
 *
 * 1. **判据来自引擎那两个东西**（`planDraftCodec` + `buildTree`），不是这里另写的规则。
 *    用例直接在**边界**上取数（书名 20 / 21 个字、正文 120 / 121 个字）：
 *    换个数字，错的不是这一条用例，是"改完还能画"这句话本身。
 * 2. **位置要报对**（第几页、哪个框、第几句）。报错位置错了的症状不是"看不见问题"，
 *    而是"在错的地方找一个不存在的问题"——那比不报还费人。
 */

import { describe, expect, it } from 'vitest'

import { describeProblem, storyProblemText, storyProblemsOf, whereOf } from './story-problems.ts'
import { CHOICE_CELLS, planJsonSchema } from './schemas/story.ts'
import type { NodeDraft, PlanDraft } from './schemas/story.ts'

function node(parts: Partial<NodeDraft> = {}): NodeDraft {
  return {
    scene: '她把天空涂成了绿色',
    body: ['她把天空涂成了绿色。'],
    imagePrompt: '小女孩站在窗前，窗外一整片绿',
    mood: 'wonder',
    ...parts,
  }
}

function story(parts: Partial<PlanDraft> = {}): PlanDraft {
  return {
    title: '小乐的绿天空',
    nodes: [node(), node({ scene: '绿色漏到街上' }), node({ scene: '整座城都绿了' })],
    ...parts,
  }
}

describe('storyProblemsOf', () => {
  it('一份好的故事没有任何问题（空数组 = 可以画）', () => {
    expect(storyProblemsOf('solo', story())).toEqual([])
  })

  it('书名太短/太长，报在"书名"上，不带页号', () => {
    const short = storyProblemsOf('solo', story({ title: '绿' }))
    expect(short).toHaveLength(1)
    expect(short[0]).toMatchObject({ pageNo: 0, field: 'title' })
    expect(describeProblem(short[0]!)).toContain('书名')
    // 不带页号：说成"第 1 页的书名"就是编一个位置出来
    expect(describeProblem(short[0]!)).not.toContain('第 1 页')

    const long = storyProblemsOf('solo', story({ title: '绿'.repeat(21) }))
    expect(long[0]?.message).toBe('太长了：最多 20 个字，现在是 21 个字')
  })

  it('★ 边界是 codec 的边界，不是这里另写的一对数字', () => {
    // 20 个字正好合法（`planDraftCodec` 的 max 就是 20）
    expect(storyProblemsOf('solo', story({ title: '绿'.repeat(20) }))).toEqual([])

    // 正文一句 120 个字合法，121 个字报在第 1 页第 1 句上
    // ★ 三页都要给全：页数不够（<3）会先报"页数"，那就测不到这一格了
    const max = '啊'.repeat(120)
    const atMax = story({ nodes: [node({ body: [max] }), node(), node()] })
    expect(storyProblemsOf('solo', atMax)).toEqual([])

    const over = story({ nodes: [node({ body: ['啊'.repeat(121)] }), node(), node()] })
    const problems = storyProblemsOf('solo', over)
    expect(problems[0]).toMatchObject({ pageNo: 1, field: 'body', line: 1 })
    expect(describeProblem(problems[0]!)).toBe(
      '第 1 页的正文第 1 句：太长了：最多 120 个字，现在是 121 个字',
    )
  })

  it('第几页 / 哪一句报得准（这一条错了，人会在错的地方找问题）', () => {
    const problems = storyProblemsOf(
      'solo',
      story({
        nodes: [
          node(),
          // ★ 两句话都要合法长度，否则报的是"这句话怎么了"，测不到位置
          node({ body: ['第二页第一句是好的。', '第二句'.repeat(50)] }),
          node(),
        ],
      }),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ pageNo: 2, field: 'body', line: 2 })
    expect(whereOf(problems[0]!)).toBe('第 2 页的正文第 2 句')
  })

  it('正文被删空了：说"至少 1 句"，而不是"过短"', () => {
    const problems = storyProblemsOf(
      'solo',
      story({ nodes: [node({ body: [''] }), node(), node()] }),
    )
    expect(problems[0]).toMatchObject({ pageNo: 1, field: 'body' })
    expect(problems[0]?.message).toBe('正文至少 1 句，现在只有 0 句')
  })

  it('整篇的页数不够时报在"页数"上，量词是"页"', () => {
    const problems = storyProblemsOf('solo', story({ nodes: [node(), node()] }))
    expect(problems[0]).toMatchObject({ pageNo: 0, field: 'nodes' })
    expect(describeProblem(problems[0]!)).toBe('页数：页数至少 3 页，现在只有 2 页')
  })

  it('★ 形态是判据的一部分：独读版里出现选择点，schema 查不出来，树查得出来', () => {
    // 写了提问却没写选项 = 选择点写了一半（形状那关先拦）
    const halfChoice = story({ nodes: [node({ ask: '你选哪个？' }), node(), node()] })
    expect(storyProblemsOf('solo', halfChoice).length).toBeGreaterThan(0)
    // 而一条**写全了**的共读版故事，在独读版下要被树挡住
    const shared = story({
      nodes: [
        node({
          ask: '你选哪边？',
          labelA: '钻进水里',
          spokenA: '钻进水里',
          iconA: 'fish',
          emojiA: '🐟',
          labelB: '飞上天',
          spokenB: '飞上天',
          iconB: 'rocket',
          emojiB: '🚀',
        }),
        node({ from: 1, via: 'a' }),
        node({ from: 1, via: 'b' }),
      ],
    })
    expect(storyProblemsOf('shared', shared)).toEqual([])
    const asSolo = storyProblemsOf('solo', shared)
    expect(asSolo.some((one) => one.message.includes('独读版'))).toBe(true)
  })

  it('★ 选择点那九格的名字与 schema 是同一份（漂了就会把问题报在别的格子上）', () => {
    // 这条用例的存在理由：`splitField` 靠名字把失败路径翻回界面上的框，
    // 而名字对不上时的症状不是"报错"——是**在错的格子里读到一句关于别处的话**。
    // 只写在注释里的约定会漂，所以在这里拿 schema 逐个核对。
    const schema = planJsonSchema() as {
      properties: { nodes: { items: { properties: Record<string, unknown> } } }
    }
    const keys = Object.keys(schema.properties.nodes.items.properties)
    for (const cell of CHOICE_CELLS) expect(keys).toContain(cell)
  })

  it('选择点的失败位置落在"选择点"那一格上，不是"页数"', () => {
    // labelA 太短（1 个字，下限 2）：这条路径必须翻译成"第 1 页的选择点"
    const problems = storyProblemsOf(
      'shared',
      story({ nodes: [node({ labelA: '左' }), node(), node()] }),
    )
    expect(problems.some((one) => one.field === 'choice')).toBe(true)
  })

  it('同一个格子上只留一条问题（两句话说不下，而且说的是同一件事）', () => {
    // 一页的正文既是空的、又超了条数上限：codec 会报两条，界面上那一格只放得下一条
    const problems = storyProblemsOf(
      'solo',
      story({ nodes: [node({ body: ['', '', '', '', ''] }), node(), node()] }),
    )
    const atPage1 = problems.filter((one) => one.pageNo === 1 && one.field === 'body')
    expect(atPage1).toHaveLength(1)
  })

  it('storyProblemText：没问题时是 null（不是空串），有问题时一句话说完', () => {
    expect(storyProblemText([])).toBeNull()
    const problems = storyProblemsOf('solo', story({ title: '绿' }))
    expect(storyProblemText(problems)).toContain('书名')
    // 超过三条时给个总数，别让 tooltip 长到看不完
    const many = storyProblemsOf(
      'solo',
      story({
        nodes: [
          node({ body: [''] }),
          node({ body: [''] }),
          node({ body: [''] }),
          node({ body: [''] }),
        ],
      }),
    )
    expect(many).toHaveLength(4)
    expect(storyProblemText(many)).toContain('另有 1 处')
  })
})
