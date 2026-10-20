/**
 * illustrate.test.ts —— 一致性比对调用失败时的行为
 *
 * 这一条是实测踩出来的，不是推演出来的（`node scripts/engine-run.mts --mode=live
 * --pages=5`，2026-10-13）：
 *
 * - 5 页全部出图，磁盘上 8 张 PNG（含重画），钱都花了；
 * - 比对模型在其中 3 页上回 504 / 网络错；
 * - 书里只剩 2 页，汇总行还写着"2/5 页有图"。
 *
 * 成因是 `opts.vision.compare()` 直接 await：异常冒到 `illustrateAll` 的 catch，
 * 于是这一页连同已经付过钱的图一起从书里消失。
 * 而 `ConsistencyResult.verdict` 的注释本来就写明 `unavailable` 覆盖
 * "视觉模型未配置或调用失败"——代码没做到注释里写的事。
 *
 * 这里锁死三件事：不抛、图还在、verdict = unavailable。
 */

import { describe, expect, it } from 'vitest'

import { illustrateNode } from './illustrate.ts'
import { createMemoryStore } from './providers/stores.ts'
import type { CharacterCard, StoryNode } from './domain.ts'
import type {
  AssetStore,
  ImageGenerator,
  PictureReviewer,
  VisionComparator,
} from './providers/types.ts'

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
/** 画面审核那条事件（`.scratch/safety` 工单 01） */
type ReviewEvent = {
  pageNo: number
  attempt?: number
  check: 'safety' | 'coherence'
  verdict: 'pass' | 'flag' | 'block' | 'unavailable'
  reason?: string
}

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
  extra: {
    image?: ImageGenerator
    store?: AssetStore
    /** 画面审核（`.scratch/safety` 工单 01）。不给就是"这台机器没有这一档" */
    pictureReview?: PictureReviewer | null
    maxAttempts?: number
  } = {},
): Promise<{
  result: Awaited<ReturnType<typeof illustrateNode>>
  calls: Call[]
  errors: ErrorEvent[]
  reviews: ReviewEvent[]
}> {
  const calls: Call[] = []
  const errors: ErrorEvent[] = []
  const reviews: ReviewEvent[] = []
  const result = await illustrateNode(NODE, {
    image: extra.image ?? fakeImage(),
    vision,
    pictureReview: extra.pictureReview ?? null,
    ...(extra.maxAttempts === undefined ? {} : { maxAttempts: extra.maxAttempts }),
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
      if (payload.kind === 'review' && payload.pageNo !== undefined) {
        reviews.push({
          pageNo: payload.pageNo,
          attempt: payload.attempt,
          check: payload.check,
          verdict: payload.verdict,
          reason: payload.reason,
        })
      }
    },
    now: () => 0,
  })
  return { result, calls, errors, reviews }
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

    // 1) 图真的画出来了，而且记录里指向的是那张图，不是 missing.bin
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

    // 5) 不重画：没有判据的重画是烧钱抽签（illustrate.ts 文件头第 1 条）
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
    // 2026-10-19 改了措辞：这一档现在有两件事可能没做（像不像 / 画面），
    //   所以这句话要说清是"整个没有视觉能力"，而不是含糊的"比对模型没配"。
    //   两件事都缺席时说的是这一句；只缺比对那一半时说的是另一句（见文件里那两行）
    expect(result.consistency?.reason).toContain('未配置视觉模型')
    expect(result.consistency?.reason).toContain('像不像与画面都没查')
    expect(calls).toHaveLength(1)
  })
})

/**
 * 这一组是 2026-10-19 补的，对着 B3 剩下那半张纸 写
 *   （`.scratch/safety` 工单 01：画面那一路）。
 *
 *   它锁死的是处置，不是"函数返回了 flag"——两者差着一条真的在跑的路径：
 *   `flag` → 重画 → 重画用尽 → 图留着 + 人得看一眼 + 条款 id 在记录里。
 *   `unavailable` → 不重画（这一档连分都没有，重画是纯抽签）。
 *   这两条判据反过来任意一条写错，症状都不是报错，而是"钱多花了"或"一张有问题的图
 *   悄悄进了书里"，两个都不会在日志里喊。
 */
describe('illustrateNode · 画面审核（`pictureReview`）', () => {
  /** 按剧本给结论的假审核器：`'flag'` = 报一条 R-01，`'pass'` = 没发现 */
  function scriptedReview(script: ('pass' | 'flag' | 'unavailable')[]): {
    reviewer: PictureReviewer
    seen: () => number
  } {
    let seen = 0
    return {
      seen: () => seen,
      reviewer: {
        id: 'fake-vision',
        modelId: 'fake-vision',
        async reviewPicture() {
          const verdict = script[seen] ?? 'pass'
          seen += 1
          if (verdict === 'unavailable') {
            return { findings: null, reason: '画面审核的模型没有按 JSON 回答', modelId: 'v' }
          }
          return verdict === 'flag'
            ? {
                findings: [{ clauseId: 'R-01', where: '左下角那只玩偶的眼睛' }],
                reason: '有一处看着吓人',
                modelId: 'v',
              }
            : { findings: [], modelId: 'v' }
        },
      },
    }
  }

  const alwaysPass: VisionComparator = {
    id: 'v',
    modelId: 'v',
    async compare() {
      return { score: 0.9, missed: [], modelId: 'v' }
    },
  }

  it('★ 有发现 → 重画；重画之后干净了 → 留那一张，且不再重画', async () => {
    const { reviewer } = scriptedReview(['flag', 'pass'])
    const { result, calls, reviews } = await run(alwaysPass, {
      pictureReview: reviewer,
      maxAttempts: 3,
    })

    // 真的重画过（不是"函数返回了 flag"就算）——这是判据的关键一半
    expect(calls).toHaveLength(2)
    expect(result.attempt).toBe(2)
    // 小事：`pass` 那一条事件照样发（与 `consistency` 同一条），由界面决定显不显示
    expect(reviews.map((event) => event.verdict)).toEqual(['flag', 'pass'])
    expect(reviews[0]?.reason).toContain('R-01')
    expect(reviews[0]?.reason).toContain('左下角那只玩偶的眼睛')
    // 最后留下的是干净的那一张
    expect(result.pictureReview?.verdict).toBe('pass')
    expect(result.needsHumanReview).toBe(false)
  })

  it('★ 重画用尽仍报 → **图留着**、判 flag、条款 id 在记录里、要人看一眼', async () => {
    const { reviewer } = scriptedReview(['flag', 'flag'])
    const { result, calls } = await run(alwaysPass, {
      pictureReview: reviewer,
      maxAttempts: 2,
    })

    expect(calls).toHaveLength(2)
    // 图不许丢：与一致性那条同一条纪律（"没通过 ≠ 这一页没做出来"）
    expect(result.asset.path).toBe('books/book-test/page-1-a2.png')
    expect(result.asset.path).not.toContain('missing')
    expect(result.pictureReview?.verdict).toBe('flag')
    expect(result.pictureReview?.problems).toEqual([
      { clauseId: 'R-01', where: '左下角那只玩偶的眼睛' },
    ])
    expect(result.needsHumanReview).toBe(true)
  })

  it('★ 判不了（`unavailable`）时**一次都不重画**——这一档没有分数，重画是纯抽签', async () => {
    const { reviewer, seen } = scriptedReview(['unavailable'])
    const { result, calls, reviews } = await run(alwaysPass, { pictureReview: reviewer })

    expect(calls).toHaveLength(1)
    expect(seen()).toBe(1)
    expect(result.pictureReview?.verdict).toBe('unavailable')
    // 缺席/判不了都不算通过
    expect(result.needsHumanReview).toBe(true)
    expect(reviews[0]?.verdict).toBe('unavailable')
  })

  it('画面审核的调用**抛了**时，与"判不了"走同一条：图留着、标没审过、不重画', async () => {
    const throwing: PictureReviewer = {
      id: 'v',
      modelId: 'v',
      async reviewPicture() {
        throw new Error('/chat/completions 失败 HTTP 504 · （上游超时）')
      },
    }
    const { result, calls } = await run(alwaysPass, { pictureReview: throwing })
    expect(calls).toHaveLength(1)
    expect(result.pictureReview?.verdict).toBe('unavailable')
    expect(result.pictureReview?.reason).toContain('504')
    expect(result.asset.path).toBe('books/book-test/page-1-a1.png')
  })

  it('★ 一张正在被重画掉的图**不审**（省的是真钱）：比对判不过、还有次数时不发审核调用', async () => {
    const failing: VisionComparator = {
      id: 'v',
      modelId: 'v',
      async compare() {
        return { score: 0.1, missed: [], reason: '不像', modelId: 'v' }
      },
    }
    // 第 1 次：比对判不过（这张会被替掉）→ 不该审；第 2 次是最后一次，比对判不过但
    // 这张会被留下 → 该审
    const { reviewer, seen } = scriptedReview(['pass'])
    const { calls } = await run(failing, { pictureReview: reviewer, maxAttempts: 2 })
    expect(calls).toHaveLength(2)
    expect(seen()).toBe(1)
  })

  it('★ 一致性判不了的那一张**照样审**——那条路上比对已经不工作了，画面是唯一的核对', async () => {
    const blind: VisionComparator = {
      id: 'v',
      modelId: 'v',
      async compare() {
        return { score: null, missed: [], reason: '没按 JSON 回答', modelId: 'v' }
      },
    }
    const { reviewer, seen } = scriptedReview(['flag', 'flag', 'flag'])
    const { result, calls } = await run(blind, { pictureReview: reviewer, maxAttempts: 3 })
    // 审了，而且它报出来的东西照样触发重画（不是"一致性没结论就一起放过"）
    expect(seen()).toBe(3)
    expect(calls).toHaveLength(3)
    expect(result.pictureReview?.verdict).toBe('flag')
  })

  it('完全没配视觉能力时，结论**缺席**而不是 `pass`（缺席不许被读成通过）', async () => {
    const { result, reviews } = await run(null)
    expect(result.pictureReview).toBeUndefined()
    expect(result.needsHumanReview).toBe(true)
    // 一次调用都没有，也就没有审核事件——"画面也没查"那句话在 consistency 那条事件的
    // reason 里（少了它，家长会以为只有相似度那一项没查）
    expect(reviews).toHaveLength(0)
    expect(result.consistency?.reason).toContain('像不像与画面都没查')
  })

  it('★ 配了比对、没配审核（直接调引擎时的可能形状）：写成 `unavailable` 并说清原因', async () => {
    // 这两个字段在产品路径上是同一个对象（`ProviderBundle.vision`），
    //   所以这一格只有直接调 `illustrateNode` 的脚本才会走到。
    //   它记的是"审了没审成"而不是缺席——因为没配审核正是"没审成"的一个原因，
    //   而缺席要留给"根本没走到那一步"（见 domain.ts 那段）
    const { result, reviews } = await run(alwaysPass)
    expect(result.pictureReview?.verdict).toBe('unavailable')
    expect(result.pictureReview?.reason).toContain('未配置视觉模型')
    expect(result.needsHumanReview).toBe(true)
    expect(reviews).toHaveLength(1)
    expect(reviews[0]?.verdict).toBe('unavailable')
  })
})

/**
 * 这一组是 2026-10-16 补的，对着一次真跑出来的事故写：
 *   `.out/web/books/xiaolu-r1-ee69012def18` 第 6 页。
 *
 *   第 1 次画好了（`page-6-a1.png`，1536×1024、3.0 MB 就在磁盘上），比对没过 →
 *   重画 → 第 2 次在下图那一跳撞上 `ECONNRESET` → 整页变成 `errors` 里的一条，
 *   那张已经付过钱的图从书里消失，阅读器上写着"这一页没做出来"——假话。
 *
 *   成因与上面那一组完全同源（异常冒到 `illustrateAll` 的 catch），
 *   只是当时只修了比对那一跳，真正出图与下图那两跳没修。
 *   所以判据也同形：不抛、图还在、并且说清"重画没跑成"。
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

    // 1) 图还在，而且指向的是已经画完的那一次，不是空白占位
    expect(result.asset.path).toBe('books/book-test/page-1-a1.png')
    expect(result.asset.path).not.toContain('missing')
    expect(result.attempt).toBe(1)

    // 2) 判决照旧是"不像"（那是第 1 次的判决，不该被后面那次失败改写成别的）
    expect(result.consistency?.verdict).toBe('fail')
    expect(result.needsHumanReview).toBe(true)

    // 3) ★ 但书里要写清为什么停在第 1 次：原始那句"哪一撮头发不对"一个字不丢，
    //    后面续上停手的原因。没有这一句，`verdict:'fail' + attempt:1` 看不出
    //    "后面还画过、只是被打断了"，而"重画几次"是 r_redraw 的数据源
    expect(result.consistency?.reason).toContain('头身比不对')
    expect(result.consistency?.reason).toContain('重画没跑成')
    expect(result.consistency?.reason).toContain('ECONNRESET')
    expect(result.consistency?.reason).toContain('不是"没做出来"')

    // 4) 也要出事件（过程日志里看得见），并且不许是 fatal——
    //    它不是整本书失败，也不是这一页没有图
    expect(errors).toHaveLength(1)
    expect(errors[0]?.fatal).toBe(false)
    expect(errors[0]?.pageNo).toBe(1)
    expect(errors[0]?.message).toContain('重画没跑成')

    // 5) 真的画过两次（第 2 次是失败的那次），但只有一次成功产出
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
    // 这一条与上面两条是一对：修"丢掉已有的图"不等于"什么错都不抛了"。
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
 * `attemptBase`（工单 01 §3.1）——单页重画时接着数，不从 1 重来。
 *
 * 两种坏法都被这一节挡住：
 * 1. 文件名是 `page-{n}-a{attempt}` 拼的。从 1 重来会把上一次那张覆盖掉，
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
      pictureReview: null,
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
      pictureReview: null,
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
      pictureReview: null,
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
 * 钱的账 —— 这一页这一次实付了多少（2026-10-16 补的字段）
 *
 * 在这一组测试之前，`Illustration.costCny` 从来没人填：钱只进了 `illustration`
 *   事件（那是给界面看的），而 `summarize()` 的 `totalCostCny` 是从 `illustrations`
 *   里加出来的——于是每一本书的成本都记成 0.00，`scripts/web-run.mts` 的账目核对
 *   拿一个恒为 0 的和去对照单价，永远"对得上"。这正是"没测成不许记成测出来"那条
 *   教训的另一种长相：假的和比没有和更危险。
 *
 * 判据选在这里而不是 `summarize` 那边：这一个字段是那份和的唯一来源，
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
    // 钱是按次花的，而"最后一版多少钱"这种口径会让重画看起来是免费的——
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
      pictureReview: null,
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

/**
 * ── 锚点回灌（2026-10-20，计划表 B7）
 *
 * 这一组量的是判据，不是实现：出图那一步实际收到的 prompt。
 *   在那之前，提示词在循环外只算一次，重画那一轮拿到的是与上一轮逐字节相同
 *   的一段话——比对模型说出的"哪几条锚点不像"只进了 `retry` 事件（给人看）。
 *   所以"这一页重画过"这件事在旧代码里也是真的，只有 prompt 不一样才是新增的。
 *   这就是为什么这里的判据取 `prompts[1]`，而不是取 `calls.length`。
 *
 * 四件事，各自对应一种会静悄悄错掉的写法：
 *   ① 第 1 次不许带那句（带了就说明回灌发生在该发生之前，而那会动到首次通过率）；
 *   ② 第 2 次必须带上，并且把卡上的原文补齐（「眼睛是否一致」→「眼睛：深棕圆眼」）；
 *   ③ 第 3 次跟的是第 2 次的结论（照抄实现里"累积"的写法会让它带着两条旧账）；
 *   ④ 结论为空 / 比对已通过时一句都不带（缺席不许被读成"我知道该改哪里"）。
 */
describe('illustrateNode · 重画时的锚点回灌（`anchorNote`）', () => {
  /** 记下每一次真的发出去的 prompt。这才是"喂回去了没有"的判据 */
  function recordingImage(): { image: ImageGenerator; prompts: string[] } {
    const prompts: string[] = []
    return {
      prompts,
      image: {
        ...fakeImage(),
        async generate({ prompt }: { prompt: string }) {
          prompts.push(prompt)
          return {
            bytes: new Uint8Array([1, 2, 3, 4]),
            mime: 'image/png',
            modelId: 'fake-image',
            referenceApplied: false,
            costCny: 0.2,
          }
        },
      } as ImageGenerator,
    }
  }

  /** 按剧本给比对结论：每一次给出一个分与一份 missed */
  function scriptedVision(script: { score: number; missed: string[] }[]): VisionComparator {
    let seen = 0
    return {
      id: 'fake-vision',
      modelId: 'fake-vision',
      async compare() {
        const step = script[Math.min(seen, script.length - 1)] as {
          score: number
          missed: string[]
        }
        seen += 1
        return { score: step.score, missed: step.missed, modelId: 'fake-vision' }
      },
    }
  }

  /**
   * 从一段 prompt 里挑出回灌那一行（没有就是 `undefined`）。
   *   判据必须落在这一行上，不能拿 `toContain('眼睛：深棕圆眼')` 去问整段：
   *   角色段本来就把每一条锚点写成「眼睛：深棕圆眼」（`promptFragmentOf`）——
   *   那种断言恒真，等于没测（写这一组时它当场红过一次，是真的撞上了）。
   */
  function noteLineOf(prompt: string | undefined): string | undefined {
    return prompt?.split('\n').find((line) => line.includes('上一版经核对'))
  }

  it('★ 第 1 次不带、第 2 次带着上一轮的结论（补上卡上的原文）', async () => {
    const { image, prompts } = recordingImage()
    const { calls } = await run(
      scriptedVision([
        { score: 0.3, missed: ['眼睛是否一致'] },
        { score: 0.9, missed: [] },
      ]),
      { image, maxAttempts: 3 },
    )

    expect(calls.map((call) => call.attempt)).toEqual([1, 2])
    expect(prompts).toHaveLength(2)
    expect(noteLineOf(prompts[0])).toBeUndefined()
    // 模型回的是「眼睛是否一致」（清单里冒号后面那截它丢了），要能看到卡上的值
    expect(noteLineOf(prompts[1])).toContain('眼睛：深棕圆眼')
    // ★ 而且两段话的差别只有那一行：把那一行抽掉，第 2 次就等于第 1 次。
    //   这一条才是"首次通过率仍然可比"的依据——不许顺手改别处。
    const withoutNote = (prompts[1] ?? '')
      .split('\n')
      .filter((line) => !line.includes('上一版经核对'))
      .join('\n')
    expect(withoutNote).toBe(prompts[0])
  })

  it('★ 第 3 次跟的是**第 2 次**的结论，不是两次的并集', async () => {
    const { image, prompts } = recordingImage()
    const { calls } = await run(
      scriptedVision([
        { score: 0.3, missed: ['眼睛是否一致'] },
        { score: 0.4, missed: ['右手多了一根手指'] },
        { score: 0.9, missed: [] },
      ]),
      { image, maxAttempts: 3 },
    )

    expect(calls).toHaveLength(3)
    expect(noteLineOf(prompts[2])).toContain('右手多了一根手指')
    // 第 2 次的结论里没有眼睛那条，第 3 次就不该还在说眼睛
    expect(noteLineOf(prompts[2])).not.toContain('眼睛')
  })

  it('★ 结论为空时不带那句：没有结论就不编一句结论', async () => {
    const { image, prompts } = recordingImage()
    await run(
      scriptedVision([
        { score: 0.3, missed: [] }, // 判了"不像"，但一条锚点都没点名
        { score: 0.9, missed: [] },
      ]),
      { image, maxAttempts: 3 },
    )

    expect(prompts).toHaveLength(2)
    expect(noteLineOf(prompts[1])).toBeUndefined()
  })

  it('★ 比对过了就不再带旧账：画面审核触发的重画拿到的是干净提示词', async () => {
    const { image, prompts } = recordingImage()
    let reviewed = 0
    const reviewer: PictureReviewer = {
      id: 'fake-vision',
      modelId: 'fake-vision',
      async reviewPicture() {
        reviewed += 1
        return reviewed === 1
          ? { findings: [{ clauseId: 'R-01', where: '左下角' }], reason: '吓人', modelId: 'v' }
          : { findings: [], modelId: 'v' }
      },
    }

    const { calls } = await run(
      scriptedVision([
        { score: 0.3, missed: ['眼睛是否一致'] }, // 第 1 次：不像
        { score: 0.9, missed: [] }, // 第 2 次：像了，但画面审核报了一条
      ]),
      { image, pictureReview: reviewer, maxAttempts: 3 },
    )

    expect(calls).toHaveLength(3)
    expect(noteLineOf(prompts[1])).toContain('深棕圆眼')
    // 第 2 次比对已经过了，第 3 次不该再收到"上一版哪里不像"——
    // 那是在给模型指一条它已经走对的路
    expect(noteLineOf(prompts[2])).toBeUndefined()
  })
})
