/**
 * tree-pages.test.ts —— 页数是判据（2026-10-21，工单 D-08）
 *
 * 在这之前**页数一个数都不查**：请求 2 页拿到 3 页、横评里要 6 给 7、`--pages=8` 那次
 * 长出 14 个节点（选择点在第 6 页 → 每条路 10 页），全都照收。它不是审美问题——
 * 出图是这条流水线上唯一真花钱的一步，多出来的每一页 0.2 元，而书上、屏幕上
 * 没有任何东西提示"这一本比你要的长"。
 *
 * 这一支钉四件事，每一件都配了**证伪点**（少了它，把检查删掉也照样绿）：
 *
 * | 钉什么 | 怎么证伪 |
 * | --- | --- |
 * | N+1 页被判不合法，话里带两个数 | 那个数**不许**从消息里消失（消息是模型改稿的唯一依据） |
 * | 独读版：页数 = 表里节点数 | 传对的时候必须 ok |
 * | 共读版：量的是**一条路**，不是表里几个节点 | 6 个节点、两条路各 4 页，`pages=4` 必须 **ok** |
 * | 拒绝进得了重试提示 | 断言**第二次请求的 user 正文**，不是断言库里那个对象 |
 *
 * 最后一条是这一单的判据原话（"拒绝要能被重试提示点名"）：`buildTree` 返回得漂亮
 * 而 `planStory` 没把话拼进下一次请求，页数这一条就只是"多花两次文本调用然后报错"。
 */

import { describe, expect, it } from 'vitest'

import { buildTree } from './tree.ts'
import { planStory } from './plan.ts'
import type { NodeDraft } from '../schemas/story.ts'
import type { StoryPlanInput } from '../prompts/story-plan.ts'
import type { EngineEventPayload } from './events.ts'
import type { TextGenerator, TextRequest, TextResponse } from './providers/types.ts'

/** 一页。`extra` 用来加 `from` / `via` / 选择点那九格 */
function node(scene: string, extra: Record<string, unknown> = {}): NodeDraft {
  return {
    scene,
    body: [`${scene}。`],
    imagePrompt: `画面：${scene}`,
    mood: 'wonder',
    ...extra,
  } as unknown as NodeDraft
}

/** 独读版：三页一条链 */
const SOLO3: NodeDraft[] = [node('第一页'), node('第二页'), node('第三页')]

/**
 * 共读版：**6 个节点、两条路各 4 页**（形状抄盘上那本演示书 `xiaoyu-r1-6ca00a33b4d7`）。
 * 选择点在第 2 页，两支各带两页尾巴——所以"表里几页"与"读下来几页"在这份夹具上
 * 明确是两个数（6 与 4），于是任何"数节点"的实现都会在这里露馅。
 */
const SHARED6: NodeDraft[] = [
  node('第一页'),
  node('第二页', {
    ask: '走哪一条？',
    labelA: '左边',
    spokenA: '走左边',
    labelB: '右边',
    spokenB: '走右边',
  }),
  node('第三页', { from: 2, via: 'a' }),
  node('第四页', { from: 3, via: 'a' }),
  node('第五页', { from: 2, via: 'b' }),
  node('第六页', { from: 5, via: 'b' }),
]

const problemsOf = (result: ReturnType<typeof buildTree>): string =>
  result.ok ? '' : result.problems.map((problem) => problem.message).join('\n')

describe('buildTree · 页数（工单 D-08）', () => {
  it('独读版：页数对得上就过', () => {
    expect(buildTree('solo', '三页的书', SOLO3, 3).ok).toBe(true)
  })

  it('★ 独读版：N+1 页被拒，话里两个数都在', () => {
    const result = buildTree('solo', '三页的书', SOLO3, 4)
    expect(result.ok).toBe(false)
    // 两个数缺一不可：只说"页数不对"的话，模型没有可照着改的东西
    expect(problemsOf(result)).toContain('页数 3 ≠ 请求 4')
  })

  it('独读版：N−1 页也拒（少一页同样是另一本书，而且它省钱省在读者身上）', () => {
    const result = buildTree('solo', '三页的书', SOLO3, 2)
    expect(result.ok).toBe(false)
    expect(problemsOf(result)).toContain('页数 3 ≠ 请求 2')
  })

  it('不传页数 = 不查（老调用点、以及不知道请求页数的那些路）', () => {
    expect(buildTree('solo', '三页的书', SOLO3).ok).toBe(true)
    expect(buildTree('shared', '六页的树', SHARED6).ok).toBe(true)
  })

  it('★ 共读版：量的是**一条路**，不是表里几个节点——6 个节点、两条路各 4 页，请求 4 页必须过', () => {
    const result = buildTree('shared', '六页的树', SHARED6, 4)
    // 这一条是上面那条的反面：拿节点数（6）去卡的话，这一份**正确**的共读版会被判错，
    //   而它正是提示词里写的形状（"表里的页数会比 {pages} 多几页"）
    expect(result.ok, problemsOf(result)).toBe(true)
    expect(result.ok && result.tree.nodes.length).toBe(6)
  })

  it('★ 共读版：请求 8 页而两条路各 4 页 → 拒，且说清"表里几个节点不算数"', () => {
    const result = buildTree('shared', '六页的树', SHARED6, 8)
    expect(result.ok).toBe(false)
    const message = problemsOf(result)
    expect(message).toContain('都是 4 页')
    expect(message).toContain('≠ 请求 8')
    // 模型上一版交了 6 页，而它没有理由知道我们数的是哪一份——所以这句话必须自己说清
    expect(message).toContain('表里 6 个节点')
  })

  /**
   * ★ 把**它自己那一版**的算式算给它看（2026-10-21 补）。
   *
   * 实测依据：`story-plan@v6` 已经把公式写进提示词，模型照样每次差一页
   * （请求 4 → 它写 5/5、5/5、6/6 三遍）。它读得懂公式，读不懂"我这一版错在哪"。
   * 这三行数字是它能直接改的那三个：每支该写几页、它写了几页、表里该有几个节点。
   */
  it('★ 拒绝里带着"这一版的算式"（选择点第几页 → 每支几页 → 表里几个节点 + 怎么改）', () => {
    const message = problemsOf(buildTree('shared', '六页的树', SHARED6, 8))
    // SHARED6：选择点在第 2 页、两条路各 4 页、表里 6 个节点
    expect(message).toContain('选择点在第 2 页')
    expect(message).toContain('每支应各写 6 页')
    expect(message).toContain('这一版写了 2 页')
    expect(message).toContain('表里应正好 14 个节点')
    expect(message).toContain('这一版 6 个')
    // 差几页 + 怎么改：这是模型下一版真正照着做的那一句（实测失败形状是"每支多写一页"）
    expect(message).toContain('补 4 页')
  })

  /**
   * ★ 共读版**不再有 ±1 容差**（2026-10-22 撤回）。
   *
   * 那条容差是 2026-10-21 给旧的一次性路径打的补丁：模型数不准页数，严格相等时 20 页这一档
   * 几乎发不出去。现在共读版走两步规划（`plan-shared.ts`），页数是构造出来的
   * （主干 C 行 + 每支 pages−C 行），容差只可能掩盖装配 bug——所以撤掉了。
   * 这一对用例把两头都钉住：差一页也拒，两页更拒。
   */
  it('共读版：两支差一页也拒（页数是构造出来的，差一页就是另一本书）', () => {
    const uneven: NodeDraft[] = [...SHARED6, node('第七页', { from: 6, via: 'b' })]
    const result = buildTree('shared', '七页的树', uneven, 4)
    expect(result.ok).toBe(false)
    expect(problemsOf(result)).toContain('两条路读下来 4 页 / 5 页')
  })

  it('共读版：差两页同样拒，且两个数都摆出来', () => {
    const uneven: NodeDraft[] = [...SHARED6, node('第七页', { from: 6, via: 'b' })]
    const result = buildTree('shared', '七页的树', uneven, 3)
    expect(result.ok).toBe(false)
    expect(problemsOf(result)).toContain('两条路读下来 4 页 / 5 页')
  })
})

/* 规划那一步：这句话要真的进到下一次请求里 */

const INPUT: StoryPlanInput = {
  childName: '小乐',
  nameReading: 'xiǎo lè',
  ageBand: '4-6',
  interestTags: ['云'],
  lookTags: ['短发'],
  theme: 'cloud',
  form: 'solo',
  pages: 4,
}

/** 每次调用把请求原样记下来——判据要读的是**发出去的那份提示词**，不是引擎里的对象 */
function recordingText(plan: readonly string[]): {
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
      async complete(req: TextRequest): Promise<TextResponse> {
        requests.push(req)
        const text = plan[Math.min(index, plan.length - 1)] ?? ''
        index += 1
        return { text, modelId: 'fake-text' }
      },
      async stream() {
        throw new Error('这一支不走流式')
      },
    },
  }
}

/**
 * 规划那一层的剧本要用**过得了 schema** 的页：`scene` 至少 4 个字、`imagePrompt` 至少 8 个
 * （见 `schemas/story.ts`）。★ 第一版这里写的是 `node('一')`，于是三条用例全红在
 * "scene 过短"上——而它们要测的是页数。夹具不合规时，红的地方不是被测的那件事。
 */
const page = (n: number) => ({
  scene: `第 ${n} 页的场景`,
  body: [`第 ${n} 页的正文。`],
  imagePrompt: `第 ${n} 页的画面：孩子与一朵云`,
  mood: 'wonder',
})
const storyOf = (title: string, count: number): string =>
  JSON.stringify({ title, nodes: Array.from({ length: count }, (_, i) => page(i + 1)) })

const fourPages = storyOf('四页的书', 4)

describe('planStory · 页数那条话进得了重试（工单 D-08 判据）', () => {
  it('★ 第一次多写一页、第二次写对 → 第二次请求的正文里带着"页数 5 ≠ 请求 4"', async () => {
    const { text, requests } = recordingText([storyOf('五页的书', 5), fourPages])
    const events: EngineEventPayload[] = []
    const plan = await planStory(INPUT, {
      text,
      form: 'solo',
      maxAttempts: 3,
      emit: (payload) => events.push(payload),
    })

    expect(plan.tree.nodes.length).toBe(4)
    expect(requests).toHaveLength(2)
    // 第一次那一份 prompt 里当然没有这句话（那时还没人报错）
    expect(userOf(requests[0])).not.toContain('页数 5')
    // 第二次带上了问题清单，而且点名了两个数
    expect(userOf(requests[1])).toContain('页数 5 ≠ 请求 4')
    // 事件流上也要有一条"正在重写"，否则界面上这一版是凭空变出来的
    expect(events.filter((event) => event.kind === 'retry')).toHaveLength(1)
  })

  it('三次都多写 → 抛出来的错误里那句话逐字还在', async () => {
    const { text, requests } = recordingText([storyOf('五页的书', 5)])
    const error: unknown = await planStory(INPUT, {
      text,
      form: 'solo',
      maxAttempts: 3,
      emit: () => undefined,
    }).then(
      () => null,
      (err: unknown) => err,
    )
    expect(requests).toHaveLength(3)
    expect(String((error as { message?: string })?.message)).toContain('页数 5 ≠ 请求 4')
  })
})

/** 一次请求的正文。两种形状都收（`{system,user}` 与 `{messages}`） */
function userOf(request: TextRequest | undefined): string {
  if (!request) return ''
  if (request.user !== undefined) return request.user
  return request.messages
    .map((message) => ('content' in message ? String(message.content) : ''))
    .join('\n')
}
