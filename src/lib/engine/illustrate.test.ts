/**
 * illustrate.test.ts —— 一致性比对**调用失败**时的行为
 *
 * 这一条是实测踩出来的，不是推演出来的（`node scripts/engine-run.mts --mode=live
 * --pages=5`，2026-10-13）：
 *
 * - 5 页全部出图，磁盘上 8 张 PNG（含重画），钱都花了；
 * - 比对模型在其中 3 页上回 504 / 网络错；
 * - 书里**只剩 2 页**，汇总行还写着"2/5 页有图"。
 *
 * 成因是 `opts.vision.compare()` 直接 await：异常冒到 `illustrateAll` 的 catch，
 * 于是这一页连同**已经付过钱的图**一起从书里消失。
 * 而 `ConsistencyResult.verdict` 的注释本来就写明 `unavailable` 覆盖
 * "视觉模型未配置**或调用失败**"——代码没做到注释里写的事。
 *
 * 这里锁死三件事：**不抛、图还在、verdict = unavailable**。
 */

import { describe, expect, it } from 'vitest'

import { illustrateNode } from './illustrate.ts'
import { createMemoryStore } from './providers/stores.ts'
import type { CharacterCard, StoryNode } from './domain.ts'
import type { AssetStore, ImageGenerator, VisionComparator } from './providers/types.ts'

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

const NODE: StoryNode = {
  nodeId: 'n1',
  pageNo: 1,
  scene: '夜里的小船',
  body: ['天黑了。'],
  imagePrompt: '一个小孩站在小船边',
  mood: 'calm',
  next: [],
  pathFromRoot: ['n1'],
}

/** 只会出字节的假出图器。`supportsReference: false` = 这条平台实测的真实状态 */
function fakeImage(): ImageGenerator {
  return {
    id: 'fake-image',
    modelId: 'fake-image',
    supportedRatios: ['1:1'],
    supportsReference: false,
    async generate() {
      return {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mime: 'image/png',
        modelId: 'fake-image',
        referenceApplied: false,
        costCny: 0.2,
      }
    },
  }
}

// 去掉 `costCny` 之类的精度差异：只保留本文件断言用得到的形状
type Call = { pageNo: number; attempt: number }
type ErrorEvent = { pageNo?: number; message: string; fatal: boolean }

/**
 * 可控的假出图器：第 n 次调用按 `plan[n - 1]` 行事。
 * `'ok'` = 正常出一张图；给 `Error` 就在那一次抛。
 */
function scriptedImage(plan: ('ok' | Error)[]): { image: ImageGenerator; calls: () => number } {
  let seen = 0
  const base = fakeImage()
  const image: ImageGenerator = {
    ...base,
    async generate() {
      const step = plan[seen]
      seen += 1
      if (step instanceof Error) throw step
      if (step === undefined) throw new Error(`剧本只写了 ${plan.length} 次，这是第 ${seen} 次`)
      return {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mime: 'image/png',
        modelId: 'fake-image',
        referenceApplied: false,
        costCny: 0.2,
      }
    },
  }
  return { image, calls: () => seen }
}

async function run(
  vision: VisionComparator | null,
  extra: { image?: ImageGenerator; store?: AssetStore } = {},
): Promise<{
  result: Awaited<ReturnType<typeof illustrateNode>>
  calls: Call[]
  errors: ErrorEvent[]
}> {
  const calls: Call[] = []
  const errors: ErrorEvent[] = []
  const result = await illustrateNode(NODE, {
    image: extra.image ?? fakeImage(),
    vision,
    store: extra.store ?? createMemoryStore(),
    card: CARD,
    referenceDataUrl: 'data:image/png;base64,AAAA',
    bookId: 'book-test',
    emit: (payload) => {
      if (
        payload.kind === 'illustration' &&
        payload.pageNo !== undefined &&
        payload.attempt !== undefined
      ) {
        calls.push({ pageNo: payload.pageNo, attempt: payload.attempt })
      }
      if (payload.kind === 'error') {
        errors.push({
          ...(payload.pageNo === undefined ? {} : { pageNo: payload.pageNo }),
          message: payload.message,
          fatal: payload.fatal,
        })
      }
    },
    now: () => 0,
  })
  return { result, calls, errors }
}

describe('illustrateNode · 比对调用失败', () => {
  it('比对抛错时不算这一页失败：不抛、图留着、标 unavailable', async () => {
    const throwing: VisionComparator = {
      id: 'kimi-k2.6',
      modelId: 'kimi-k2.6',
      async compare() {
        throw new Error('/chat/completions 失败 HTTP 504 · （上游超时）')
      },
    }

    const { result, calls } = await run(throwing)

    // 1) 图真的画出来了，而且**记录里指向的是那张图**，不是 missing.bin
    expect(calls).toHaveLength(1)
    expect(result.asset.path).toBe('books/book-test/page-1-a1.png')
    expect(result.asset.path).not.toContain('missing')

    // 2) 判决是"判不了"，不是"不通过"——两者的处置完全不同
    expect(result.consistency?.verdict).toBe('unavailable')
    expect(result.consistency?.score).toBeNull()

    // 3) 原因里带上原始错误，排障时才看得出是 504 还是别的
    expect(result.consistency?.reason).toContain('504')

    // 4) 仍然要人看一眼（降级 B 的入口），但不是整页失败
    expect(result.needsHumanReview).toBe(true)

    // 5) **不重画**：没有判据的重画是烧钱抽签（illustrate.ts 文件头第 1 条）
    expect(calls).toHaveLength(1)
  })

  it('比对给不出分（score=null）与抛错走同一条路', async () => {
    const nullScore: VisionComparator = {
      id: 'x',
      modelId: 'x',
      async compare() {
        return { score: null, missed: [], reason: '比对模型没有按 JSON 回答', modelId: 'x' }
      },
    }
    const { result, calls } = await run(nullScore)
    expect(result.consistency?.verdict).toBe('unavailable')
    expect(result.asset.path).toBe('books/book-test/page-1-a1.png')
    expect(calls).toHaveLength(1)
  })

  it('未配置比对模型时不重画，且明说这一页没核对过', async () => {
    const { result, calls } = await run(null)
    expect(result.consistency?.verdict).toBe('unavailable')
    expect(result.consistency?.reason).toContain('未配置视觉比对模型')
    expect(calls).toHaveLength(1)
  })
})

/**
 * ★ 这一组是 2026-10-16 补的，对着一次**真跑出来的**事故写：
 *   `.out/web/books/xiaolu-r1-ee69012def18` 第 6 页。
 *
 *   第 1 次画好了（`page-6-a1.png`，1536×1024、3.0 MB 就在磁盘上），比对没过 →
 *   重画 → 第 2 次在**下图那一跳**撞上 `ECONNRESET` → 整页变成 `errors` 里的一条，
 *   那张已经付过钱的图从书里消失，阅读器上写着"这一页没做出来"——**假话**。
 *
 *   成因与上面那一组**完全同源**（异常冒到 `illustrateAll` 的 catch），
 *   只是当时只修了比对那一跳，真正出图与下图那两跳没修。
 *   所以判据也同形：**不抛、图还在、并且说清"重画没跑成"**。
 */
describe('illustrateNode · 出图/落盘失败时不许丢掉已经画好的图', () => {
  /** 按剧本给分的比对器：`0.3` = 不像，`null` = 判不了 */
  function scriptedVision(scores: (number | null)[]): VisionComparator {
    let seen = 0
    return {
      id: 'fake-vision',
      modelId: 'fake-vision',
      async compare() {
        const score = scores[seen] ?? null
        seen += 1
        return { score, missed: [], reason: '头身比不对', modelId: 'fake-vision' }
      },
    }
  }

  /** 真实那条报错原文（`providers/http.ts` 的 `fetchBytes` 拼出来的形状） */
  const ECONNRESET = new Error(
    '下载媒体网络错误：TypeError: terminated · ECONNRESET — 连接被对面掐断（可能已经处理过了）（主机 tokenrhythm-prod-backup-oss.oss-cn-beijing.aliyuncs.com）',
  )

  it('★ 重画抛网络错时，书上留的是**第 1 次那张图**，不是 missing.bin', async () => {
    const { image, calls: imageCalls } = scriptedImage(['ok', ECONNRESET])
    const { result, calls, errors } = await run(scriptedVision([0.3]), { image })

    // 1) 图还在，而且指向的是**已经画完的那一次**，不是空白占位
    expect(result.asset.path).toBe('books/book-test/page-1-a1.png')
    expect(result.asset.path).not.toContain('missing')
    expect(result.attempt).toBe(1)

    // 2) 判决照旧是"不像"（那是第 1 次的判决，不该被后面那次失败改写成别的）
    expect(result.consistency?.verdict).toBe('fail')
    expect(result.needsHumanReview).toBe(true)

    // 3) ★ 但书里要写清**为什么停在第 1 次**：原始那句"哪一撮头发不对"一个字不丢，
    //    后面续上停手的原因。没有这一句，`verdict:'fail' + attempt:1` 看不出
    //    "后面还画过、只是被打断了"，而"重画几次"是 r_redraw 的数据源
    expect(result.consistency?.reason).toContain('头身比不对')
    expect(result.consistency?.reason).toContain('重画没跑成')
    expect(result.consistency?.reason).toContain('ECONNRESET')
    expect(result.consistency?.reason).toContain('不是"没做出来"')

    // 4) 也要出事件（过程日志里看得见），并且**不许是 fatal**——
    //    它不是整本书失败，也不是这一页没有图
    expect(errors).toHaveLength(1)
    expect(errors[0]?.fatal).toBe(false)
    expect(errors[0]?.pageNo).toBe(1)
    expect(errors[0]?.message).toContain('重画没跑成')

    // 5) 真的画过两次（第 2 次是失败的那次），但**只有一次成功产出**
    expect(imageCalls()).toBe(2)
    expect(calls).toHaveLength(1)

    // 6) 产出失败后不再往下一次尝试：不是漏了，是"再来一次就是重新付一次钱"
    //    （理由写在 `produceFailed` 的注释里）
    expect(imageCalls()).toBe(2)
  })

  it('落盘那一步失败与出图那一步失败走同一条路', async () => {
    const base = createMemoryStore()
    let puts = 0
    const flaky: AssetStore = {
      ...base,
      async put(entry) {
        puts += 1
        if (puts >= 2) throw new Error('落盘失败：磁盘满了（ENOSPC）')
        return base.put(entry)
      },
    }
    const { result, errors } = await run(scriptedVision([0.3]), {
      image: scriptedImage(['ok', 'ok']).image,
      store: flaky,
    })

    expect(result.asset.path).toBe('books/book-test/page-1-a1.png')
    expect(result.consistency?.reason).toContain('落盘失败')
    expect(errors).toHaveLength(1)
  })

  it('★ 第 1 次就没成时照旧抛出去——那一页**确实**没有图，这才该进 errors', async () => {
    // 这一条与上面两条是**一对**：修"丢掉已有的图"不等于"什么错都不抛了"。
    // 分界线只有一个：手上有没有一张画完的图。
    const { image } = scriptedImage([ECONNRESET])
    await expect(run(scriptedVision([0.3]), { image })).rejects.toThrow(/ECONNRESET/)
  })

  it('落盘失败也不例外：第 1 次就没落成 → 抛（不能拿半张图充数）', async () => {
    const broken: AssetStore = {
      ...createMemoryStore(),
      async put() {
        throw new Error('落盘失败：磁盘满了（ENOSPC）')
      },
    }
    await expect(run(scriptedVision([0.3]), { store: broken })).rejects.toThrow(/ENOSPC/)
  })
})

/**
 * ★ `attemptBase`（工单 01 §3.1）——单页重画时**接着数**，不从 1 重来。
 *
 * 两种坏法都被这一节挡住：
 * 1. 文件名是 `page-{n}-a{attempt}` 拼的。从 1 重来会把**上一次那张**覆盖掉，
 *    而"失败的图也落盘、家长要能看见上一版为什么不像"是 `illustrate.ts` 文件头第 3 条。
 * 2. `retry` 那句话是"第 {attempt} / {maxAttempts} 次"。只抬 `attempt` 不抬上界的话，
 *    它念出来是"第 4 / 3 次"——一个自相矛盾的数，而屏幕上没有任何东西会提示它是错的。
 */
describe('illustrateNode · attemptBase（单页重画接着数）', () => {
  async function rerunOnce(attemptBase: number, vision: VisionComparator | null) {
    const events: { kind: string; attempt?: number; maxAttempts?: number; total?: number }[] = []
    const store = await createMemoryStore()
    const result = await illustrateNode(NODE, {
      image: fakeImage(),
      vision,
      store,
      card: CARD,
      referenceDataUrl: 'data:image/png;base64,AAAA',
      bookId: 'book-test',
      attemptBase,
      maxAttempts: 3,
      emit: (payload) =>
        events.push({
          kind: payload.kind,
          ...('attempt' in payload ? { attempt: payload.attempt } : {}),
          ...('maxAttempts' in payload ? { maxAttempts: payload.maxAttempts } : {}),
          ...('total' in payload ? { total: payload.total } : {}),
        }),
      now: () => 0,
    })
    return { result, events, store }
  }

  it('★ 缺省从 1 起（整本那一轮一个字都没改）', async () => {
    const { result, events } = await rerunOnce(0, null)
    expect(result.attempt).toBe(1)
    expect(events[0]).toMatchObject({ kind: 'stage', attempt: 1, total: 3 })
  })

  it('★ attemptBase = 3 时，第一次尝试就是第 4 次，上界也跟着抬到 6', async () => {
    const { result, events } = await rerunOnce(3, null)
    expect(result.attempt).toBe(4)
    expect(events[0]).toMatchObject({ kind: 'stage', attempt: 4, total: 6 })
  })

  it('★ 落盘的文件名接着数（不覆盖上一版那张）', async () => {
    const store = await createMemoryStore()
    await illustrateNode(NODE, {
      image: fakeImage(),
      vision: null,
      store,
      card: CARD,
      referenceDataUrl: 'data:image/png;base64,AAAA',
      bookId: 'book-test',
      emit: () => undefined,
      now: () => 0,
    })
    await illustrateNode(NODE, {
      image: fakeImage(),
      vision: null,
      store,
      card: CARD,
      referenceDataUrl: 'data:image/png;base64,AAAA',
      bookId: 'book-test',
      attemptBase: 1,
      emit: () => undefined,
      now: () => 0,
    })
    const first = await store.read('books/book-test/page-1-a1.png')
    const second = await store.read('books/book-test/page-1-a2.png')
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
  })

  it('重画那一条 `retry` 念得出"第 5 / 6 次"，不是"第 5 / 3 次"', async () => {
    // 比对一直判不过 → 触发 retry。上界必须是 attemptBase + maxAttempts
    const alwaysFail: VisionComparator = {
      id: 'fake-vision',
      modelId: 'fake-vision',
      async compare() {
        return { score: 0.1, missed: [], reason: '不像', modelId: 'fake-vision' }
      },
    }
    const { events } = await rerunOnce(3, alwaysFail)
    const retries = events.filter((event) => event.kind === 'retry')
    expect(retries.length).toBeGreaterThan(0)
    expect(retries[0]).toMatchObject({ attempt: 4, maxAttempts: 6 })
  })
})

/**
 * 钱的账 —— 这一页这一次**实付了多少**（2026-10-16 补的字段）
 *
 * ★ 在这一组测试之前，`Illustration.costCny` **从来没人填**：钱只进了 `illustration`
 *   事件（那是给界面看的），而 `summarize()` 的 `totalCostCny` 是从 `illustrations`
 *   里加出来的——于是**每一本书的成本都记成 0.00**，`scripts/web-run.mts` 的账目核对
 *   拿一个恒为 0 的和去对照单价，永远"对得上"。这正是"没测成不许记成测出来"那条
 *   教训的另一种长相：**假的和比没有和更危险**。
 *
 * 判据选在这里而不是 `summarize` 那边：这一个字段是那份和的**唯一来源**，
 * 把它钉住了，上层那三行 reduce 就没有可错的地方。
 */
describe('illustrateNode · 这一页这一次实付了多少', () => {
  /** 供应商一个价都不报的那种 provider（`costCny` 缺省） */
  function pricingImage(costCny: number | undefined): ImageGenerator {
    return {
      ...fakeImage(),
      async generate() {
        return {
          bytes: new Uint8Array([1, 2, 3, 4]),
          mime: 'image/png',
          modelId: 'fake-image',
          referenceApplied: false,
          ...(costCny === undefined ? {} : { costCny }),
        }
      },
    }
  }

  it('一次就过：记一次的钱', async () => {
    const { result } = await run(null)
    expect(result.costCny).toBeCloseTo(0.2)
  })

  it('★ 重画两次都算钱：这一页带回来的是 3 次的和，不是最后那张的价', async () => {
    // 钱是按**次**花的，而"最后一版多少钱"这种口径会让重画看起来是免费的——
    // 而 r_redraw 这个指标本来就是拿重画次数说成本的
    const alwaysFail: VisionComparator = {
      id: 'fake-vision',
      modelId: 'fake-vision',
      async compare() {
        return { score: 0.1, missed: [], reason: '不像', modelId: 'fake-vision' }
      },
    }
    const { result, calls } = await run(alwaysFail)
    expect(calls).toHaveLength(3) // 画满 3 次
    expect(result.costCny).toBeCloseTo(0.6)
  })

  it('★ 供应商不报价时省略这个字段，不写成 0 —— "没记账"与"记了 0 元"不是一件事', async () => {
    const result = await illustrateNode(NODE, {
      image: pricingImage(undefined),
      vision: null,
      store: createMemoryStore(),
      card: CARD,
      referenceDataUrl: 'data:image/png;base64,AAAA',
      bookId: 'book-test',
      emit: () => undefined,
      now: () => 0,
    })
    expect(result.costCny).toBeUndefined()
  })

  it('浮点不写成 0.6000000000000001 那种东西进 book.json', async () => {
    const alwaysFail: VisionComparator = {
      id: 'fake-vision',
      modelId: 'fake-vision',
      async compare() {
        return { score: 0.1, missed: [], reason: '不像', modelId: 'fake-vision' }
      },
    }
    const { result } = await run(alwaysFail)
    // 小数位不超过两位——`book.json` 里那个数是要给人对账的
    expect(String(result.costCny)).toMatch(/^\d+(\.\d{1,2})?$/)
  })
})
