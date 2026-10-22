/**
 * plan-shared.test.ts —— 共读版两步规划：页数由构造保证，而不是模型数对（2026-10-22）
 *
 * 这一组钉的是**这一步存在的全部理由**：请求 20 页时模型数不准（实测草稿 13–37 个节点、
 * 提纲交回过"每条路 16 页"），所以共读版不再让它数。判据落在"只有这条路才会不同"的地方：
 *
 * | 钉什么 | 怎么证伪 |
 * | --- | --- |
 * | 树干与两支的形状由引擎拼（`from` / `via`） | 装配错一格，`choice.next` 与路长立刻不对 |
 * | 提纲的行数是闭区间 → 交少交多当场退回 | 5 行了还收下，页数就又回到模型手里 |
 * | 展开交多/交少 → 当场退回 | schema 的 min = max，1 < 2 会被判"数量不足" |
 * | 审核标了 → 只重写被标的那一段 | 统计调用次数即可（多写一段就多一次调用） |
 * | `block` → 当场拒发 | 抛 `review-blocked`，后面的段一个字都不写 |
 *
 * 夹具的页数取 5：`choicePageOf(5) = 2`，所以主干 2 行、每支 3 行，表里 8 个节点。
 * 节点数（8）**不等于**请求页数（5），任何"拿节点数当页数"的实现都会在这里露馅
 * ——同一个理由见 `tree-pages.test.ts` 的 SHARED6。
 */

import { describe, expect, it } from 'vitest'

import { planStory } from './plan.ts'
import { choicePageOf } from '../schemas/story.ts'
import type { EngineEventPayload } from './events.ts'
import type { TextGenerator, TextRequest } from './providers/types.ts'
import type { StoryPlanInput } from '../prompts/story-plan.ts'

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

/** 主干几行 / 每支几行（与 `outlineCodecFor` 同源，测试里不另算一份） */
const CHOICE_PAGE = choicePageOf(INPUT.pages)
const TAIL = INPUT.pages - CHOICE_PAGE

/** 一页：四个字段都过得了 codec（scene ≥4、imagePrompt ≥8） */
const page = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  scene: `第 ${n} 页的场景`,
  body: [`第 ${n} 页的正文。`],
  imagePrompt: `第 ${n} 页的画面：孩子与一朵云`,
  mood: 'wonder',
  ...extra,
})

/** 主干 2 行 + 两支各 3 行 = 一条路 5 页、表里 8 个节点 */
const OUTLINE = {
  title: '小满去上学',
  main: ['小满背起书包出门', '门口出现两条路'],
  branchA: ['他拐进蒲公英小路', '他在花坛边停下', '他把蒲公英带回教室'],
  branchB: ['他沿着围墙慢慢走', '他听见有人唱歌', '他跟着歌声走进教室'],
}

const CHOICE = {
  ask: '小满该走哪一条？',
  labelA: '蒲公英路',
  spokenA: '走蒲公英那条路',
  labelB: '围墙路',
  spokenB: '沿着围墙走',
}

const mainPages = (): Record<string, unknown>[] =>
  Array.from({ length: CHOICE_PAGE }, (_, i) => page(i + 1))
const tailPages = (from: number): Record<string, unknown>[] =>
  Array.from({ length: TAIL }, (_, i) => page(from + i))

const MAIN = JSON.stringify({ pages: mainPages(), choice: CHOICE })
const BRANCH_A = JSON.stringify({ pages: tailPages(CHOICE_PAGE + 1) })
const BRANCH_B = JSON.stringify({ pages: tailPages(CHOICE_PAGE + TAIL + 1) })

/** 每次调用把请求原样记下来——判据要读的是**发出去的那份提示词** */
function scripted(replies: readonly string[]): {
  text: TextGenerator
  requests: TextRequest[]
} {
  const requests: TextRequest[] = []
  let index = 0
  return {
    requests,
    text: {
      id: 'fake-text',
      modelId: 'fake-text',
      async complete(req: TextRequest) {
        requests.push(req)
        const text = replies[Math.min(index, replies.length - 1)] ?? ''
        index += 1
        return { text, modelId: 'fake-text' }
      },
      async stream() {
        throw new Error('这一支不走流式')
      },
    },
  }
}

function collector(): { events: EngineEventPayload[]; emit: (one: EngineEventPayload) => void } {
  const events: EngineEventPayload[] = []
  return { events, emit: (one) => events.push(one) }
}

function userOf(request: TextRequest | undefined): string {
  if (!request) return ''
  if (request.user !== undefined) return request.user
  return request.messages
    .map((message) => ('content' in message ? String(message.content) : ''))
    .join('\n')
}

async function run(replies: readonly string[]): Promise<{
  outcome: Awaited<ReturnType<typeof planStory>>
  requests: TextRequest[]
  events: EngineEventPayload[]
}> {
  const { text, requests } = scripted(replies)
  const { events, emit } = collector()
  const outcome = await planStory(INPUT, { text, form: 'shared', emit })
  return { outcome, requests, events }
}

describe('一次顺利的共读版：三段展开、树由引擎拼', () => {
  it('★ 一条路 5 页、表里 8 个节点；选择点在第 2 页，两支各接在它下面', async () => {
    const { outcome } = await run([JSON.stringify(OUTLINE), MAIN, BRANCH_A, BRANCH_B])

    expect(outcome.doc.nodes).toHaveLength(CHOICE_PAGE + TAIL * 2)
    // 每一条路读下来都是 5 页——这是请求的那个数，不是"差不多"
    const ends = outcome.tree.nodes.filter((node) => node.next.length === 0)
    expect(new Set(ends.map((node) => node.pathFromRoot.length))).toEqual(new Set([5]))

    const choice = outcome.tree.nodes.find((node) => node.choice)
    expect(choice?.pageNo).toBe(CHOICE_PAGE)
    // A 支的头是第 3 页、B 支的头是第 6 页（顺序 = 选项顺序）
    expect(choice?.next).toEqual([`n${CHOICE_PAGE + 1}`, `n${CHOICE_PAGE + TAIL + 1}`])
    // 装配没有丢东西：选择点那一页的正文还是提纲展开出来的那一句
    expect(outcome.doc.nodes[CHOICE_PAGE - 1]?.body).toEqual([`第 ${CHOICE_PAGE} 页的正文。`])
    // 一共四次模型调用：提纲 + 三段展开（`attempts` 在两步规划里数的是调用次数）
    expect(outcome.attempts).toBe(4)
    expect(outcome.promptVersion).toMatch(/^story-shared@/)
  })

  it('★ 选择点那九格装配在**选择点那一页**上，别的页一格都没有', async () => {
    const { outcome } = await run([JSON.stringify(OUTLINE), MAIN, BRANCH_A, BRANCH_B])
    const withChoice = outcome.doc.nodes.filter((node) => (node.labelA ?? '') !== '')
    expect(withChoice).toHaveLength(1)
    expect(outcome.doc.nodes[CHOICE_PAGE - 1]?.labelA).toBe('蒲公英路')
    expect(outcome.doc.nodes[0]?.ask).toBeUndefined()
  })

  it('`plan-ready` 带的是真树上的两个数（节点数、选择点、两支页号）', async () => {
    const { events } = await run([JSON.stringify(OUTLINE), MAIN, BRANCH_A, BRANCH_B])
    const ready = events.find((event) => event.kind === 'plan-ready')
    const a = Array.from({ length: TAIL }, (_, i) => CHOICE_PAGE + 1 + i)
    const b = Array.from({ length: TAIL }, (_, i) => CHOICE_PAGE + TAIL + 1 + i)
    expect(ready).toMatchObject({
      kind: 'plan-ready',
      nodeCount: CHOICE_PAGE + TAIL * 2,
      choicePages: [CHOICE_PAGE],
      branchPages: { a, b },
    })
  })

  it('四份提示词是四件不同的事（提纲 + 三段展开，各带自己的页数）', async () => {
    const { requests } = await run([JSON.stringify(OUTLINE), MAIN, BRANCH_A, BRANCH_B])
    expect(requests).toHaveLength(4)
    expect(requests[0]?.system).toContain('只写**提纲**')
    expect(userOf(requests[1])).toContain(`这一次只写这一段：主干，共 ${CHOICE_PAGE} 页`)
    expect(userOf(requests[2])).toContain(`这一次只写这一段：A 支，共 ${TAIL} 页`)
    expect(userOf(requests[3])).toContain(`这一次只写这一段：B 支，共 ${TAIL} 页`)
  })
})

describe('提纲的行数是硬约束：交少交多都退回重写', () => {
  it('★ 主干少写一行 → 第二次请求里带着"数量不足（1 < 2）"', async () => {
    // 这是实测的形状：请求 20 页、模型交回每条路 16 页。以前那句"约 20 页"它改不动，
    //   现在报的是"你要 2 行、你交了 1 行"
    const short = JSON.stringify({ ...OUTLINE, main: ['只有一行的主干'] })
    const { outcome, requests } = await run([
      short,
      JSON.stringify(OUTLINE),
      MAIN,
      BRANCH_A,
      BRANCH_B,
    ])

    expect(userOf(requests[1])).toContain(`数量不足（1 < ${CHOICE_PAGE}）`)
    // 重抽的是提纲，不是把整本重写一遍
    expect(userOf(requests[1])).toContain('别重写整个提纲')
    expect(outcome.doc.nodes).toHaveLength(CHOICE_PAGE + TAIL * 2)
    // 提纲写了两次 + 三段展开
    expect(outcome.attempts).toBe(5)
  })

  it('★ 支多写一行也一样：闭区间的两头都拦得住', async () => {
    const long = JSON.stringify({ ...OUTLINE, branchA: [...OUTLINE.branchA, '多出来的一行'] })
    const { requests } = await run([long, JSON.stringify(OUTLINE), MAIN, BRANCH_A, BRANCH_B])
    expect(userOf(requests[1])).toContain(`数量过多（${TAIL + 1} > ${TAIL}）`)
  })

  it('★ 交换两支的长度也不行（"两支一样长"是同一份 schema 管的）', async () => {
    const swapped = JSON.stringify({
      ...OUTLINE,
      branchA: ['只是一句话'],
      branchB: OUTLINE.branchB,
    })
    const { requests } = await run([swapped, JSON.stringify(OUTLINE), MAIN, BRANCH_A, BRANCH_B])
    expect(userOf(requests[1])).toContain(`数量不足（1 < ${TAIL}）`)
  })

  it('提纲五次都不对 → 抛出来的错误里那几句逐字还在', async () => {
    const short = JSON.stringify({ ...OUTLINE, main: ['只有一行的主干'] })
    const { text } = scripted([short])
    const { emit } = collector()
    await expect(planStory(INPUT, { text, form: 'shared', emit, maxAttempts: 3 })).rejects.toThrow(
      /数量不足/,
    )
  })
})

describe('展开：数量是闭区间，不是"约摸"', () => {
  it('★ 主干要 2 页、交了 1 页 → 退回重写，第二次请求里带着"数量不足（1 < 2）"', async () => {
    const shortMain = JSON.stringify({ pages: [page(1)], choice: CHOICE })
    const { outcome, requests, events } = await run([
      JSON.stringify(OUTLINE),
      shortMain,
      MAIN,
      BRANCH_A,
      BRANCH_B,
    ])

    expect(userOf(requests[2])).toContain(`数量不足（1 < ${CHOICE_PAGE}）`)
    expect(events.some((event) => event.kind === 'retry')).toBe(true)
    expect(outcome.doc.nodes).toHaveLength(CHOICE_PAGE + TAIL * 2)
    // 主干写了两次 + 提纲 + 另外两段
    expect(outcome.attempts).toBe(5)
  })

  it('交多也一样：schema 的 maxItems 与 minItems 是同一个数', async () => {
    const longA = JSON.stringify({ pages: tailPages(CHOICE_PAGE + 1).concat(page(99)) })
    const { requests } = await run([JSON.stringify(OUTLINE), MAIN, longA, BRANCH_A, BRANCH_B])
    expect(userOf(requests[3])).toContain(`数量过多（${TAIL + 1} > ${TAIL}）`)
  })

  it('★ 少给选择点那一格也进不来（九格是主干那一段的一部分）', async () => {
    const noChoice = JSON.stringify({ pages: mainPages() })
    const { requests } = await run([JSON.stringify(OUTLINE), noChoice, MAIN, BRANCH_A, BRANCH_B])
    expect(userOf(requests[2])).toContain('choice：应为对象，实际是 缺失')
  })
})

describe('内容审核：只重写被标的那一段', () => {
  /** A 支第 2 页（书上第 4 页）写了一句命中 R-03 的话 */
  const flaggedA = JSON.stringify({
    pages: tailPages(CHOICE_PAGE + 1).map((one, index) =>
      index === 1 ? page(CHOICE_PAGE + 2, { body: ['他吓得半死。'] }) : one,
    ),
  })

  it('★ 审核标了 A 支的一页 → 只重发 A 支（主干与 B 支一次都不重发）', async () => {
    // 脚本顺序：提纲 → 主干 → A（被标）→ A（改好）→ B
    const { outcome, requests } = await run([
      JSON.stringify(OUTLINE),
      MAIN,
      flaggedA,
      BRANCH_A,
      BRANCH_B,
    ])

    expect(requests).toHaveLength(5)
    expect(userOf(requests[3])).toContain('这一次只写这一段：A 支')
    expect(userOf(requests[3])).toContain('内容审核没过')
    expect(userOf(requests[3])).toContain('R-03')
    // 主干与 B 支各只发了一次（B 在 A 改好之后才写）
    expect(userOf(requests[1])).toContain(`主干，共 ${CHOICE_PAGE} 页`)
    expect(userOf(requests[4])).toContain(`B 支，共 ${TAIL} 页`)
    expect(outcome.doc.nodes).toHaveLength(CHOICE_PAGE + TAIL * 2)
    expect(outcome.attempts).toBe(5)
  })

  it('★ `block` 那一类当场拒发：B 支一个字都不写、也不重试', async () => {
    const blocked = JSON.stringify({
      pages: tailPages(CHOICE_PAGE + 1).map((one, index) =>
        index === 0 ? page(CHOICE_PAGE + 1, { body: ['他说他想自杀。'] }) : one,
      ),
    })
    const { text, requests } = scripted([JSON.stringify(OUTLINE), MAIN, blocked, BRANCH_B])
    const { emit } = collector()
    await expect(planStory(INPUT, { text, form: 'shared', emit })).rejects.toMatchObject({
      code: 'review-blocked',
    })
    // 提纲、主干、A 支——A 支一被拦下就停了，B 支与重试都没有发生
    expect(requests).toHaveLength(3)
  })

  it('书名在提纲那一步就审，不拖到三段都写完', async () => {
    const badTitle = JSON.stringify({ ...OUTLINE, title: '他死掉的那天' })
    const { requests } = await run([badTitle, JSON.stringify(OUTLINE), MAIN, BRANCH_A, BRANCH_B])
    expect(requests).toHaveLength(5)
    expect(userOf(requests[1])).toContain('书名没过内容审核')
  })
})
