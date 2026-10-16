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

import { deskOf, drawnCount, drawnRatio, EMPTY_DESK, railOf, toneOf } from './frames.ts'
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
