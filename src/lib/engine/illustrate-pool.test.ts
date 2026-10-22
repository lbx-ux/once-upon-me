/**
 * illustrate-pool.test.ts —— 整本书那一层的并发池（2026-10-21，工单 D-03）
 *
 * D-03 的三条判据里，有两条只有在这里才量得住：
 *
 * | 判据 | 怎么钉 |
 * | --- | --- |
 * | ① 节点级事件次序不变、重画仍归属同一页 | 同一份剧本跑串行档与 3 路档，**逐页取事件子序列**比 |
 * | ③ 一致性分与重画率不退化 | 两个档下 `illustration` 事件的 (页号, 第几次) 逐条相同 |
 *
 * 判据②（用时降到 1/2 以下）不在这里量——它是挂钟的事，量法在
 * `scripts/chk-pool.mts`（真路由 + 定长假的厂商），这里不摆一个用微秒造出来的假数。
 *
 * 三条不显然的地方，都是这一支自己踩过或想过的：
 *
 * 1. **"事件次序不变"必须逐页比，不能整串比。** 并发之后整串当然变了（第 2 页的
 *    `illustration` 会排在第 1 页的 `consistency` 前面），拿整串去比等于断言"并发没生效"。
 *    所以下面第 3 条**同时**断言两件事：逐页子序列相同 **且** 整串不同——
 *    后者是前者的证伪点，少了它，把池子改成"什么都不做"这条测试照样绿。
 * 2. **在飞页数要真的数出来**，不能靠"看起来是 3"。假的出图器自己记 `inFlight` 的峰值，
 *    这是"并发到底开了几个"唯一的物证（代码里读 `limit` 是在读它自己的输入）。
 * 3. **`concurrency: 0` 是一条会静默产出空书的输入**，所以它必须当场抛；这一条同时验
 *    "抛之前一次都没调厂商"——一个抛得晚的实现照样能把钱花掉。
 */

import { describe, expect, it } from 'vitest'

import { illustrateAll, DEFAULT_PAGE_CONCURRENCY } from './illustrate.ts'
import { createMemoryStore } from './providers/stores.ts'
import type { CharacterCard, StoryNode } from './domain.ts'
import type { EngineEventPayload } from './events.ts'
import type { IllustrateOptions } from './illustrate.ts'
import type { ImageGenerator, VisionComparator } from './providers/types.ts'
import { EngineError } from './errors.ts'

const CARD: CharacterCard = {
  schemaVersion: 1,
  cardId: 'test-card',
  childId: 'test-child',
  revision: 1,
  anchors: [{ slot: 'eyes', value: '深棕圆眼' }],
  style: { key: 'warm-handdrawn', promptFragment: '温暖手绘', ratio: '1:1' },
  reference: { path: 'cards/test/ref.png', digest: 'deadbeef0000', bytes: 3, mime: 'image/png' },
  provenance: { modelId: 'test-image', promptVersion: 'card@v1', cardRevision: 1, generatedAt: 0 },
  createdAt: 0,
}

function nodesOf(count: number): StoryNode[] {
  return Array.from({ length: count }, (_, index) => ({
    nodeId: `n${index + 1}`,
    pageNo: index + 1,
    scene: `第 ${index + 1} 页的场景`,
    body: [`第 ${index + 1} 页。`],
    imagePrompt: `第 ${index + 1} 页要画的东西`,
    mood: 'calm' as const,
    next: [],
    pathFromRoot: [`n${index + 1}`],
  }))
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 定长假的出图器。`latencyOf` 让每一页有各自的耗时——"完成顺序与页序不同"那一条
 * 靠的就是它，而不靠机器当时的抖动。
 *
 * ★ 它同时数**在飞峰值**：`inFlight` 进一次加一、出一次减一，峰值留着给人看。
 *   这是"并发上限真的生效"唯一的物证（读 `limit` 是在读我们自己的输入）。
 *
 * ★ 出图回来的**字节里编了页号与第几次**（`[pageNo, attempt]`）。这不是为了好看：
 *   比对器拿到的只是一个 data URL（`toDataUrl` 之后的字节），它**看不到页号**，
 *   而剧本要按页给分。把这件事从"比对器数第几次被调用"里推出来是错的——并发之下
 *   比对调用的先后与页序无关，那种推法会随调度变。
 */
function fakeImage(latencyOf: (pageNo: number) => number): {
  image: ImageGenerator
  peak: () => number
  calls: () => { pageNo: number; at: number }[]
} {
  let inFlight = 0
  let peak = 0
  const calls: { pageNo: number; at: number }[] = []
  const attempts = new Map<number, number>()
  let clock = 0
  const image: ImageGenerator = {
    id: 'fake-image',
    modelId: 'fake-image',
    supportedRatios: ['1:1'],
    supportsReference: false,
    async generate(req) {
      const pageNo = Number(/第 (\d+) 页/.exec(req.prompt)?.[1] ?? 0)
      const attempt = (attempts.get(pageNo) ?? 0) + 1
      attempts.set(pageNo, attempt)
      calls.push({ pageNo, at: clock })
      clock += 1
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try {
        await sleep(latencyOf(pageNo))
        return {
          bytes: new Uint8Array([pageNo, attempt]),
          mime: 'image/png',
          modelId: 'fake-image',
          referenceApplied: false,
          costCny: 0.2,
        }
      } finally {
        inFlight -= 1
      }
    },
  }
  return { image, peak: () => peak, calls: () => calls }
}

/** 按「第几页的第几次」给分的比对器。页号与次数是从那张图的字节里读出来的（见 `fakeImage`） */
function scriptedVision(scoreOf: (pageNo: number, attempt: number) => number): VisionComparator {
  return {
    id: 'fake-vision',
    modelId: 'fake-vision',
    async compare({ pageDataUrl }) {
      const bytes = Buffer.from(pageDataUrl.slice(pageDataUrl.indexOf(',') + 1), 'base64')
      const pageNo = bytes[0] ?? 0
      const attempt = bytes[1] ?? 0
      return { score: scoreOf(pageNo, attempt), missed: [], reason: '', modelId: 'fake-vision' }
    },
  }
}

async function run(
  count: number,
  concurrency: number | undefined,
  opts: {
    image?: ImageGenerator
    vision?: VisionComparator | null
    maxAttempts?: number
  } = {},
): Promise<{
  illustrations: Awaited<ReturnType<typeof illustrateAll>>['illustrations']
  errors: Awaited<ReturnType<typeof illustrateAll>>['errors']
  events: EngineEventPayload[]
}> {
  const events: EngineEventPayload[] = []
  const base: IllustrateOptions = {
    image: opts.image ?? fakeImage(() => 1).image,
    vision: opts.vision === undefined ? scriptedVision(() => 0.99) : opts.vision,
    pictureReview: null,
    ...(opts.maxAttempts === undefined ? {} : { maxAttempts: opts.maxAttempts }),
    store: createMemoryStore(),
    card: CARD,
    referenceDataUrl: 'data:image/png;base64,AAAA',
    bookId: 'book-pool',
    emit: (payload) => events.push(payload),
    now: () => 0,
  }
  const result = await illustrateAll(nodesOf(count), base, { concurrency })
  return { ...result, events }
}

/** 一个页号上的事件子序列（这一页自己的一生），按发生次序 */
function eventsOf(events: EngineEventPayload[], pageNo: number): string[] {
  return events
    .filter((event) => 'pageNo' in event && event.pageNo === pageNo)
    .map((event) => JSON.stringify(event))
}

describe('illustrateAll · 并发池', () => {
  it('上限真的生效：6 页 3 路 → 在飞过的峰值是 3，不是 6 也不是 2', async () => {
    const fake = fakeImage(() => 12)
    const { illustrations } = await run(6, 3, { image: fake.image })
    expect(illustrations).toHaveLength(6)
    // 峰值这一条是"并发不是摆设"与"上限没被绕过"两个方向的同一个数：
    //   1 说明池子其实在串行，6 说明上限没管住
    expect(fake.peak()).toBe(3)
  })

  it('传 1 就是回到串行：在飞的峰值是 1（跑测要一份与旧读数可比的档）', async () => {
    const fake = fakeImage(() => 4)
    await run(4, 1, { image: fake.image })
    expect(fake.peak()).toBe(1)
  })

  it('缺省就是 3（不传第三个数时的那一档）', async () => {
    const fake = fakeImage(() => 12)
    await run(6, undefined, { image: fake.image })
    expect(DEFAULT_PAGE_CONCURRENCY).toBe(3)
    expect(fake.peak()).toBe(3)
  })

  it('页数比上限少时不空转：2 页最多同时 2 个', async () => {
    const fake = fakeImage(() => 10)
    await run(2, 3, { image: fake.image })
    expect(fake.peak()).toBe(2)
  })

  it('★ 返回的数组仍按页序——哪怕完成顺序是反的', async () => {
    // 第 1 页最慢、第 3 页最快：三页同时开跑，回来的次序必然是 3 → 2 → 1
    const fake = fakeImage((pageNo) => (4 - pageNo) * 30)
    const { illustrations } = await run(3, 3, { image: fake.image })
    expect(illustrations.map((item) => item.pageNo)).toEqual([1, 2, 3])
    // 完成顺序真的是反的——否则上面那条断言在一个"其实就是串行"的实现上也会绿
    expect(fake.calls().map((call) => call.at)).toEqual([0, 1, 2])
  })

  it('★ 逐页的事件次序与串行档逐条相同，而整串不同（并发确实生效了）', async () => {
    // 剧本：第 2 页第 1 次不像（0.30 < 0.75）→ 重画 → 第 2 次像了。
    //   于是这一页的子序列里有 retry、有 attempt=2 的 illustration 与 consistency。
    const script = (pageNo: number, attempt: number): number =>
      pageNo === 2 && attempt === 1 ? 0.3 : 0.95
    const latency = (pageNo: number): number => (4 - pageNo) * 25

    const serial = await run(3, 1, {
      image: fakeImage(latency).image,
      vision: scriptedVision(script),
    })
    const pooled = await run(3, 3, {
      image: fakeImage(latency).image,
      vision: scriptedVision(script),
    })

    // ① 每一页自己的一生，一字不差（顺序、条数、内容）
    for (const pageNo of [1, 2, 3]) {
      expect(eventsOf(pooled.events, pageNo), `第 ${pageNo} 页`).toEqual(
        eventsOf(serial.events, pageNo),
      )
    }
    // ② 重画仍归属第 2 页：retry 与它后面那次 attempt=2 的图，中间不夹别的页的东西。
    //    ★ 第 1 次没有 `review` 事件，那不是漏的：一致性已经判"不像"、而且还有重画次数，
    //      这一张马上就要被替掉，给它再花一次画面审核的钱等于买一份关于废纸的报告
    //      （`illustrateNode` 的 ③-b 那一段）。串行档也少这一条，所以①照样成立
    const own = pooled.events.filter((event) => 'pageNo' in event && event.pageNo === 2)
    const kinds = own.map(
      (event) => `${event.kind}${'attempt' in event ? `@${event.attempt}` : ''}`,
    )
    expect(kinds).toEqual([
      'stage@1',
      'illustration@1',
      'consistency@1',
      'retry@1',
      'stage@2',
      'illustration@2',
      'consistency@2',
      'review@2',
    ])
    // ③ 整串确实不同 —— 这一条是 ① 的证伪点
    expect(pooled.events.map((event) => JSON.stringify(event))).not.toEqual(
      serial.events.map((event) => JSON.stringify(event)),
    )
    // ④ 判据③那一半：两个档的图与重画次数完全一样，没有一页因为并发而多画或少画
    expect(
      pooled.illustrations.map((item) => [item.pageNo, item.attempt, item.consistency?.score]),
    ).toEqual([
      [1, 1, 0.95],
      [2, 2, 0.95],
      [3, 1, 0.95],
    ])
  })

  it('一页彻底失败只影响那一页：其余照跑，errors 也按页序', async () => {
    const base = fakeImage(() => 5)
    let seen = 0
    const image: ImageGenerator = {
      ...base.image,
      async generate(req) {
        seen += 1
        // 第 2 页的第一次（也就是第 2 次调用）抛：那一页没有任何图，进 errors
        if (seen === 2) throw new EngineError('provider-call-failed', '这一页的供应商挂了')
        return base.image.generate(req)
      },
    }
    const { illustrations, errors, events } = await run(3, 3, { image })

    expect(illustrations.map((item) => item.pageNo)).toEqual([1, 3])
    expect(errors).toEqual([{ pageNo: 2, message: '这一页的供应商挂了' }])
    // 非致命事件照发（界面靠它说清"第 2 页缺"），而且 fatal=false
    const failure = events.find((event) => event.kind === 'error')
    expect(failure).toMatchObject({ pageNo: 2, fatal: false })
  })

  it('★ 0 / 负数 / 小数当场抛，且一次都没调用厂商（拒绝"静默只画 0 页"）', async () => {
    for (const limit of [0, -1, 2.5]) {
      const fake = fakeImage(() => 1)
      const err: unknown = await run(3, limit, { image: fake.image }).then(
        () => null,
        (e: unknown) => e,
      )
      expect(err, String(limit)).toBeInstanceOf(EngineError)
      expect((err as EngineError).code).toBe('invalid-request')
      expect((err as EngineError).message).toContain(String(limit))
      // 抛得晚的实现照样能把钱花掉，所以这条要一起钉
      expect(fake.calls(), String(limit)).toHaveLength(0)
    }
  })
})
