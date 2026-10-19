/**
 * frames.test.ts —— 事件流折叠成画桌的那三条判据
 *
 * 两类用例，各管一件事：
 *
 * 1. **真跑过的那条流**（`fixtures/stub-run.events.ts`，19 条，`--mode=stub` 录的）。
 *    手写用例能表达规则，表达不了"引擎实际怎么发"——比如"核对没有 stage 事件"
 *    这件事，只有真流能证明。
 * 2. **手写的边界**。真流里没有重画（stub 替身永远一次过），也没有乱序，
 *    所以"重画覆盖同一格""页码比计划多出来"这些只能手写。
 *
 * ★ 这里不测文案（那是 `engine/events.ts` 的 `describeEvent` 的事，引擎侧有它自己的守卫）。
 *   测的是**结构**：哪一格、有几格、哪一格在忙、哪句话落在哪里。
 */

import { describe, expect, it } from 'vitest'

import type { EngineEvent, EngineEventPayload } from '@/lib/engine/events.ts'

import {
  deskOf,
  drawnCount,
  drawnRatio,
  hasBranches,
  EMPTY_DESK,
  railOf,
  storyDeskOf,
  toneOf,
  withStoryTitle,
} from './frames.ts'
import { STUB_RUN_EVENTS } from './fixtures/stub-run.events.ts'

/** 造事件：`seq` 自增，`stage` 默认跟着走。与引擎的工厂同一形状，但只填用得上的 */
function stream(payloads: EngineEventPayload[]): EngineEvent[] {
  return payloads.map((payload, index) => {
    const { stage = 'illustrating', ...rest } = payload
    return { seq: index + 1, at: 1_700_000_000_000 + index, stage, ...rest } as EngineEvent
  })
}

describe('真跑过的那条流（19 条，--mode=stub）', () => {
  const desk = deskOf(STUB_RUN_EVENTS)

  it('格子数是 plan-ready 说的那个数，且按页码排好', () => {
    expect(desk.total).toBe(5)
    expect(desk.frames.map((frame) => frame.pageNo)).toEqual([1, 2, 3, 4, 5])
  })

  it('书名与成品都从事件里来', () => {
    expect(desk.title).toBe('小宇的云')
    expect(desk.ready?.bookId).toBe('xiaolu-r1-3befb9c2a76b')
    // 封面就是第 1 页那张画：书里没有另一张封面资产
    expect(desk.ready?.coverPath).toBe(desk.frames[0]?.assetPath)
    expect(desk.fatal).toBeNull()
  })

  it('五格都填上了图，每格一句"没法核对"', () => {
    expect(drawnCount(desk)).toBe(5)
    for (const frame of desk.frames) {
      expect(frame.assetPath).toMatch(/^books\//)
      expect(frame.note).toContain('没法核对')
      expect(frame.noteTone).toBe('info')
    }
  })

  it('★ 不带页码的阶段事件一格都没占', () => {
    // 19 条里第 1 条（planning begin）与最后一条（book-ready）都没有页码。
    // 它们要是各占一格，屏幕上会出现"第 6 格：正在编故事"
    expect(desk.frames).toHaveLength(5)
    expect(desk.stageLine).toBe('书做好了：xiaolu-r1-3befb9c2a76b')
    expect(desk.stageRunning).toBe(false)
  })

  it('★ 配音那条非致命错误落在 notes 里，没被丢掉、也没占格', () => {
    // 这一条**没有页码**（配音是整本书的事），所以它没有任何格子可去。
    // 画桌不摆文字日志之后，这里是它唯一的去处——丢了它，家长就看不到"这本书没有朗读"
    expect(desk.notes).toHaveLength(1)
    expect(desk.notes[0]?.text).toContain('没有朗读')
    expect(desk.notes[0]?.tone).toBe('warn')
  })

  it('★ 两段没有 stage 事件的阶段（配音、装订）也认得出来', () => {
    // narrating / assembling 只有 error 与 book-ready 的**头部**标着它们。
    // 只读 stage 事件的话，这里会停在 illustrating
    expect(desk.stage).toBe('assembling')
  })

  it('跑完之后没有哪一格还在"正在画"', () => {
    expect(desk.frames.every((frame) => frame.busy === null)).toBe(true)
  })

  it('还没配音（这一轮 TTS 没配），所以没有哪一格有喇叭', () => {
    expect(desk.frames.some((frame) => frame.narrated)).toBe(false)
  })
})

describe('★ 重画是覆盖同一格，不是多长一格', () => {
  const desk = deskOf(
    stream([
      {
        kind: 'plan-ready',
        stage: 'planning',
        form: 'solo',
        title: '小满',
        nodeCount: 2,
        choicePages: [],
      },
      { kind: 'stage', phase: 'begin', pageNo: 1 },
      {
        kind: 'illustration',
        pageNo: 1,
        attempt: 1,
        assetPath: 'books/b/page-1-a1.webp',
        modelId: 'm',
      },
      {
        kind: 'consistency',
        stage: 'checking',
        pageNo: 1,
        attempt: 1,
        score: 0.4,
        verdict: 'fail',
        threshold: 0.75,
        missedAnchors: ['发型'],
      },
      { kind: 'retry', stage: 'retrying', pageNo: 1, attempt: 2, maxAttempts: 3, reason: '不太像' },
      { kind: 'stage', phase: 'begin', pageNo: 1 },
      {
        kind: 'illustration',
        pageNo: 1,
        attempt: 2,
        assetPath: 'books/b/page-1-a2.webp',
        modelId: 'm',
      },
      {
        kind: 'consistency',
        stage: 'checking',
        pageNo: 1,
        attempt: 2,
        score: 0.91,
        verdict: 'pass',
        threshold: 0.75,
        missedAnchors: [],
      },
    ]),
  )

  it('还是 2 格（不是 4 格），第 1 页换成了第 2 张图', () => {
    expect(desk.total).toBe(2)
    expect(desk.frames.map((frame) => frame.pageNo)).toEqual([1, 2])
    expect(desk.frames[0]?.assetPath).toBe('books/b/page-1-a2.webp')
    expect(desk.frames[0]?.attempt).toBe(2)
  })

  it('★ 新图到了，上一版那句"不太像 / 正在重画"要让位（它说的是上一张图）', () => {
    // 最后的 consistency 是 pass，不占格；而新 illustration 已经把之前的 note 清掉了。
    // 不清的话，这一格会永远挂着一句"第 1 页不太像（0.40 < 0.75）"——而它已经像了
    expect(desk.frames[0]?.note).toBeNull()
  })

  it('另一格始终是空的（没画到就是没画到）', () => {
    expect(desk.frames[1]?.assetPath).toBeNull()
    expect(desk.frames[1]?.busy).toBeNull()
  })
})

describe('重画途中那一格的样子', () => {
  const desk = deskOf(
    stream([
      {
        kind: 'plan-ready',
        stage: 'planning',
        form: 'solo',
        title: '小满',
        nodeCount: 1,
        choicePages: [],
      },
      {
        kind: 'illustration',
        pageNo: 1,
        attempt: 1,
        assetPath: 'books/b/page-1-a1.webp',
        modelId: 'm',
      },
      {
        kind: 'consistency',
        stage: 'checking',
        pageNo: 1,
        attempt: 1,
        score: 0.4,
        verdict: 'fail',
        threshold: 0.75,
        missedAnchors: [],
      },
      { kind: 'retry', stage: 'retrying', pageNo: 1, attempt: 2, maxAttempts: 3, reason: '不太像' },
    ]),
  )

  it('★ 说得出"正在重画第几次"，而且那一格是忙的', () => {
    const frame = desk.frames[0]
    expect(frame?.busy).toBe('drawing')
    expect(frame?.note).toContain('第 2 / 3 次')
    expect(frame?.noteTone).toBe('warn')
    // 图还是上一版那张——新版还没回来，界面不能假装有了
    expect(frame?.assetPath).toBe('books/b/page-1-a1.webp')
  })
})

/**
 * ★ 2026-10-18：**编故事**那一段的失败（用户圈出来的那一行）。
 *
 * 在那之前它是一句"不太像，正在重画（第 1 / 3 次）：故事结构不对（1 处）"，
 * 落在画桌**最底下**（`notes`：不属于任何一页的提醒）——用户的原话是
 * "这个错误提示怎么跑到最下面了，用户怎么知道是哪个画出错了"：
 * 他以为某张图出了错，而那一刻一张图都还没画（那是模型交回的故事表不合法，
 * 整篇要重写）。所以现在它有一格自己的位置（`desk.planning`），紧跟"正在编故事"那一行。
 */
describe('编故事那一段失败过一次', () => {
  const RETRY = {
    kind: 'retry',
    stage: 'planning',
    attempt: 1,
    maxAttempts: 3,
    reason: '故事结构不对（1 处）',
  } as const

  it('★ 它进 `planning`，**不进**最底下那一栏 notes（那里离它说的事最远）', () => {
    const desk = deskOf(stream([{ kind: 'stage', stage: 'planning', phase: 'begin' }, RETRY]))
    expect(desk.planning).toBe(
      '这一版故事没通过校验，正在重写（第 1 / 3 次）：故事结构不对（1 处）',
    )
    expect(desk.notes).toEqual([])
  })

  it('★ 故事写成了它就作废（`plan-ready` 一到，屏幕上不该还挂着上一版的失败）', () => {
    const desk = deskOf(
      stream([
        { kind: 'stage', stage: 'planning', phase: 'begin' },
        RETRY,
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: '云上的小路',
          nodeCount: 3,
          choicePages: [],
        },
      ]),
    )
    expect(desk.planning).toBeNull()
    // 而画桌本身照旧（书名、格子数都在）
    expect(desk.title).toBe('云上的小路')
    expect(desk.total).toBe(3)
  })

  it('重写两次只剩最后一次（屏幕不是过程面板，两次失败长得一样）', () => {
    const desk = deskOf(stream([RETRY, { ...RETRY, attempt: 2, reason: '故事表格式不对（2 处）' }]))
    expect(desk.planning).toContain('第 2 / 3 次')
    expect(desk.planning).toContain('故事表格式不对（2 处）')
  })

  it('出图期的 retry 照旧落在那一格上（这一条没被碰坏）', () => {
    const desk = deskOf(
      stream([
        {
          kind: 'retry',
          stage: 'retrying',
          pageNo: 2,
          attempt: 2,
          maxAttempts: 3,
          reason: '不太像',
        },
      ]),
    )
    expect(desk.planning).toBeNull()
    // ★ 按页码找那一格，不按数组下标：这一条流里没有 plan-ready，
    //   所以整排只有"被点到的那一格"（`frameFor` 只造它自己）
    expect(desk.frames.find((one) => one.pageNo === 2)?.note).toContain('第 2 / 3 次')
  })
})

/**
 * ★ 2026-10-19（`.scratch/rag` 工单 04）：检索那两条事件在画桌上落在哪儿。
 *
 * 判据只有一条：**它们不占格子**。阶段轨那 4 格说的是"这本书做到哪一步了"，
 * 而检索是"编故事"内部的一步（只发生一次）——所以它进 `desk.planning`，
 * 与规划期的 `retry` 同一个位置（那一处的注释写了这条判断的来龙去脉）。
 */
describe('检索那一步：不占格子，说的是人话', () => {
  it('`stage: retrieving` 更新顶上那一行，不碰任何一格', () => {
    const desk = deskOf(stream([{ kind: 'stage', stage: 'retrieving', phase: 'begin' }]))
    expect(desk.stageLine).toBe('正在翻以前写过的故事…')
    expect(desk.frames).toEqual([])
    expect(desk.notes).toEqual([])
  })

  it('★ 取到了：进 `desk.planning`（"正在编故事"那一行底下），不进 notes', () => {
    const desk = deskOf(
      stream([
        { kind: 'stage', stage: 'retrieving', phase: 'begin' },
        {
          kind: 'retrieved',
          stage: 'retrieving',
          corpusVersion: 'adfab4685031',
          examples: 2,
          avoids: 1,
          topScore: 9.52,
        },
      ]),
    )
    expect(desk.planning).toBe('翻到了 2 段可以照着写的、1 段他读过的（这本避开）')
    expect(desk.notes).toEqual([])
  })

  it('★ 空结果是合法结果，屏幕上也要这么说（不是"检索失败"）', () => {
    const empty = deskOf(
      stream([
        {
          kind: 'retrieved',
          stage: 'retrieving',
          corpusVersion: 'adfab4685031',
          examples: 0,
          avoids: 0,
          topScore: null,
        },
      ]),
    )
    expect(empty.planning).toBe('以前的故事里没有相近的（这次没有可参考的）')
  })

  it('★ 没检索成（`corpusVersion: null`）说的是另一句话——两件事不许混', () => {
    const failed = deskOf(
      stream([
        {
          kind: 'retrieved',
          stage: 'retrieving',
          corpusVersion: null,
          examples: 0,
          avoids: 0,
          topScore: null,
        },
      ]),
    )
    expect(failed.planning).toBe('这次没翻成以前的故事（照常往下编）')
  })
})

/**
 * ★ 2026-10-19（`.scratch/rag` 工单 05）：**编故事那一段的内容审核**。
 *
 * 位置与规划期的 `retry` 是同一个（都是"编故事那一格里的一件事"），
 * 但它说的是**另一种失败**：不是格式不对，是"这一版不能给孩子看"。
 * 分开的理由写在 `errors.ts` 的 `review-blocked` 那条：
 * 前者"再点一次"，后者"换一个说法"——合成一句，家长会一直点重试。
 */
describe('审核没过：编故事那一段的事，不占格子', () => {
  it('`stage: planning` 的 review 进 `desk.planning`，并且带着条款与命中的词', () => {
    const desk = deskOf(
      stream([
        {
          kind: 'review',
          stage: 'planning',
          check: 'safety',
          verdict: 'flag',
          reason: '第 1 页：恐怖（R-01）——出现了「血」',
        },
      ]),
    )
    expect(desk.planning).toBe('第 1 页：恐怖（R-01）——出现了「血」')
    expect(desk.notes).toEqual([])
    expect(desk.frames).toEqual([])
  })

  it('通过的审核一个字都不说（`isDisplayable` 已经这么定了，这里不再判一遍）', () => {
    const desk = deskOf(
      stream([{ kind: 'review', stage: 'auditing', check: 'safety', verdict: 'pass' }]),
    )
    expect(desk.planning).toBeNull()
    expect(desk.notes).toEqual([])
    expect(desk.frames).toEqual([])
  })

  it('★ 工具调用进「编故事」那一行，**不占阶段轨的格子**（与 `retrieved` 同一条处置）', () => {
    const desk = deskOf(
      stream([
        { kind: 'stage', stage: 'planning', phase: 'begin' },
        {
          kind: 'tool',
          stage: 'planning',
          name: 'search_past_stories',
          ok: true,
          ms: 1200,
        },
      ]),
    )
    // 人话来自 `describeEvent`，这里只钉住"它落在哪一格"
    expect(desk.planning).toBe('查了一下「search_past_stories」（1.2 秒）')
    // 阶段轨没有多出节点——一个只亮一次的节点是骗人的（`retrieving` 那段注释）
    expect(desk.frames).toEqual([])
    expect(desk.notes).toEqual([])
  })

  it('工具没跑成：进同一行，且**不是**红（模型会自己改，它不是"这一轮坏了"）', () => {
    const desk = deskOf(
      stream([
        {
          kind: 'tool',
          stage: 'planning',
          name: 'read_shelf',
          ok: false,
          ms: 30,
          note: '盘读不出来',
        },
      ]),
    )
    expect(desk.planning).toContain('盘读不出来')
    expect(desk.notes).toEqual([])
  })
})

describe('页码来得不如预期时：不丢、不乱序、不凭空造', () => {
  it('★ illustration 早于 plan-ready：那张图不丢，格子仍按页码排', () => {
    // 现实中不会这么发。但"顺序不如预期"时**丢数据**比"多一格"坏得多：
    // 丢的是家长已经付过钱的那张图。
    // ★ 按到达顺序排的话，第 2 页会画在第一个格子里，而屏幕上没有任何提示——
    //   只有家长自己发现顺序反了。所以 `deskOf` 最后按页码排一次
    const desk = deskOf(
      stream([
        {
          kind: 'illustration',
          pageNo: 2,
          attempt: 1,
          assetPath: 'books/b/page-2-a1.webp',
          modelId: 'm',
        },
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: '小满',
          nodeCount: 3,
          choicePages: [],
        },
      ]),
    )
    expect(desk.total).toBe(3)
    expect(desk.frames.map((frame) => frame.pageNo)).toEqual([1, 2, 3])
    expect(desk.frames[1]?.assetPath).toBe('books/b/page-2-a1.webp')
  })

  it('plan-ready 说了 3 页、实际画到第 5 页：那张图**不许丢**，总格数跟着抬上去', () => {
    const desk = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: '小满',
          nodeCount: 3,
          choicePages: [],
        },
        {
          kind: 'illustration',
          pageNo: 5,
          attempt: 1,
          assetPath: 'books/b/page-5-a1.webp',
          modelId: 'm',
        },
      ]),
    )
    // 丢掉它的后果是家长已经付过钱的那张图再也看不见了。
    // ★ 第 4 格**不补**：计划里没有第 4 页，凭空造一格就是编一个不存在的东西。
    //   格子各自带着页码，所以中间有个缺口是**看得出来**的
    expect(desk.frames.map((frame) => frame.pageNo)).toEqual([1, 2, 3, 5])
    expect(desk.frames[3]?.assetPath).toBe('books/b/page-5-a1.webp')
    // 上面那句"k / N 页"里的 N 是 total：它必须至少盖住出现过的最大的页码，
    // 否则会出现"写着 3 页、下面有 4 格"
    expect(desk.total).toBe(5)
  })

  it('致命错误不进任何一格，它整轮结束了', () => {
    const desk = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: '小满',
          nodeCount: 2,
          choicePages: [],
        },
        {
          kind: 'error',
          stage: 'planning',
          code: 'provider-call-failed',
          message: '模型没配',
          fatal: true,
        },
      ]),
    )
    expect(desk.fatal).toBe('模型没配')
    expect(desk.notes).toHaveLength(0)
    expect(desk.frames.every((frame) => frame.note === null)).toBe(true)
  })

  it('配好音的那一格有喇叭', () => {
    const desk = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: '小满',
          nodeCount: 2,
          choicePages: [],
        },
        {
          kind: 'narration',
          stage: 'narrating',
          pageNo: 2,
          voiceId: 'v',
          assetPath: 'books/b/page-2.mp3',
          reused: true,
        },
      ]),
    )
    expect(desk.frames.map((frame) => frame.narrated)).toEqual([false, true])
  })

  it('空流 → 空桌（没有"未知"这种东西）', () => {
    expect(deskOf([])).toEqual(EMPTY_DESK)
  })
})

describe('★ 第 N 页正在配音（工单 01 新加的那条分页 stage）', () => {
  const desk = deskOf(
    stream([
      {
        kind: 'plan-ready',
        stage: 'planning',
        form: 'solo',
        title: '小满',
        nodeCount: 2,
        choicePages: [],
      },
      {
        kind: 'illustration',
        pageNo: 1,
        attempt: 1,
        assetPath: 'books/b/page-1-a1.webp',
        modelId: 'm',
      },
      // 合成前后那两条**带页码**的 stage，是 `narrateNode` 发的。
      // 原来是整本一条不带页码的 begin/end，所以没有任何东西说得清"这一页正在配音"
      { kind: 'stage', stage: 'narrating', phase: 'begin', pageNo: 1 },
    ]),
  )

  it('那一格是忙的，而且是"在配音"不是"在画"', () => {
    expect(desk.frames[0]?.busy).toBe('voicing')
    // 另一格没轮到，不许被带着一起忙
    expect(desk.frames[1]?.busy).toBeNull()
  })

  it('★ 收尾那条一到，它就不忙了（失败时也要到——`narrateNode` 把它放在 finally 里）', () => {
    // 不放到 finally 的话，合成失败的那一页会永远停在"正在配音"上转
    const ended = deskOf(
      stream([
        { kind: 'stage', stage: 'narrating', phase: 'begin', pageNo: 1 },
        { kind: 'stage', stage: 'narrating', phase: 'end', pageNo: 1 },
      ]),
    )
    expect(ended.frames[0]?.busy).toBeNull()
  })

  it('不带页码的那一对仍然一格都不占（整本那一轮的老行为没变）', () => {
    const whole = deskOf(
      stream([
        { kind: 'stage', stage: 'narrating', phase: 'begin' },
        { kind: 'stage', stage: 'narrating', phase: 'end' },
      ]),
    )
    expect(whole.frames).toHaveLength(0)
  })
})

describe('阶段轨（4 格，不是原型里那 5 个节点）', () => {
  const planned = stream([
    {
      kind: 'plan-ready',
      stage: 'planning',
      form: 'solo',
      title: '小满',
      nodeCount: 2,
      choicePages: [],
    },
  ])

  it('还没开始：四格全是 todo', () => {
    expect(railOf(EMPTY_DESK, true).map((node) => node.state)).toEqual([
      'todo',
      'todo',
      'todo',
      'todo',
    ])
  })

  it('★ 只有「编故事」那一格是 now——「逐页画」不许跟着亮', () => {
    // `desk.stage` 是"最新一条事件的头部"，它说 planning 就是 planning。
    // 把"计划好了"顺带算成"正在画"的话，界面上会同时有两条在转
    const rail = railOf(
      deskOf(stream([{ kind: 'stage', stage: 'planning', phase: 'begin' }])),
      true,
    )
    expect(rail.map((node) => node.state)).toEqual(['now', 'todo', 'todo', 'todo'])
  })

  it('书名一到，「编故事」就是 done（那是 plan-ready 说的）', () => {
    const rail = railOf(deskOf(planned), true)
    expect(rail[0]?.state).toBe('done')
  })

  it('★ 「逐页画」带的是真数 k / N，不是另编一根百分比条', () => {
    const desk = deskOf(
      stream([
        ...planned,
        { kind: 'stage', phase: 'begin', pageNo: 1 },
        {
          kind: 'illustration',
          pageNo: 1,
          attempt: 1,
          assetPath: 'books/b/page-1-a1.webp',
          modelId: 'm',
        },
      ]),
    )
    const rail = railOf(desk, true)
    expect(rail[1]?.state).toBe('now')
    expect(rail[1]?.note).toBe('1 / 2')
  })

  it('两页都画好之后，「逐页画」是 done', () => {
    const desk = deskOf(
      stream([
        ...planned,
        { kind: 'illustration', pageNo: 1, attempt: 1, assetPath: 'a', modelId: 'm' },
        { kind: 'illustration', pageNo: 2, attempt: 1, assetPath: 'b', modelId: 'm' },
      ]),
    )
    expect(railOf(desk, true)[1]?.state).toBe('done')
  })

  it('★ 核对不是一格：`checking` 只让「逐页画」保持 now', () => {
    // 引擎的核对是每页画完立刻比的，做成节点会 20 页闪 40 次。
    // 核对是**某一页的事**，它留在那一格的 note 上
    const desk = deskOf(
      stream([...planned, { kind: 'stage', stage: 'checking', phase: 'begin', pageNo: 1 }]),
    )
    const rail = railOf(desk, true)
    expect(rail.map((node) => node.key)).toEqual([
      'planning',
      'illustrating',
      'narrating',
      'assembling',
    ])
    expect(rail[1]?.state).toBe('now')
  })

  it('★ 关掉朗读时「配音」是 skipped 并写着"不配音"，不是灰着不说', () => {
    const rail = railOf(deskOf(planned), false)
    expect(rail[2]?.state).toBe('skipped')
    expect(rail[2]?.note).toBe('不配音')
  })

  it('★ 书装订完了还有页没配上音 → partial（"没做成"，不是"还没轮到"）', () => {
    // 配音失败是**非致命**的（narrate.ts 规则 3）：书照样装订，但那几页真的没有声音。
    // 报成 todo 的话它会一直显示成"排队中"，而队列早就空了
    const desk = deskOf(
      stream([
        ...planned,
        { kind: 'illustration', pageNo: 1, attempt: 1, assetPath: 'a', modelId: 'm' },
        { kind: 'illustration', pageNo: 2, attempt: 1, assetPath: 'b', modelId: 'm' },
        {
          kind: 'narration',
          stage: 'narrating',
          pageNo: 1,
          voiceId: 'v',
          assetPath: 'a.mp3',
          reused: false,
        },
        {
          kind: 'book-ready',
          stage: 'assembling',
          bookId: 'b',
          path: 'books/b/book.json',
          stats: {},
        },
      ]),
    )
    const rail = railOf(desk, true)
    expect(rail[2]?.state).toBe('partial')
    expect(rail[2]?.note).toBe('1 / 2')
    expect(rail[3]?.state).toBe('done')
  })

  it('★ 单页重画之后，「装订」不许从完成退回未做', () => {
    // 重画时事件的 stage 会回到 illustrating。若按"事件走到哪一段"推，
    // 装订那一格会退回 todo——而书明明已经装订好了。
    // 所以每一格的判据都来自 desk 里已经成立的事实，不是"最新 stage"
    const desk = deskOf(
      stream([
        ...planned,
        { kind: 'illustration', pageNo: 1, attempt: 1, assetPath: 'a', modelId: 'm' },
        { kind: 'illustration', pageNo: 2, attempt: 1, assetPath: 'b', modelId: 'm' },
        { kind: 'book-ready', stage: 'assembling', bookId: 'b', path: 'p', stats: {} },
        // 重画第 1 页：接着数到第 2 次
        { kind: 'stage', stage: 'illustrating', phase: 'begin', pageNo: 1, attempt: 2 },
      ]),
    )
    const rail = railOf(desk, true)
    expect(rail[1]?.state).toBe('now')
    expect(rail[3]?.state).toBe('done')
  })
})

describe('★ 闸门那一屏：故事草稿造出来的那张桌子（2026-10-17）', () => {
  const story = { title: '绿气球回家', nodes: [{}, {}, {}] }

  it('「编故事」那一格是已完成、「逐页画」是 0 / N —— 一条事件都不需要', () => {
    const rail = railOf(storyDeskOf(story), false)
    expect(rail[0]?.state).toBe('done')
    expect(rail[1]?.state).toBe('todo')
    expect(rail[1]?.note).toBe('0 / 3')
  })

  it('它不摆格子（闸门那一屏的正文是 StorySheet，不是画框）', () => {
    const desk = storyDeskOf(story)
    expect(desk.frames).toEqual([])
    expect(desk.total).toBe(3)
    expect(desk.title).toBe('绿气球回家')
  })

  it('书名对到家长手上那一份：`plan-ready` 说的是①那一版，改过的是这一版', () => {
    // 家长在闸门上把书名改了，②那一条流回的每一帧都把 desk 折回①的书名
    const fromLog = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: '绿气球回家',
          nodeCount: 3,
          choicePages: [],
        },
        { kind: 'illustration', pageNo: 1, attempt: 1, assetPath: 'a', modelId: 'm' },
      ]),
    )
    const shown = withStoryTitle(fromLog, { title: '绿气球回我们家' })
    expect(shown.title).toBe('绿气球回我们家')
    // 只有书名变，格子与格数一点都不动（它是覆一层，不是重折一遍）
    expect(shown.frames).toBe(fromLog.frames)
    expect(shown.total).toBe(3)
  })

  it('没有故事时（画完的那一本从书架进来）原样返回，连对象都不换', () => {
    const desk = deskOf(STUB_RUN_EVENTS)
    expect(withStoryTitle(desk, null)).toBe(desk)
    // 书名本来就一致时也不造新对象（它在 useMemo 里，每次渲染换一张桌子没必要）
    expect(withStoryTitle(desk, { title: '小宇的云' })).toBe(desk)
  })
})

describe('toneOf 与原来那套 data-tone 一致', () => {
  it('非致命错误是提醒，不是红', () => {
    const [notFatal, fatal] = stream([
      { kind: 'error', code: 'x', message: '配音没接上', fatal: false },
      { kind: 'error', code: 'x', message: '崩了', fatal: true },
    ])
    expect(toneOf(notFatal as EngineEvent)).toBe('warn')
    expect(toneOf(fatal as EngineEvent)).toBe('bad')
  })

  it('核对通过不占格，但 tone 仍然是 info（`deskOf` 靠 verdict 判要不要写）', () => {
    const [pass] = stream([
      {
        kind: 'consistency',
        pageNo: 1,
        score: 0.95,
        verdict: 'pass',
        threshold: 0.75,
        missedAnchors: [],
      },
    ])
    expect(toneOf(pass as EngineEvent)).toBe('info')
  })
})

/**
 * ★ 封面不是「第 0 页」（工单 05，2026-10-16 实测抓出来的）。
 *
 * 封面是一次**单独的出图**（3:4 竖版、不比对、不重画，见 `illustrateCover`），
 * 它的事件带 `pageNo: 0`——而 `describeEvent` 早就把这条写成约定了：
 * "`pageNo === 0` 是**封面**的约定，不是'第 0 页'"。可惜 `deskOf` 没跟上：
 * 每一处都只判 `=== undefined`，于是 0 一路当成页号用。
 *
 * 症状是**真跑一本之后**才看得见的（stub 那条流里没有封面事件）：
 * 一键跑完打开运行视图，画桌最前面多了一格写着「0」、里面是那张竖版封面，
 * 而上面的计数写着 **`4 / 3 页画好了`**——3 页的书数出了 4 格。
 */
describe('★ 封面（pageNo: 0）不占格子', () => {
  const desk = deskOf(
    stream([
      {
        kind: 'plan-ready',
        stage: 'planning',
        form: 'solo',
        title: '云朵小船',
        nodeCount: 2,
        choicePages: [],
      },
      {
        kind: 'illustration',
        pageNo: 1,
        attempt: 1,
        assetPath: 'books/b/page-1-a1.png',
        modelId: 'm',
      },
      {
        kind: 'illustration',
        pageNo: 2,
        attempt: 1,
        assetPath: 'books/b/page-2-a1.png',
        modelId: 'm',
      },
      // 封面：一次单独的出图，pageNo 是 0
      { kind: 'illustration', pageNo: 0, attempt: 1, assetPath: 'books/b/cover.png', modelId: 'm' },
    ]),
  )

  it('格子只有 2 个，没有写着「0」的那一格', () => {
    expect(desk.frames.map((frame) => frame.pageNo)).toEqual([1, 2])
  })

  it('★ `k / N` 数是 2 / 2，不是 3 / 2', () => {
    // 计数写错是这一条最刺眼的症状：它一眼就是错的，而页数是对的
    expect(drawnCount(desk)).toBe(2)
    expect(desk.total).toBe(2)
  })

  it('封面落在 `coverPath` 上，仍然是"书做好了"那一块要用的那张', () => {
    const ready = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: 'T',
          nodeCount: 1,
          choicePages: [],
        },
        {
          kind: 'illustration',
          pageNo: 1,
          attempt: 1,
          assetPath: 'books/b/page-1-a1.png',
          modelId: 'm',
        },
        {
          kind: 'illustration',
          pageNo: 0,
          attempt: 1,
          assetPath: 'books/b/cover.png',
          modelId: 'm',
        },
        { kind: 'book-ready', stage: 'assembling', bookId: 'b', path: 'p', stats: {} },
      ]),
    )
    // ★ 优先真封面。退回第 1 页是给**没有封面事件的旧日志**留的路
    expect(ready.ready?.coverPath).toBe('books/b/cover.png')
  })

  it('没有封面事件的旧日志仍然退回第 1 页那张画', () => {
    const legacy = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: 'T',
          nodeCount: 1,
          choicePages: [],
        },
        {
          kind: 'illustration',
          pageNo: 1,
          attempt: 1,
          assetPath: 'books/b/page-1-a1.png',
          modelId: 'm',
        },
        { kind: 'book-ready', stage: 'assembling', bookId: 'b', path: 'p', stats: {} },
      ]),
    )
    expect(legacy.ready?.coverPath).toBe('books/b/page-1-a1.png')
  })

  it('封面那一条 stage(begin, illustrating, 0) 也不让哪一格忙起来', () => {
    const covering = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: 'T',
          nodeCount: 2,
          choicePages: [],
        },
        { kind: 'stage', stage: 'illustrating', phase: 'begin', pageNo: 0, attempt: 1 },
      ]),
    )
    expect(covering.frames).toHaveLength(2)
    expect(covering.frames.every((frame) => frame.busy === null)).toBe(true)
  })
})

/**
 * ★ 进度条那一段的宽度（2026-10-16，用户："正在画怎么空拉拉的，来点交互效果，
 *   比如加个进度条这些的"）。
 *
 * 这一组只钉一件事：**那个宽度是真数算出来的**。它是这轮新加的视觉里唯一会算错的地方
 * ——分母是 0 的时候会不会变成 `NaN`、画好的格数会不会超过总数让它溢出格子。
 * 至于"条上那道走光"说不说得出"还剩多久"，那是 CSS 的事（它只说"在动"），
 * 而"在动"这句话没有数可错。
 */
describe('★ 进度条：那一段有多宽（真数，不是估的）', () => {
  it('还没知道要做几页时是 0，不是 NaN、也不是"先给一半"', () => {
    expect(drawnRatio(EMPTY_DESK)).toBe(0)
    expect(Number.isNaN(drawnRatio(EMPTY_DESK))).toBe(false)
  })

  it('知道页数、一页都还没画好时是 0', () => {
    const desk = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: 'T',
          nodeCount: 7,
          choicePages: [],
        },
      ]),
    )
    expect(desk.total).toBe(7)
    expect(drawnRatio(desk)).toBe(0)
  })

  it('画好 3 页 / 共 7 页 → 3/7', () => {
    const desk = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: 'T',
          nodeCount: 7,
          choicePages: [],
        },
        ...[1, 2, 3].map((pageNo) => ({
          kind: 'illustration' as const,
          stage: 'illustrating' as const,
          pageNo,
          attempt: 1,
          assetPath: `books/b/page-${pageNo}-a1.png`,
          modelId: 'm',
        })),
      ]),
    )
    expect(drawnRatio(desk)).toBeCloseTo(3 / 7, 6)
  })

  it('★ 全部画好 = 1（不多不少：`total` 只增不减，格数也不会超过它）', () => {
    const desk = deskOf(STUB_RUN_EVENTS)
    expect(drawnCount(desk)).toBe(desk.total)
    expect(drawnRatio(desk)).toBe(1)
  })
})

describe('岔路那几格带不带 via（工单 05 §三）', () => {
  /** 一本共读版：主干 1–2、选择点 2、a 支第 3 页、b 支第 4–5 页 */
  function sharedStream(payloads: EngineEventPayload[] = []): EngineEvent[] {
    return stream([
      {
        kind: 'plan-ready',
        stage: 'planning',
        form: 'shared',
        title: '小宇的云',
        nodeCount: 5,
        choicePages: [2],
        branchPages: { a: [3], b: [4, 5] },
      },
      ...payloads,
    ])
  }

  it('★ 归属从事件来：主干上是 null，两条支各是 a / b', () => {
    const desk = deskOf(sharedStream())
    expect(desk.frames.map((frame) => frame.via)).toEqual([null, null, 'a', 'b', 'b'])
    expect(hasBranches(desk)).toBe(true)
  })

  it('★ 不靠位置猜：a 支那一页排在 b 支前面，而它属于 a', () => {
    const desk = deskOf(sharedStream())
    const a = desk.frames.find((frame) => frame.via === 'a')
    const b = desk.frames.filter((frame) => frame.via === 'b')
    expect(a?.pageNo).toBe(3)
    expect(b.map((frame) => frame.pageNo)).toEqual([4, 5])
  })

  it('★ 图比 `plan-ready` 先到时也带得上（那一串先整串扫过一遍）', () => {
    // 乱序/重放时真有这种顺序：格子先于计划被造出来
    const desk = deskOf(
      stream([
        {
          kind: 'illustration',
          pageNo: 4,
          attempt: 1,
          assetPath: 'books/b/page-4-a1.webp',
          modelId: 'm',
        },
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'shared',
          title: '小宇的云',
          nodeCount: 5,
          choicePages: [2],
          branchPages: { a: [3], b: [4, 5] },
        },
      ]),
    )
    expect(desk.frames.find((frame) => frame.pageNo === 4)?.via).toBe('b')
  })

  it('独读版：一格都不标，`hasBranches` 为假（那一句解释也就不出现）', () => {
    const desk = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'solo',
          title: '小满',
          nodeCount: 3,
          choicePages: [],
        },
      ]),
    )
    expect(desk.frames.every((frame) => frame.via === null)).toBe(true)
    expect(hasBranches(desk)).toBe(false)
  })

  it('★ 2026-10-18 之前落盘的旧日志没有 branchPages：不标，而不是标错', () => {
    const desk = deskOf(
      stream([
        {
          kind: 'plan-ready',
          stage: 'planning',
          form: 'shared',
          title: '小宇的云',
          nodeCount: 3,
          choicePages: [2],
        },
      ]),
    )
    expect(desk.frames.every((frame) => frame.via === null)).toBe(true)
    expect(hasBranches(desk)).toBe(false)
  })
})
